<!--
The Sverlin language guide. bot.server.ts sends this file to the assistant after the instructions
in assistant.md, with these HTML comments removed, so every other word here is model guidance.
Comments are notes for maintainers. guide.server.test.ts builds every complete example and checks
the documented Node and Link props and their named values against the compiler. Update this guide
in the same change as the language, the library props, or the drawn defaults.
-->

# The Sverlin language

A Sverlin component is one Svelte file that describes an algorithm/program
visualization. It records the steps of an algorithm or program and draws a view
of each step. A presentation is one build of the component from its own seed:
every presentation shows the same input and algorithm, with its own drawn design
values and drawn defaults. Participants compare presentations in pairs, so the
two presentations of a pair should differ in how they show the algorithm.

## Blocks

A component describes its visualization in `<script lang="sverlin">` blocks, written in a restricted subset of JavaScript (see The subset), followed by a script-free Svelte view. The algorithm block is required, even for a single step (`yield;`); the domain, input, and design blocks are optional.

1. `<script lang="sverlin" domain>`: the types: atomic types, and the collections, records, and unions built from them (see Atomic types, and Collections, records, and unions).
2. `<script lang="sverlin" input>`: the fixed starting data. Declare the initial state with `const` or `let`, such as `const values = Values([3, 8, 5]);` with `Values` defined in the domain block as a collection of `Int`; every value has a domain type.
3. `<script lang="sverlin">`: the algorithm. It starts from the input variables, may update them and declare more, and marks steps with `yield`. It runs once.
4. `<script lang="sverlin" design>`: choices drawn from each presentation's seed. Each top-level `const` is a design value (see Design values).

## View

The view is markup made only of `<Node>`, `<Link>`, and `<Pointed>` components, text inside nodes, and Svelte blocks and tags such as `{#if}`, `{#each}`, `{#snippet}`, `{@render}`, and `{@const}`. It has no `<script>` or `<style>` of its own, and no HTML or SVG elements: every visible thing is a node or a link, so participants can select it and presentations can vary it, and nodes are styled only through their props (see Node). Text belongs inside a node, such as `<Node>Linear search</Node>`. Every input and algorithm variable in scope at the selected step, every design value, `step`, `seed`, and the library components are already in scope; never write `import`, and never declare names `Node`, `Link`, or `Pointed`.

Draw every value of a domain type through a view of its type, as `{@render Int(target)}` (see Views of types), and every position through a pointer (see Pointers); the markup around them arranges, labels, and explains. For a value used more than once or too long to read inline, use `{@const name = expression}` as the first child of the nearest component or block, such as directly inside a `<Node>`, `{#if}`, or `{#each}`.

Facts about the algorithm, such as whether the target was found, are clearer recorded as algorithm variables the view reads; keep purely visual choices in the view and design block.

A node that writes text around nodes or views, with no `layout`, reads as a line of text: `<Node>Found {@render Int(target)} at index {@render Position(i)}.</Node>` sets the two views inline in the sentence, each its own size, and the line wraps between words, also when `{#if}` chooses the sentence. Drawing a value through its view this way, rather than as `{target}`, keeps it sized and styled like the value elsewhere.

## Views of types

A view is a snippet that draws one value of one domain type: its first parameter has that type, as in `{#snippet IntCard(value: Int)}<Node {value} shape="card" />{/snippet}`, and an optional second parameter, `node`, takes the props its caller sets. A view reads only its value, design values, and other views, never the input or algorithm variables, except a pointer (see Pointers): how two values relate is drawn where both are in scope, in the view that holds them or by a pointer. Define views at the top level of the markup.

A design value named after a type chooses its view: `const Int = pick([IntText, IntCard]);` draws one per presentation, and `const Int = IntCard;` fixes one. `{@render Int(value)}` draws a value with whichever was chosen. A view named after its type, `{#snippet Int(value: Int)}`, is that type's only view. Rendering a type nothing draws is an error. In the view, a type's name is its view, never a constructor: draw values the state holds, made in the input and algorithm blocks, and show a loop's own index, as `k` in `{#each list as v, k}`, as text, `{k}`.

A view of a collection or record draws its parts through their types' views:

```svelte
{#snippet Row(list: Values)}<Node layout="row">{#each list as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet VertexCard(v: Vertex)}<Node layout="column" shape="card">{@render Name(v.name)}{@render Flag(v.seen)}</Node>{/snippet}
{#snippet SeenText(seen: Flag)}<Node size="small" color="neutral">{seen ? 'seen' : 'new'}</Node>{/snippet}
```

Every view is measured with every value its type allows, so its box keeps one size whatever value it shows and nothing moves between steps; the page moves each value from where it was to where it is (see Steps); participants can select it; and presentations vary how it looks. Offer more than one view of a type where the request leaves its look open, so presentations differ in what they show as well as how it looks: a number as a cell, a card, or a circle, a flag as a word or a tick.

## Pointers

A view of a position type (`index(...)`) or reference type (`ref(...)`) can be a pointer: it holds one `<Pointed>`, which stands for the element the position points at, drawn with its own view, and the nodes around it, placed by layout, annotate it:

- a label below: `<Node layout="column"><Pointed /><Node size="small">i</Node></Node>`
- a bracket: `<Node layout="row"><Node>[</Node><Pointed /></Node>`
- a highlight alone: `<Pointed fill="amber" />`

`<Pointed>` takes `fill`, `stroke`, `strokeWidth`, `opacity`, `color`, `font`, `size`, `weight`, `padding`, `radius`, and `shape`, over the element's own; paint (fill, stroke, opacity, colour) shows only where the pointer is. Render a pointer at the top level of the markup, outside views and blocks other than `{#if}`, with a position from the state: a variable (`{@render Arrow(i)}`), an element, or a field (`{@render To(edges[e].to)}`). The page draws it around the element wherever the element is drawn. Every element keeps room for every pointer that can point into its collection, and a position a step shows past an end gets a slot there, so nothing moves as pointers move. Pointers at one element nest, the one rendered last outermost. A pointer whose position is out of scope, or points nowhere, draws nothing and keeps its room. Since it is drawn from the top level, a pointer view may read the input and algorithm variables, so its label or paint can follow the state, as `<Node layout="column"><Pointed fill={found ? "green" : "amber"} /><Node>{found ? "found" : "checking"}</Node></Node>`; to switch between pointers, render them in `{#if}`, as `{#if found}{@render Found(i)}{:else}{@render Checking(i)}{/if}`, and one whose branch is not taken draws nothing and keeps its room. A pointer at an element drawn as a link, such as the current edge, gives the link its `<Pointed>`'s stroke, width, and dashes.

Insertion sort, with the key drawn beside the row:

```svelte
<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
</script>

<script lang="sverlin" input>
  const values = Values([5, 2, 4, 1]);
</script>

<script lang="sverlin">
  for (let i = Position(1); i < values.length; i++) {
    const key = values[i];
    let j = i;
    yield;
    while (j > 0 && values[j - 1] > key) {
      values[j] = values[j - 1];
      j--;
      yield;
    }
    values[j] = key;
    yield;
  }
</script>

<script lang="sverlin" design>
  const Int = pick([IntCell, IntCard]);
  const shifting = pick(['amber', 'red', 'purple']);
</script>

{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet IntCard(value: Int)}<Node {value} shape="card" />{/snippet}
{#snippet Row(list: Values)}<Node layout="row">{#each list as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet Next(p: Position)}<Node layout="column"><Pointed /><Node size="small">i</Node></Node>{/snippet}
{#snippet Hole(p: Position)}<Node layout="column"><Pointed fill={shifting} /><Node size="small">j</Node></Node>{/snippet}

<Node>Insertion sort</Node>
<Node layout="row" gap="large" align="start">
  <Node>key {@render Int(key)}</Node>
  {@render Row(values)}
</Node>
{@render Next(i)}
{@render Hole(j)}
```

Between steps, the key leaves the row for its box, the larger values slide right, and the key drops into its place (see Steps). A reference follows its element as it moves: with `const Tracked = ref(Values);` and `const tracked = Tracked(values[3]);`, `{@render Follow(tracked)}` marks that value wherever the sort takes it.

## Steps

- `yield;` records a step: a copy of every variable in scope there, the input's, the top level's, and those of the loops and blocks around it, as `for (let j = i + 1; ...)` and `const key = values[i];` inside it. A variable out of scope at a step, before its declaration or after its block ends, is not part of it: whatever the view draws from it, a value or a pointer, draws nothing there and keeps its room, so nothing moves as it comes and goes. Declare a variable where it belongs rather than at the top level with a stand-in value such as -1. A name is declared once among the blocks in scope: a loop inside another cannot declare `j` again, while loops one after another can each have their own `j`.
- A step has no label or text: steps are numbered, and the view says what each one shows, from the recorded variables and `step` (0 for the first). Record what the view should say about a step, such as `let found = Found(false);` set when the search finds its target, so the view can show "Found" at that step.
- `return;` stops the algorithm early.
- Between steps, the page moves each value from where the step before drew it, so a swap shows as two values trading places: a value moved from one element to another, as through a temporary variable, is the same value. A variable the view draws, as insertion sort's `key`, holds a value while no collection does, so the value moves into it and back; while a collection also holds it, the variable shows a copy. A value copied to a second place, as `values[j] = values[j - 1]` or `merged.push(left[i])`, starts where its source was; a value written anew, as `values[i] = 0`, fades in; one no longer held fades out. Pointers slide from where they were. Links switch with the step.

## Atomic types

Give values meaning with atomic types. No types are predefined: define each one the request needs, including basic ones such as `Int`, in the domain block, each as a top-level `const`:

- a primitive kind: `'integer'` or `'number'` with both `min` and `max`, as in `const Int = type('integer', { min: 0, max: 99 });`, or `'boolean'`, as in `const Flag = type('boolean');`
- a refinement of a type defined earlier, with optional `unit`, `min`, and `max`: `const Height = type(Int, { unit: 'cm', min: 0, max: 250 });`
- an enumeration of allowed text or number values: `const Suit = type(['spades', 'hearts', 'diamonds', 'clubs']);`. Name the values plainly and leave how they look, such as `♠`, to its views (see Views of types). Text types are always enumerations.

Every type has a known, finite set of values, so the view can be drawn for each of them. Choose ranges that hold every value the algorithm reaches, such as a count up to the input's length. Positions (`index(...)`, below) need no range: their collection gives them one.

Create typed values with a type's name in the input or algorithm block, such as `const target = Int(8);`. Input and algorithm values all have domain types: every number, boolean, and text that a variable, collection element, or record field holds is a typed value, so a loop index is `let i = Index(-1);`, a flag `let found = Found(false);`, and a distance `Distance(0)`. There is no `null`: every variable starts with a value, and "nothing yet" is a value of a type that says so, such as `Index(-1)`, or a union member such as `Unreached('unreached')` (see Collections, records, and unions). Taking a value that is not there, such as `.pop()` of an empty collection, is an error. Define a type for each meaning, such as `Index`, `Distance`, or `Visited`, rather than reusing one general type.

A variable keeps the type it was made with, and a value assigned to it takes that type, as an element or field does: after `let found = Found(false);`, `found = values[i] === target` stores a `Found`, and after `let n = Count(0);`, `n = values.length` stores a `Count`, while `found = Count(1)` is an error. A variable made by a union, as in `let d = Dist(0);`, can hold any of its members. Plain literals can appear in expressions, as in `i + 1` or `x < 10`, but a new variable needs a type to hold a plain result: comparisons, `.length`, `.indexOf()`, and `Math` functions give plain values, so write `const n = Count(values.length);`.

Typed values behave like their plain values in comparisons, conditions, `===`, `.indexOf`, `.includes`, template strings, and indexing, and they keep their type as the algorithm moves them between variables and arrays. Arithmetic keeps types too: `Int + Int` is an `Int`; a refined type combined with the type it refines or with a plain number keeps the refined type (`Height(150) + 5` is a `Height`); an integer type whose result is no longer whole, such as `Int(7) / Int(2)`, gives an untyped number. A number enumeration keeps its type in arithmetic, and the result must be one of its values: with `const Weight = type([4, 5, 7]);`, `Weight(4) + 1` is the `Weight` 5, and `Weight(4) + Weight(4)` is an error, since 8 is not a `Weight`. To compute beyond a type's values, convert to another number type: `Distance(e.weight)` makes a `Distance` from a `Weight`. Combining or comparing unrelated types, such as a `Height` and a `Weight`, arithmetic on text enumerations or boolean types, and leaving a type's values, `min`, or `max` are errors. Type names cannot be used as variable names.

The view receives plain values; a value's type chooses the views that draw it (see Views of types).

## Collections, records, and unions

Every array and object in the input and algorithm is made by a type, defined in the domain block from types defined before it, each as a top-level `const`:

- a collection of elements of one type: `const Values = collection(Int);`, and a collection of collections for a grid: `const Grid = collection(Values);`
- a record with named fields: `const Edge = record({ from: Vertex, to: Vertex, weight: Weight });`
- a union, a value of one of several types, for a place that holds different kinds of value: `const Dist = union(Distance, Unreached);`
- a position in a collection, such as a loop index or a pointer: `const Index = index(Values);`
- a reference to an element of a collection of single values, which stays with it as it moves: `const Front = ref(Queue);`

Make one by calling its name, writing its contents as literals, which take their types from it: `Values([3, 8, 5])` holds three `Int`s, and `Edges([{ from: 0, to: 1, weight: 4 }])` holds one `Edge` whose fields are a `Vertex`, a `Vertex`, and a `Weight`. Values added to a collection or assigned to a record's field take its types in the same way: `queue.push(3)`, `dist[v] = 0`, `edge.weight = 5`. An array or object literal anywhere else is an error, so there are no plain arrays or objects. A record has exactly its fields: leaving one out, or reading or writing another, is an error. `.slice()` of a collection gives a collection of the same type.

A position is any whole number, and 0 to length - 1 point at an element of its collection; others point nowhere, as -1 before a search starts or the length after it ends, or the length + 1 after `i += 2`. Reading or writing an element outside the collection is an error, except that writing at the length adds one. A step can show a position at most 4 places past either end, where the view keeps room for it; the view keeps no room past an end that no step reaches. A variable is bound to its collection when it is declared: `let i = Index(-1);` points into the only `Values`, and with several, name the one, as in `let i = Index(left, 0);`. The binding stays with the variable, so `k = i + j` gives `k` a number and leaves it pointing into its own collection; a position stored in a record or collection, as in `record({ from: VertexRef, to: VertexRef })`, points into the only collection of its type.

A grid is a collection of collections, as `const Table = collection(Counts);`. To point at a cell, hold the row in a variable and point into it: `let row = paths[r];` is that row itself, not a copy, so `let c = ColIndex(row, 1);` points at a cell of `paths`, and its pointer views draw there. Assigning `row = paths[r];` again moves `c` to the new row.

A reference is made from an element, `const front = Front(queue[0]);`, and reads as it, as in `edge.from === front`. Where a position stays at its place as the collection changes, a reference stays with its element: after `queue.shift()` or a sort it is wherever the element went, and once the element has left the collection it refers to nothing, so its pointer views draw nothing and keep their room. A reference follows an element of a collection of its own type, even when the same value is also a field elsewhere, as an edge's end pushed onto the queue. Use a position to step to a neighbour: `front + 1` is the element's value plus one.

A union value is always one of its members: a literal becomes the member it fits, so `Distances([0, 'unreached'])` holds a `Distance` and an `Unreached`, and a literal that fits two members needs its type written, as in `Distance(4)`. Members compare with `===` and `!==`, where values of different members are unequal, but not with `<` or `>`; check which member a value is before ordering it:

```js
if (
  dist[e.from] !== Unreached('unreached') &&
  (dist[e.to] === Unreached('unreached') || dist[e.from] + Distance(e.weight) < dist[e.to])
)
  dist[e.to] = dist[e.from] + Distance(e.weight);
```

The view receives plain arrays and objects, drawn by the views of their types: a record's view draws its fields through theirs (see Views of types).

## Design values

- Draws are `pick(['row', 'grid'])`, `int(3, 6)` (inclusive), `real(0.5, 1.5)`, and `chance(0.3)`, each only in the value of a top-level `const`, either the whole value or inside its object and array literals, such as `const layout = pick(['row', 'grid']);` or `const look = { radius: pick(['medium', 'full']), sizes: [int(1, 3)] };`. Other design constants may combine earlier ones. A seed always draws the same values.
- Use design values for styling, layout, wording, and library component props. The input and algorithm cannot see them, so steps never depend on the seed.
- The design value `frame` shapes the page frame that holds the view's top-level nodes: a ratio such as `const frame = '4:3';`, or an object with any of `ratio` (`'16:9'`, the default, `'4:3'`, `'3:2'`, `'1:1'`, `'3:4'`, or `'9:16'`), `justify`, `align`, `padding` (default `'large'`), `layout` (`'column'`, `'row'`, or `'free'`), and `constraints` between top-level nodes by their `key`, as for a node's own (put `<Link>` components at the top of the view to join top-level nodes), and `layoutSeed` to keep a free top-level layout the participant liked, such as `const frame = { layout: 'free', constraints: ['note below cells'] };`. Unset `justify`, `align`, and `layout` are drawn (see Start unopinionated); leave `layout` unset.
- Design names must differ from input and algorithm names.

## The subset

- Allowed: numbers, strings, booleans, and the collections and records their types make; `if`, `for`, `for (const x of array)`, `while`, `do`, `break`, `continue`; arithmetic, comparison with `===`/`!==`, `&&`, `||`, `??`, `? :`, template strings, `+=` and `++`; `Math.abs/ceil/floor/max/min/pow/round/sign/sqrt/trunc`, `Math.PI`; array `.length`, `.push`, `.pop`, `.shift`, `.unshift`, `.slice`, `.indexOf`, `.includes`, `.reverse`, `.join`.
- Not allowed: `null` and `undefined`, functions of any kind, `new`, classes, `this`, `==`, string methods, other globals, the names `step` and `seed`, and array or object literals except inside a type or `.push`/`.unshift`, or assigned to an element or field. Write helper logic inline.
- Limits: 200 steps, 1,000,000 operations, 10,000 entries per array or object, and 10,000 characters per string.

## Library

Nodes say nothing about what a structure means by themselves: nodes laid out as a row can show an array, a list of linked nodes, a queue, or anything else. Decide the meaning from the participant's request, and when they leave it open, express the open choice as a drawn design value, so each presentation's seed can pick a different interpretation.

### Page frame

Every view sits in a page frame, a canvas laid out at a fixed logical size (1200 pixels wide) and scaled to fit, so every presentation renders identically whatever the pane size. It is 16:9 unless the design value `frame` sets another ratio; keep 16:9 unless the participant asks for another shape. Participants select nodes by clicking or dragging a box, to point at them in feedback; they scroll to zoom, drag with the middle button or with Space held to pan, and double-click empty space to reset, and the view is kept as they step through. Every node is selectable, so draw each thing a participant might want to point at, such as a cell, a pointer name, or a caption, as a node of its own. The page frame arranges the view's top-level nodes; place them with the design value `frame`, such as `const frame = { justify: 'between' };` to put a title at the top and a note at the bottom. Use the frame's width: lay sequences out across it rather than down it. Write the top-level nodes directly rather than wrapping the whole view in one node.

## Node

A node is one of three things:

- a value: `<Node value={7} />` shows a number, string, or boolean, as a view's own node does with its value;
- content: `<Node>any text or markup</Node>` shows its children, for titles, explanations, captions, indices, and pointer names, and with `layout` arranges them, as a view of a collection arranges its elements' views;
- a shape: `<Node shape="box" radius="full" fill="currentColor" stroke="none" padding="none" minSize={0.6} />` has no value or children, and draws only its box, for marks such as dots and bars; set the props that make the shape, since a drawn look can leave a box without a border or tint.

Titles and annotations are nodes too: `<Node>Linear search</Node>` makes a title, and arranging a node's children with `layout` puts an index, caption, or pointer name beside or above a value: `<Node layout="column">{@render Int(v)}<Node color="neutral">{k}</Node></Node>`. Without `layout`, children flow as ordinary text.

### Props

Props starting with `__` are reserved for the library. `shape` picks which of the presentation's drawn looks a node takes (see Start unopinionated), and every value that look sets can be overridden by the matching prop:

- `shape`: `'box'` (a cell: a drawn border, padding, fill, minimum size, and text size and weight; the default for a value), `'card'` (a surface with a drawn border, padding, and fill), or `'plain'` (no border, padding, or fill; the default for content). A bordered node with a layout draws its border around the whole group.

Arrangement:

- `layout`: `'row'`, `'column'`, `'grid'`, or `'free'` (placed by layout; see Free layout, links, and relations); arranges a node's children.
- `gap`: space between arranged items: `'none'`, `'small'`, `'medium'`, `'large'`, or a number of em.
- `align`: `'start'`, `'center'`, or `'end'`; how arranged items line up across the layout direction.
- `justify`: `'start'`, `'center'`, `'end'`, `'between'`, `'around'`, or `'evenly'`; how arranged items spread along the layout direction (default `'start'`).
- `columns`: the number of grid columns; defaults to a near-square grid.

Border and colour:

- `padding`: space between a node's border and its content: `'none'`, `'small'`, `'medium'`, `'large'`, or a number of em.
- `radius`: `'none'`, `'small'`, `'medium'`, or `'full'` (a circle for a short value, a pill for a long one). There is no circle shape: a circle is a bordered node with `radius="full"`, such as `<Node value="v1" radius="full" />` (a value is a box) or `<Node shape="box" radius="full">v1</Node>` (text written as children is plain, without a border, unless given a shape).
- `strokeWidth`: the border's width, `'none'`, `'thin'`, `'thick'`, or a number of pixels.
- `minSize`: `'none'`, `'small'`, `'medium'`, `'large'`, or a number of em; the smallest width and height.
- `fill` and `stroke`: background and border colours, each a palette name (`'neutral'`, `'blue'`, `'green'`, `'amber'`, `'red'`, `'purple'`; a light shade as a fill and a strong shade as a border) or any CSS colour. `stroke="none"` (or `stroke={false}`) turns the border off whatever its width. What a colour means, such as the element being examined or one already checked, is up to you; make it consistent within a visualization, and draw it in the design block when the request leaves it open.
- `opacity`: from 0 to 1, such as 0.4 to fade a node.

Text:

- `color`: a palette name (`'neutral'` is muted grey) or any CSS colour.
- `font`: `'sans'`, `'serif'`, or `'mono'`; nested nodes inherit it unless they set their own.
- `size`: `'small'`, `'medium'`, `'large'`, `'xlarge'`, or a number of rem such as `1.2`, so it can come from `pick([...])` or `real(0.9, 1.4)`; nested nodes scale with it.
- `weight`: `'normal'` or `'bold'`.

### Start unopinionated

Every prop a view leaves unset has a default, and these defaults are drawn, so they differ between presentations:

- on cells (`'box'`): radius, border width (sometimes none), padding, a pale fill and border tint (sometimes none), and text size and weight;
- on cards: radius, border width, padding, and tint;
- on every arrangement: the gap, and how rows and columns align their items;
- on the page: the font, and how the page frame spreads, aligns, and arranges the top-level nodes (a column in most presentations, a free arrangement in a few);
- in free layouts: the form, the positions, and the curves; on links: the width and the curve.

The tints stay pale so they never compete with the palette colours you give meaning. Other defaults are fixed, such as colours, opacity, a node's layout, and the size of content such as titles.

<!--
The drawing policy, with its options and weights, is defaultsPolicy in library/node/defaults.ts.
Tints keep low saturation and high lightness so they stay unlike the saturated palette colours
authors use for meaning, such as 'amber' for the current element; a quarter of presentations
draw no tint at all.
-->

A node's own props win over drawn defaults, so every prop you set takes a choice away from the presentations. Write the structure, and set only the props that carry meaning, such as a colour that shows which element is current; unset, drawn props vary more widely than a pick between a few values would. Draw meaningful colours in the design block from the palette, so which colour shows "current" varies while staying consistent within a presentation. Use design picks for choices the library does not draw, such as which annotation nodes to show. Which view draws a type is such a choice too: pick among views that show the value differently (see Views of types), so presentations differ in what they show as well as how it looks. When the participant asks for a consistent or plainer look, set the props that should stay the same; liking one presentation is not such a request.

Example, with domain, input, algorithm, design, and a script-free view:

```svelte
<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
</script>

<script lang="sverlin" input>
  const values = Values([3, 8, 5]);
</script>

<script lang="sverlin">
  yield;
  for (let i = Index(0); i < values.length; i++) {
    yield;
  }
</script>

<script lang="sverlin" design>
  const Int = pick([IntCell, IntCard, IntCircle]);
  const Index = IndexText;
  const showIndices = chance(0.5);
  const current = pick(['amber', 'red', 'purple']);
</script>

{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet IntCard(value: Int)}<Node {value} shape="card" />{/snippet}
{#snippet IntCircle(value: Int)}<Node {value} radius="full" />{/snippet}
{#snippet IndexText(i: Index)}<Node value={i} weight="bold" />{/snippet}
{#snippet Row(list: Values)}
  <Node layout="row">
    {#each list as v, k}
      <Node layout="column">
        {@render Int(v)}
        {#if showIndices}<Node color="neutral">{k}</Node>{/if}
      </Node>
    {/each}
  </Node>
{/snippet}
{#snippet Here(i: Index)}
  <Node layout="column"><Pointed fill={current} /><Node color="neutral">i</Node></Node>
{/snippet}

<Node>Array walk</Node>
{@render Row(values)}
{@render Here(i)}
<Node>{#if step === 0}Start at the left.{:else}Visiting index {@render Index(i)}.{/if}</Node>
```

## Free layout, links, and relations

`layout="free"` places a node's children by layout instead of in a line or grid: use it for linked structures such as linked lists, trees, and graphs, joined by `<Link>` components (see Link), and for groups whose arrangement is open, with or without links. The children are kept clear of each other and gathered compactly, starting from the presentation's seed. A node hugs its children whatever its layout.

- `key`: a name for a child that its parent's links and relations refer to, such as `<Node key="a" value={3} />`. Every direct child is placed, keyed or not; put content that belongs together, such as a value and its index, in one child node. A link attaches to the node its key names: give the key to the value inside a child, or to a child holding one value among labels (such as a value with an index above and a pointer name below), and the arrow meets the value, not the labels.
- `constraints`: an array of relations between children, each `'a relation b'`: `above`, `below`, `leftOf`, and `rightOf` place a directly above, below, left of, or right of b, centred on it and one gap away, and `sameRow` and `sameColumn` centre a and b on one horizontal or vertical line in either order. They work in free layouts, and in rows and columns as long as they agree with the line. Use relations for what the picture must show, such as a pointer label above its node or a caption below the structure, and leave the rest to the layout.
- `flow`: in a free layout, `'x'` or `'y'` makes arrows point rightwards or downwards, as for a list or a tree; only forms that run that way are drawn.
- `form`: the shape a free layout gives the structure its links make. The structure is read from the arrows present at every step (a link that comes and goes is drawn on top of it but does not change it): a path such as a linked list, a cycle, a tree, or a layered graph (acyclic, with nodes that have several parents). Any structure can lie along its reading order (a path in link order, a tree depth first, a layered graph each node after its parents) as `'line'`, `'snake'` (rows read back and forth), `'wave'`, `'arc'`, or `'scatter'` (free positions that keep each node near the next). A cycle can also take `'ring'`; a tree `'tree-down'`, `'tree-right'`, `'radial'`, or `'indented'`; a layered graph `'layers-down'` or `'layers-right'`. Unset, every presentation draws a form that suits the space it has and stretches it to fill that space, and arrows curve round other nodes and labels.
- `curve`: `'straight'` or `'curved'`, whether this node's arrows prefer to run straight or to curve; unset, each link draws its own.
- `layoutSeed`: keeps this node's layout of its children the same in every presentation. Each arrangement draws its shape, spacing, and curves from a seed of its own, which selections report with the element; when the participant likes a layout ("keep this layout but …"), set `layoutSeed` on the node that arranges it to the reported seed, and `form` to the reported form, so that layout stays while everything else still varies. Pin `curve` only if the participant names it.

Leave `form` unset (a pick between a few forms only narrows the draw), set `flow` only when asked, such as for a list that must run left to right, and draw which relations to include. A flow suits directed structures; an undirected graph has no flow, and its links are `directed={false}`.

```svelte
{#snippet NameCard(name: Name)}<Node value={name} shape="card" />{/snippet}
{#snippet Next(pair: Pair)}<Link from={pair.from} to={pair.to} />{/snippet}
<Node layout="free" flow="x">
  {#each names as name}{@render Name(name)}{/each}
  {#each next as pair}{@render Next(pair)}{/each}
  <Node key="head" size="small" color="neutral">head</Node>
  <Link from="head" to={first} />
</Node>
```

## Link

`<Link from={edge.from} to={edge.to} />` draws a line, by default an arrow, between two nodes: a position from the state names the node drawing the element it points at, and a key names a child keyed so, such as a label. Put links among the children of the node whose children they join, beside the nodes they connect, or in a view of an edge rendered there; they take no space, and the node lays its children out with them (a node with links and no `layout` is laid out freely). Each link is a component of its own, so a participant can select it and refer to it in feedback, just as they can a node. A pointer at an element drawn as a link, such as the edge being examined, gives the link its `<Pointed>`'s stroke, width, and dashes (see Pointers).

- `from` and `to`: positions from the state, as `edge.from`, or the keys of two nodes, or of nodes inside them (see `key` above).
- `directed`: `false` for a plain line instead of an arrow.
- `dashed`: `true` for a dashed line.
- `stroke`: the line's colour, a palette name or any CSS colour.
- `strokeWidth`: the line's width, `'thin'`, `'thick'`, or a number of pixels; unset, it is drawn.
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
  let queue = Queue([0]);
  vertices[0].seen = true;
  yield;
  while (queue.length > 0) {
    const current = VertexRef(queue.shift());
    yield;
    for (let e = EdgeIndex(0); e < edges.length; e++) {
      if (edges[e].from === current) {
        if (!vertices[edges[e].to].seen) {
          vertices[edges[e].to].seen = true;
          queue.push(edges[e].to);
        }
        yield;
      }
    }
  }
</script>

<script lang="sverlin" design>
  const Name = NameText;
  const Flag = pick([SeenWord, SeenMark]);
  const VertexRef = RefCard;
</script>

{#snippet NameText(name: Name)}<Node value={name} weight="bold" />{/snippet}
{#snippet SeenWord(seen: Flag)}<Node size="small" color="neutral">{seen ? 'seen' : 'new'}</Node>{/snippet}
{#snippet SeenMark(seen: Flag)}<Node size="small">{seen ? '✓' : '·'}</Node>{/snippet}
{#snippet RefCard(v: VertexRef)}<Node value={v} shape="card" />{/snippet}
{#snippet VertexCard(v: Vertex)}<Node layout="column" shape="card">{@render Name(v.name)}{@render Flag(v.seen)}</Node>{/snippet}
{#snippet Arrow(edge: Edge)}<Link from={edge.from} to={edge.to} />{/snippet}
{#snippet QueueRow(q: Queue)}<Node layout="row">{#each q as v}{@render VertexRef(v)}{/each}</Node>{/snippet}
{#snippet Visiting(c: VertexRef)}<Pointed fill="amber" />{/snippet}
{#snippet Examining(e: EdgeIndex)}<Pointed stroke="red" strokeWidth="thick" />{/snippet}

<Node layout="free">
  {#each vertices as v, k}
    <Node layout="column">{@render VertexCard(v)}<Node size="small" color="neutral">{k}</Node></Node>
  {/each}
  {#each edges as edge}{@render Arrow(edge)}{/each}
</Node>
<Node>queue {@render QueueRow(queue)}</Node>
{@render Visiting(current)}
{@render Examining(e)}
```
