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

A component describes its visualization in `<script lang="sverlin">` blocks, written in a restricted subset of JavaScript (see The subset), followed by a script-free Svelte view. The algorithm block is required, even for a single step (`yield 'Start';`); the domain, input, and design blocks are optional.

1. `<script lang="sverlin" domain>`: the types: atomic types, and the collections, records, and unions built from them (see Atomic types, and Collections, records, and unions).
2. `<script lang="sverlin" input>`: the fixed starting data. Declare the initial state with `const` or `let`, such as `const values = Values([3, 8, 5]);` with `Values` defined in the domain block as a collection of `Int`; every value has a domain type.
3. `<script lang="sverlin">`: the algorithm. It starts from the input variables, may update them and declare more, and marks steps with `yield`. It runs once.
4. `<script lang="sverlin" design>`: choices drawn from each presentation's seed. Each top-level `const` is a design value (see Design values).

## View

The view is markup made only of `<Node>` and `<Link>` components, text inside nodes, and Svelte blocks and tags such as `{#if}`, `{#each}`, `{#snippet}`, and `{@const}`. It has no `<script>` or `<style>` of its own, and no HTML or SVG elements: every visible thing is a node or a link, so participants can select it and presentations can vary it, and nodes are styled only through their props (see Node). Text belongs inside a node, such as `<Node>Linear search</Node>`. Every top-level input and algorithm variable (as it was at the selected step), every design value, `step`, `seed`, and the library components `Node` and `Link` are already in scope; never write `import`, and never declare names `Node` or `Link`. Markup uses them directly: `{values[i]}`, `<Node items={values} layout={flow} />`.

Compute everything inline in markup. Svelte re-evaluates template expressions whenever the values they read change, so inline derivations stay correct. For a value used more than once or too long to read inline, use `{@const name = expression}` as the first child of the nearest component or block, such as directly inside a `<Node>`, `{#if}`, or `{#each}`:

```svelte
<Node layout="column" align="start">
  {@const current = i >= 0 && i < values.length ? values[i] : null}
  <Node items={values}>
    {#snippet item(value, index)}
      <Node
        {value}
        fill={index === i ? 'amber' : undefined}
        stroke={index === i ? 'amber' : undefined}
      />
    {/snippet}
  </Node>
  <Node>{current === null ? 'Not started' : `Checking ${current}`}</Node>
</Node>
```

Facts about the algorithm, such as which cells were checked, are often clearer recorded as algorithm variables; keep purely visual choices in the view and design block.

## Steps

- `yield 'label';` records a step: a copy of every top-level input and algorithm variable. Variables declared inside loops or blocks are not recorded; declare a loop index at the top level (`let i = Index(-1);`) and write `for (i = Index(0); ...)` when the view needs it. A top-level variable not yet declared at a step is `null`.
- Labels identify steps when presentations are compared, so make each one say what distinguishes its step; a repeated label is numbered by its occurrence, as in "Shift (2)", which reads less clearly. Inside loops, include what distinguishes the step, such as ``yield `Compare index ${i}`;``.
- `return;` stops the algorithm early.

## Atomic types

Give values meaning with atomic types. No types are predefined: define each one the request needs, including basic ones such as `Int`, in the domain block, each as a top-level `const`:

- a primitive kind, `'integer'`, `'number'`, `'boolean'`, or `'text'`: `const Int = type('integer');`
- a refinement of a type defined earlier, with optional `unit`, `min`, and `max`: `const Height = type(Int, { unit: 'cm', min: 0 });`
- an enumeration of allowed text or number values: `const Suit = type(['spades', 'hearts', 'diamonds', 'clubs']);`. Name the values plainly and leave how they look, such as `♠`, to the view (see Type renderers).

Create typed values with a type's name in the input or algorithm block, such as `const target = Int(8);`. Input and algorithm values all have domain types: every number, boolean, and text that a variable, collection element, or record field holds is a typed value, or `null` for nothing yet, so a loop index is `let i = Index(-1);`, a flag `let found = Found(false);`, and a distance `Distance(0)`. Define a type for each meaning, such as `Index`, `Distance`, or `Visited`, rather than reusing one general type. Plain literals can still appear in expressions, as in `i + 1` or `x < 10`, but storing a plain result is an error: comparisons, `.length`, `.indexOf()`, and `Math` functions give plain values, so wrap a result to keep it, as in `found = Found(values[i] === target)` or `n = Count(values.length)`.

Typed values behave like their plain values in comparisons, conditions, `===`, `.indexOf`, `.includes`, template strings, and indexing, and they keep their type as the algorithm moves them between variables and arrays. Arithmetic keeps types too: `Int + Int` is an `Int`; a refined type combined with the type it refines or with a plain number keeps the refined type (`Height(150) + 5` is a `Height`); an integer type whose result is no longer whole, such as `Int(7) / Int(2)`, gives an untyped number. A number enumeration keeps its type in arithmetic, and the result must be one of its values: with `const Weight = type([4, 5, 7]);`, `Weight(4) + 1` is the `Weight` 5, and `Weight(4) + Weight(4)` is an error, since 8 is not a `Weight`. To compute beyond a type's values, convert to another number type: `Distance(e.weight)` makes a `Distance` from a `Weight`. Combining or comparing unrelated types, such as a `Height` and a `Weight`, arithmetic on text enumerations or boolean types, and leaving a type's values, `min`, or `max` are errors. Type names cannot be used as variable names.

The view receives plain values; types only affect how nodes are drawn (see Type renderers).

## Collections, records, and unions

Every array and object in the input and algorithm is made by a type, defined in the domain block from types defined before it, each as a top-level `const`:

- a collection of elements of one type: `const Values = collection(Int);`, and a collection of collections for a grid: `const Grid = collection(Values);`
- a record with named fields: `const Edge = record({ from: Vertex, to: Vertex, weight: Weight });`
- a union, a value of one of several types, for a place that holds different kinds of value: `const Dist = union(Distance, Unreached);`

Make one by calling its name, writing its contents as literals, which take their types from it: `Values([3, 8, 5])` holds three `Int`s, and `Edges([{ from: 0, to: 1, weight: 4 }])` holds one `Edge` whose fields are a `Vertex`, a `Vertex`, and a `Weight`. Values added to a collection or assigned to a record's field take its types in the same way: `queue.push(3)`, `dist[v] = 0`, `edge.weight = 5`. An array or object literal anywhere else is an error, so there are no plain arrays or objects. A record has exactly its fields: leaving one out, or reading or writing another, is an error. `.slice()` of a collection gives a collection of the same type.

A union value is always one of its members: a literal becomes the member it fits, so `Distances([0, 'unreached'])` holds a `Distance` and an `Unreached`, and a literal that fits two members needs its type written, as in `Distance(4)`. Members compare with `===` and `!==`, where values of different members are unequal, but not with `<` or `>`; check which member a value is before ordering it:

```js
if (
  dist[e.from] !== Unreached('unreached') &&
  (dist[e.to] === Unreached('unreached') || dist[e.from] + Distance(e.weight) < dist[e.to])
)
  dist[e.to] = dist[e.from] + Distance(e.weight);
```

The view receives plain arrays and objects. Renderer snippets are for atomic types; draw a record's fields with an `item` snippet, as in `{#snippet item(edge)} <Node>{edge.from} → {edge.to}</Node> {/snippet}`.

## Design values

- Draws are `pick(['row', 'grid'])`, `int(3, 6)` (inclusive), `real(0.5, 1.5)`, and `chance(0.3)`, each only in the value of a top-level `const`, either the whole value or inside its object and array literals, such as `const layout = pick(['row', 'grid']);` or `const look = { radius: pick(['medium', 'full']), sizes: [int(1, 3)] };`. Other design constants may combine earlier ones. A seed always draws the same values.
- Use design values for styling, layout, wording, and library component props. The input and algorithm cannot see them, so steps never depend on the seed.
- The design value `frame` shapes the page frame that holds the view's top-level nodes: a ratio such as `const frame = '4:3';`, or an object with any of `ratio` (`'16:9'`, the default, `'4:3'`, `'3:2'`, `'1:1'`, `'3:4'`, or `'9:16'`), `justify`, `align`, `padding` (default `'large'`), `layout` (`'column'`, `'row'`, or `'free'`), and `constraints` between top-level nodes by their `key`, as for a node's own (put `<Link>` components at the top of the view to join top-level nodes), and `layoutSeed` to keep a free top-level layout the participant liked, such as `const frame = { layout: 'free', constraints: ['note below cells'] };`. Unset `justify`, `align`, and `layout` are drawn (see Start unopinionated); leave `layout` unset.
- Design names must differ from input and algorithm names.

## The subset

- Allowed: numbers, strings, booleans, `null`, and the collections and records their types make; `if`, `for`, `for (const x of array)`, `while`, `do`, `break`, `continue`; arithmetic, comparison with `===`/`!==`, `&&`, `||`, `??`, `? :`, template strings, `+=` and `++`; `Math.abs/ceil/floor/max/min/pow/round/sign/sqrt/trunc`, `Math.PI`; array `.length`, `.push`, `.pop`, `.shift`, `.unshift`, `.slice`, `.indexOf`, `.includes`, `.reverse`, `.join`.
- Not allowed: functions of any kind, `new`, classes, `this`, `==`, string methods, other globals, the names `step` and `seed`, and array or object literals except inside a type or `.push`/`.unshift`, or assigned to an element or field. Write helper logic inline.
- Limits: 200 steps, 1,000,000 operations, 10,000 entries per array or object, and 10,000 characters per string.

## Library

Nodes say nothing about what a structure means by themselves: a node with items laid out as a row can show an array, a list of linked nodes, a queue, or anything else. Decide the meaning from the participant's request, and when they leave it open, express the open choice as a drawn design value, so each presentation's seed can pick a different interpretation.

### Page frame

Every view sits in a page frame, a canvas laid out at a fixed logical size (1200 pixels wide) and scaled to fit, so every presentation renders identically whatever the pane size. It is 16:9 unless the design value `frame` sets another ratio; keep 16:9 unless the participant asks for another shape. Participants select nodes by clicking or dragging a box, to point at them in feedback; they scroll to zoom, drag with the middle button or with Space held to pan, and double-click empty space to reset, and the view is kept as they step through. Every node is selectable, so draw each thing a participant might want to point at, such as a cell, a pointer name, or a caption, as a node of its own. The page frame arranges the view's top-level nodes; place them with the design value `frame`, such as `const frame = { justify: 'between' };` to put a title at the top and a note at the bottom. Use the frame's width: lay sequences out across it rather than down it. Write the top-level nodes directly rather than wrapping the whole view in one node.

## Node

A node is one of three things:

- a value: `<Node value={7} />` shows a primitive (a number, string, boolean, or `null`);
- content: `<Node>any text or markup</Node>` shows its children, for titles, explanations, captions, indices, and pointer names;
- a collection: `<Node items={values} layout="row" />` arranges child nodes. Without an `item` snippet, each primitive item becomes a value node (drawn by its type's renderer, if typed) and each array item a nested collection; to control each item, give `{#snippet item(value, index, type)} <Node {value} {type} … /> {/snippet}`, where `type` is the item's atomic type name or `undefined`.

Titles and annotations are nodes too: `<Node>Linear search</Node>` makes a title, and arranging a node's children with `layout` puts an index, caption, or pointer name beside or above a value: `<Node layout="column"><Node color="neutral">{index}</Node><Node {value} /></Node>`. Without `layout`, children flow as ordinary text.

### Props

Props starting with `__` are reserved for the library. `shape` picks which of the presentation's drawn looks a node takes (see Start unopinionated), and every value that look sets can be overridden by the matching prop:

- `shape`: `'box'` (a cell: a drawn border, padding, fill, minimum size, and text size and weight; the default for a value), `'card'` (a surface with a drawn border, padding, and fill), or `'plain'` (no border, padding, or fill; the default for content, and for collections except when one is drawn as a card). A bordered node with a layout draws its border around the whole group.

Arrangement:

- `layout`: `'row'`, `'column'`, `'grid'`, or `'free'` (placed by layout; see Free layout, links, and relations); arranges a collection's items (default `'row'`) or, when set, a node's children.
- `gap`: space between arranged items: `'none'`, `'small'`, `'medium'`, `'large'`, or a number of em.
- `align`: `'start'`, `'center'`, or `'end'`; how arranged items line up across the layout direction.
- `justify`: `'start'`, `'center'`, `'end'`, `'between'`, `'around'`, or `'evenly'`; how arranged items spread along the layout direction (default `'start'`).
- `columns`: the number of grid columns; defaults to a near-square grid.
- `nested`: the layout, `'row'`, `'column'`, `'grid'`, or `'free'`, for items that are themselves arrays, such as the rows of a matrix (default `'row'`).

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

Types:

- `type`: an atomic type name, such as `'Int'`. If the view defines a renderer snippet for that type, or for a type it refines, the node is drawn by it (see Type renderers); otherwise it draws its default box with the type's `unit` after the value.

### Start unopinionated

Every prop a view leaves unset has a default, and these defaults are drawn, so they differ between presentations:

- on cells (`'box'`): radius, border width (sometimes none), padding, a pale fill and border tint (sometimes none), least size, and text size and weight;
- on cards: radius, border width, padding, and tint;
- on collections: the shape, now and then a card around the items;
- on every arrangement: the gap, and how rows and columns align their items;
- on the page: the font, and how the page frame spreads, aligns, and arranges the top-level nodes (a column in most presentations, a free arrangement in a few);
- in free layouts: the form, the positions, and the curves; on links: the width and the curve.

The tints stay pale so they never compete with the palette colours you give meaning. Other defaults are fixed, such as colours, opacity, a collection's layout, and the size of content such as titles.

<!--
The drawing policy, with its options and weights, is defaultsPolicy in library/node/defaults.ts.
Tints keep low saturation and high lightness so they stay unlike the saturated palette colours
authors use for meaning, such as 'amber' for the current element; a quarter of presentations
draw no tint at all.
-->

A node's own props and its type's renderer win over drawn defaults, so every prop you set takes a choice away from the presentations. Write the structure, and set only the props that carry meaning, such as a colour that shows which element is current; unset, drawn props vary more widely than a pick between a few values would. Draw meaningful colours in the design block from the palette, so which colour shows "current" varies while staying consistent within a presentation. Use design picks for choices the library does not draw, such as a collection's `layout` or which annotation nodes to show. How a domain type appears is such a choice too: the same type can map to quite different views, and a type's renderer or the view can draw between them, so presentations differ in what they show as well as how it looks. When the participant asks for a consistent or plainer look, set the props that should stay the same; liking one presentation is not such a request.

Example, with domain, input, algorithm, design, and a script-free view:

```svelte
<script lang="sverlin" domain>
  const Int = type('integer');
  const Index = type('integer', { min: -1 });
  const Values = collection(Int);
</script>

<script lang="sverlin" input>
  const values = Values([3, 8, 5]);
</script>

<script lang="sverlin">
  let i = Index(-1);
  yield 'Start';
  for (i = Index(0); i < values.length; i++) {
    yield `Visit index ${i}`;
  }
  yield 'Done';
</script>

<script lang="sverlin" design>
  const flow = pick(['row', 'column']);
  const showIndices = chance(0.5);
  const current = pick(['amber', 'red', 'purple']);
  const visited = pick(['blue', 'green']);
</script>

<Node>Array walk</Node>
<Node items={values} layout={flow}>
  {#snippet item(value, index, type)}
    <Node layout="column">
      {#if showIndices}<Node color="neutral">{index}</Node>{/if}
      {@const colour = index === i ? current : index < i ? visited : undefined}
      <Node {value} {type} fill={colour} stroke={colour} />
      {#if index === i}<Node color="neutral">i</Node>{/if}
    </Node>
  {/snippet}
</Node>
<Node>
  {i < 0 ? 'Start at the left.' : i < values.length ? `Visiting index ${i}.` : 'Every cell visited.'}
</Node>
```

A matrix needs no snippet: `<Node items={grid} layout="column" nested="row" />` draws each inner array as a row of nodes.

### Type renderers

A top-level snippet named after a domain type is that type's default renderer: every node showing a value of the type is drawn by it, including items drawn without an `item` snippet, `<Node type="Int" … />`, and nodes given an item's `type`. It takes the plain value and `node`, the props the caller set on that node (such as `fill` or `size`), so spreading `{...node}` after the renderer's own props lets the caller's settings win:

```svelte
{#snippet Int(value, node)}
  <Node shape={intShape} {value} {...node} />
{/snippet}

{#snippet Suit(value, node)}
  <Node {...node}>{{ spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }[value]}</Node>
{/snippet}
```

A type without a renderer uses the renderer of the nearest type it refines, and otherwise the default box with its `unit`. A renderer can use design values and step state, so a draw can change how every value of a type looks. The `Node` inside a renderer has no type, so it never calls the renderer again.

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
<Node layout="free" constraints={['head above ' + first]} flow="x">
  {#each nodes as node (node.id)}
    <Node key={node.id} value={node.value} fill={node.id === current ? 'amber' : undefined} />
  {/each}
  {#each next as [from, to]}<Link {from} {to} />{/each}
  <Node key="head" size="small" color="neutral">head</Node>
  <Link from="head" to={first} />
</Node>
```

## Link

`<Link from="a" to="b" />` draws a line, by default an arrow, from the child keyed `a` to the child keyed `b`. Put links among the children of the node whose children they join, beside the nodes they connect; they take no space, and the node lays its children out with them (a node with links and no `layout` is laid out freely). Each link is a component of its own, so a participant can select it and refer to it in feedback, just as they can a node.

- `from` and `to`: the keys of the two nodes, or of nodes inside them (see `key` above).
- `directed`: `false` for a plain line instead of an arrow.
- `dashed`: `true` for a dashed line.
- `stroke`: the line's colour, a palette name or any CSS colour.
- `strokeWidth`: the line's width, `'thin'`, `'thick'`, or a number of pixels; unset, it is drawn.
- `label`: a short text shown at the middle of the link, such as `next` or `head`.
- `curve`: `'straight'` or `'curved'` for this link alone; unset, it draws its own, whatever its siblings do.
- `bend`: an exact curve, how far the link bows to one side as a fraction of its length (`0` straight, `0.3` a clear arc, negative the other side). A selected link reports the bend it drew; when the participant likes a curve, set `bend` on that `<Link>` to the reported value.

Links can come and go with the steps: wrap one in `{#if}` to show it only while it matters, such as the pointer being followed. Its place is kept across the animation, so nothing moves when it appears.

```svelte
<Node layout="free">
  {#each nodes as node, index (node.id)}
    <Node key={node.id} value={node.value} />
    {#if index > 0}<Link from={nodes[index - 1].id} to={node.id} label="next" />{/if}
  {/each}
  <Node key="head" size="small" color="neutral">head</Node>
  <Link from="head" to={nodes[0].id} dashed />
</Node>
```
