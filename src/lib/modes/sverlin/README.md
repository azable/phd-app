<!--
The Sverlin language guide. bot.server.ts sends this file to the assistant after
the instructions in assistant.md, and chooser.server.ts sends its Design section
to the chooser, with these HTML comments removed, so every other word here is
model guidance. Comments are notes for maintainers. guide.server.test.ts builds
every complete example and checks the documented Node and Link props and their
named values against the compiler. Update this guide in the same change as the
language, the library props, or the design space's options. Say each rule once,
here or in the prompt that owns it, and keep examples small and varied, so they
show a mechanism without prescribing a look or structure to copy.
-->

# The Sverlin language

A Sverlin component is one Svelte file that records the steps of an algorithm or
program and draws a view of each step. The markup says what is drawn; how it
looks is the design: every look of every kind of node is a variable the compiler
finds in the markup (see Design). A presentation is one variant of the
component: every presentation shows the same input and algorithm, with its own
value for every variable. Participants compare presentations in pairs, so the
two presentations of a pair should differ in how they show the algorithm.

## Blocks

A component is `<script lang="sverlin">` blocks, written in a subset of
JavaScript (see The subset), followed by a script-free Svelte view. Only the
algorithm block is required, and there is no design block (see Design).

1. `<script lang="sverlin" domain>`: the types, atomic and the collections,
   records, and unions built from them, and the operators the algorithm computes
   with (see Atomic types; Collections, records, and unions; Operators).
2. `<script lang="sverlin" input>`: the fixed starting data, declared with
   `const` or `let`, as `const values = Values([3, 8, 5]);`; every value has a
   domain type.
3. `<script lang="sverlin">`: the algorithm. It starts from the input variables,
   may update them and declare more, may declare functions (see Loops and
   functions), and labels the code its steps are about (see Steps). It runs
   once.
4. `<script lang="sverlin" listing="textbook">`, any number, any name but none:
   texts of the algorithm to show beside the view (see Listing).

## View

The view is markup made only of `<Node>`, `<Link>`, and `<Pointed>` components,
a `<Listing />`, text inside nodes, and Svelte blocks and tags such as `{#if}`,
`{#each}`, `{#snippet}`, `{@render}`, and `{@const}`, with no `<script>`,
`<style>`, HTML, or SVG: every visible thing is a node or a link, so
participants can select it and presentations can vary it. Nodes take no props
that set a look: a node's kind is the snippet it is in, and the design gives
each kind its look. Every input and algorithm variable in scope at the selected
step and the library components are already in scope; never write `import`, and
never declare names `Node`, `Link`, `Pointed`, or `Listing`.

- The top level holds only renders, with `{#if}` and `{#each}` around them, and
  a `<Listing />`, so every node is in a snippet. A snippet without parameters
  is a part of the page, as
  `{#snippet Title()}<Node>Linear search</Node>{/snippet}`, drawn where the top
  level renders it, `{@render Title()}`; a part reads what the top level reads
  and renders parts, views, and operators. Render the parts at the top level
  rather than one part holding the whole view.
- Draw every value of a domain type through a view of its type, as
  `{@render Int(target)}`, and every position through a pointer; the markup
  around them arranges, labels, and explains. A node of text and renders with no
  `layout` reads as a line of text, its renders inline at their own sizes,
  wrapping between words, as
  `<Node>Found {@render Int(target)} at index {@render Position(i)}.</Node>`,
  which keeps each value sized and looking as it does elsewhere, unlike
  `{target}`.
- `{@const name = expression}`, as the first child of the nearest component or
  block, names a value used more than once or too long to read inline.
- Write text in the participant's words about what the algorithm does, never an
  operator's name: "the target is further right", not "Less is true".
- How anything looks is the design's, never the algorithm's; what a step shows
  is read from the algorithm's values and labels (see Steps).

## Views of types

A view is a snippet drawing one value of one domain type, its one parameter of
that type, as `{#snippet IntCell(value: Int)}<Node {value} />{/snippet}`; the
node showing the value shows the type's unit too. Define views at the top level.
A view reads only its value and other views, never the input or algorithm
variables, a pointer apart: how two values relate is drawn where both are in
scope, in the view holding them or by a pointer.

A type is drawn by its name: `{@render Int(value)}` draws the view `views.Int`
chooses, among every view of `Int` and `none`. Name views after how they draw,
as `IntCell` or `IntTally`. Which view draws a value is the variant's, so a view
named as its type (`{#snippet Int(value: Int)}`), rendering a view by its own
name (`{@render IntCell(value)}`; one render is drawn apart through its place,
see Places), and rendering a type no view draws are errors. Views differ in what
they draw: two differing only in look, as a cell and a round cell, are one view.
Offer more than one where the request leaves open what a value shows, as a
number as a cell or a tally, a flag as a word or a tick. In the view a type's
name is its view, never a constructor: draw values the state holds, and a loop's
own index, `k` in `{#each list as v, k}`, as text, `{k}`.

A view of a collection or record draws its parts through their types' views:

```svelte
{#snippet Items(list: Values)}<Node>{#each list as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet VertexCard(v: Vertex)}<Node layout="column">{@render Name(v.name)}{@render Flag(v.seen)}</Node>{/snippet}
```

A node whose only child is an `{#each}` holds a collection: its items sit on
equal tracks, as large as the largest, in a row unless it sets `layout`, and a
collection inside another runs across it, as rows in a column. Put a title for a
collection in a node around it, not beside the `{#each}`. Every view is measured
with every value its type allows, so its box keeps one size and nothing moves
between steps.

## Pointers

A view of a position type (`index(...)`) or reference type (`ref(...)`) can be a
pointer: it holds one `<Pointed>`, standing for the element pointed at, drawn
with its own view, and nodes around it, placed by layout, annotate it: a mark
alone, `<Pointed />`; a bracket,
`<Node layout="row"><Node>[</Node><Pointed /></Node>`; or a label below,
`<Node layout="column"><Pointed />{@render Caption()}</Node>`, its snippet
written in the view so the label is a kind of its own.

- `<Pointed>` takes no props and is written in the pointer view itself, not a
  snippet inside it. Where the pointer is, the element is drawn in the pointer's
  kind, as `Here.Pointed` for the view `Here`: its paint (fill, stroke, opacity,
  text colour) shows only there, the rest of its look in every slot, so every
  slot keeps one size.
- Render a pointer at the top level, outside snippets and blocks other than
  `{#if}`, with a position from the state: a variable (`{@render Index(i)}`), an
  element, a field (`{@render Index(edges[e].to)}`), or a label (see Views of
  what a step computed). Outside any node a position type draws as a mark,
  through its pointer views (`pointers.Index`), so every mark of it looks the
  same; inside a node, as `<Node>at {@render Index(i)}</Node>`, as its number,
  through its other views (`views.Index`).
- The page draws the pointer around the element wherever that is drawn. Every
  element keeps room for every pointer that can point into its collection, and a
  position shown past an end gets a slot there, so nothing moves as pointers
  move. Pointers at one element nest, the one rendered last outermost. A pointer
  out of scope, pointing nowhere, or in an `{#if}` branch not taken draws
  nothing and keeps its room.
- A pointer view may read the input and algorithm variables, so its label can
  follow the state. A pointer at an element drawn as a link, as the edge being
  examined, gives the link its kind's stroke and width.
- A view knows nothing of the place it draws, so a name written into a pointer
  view, as `i` under the mark, is right only where the variant chooses that view
  for that place, and a randomised variant can choose it elsewhere. Prefer one
  pointer view that names nothing; where views of one type must say different
  things, each place's view is chosen by what it says, as `pointers.Position@j`
  (see Places).
- A reference follows its element as it moves: `{@render Tracked(tracked)}`,
  with `const tracked = Tracked(values[3]);`, marks that value wherever a sort
  takes it.

## Steps

- A label marks code the steps are about: `@name[…]` around a statement,
  statements in a row, or an expression, as `@place[values[j] = key;]` or
  `while (@test[Before(Position(0), j) && Greater(values[Prev(j)], key)])`, or
  `@name{` on a block the code already has, a loop's, an `if`'s, or a function's
  body, as `for (…) @insert{`. A name is one word, without dots, and the
  algorithm runs as if the marks were spaces. A labelled loop runs its code once
  per pass, its test leading up to the pass; a label on a function's body runs
  once per call, recursive calls included.
- A label inside another takes its name as a prefix: `@shift[…]` inside
  `@insert{` is `insert.shift`. Once the algorithm, a label, or a function's
  body has labelled statements, every statement in it is inside one or contains
  one, so only loops' headers and tests run outside every label; a statement
  left out is an error naming the labels beside it. Declarations leading a
  block, before its first labelled statement, need no label, as `let min = i;`
  at the top of `@select{`. A label on part of a statement asks nothing of the
  code around it. An algorithm with no labels has one step, its end.
- The page pauses where labels finish, and only there: a pause at a label is a
  step at the end of each of its runs, so a check finding nothing is a step too.
  Each label is a variable, `pause@` and its full name, as
  `"pause@insert.swap": "on"`: `"accumulate"`, `"on"`, or `"off"`. Every label
  is `"on"` to start with and the variant chooses where the steps pause; nothing
  in the view turns a pause on or off. So label what a step can be about, as a
  comparison, `@compare[Greater(…)]`, and the operands it reads.
- A step shows a change: the state just before its code, then just after it.
  Code not paused at, inside a label that is off or outside every label, leads
  up to the next step, and what a label there gives, a value or an application
  rendered at it, is drawn at that step, as a comparison not paused at is at the
  swap it leads to. A step inside a run of a label, as in a call it makes, ends
  that run's code so far: what it changes after is compared with the step.
  Presentations paced differently step together, one holding its step while the
  other shows the code between.
- A label with labels inside it says what its pauses inside keep:
  `"accumulate"`, what its run has done so far, its labels' values drawn and its
  code lit, until the run finishes, so paused at the right operand the left one
  is still marked and `j - 1` still lit; `"on"`, only its own part and the code
  leading up to it outside the run. Either way its own end shows its whole run.
  A label that is off passes through to the labels around it. A step keeps the
  parts of each run around it that accumulates, back to where a run nearer it
  that is on began. A label with no labels inside it is only on or off.
- Step 0 is the input as given, before any code runs; what the algorithm
  declares, its labels' values, and its applications appear from the first step
  on, and the view reads a variable itself only inside a `<Node>`, which hides
  until it is declared. What runs after the last step is a step of its own when
  it changes or declares a value still in scope, so the end is shown; variables
  only leaving scope make no step. `return;` stops the algorithm early.
- Each step records every variable in scope, before and after its code: the
  input's, the top level's, and those of the blocks around it. A variable out of
  scope at a step is not part of it, so whatever the view draws from it is
  missing there (see `shown` in Design): declare a variable where it belongs,
  never at the top level with a stand-in such as -1, and draw one a step's code
  declares through a view or a pointer. A name is declared once among the blocks
  in scope: a loop inside another cannot declare `j` again, while loops one
  after another can.
- A step is named by the label whose run it ends and which run that is, as
  `@insert.swap#1` (`start` for the input as given, `end` for the end), the same
  in every variant, which numbers only the steps it shows. A step has no text:
  the view says what it shows, from the recorded variables, so what it should
  say is in the algorithm's variables, as an answer is the value a search
  returns or where its loop stops.
- Between steps the page moves each value from where it was drawn, so a swap
  shows as two values trading places, a value moved through a temporary being
  the same value. A variable holding a value a collection also holds shows a
  copy, as insertion sort's `key`, which keeps its place once the collection's
  is overwritten and moves back into the row when put down. A value copied to a
  second place, as `values[j] = values[Prev(j)]`, starts where its source was,
  as do an operator view's operands, lifting out of their cells into its caption
  (a computed operand fades in); a value written anew fades in; one no longer
  held fades out. Pointers slide; links switch with the step.

## Loops and functions

The algorithm's loops and branches are JavaScript's: `for`,
`for (const v of values)`, `while`, `do ... while`, `if` and `else`, `break`,
and `continue`. End a loop with `break` or `return` where it has what it looks
for, rather than a flag its test reads, and walk only what each step is about,
as a vertex's own neighbours rather than every edge. Use
`for (const v of values)` where a loop only reads the values and the view points
at none of them, as a sum, and an index loop where the position matters: a
pointer, a write back, a neighbour, or a position as the result. A `for … of`
variable refers to the element it is at, as a reference does: with
`const At = ref(Digits);` and a pointer view of `At`, `{@render At(v)}` marks
the cell `v` is at in `for (const v of digits)`.

A function is declared at the top level of the algorithm block, as
`function search(a, target) { ... }`, and sees only its parameters: give it the
collections it works on, and it changes them in place. Each call gives its
parameters values of the types the first call gave them. `return i;` gives a
value back. A position into a collection the call was given points into the
caller's, and is drawn on that collection wherever the view draws it under its
top-level name. A function may call itself. A step inside a call records the
call's variables, its parameters among them, and the top level's; the caller's
are out of scope there, so with recursion a step shows the innermost call's. A
parameter hides a top-level variable of the same name.

Binary search, stopping where it finds the target:

```svelte
<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');

  const NotAfter = binop((a: Index, b: Index) => Flag(a <= b));
  const Middle = binop((a: Index, b: Index) => Index(Math.floor((a + b) / 2)));
  const Next = unop((p: Index) => Index(p + 1));
  const Prev = unop((p: Index) => Index(p - 1));
  const Last = unop((v: Values) => Index(v.length - 1));
  const Equal = binop((a: Int, b: Int) => Flag(a === b));
  const Less = binop((a: Int, b: Int) => Flag(a < b));
</script>

<script lang="sverlin" input>
  const values = Values([2, 5, 8, 12, 16, 23, 38]);
  const target = Int(23);
</script>

<script lang="sverlin">
  let lo = Index(0);
  let hi = Last(values);
  while (NotAfter(lo, hi)) @probe{
    const mid = Middle(lo, hi);
    @check[if (Equal(values[mid], target)) break;]
    if (Less(values[mid], target)) @right{ lo = Next(mid); } else @left{ hi = Prev(mid); }
  }
</script>

{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet IndexText(p: Index)}<Node value={p} />{/snippet}
{#snippet Mark(p: Index)}<Pointed />{/snippet}
{#snippet Title()}<Node>Binary search for {@render Int(target)}</Node>{/snippet}
{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet Range()}<Node>between {@render Index(lo)} and {@render Index(hi)}</Node>{/snippet}

{@render Title()}
{@render Cells()}
{@render Range()}
{@render Index(lo)}
{@render Index(mid)}
{@render Index(hi)}
```

Inside `Range`, `lo` and `hi` are numbers, drawn by `IndexText`; at the top
level they and `mid` are marks, drawn by `Mark` unless a variant draws one apart
through its place. The loop ends at `break` with `mid` on the target; a search
for a value not there ends with `lo` past `hi`.

## Atomic types

No types are predefined: define each one the request needs, basic ones such as
`Int` included, in the domain block, each as a top-level `const`, one per
meaning (`Index`, `Distance`, `Visited`) rather than one general type:

- a primitive: `'integer'` or `'number'` with both `min` and `max`, as
  `const Int = type('integer', { min: 0, max: 99 });`, or `'boolean'`;
- a refinement of a type defined earlier, with optional `unit`, `min`, and
  `max`: `const Height = type(Int, { unit: 'cm', min: 0, max: 250 });`;
- an enumeration of text or number values, named plainly, leaving how they look
  to views: `const Suit = type(['spades', 'hearts', 'diamonds', 'clubs']);`.
  Text types are always enumerations.

Every type has a known, finite set of values, so a view can be drawn for each:
choose ranges holding every value the algorithm reaches, as a count up to the
input's length; positions need none. Type names cannot be variable names.

Every number, boolean, and text a variable, element, or field holds is typed,
made with a type's name, as `const target = Int(8);` or `Index(0)`. There is no
`null`: every variable starts with a value, and "nothing yet" is a member of a
union that says so, as `Unreached('unreached')`, as is a result that may be
missing, as a search returning a `union(Index, NotFound)`. Reading a value not
there, as `queue[0]` of an empty queue, is an error. A variable keeps the type
it was made with and a value assigned to it takes that type, as an element or
field does: after `let found = Found(false);`,
`found = Equal(values[i], target)` stores a `Found`, and `found = Count(1)` is
an error; one made by a union, `let d = Dist(0);`, holds any member.

Typed values keep their type as they move and read as plain values in conditions
and indexing. Inside an operator they compare as plain values, and arithmetic
keeps types: `Int + Int` is an `Int`; a refined type with the type it refines or
a plain number keeps the refined type (`Height(150) + 5`); an integer result no
longer whole, as `Int(7) / Int(2)`, is an untyped number. A number enumeration
keeps its type, and the result must be one of its values: with
`const Weight = type([4, 5, 7]);`, `Weight(4) + 1` is the `Weight` 5 and
`Weight(4) + Weight(4)` an error; convert to compute beyond, as
`Distance(e.weight)`. Mixing unrelated types, arithmetic on text or booleans,
and leaving a type's values, `min`, or `max` are errors. The view receives plain
values; a value's type chooses the views that draw it.

## Collections, records, and unions

Every array and object is made by a type defined in the domain block, in any
order, each as a top-level `const`:

- a collection of one type, `collection(Int)`, and of collections for a table,
  `collection(Values)`;
- a record with named fields,
  `record({ from: Vertex, to: Vertex, weight: Weight })`;
- a union, a value of one of several types, `union(Distance, Unreached)`;
- a position in a collection, `index(Values)`;
- a reference to an element of a collection of single values, staying with it as
  it moves, `ref(Queue)`, or to a node of a record type, wherever it is,
  `ref(ListNode)` (see Nodes and references).

Make one by calling its name with literals, which take their types from it:
`Values([3, 8, 5])`, or `Edges([{ from: 0, to: 1, weight: 4 }])`, its fields a
`Vertex`, a `Vertex`, and a `Weight`. A literal written into an element or field
takes its type, as `dist[v] = 0`, and one given to an operator the operand's, as
`Append(queue, 3)`; an array or object literal anywhere else is an error. A
record has exactly its fields. `.slice()` gives a collection of the same type.

A position is any whole number: 0 to length - 1 point at an element of its
collection, others nowhere, as the length after a loop ends. Reading or writing
outside the collection is an error, except that writing at the length adds one.
The view keeps room past an end for the positions its pointers draw, at most 4
places; a position nothing draws keeps none. A position is bound to its
collection when declared: `Index(0)` points into the only `Values`, and with
several, name it, as `Index(left, 0)`; the binding stays, so
`Move(k, Sum(i, j))` keeps `k` in its collection. One stored in a record or
collection keeps where it came from (`Take({ from: j })`, `Next(i)`,
`const at = take.from;`), and a number stored there points into the only
collection of its type, or the one named, as `Take({ from: Index(left, 0) })`.
To point at a cell of a grid, hold the row in a variable: `let row = paths[r];`
is the row itself, so `ColIndex(row, 1)` points into `paths`, and
`NextRow(row, paths[r])` moves it.

A reference, as `const front = Front(queue[0]);`, reads as its element. Where a
position stays at its place as the collection changes, a reference stays with
its element, after `queue = Rest(queue)` or a sort; once the element has left
the collection it refers to nothing, and its pointer draws nothing, keeping its
room. It follows an element of a collection of its own type, even when the same
value is also a field elsewhere. Use a position to step to a neighbour.

A union value is always one of its members: a literal becomes the member it
fits, as `Distances([0, 'unreached'])`, and one fitting two needs its type, as
`Distance(4)`. Inside an operator, members compare with `===` and `!==`,
different members unequal, but not with `<` or `>`, so check the member first:

```js
const Reached = unop((d: Dist) => Flag(d !== 'unreached'));
const Shorter = binop((a: Distance, b: Dist) => Flag(b === 'unreached' || a < b));
```

The view receives plain arrays and objects, drawn by their types' views.

## Nodes and references

A node of a linked list, a tree, or a graph is a record referring to others of
its kind, as `struct Node { char name; struct Node *next; }` in C. A reference
to a record type, `ref(ListNode)`, is that pointer: it refers to a node wherever
it is, and always to one. "No node" is a value of a type of its own, joined to
the reference with a union, so a field that may end says so, and the end is
drawn and varied as any value is. A record holding itself other than through a
reference or an index would never end, and is refused. A list reversed, the
nodes `prev` and `cur` refer to both marked:

```svelte
<script lang="sverlin" domain>
  const Name = type(['A', 'B', 'C']);
  const Flag = type('boolean');
  const End = type(['end']);
  const ListNode = record({ name: Name, next: Next });  // Next is defined below
  const NodeRef = ref(ListNode);                         // always a node
  const Next = union(NodeRef, End);                      // a node, or the end

  const IsNode = unop((p: Next) => Flag(p !== 'end'));
</script>

<script lang="sverlin" input>
  const head = NodeRef(ListNode({ name: 'A', next:
    NodeRef(ListNode({ name: 'B', next:
      NodeRef(ListNode({ name: 'C', next: End('end') })) })) }));
</script>

<script lang="sverlin">
  let prev = Next(End('end'));
  let cur = Next(head);
  while (IsNode(cur)) @rewire{
    const after = cur.next;
    cur.next = prev;
    prev = cur;
    cur = after;
  }
</script>

{#snippet NameCell(value: Name)}<Node {value} />{/snippet}
{#snippet EndMark(e: End)}<Node>∅</Node>{/snippet}
{#snippet NodeBox(n: ListNode)}
  {#snippet NextField()}<Node><Link to={n.next} /></Node>{/snippet}
  <Node layout="row">{@render Name(n.name)}{@render NextField()}</Node>
{/snippet}
{#snippet Here(p: NodeRef)}<Pointed />{/snippet}
{#snippet Heap()}
  <Node layout="free" flow="x">{#each all(ListNode) as n}{@render ListNode(n)}{/each}</Node>
{/snippet}

{@render Heap()}
{@render NodeRef(prev)}
{@render NodeRef(cur)}
```

- `NodeRef(ListNode({ … }))` refers to a new node, written nested, as here, or
  one variable each, as the graph under Link; the algorithm makes one through a
  structural operator, as
  `const NewNode = binop((v: Name, n: Next) => ListNode({ name: v, next: n }));`
  and `head = NodeRef(NewNode(v, head))`. A cycle is the algorithm's to make.
- A field is read and written through a reference, `cur.next = prev`; a value of
  another type is refused, and reading or writing one through the end is a
  mistake at that step ("cur is an End ("end"), so it has no next"). A variable
  holding a node or the end is made with the union, `let cur = Next(head);`. The
  root and its parts read a field through a reference too, from the node it
  refers to, as `{#each queue as q}{@render Name(q.name)}{/each}`; a view
  drawing a reference itself as a value is refused, as it would show the node's
  place.
- A node lives while something refers to it: a variable in scope, a collection,
  or a live node. `all(ListNode)` is every live node, in the order made, drawn
  as a collection, each through the record's view; one no longer referred to
  fades out, and a node keeps its identity as its links change, so it stays put.
  A step records a reference as its node's place, so a circular list stays
  finite. At most 64 nodes of a type are live at once.
- `<Link to={n.next} />` with no `from`, in a node of the record's view, leaves
  that node for the node the field refers to, and the free layout around the
  nodes lays it out; a link beside the view's nodes, in none, leaves nothing.
  Write links there, reading the record's fields: one in a view of the reference
  type itself, as
  `{#snippet NextMark(value: Next)}<Link to={value} />{/snippet}`, ends at the
  value drawn, not at a node. Draw a node as fields, as a textbook does,
  `[ A | next ]` or a tree's `[ left | key | right ]`: a node holding only such
  links is a field, its own snippet so it has its own look
  (`NodeBox.NextField`); the arrow leaves the field, arcing over its node where
  it points back. A tree's children are placed in the order their links leave
  it, so the left field's child is on the left. Where the field is the end, the
  link draws the end with its type's view (`views.End`, as `EndMark`'s ∅). A
  pointer view of the reference, as `Here`, marks the node a variable refers to,
  and draws nothing at the end.
- An array-based structure keeps an index instead, `index(Nodes)`.

## Operators

The input and algorithm compute nothing themselves: everything computed is an
operator the domain declares, unary or binary, a function of typed operands, as
`binop((a: Int, b: Int) => Flag(a > b))`, the only place types are written. The
algorithm applies it as a call, each operand taking its parameter's type:
`if (Equal(values[i], target)) break;`, `total = Add(total, v);`. Writing stays
plain: `=` puts a value into a variable, element, or field. Name operators for
what they compute, as `Before`, `Middle`, or `Shorter`, and keep those walking a
collection apart from those for what the algorithm does:

```js
// walking the collection
const Length = unop((v: Values) => Index(v.length));
const Before = binop((a: Index, b: Index) => Flag(a < b));
const Next = unop((p: Index) => Index(p + 1));

// what the algorithm does
const Equal = binop((a: Int, b: Int) => Flag(a === b));
```

- Raw: control flow (`if`, loops, `break`, `continue`, `return`, the algorithm's
  functions, `? :`, `&&`, `||`, `??`), declarations, writes with `=` (to a `let`
  variable, an element, or a field), reading elements and fields, and typed
  values from literals, as `Index(0)` or `Flag(true)`.
- Declared as operators: every operator on values (`<`, `===`, `+`, `!`, `-x`),
  `++`, `--`, `+=`, `.length`, `Math`, template strings, and collection methods
  (`.push`, `.shift`, `.indexOf`, `.slice`). Each written raw is an error naming
  the declaration to add.
- An operator changes nothing, so an application whose result is unused, as
  `Append(served, front);` or a `for` update `Next(i)`, is an error naming the
  write, `served = Append(served, front)`.
- A collection's method is an operator computing the new collection, written
  back with `=` in place, so the collection and the elements it keeps move
  rather than reappear: `queue = Append(queue, v)` with
  `binop((q: Queue, v: Vertex) => Queue([...q, v]))`, or `queue = Rest(queue)`
  with `unop((q: Queue) => Queue(q.slice(1)))`.
- An operator giving a collection or record only rearranges its operands: each
  element or field is an operand, a read of one or its parts (`v[p]`, `e.to`),
  or a spread of one or a slice of one (`...q`, `...q.slice(1)`), as
  `Queue([...q, x])` or `Edge({ from: e.to, to: e.from })`. A new element,
  computed or literal, is refused: compute it with a value operator and write
  it, `values[p] = Inc(values[p])`, or pass it in. A collection filled at run
  time is built in a loop, `for (const v of vertices) dist = Append(dist, u);`.
- An operator is one action a learner takes as one (compare, add, take the next
  position, append), never a loop or a library algorithm, so
  `[...a, ...b].sort(…)` is refused and merging is written in the algorithm. Its
  function is one expression of its operands, reading only them and `Math`,
  without braces, nested functions, other operators, methods outside the subset,
  or the state, changing nothing, and wrapping what it computes in its result
  type, as `Flag(a > b)`.
- A rearrangement is plain writes labelled as one step, as a swap through a
  temporary:
  `@swap[const moved = values[i]; values[i] = values[Next(i)]; values[Next(i)] = moved;]`.

## Views of what a step computed

An operator is a type a view can take: `{#snippet Ask(g: Greater)}` views an
application of `Greater`, its operands named by the operator's parameters
(`g.a`, `g.b`; none can be called `value`) and its result `g.value`, each drawn
through its type's view. It is reached only at a label:
`{@render Greater(@sweep.pair.test)}` in the root or a part draws the
application made inside that label's code since the step before, through the
view `views.Greater` chooses, and nothing, keeping its room, where that code
made none. A label around more code, as `@sweep.pair`, draws one made anywhere
inside it; one the input never makes there is left out; an application outside
every label is never drawn; `{@render Greater()}` and `applied(Greater)` without
a label are refused. The view never applies an operator itself, as `Next(p)`:
label an application, as `@next[Next(i)]`, and read the label. A view named as
an operator is, as a pointer view called `Next`, is drawn through its type.

Bubble sort, the question at each comparison and a caption at each swap in one
place:

```svelte
<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = collection(Int);
  const Index = index(Values);

  const Length = unop((v: Values) => Index(v.length));
  const Before = binop((a: Index, b: Index) => Flag(a < b));
  const Next = unop((p: Index) => Index(p + 1));
  const Prev = unop((p: Index) => Index(p - 1));
  const Greater = binop((a: Int, b: Int) => Flag(a > b));
</script>

<script lang="sverlin" input>
  const values = Values([5, 1, 4, 2, 3]);
</script>

<script lang="sverlin">
  for (let end = Length(values); Before(Index(1), end); end = Prev(end)) @sweep{
    for (let i = Index(1); Before(i, end); i = Next(i)) @pair{
      if (@test[Greater(values[Prev(i)], values[i])]) @swap{
        const moved = values[Prev(i)];
        values[Prev(i)] = values[i];
        values[i] = moved;
      }
    }
  }
</script>

{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet FlagWord(value: Flag)}<Node>{value ? 'yes' : 'no'}</Node>{/snippet}
{#snippet Ask(g: Greater)}
  <Node>is {@render Int(g.a)} > {@render Int(g.b)}? {@render Flag(g.value)}</Node>
{/snippet}
{#snippet Swapping()}<Node>out of order, so they swap</Node>{/snippet}
{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet Board()}
  <Node layout="column">
    {@render Cells()}
    {#if when(@sweep.pair.test)}
      {@render Greater(@sweep.pair.test)}
    {:else if when(@sweep.pair.swap)}
      {@render Swapping()}
    {/if}
  </Node>
{/snippet}

{@render Board()}
```

Paused at both, a comparison reads "is 5 > 1? yes", its operands lifting out of
their cells, and the swap after it says why they trade places. With
`pause@sweep.pair.test` off the page plays the swaps alone; with `views.Greater`
none the question is left out and the steps stay as they were.

A label is read in the root and its parts, never in a view, by its full name,
the labels around it first, as `@insert.key` for `@key` inside `@insert`; a
shorter ending is refused with the full names it could stand for, so adding a
label never changes or breaks what a name reads, in the markup or a variant.
Only a label on an expression gives a value, as `const key = @key[values[i]];`:
`@name` is what that expression gave since the step before, drawn at the step's
after, and missing where it gave none or several. It is held at later steps
inside the run around it that keeps it (see Steps), drawn from the step's
before, so a mark stays until that code finishes. So a view shows what a step's
code held though no variable holds it, as the key a whole insertion inserts,
`{@render Int(@insert.key)}`, out of scope once its block ends. A label giving a
position is drawn by a pointer, pointing while that code runs.

To mark what a step used, label it and render the position's type at each label,
so every mark looks the same, marking with a label rather than a loop variable
(`@right`, not `i`) where the mark is what the step used:

```js
for (let i = Index(1); Before(i, end); i = Next(i)) @pair{
  if (Greater(values[@left[Prev(i)]], values[@right[i]])) @swap{ … }
}
```

```svelte
{@render Index(@pair.left)}
{@render Index(@pair.right)}
```

A label gives a value only where its code ran, `&&` skipping it included, so the
marks come and go with the comparison, however the value is then used. A label
added for a mark is a pause too: on, the page pauses as the cell is picked; off,
the mark shows at the step its code leads up to.

A place's look holds at every step, and a view cannot choose by a label's value
(`{#if @compare}`), so to mark only what a test let through, label the positions
the code it guards uses and give those places their own look: labelling a swap's
reads, `values[@from[Prev(j)]]` and `values[@to[j]]`, with
`Highlight.Pointed@insert.swap.from.fill` and `…to.fill` `red-100`, turns only
the pairs found out of order red, and with `pause@insert.swap.to` on, as a step
of their own before anything is written. Showing or hiding something at some
steps needs no flag, sentinel, or cast in the algorithm: a label, a pointer at a
label, a view chosen per place, or `{#if when(@label)}` below does it.

`{#if when(@insert.swap)}…{/if}` draws its contents at each step inside a run of
a label, any label: the step that ends a run and those inside it where labels
within pause, whatever the pauses, never steps leading up to it or after it;
elsewhere they are hidden, keeping their room. `when(start)` and `when(end)`
draw them at the first step, the input as given, and at the last, as a note on
what the algorithm starts from or ends with. `when(…)` is the whole test, never
part of another condition, and never reads the label's value (`{#if @label}` is
refused); no `{:else}`. Branches that take turns share one place, as large as
the largest, `{#if when(@a)}…{:else if when(@b)}…{/if}`, as in bubble sort
above; a chain whose branches would show at one step, as a label and one inside
it, is refused.

What has happened so far is a list for `{#each}`: `runs(@check.at)`, every value
the label has given up to this step, and `applied(Equal, @check)`, every
application of `Equal` made inside `@check` so far:

```svelte
{#snippet Asked()}<Node>{#each applied(Equal, @check) as e}{@render Equal(e)}{/each}</Node>{/snippet}
{#each runs(@check.at) as p}{@render Index(p)}{/each}
{@render Asked()}
```

## Design

The design space is every variable of a component's look, found in its markup:

- `views.Int`, for each type rendered by name: its views and `none` (see Views
  of types).
- `pointers.Index`, for each position type rendered by name as a pointer: its
  pointer views and `none` (see Pointers).
- `pause@insert.swap.to`, for each label, by its full name, never a shorter
  ending, so a label added later changes no saved variant: `"accumulate"`,
  `"on"`, or `"off"`, one with no labels inside it only `"on"` or `"off"` (see
  Steps). A variant saved with `true` reads as its first option, `false` as
  `"off"`.
- The page frame's: `frame.ratio`, `frame.justify`, `frame.align`,
  `frame.padding`, `frame.gap`, and `frame.layout` (see Page frame).
- A listing's, where the view places a `<Listing />`: `listing.language`, its
  lit look, as `listing.lit.radius`, and each region's paint, as
  `listing.lit@insert.compare.left.fill`, which follows its label's mark until
  set (see Listing).
- Each kind of node's props. A kind is the snippet a node is in: a view's or a
  part's name, as `Items` or `Title`, and for a snippet inside another, both, as
  `IntTally.Tally`; every node of a snippet is of its kind. A pointer view's
  `<Pointed>` is a kind of its own, as `Here.Pointed`, and so is a snippet's
  `<Link>`, as `Graph.Link`. A variable is its kind and prop, as
  `Here.Pointed.fill` or `Items.Under.shown`.
- Each place's own, for a render with an argument (see Places).

A snippet's name is its kind, so it names what its nodes are, never how they
look: `Caption`, `Visited`, `Under`, not `Amber` or `Big`. Each snippet has a
name of its own, a part is not named as a type, and a render names a part, a
type, or an operator, so every kind is known before the view runs.

Every kind of node has these props, each with a fixed set of options:

- `shown`: whether its nodes are drawn; one left out takes its children and
  keeps no room. A render is missing where its view is `none` or not shown or it
  draws an absent value: for a whole presentation left out, keeping no room, and
  at one step hidden, keeping its room. A node of only text and renders is one
  statement that one missing render takes whole, so
  `<Node>swap {@render Int(@swap.a)} and {@render Int(@swap.b)}</Node>` hides at
  a step that swaps nothing; a node holding other nodes has parts, each node and
  render in it, and goes only with all of them, so in
  `<Node layout="row"><Node>lo {@render Index(lo)}</Node><Node>mid {@render Index(mid)}</Node></Node>`
  only the `mid` part hides while `mid` is out of scope (a part of the page
  rendered in it counts as its nodes do). Split a sentence into parts to keep
  what is there. A node holding no render, as a title, stays. A `<Pointed>` kind
  has no `shown`: to drop a pointer, leave out a node around its `<Pointed>`,
  give its type's view `none`, or render it in `{#if}`, its elements then drawn
  as without it.
- `fill` and `stroke`: `none` or a colour; `color`: the text's colour.
- `strokeWidth`: 0, 0.5, 1, 1.5, 2, 3, or 4 pixels; `strokeStyle`: solid, dashed
  (suiting a place rather than a value), or dotted; `opacity`: 0.25, 0.5, 0.75,
  or 1.
- `font`: sans, serif, or mono; `size`: 0.75, 0.875, 1, 1.125, 1.25, 1.5, or 2
  rem; `weight`: normal or bold.
- `padding`: 0, 0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, or 2 em; `radius`: 0, 2,
  4, 6, 8, or 12 pixels, or 999 for a circle or pill; `minSize`, the least width
  and height: 0, 1, 1.5, 2, 2.5, 3, or 4 em.

A kind arranging its children, with a `layout`, a collection, or links, also has
`gap` (as `padding`), `align` (start, center, or end, across) and `justify`
(start, center, end, between, around, or evenly, along); where a collection's
node has more room than its tracks need, `justify` start, center, or end puts
the room after, around, or before them, and between, around, or evenly spreads
the tracks over it. Positions past a collection's ends are drawn in end slots,
kept only as far as drawn positions go: a collection's kind has `overflow`,
included (end slots are tracks of its box) or excluded (they hang outside, so
centring it centres its elements), and a `<Pointed>` kind too, shown (drawn past
the ends) or hidden (nothing there, keeping no room). A link's kind has `shown`,
`stroke`, `strokeWidth`, `opacity`, `strokeStyle`, and `color` for its label.

A kind with a free layout (see Free layout and links) also has that layout's
look. `form` is the shape it gives the structure its links make, read from the
arrows present at every step (a link that comes and goes is drawn on top of it
but does not change it): a path such as a linked list, a cycle, a tree, or a
layered graph (acyclic, with nodes that have several parents). Any structure can
lie along its reading order (a path in link order, a tree depth first, a layered
graph each node after its parents) as `line`, `snake` (rows read back and
forth), `wave`, `arc`, or `scatter` (free positions that keep each node near the
next); a cycle can also take `ring`, a tree `tree-down`, `tree-right`, `radial`,
or `indented`, and a layered graph `layers-down` or `layers-right`, as its
`flow` allows. A layout's options are the forms its data's structure can take,
and it starts in that structure's natural form: a path in a `line` (as does a
layout whose data links nothing), a cycle in a `ring`, a tree `tree-down` and a
layered graph `layers-down` (`-right` along `flow` x); where the page finds the
links it draws make another structure, a form that one cannot take is drawn in
its natural form. `curve`, `straight` (the start) or `curved`, is how its arrows
prefer to run. `layoutSeed`, 1 to 32, is what its spacing and nudges are drawn
from. The same values draw the same picture whatever the space. A link's kind
has `curve` too, `layout` (as its layout's arrows run, the start), `straight`,
or `curved`, and `bend`, `none` (the start) or how far it bows to one side as a
fraction of its length: -0.5, -0.3, -0.15, 0, 0.15, 0.3, or 0.5.

The colours are white, black, and 18 hues (neutral, red, orange, amber, yellow,
lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia,
pink, and rose) in 11 shades from 50, the lightest, to 950, as `blue-600`.

### Places

A render with an argument is a place, named by what is written there after `@`:
a label, by its full name, a variable, or a field, as
`{@render Index(@pair.left)}` at `@pair.left`, `{@render Index(found)}` at
`@found`, and `{@render Int(g.a)}` in `Ask` at `Ask.` and `@g.a`. A render of
another expression, or with nothing between the brackets, is none. Every render
is drawn by the view its type's variable chooses, in its kinds' looks; a place
has variables of its own that fall back to those until a variant sets them, so
one render is drawn apart with nothing declared:

- its own choice of view, where its type has more than one view of the kind it
  draws, as `pointers.Index@found` or `views.Int@swap.held`;
- its own `shown`, `fill`, `stroke`, and `color` for the kinds of each view it
  can draw, nested snippets included, as `Highlight.Pointed@pair.left.fill` or
  `IntTally.Tally@swap.held.shown`, though not for another view that view
  renders.

```json
{
  "pointers.Index": "Highlight",
  "pointers.Index@found": "Arrow",
  "Highlight.Pointed@pair.left.fill": "sky-100",
  "IntCell@swap.held.fill": "neutral-100"
}
```

In a key the last part is the prop, and the dots after `@` the place's. A label
and a variable rendered by one type with one name would share a place, which is
an error: rename the label.

### Variants

A variant gives every variable a value, and a presentation draws one. The
starter is each type in its first view, each kind in a plain look for what it
is: values framed, text and layouts unframed, and pointers marked in amber, and
every label paused `"on"`. After a change to the source, the chooser chooses
each presentation's values, and a presentation built after a change keeps the
values of the one it was made from where nothing else sets them; the assistant
sets values with `vary`, and the participant's Another variant randomises them,
keeping which variables share a value, each colour's shade, and what is shown.

### Declare what varies

The markup decides what can vary, so write it so the choices worth comparing are
variables:

- Draw everything that means something of its own in a snippet of its own, so
  its look is a variable of its own and a variant can leave it out: a title, a
  caption, an index, a pointer's label. A snippet without parameters draws it:
  at the top level, a part of the page; inside a view, a part of it that sees
  the view's value, as `Under` and `Tally` below.
- Draw what the state means with views of its own: an answer, as the position a
  search finds, by a pointer of its own, and a mark meaning something else at
  some steps by another pointer, rendered in `{#if}` or at a label, so a found
  element can look different from a checked one.
- Draw what each step changes that the participant follows; a step whose change
  nothing draws looks like the step before, as a list reversal drawing only
  `cur` would at each step changing `prev`.
- Give a source a listing of the algorithm as taught (see Listing), and more
  than one view of a type where the request leaves open what it shows (see Views
  of types); the chooser decides whether a variant shows each (as
  `listing.language` none).
- Never write a look into the markup: a look the participant asks for is the
  values of a kind.

```svelte
{#snippet IntTally(value: Int)}
  {#snippet Tally()}<Node>{'•'.repeat(value)}</Node>{/snippet}
  <Node layout="column"><Node {value} />{@render Tally()}</Node>
{/snippet}
{#snippet Items(list: Values)}
  <Node>
    {#each list as v, k}
      {#snippet Under()}<Node>{k}</Node>{/snippet}
      <Node layout="column">{@render Int(v)}{@render Under()}</Node>
    {/each}
  </Node>
{/snippet}
```

## The subset

- Allowed: numbers, strings, booleans, and the collections and records their
  types make; `if`, `for`, `for (const x of array)`, `while`, `do ... while`,
  `break`, `continue`, and functions at the top level of the algorithm block
  (see Loops and functions); `&&`, `||`, `??`, and `? :`; writes with `=`; and
  the operators the domain declares (see Operators), whose functions may use
  JavaScript's operators, template strings, `.length`, the collection methods
  (`[...c, x]`, `.slice`, `.indexOf`, `.includes`, `.join`), and
  `Math.abs/ceil/floor/max/min/pow/round/sign/sqrt/trunc` and `Math.PI`.
- Not allowed: `null` and `undefined`, other functions, such as arrow functions
  outside an operator and functions inside blocks, `new`, classes, `this`, `==`,
  string methods, other globals, and array or object literals except inside a
  type or `.push`/`.unshift`, or assigned to an element or field.
- Limits: 200 steps, 1,000,000 operations, 10,000 entries per array or object,
  and 10,000 characters per string.

## Library

Nodes say nothing about what a structure means by themselves: nodes laid out as
a row can show an array, a list of linked nodes, a queue, or anything else.
Decide the meaning from the participant's request, and when they leave it open,
offer views that draw each reading.

### Page frame

Every view sits in a page frame, a canvas laid out at a fixed logical size (1200
pixels wide) and scaled to fit, so every presentation renders identically
whatever the pane size. Its ratio is `frame.ratio` (16:9, 4:3, 3:2, 1:1, 3:4, or
9:16), 16:9 in the starter; keep 16:9 unless the participant asks for another
shape. The frame stacks what the top level renders in a column or a row
(`frame.layout`), `frame.gap` apart, spread and aligned by `frame.justify` and
`frame.align`, as between to put a title at the top and a note at the bottom,
with `frame.padding` inside its edge. Use its width: lay sequences out across it
rather than down it. Participants select nodes by clicking or dragging a box, to
point at them in feedback; they scroll to zoom, drag with the middle button or
with Space held to pan, and double-click empty space to reset, and the view is
kept as they step through. Every node is selectable, so draw each thing a
participant might want to point at, such as a cell, a pointer name, or a
caption, as a node of its own.

### Listing

`<Listing />` shows the algorithm as taught beside the view, the flow the
participant follows, in the code or pseudocode they know or a textbook's,
exactly as written, lighting the code each step ran. The algorithm block is what
runs and the listing what is read, and they meet through labels, so the
algorithm is written as the language needs (typed values, operators, labels)
while the listing reads as the lesson; when the algorithm changes, its listing
follows. Place it outside views, at the top level or in a part, as
`<Node layout="row"><Listing /><Node layout="column">…</Node></Node>`; it takes
no props or children, and each of its lines is a node participants can select.
The text is a `<script lang="sverlin" listing="textbook">` block; with several,
`listing.language` chooses which one a presentation shows, the first in the
starter, or `none`.

Mark each part of the text that should light as a region with the algorithm's
labels, written as they are there (see Steps): `@name[text]`, nested as finely
as needed, as `while @test[@bound[j > 0] and @cmp[A[j] > key]]`, a region inside
another taking its name as a prefix. A `[` without a name, as in `A[i]`, is
text, and the marks are not shown. Every region must have a label and every
label a region, as each label is a place the page can pause, lighting its region
there. A region holds the text of what its label marks and no more: a loop's or
an `if`'s own line goes with its test's label or none, never inside its body's,
as `for i = 2 to n` stays outside `@insert[…]`; a test with a line of its own
has a label of its own, as `while (@more[Waiting(queue)])` with
`while @more[the queue is not empty]`, and the chooser decides whether to pause
there.

- Only the code of labels the steps pause at lights, all in one look: a step's
  label's region with the code inside it, and the parts done so far of a run
  accumulating around it; other code stays dark, so label what should light, as
  `@bound[j > 0]`, and pause at it.
- A region lights without the regions inside it that did not run since the code
  around them started, so once `j > 0` fails, `A[j] > key` stays dark. Code kept
  as run lights only once it is done, once the step has left it or, for a loop
  or an `if`, its test has finished, so a comparison whose operands are still
  being found, a line half run, or a loop's line while its test runs stays dark.
- Where a region's own text, outside the regions inside it, has a line for each
  statement its label marks, each line lights for its own statement; otherwise
  it lights as one. A line lights from its first character to its last, never
  its indentation.
- The lit look is `listing.lit`, with a kind's `fill`, `stroke`, `strokeWidth`,
  `strokeStyle`, `radius`, `weight`, and `padding`, and `color`, `none` keeping
  the listing's ink; a stroke is drawn inside the lit text and its padding takes
  no room, so lighting never moves the text, and a `radius` of 999 makes a pill.
  Each region is a place, by its label's full name, with its own `fill`,
  `stroke`, and `color`, as `listing.lit@insert.compare.left.fill`, falling back
  to its label's mark where the root draws the label as a pointer, so the code a
  mark stands for looks as its cell does, otherwise to `listing.lit`. A region
  in another paint than the region around it is drawn inside it.

Insertion sort, beside a textbook's pseudocode:

```svelte
<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Flag = type('boolean');

  const Length = unop((v: Values) => Position(v.length));
  const Before = binop((a: Position, b: Position) => Flag(a < b));
  const Next = unop((p: Position) => Position(p + 1));
  const Prev = unop((p: Position) => Position(p - 1));
  const Greater = binop((a: Int, b: Int) => Flag(a > b));
</script>

<script lang="sverlin" input>
  const values = Values([5, 2, 4, 1]);
</script>

<script lang="sverlin">
  for (let i = Position(1); Before(i, Length(values)); i = Next(i)) @insert{
    @key[const key = values[i];]
    @init[let j = i;]
    while (@test[@bound[Before(Position(0), j)] && @cmp[Greater(values[Prev(j)], key)]]) @shift{
      @copy[values[j] = values[Prev(j)];]
      @down[j = Prev(j);]
    }
    @place[values[j] = key;]
  }
</script>

<script lang="sverlin" listing="textbook">
  INSERTION-SORT(A, n)
  1  for i = 2 to n
  2      @insert[@key[key = A[i]]
  3      // Insert A[i] into the sorted subarray A[1 : i - 1].
  4      @init[j = i - 1]
  5      while @test[@bound[j > 0] and @cmp[A[j] > key]]
  6          @shift[@copy[A[j + 1] = A[j]]
  7          @down[j = j - 1]]
  8      @place[A[j + 1] = key]]
</script>

{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Mark(p: Position)}<Pointed />{/snippet}
{#snippet Key()}<Node>key {@render Int(key)}</Node>{/snippet}
{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet Board()}
  <Node layout="row">
    <Listing />
    <Node layout="column">{@render Key()}{@render Cells()}</Node>
  </Node>
{/snippet}

{@render Board()}
{@render Position(i)}
{@render Position(j)}
```

## Node

A node is one of three things:

- a value: `<Node value={7} />` shows a number, string, or boolean, as a view's
  own node does with its value;
- content: `<Node>any text or markup</Node>` shows its children, for titles,
  explanations, captions, indices, and pointer names, and with `layout` arranges
  them, as a view of a collection arranges its elements' views; without
  `layout`, children flow as ordinary text;
- a shape: `<Node />` has no value or children, and draws only its box, for
  marks such as dots, sized by its kind's padding and least size.

### Props

A node's props say what it is and how its children are arranged; its look is its
kind's (see Design). Props starting with `__` are reserved for the library.

- `value`: the number, string, or boolean a value node shows.
- `layout`: `'row'`, `'column'`, or `'free'` (placed by layout; see Free layout
  and links); arranges a node's children.

## Free layout and links

`layout="free"` places a node's children by layout instead of in a line: use it
for linked structures such as linked lists, trees, and graphs, joined by
`<Link>` components (see Link), and for groups whose arrangement is open, with
or without links. The children are kept clear of each other and gathered
compactly, as their kind's look says (see Design). A node hugs its children
whatever its layout. Every direct child is placed; put content that belongs
together, such as a value and its index, in one child node.

- `flow`: in a free layout, `'x'` or `'y'` makes arrows point rightwards or
  downwards, as for a list or a tree; only forms that run that way are drawn.
  Set it only when asked; an undirected graph has no flow, and its links are
  `directed={false}`.

A free layout's look, `form`, `curve`, and `layoutSeed`, is its kind's (see
Design), never a prop, and arrows bend round other nodes and labels. A selection
reports each free layout around the element, with its kind, its `layoutSeed`,
and the form it drew: to keep a layout the participant liked ("keep this layout
but …"), vary that kind's `form` and `layoutSeed` to them, and its `curve` only
if they name it.

## Link

`<Link from={edge.from} to={edge.to} />` draws a line, by default an arrow,
between two nodes. Put links among the children of the node whose children they
join, or in a view rendered there, as of an edge, of a node (see Nodes and
references), or of an operator's application; never in a pointer view, which
draws inside the element it marks. They take no space; give the node a `layout`,
`"free"` for a linked structure or `"row"` or `"column"`, unless it holds a
collection's `{#each}`, which runs as the collection. Only a free layout places
its children by their links; in a row or column links are drawn over the
children, which stay where they would be without them, each arcing over ends
side by side or beside ends one above the other, clear of the boxes. Each link
is selectable, as a node is, and its look, line and label, is its kind's (see
Design), as `Arrow.Link` for a link in `Arrow`.

- `from` and `to`: positions from the state, as `edge.from`, naming the node
  drawing the element each points at (or, where only its fields are drawn, the
  node holding its whole `{#each}` item), the index of an `{#each}` over a
  collection among them, as `k` in `{#each vertices as v, k}`; labels giving
  positions, as `@insert.swap.from`; never text written in the view. In a view
  of an element, a link with no `from` starts at the node drawing that element,
  as a node's `next`.
- `directed`: `false` for a plain line instead of an arrow.
- `label`: a short text shown at the middle of the link, such as `next` or
  `head`.

How a link curves is its kind's `curve` and `bend` (see Design), never a prop. A
selected link reports the bend it drew; when the participant likes a curve, vary
its kind's `bend` to the nearest option.

Links come and go with the steps: one in `{#if}` shows only while it matters, as
the pointer being followed, and one whose end is a label, or a variable out of
scope, shows only where it has a value, as a pointer at the label does, so
`<Link from={@insert.swap.from} to={@insert.swap.to} />` among the cells joins
the two a swap trades, at its steps alone. Its place is kept across the
animation, so nothing moves when it appears.

Breadth-first search, each vertex with a list of its neighbours, drawn as arrows
from each vertex `k` to them, with the vertex visited and the neighbour looked
at marked and the queue drawn by number:

```svelte
<script lang="sverlin" domain>
  const Name = type(['A', 'B', 'C', 'D', 'E']);
  const Flag = type('boolean');
  const Vertex = record({ name: Name, seen: Flag });
  const Vertices = collection(Vertex);
  const VertexRef = index(Vertices);
  const Out = collection(VertexRef);
  const Adjacency = collection(Out);
  const Queue = collection(VertexRef);

  const Waiting = unop((q: Queue) => Flag(q.length > 0));
  const Not = unop((f: Flag) => Flag(!f));
  const Append = binop((q: Queue, v: VertexRef) => Queue([...q, v]));
  const Rest = unop((q: Queue) => Queue(q.slice(1)));
</script>

<script lang="sverlin" input>
  const vertices = Vertices([
    { name: 'A', seen: true },
    { name: 'B', seen: false },
    { name: 'C', seen: false },
    { name: 'D', seen: false },
    { name: 'E', seen: false }
  ]);
  const out = Adjacency([[1, 2], [3], [3], [4], []]);
</script>

<script lang="sverlin">
  let queue = Queue([0]);
  while (Waiting(queue)) @visit{
    @take[const current = queue[0];
    queue = Rest(queue);]
    for (const w of out[current]) @look{
      if (Not(vertices[@next[w]].seen)) @add{
        vertices[w].seen = true;
        queue = Append(queue, w);
      }
    }
  }
</script>

{#snippet NameText(name: Name)}<Node value={name} />{/snippet}
{#snippet SeenMark(seen: Flag)}<Node>{seen ? '✓' : '·'}</Node>{/snippet}
{#snippet VertexCard(v: Vertex)}<Node layout="column">{@render Name(v.name)}{@render Flag(v.seen)}</Node>{/snippet}
{#snippet RefCard(v: VertexRef)}<Node value={v} />{/snippet}
{#snippet QueueItems(q: Queue)}<Node>{#each q as v}{@render VertexRef(v)}{/each}</Node>{/snippet}
{#snippet Marked(v: VertexRef)}<Pointed />{/snippet}
{#snippet Graph()}
  <Node layout="free">
    {#each vertices as v, k}
      {#snippet VertexNumber()}<Node>{k}</Node>{/snippet}
      <Node layout="column">{@render Vertex(v)}{@render VertexNumber()}</Node>
      {#each out[k] as w}<Link from={k} to={w} />{/each}
    {/each}
  </Node>
{/snippet}
{#snippet QueueLine()}<Node>queue {@render Queue(queue)}</Node>{/snippet}

{@render Graph()}
{@render QueueLine()}
{@render VertexRef(current)}
{@render VertexRef(@visit.look.next)}
```

```

```
