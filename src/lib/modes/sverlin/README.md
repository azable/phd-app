<!--
The Sverlin language guide. bot.server.ts sends this file to the assistant after the instructions
in assistant.md, with these HTML comments removed, so every other word here is model guidance.
Comments are notes for maintainers. guide.server.test.ts builds every complete example and checks
the documented Node and Link props and their named values against the compiler. Update this guide
in the same change as the language, the library props, or the design space's options.
-->

# The Sverlin language

A Sverlin component is one Svelte file that describes an algorithm/program
visualization. It records the steps of an algorithm or program and draws a view
of each step. The markup says what is drawn; how it looks is the design: every
look of every kind of node is a variable the compiler finds in the markup. A
presentation is one variant of the component: every presentation shows the same
input and algorithm, with its own value for every variable. Participants compare
presentations in pairs, so the two presentations of a pair should differ in how
they show the algorithm.

## Blocks

A component describes its visualization in `<script lang="sverlin">` blocks, written in a restricted subset of JavaScript (see The subset), followed by a script-free Svelte view. The algorithm block is required; the domain and input blocks are optional.

1. `<script lang="sverlin" domain>`: the types: atomic types, and the collections, records, and unions built from them, and the operators the algorithm computes with (see Atomic types, Collections, records, and unions, and Operators).
2. `<script lang="sverlin" input>`: the fixed starting data. Declare the initial state with `const` or `let`, such as `const values = Values([3, 8, 5]);` with `Values` defined in the domain block as a collection of `Int`; every value has a domain type.
3. `<script lang="sverlin">`: the algorithm. It starts from the input variables, may update them and declare more, may declare functions (see Loops and functions), and labels the code its steps are about (see Steps). It runs once.

There is no design block: what presentations differ in is the design space (see Design).

## View

The view is markup made only of `<Node>`, `<Link>`, and `<Pointed>` components, a `<Listing />` of the algorithm (see Listing), text inside nodes, and Svelte blocks and tags such as `{#if}`, `{#each}`, `{#snippet}`, `{@render}`, and `{@const}`. It has no `<script>` or `<style>` of its own, and no HTML or SVG elements: every visible thing is a node or a link, so participants can select it and presentations can vary it. Nodes take no props that set a look: a node's kind is the snippet it is in, and the design gives each kind its look (see Design). The top level of the markup holds only renders, with `{#if}` and `{#each}` around them, and a `<Listing />`, so every node is in a snippet. A snippet without parameters is a part of the page, as `{#snippet Title()}<Node>Linear search</Node>{/snippet}`, drawn where the top level renders it, `{@render Title()}`; a part reads what the top level reads, renders other parts, views, and operators, and writes its text inside its nodes. Every input and algorithm variable in scope at the selected step, `step`, `seed`, and the library components are already in scope; never write `import`, and never declare names `Node`, `Link`, `Pointed`, or `Listing`.

Draw every value of a domain type through a view of its type, as `{@render Int(target)}` (see Views of types), and every position through a pointer (see Pointers); the markup around them arranges, labels, and explains. For a value used more than once or too long to read inline, use `{@const name = expression}` as the first child of the nearest component or block, such as directly inside a `<Node>`, `{#if}`, or `{#each}`.

Facts about the algorithm, such as where the target was found, are clearer recorded as algorithm variables the view reads, as the position a search returns; how anything looks is the design's, never the algorithm's.

A node that writes text around nodes or views, with no `layout`, reads as a line of text: `<Node>Found {@render Int(target)} at index {@render Position(i)}.</Node>` sets the two views inline in the sentence, each its own size, and the line wraps between words, also when `{#if}` chooses the sentence. Drawing a value through its view this way, rather than as `{target}`, keeps it sized and looking like the value elsewhere.

## Views of types

A view is a snippet that draws one value of one domain type: its one parameter has that type, as in `{#snippet IntCell(value: Int)}<Node {value} />{/snippet}`, and the node showing that value, as `<Node {value} />` does, shows the type's unit too. A view reads only its value and other views, never the input or algorithm variables, except a pointer (see Pointers): how two values relate is drawn where both are in scope, in the view that holds them or by a pointer. Define views at the top level of the markup.

A type is drawn by its name: `{@render Int(value)}` draws whichever view of `Int` the variant chooses, the variable `views.Int`, whose options are every view of `Int`, and `none`, which draws nothing. Name views after how they draw, as `IntCell` or `IntTally`: a view named after its type, `{#snippet Int(value: Int)}`, is an error, as it would leave nothing to choose. Which view draws a value is a look, the variant's, so a value is always rendered through its type: rendering a view by its own name, as `{@render IntCell(value)}`, is an error naming the fix, and one render is drawn apart through its place (see Places). Views differ in what they draw: two views that would differ only in their look, such as a cell and a round cell, are one view, the look the design's. Rendering a type no view draws is an error. In the view, a type's name is its view, never a constructor: draw values the state holds, made in the input and algorithm blocks, and show a loop's own index, as `k` in `{#each list as v, k}`, as text, `{k}`.

A view of a collection or record draws its parts through their types' views:

```svelte
{#snippet Items(list: Values)}<Node>{#each list as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet VertexCard(v: Vertex)}<Node layout="column">{@render Name(v.name)}{@render Flag(v.seen)}</Node>{/snippet}
{#snippet SeenText(seen: Flag)}<Node>{seen ? 'seen' : 'new'}</Node>{/snippet}
```

A node whose only child is an `{#each}`, as in `Items`, holds a collection: its items sit on equal tracks, as large as the largest, so they line up evenly; they run as a row unless the node sets `layout`, and a collection inside another runs across it, so a collection of collections draws rows in a column or columns in a row. Put a title or caption for the collection in a node around it, not beside the `{#each}`.

Every view is measured with every value its type allows, so its box keeps one size whatever value it shows and nothing moves between steps; the page moves each value from where it was to where it is (see Steps); participants can select it; and presentations vary how it looks. Offer more than one view of a type where the request leaves open what it shows, so presentations differ in what they draw as well as how it looks: a number as a cell or as a tally beside it, a flag as a word or a tick.

## Pointers

A view of a position type (`index(...)`) or reference type (`ref(...)`) can be a pointer: it holds one `<Pointed>`, which stands for the element the position points at, drawn with its own view, and the nodes around it, placed by layout, annotate it:

- a label below: `<Node layout="column"><Pointed />{@render IName()}</Node>`, with `{#snippet IName()}<Node>i</Node>{/snippet}` written in the view, so the label is a kind of its own
- a bracket: `<Node layout="row"><Node>[</Node><Pointed /></Node>`
- a mark alone: `<Pointed />`

`<Pointed>` takes no props: while the pointer is at it, the element is drawn in the pointer's kind, its view's name and `.Pointed`, so `Here.Pointed.fill` is the fill of the element `Here` points at. Write it in the pointer view itself, not in a snippet inside it. Its paint (fill, stroke, opacity, text colour) shows only where the pointer is, and the rest of its look holds in every slot, so every slot keeps one size. Render a pointer at the top level of the markup, outside snippets and blocks other than `{#if}`, with a position from the state: a variable (`{@render Index(i)}`), an element, or a field (`{@render Index(edges[e].to)}`). A position type draws as where it is rendered calls for: outside any node, as `{@render Index(i)}`, a mark, through its pointer views (`pointers.Index`), so every mark of it looks the same; inside a node, as `<Node>at {@render Index(i)}</Node>`, its number, through its other views (`views.Index`); each is a choice of its own. The page draws it around the element wherever the element is drawn. Every element keeps room for every pointer that can point into its collection, and a position a step shows past an end gets a slot there, so nothing moves as pointers move. Pointers at one element nest, the one rendered last outermost. A pointer whose position is out of scope, or points nowhere, draws nothing and keeps its room. Since it is drawn from the top level, a pointer view may read the input and algorithm variables, so its label can follow the state, as `<Node>{done ? 'last' : 'next'}</Node>`; one rendered in `{#if}` whose branch is not taken draws nothing and keeps its room. A pointer at an element drawn as a link, such as the current edge, gives the link its kind's stroke and width.

Insertion sort, with the key drawn beside the row:

```svelte
<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Flag = type('boolean');

  // walking the collection
  const Length = unop((v: Values) => Position(v.length));
  const Before = binop((a: Position, b: Position) => Flag(a < b));
  const Next = unop((p: Position) => Position(p + 1));
  const Prev = unop((p: Position) => Position(p - 1));

  // what the algorithm does
  const Greater = binop((a: Int, b: Int) => Flag(a > b));
</script>

<script lang="sverlin" input>
  const values = Values([5, 2, 4, 1]);
</script>

<script lang="sverlin">
  for (let i = Position(1); Before(i, Length(values)); i = Next(i)) @insert{
    @pick[const key = values[i];
    let j = i;]
    @shift[while (Before(Position(0), j) && Greater(values[Prev(j)], key)) {
      values[j] = values[Prev(j)];
      j = Prev(j);
    }]
    @place[values[j] = key;]
  }
</script>

{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Items(list: Values)}<Node>{#each list as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet Mark(p: Position)}<Pointed />{/snippet}
{#snippet Bracket(p: Position)}<Node layout="row"><Node>[</Node><Pointed /></Node>{/snippet}
{#snippet Title()}<Node>Insertion sort</Node>{/snippet}
{#snippet Key()}<Node>key {@render Int(key)}</Node>{/snippet}
{#snippet Board()}<Node layout="row">{@render Key()}{@render Values(values)}</Node>{/snippet}

{@render Title()}
{@render Board()}
{@render Position(i)}
{@render Position(j)}
```

Both marks are drawn by the view `pointers.Position` chooses, `Mark` to start, so they look alike; a variant draws one apart through its place, as `Mark.Pointed@j.fill` colouring the hole, or `pointers.Position@j` drawing it with `Bracket` (see Places). Each step inserts one key: it is copied into its box, the larger values slide right, and the key drops into its place; with `frames` set to `insert.*`, each of these is a step of its own (see Steps). A reference follows its element as it moves: with `const Tracked = ref(Values);` and `const tracked = Tracked(values[3]);`, `{@render Tracked(tracked)}` marks that value wherever the sort takes it.

## Steps

- A step is a run of the code a label marks. Write the label around the code: `@name[…]` around a statement, statements in a row, or an expression, as `@place[values[j] = key;]` or `while (@test[Before(Position(0), j) && Greater(values[Prev(j)], key)])`, or `@name{` on a block the code already has, a loop's, an `if`'s, or a function's body, as `for (…) @insert{`. A name is one word, without dots. The algorithm runs as if the marks were spaces. Each time the code runs is a step, shown as a change: the page shows the state just before the code, then moves to the state just after it. A labelled loop steps once per pass, its test leading up to the pass.
- A label inside another takes its name as a prefix: `@shift[…]` inside `@insert{` is `insert.shift`. Once the algorithm, a label, or a function's body has labelled statements, every statement in it is inside one of them or contains one, so each step is one label's code and only loops' headers and tests run between steps; a statement left out is an error naming the labels beside it. Declarations leading a block, before its first labelled statement, need no label: as `let min = i;` at the top of `@select{`, they run leading up to its first step. A label on part of a statement, as `@test[…]`, asks nothing of the code around it. An algorithm with no labels has one step, its end, for a picture that does not move.
- The variable `frames` says what a presentation steps at: `*`, each label at the top, which the starter takes, offered only where there are several (with one, its own name is the first option); a label's name, as `insert.shift`, each run of its code; or `insert.*`, each run of a label inside `insert`. A variant keeps it unless the participant asks for another, and presentations stepping by different rules step together, one holding its step while the other shows the code between. What runs after the last step is a step of its own when it changes a value still in scope, declares one, or applies an operator, so the end of the algorithm is shown; variables only leaving scope, as a loop's at its exit, make no step.
- Every presentation opens on the input as given, step 0, before any of the algorithm runs: what the algorithm declares, its labels' values, and its operators' applications appear from the first step on, and the view reads a variable itself only inside a <Node>, which is hidden until it is declared.
- A step's code stops where it calls one of the algorithm's functions with steps of its own, whose steps follow, so `function search(a, target, lo, hi) @call{ … }` steps once per call, recursive calls included.
- Each step records every variable in scope, before its code and after it: the input's, the top level's, and those of the loops and blocks around it, as `for (let j = Next(i); ...)` and `const key = values[i];` inside it. A variable out of scope at a step, before its declaration or after its block ends, is not part of it: whatever the view draws from it, a value or a pointer, is missing there (see `shown` in Design). Declare a variable where it belongs rather than at the top level with a stand-in value such as -1. A variable a step's code declares is out of scope before it, so the view draws it through a view or a pointer; the first step is shown only after its code. A name is declared once among the blocks in scope: a loop inside another cannot declare `j` again, while loops one after another can each have their own `j`.
- A step has no label or text: steps are numbered, and the view says what each one shows, from the recorded variables and `step` (0 for the first). Record what the view should say about a step in the algorithm's variables: an answer, as the position a search finds, is the value its function returns, drawn with a view of its own, as `{@render Index(found)}` in binary search below.
- `return;` stops the algorithm early.
- Between steps, the page moves each value from where the step before drew it, so a swap shows as two values trading places: a value moved from one element to another, as through a temporary variable, is the same value. A variable holding a value a collection also holds shows a copy of it, as insertion sort's `key` when it is picked up, and the copy keeps its place once the collection's is overwritten, so the key moves back into the row when it is put down. A value copied to a second place, as `values[j] = values[Prev(j)]` or `Merge(merged, Append(merged, left[i]))`, starts where its source was, as do the operands a view of an operator draws, each from the cell or variable it was read from, so a comparison's values lift out of their cells into its caption (a computed operand, as `Add(a, b)` given to another, fades in); a value written anew, as `values[i] = 0`, fades in; one no longer held fades out. Pointers slide from where they were. Links switch with the step.

## Loops and functions

The algorithm's loops and branches are JavaScript's: `for`, `for (const v of values)`, `while`, `do ... while`, `if` and `else`, `break`, and `continue`.

A function is declared at the top level of the algorithm block, as `function search(a, target) { ... }`, and sees only its parameters: give it the collections it works on, and it changes them in place. Each call gives its parameters values of the types the first call gave them. `return i;` gives a value back, and a position into a collection the call was given points into the caller's. A function may call itself. A step inside a call records the call's variables, its parameters among them, and the top level's; the caller's are out of scope there, so with recursion a step shows the innermost call's `lo` and `hi`. A parameter hides a top-level variable of the same name. A position into a collection the call was given is drawn on that collection wherever the view draws it under its top-level name.

Binary search, written recursively:

```svelte
<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');

  // walking the collection
  const After = binop((a: Index, b: Index) => Flag(a > b));
  const Middle = binop((a: Index, b: Index) => Index(Math.floor((a + b) / 2)));
  const Next = unop((p: Index) => Index(p + 1));
  const Prev = unop((p: Index) => Index(p - 1));
  const Last = unop((v: Values) => Index(v.length - 1));

  // what the algorithm does
  const Equal = binop((a: Int, b: Int) => Flag(a === b));
  const Less = binop((a: Int, b: Int) => Flag(a < b));
</script>

<script lang="sverlin" input>
  const values = Values([2, 5, 8, 12, 16, 23, 38]);
  const target = Int(23);
</script>

<script lang="sverlin">
  function search(a, target, lo, hi) @call{
    if (After(lo, hi)) return Index(-1);
    const mid = Middle(lo, hi);
    if (Equal(a[mid], target)) return mid;
    if (Less(a[mid], target)) return search(a, target, Next(mid), hi);
    return search(a, target, lo, Prev(mid));
  }
  const found = search(values, target, Index(0), Last(values));
</script>

{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet IndexText(p: Index)}<Node value={p} />{/snippet}
{#snippet Highlight(p: Index)}<Pointed />{/snippet}
{#snippet Title()}<Node>Binary search for {@render Int(target)}</Node>{/snippet}
{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet Bounds()}<Node>lo {@render Index(lo)}, hi {@render Index(hi)}</Node>{/snippet}

{@render Title()}
{@render Cells()}
{@render Bounds()}
{@render Index(mid)}
{@render Index(found)}
```

In `Bounds`, inside a node, `lo` and `hi` are drawn as numbers by `IndexText`; at the top level, `mid` and the answer are marks drawn by `Highlight`, which a variant colours apart at `@found`.

## Atomic types

Give values meaning with atomic types. No types are predefined: define each one the request needs, including basic ones such as `Int`, in the domain block, each as a top-level `const`:

- a primitive kind: `'integer'` or `'number'` with both `min` and `max`, as in `const Int = type('integer', { min: 0, max: 99 });`, or `'boolean'`, as in `const Flag = type('boolean');`
- a refinement of a type defined earlier, with optional `unit`, `min`, and `max`: `const Height = type(Int, { unit: 'cm', min: 0, max: 250 });`
- an enumeration of allowed text or number values: `const Suit = type(['spades', 'hearts', 'diamonds', 'clubs']);`. Name the values plainly and leave how they look, such as `♠`, to its views (see Views of types). Text types are always enumerations.

Every type has a known, finite set of values, so the view can be drawn for each of them. Choose ranges that hold every value the algorithm reaches, such as a count up to the input's length. Positions (`index(...)`, below) need no range: their collection gives them one.

Create typed values with a type's name in the input or algorithm block, such as `const target = Int(8);`. Input and algorithm values all have domain types: every number, boolean, and text that a variable, collection element, or record field holds is a typed value, so a loop index is `let i = Index(-1);`, a flag `let found = Found(false);`, and a distance `Distance(0)`. There is no `null`: every variable starts with a value, and "nothing yet" is a value of a type that says so, such as `Index(-1)`, or a union member such as `Unreached('unreached')` (see Collections, records, and unions). Reading a value that is not there, such as `queue[0]` of an empty queue, is an error. Define a type for each meaning, such as `Index`, `Distance`, or `Visited`, rather than reusing one general type.

A variable keeps the type it was made with, and a value assigned to it takes that type, as an element or field does: after `let found = Found(false);`, `found = true` and `found = Equal(values[i], target)` store a `Found`, while `found = Count(1)` is an error. A variable made by a union, as in `let d = Dist(0);`, can hold any of its members. The input and algorithm compute nothing themselves: comparisons, arithmetic, `.length`, and `Math` are operators the domain declares (see Operators), each giving a typed value.

Typed values keep their type as the algorithm moves them between variables and arrays, and read as their plain values in conditions and indexing. Inside an operator's function, they behave like their plain values in comparisons and `===`, and arithmetic keeps types: `Int + Int` is an `Int`; a refined type combined with the type it refines or with a plain number keeps the refined type (`Height(150) + 5` is a `Height`); an integer type whose result is no longer whole, such as `Int(7) / Int(2)`, gives an untyped number. A number enumeration keeps its type in arithmetic, and the result must be one of its values: with `const Weight = type([4, 5, 7]);`, `Weight(4) + 1` is the `Weight` 5, and `Weight(4) + Weight(4)` is an error, since 8 is not a `Weight`. To compute beyond a type's values, convert to another number type: `Distance(e.weight)` makes a `Distance` from a `Weight`. Combining or comparing unrelated types, such as a `Height` and a `Weight`, arithmetic on text enumerations or boolean types, and leaving a type's values, `min`, or `max` are errors. Type names cannot be used as variable names.

The view receives plain values; a value's type chooses the views that draw it (see Views of types).

## Collections, records, and unions

Every array and object in the input and algorithm is made by a type, defined in the domain block from other types, in any order, each as a top-level `const`:

- a collection of elements of one type: `const Values = collection(Int);`, and a collection of collections for a table of rows: `const Grid = collection(Values);`
- a record with named fields: `const Edge = record({ from: Vertex, to: Vertex, weight: Weight });`
- a union, a value of one of several types, for a place that holds different kinds of value: `const Dist = union(Distance, Unreached);`
- a position in a collection, such as a loop index or a pointer: `const Index = index(Values);`
- a reference to an element of a collection of single values, which stays with it as it moves: `const Front = ref(Queue);`, or to a node of a record type, wherever it is: `const NodeRef = ref(ListNode);` (see Nodes and references)

Make one by calling its name, writing its contents as literals, which take their types from it: `Values([3, 8, 5])` holds three `Int`s, and `Edges([{ from: 0, to: 1, weight: 4 }])` holds one `Edge` whose fields are a `Vertex`, a `Vertex`, and a `Weight`. Values written into an element or a field take its types in the same way: `dist[v] = 0`, `edge.weight = 5`; a literal given to an operator takes the operand's type, as `queue = Append(queue, 3)`. An array or object literal anywhere else is an error, so there are no plain arrays or objects. A record has exactly its fields: leaving one out, or reading or writing another, is an error. `.slice()` of a collection gives a collection of the same type.

A position is any whole number, and 0 to length - 1 point at an element of its collection; others point nowhere, as -1 before a search starts or the length after it ends, or the length + 1 after `i = Skip(i)`. Reading or writing an element outside the collection is an error, except that writing at the length adds one. The view keeps room past an end for the positions its pointers draw, as far as they go and at most 4 places, so a pointer further out draws nothing; a position nothing draws keeps none. A variable is bound to its collection when it is declared: `let i = Index(-1);` points into the only `Values`, and with several, name the one, as in `let i = Index(left, 0);`. The binding stays with the variable, so `Move(k, Sum(i, j))` gives `k` a number and leaves it pointing into its own collection. A position stored in a record or collection keeps the collection it came from: `Take({ from: j })` points into `right` when `j` does, as does `Next(i)` when `i` does, and `const at = take.from;` declares `at` pointing there too. A number stored there, as in `Edges([{ from: 0, to: 1 }])`, points into the only collection of its type, and with several, name the one, as in `Take({ from: Index(left, 0) })`.

A grid is a collection of collections, as `const Table = collection(Counts);`. To point at a cell, hold the row in a variable and point into it: `let row = paths[r];` is that row itself, not a copy, so `let c = ColIndex(row, 1);` points at a cell of `paths`, and its pointer views draw there. Changing `row` to another row, as `NextRow(row, paths[r])`, moves `c` to the new row.

A reference is made from an element, `const front = Front(queue[0]);`, and reads as it, as in `Same(edge.from, front)`. Where a position stays at its place as the collection changes, a reference stays with its element: after `queue = Rest(queue)` or a sort it is wherever the element went, and once the element has left the collection it refers to nothing, so its pointer views draw nothing and keep their room. A reference follows an element of a collection of its own type, even when the same value is also a field elsewhere, as an edge's end pushed onto the queue. Use a position to step to a neighbour.

A union value is always one of its members: a literal becomes the member it fits, so `Distances([0, 'unreached'])` holds a `Distance` and an `Unreached`, and a literal that fits two members needs its type written, as in `Distance(4)`. Inside an operator's function, members compare with `===` and `!==`, where values of different members are unequal, but not with `<` or `>`; check which member a value is before ordering it:

```js
// domain
const Reached = unop((d: Dist) => Flag(d !== 'unreached'));
const Through = binop((d: Dist, w: Weight) => Distance(d + Distance(w)));
const Shorter = binop((a: Distance, b: Dist) => Flag(b === 'unreached' || a < b));
```

```js
// algorithm
if (Reached(dist[e.from]) && Shorter(Through(dist[e.from], e.weight), dist[e.to]))
  dist[e.to] = Through(dist[e.from], e.weight);
```

The view receives plain arrays and objects, drawn by the views of their types: a record's view draws its fields through theirs (see Views of types).

## Nodes and references

A node of a linked list, a tree, or a graph is a record referring to others of its kind, as `struct Node { char name; struct Node *next; }` in C. A reference to a record type, `ref(ListNode)`, is that pointer: it refers to a node wherever it is, and always to one. "No node" is a value of a type of its own, joined to the reference with a union, so a field that may end says so, and the end is drawn and varied as any value is. A record holding itself other than through a reference or an index would never end, and is refused. A list given in the input and reversed:

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
{@render NodeRef(cur)}
```

- `NodeRef(ListNode({ … }))` refers to a new node, as the input writes a list, nested or a variable for each node; the algorithm makes one through a structural operator, as `const NewNode = binop((v: Name, n: Next) => ListNode({ name: v, next: n }));` and `head = NodeRef(NewNode(v, head))` to push one in front. A cycle is the algorithm's to make.
- A field is read and written through a reference, `cur.next`, `cur.next = prev`; a value of another type written into a field is refused, and reading or writing one through the end is a mistake at that step ("cur is an End ("end"), so it has no next"). A variable that holds a node or the end is made with the union, `let cur = Next(head);`, as a variable keeps the type it was made with.
- A node lives while something refers to it: a variable in scope, a collection, or a live node. `all(ListNode)` is every live node, in the order they were made, drawn as a collection is, each through the record's view; a node no longer referred to leaves it and fades out, and a node keeps its identity as its links change, so it stays put. A step records a reference as its node's place there, so a circular list stays finite. At most 64 nodes of a type are live at once.
- `<Link to={n.next} />` with no `from`, in a view of a node, leaves the node it sits in, and the free layout around the nodes lays it out. Draw a node as fields, as a textbook does, `[ A | next ]`, or a tree's `[ left | key | right ]`: a node holding only such links is a field, a box as a value is, its own snippet so it has its own look (`NodeBox.NextField`); the arrow leaves the field, arcing over its node where it points back, and meets the value of the node it points at. A tree's children are placed in the order their links leave it, so the left field's child is on the left. Where `n.next` is the end, the link draws the end in its field with its type's view (`views.End`, as `EndMark`'s ∅), which a variant can switch or leave out. A pointer view of the reference, as `Here`, marks the node a variable refers to, and draws nothing at the end.
- An array-based structure keeps an index instead, `index(Nodes)`, where the position is the point.

## Operators

The input and algorithm compute nothing themselves: everything they compute is an operator the domain declares, unary or binary: a function of its operands, each parameter typed, as `(a: Int, b: Int) => Flag(a > b)`. Type annotations are written only there. Writing stays plain: `=` puts a value, typically an operator's result, into a variable, an element, or a field.

```js
// walking the collection
const Length = unop((v: Values) => Index(v.length));
const Before = binop((a: Index, b: Index) => Flag(a < b));
const Next = unop((p: Index) => Index(p + 1));

// what the algorithm does
const Equal = binop((a: Int, b: Int) => Flag(a === b));
const Add = binop((a: Int, b: Int) => Int(a + b));
```

The algorithm applies an operator as a call, its operands in order, each taking its operand's type as a function's argument does, and gets the value its function gives: `if (Equal(values[i], target)) break;`, `total = Add(total, v);`, `for (let i = Index(0); Before(i, Length(values)); i = Next(i))`. Name operators for what they compute, as `Before`, `Middle`, or `Shorter`, and declare each the algorithm needs, those that walk the collection apart from what the algorithm does, as above.

A collection's methods compute too: an operator computes the new collection, and `=` writes it, in place, so the collection and each element it keeps stay the same values and move rather than reappear:

```js
const Append = binop((q: Queue, v: Vertex) => Queue([...q, v]));
const Rest = unop((q: Queue) => Queue(q.slice(1)));
```

`queue = Append(queue, v);` adds `v` at the back, and `const u = queue[0]; queue = Rest(queue);` takes the front. A rearrangement is plain writes, labelled as one step, as a swap through a temporary: `@swap[const moved = values[i]; values[i] = values[Next(i)]; values[Next(i)] = moved;]` moves both values.

Use `for (const v of values)` where a loop only reads the values and the view points at none of them, as a sum, and an index loop where the position matters: a pointer, a write back, a neighbour, or a position as the result.

- Raw: control flow (`if`, loops, `break`, `continue`, `return`, the algorithm's functions, `? :`, `&&`, `||`, `??`), declarations, writes with `=` (to a variable declared with `let`, an element, or a field), reading elements and fields, and typed values from literals, as `Index(0)`, `Index(-1)`, or `Flag(true)`.
- Declared as operators: every operator on values, as `<`, `===`, `+`, `!`, and `-x`; `++`, `--`, and `+=`; `.length`; `Math`; template strings; and collection methods, as `.push`, `.shift`, `.indexOf`, or `.slice`. Each written raw is an error naming the declaration to add and what to write.
- An operator changes nothing, so an application whose result is unused, as `Append(served, front);` or a `for` update `Next(i)`, is an error naming the write: `served = Append(served, front)`.
- An operator giving a collection or record only rearranges its operands: each element or field it builds is an operand, a read of one or of its parts (`v[p]`, `e.to`), or a spread of one or of a slice of one (`...q`, `...q.slice(1)`), as `Queue([...q, x])` or `Edge({ from: e.to, to: e.from })`. A new element, computed or literal, is refused, as in `Values([...v.slice(0, p), Int(v[p] + 1), ...v.slice(p + 1)])`: compute it with a value operator and write it, `values[p] = Inc(values[p])`, or pass it in as an operand. A collection filled at run time is built in a loop: `for (const v of vertices) dist = Append(dist, unreached);`.
- An operator is one primitive step, one a learner takes as a single action (compare, add, take the next position, append), never a loop or a library algorithm: a merge by `Values([...a, ...b].sort(…))` is refused, as `sort` is an algorithm, and merging is written out in the algorithm block. Its function is one expression of its operands, reading only them and `Math`, without braces, nested functions, other operators, methods outside the subset, or the state, and changing nothing, where JavaScript's operators and the collection methods work on typed values as described under Atomic types. It gives a typed value: wrap what it computes in a type, as `Flag(a > b)`, which is the operator's result type.

## Views of what a step computed

An operator is a type a view can take: `{#snippet Ask(g: Greater)}` is a view of an application of `Greater`, its operands named by the operator's parameters (`g.a`, `g.b`) and its result `g.value`, each drawn through its type's view. `{@render Greater()}` in the root or a part of the page, with nothing between the brackets, draws the application of `Greater` a step's own code made, the code its label marks, not what leads up to it, through the view `views.Greater` chooses. A step that made none, or several, draws nothing there, keeping its room, so a whole sweep (`frames` at `*`) shows no comparison while each comparison step shows its own. Bubble sort, the comparison labelled so that, at `sweep.pair.*`, each comparison and each swap is a step:

```svelte
<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = collection(Int);
  const Index = index(Values);

  // walking the collection
  const Length = unop((v: Values) => Index(v.length));
  const Before = binop((a: Index, b: Index) => Flag(a < b));
  const Next = unop((p: Index) => Index(p + 1));
  const Prev = unop((p: Index) => Index(p - 1));

  // what the algorithm does
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
{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet Board()}<Node layout="column">{@render Cells()}<Node>{@render Greater()}</Node></Node>{/snippet}

{@render Board()}
```

At a comparison step the caption reads "is 5 > 1? yes"; at the swap after it, nothing. An operator is rendered only from the root and its parts, with nothing between the brackets; one the input never applies, as binary search's `Left` when the target is always to the right, is left out. An operand cannot be called `value`, which names the result. A view named as an operator is, as a pointer view called `Next`, is drawn through its type, like any view. `{@render Greater(@pair)}` draws only the application made inside the code labelled `@pair`, where an operator is applied in more than one place.

A label is read in the root and its parts as a value: `@name` is the value the expression labelled `name` gave in the step's own code, drawn at the step's after where it gave one, and missing where it gave none or several. So a view shows what a step's code held, though no variable holds it at the step's edges: the values a swap exchanged, or the key a whole insertion inserts, out of scope once its block ends.

```js
for (let i = Index(1); Before(i, Length(values)); i = Next(i)) @insert{
  const key = @key[values[i]];
  // the shifting and placing, as above
}
```

```svelte
{#snippet Inserting()}<Node>inserting {@render Int(@insert.key)}</Node>{/snippet}
```

A name may be written as its shortest ending that names one label (`@key` for `@insert.key`), and a label named exactly as written wins over one whose name only ends so (`@check` is `check`, not `check.check`); one naming none or several is a problem listing them. Only a label on an expression gives a value, as `const key = @key[values[i]];`, not one on a statement. A label giving a position is drawn by a pointer, as `{@render Index(@check.at)}`, pointing while that code runs. Labels are read only in the root and its parts, never in a view.

To mark what a step used, label it and render the position's type at each label, so every mark looks the same, here drawn by `Highlight`, a pointer view named for how it marks.

```js
if (Greater(values[@left[Prev(i)]], values[@right[i]])) @swap{ … }
```

```svelte
{#snippet Highlight(p: Index)}<Pointed />{/snippet}
{@render Index(@left)}
{@render Index(@right)}
```

A label gives a value only where its code ran, `&&` skipping it included, so the marks come and go with the comparison; and it marks the position however the value is then used, read from its cell, copied into a variable, or compared in a loop's test. The labels say what a mark means, so render the type at each label rather than a view per mark, and mark with a label rather than a loop variable (`@right`, not `i`) where the mark is what the step used, not where the loop is. A label added for a mark leaves `frames` as it is: it marks within a step, and makes no step of its own.

What has happened so far is a list, drawn with `{#each}`: `runs(@check.at)`, every value the label has given up to this step, and `applied(Equal)`, every application of `Equal` so far (`applied(Equal, @check)`, those made inside `@check`). A pointer for each of a label's positions marks the cells a search has checked, and an operator's view draws each application:

```svelte
{#snippet Checked(p: Index)}<Pointed />{/snippet}
{#snippet Asked()}<Node>{#each applied(Equal) as e}{@render Equal(e)}{/each}</Node>{/snippet}
{#each runs(@check.at) as p}{@render Index(p)}{/each}
{@render Asked()}
```

A `for … of` variable refers to the element it is at, as a reference does: with `const At = ref(Digits);` and a pointer view of `At`, `{@render At(v)}` marks the cell `v` is at in `for (const v of digits)`, with no index.

## Design

The design space is every variable of a component's look, found in its markup:

- `views.Int`, for each type rendered by name: its views and `none` (see Views of types).
- `pointers.Index`, for each position type rendered by name as a pointer: its pointer views and `none` (see Pointers).
- The page frame's: `frame.ratio`, `frame.justify`, `frame.align`, `frame.padding`, `frame.gap`, and `frame.layout` (see Page frame).
- Each kind of node's props. A kind is the snippet a node is in: a view's or a part's name, as `Items` or `Title`, and for a snippet inside another, both, as `IntTally.Tally`; every node of a snippet is of its kind. A pointer view's `<Pointed>` is a kind of its own, as `Here.Pointed`, and so is a snippet's `<Link>`, as `Graph.Link`. A variable is its kind and prop, as `Here.Pointed.fill` or `Items.Under.shown`.
- Each place's own, for a render with an argument (see Places).

A snippet's name is its kind, so it names what its nodes are, never how they look: `Caption`, `Visited`, `Under`, not `Amber` or `Big`. Each snippet has a name of its own, a part is not named as a type, and a render names a part, a type, or an operator, so every kind is known before the view runs.

Every kind of node has these props, each with a fixed set of options:

- `shown`: whether its nodes are drawn at all; one left out takes its children with it and keeps no room. A render is missing where its view is `none` or not shown, or it draws a value absent: for a whole presentation it is left out, keeping no room, and at one step hidden, keeping its room so nothing moves. A node holding only text and renders is one statement: one missing takes the node, so `<Node>swap {@render Int(@swap.a)} and {@render Int(@swap.b)}</Node>` hides whole at a step that swaps nothing. A node holding other nodes has parts, each node and each render in it: in `<Node layout="row"><Node>lo {@render Index(lo)}</Node><Node>mid {@render Index(mid)}</Node></Node>` only the `mid` part hides while `mid` is out of scope, a column holding the array and `{@render Greater()}` loses only the caption, and such a node goes only with all its parts; a part of the page rendered in it counts as its nodes do. Split a sentence into parts to keep what is there. A node holding no render, as a title, stays. A `<Pointed>` kind has none: to drop a pointer, leave out a node around its `<Pointed>`, give its type's view `none`, or render it in `{#if}`; the elements it would point at are then drawn as without it.
- `fill` and `stroke`: `none` or a colour.
- `color`: the text's colour.
- `strokeWidth`: 0, 0.5, 1, 1.5, 2, 3, or 4 pixels.
- `strokeStyle`: its border solid, dashed, or dotted (dashed suits a place rather than a value).
- `opacity`: 0.25, 0.5, 0.75, or 1.
- `font`: sans, serif, or mono.
- `size`: the text's size, 0.75, 0.875, 1, 1.125, 1.25, 1.5, or 2 rem.
- `weight`: normal or bold.
- `padding`: 0, 0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, or 2 em.
- `radius`: 0, 2, 4, 6, 8, or 12 pixels, or 999 for a circle or pill.
- `minSize`: the least width and height, 0, 1, 1.5, 2, 2.5, 3, or 4 em.

A kind that arranges its children, with a `layout`, a collection, or links, also has `gap` (as `padding`), `align` (start, center, or end, across the layout), and `justify` (start, center, end, between, around, or evenly, along it). Where a collection's node has more room than its items' tracks need, as when every render of a view keeps the widest box any of them reaches, `justify` start, center, or end puts the room after, around, or before them, and between, around, or evenly spreads the tracks over it. Positions past a collection's ends are drawn in end slots beside it, kept only as far as the drawn positions go: a collection's kind has `overflow`, included (its end slots are tracks of its box) or excluded (they hang outside its box, so centring it centres its elements); a `<Pointed>` kind has `overflow` too, shown (drawn past the ends) or hidden (drawing nothing there, keeping no room). A link's kind has `shown`, `stroke`, `strokeWidth`, `opacity`, `strokeStyle`, and `color` for its label. The colours are white, black, and 18 hues (neutral, red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink, and rose) in 11 shades from 50, the lightest, to 950, the darkest, as `blue-600`.

### Places

A render with an argument is a place, named by what is written there after `@`: a label, a variable, or a field, as `{@render Index(@left)}` at `@left`, `{@render Index(found)}` at `@found`, and `{@render Int(g.a)}` in `Ask` at `Ask.` and `@g.a`. A render of another expression, or with nothing between the brackets, is none. Rendering a type keeps the page uniform, every render drawn by the view its type's variable chooses, in its kinds' looks; a place has variables of its own that fall back to those until a variant sets them, so one render is drawn apart with nothing declared:

- its own choice of view, where its type has more than one view of the kind it draws, as `pointers.Index@found` or `views.Int@swap.held`;
- its own `shown`, `fill`, `stroke`, and `color` for the kinds of each view it can draw, nested snippets included, as `Highlight.Pointed@left.fill` or `IntTally.Tally@swap.held.shown`, though not for another view that view renders.

```json
{
  "pointers.Index": "Highlight",
  "pointers.Index@found": "Arrow",
  "Highlight.Pointed.fill": "amber-100",
  "Highlight.Pointed@left.fill": "sky-100",
  "IntCell@swap.held.fill": "neutral-100"
}
```

In a key the last part is the prop, and the dots after `@` the place's. A label and a variable rendered by one type with one name would share a place, which is an error: rename the label.

### Variants

A variant gives every variable a value, and a presentation draws one. The first presentation of a source draws the starter: each type in its first view, and each kind in a plain look for what it is: values framed, text and layouts unframed, and pointers marked in amber. Other variants are chosen: the assistant chooses values with `vary`, the participant's Another variant randomises them, keeping which variables share a value, each colour's shade, and what is shown, and a presentation built after a change to the source keeps the values of the one it was made from. Only free layouts are drawn from the presentation's seed (see Free layout, links, and relations).

### Declare what varies

The markup decides what can vary, so write it so the choices worth comparing are variables:

- Draw everything that means something of its own in a snippet of its own, so its look is a variable of its own: a title, a caption, an index, a pointer's label. A snippet without parameters draws it: at the top level, a part of the page; inside a view, a part of it that sees the view's value, as `{#snippet Under()}<Node>{k}</Node>{/snippet}` inside the `{#each}` of `Items`.
- Draw what the state means with views of its own: an answer, as the position a search finds, is the value its function returns, drawn by a pointer of its own (see Loops and functions), and a mark meaning something else at some steps is another pointer, rendered in `{#if}`, so a found element can look different from a checked one.
- Offer more than one view of a type where the request leaves open what it shows (see Views of types).
- Give each annotation, such as the indices under the cells, its own snippet, so a variant can leave it out.

Never write a look into the markup: when the participant asks for one, it is the values of a kind.

Example, with domain, input, algorithm, and a script-free view:

```svelte
<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');
  const Length = unop((v: Values) => Index(v.length));
  const Before = binop((a: Index, b: Index) => Flag(a < b));
  const Next = unop((p: Index) => Index(p + 1));
</script>

<script lang="sverlin" input>
  const values = Values([3, 8, 5]);
</script>

<script lang="sverlin">
  for (let i = Index(0); Before(i, Length(values)); i = Next(i)) @visit{}
</script>

{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet IntTally(value: Int)}
  {#snippet Tally()}<Node>{'•'.repeat(value)}</Node>{/snippet}
  <Node layout="column"><Node {value} />{@render Tally()}</Node>
{/snippet}
{#snippet IndexText(i: Index)}<Node value={i} />{/snippet}
{#snippet Items(list: Values)}
  <Node>
    {#each list as v, k}
      {#snippet Under()}<Node>{k}</Node>{/snippet}
      <Node layout="column">
        {@render Int(v)}
        {@render Under()}
      </Node>
    {/each}
  </Node>
{/snippet}
{#snippet Here(i: Index)}
  {#snippet IName()}<Node>i</Node>{/snippet}
  <Node layout="column"><Pointed />{@render IName()}</Node>
{/snippet}
{#snippet Title()}<Node>Array walk</Node>{/snippet}
{#snippet Status()}<Node>Visiting index {@render Index(i)}.</Node>{/snippet}

{@render Title()}
{@render Values(values)}
{@render Index(i)}
{@render Status()}
```

## The subset

- Allowed: numbers, strings, booleans, and the collections and records their types make; `if`, `for`, `for (const x of array)`, `while`, `do ... while`, `break`, `continue`, and functions at the top level of the algorithm block (see Loops and functions); `&&`, `||`, `??`, and `? :`; writes with `=`; and the operators the domain declares (see Operators), whose functions may use JavaScript's operators, template strings, `.length`, the collection methods (`[...c, x]`, `.slice`, `.indexOf`, `.includes`, `.join`), and `Math.abs/ceil/floor/max/min/pow/round/sign/sqrt/trunc` and `Math.PI`.
- Not allowed: `null` and `undefined`, other functions, such as arrow functions outside an operator and functions inside blocks, `new`, classes, `this`, `==`, string methods, other globals, the names `step` and `seed`, and array or object literals except inside a type or `.push`/`.unshift`, or assigned to an element or field.
- Limits: 200 steps, 1,000,000 operations, 10,000 entries per array or object, and 10,000 characters per string.

## Library

Nodes say nothing about what a structure means by themselves: nodes laid out as a row can show an array, a list of linked nodes, a queue, or anything else. Decide the meaning from the participant's request, and when they leave it open, offer views that draw each reading, so variants can show different interpretations.

### Page frame

Every view sits in a page frame, a canvas laid out at a fixed logical size (1200 pixels wide) and scaled to fit, so every presentation renders identically whatever the pane size. Its ratio is the variable `frame.ratio` (16:9, 4:3, 3:2, 1:1, 3:4, or 9:16), 16:9 in the starter; keep 16:9 unless the participant asks for another shape. Participants select nodes by clicking or dragging a box, to point at them in feedback; they scroll to zoom, drag with the middle button or with Space held to pan, and double-click empty space to reset, and the view is kept as they step through. Every node is selectable, so draw each thing a participant might want to point at, such as a cell, a pointer name, or a caption, as a node of its own. The page frame stacks what the top level renders in a column or a row (`frame.layout`), `frame.gap` apart, spread and aligned by `frame.justify` and `frame.align`, as between to put a title at the top and a note at the bottom, with `frame.padding` inside its edge. To place nodes freely, relate them, or join them with links, put them in a `<Node layout="free">` (see Free layout, links, and relations). Use the frame's width: lay sequences out across it rather than down it. Render the parts of the page at the top level rather than one part holding the whole view.

### Listing

`<Listing />` shows a text of the algorithm beside the view, such as the code or pseudocode the participant knows or a textbook's, exactly as written, lighting what each step ran: the text of the step's latest event most strongly, and the rest of what ran since the step before more faintly. Place it outside views, at the top level or in a part of the page, as `<Node layout="row"><Listing /><Node layout="column">…</Node></Node>`; it takes no props or children, and each of its lines is a node participants can select.

Write the text in a `<script lang="sverlin" listing="textbook">` block, with any name but none; a source may have several, and the variable `listing.language` chooses which one a presentation shows, the first in the starter, or `none`; a variant keeps it unless the participant asks for another. The lit text's fills are `listing.current.fill` and `listing.earlier.fill`. Mark each part of the text that should light as a region with the algorithm's labels, written as they are there (see Steps): `@name[text]`, nested as finely as needed, as `while @test[@bound[j > 0] and @cmp[A[j] > key]]`, a region inside another taking its name as a prefix, so the names line up with the algorithm's. A `[` without a name, as in `A[i]`, is text, and the marks are not shown. The code inside a labelled part lights it too; a region lights without the regions inside it that did not run, so once `j > 0` fails, `A[j] > key` stays dark. Every region must have a label, and a label without a region only marks steps; the context's listingMaps says what each region is mapped to and whether a step lights it.

Insertion sort, beside a textbook's pseudocode:

```svelte
<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Flag = type('boolean');

  // walking the collection
  const Length = unop((v: Values) => Position(v.length));
  const Before = binop((a: Position, b: Position) => Flag(a < b));
  const Next = unop((p: Position) => Position(p + 1));
  const Prev = unop((p: Position) => Position(p - 1));

  // what the algorithm does
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
{#snippet Next(p: Position)}
  {#snippet IName()}<Node>i</Node>{/snippet}
  <Node layout="column"><Pointed />{@render IName()}</Node>
{/snippet}
{#snippet Hole(p: Position)}
  {#snippet JName()}<Node>j</Node>{/snippet}
  <Node layout="column"><Pointed />{@render JName()}</Node>
{/snippet}
{#snippet Title()}<Node>Insertion sort</Node>{/snippet}
{#snippet Key()}<Node>key {@render Int(key)}</Node>{/snippet}
{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet Board()}
  <Node layout="row">
    <Listing />
    <Node layout="column">{@render Key()}{@render Cells()}</Node>
  </Node>
{/snippet}

{@render Title()}
{@render Board()}
{@render Position(i)}
{@render Position(j)}
```

## Node

A node is one of three things:

- a value: `<Node value={7} />` shows a number, string, or boolean, as a view's own node does with its value;
- content: `<Node>any text or markup</Node>` shows its children, for titles, explanations, captions, indices, and pointer names, and with `layout` arranges them, as a view of a collection arranges its elements' views;
- a shape: `<Node />` has no value or children, and draws only its box, for marks such as dots, sized by its kind's padding and least size.

Titles and annotations are nodes too: `{#snippet Title()}<Node>Linear search</Node>{/snippet}` makes a title, and arranging a node's children with `layout` puts an index, caption, or pointer name beside or above a value: `<Node layout="column">{@render Int(v)}{@render Under()}</Node>`, with `{#snippet Under()}<Node>{k}</Node>{/snippet}` in the `{#each}`. Without `layout`, children flow as ordinary text.

### Props

A node's props say what it is and how its children are arranged; its look is its kind's (see Design). Props starting with `__` are reserved for the library.

- `value`: the number, string, or boolean a value node shows.
- `layout`: `'row'`, `'column'`, or `'free'` (placed by layout; see Free layout, links, and relations); arranges a node's children.

## Free layout, links, and relations

`layout="free"` places a node's children by layout instead of in a line: use it for linked structures such as linked lists, trees, and graphs, joined by `<Link>` components (see Link), and for groups whose arrangement is open, with or without links. The children are kept clear of each other and gathered compactly, starting from the presentation's seed. A node hugs its children whatever its layout.

- `key`: a name for a child that its parent's links and relations refer to, such as `<Node key="a" value={3} />`. Every direct child is placed, keyed or not; put content that belongs together, such as a value and its index, in one child node. A link attaches to the node its key names: give the key to the value inside a child, or to a child holding one value among labels (such as a value with an index above and a pointer name below), and the arrow meets the value, not the labels.
- `constraints`: an array of relations between children, each `'a relation b'`: `above`, `below`, `leftOf`, and `rightOf` place a directly above, below, left of, or right of b, centred on it and one gap away, and `sameRow` and `sameColumn` centre a and b on one horizontal or vertical line in either order. They work in free layouts, and in rows and columns as long as they agree with the line. Use relations for what the picture must show, such as a pointer label above its node or a caption below the structure, and leave the rest to the layout.
- `flow`: in a free layout, `'x'` or `'y'` makes arrows point rightwards or downwards, as for a list or a tree; only forms that run that way are drawn.
- `form`: the shape a free layout gives the structure its links make. The structure is read from the arrows present at every step (a link that comes and goes is drawn on top of it but does not change it): a path such as a linked list, a cycle, a tree, or a layered graph (acyclic, with nodes that have several parents). Any structure can lie along its reading order (a path in link order, a tree depth first, a layered graph each node after its parents) as `'line'`, `'snake'` (rows read back and forth), `'wave'`, `'arc'`, or `'scatter'` (free positions that keep each node near the next). A cycle can also take `'ring'`; a tree `'tree-down'`, `'tree-right'`, `'radial'`, or `'indented'`; a layered graph `'layers-down'` or `'layers-right'`. Unset, every presentation draws a form that suits the space it has and stretches it to fill that space, and arrows curve round other nodes and labels.
- `curve`: `'straight'` or `'curved'`, whether this node's arrows prefer to run straight or to curve; unset, each link draws its own.
- `layoutSeed`: keeps this node's layout of its children the same in every presentation. Each arrangement draws its shape, spacing, and curves from a seed of its own, which selections report with the element; when the participant likes a layout ("keep this layout but …"), set `layoutSeed` on the node that arranges it to the reported seed, and `form` to the reported form, so that layout stays while everything else still varies. Pin `curve` only if the participant names it.

Leave `form` unset, set `flow` only when asked, such as for a list that must run left to right, and offer views with different relations where they are open. A flow suits directed structures; an undirected graph has no flow, and its links are `directed={false}`.

```svelte
{#snippet NameCard(name: Name)}<Node value={name} />{/snippet}
{#snippet Next(pair: Pair)}<Link from={pair.from} to={pair.to} />{/snippet}
{#snippet List()}
  {#snippet Head()}<Node key="head">head</Node>{/snippet}
  <Node layout="free" flow="x">
    {#each names as name}{@render Name(name)}{/each}
    {#each next as pair}{@render Pair(pair)}{/each}
    {@render Head()}
    <Link from="head" to={first} />
  </Node>
{/snippet}
{@render List()}
```

## Link

`<Link from={edge.from} to={edge.to} />` draws a line, by default an arrow, between two nodes: a position from the state names the node drawing the element it points at, and a key names a child keyed so, such as a label. Put links among the children of the node whose children they join, beside the nodes they connect, or in a view of an edge rendered there; they take no space, and the node lays its children out with them (a node with links and no `layout` is laid out freely). Each link is a component of its own, so a participant can select it and refer to it in feedback, just as they can a node. Its look, its line's colour, width, opacity, and dashes and its label's colour, is its kind's (see Design); a link in `Arrow` is of kind `Arrow.Link`. A pointer at an element drawn as a link, such as the edge being examined, gives the link its kind's stroke and width (see Pointers).

- `from` and `to`: positions from the state, as `edge.from`, or the keys of two nodes, or of nodes inside them (see `key` above). In a view of an element, a link with no `from` starts at the node drawing that element, as a node's `next` (see Nodes and references).
- `directed`: `false` for a plain line instead of an arrow.
- `label`: a short text shown at the middle of the link, such as `next` or `head`.
- `curve`: `'straight'` or `'curved'` for this link alone; unset, it draws its own, whatever its siblings do.
- `bend`: an exact curve, how far the link bows to one side as a fraction of its length (`0` straight, `0.3` a clear arc, negative the other side). A selected link reports the bend it drew; when the participant likes a curve, set `bend` on that `<Link>` to the reported value.

Links can come and go with the steps: wrap one in `{#if}` to show it only while it matters, such as the pointer being followed. Its place is kept across the animation, so nothing moves when it appears.

Breadth-first search, with the vertex being visited and the edge being examined marked in the graph:

```svelte
<script lang="sverlin" domain>
  const Name = type(['A', 'B', 'C', 'D', 'E']);
  const Flag = type('boolean');
  const Vertex = record({ name: Name, seen: Flag });
  const Vertices = collection(Vertex);
  const VertexRef = index(Vertices);
  const Edge = record({ from: VertexRef, to: VertexRef });
  const Edges = collection(Edge);
  const EdgeIndex = index(Edges);
  const Queue = collection(VertexRef);

  // walking the edges
  const Count = unop((es: Edges) => EdgeIndex(es.length));
  const Before = binop((a: EdgeIndex, b: EdgeIndex) => Flag(a < b));
  const Next = unop((e: EdgeIndex) => EdgeIndex(e + 1));

  // what the algorithm does
  const Waiting = unop((q: Queue) => Flag(q.length > 0));
  const Same = binop((a: VertexRef, b: VertexRef) => Flag(a === b));
  const Not = unop((f: Flag) => Flag(!f));
  const Append = binop((q: Queue, v: VertexRef) => Queue([...q, v]));
  const Rest = unop((q: Queue) => Queue(q.slice(1)));
</script>

<script lang="sverlin" input>
  const vertices = Vertices([
    { name: 'A', seen: false },
    { name: 'B', seen: false },
    { name: 'C', seen: false },
    { name: 'D', seen: false },
    { name: 'E', seen: false }
  ]);
  const edges = Edges([
    { from: 0, to: 1 },
    { from: 0, to: 2 },
    { from: 1, to: 3 },
    { from: 2, to: 3 },
    { from: 3, to: 4 }
  ]);
</script>

<script lang="sverlin">
  @start[let queue = Queue([0]);
  vertices[0].seen = true;]
  while (Waiting(queue)) @visit{
    @take[const current = queue[0];
    queue = Rest(queue);]
    for (let e = EdgeIndex(0); Before(e, Count(edges)); e = Next(e)) @edge{
      if (Same(edges[e].from, current)) {
        if (Not(vertices[edges[e].to].seen)) {
          vertices[edges[e].to].seen = true;
          queue = Append(queue, edges[e].to);
        }
      }
    }
  }
</script>

{#snippet NameText(name: Name)}<Node value={name} />{/snippet}
{#snippet SeenWord(seen: Flag)}<Node>{seen ? 'seen' : 'new'}</Node>{/snippet}
{#snippet SeenMark(seen: Flag)}<Node>{seen ? '✓' : '·'}</Node>{/snippet}
{#snippet RefCard(v: VertexRef)}<Node value={v} />{/snippet}
{#snippet VertexCard(v: Vertex)}<Node layout="column">{@render Name(v.name)}{@render Flag(v.seen)}</Node>{/snippet}
{#snippet Arrow(edge: Edge)}<Link from={edge.from} to={edge.to} />{/snippet}
{#snippet QueueItems(q: Queue)}<Node>{#each q as v}{@render VertexRef(v)}{/each}</Node>{/snippet}
{#snippet Visiting(c: VertexRef)}<Pointed />{/snippet}
{#snippet Examining(e: EdgeIndex)}<Pointed />{/snippet}
{#snippet Graph()}
  <Node layout="free">
    {#each vertices as v, k}
      {#snippet VertexNumber()}<Node>{k}</Node>{/snippet}
      <Node layout="column">{@render Vertex(v)}{@render VertexNumber()}</Node>
    {/each}
    {#each edges as edge}{@render Edge(edge)}{/each}
  </Node>
{/snippet}
{#snippet QueueLine()}<Node>queue {@render Queue(queue)}</Node>{/snippet}

{@render Graph()}
{@render QueueLine()}
{@render VertexRef(current)}
{@render EdgeIndex(e)}
```
