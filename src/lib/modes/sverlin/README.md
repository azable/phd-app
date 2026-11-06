<!--
The Sverlin language guide. assistant/bot.server.ts sends this file to the assistant
after the instructions in assistant/assistant.md, with these HTML comments removed, so every
other word here is model guidance. Comments are notes for maintainers. guide.server.test.ts builds
every complete example and checks the documented Node and Link props and their
named values against the compiler. Update this guide in the same change as the
language, the library props, or the design space's options. Say each rule once,
here or in the prompt that owns it, and keep examples small and varied, so they
show a mechanism without prescribing a look or structure to copy.
-->

# The language

A component is one Svelte file that records the steps of an algorithm or program
and draws a view of each step. The markup says what is drawn; how it looks is
the design: every look of every kind of node is a variable the compiler finds in
the markup (see Design). A presentation is one variant of the component: every
presentation shows the same input and algorithm, with its own value for every
variable. Participants compare presentations in pairs, so the two presentations
of a pair should differ in how they show the algorithm.

## Before you send a source

Most refused first sources break one of these rules, each explained below:

- A layout reads the variables and labels its body names: write no `of`, and
  draw a layout by its bare tag, `<Range />`.
- Inside a labelled block every statement is in a label, except declarations at
  its top.
- A label is named by its full path, `@pass.scan.newMin`, never `@pass.newMin`.
- A position draws as a mark only in the root of the layout that draws its
  array; anywhere else it goes in a node, `<Node>{i}</Node>`.
- The algorithm declares every variable it uses, as `let order = Order([]);`.
- A body of several statements takes `@name{`, as
  `if (…) @left{ … } else @right{ … }`; `@name[…]` wraps statements inside a
  block.
- A design variable is named as the design names it: a kind inside another takes
  every kind around it, as `Cells.Item.Eliminated`, and only a free layout whose
  data makes a structure, with no `flow`, has `form` and `direction`.

## Blocks

A component is code blocks, each a `<script>` named by one attribute and written
in a subset of JavaScript (see The subset), followed by a script-free Svelte
view. Only the algorithm block is required, and there is no design block (see
Design). A plain `<script>`, or one with any other attribute, is refused.

1. `<script domain>`: the types, atomic and the arrays, records, and unions
   built from them (see Atomic types; Arrays, records, and unions).
2. `<script input>`: the inputs, each declared with its domain type and no
   value, as `const values = Values;`; each case gives them their values (see
   Cases).
3. `<script algorithm>`: the algorithm. It starts from the input variables, may
   update them and declare more, may declare functions (see Loops and
   functions), and labels the code its steps are about (see Steps). It runs
   once.
4. `<script listing="textbook">`, any number, any name but none: texts of the
   algorithm to show beside the view (see Listing).

## View

The view is markup made only of `<Node>`, `<Link>`, and `<Pointed>` components,
a `<Listing />`, text inside nodes, and Svelte blocks and tags such as `{#if}`,
`{#each}`, and `{@const}`, with no `<script>`, `<style>`, HTML, or SVG: every
visible thing is a node or a link, so participants can select it and
presentations can vary it. Nodes take no props that set a look: a node's kind is
the view or layout it is in, or one it names with `kind`, and the design gives
each kind its look. Every input and algorithm variable in scope at the selected
step and the library components are already in scope; never write `import`, and
never declare names `Node`, `Link`, `Pointed`, `Listing`, `View`, `Layout`,
`When`, or `OneOf`. Blocks in `{#…}` are Svelte's own (`{#if}`, `{#each}`);
Sverlin's own constructs are capitalised tags, as `<Node>`, `<View>`,
`<Layout>`, and `<When>`; and code is in `<script>` blocks named by an
attribute. `{#snippet}` and `{@render}` are refused: what one would draw is a
layout, a view, or a node with a `kind`.

- The top level holds views, at least one layout, and the storyboard (see
  Storyboard): every source declares its layouts, and one without is refused. A
  layout, `<Layout name="Range"><Node>between {lo} and {hi}</Node></Layout>`,
  reads the input and algorithm variables and the labels its body names, as `lo`
  and `{@insert.compare}`, and those of the layouts it draws; a name that is
  none of them is refused where it is written. Its name is written as it is,
  never computed. An `of` listing variables, as `of="lo, hi"`, is still read,
  and then the layout reads only those.
- A layout is drawn in another by its tag, `<Range />`, reading the state at
  that step. A tag may pass a variable by its own name, `<Range />`, as older
  sources do, never another value. A tag is closed at once, `/>`, and a layout
  drawn inside itself is refused. A tag in a node of text and values is drawn
  inline, as a value is, as `<Node>Searching for <Target /> in the list</Node>`.
- A layout a scene shows (see Storyboard) arranges the whole page: its body is
  one root `<Node>`, the frame (see Page frame), which holds values, layout
  tags, with `{#if}` and `{#each}` around them, a `<Listing />`, and nodes
  arranging them, and is selectable as the whole page. Its only prop is
  `layout`, `row` or `column` (the start), how it arranges what it holds, or
  `grid`, placing each thing it holds by `row` and `col` (see Grid). A layout's
  name is its nodes' kind, so a layout drawn on several pages looks alike on
  each, and it is measured over every value its inputs' types allow. Draw the
  layouts in the root rather than one layout holding the whole page.

```svelte
<Layout name="Side">
  <Node layout="row"><Board /><Node><Range /><Listing /></Node></Node>
</Layout>
<Layout name="Stacked">
  <Node><Title /><Board /><Range /></Node>
</Layout>
```

- Page layouts differ in how they arrange what they draw or which they draw,
  never only in look, which is the variant's; each scene shows one, so a second
  is for a scene that needs another arrangement, as a whole sort side by side
  and one merge stacked. A node's `layout` prop arranges its children.
- Draw every value of a domain type through a view of its type, as `{target}`,
  and every position through a pointer; the markup around them arranges, labels,
  and explains. A node of text and renders with no `layout` reads as a line of
  text, its renders inline at their own sizes, wrapping between words, as
  `<Node>Found {target} at index {i}.</Node>`, which keeps each value sized and
  looking as it does elsewhere, unlike `{target}`. A node with a `layout` holds
  only nodes, renders and blocks, never words: put its words in a node of their
  own, as `<Node kind="Caption">Find the target</Node>`. Blocks in a node with
  no `layout` and no words, as `<Node><Goal /><Cells /></Node>`, wrap against
  each other with no gap, and the build warns: give it a layout.
- `{@const name = expression}`, as the first child of the nearest component or
  block, names a value used more than once or too long to read inline.
- Write text in the participant's words about what the algorithm does, never a
  label's name: "the target is further right", not "low is true".
- How anything looks is the design's, never the algorithm's; what a step shows
  is read from the algorithm's values and labels (see Steps).

## Cases

A `<Case>` is one execution of the algorithm: it is named, and gives every input
the input block declares a value of its type, written plainly, as a number, a
text, an array's elements or a record's fields; the input's type gives it its
type, so a value names no type: `target={9}`, never `target={Int(9)}`.

```svelte
<Case name="present" values={[2, 5, 7, 9, 12]} target={9} />
<Case name="absent" values={[2, 5, 7, 9, 12]} target={4} />
```

- Cases are written at the top level, beside the storyboard, before it. A case's
  name is one word that may hold digits and dashes, and no two cases share one.
- A case gives every input, and nothing else; a value that is not of its input's
  type is refused, naming the case and the input.
- The room each node keeps comes from the types, so a layout keeps its place and
  size in every case.
- A pool starts empty in every case, so a case gives it no value: the algorithm
  adds its nodes, or a case adds them in the value of a reference input it
  gives, as `head={nodes.add(ListNode({ name: 'A', next: End('end') }))}`. What
  `.add(…)` is given is the one place a case names a type: the record it adds.

## Storyboard

The view ends with a `<Storyboard>` of the scenes the presentation plays, in
order; one without is refused. Each `<Scene>` is named, its title in the
controls, and nests one layout, as its tag, passing it state: only scenes read
state, so every layout reads only what it is given, and every source has one
scene at least.

```svelte
<Storyboard>
  <Scene name="sort" case="main"><Arrays /></Scene>
  <Scene name="one-merge" case="main" within="@sort.merge#1" pause="@sort.merge.take">
    <Arrays />
  </Scene>
  <Scene name="then"><Note /></Scene>
</Storyboard>
```

- A scene can also step through a query's result with `over` and `as` (see
  Queries).
- A scene is a stepping scene if its layout reads state, and a single frame
  otherwise, as a title card or a note between cases: its layout reads no state,
  and `case`, `pause`, `within`, or `at` on a scene whose layout reads none is
  refused.
- A stepping scene names the case it shows, as `case="present"` (see Cases); one
  naming none, or a case no `<Case>` names, is refused. Its stops, `within`,
  `pause` and `at` are those of that case, and two scenes may show two cases.
- Each span of a label has two stops: `:before`, just before its code begins,
  and `:after`, just after it ends. The whole case has them too: its `:before`
  is the input as the case gives it, and its `:after` the state the algorithm
  ends on.
- A stepping scene steps through the whole case, or the spans of one label
  `within` names: every span, `within="@sort.merge"`, or the nth to begin,
  `within="@sort.merge#1"`. It opens on their `:before` (the first span's, for
  every span) and closes on their `:after` (the last span's), as
  `@sort.merge#1:before` and `@sort.merge#1` in the controls, or the whole
  case's, `:before` and `:after`. `pause` names, separated by commas, the stops
  where the scene takes a step between them: a label by its full name for the
  end of each of its spans, as `pause="@sort.merge.take"`, which
  `@sort.merge.take:after` also writes, and `@sort.merge.take:before` for just
  before each begins; `pause="@sort.merge.take:before, @sort.merge.take"` takes
  both. The scene pauses at those stops and no others, and `within` only chooses
  which spans it shows, so a scene with no `pause` shows its `:before` and its
  `:after`. A step the view draws from exactly what it drew the step before from
  (the variables it reads, the marks held, the code lit, and each `<When>`)
  draws the same picture, so it is left out, and the build warns, naming both
  steps, unless the step left out is the scene's own `:before` or `:after`. A
  paused step whose values differ but whose drawn picture is the step before's,
  as one moving a pointer that marks nothing, is shown, and the build warns,
  naming the first run of such steps at each label. `at=":before"` or
  `at=":after"` shows only one of them. `title` is a caption beside its name in
  the controls. Props are written as they are, never computed.
- Pause at each decision as well as at the action it leads to: a loop's test and
  an `if`'s test, labelled, so the reader sees why something happens and why it
  stops, not only that it did. Draw the decision's answer where it helps,
  through a view of its label (see Views of what a step computed), as "is 5 > 2?
  yes, so swap". A pointer that follows the moving item marks it only once it
  has moved, so pause after the pointer's update, at the end of the block that
  updates it, not between the change and the update. Insertion sort, pausing at
  each round, each test and each swap:

  ```js
  for (@start[let i = Position(1)]; @more[i < values.length]; @next[i++]) @insert{
    @init[let j = i;]
    while (@front[j > 0]) @scan{
      if (@cmp[values[j - 1] > values[j]]) @swap{
        @exchange[const held = values[j - 1]; values[j - 1] = values[j]; values[j] = held;]
        @down[j--;]
      } else @stop{ break; }
    }
  }
  ```

  ```svelte
  <Scene name="sort" case="main" pause="@insert.init, @insert.front, @insert.scan.cmp, @insert.scan.swap">
    <Main />
  </Scene>
  ```

  Each round then shows its start, "is j above 0?", "is the left value larger?",
  and the swap after a yes, with `j` on the item being inserted; a no, or `j` at
  the front, shows why the round ends. With `pause="@insert.scan.swap.exchange"`
  alone, only the swaps play, the mark stays on the value moved right, and
  nothing shows when or why a round ends.

- Scenes play in the storyboard's order, each showing what it selects, from its
  first step's state, whatever the scene before it showed: a merge may be shown
  again in detail after the whole sort.
- A layout a scene shows keeps its place and size in every scene that shows it:
  every node keeps the largest room it reaches at any step of any scene, and a
  free layout is laid out once over them all, so nothing moves between scenes.
- A scene naming no layout the source declares, a label that is none of the
  algorithm's, or a span its label never has, a scene that shows no step, and a
  storyboard showing more steps than a presentation can are refused.

## Views of types

A view draws one value of one domain type, written
`<View of="Type" name="Name">` holding what it draws, its value always `this`,
as `<View of="Int" name="IntCell"><Node value={this} /></View>` or
`<View of="Vertex" name="VertexCard"><Node>{this.name}</Node></View>`. Its two
props are written as they are, never computed, and it takes no others. A layout
takes no value: `this` in a layout is an error, as it has no value of its own.
The node showing the value shows the type's unit too. Define views at the top
level, never inside a layout or a node, and end each `</View>` its line, putting
what follows on the next. A view reads only `this`, types, other views, labels
(`@…`), the library's components, `Math`, `at(p)`, `spans(@label)`, and the
names its `{#each}` blocks and `{@const}` tags declare: never the input or
algorithm variables, a pointer apart, and never browser globals such as `window`
or `self`. How two values relate is drawn where both are in scope, in the view
holding them or by a pointer; a layout reads the input and algorithm variables
it declares.

A value in braces is drawn by its type's view: in the markup's text, `{key}`,
with `key` an `Int`, draws the view `{Int}` chooses, among every view of `Int`
and `none`. The braces are Svelte's, holding a value; what they draw is
Sverlin's, the type of the value deciding: a view's parameter by its annotation,
an `{#each}` item by its array, a field by its record, a variable or a label by
what the steps record it holding. A value without a domain type, as a loop's own
index, is text, and a value shown as plain text is a node's value,
`<Node value={key} />`. A union's value is drawn by the view of the member it
holds, as a `Dist` holding `'none'` by a view of `None`, so a union has no view
of its own; one member drawn as a pointer, as a position beside `'none'`, marks
where the value points. Name views after how they draw, as `IntCell` or
`IntTally`. Which view draws a value is the variant's, so a view named as its
type (`<View of="Int" name="Int">`) and a value whose type no view draws are
errors; to draw one value with a view of its own, choose it for its place (see
Places). `<Title />` draws a layout, and `{@check.equal}` what a labelled
expression computed, through a view typed by its label (see Views of what a step
computed). Views differ in what they draw: two differing only in look, as a cell
and a round cell, are one view. Offer more than one where the request leaves
open what a value shows, as a number as a cell or a tally, a flag as a word or a
tick. In the view a type's name is its view, never a constructor: draw values
the state holds, and a loop's own index, `k` in `{#each list as v, k}`, as text,
`{k}`.

A view of an array or record draws its parts through their types' views:

```svelte
<View of="Values" name="Items"><Node>{#each this as v}{v}{/each}</Node></View>
<View of="Vertex" name="VertexCard"><Node layout="column">{this.name}{this.seen}</Node></View>
```

A node whose only child is an `{#each}` holds an array: its items sit on equal
tracks, as large as the largest, in a row unless it sets `layout`, and an array
inside another runs across it, as rows in a column. Put a title for an array in
a node around it, not beside the `{#each}`. Draw an array of the state with a
view of its type and write its `layout`, as
`<View of="Values" name="Cells"><Node layout="row">{#each this as v}{v}{/each}</Node></View>`
with `{values}` in the page, rather than a layout looping over the variable: the
design can then offer another view of it, as bars, and pointers into it mark its
items as before. A layout's loop still works. Every view is measured for every
input its type allows, so its box keeps one size and nothing moves between steps
or inputs: with every value of its type where there are few, else the widest,
and with each `{#if}`, `<When>`, and `<OneOf>` in it going each way, whatever
its values say, so a branch no input here takes still has room.

So a test of which member a union holds that reads inside it in a branch is an
error, as `{#if this.next !== 'end'}{this.next.name}{/if}`: measured going the
other way, it would read inside the end. Give each member its own view, and draw
the union, which draws the member it holds:

```svelte
<View of="NodeRef" name="Then"><Node>then {this.name}</Node></View>
<View of="End" name="Last"><Node>(last)</Node></View>
<View of="ListNode" name="Card"><Node>{this.name}{this.next}</Node></View>
```

A test reading a value without reading inside a member, as `{#if this.seen}` or
`{#if this > 2}`, is measured either way as it is.

An item's track is as large as the largest any item reaches at any step, so what
makes one item large makes every item large: in an array of groups, the group
holding the whole input gives each one-value group room for all of it, and the
picture grows with the number of items times the largest. Keep the items alike
in size: draw a group that grows, or a list inside each item, only where it is
small, show one level or part at a time rather than every one at once, and keep
a varying count of values in one array of its own.

## Pointers

A view of a position type (`index(...)`) or reference type (`ref(...)`) can be a
pointer: it holds one `<Pointed>`, standing for the element pointed at, drawn
with its own view, and nodes around it, placed by layout, annotate it: a mark
alone, `<Pointed />`; a bracket,
`<Node layout="row"><Node>[</Node><Pointed /></Node>`; or a label below,
`<Node layout="column"><Pointed /><Node kind="Caption">i</Node></Node>`, the
label given a kind of its own. It marks the element only where the view draws it
whole, with a view of its type, as `{vertex}`: a record drawn only by its
fields, as `{vertex.name}`, has nothing to mark, and the build warns of a
pointer that marks nothing at any step.

- `<Pointed>` takes no props and is written in the pointer view itself. Where
  the pointer is, the element is drawn in the pointer's kind, as `Here.Pointed`
  for the view `Here`: its paint (fill, stroke colour, opacity, text colour,
  shadow, glow, fill style, decoration, expand and the transforms below) shows
  only there, the rest of its look in every slot, so every slot keeps one size;
  a stroke keeps its width in every slot, drawn in no colour where none shows.
  `expand`, 0, 2, 4, or 8 pixels on each side, enlarges the element where the
  pointer is: in a row of slots it is painted, its fill spread and its stroke
  drawn further out, in room every element keeps for it, so nothing moves; in a
  packed row it takes room, growing from where the element's kind places it
  along the row (`xAnchor`): about its centre by default, the elements before it
  moving back as far as those after move on; the row keeps room for one
  expansion for each pointer into it, at its ends as that anchor says (a packed
  column keeps it at its end). Between steps an element changes size and paint
  as it moves, so an expansion grows and a highlight fades from one element to
  the next.
- A pointer's kind transforms what it is at, where it is, taking no room:
  `scale` (1, 1.1, 1.2, or 1.3) draws it larger from the element's anchors
  (`xAnchor`, `yAnchor`), so with `yAnchor` end it grows upward, its bottom
  level with the rest; `spread` (0, 2, 4, or 6 pixels) draws its fill and stroke
  further out on every side, its text unchanged, as a painted `expand` is;
  `offsetX` and `offsetY` (−12 to 12 pixels, in steps of 4) draw it moved,
  negative being left or up, as a lift of `offsetY` −8. A scale and an offset
  move the pointer's whole drawing, the marks round `<Pointed>` with the
  element. Every element keeps room for their reach in every state, so nothing
  is painted over or cut off and nothing moves; between steps an element grows,
  shrinks and rises as the pointer comes and goes.
- Render a pointer in a page layout's root itself, outside other nodes and
  blocks other than `{#if}`, with a position from the state: a variable (`{i}`),
  an element, a field (`{edges[e].to}`), or a label (see Views of what a step
  computed). There a position type draws as a mark, through its pointer views
  (`{Index}.pointer`), so every mark of it looks the same; inside another node,
  as `<Node>at {i}</Node>`, as its number, through its other views (`{Index}`).
  A pointer in a layout another layout draws by its tag draws nothing and keeps
  no room.
- The page draws the pointer around the element wherever that is drawn. Every
  element keeps room for the pointers that can point into its array, and a
  position shown past an end gets a slot there, so nothing moves as pointers
  move. Pointers at one element nest, the one rendered last outermost; pointers
  never at the same element at the same step share one slot, so an element keeps
  room only for as many labels as are ever there together; a slot is as large as
  the largest of the pointers sharing it, whichever is drawn, so the element
  stays where it is in any layout, a free one included. A pointer out of scope,
  pointing nowhere, or in an `{#if}` branch not taken draws nothing and keeps
  its room.
- A pointer view may read the input and algorithm variables, so its label can
  follow the state. A pointer at an element drawn as a link, as the edge being
  examined, gives the link its kind's stroke and width.
- A view names the place it is rendered at with `{place()}`: `lo` for `{lo}`,
  `pair.left` for a field in a part, `before` for a `{@const before = j - 1}`,
  and a label's last name, never its path, `neighbour` for
  `{@visit.look.neighbour}`, so a label named after what it marks captions
  itself. So one view captions every pointer,
  `<View of="Index" name="Mark"><Node layout="column"><Pointed /><Node kind="Caption">{place()}</Node></Node></View>`,
  and a source declares one, not one for each name. The design labels a place in
  the participant's words, as `:lo.label` "low" or
  `:@visit.look.neighbour.label` "next to visit", any text of up to 24
  characters, which `place()` gives instead. `place()` is written in any view,
  as a mark drawn in a grid cell (see Grid). An expression with no name of its
  own, as `{j - 1}` or `{edges[e].to}`, has no place: `place()` gives it as
  written, and the design cannot label it; name it with `{@const}` to label it.
  A name written into a view, as `i` under the mark, is right only where the
  variant chooses that view for that place, and a randomised variant can choose
  it elsewhere; write `{place()}` instead.
- A pointer view's layout places its marks round the element: a column puts them
  under it, which suits a row of cells. For an array drawn in a column, give the
  type a second pointer view whose marks run across, as
  `<View of="Index" name="Side"><Node layout="row"><Pointed /><Node kind="Tip" icon /><Node kind="Caption">{place()}</Node></Node></View>`,
  its tip's icon `arrow-left` in the design, and choose it with the column's
  view of the array.

<!-- Why place(): in a model test on 6 November (GPT-6.1 Terra low and Sol medium,
five algorithms each), every output in the pointer form without it declared one
pointer view per pointer only to type its label; given place(), 8 of 10 used one
view for all pointers. Two outputs also chose a type's number view ({Position})
where no position drew as a number, which the build leaves out with a warning. -->

- A reference follows its element as it moves: `{tracked}`, with
  `const tracked = Tracked(values[3]);`, marks that value wherever a sort takes
  it.

## Steps

- A label marks code the steps are about: `@name[…]` around a statement,
  statements in a row, or an expression, as `@place[values[j] = key;]` or
  `while (@test[j > 0 && values[j - 1] > key])`, or `@name{` on a block the code
  already has, a loop's, an `if`'s, or a function's body, as `for (…) @insert{`.
  A name is one word, without dots, and the algorithm runs as if the marks were
  spaces, but a span beside an operator groups its code as parentheses do:
  `@seen[a] && @cheaper[b || c]` means `a && (b || c)`.
- A span of a label is one execution of the code it marks, from where it begins
  to where it ends: one evaluation of an expression, one pass of a loop's body,
  one call of a function, recursive calls included. Spans nest, a span ends
  early at a `break` or `return`, and code that does not execute has no span.
  `@x#n` is the nth span of `x` to begin.
- No code runs outside a label. Every statement of the algorithm, at its top
  level and in each function's body, is inside a label, as
  `@search[const found = search(values, target);]`. Every test of an `if`,
  `while`, or `do … while` is a label's own code, or conditions joined by `&&`
  and `||` that each are, as `if (@base[Short(lo, hi)])` or
  `while (@bound[j > 0] && @compare[values[j - 1] > key])`, so each decision is
  a step, its value the condition's, even where it fails. Each part of a `for`
  header is a label's own code too, as
  `for (@start[let i = Index(values, 0)]; @more[i < values.length]; @next[i++]) @scan{`:
  the start runs once, the test before each pass and once more at the end, its
  last value false, and the move after each pass, before the next test, so
  `@scan#1`, then `@next#1`, then `@more#2`. The header's labels sit beside the
  body's, not inside it: inside `@visit`, they are `visit.start`, `visit.more`
  and `visit.next`, never `visit.scan.start`, and a listing marks them so.
- A label inside another takes its name as a prefix: `@shift[…]` inside
  `@insert{` is `insert.shift`. A label around statements in a row runs from the
  first to the last, the labels inside it included:
  `@merge[@copy[…] for (…) @take{…}]` ends after the loop's last pass. Two
  labels may not mark the same code, as `@add[@one[n = Up(n);]]`: they would
  pause and draw together, so keep one name. Once a label or a function's body
  has labelled statements, every statement in it is inside one or contains one;
  a statement left out is an error naming the labels beside it. Declarations
  leading a labelled block, before its first labelled statement, need no label
  of their own, as `let min = i;` at the top of `@select{`. A label on part of a
  statement asks nothing of the code around it.
- The page pauses only at the stops a scene's pause names (see Storyboard), so a
  check finding nothing is a step too. So label what a step can be about, as a
  comparison, `@compare[values[j - 1] > key]`, and the operands it reads, and
  draw them.
- A step shows the state just after its code, each value moving there from where
  the step on screen drew it, in one motion. Code not paused at, inside a label
  the scene does not pause at, leads up to the next step, and what a label there
  gives, a value or an application rendered at it, is drawn at that step, as a
  comparison not paused at is at the swap it leads to. A step inside a span of a
  label, as in a call it makes, ends that span's code so far: what it changes
  after is compared with the step.
- A step inside a span shows only its own part and the code leading up to it; a
  step ending a span shows its whole span, the values its labels gave inside it
  drawn and its code lit.
- At a case's `:before` no code has run: what the algorithm declares, its
  labels' values, and its applications appear from the first step on (see
  `shown` in Design). `return;` stops the algorithm early.
- Each step records every variable in scope, before and after its code: the
  input's, the top level's, and those of the blocks around it. A variable out of
  scope at a step is not part of it, so whatever the view draws from it is
  missing there (see `shown` in Design): declare a variable where it belongs,
  never at the top level with a stand-in such as -1. A name is declared once
  among the blocks in scope: a loop inside another cannot declare `j` again,
  while loops one after another can.
- A step is named by the stop it is at: the label whose span it ends and which
  span that is, as `@insert.swap#1`, or `@insert.swap#1:before` just before that
  span begins, and `:before` and `:after` for the whole case's: in a recursive
  function, `@sort#1` ends the first call made, the outermost, at the last of
  its steps. The name is the same in every variant, which numbers only the steps
  it shows. A step has no text: the view says what it shows, from the recorded
  variables, so what it should say is in the algorithm's variables, as an answer
  is the value a search returns or where its loop stops.
- Between steps the page moves each value from where it was drawn, so a swap
  shows as two values trading places, a value moved through a temporary being
  the same value. A variable holding a value an array also holds shows a copy,
  as insertion sort's `key`, which keeps its place once the array's is
  overwritten and moves back into the row when put down. A value copied to a
  second place, as `values[j] = values[j - 1]`, starts where its source was, as
  do a label view's operands, lifting out of their cells into its caption (a
  computed operand fades in); a value written anew fades in; one no longer held
  fades out. Pointers slide; links switch with the step.

## Loops and functions

The algorithm's loops and branches are JavaScript's: `for`, `while`,
`do ... while`, `if` and `else`, `break`, and `continue`, each test and each
part of a `for` header labelled (see Steps). End a loop with `break` or `return`
where it has what it looks for, rather than a flag its test reads, and walk only
what each step is about, as a vertex's own neighbours rather than every edge.
`for … of` is refused, as its header walks an array in a way no label can split:
walk it with an index, its start, test, and move labelled, and read the element
at the index, as
`for (@first[let k = Slot(around, 0)]; @another[Within(k, Count(around))]; @step[k = Step(k)]) @look{ const w = around[k]; … }`,
where `Slot = index(Neighbours)` and `around` is the list declared before the
loop. A position names the array it points into, as `Slot(around, 0)`, where
that is not the only one of its type at the top level, and draws as a pointer
into it: with a pointer view of `Position`, `{i}` marks the cell `i` points at
as an index loop walks `digits`.

A function is declared at the top level of the algorithm block, as
`function search(a, target) { ... }`, and sees only its parameters: give it the
arrays it works on, and it changes them in place. Each call gives its parameters
values of the types the first call gave them. `return i;` gives a value back. A
position into an array the call was given points into the caller's, and is drawn
on that array wherever the view draws it under its top-level name. A function
may call itself. A step inside a call records the call's variables, its
parameters among them, and the top level's; the caller's are out of scope there,
so with recursion a step shows the innermost call's. A parameter hides a
top-level variable of the same name.

Binary search, stopping where it finds the target:

```svelte
<script domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = array(Int, { max: 7 });
  const Index = index(Values);
</script>

<script input>
  const values = Values;
  const target = Int;
</script>

<script algorithm>
  @range[let lo = Index(0);
  let hi = values.length - 1;]
  while (@open[lo <= hi]) @probe{
    const mid = Index(Math.floor((lo + hi) / 2));
    @check[if (@found[values[mid] === target]) break;]
    if (@low[values[mid] < target]) @right{ lo = mid + 1; } else @left{ hi = mid - 1; }
  }
</script>

<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Index" name="IndexText"><Node value={this} /></View>
<View of="Index" name="Mark">
  <Node layout="column"><Pointed /><Node kind="Caption">{place()}</Node></Node>
</View>
<View of="Values" name="Cells"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<Layout name="Title"><Node>Binary search for {target}</Node></Layout>
<Layout name="Range"><Node>between {lo} and {hi}</Node></Layout>

<Layout name="Stacked">
  <Node>
    <Title />
    {values}
    <Range />
    {lo}
    {mid}
    {hi}
  </Node>
</Layout>

<Case name="main" values={[2, 5, 8, 12, 16, 23, 38]} target={23} />

<Storyboard>
  <Scene name="main" case="main" pause="@range, @probe.check, @probe.right, @probe.left"><Stacked /></Scene>
</Storyboard>
```

Inside `Range`, `lo` and `hi` are numbers, drawn by `IndexText`; in the root
they and `mid` are marks, drawn by `Mark`, each captioned with its own name by
`{place()}`: one view for every pointer. The list is drawn by `Cells`, a view of
its type, so a variant could offer another, as bars. The loop ends at `break`
with `mid` on the target; a search for a value not there ends with `lo` past
`hi`.

## Atomic types

No types are predefined: define each one the request needs, basic ones such as
`Int` included, in the domain block, each as a top-level `const`, one per
meaning (`Index`, `Distance`, `Visited`) rather than one general type. The
domain declares types only; computing is the algorithm's (see Computing).

- an integer with both `min` and `max`, as
  `const Int = type('integer', { min: 0, max: 99 });`;
- a decimal number with `min`, `max`, and `places`, the decimal places every
  value has and is drawn with, as
  `const Price = type('number', { min: 0, max: 100, places: 2 });`: a value
  entering it is rounded to its places, and `3` is drawn `3.00`;
- `'boolean'`;
- an enumeration of text or number values, named plainly, leaving how they look
  to views: `const Suit = type(['spades', 'hearts', 'diamonds', 'clubs']);`.
  Text types are always enumerations, and their values compare in the order
  listed, as `'low' < 'high'` with `type(['low', 'high'])`.

Any of them may take a `unit`, shown after the value, as
`type('integer', { min: 0, max: 250, unit: 'cm' })`. A type is declared on its
own, never from another: `type(Int, …)` is refused.

Every type has a known, finite set of values, so a view can be drawn for each:
choose ranges holding every value the algorithm reaches, as a count up to the
input's length; a position's range is its array's (see Arrays, records, and
unions). Type names cannot be variable names.

Every number, boolean, and text a variable, element, or field holds is typed,
made with a type's name, as `const target = Int(8);` or `Index(values, 0)`.
There is no `null`: every variable starts with a value, and "nothing yet" is a
member of a union that says so, as `Unreached('unreached')`, as is a result that
may be missing, as a search returning a `union(Index, NotFound)`. Reading a
value not there, as `queue[0]` of an empty queue, is an error. A variable keeps
the type it was made with and a value assigned to it takes that type, as an
element or field does: after `let found = Found(false);`,
`found = values[i] === target` stores a `Found`, and `found = Count(1)` is an
error; one made by a union, `let d = Dist(0);`, holds any member.

A word is an array of characters, as `const Word = array(Char, { max: 12 });`
with `const Char = type(['A', 'C', 'G', 'T']);`, written in the input as text,
`Word('GATTACA')`; there is no text type to search, join, or copy in one step.

## Arrays, records, and unions

Every array and object is made by a type defined in the domain block, in any
order, each as a top-level `const`:

- an array of one type with the most elements it ever holds, its `max`,
  `array(Int, { max: 8 })`, and of arrays for a table,
  `array(Values, { max: 6 })`;
- a record with named fields,
  `record({ from: Vertex, to: Vertex, weight: Weight })`;
- a union, a value of one of several types, `union(Distance, Unreached)`;
- a position in an array, `index(Values)`;
- a pool of the nodes of a record type, unordered, with the most it ever holds,
  `pool(ListNode, { max: 6 })` (see Pools and references);
- a reference to an element of an array of single values, staying with it as it
  moves, `ref(Queue)`, or to a node in a pool, `ref(ListNode)` (see Pools and
  references).

An array and a pool both hold values of one type, at most `max`, and differ in
order. An array's elements are in order at positions 0, 1, 2, …: it is read and
written by position, `values[i]`, grows and shrinks at its ends with `push`,
`pop`, `shift`, and `unshift`, and is drawn in that order, as a row of cells. A
pool's nodes have no order and no positions: the algorithm adds one with
`nodes.add(…)`, reaches it only through a reference, and a free layout places it
by its links. Keep values in an array, and the nodes of a linked list, a tree,
or a graph in a pool, unless the algorithm does arithmetic on their places, as a
heap stored in an array.

Make one by calling its name with literals, which take their types from it:
`Values([3, 8, 5])`, or `Edges([{ from: 0, to: 1, weight: 4 }])`, its fields a
`Vertex`, a `Vertex`, and a `Weight`; a case gives an input the literal alone,
which takes the input's type, as `values={[3, 8, 5]}` (see Cases). A literal
written into an element or field takes its type, as `dist[v] = 0`, and one
pushed the array's element type, as `queue.push(3)`; an array or object literal
anywhere else is an error. A record has exactly its fields.

An array never holds more than its `max`: an input longer, a
`Values.ofLength(n, …)` with `n` past it, or a `push` or `unshift` that would
pass it, is an error. The view keeps room for `max` elements at every step, so
changing the input moves nothing; the frame shrinks the whole view to fit that
room, so choose the least `max` that fits the largest input you mean to show, as
the input's length, or a queue's most at once.

A position is a whole number from -1 to its array's `max`: 0 to length - 1 point
at an element of its array, the others nowhere, as the length after a loop ends,
or -1 before its start. Reading or writing outside the array is an error, except
that writing at the length adds one. The view keeps room past an end for the
positions its pointers draw, at most 4 places; a position nothing draws keeps
none. A position is bound to its array when declared: `Index(0)` points into the
only `Values`, and with several, name it, as `Index(left, 0)`; the binding
stays, so `k = i + j` keeps `k` in its array. One stored in a record or array
keeps where it came from (`Take({ from: j })`, `i + 1`,
`const at = take.from;`), and a number stored there points into the only array
of its type, or the one named, as `Take({ from: Index(left, 0) })`. To point at
a cell of a grid, hold the row in a variable: `let row = paths[r];` is the row
itself, so `ColIndex(row, 1)` points into `paths`, and `NextRow(row, paths[r])`
moves it.

A reference, as `const front = Front(queue[0]);`, reads as its element. Where a
position stays at its place as the array changes, a reference stays with its
element, after `queue = Rest(queue)` or a sort; once the element has left the
array it refers to nothing, and its pointer draws nothing, keeping its room. It
follows an element of an array of its own type, even when the same value is also
a field elsewhere. Use a position to step to a neighbour.

A union value is always one of its members: a literal becomes the member it
fits, as `Distances([0, 'unreached'])`, and one fitting two needs its type, as
`Distance(4)`. Members compare with `===` and `!==`, different members unequal,
but not with `<` or `>`, so check the member first:

```js
if (@closer[dist[v] === 'unreached' || d < dist[v]]) @relax{ dist[v] = d; }
```

The view receives plain arrays and objects, drawn by their types' views.

## Pools and references

A node of a linked list, a tree, or a graph is a record referring to others of
its kind, as `struct Node { char name; struct Node *next; }` in C. The nodes of
a record type live in its pool, `pool(ListNode, { max: 6 })`, which holds at
most `max` of them, in no order: no node has a place in it, so a pool has no
`nodes[0]`, `push`, or `sort`. A reference to the record type, `ref(ListNode)`,
is the pointer: it refers to a node of the pool, and always to one. "No node" is
a value of a type of its own, joined to the reference with a union, so a field
that may end says so, and the end is drawn and varied as any value is. A record
holding itself other than through a reference or an index would never end, and
is refused. A list reversed, the nodes `prev` and `cur` refer to both marked:

```svelte
<script domain>
  const Name = type(['A', 'B', 'C']);
  const End = type(['end']);
  const ListNode = record({ name: Name, next: Next });  // Next is defined below
  const ListNodes = pool(ListNode, { max: 3 });          // every ListNode
  const NodeRef = ref(ListNode);                         // always a node in it
  const Next = union(NodeRef, End);                      // a node, or the end
</script>

<script input>
  const nodes = ListNodes;
  const head = NodeRef;
</script>

<script algorithm>
  @begin[let prev = Next(End('end'));
  let cur = Next(head);]
  while (@more[cur !== 'end']) @rewire{
    const after = cur.next;
    cur.next = prev;
    prev = cur;
    cur = after;
  }
</script>

<View of="Name" name="NameCell"><Node value={this} /></View>
<View of="End" name="EndMark"><Node>∅</Node></View>
<View of="ListNode" name="NodeBox">
  <Node layout="row">{this.name}<Node kind="NextField"><Link to={this.next} /></Node></Node>
</View>
<View of="NodeRef" name="Here"><Pointed /></View>
<Layout name="List">
  <Node layout="free" flow="x">{#each nodes as n}{n}{/each}</Node>
</Layout>

<Layout name="Stacked">
  <Node>
    <List />
    {prev}
    {cur}
  </Node>
</Layout>

<Case name="main" head={nodes.add(ListNode({ name: 'A', next:
    nodes.add(ListNode({ name: 'B', next:
      nodes.add(ListNode({ name: 'C', next: End('end') })) })) }))} />

<Storyboard>
  <Scene name="main" case="main" pause="@begin, @rewire"><Stacked /></Scene>
</Storyboard>
```

- The input declares the pool, `const nodes = ListNodes;`, once, and it starts
  empty in every case: a record type has one pool, so a reference to it always
  points there, and the algorithm makes none. `nodes.add(ListNode({ … }))` adds
  a node and gives it, a reference wherever the type expects one, as a `next`
  field, written nested, as the case here gives `head`. The algorithm adds one
  the same way, as `head = nodes.add(ListNode({ name: v, next: head }))`, and a
  function adding one takes the pool as a parameter,
  `insert(nodes, root, value)`. An add past `max` is an error, and so is a
  reference to a node never added. A cycle is the algorithm's to make.
- A field is read and written through a reference, `cur.next = prev`; a value of
  another type is refused, and reading or writing one through the end is a
  mistake at that step ("cur is an End ("end"), so it has no next"). A variable
  holding a node or the end is made with the union, `let cur = Next(head);`. A
  layout reads a field through a reference too, from the node it refers to, as
  `{#each queue as q}{q.name}{/each}`; a view drawing a reference itself as a
  value is refused, as it would show the node's place.
- The pool is a value as any input is: a layout reads it by name, and
  `{#each nodes as n}` draws every node, each through the record's view, in a
  free layout that places them by their links. A node stays in the pool to the
  end, keeping its identity as its links change, so it stays put; one nothing
  refers to any more is still drawn. A step records a reference as its node's
  place in the pool, so a circular list stays finite.
- `<Link to={n.next} />` with no `from`, in a node of the record's view, leaves
  that node for the node the field refers to, and the free layout around the
  nodes lays it out; a link beside the view's nodes, in none, leaves nothing.
  Write links there, reading the record's fields, or in a view of the reference
  type itself, as
  `<View of="NodeRef" name="NextLink"><Link to={this} /></View>`, which leaves
  each field it draws for the node that field refers to. Draw a node as fields,
  as a textbook does, `[ A | next ]` or a tree's `[ left | key | right ]`: a
  node holding only such links is a field, a kind of its own so it has its own
  look (`NodeBox.NextField`); the arrow leaves the field, arcing over its node
  where it points back. A tree's children are placed in the order their links
  leave it, so the left field's child is on the left. Where the field is the
  end, the link draws the end with its type's view (`{End}`, as `EndMark`'s ∅).
  A pointer view of the reference, as `Here`, marks the node a variable refers
  to, and draws nothing at the end.
- References suit nodes added and linked as the algorithm runs; where it does
  arithmetic on places, or the structure is an array (an array-based tree, a
  graph over a fixed list of vertices), keep a position instead, `index(Nodes)`.
- A view reads through a position with `at(p)`, the element it points at in the
  array it points into, as
  `<View of="VertexRef" name="VertexName">{at(this).name}</View>`; a layout may
  too. With `VertexRef = index(Vertices)`, `at(p)` is a `Vertex` and
  `at(p).name` a `Name`; into integers, `at(mid)` is an `Int`; and a record of
  positions reads through twice, `at(edge.from).name`. What draws it is the
  element itself, so a pointer's view drawn round the whole element marks it
  there too; but it moves as the position, so a name in a queue slides with its
  entry and fades out as it leaves while the element stays where it is held;
  past either end it draws nothing. A position has no fields (`p.name` is
  refused), and its number may be drawn, as an index means something.

## Computing

The algorithm computes as JavaScript does, on typed values:
`values[j - 1] > key`, `i++`, `total += v`, `hi - lo < 2`, `queue.push(w)`,
`values.length`. Types follow the values:

- arithmetic keeps its operands' type, `Int + Int` an `Int`, and a typed value
  with a plain number the typed one, so `i + 1` is still an `Index` into the
  array `i` points into; a result outside the type's range is an error at that
  line;
- two different types do not mix: convert one where they meet, as
  `distance + Int(edge.weight)`;
- a comparison is a plain `true` or `false`, read by a condition; declared into
  a variable it takes the domain's one boolean type, or the type written around
  it, as `const hit = Found(values[i] === target);`;
- `values.length` is the array's position type where the domain declares one for
  it, the position just past its last element;
- `Math` and division give a plain number, whole or not depending on the values,
  so the type it should be is written around it where it is computed:
  `Index(values, Math.floor((lo + hi) / 2))`.

Nothing hides a loop, so every step of the work can be shown and counted:

- one-element actions are allowed: reading or writing an element or field,
  `.length`, and `push`, `pop`, `shift`, and `unshift`, which change the array
  in place, so it and its elements keep their identities;
- a search, a copy, or work across every element in one call is refused
  (`.indexOf`, `.includes`, `.find`, `.some`, `.every`, `.slice`, `.map`,
  `.join`, `.sort`, `.reverse`, a spread `...a`): write the loop, labelling its
  steps;
- text is not joined with `+` nor built from a template, and `===` between two
  arrays is refused, as it compares which array each is: compare element by
  element;
- a new array of a given length is made with its type, its every element the
  value given, as `Values.ofLength(values.length, Int(0))`, then filled in a
  labelled loop, as merge sort's scratch array is.

A rearrangement is plain writes labelled as one step, as a swap through a
temporary:
`@swap[const moved = values[i]; values[i] = values[i + 1]; values[i + 1] = moved;]`.

## Views of what a step computed

A label on an expression is a type a view can take:
`<View of="@sweep.pair.test" name="Ask">` views what that expression computed at
a step, its operands named by its syntax, `this.left` and `this.right` for a
comparison or arithmetic, `this.argument` for `!` or `-x`, a function's
parameters by name for a labelled call, and its result `this.value`, each drawn
through its type's view (a plain `true` or `false` as text).
`{@sweep.pair.test}` in a layout draws what that expression computed since the
step before, through the view `{@sweep.pair.test}` chooses, and nothing, keeping
its room, where it computed nothing. A node's words and renders are one
statement, so a node is hidden at each step where a label it reads computed
nothing, and a node reading two labels that never give values at one step, as
`<Node>{@insert.front} {@insert.cmp}</Node>`, is drawn at no step and warned of:
give each its own node. A layout's `of` lists variables; it reads its labels
whether listed or not. A view typed by a label no step evaluates is refused. The
view never computes itself: label the expression, as `@next[i + 1]`, and read
the label.

A label on a block or a statement is a type too. Its view draws one span of the
label: the variables in scope where the span ends, each read as `this.name`. For
example, `<View of="@sort" name="CallFrame">sort {this.lo} to {this.hi}</View>`
draws one call of `sort`. A view of such a label reads only variables in scope
there, and each one it reads needs a type. `{@sort}` in a layout draws the span
that ended at the step, and nothing where none did.

Bubble sort, the question at each comparison and a caption at each swap in one
place:

```svelte
<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 5 });
  const Index = index(Values);
</script>

<script input>
  const values = Values;
</script>

<script algorithm>
  for (@last[let end = values.length]; @more[Index(values, 1) < end]; @shrink[end--]) @sweep{
    for (@first[let i = Index(values, 1)]; @inside[i < end]; @step[i++]) @pair{
      if (@test[values[i - 1] > values[i]]) @swap{
        const moved = values[i - 1];
        values[i - 1] = values[i];
        values[i] = moved;
      }
    }
  }
</script>

<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="@sweep.pair.test" name="Ask">
  <Node>is {this.left} > {this.right}? {this.value}</Node>
</View>
<Layout name="Swapping"><Node>out of order, so they swap</Node></Layout>
<View of="Values" name="Cells"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<Layout name="Board">
  <Node layout="column">
    {values}
    <Node layout="stack">
      <Node when="@sweep.pair.test">{@sweep.pair.test}</Node>
      <Node when="@sweep.pair.swap"><Swapping /></Node>
    </Node>
  </Node>
</Layout>

<Layout name="Stacked">
  <Node>
    <Board />
  </Node>
</Layout>

<Case name="main" values={[5, 1, 4, 2, 3]} />

<Storyboard>
  <Scene name="main" case="main" pause="@sweep.pair.test, @sweep.pair.swap"><Stacked /></Scene>
</Storyboard>
```

Paused at both, a comparison reads "is 5 > 1? true", its operands lifting out of
their cells, and the swap after it says why they trade places. With
`pause="@sweep.pair.swap"` alone the page plays the swaps alone; with
`{@sweep.pair.test}` none the question is left out and the steps stay as they
were.

A label is read in a layout, never in a view, by its full name, the labels
around it first, as `@insert.key` for `@key` inside `@insert`; a shorter ending
is refused with the full names it could stand for, so adding a label never
changes or breaks what a name reads, in the markup or a variant. Only a label on
an expression gives a value, as `const key = @key[values[i]];`: `@name` is what
that expression gave since the step before, drawn at the step's after, and
missing where it gave none or several. It is held at the step ending the span
around it (see Steps), which shows that span whole. So a view shows what a
step's code held though no variable holds it, as the key a whole insertion
inserts, `{@insert.key}`, out of scope once its block ends. Its step ends before
the declaration's name holds the value, so `key` does not exist there: to pause
where a view draws `key`, label the whole statement,
`@key[const key = values[i];]`, and the build warns of a pause on the value
alone where the view draws the name. A label giving a position is drawn by a
pointer, pointing while that code runs.

To mark what a step used, label it and render the position's type at each label,
so every mark looks the same, marking with a label rather than a loop variable
(`@right`, not `i`) where the mark is what the step used:

```js
for (@first[let i = Index(values, 1)]; @inside[i < end]; @step[i++]) @pair{
  if (@compare[values[@left[i - 1]] > values[@right[i]]]) @swap{ … }
}
```

```svelte
{@pair.compare.left}
{@pair.compare.right}
```

A label gives a value only where its code ran, `&&` skipping it included, so the
marks come and go with the comparison, however the value is then used. A label
added for a mark is a place to pause too: paused at, the page pauses as the cell
is picked; else the mark shows at the step its code leads up to.

A place's look holds at every step, and a view cannot choose by a label's value
(`{#if @compare}`), so to mark only what a test let through, label the positions
the code it guards uses and give those places their own look: labelling a swap's
reads, `values[@from[j - 1]]` and `values[@to[j]]`, with
`Highlight.Pointed:@insert.swap.from.fill` and `…to.fill` `red-300`, turns only
the pairs found out of order red, and with `@insert.swap.to` in the scene's
pause, as a step of their own before anything is written. Showing or hiding
something at some steps needs no flag, sentinel, or cast in the algorithm: a
label, a pointer at a label, a view chosen per place, or `<When of="@label">`
below does it.

`<Node when="@insert.swap">…</Node>` shows the node at each step inside a span
of a label, any label: the step that ends a span and those inside it where
labels within pause, whatever the pauses, never steps leading up to it or after
it; elsewhere it is hidden, keeping its room. `when=":before"` and
`when=":after"`, the whole case's stops, show it at the first step, the input as
given, and at the last, as a note the same in every case, as "the array is now
sorted". `when` names one label or stop, written as text, and never reads the
label's value: `when={i < n}` and `{#if @label}` are refused. Nodes that take
turns share one place in a stack, as large as the largest,
`<Node layout="stack"><Node when="@a">…</Node><Node when="@b">…</Node></Node>`;
give them labels that never show at one step, or their texts overlap. Text that
changes from step to step in one place, as a status line saying what each step
does, is one such stack: separate nodes with `when` each keep their own room, so
their texts stack down the page instead of replacing one another. Older sources
write `<When of="@a">…</When>` and `<OneOf>`, which are read as these.

Each outcome of the algorithm, as found and not found, is a label of its own,
and its message a node with `when` of that label. An outcome is decided in the
algorithm, never in a layout by testing the state at `:before` or `:after`.
`return;` ends the algorithm at an outcome, so code after a loop runs only for
the other:

```
<script algorithm>
  for (
    @start[let i = Index(values, 0)];
    @more[i < values.length];
    @next[i++]
  ) @scan{
    if (@check[values[i] === target]) @found{
      return;
    }
  }
  @missing[return;]
</script>
…
<Node layout="stack">
  <Node when="@scan.found">Found {target} at index {i}.</Node>
  <Node when="@missing">{target} is not in the array.</Node>
</Node>
```

What has happened so far is a list for `{#each}`: `spans(@check.at)`, every
value the label has given up to this step:

```svelte
{#each spans(@check.at) as p}{p}{/each}
```

## Queries

A query is a list of the spans of one label, given at every step. Write it
beside the layouts:

```svelte
<Select name="stack" from="@sort" where="started <= now and now < ended" order="depth" max="4" />
```

- Each row is one span of the label. It holds the variables in scope at the
  span's latest stop so far: its `:before` while it goes on, its `:after` once
  it has ended. A view of the label draws each row, as
  `{#each stack as call} {call}{/each}`.
- `where` keeps only the rows for which it is true. It is written in SQL's
  words: `=`, `<>`, `<`, `<=`, `>`, `>=`, `and`, `or`, `not`, numbers, and text
  in single quotes. `now` is the current step. `started` and `ended` are when
  the span began and ended. `depth` counts the calls around the span's call, the
  first call having depth 0. `call.started`, `call.ended` and `call.depth` are
  its call's. A variable in the span's record is read by its name, for example
  `lo`. JavaScript's `===`, `&&` and `!` are refused.
- For example, `started <= now and now < ended` gives the calls going on, the
  call stack; `ended <= now` gives the spans that have ended so far.
- `order` sorts the rows by one or more fields, separated by commas, each
  ascending, or descending with `desc`. Rows with equal fields stay in the order
  their spans began.
- `group` puts rows with the same value of a field together. The result is then
  a list of groups, each with `key` and `rows`.
- In a query of a function's calls, not in groups, a row whose caller is listed
  too has `parent`, its caller's position in the list, so a link can join each
  call to the calls it makes (see Calls).
- `max` is the most rows any input can give, required, so the layout keeps room
  for all of them and nothing moves as rows come and go.
- The result is state, which a layout reads by name, as `{#each stack as call}`.

A scene can step through a query's result, one row a step, in the result's
order:

```svelte
<Select name="levels" from="@sort" where="ended <= now" group="depth" order="depth, lo" max="8" />
<Scene name="levels" case="main" over={levels} as="level"><Level /></Scene>
```

- The query is read as the case ends. Each step holds one row as `level`, or,
  for a query in groups, one group's rows. For example, the levels of merge
  sort: the whole array, then the halves, then the quarters, then the pairs.
- Such a step is no moment of the case, so its layout reads only the list and
  its row: no other variable and no label.
- A scene steps over a list, or through the case's spans with `pause`, `within`
  and `at`, never both.

### Calls

A call type makes each call of an algorithm's function a record that a view can
be of and a query can list. Declare it in the domain, naming the function, the
most calls open at once, and any locals a view reads:

```
const SortCall = call('sort', { max: 4, fields: ['mid'] });
```

- The function's body has a label of its own, as
  `function sort(a, b, lo, hi) @sort{ … }`: a call is a span of that label.
- A view of the call reads its parameters, the locals `fields` names, and
  `result`, the value the call returned, there once it has returned. The build
  refuses any other name, and says to add it to `fields`.
- A query lists calls with `from="SortCall"`, and takes the call's `max` as its
  bound when it gives none.

```
<View of="SortCall" name="Frame"><Node>sort({this.lo}, {this.hi})</Node></View>
<Select name="stack" from="SortCall" where="started <= now and now < ended" order="depth" />
```

A tree of calls, as merge sort's splits and merges, is read from the run: list
the calls started so far, draw each with a view of the call, and link each to
its `parent` in a free layout, which draws them as a tree. Each call shows its
part of the array as its latest stop has it: as split while it goes on, and
sorted once it has returned, so the tree fills in as the calls run. Its `max`
counts every call, 15 for 8 values, not only those open at once:

```
const SortCall = call('sort', { max: 15 });

<View of="SortCall" name="Part">
  <Node layout="row">{#each this.a as v, k}{#if this.lo <= k && k < this.hi}{v}{/if}{/each}</Node>
</View>
<Select name="calls" from="SortCall" where="started <= now" order="started" />
<Layout name="Tree">
  <Node>
    <Node kind="Calls" layout="free">
      {#each calls as call, k}{call}<Link from={call.parent} to={k} />{/each}
    </Node>
  </Node>
</Layout>
```

- Each row's box fits its own part, a leaf one value, so the tree stays narrow;
  `Calls.direction` turns it to run across. Pause at `@sort:before` and `@sort`
  to add each call as it starts and show its part sorted as it returns.
- Never type the tree's lists into the case or the domain: what the algorithm
  does is read from its run.

## Design

The design space is every variable of a component's look, found in its markup:

- `{Int}`, for each type rendered by name: its views and `none` (see Views of
  types).
- `{Index}.pointer`, for each position type rendered by name as a pointer: its
  pointer views and `none` (see Pointers).
- Each layout's frame, its kind's: `ratio`, `justify`, `align`, `padding`, and
  `gap`, as `Stacked.ratio` (see Page frame), so each layout keeps its own; a
  node a layout writes beside what it draws, as a row in its root, is of its
  kind too.
- A listing's, where the view places a `<Listing />`: `listing.language`, its
  lit look, as `listing.lit.radius`, and each region's paint, as
  `listing.lit@insert.compare.left.fill`, which follows its label's mark until
  set, and where it has tokens, `listing.places` (see Listing).
- Each kind of node's props. A kind is the view or layout a node is in, its
  name, as `Items` or `Title`; every node of a view or layout is of its kind. A
  node naming its kind, as `<Node kind="Header">` in `Table`, is of the kind
  `Table.Header`, with the nodes inside it; in a view, as `IntTally.Tally`. A
  pointer view's `<Pointed>` is a kind of its own, as `Here.Pointed`, and so is
  a layout's or view's `<Link>`, as `Graph.Link`. A variable is its kind and
  prop, as `Here.Pointed.fill` or `Items.Under.shown`.
- Each place's own, for a value in braces (see Places).
- Each prop a view binds to its value, as `VertexCard=true.fill` or
  `LevelCell.textSize.from`, or a length's unit, as `Bar.height.unit` (see Props
  bound to a view's value).
- The design's tokens and groups, which set many kinds at once (see Shared
  values).

A view's or layout's name is its kind, and so is a node's `kind`, so each names
what its nodes are, never how they look: `Caption`, `Visited`, `Under`, not
`Amber` or `Big`. Each has a name of its own in the whole view, nested ones
included, as `CurrentCaption` and `NeighbourCaption` inside two pointer views,
never `Caption` in both; a layout is not named as a type, and a tag names a
layout, so every kind is known before the view runs. A `kind` is written as it
is, one capitalised word, or as an expression whose every result is such a word
written in the source, or `undefined` for the view's or layout's own kind, as
`kind={k === j ? 'AtJ' : k < i ? 'Sorted' : undefined}`: the node takes the kind
its expression gives at each step, so one node, not an `{#if}` doubling it,
marks a cell; at a step where a variable the expression reads does not exist, as
`j` at a `:before`, the node is still drawn and the expression reads that
variable as `undefined`, so `k === j ? 'AtJ' : 'Cell'` gives `'Cell'` (a
`{@const}` name as well, where a variable its value reads does not). The nodes
inside it keep the kind around it, and a kind built from text, as
`kind={'At' + name}`, is refused. Nodes of one view or layout naming the same
kind are one kind, and it is named apart from every view and layout. Name a kind
after what the node is, never after a type: with a type `Distance`, write
`kind="DistanceLabel"`, not `kind="Distance"`. A kind written on several nodes,
as each header cell, is one kind, so they look alike.

Every kind of node has these props, each with a fixed set of options:

- `shown`: whether its nodes are drawn; one left out takes its children and
  keeps no room. A render is missing where its view is `none` or not shown or it
  draws an absent value: for a whole presentation left out, keeping no room, and
  at one step hidden, keeping its room. A part that reads a variable which does
  not exist at a step, not declared yet, as at a `:before`, or out of scope, is
  not drawn there and keeps its room: a node by what it reads (its `kind`
  aside), an `{#if}`, `{#key}` or `{#each}` with all it holds by its test. A
  `{@const}` name reads what its value reads, so after `{@const next = j + 1}` a
  node reading `next` hides where `j` does not exist, and the node holding the
  `{@const}` does not. No check for existence is needed. A node of only text and
  renders is one statement that one missing render takes whole, a layout's tag
  in it counting as a render, so `<Node>swap {@swap.a} and {@swap.b}</Node>`
  hides at a step that swaps nothing; a node holding other nodes has parts, each
  node and render in it, and goes only with all of them, so in
  `<Node layout="row"><Node>lo {lo}</Node><Node>mid {mid}</Node></Node>` only
  the `mid` part hides while `mid` is out of scope (a layout drawn by its tag in
  it counts as its nodes do). Split a sentence into parts to keep what is there.
  A node holding no render, as a title, stays. A `<Pointed>` kind has no
  `shown`: to drop a pointer, leave out a node around its `<Pointed>`, give its
  type's view `none`, or render it in `{#if}`, its elements then drawn as
  without it.
- `fill` and `stroke`: `none` or a colour; `color`: the text's colour. A colour
  is white, black, a hue-shade, as `sky-200`, or an exact colour of the base's
  palette, as `#E69F00` (see Shared values).
- `strokeWidth`: 0, 0.5, 1, 1.5, 2, 3, or 4 pixels; `strokeStyle`: solid, dashed
  (suiting a place rather than a value), or dotted; `opacity`: 0.25, 0.5, 0.75,
  or 1.
- `font`: sans, serif, mono, legible (a sans made to tell like letters apart),
  casual (rounded, handwritten), or slab (a serif with square, heavy serifs);
  `textSize`: 12, 14, 16, 18, 20, 24, 30, 36, or 48 pixels; `weight`: normal or
  bold.
- `padding`: 0, 0.0625, 0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, or 2 em;
  `radius`: 0, 2, 4, 6, 8, or 12 pixels, or 999 for a circle or pill; `minSize`,
  the least width and height: 0, 1, 1.5, 2, 2.5, 3, or 4 em. Padding is space
  inside a box: give it to a kind that shows a fill or a stroke, and none to a
  node arranging others, whose items its `gap` spaces; a page's padding is its
  margin, which a row written in it without a kind takes too, so give such a row
  a kind of its own.
- `shadow`: none, soft (a faint blur below), lifted (deeper and further down,
  raised off the page), or hard (a crisp block down and to the right, in its
  stroke colour or else its text's, a flat graphic look); `glow`: none or on, a
  halo in its stroke colour or else its fill's; `fillStyle`: solid or hatched
  (diagonal lines over the fill). These paint round or over the box a node
  draws, so only where it draws a fill or stroke, and take no room of their own:
  each node keeps room round its box for the farthest its shadow and glow, and
  any pointer's at it with its expansion, reach on each side in any state, so
  none lies over a neighbour or past the drawing's edge, and nothing moves as a
  pointer passes.
- `decoration`: none, underline, or strike, a line under or through its own
  text, not its child nodes'; `case`: normal, uppercase, or small-caps (lower
  case as small capitals) for its own text, a value's unit keeping its own.
- `width` and `height`: uniform or varying. Every box keeps a slot, the room it
  needs at its largest over every step and value, which never changes; uniform
  draws the box as wide or tall as its slot, the same whatever the value, and
  varying at the size of what it holds at each step, the slot keeping the rest,
  so a varying box changes size in its slot and nothing around it moves.
  `xAnchor` and `yAnchor`, start, center, or end, place a varying box in its
  slot, left to right and top to bottom, and so say which edges of boxes side by
  side line up. A `<Pointed>` kind has none of these. Uniform suits a place, as
  a cell of an array; varying a node whose size or shape means something, as a
  tag hugging a name, or an array whose box shows its length, not its `max` (an
  array's kind starts anchored at `start` along its axis, so the slots in use
  never move as it grows).

A kind arranging its children, with a `layout`, an array, or links, also has
`spacing`, slots (each child in its slot, a `gap` between slots) or packed (each
at its own size along the row or column, a `gap` between them, so a growing
child moves the next; the node itself keeps room for every child's largest, and
for its pointers' `expand`, so nothing outside it moves), `gap` (as `padding`),
`align` (start, center, or end, across) and `justify` (start, center, end,
between, around, or evenly, along; for a grid, see Grid); where an array's node
has more room than its tracks need, `justify` start, center, or end puts the
room after, around, or before them, and between, around, or evenly spreads the
tracks over it; an array's kind starts at center where every value of its type
keeps one length throughout, as an array being sorted, and at start where one
grows or shrinks, as a queue, so no element moves as another comes or goes. A
row or column is a grid of one row or column (see Grid), so positions past an
array's ends are drawn in end slots, tracks before its first element and after
its last, kept only as far as drawn positions go. A `<Pointed>` kind has
`overflow`, shown (drawn past the ends) or hidden (nothing there, keeping no
room). A link's kind has `shown`, `stroke`, `strokeWidth`, `opacity`, and
`strokeStyle`; `route`, `layout` (as its layout's arrows run, the start),
`straight`, `curved` (each arrow choosing its own side and how far to bow round
what is in its way), or `wire` (straight runs turning only at right angles,
round the boxes, side by side apart); `head`, the mark at each end a link points
to, `none`, `arrow` (a filled triangle), `open` (an outlined one), `vee`, `dot`,
`diamond`, or `bar`, which starts at `none` where every link of the kind is a
two-way line and `arrow` otherwise; and `headSize`, 6, 9 (the start), 12, or 16
pixels. A label's look is its own nodes' kind.

A kind with a free layout (see Free layout and links) also has that layout's
look. `form` is the shape it gives the structure its links make, read from the
arrows present at every step (a link that comes and goes is drawn on top of it
but does not change it): a path such as a linked list, a cycle, a tree, or a
layered graph (acyclic, with nodes that have several parents, or with cycles and
a start, a node no arrow points to). Every structure takes every form: `natural`
(the start), the structure's own shape, a path in a line, a cycle closed into a
ring, a tree branching, and a layered graph stacking its layers, each ordered so
its arrows cross as little as they can (an undirected graph's layers, and those
of a graph with cycles, are each node's distance from its first or its start);
or, along its reading order (a path in link order, a tree depth first, a layered
graph each node after its parents, or breadth first where it has cycles),
`line`, `snake` (rows read back and forth), `wave`, `arc`, or `scatter` (free
positions that keep each node near the next). `direction`, `down` or `right`, is
the way a `natural` or `line` layout runs where no `flow` sets it, as a `flow`
would: it starts `right`, across the wide stage, a tree too, so a page starts
near 16:9; set `down` where the participant asks for it. A layout with a `flow`
has none. A layered graph also takes `layered`: its layers as in `natural`, but
each packed by its own nodes' sizes, so the graph is tighter (dagre, the layout
of Graphviz's dot, on the server); a tree, whose children keep their order, does
not take it, and its seed changes nothing. A layout whose data makes no
structure has no `form` or `direction` and is laid out freely, unless the page
finds a structure in the links it draws, which it draws `natural`. `curve`,
`straight` (the start) or `curved`, is how its arrows prefer to run.
`layoutSeed`, 1 to 32, is what its spacing and nudges are drawn from: the order
each layer of a layered graph starts in, a `wave`'s, `arc`'s or `scatter`'s
shape, and where a layout with no structure starts; a tree or a path drawn
`natural` is the same at every seed. A free layout keeps its form's own
proportions and takes the size of everything it draws, its links' curves, heads
and labels included, so the same values draw the same layout wherever it is,
whatever the frame or what is beside it.

The colours are white, black, and 18 hues (neutral, red, orange, amber, yellow,
lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia,
pink, and rose) in 11 shades from 50, the lightest, to 950, as `blue-600`.
Colours that tell things apart must differ to readers with red–green colour
blindness too: differ in lightness, three shades or more (`amber-100` against
`red-300`, not `red-100`), or as blue against orange or amber, never as red
against green or another hue alone. The starter's look is safe, neutral with one
amber accent.

### Props bound to a view's value

Inside a view, and only there, a node's look may follow the view's value: a prop
written as an expression of `this`, its fields, and comparisons and arithmetic
of them, as `<Node fill={this.seen}>` or `<Node textSize={this.level}>`. Any
prop above with options of its own may be bound but `shown`, which `<When>`
decides. The expression's values, worked out from the view's type before the
algorithm runs, must fit the prop's options: a colour tells apart its colours,
`opacity` four values, `weight` two. A `Level` of
`type('integer', { min: 0, max: 3 })` fits `opacity`, an `Int` from 0 to 99 does
not: group it in the expression, as `opacity={this > 50}` or
`textSize={Math.floor(this / 25)}`. A constant look stays the design's, so a
bound prop reads `this`, or a name read from it: an `{#each}` item, of its
array's element type, as `fill={v.seen}` in `{#each this.vertices as v}`, its
index, of the array's position type (one before it to its `max`), and a
`{@const}` name of a field. In a view of a label, `this.left`, `this.right`,
`this.value`, or a labelled call's parameters have the type the algorithm gave
them; an operand of no type, a plain number as the `2` in `@small[n < 2]`, has
no values to bind: give it a type where the algorithm computes it, as `Int(2)`.

- `true` and `false` are unordered: each has a variable of its own over the
  prop's options, as `VertexCard=true.fill` and `VertexCard=false.fill`,
  starting with false neutral and true in a hue, and so are words written in the
  expression, as `this.seen ? 'new' : 'old'`, each one word.
- Numbers, and an enumeration's values in its declared order, run in order: a
  `State` of `type(['Unseen', 'Queued', 'Done'])` runs from `Unseen` to `Done`,
  and a union of enumerations through its members in turn. They go only onto
  props whose options run in order (`textSize`, `strokeWidth`, `opacity`,
  `padding`, `radius`, `minSize`, `weight`, `gap`), taking consecutive options
  from `.from`, as `LevelCell.textSize.from`, or onto a colour, taking the
  shades of `.hue`, lightest first, as `VertexCard.fill.hue`; `.order` runs them
  `up` or `down`. Declare an enumeration in the order its values should read, as
  a vertex's progress.
- One kind binds a prop to one expression's values: two nodes of a kind binding
  it differently need kinds of their own (`kind="Visited"`). A bound prop that
  sizes a box keeps the box at its largest over every step, as every box does.
- `width` and `height` are lengths, bound only in a view: the value times a unit
  of the node's kind, from zero, as `<Node height={this} />`, a node sized by
  its value. Any number of values fits, but none below zero. The unit, in pixels
  per unit, is a variable, as `Bar.height.unit` (1, 2, 3, 4, 6, 8, 12, 16, or
  24), starting at the largest that keeps the type's largest value within 200
  pixels, and every node of the kind shares it. Such a node holds nothing, no
  text, nodes or values, so it is exactly its length: 0 draws only its border
  and 1 one unit. Put a label beside it, as
  `<Node layout="column"><Node kind="Length" height={this} /><Node value={this} /></Node>`.
  It sits in a room as long as its type's largest value, which keeps that room
  wherever it is drawn, a pointer on it or not, so nothing around it moves; the
  node itself is only its length. A bound axis has no `width` or `height`
  variable, its size being the value; the kind's anchor along it places the node
  in its room, starting at `end` for `height` (`Bar.yAnchor`), so the nodes of a
  kind stand on one baseline, and `start` for `width` (`Bar.xAnchor`). A kind
  sizes an axis by its value in all its nodes or none: a kind passes to the
  nodes inside it, so give the node sized by its value a kind of its own, as
  `<Node layout="column"><Node kind="Length" height={this} />{this.name}</Node>`.
  Anywhere else a box sizes to its contents, at least its kind's `minSize`.
- `icon` draws an icon for each value, bound only in a view, as
  `<View of="State" name="StateMark"><Node icon={this} /></View>`: each value
  has a variable of its own whatever its type's order, as `StateMark=done.icon`,
  starting on distinct icons. The icon is drawn before the node's value or text,
  in its colour and size, or alone in a node with neither; a node arranging
  children has none. Its options: `circle`, `circle-dot`, `circle-check`,
  `circle-x`, `circle-alert`, `circle-question-mark`, `check`, `x`, `flag`,
  `star`, `target`, `map-pin`, `lock`, `lock-open`, `eye`, `eye-off`, `search`,
  `hourglass`, `play`, `pause`, `ban`, `zap`, `key`, `house`, `crown`, `trophy`,
  `heart`, `skull`, `bug`, `flame`, `snowflake`, `sparkles`, `link`, `unlink`,
  `arrow-up`, `arrow-down`, `arrow-left`, `arrow-right`, `plus`, `minus`,
  `infinity`, `user`.
- `icon` written bare, as `<Node kind="Arrow" icon />`, draws one icon its
  kind's design chooses, the variable `Arrow.icon` over the same options. In a
  pointer view it marks where the pointer is, for example
  `<View of="Index" name="CurrentMark"><Node layout="column"><Pointed /><Node kind="Arrow" icon /></Node></View>`,
  and starts as `arrow-up`. A written name, as `icon="flag"`, is refused.

```svelte
<View of="Vertex" name="VertexCard">
  <Node layout="column" fill={this.seen}>{this.name}</Node>
</View>
<View of="Level" name="LevelCell"><Node value={this} textSize={this} /></View>
<View of="Int" name="Bar"><Node height={this} /></View>
<View of="Int" name="Labelled">
  <Node layout="column"><Node kind="Length" height={this} /><Node value={this} /></Node>
</View>
```

### Places

A value in braces is a place, named after `:` by what is written there: a label,
by its full name and keeping its `@`, as a label marks a moment of the run, a
variable, or a field, as `{@pair.compare.left}` at `:@pair.compare.left`,
`{found}` at `:found`, and `{this.left}` in `Ask` at `Ask.` and `:this.left`. A
value written another way, as `{values[0]}`, is none. Every value in braces is
drawn by the view its type's variable chooses, in its kinds' looks; a place has
variables of its own that fall back to those until a variant sets them, so one
value is drawn apart with nothing declared:

- its own choice of view, where its type has more than one view of the kind it
  draws, as `{Index}:found` or `{Int}:@swap.held`;
- its own `shown`, `fill`, `stroke`, and `color` for the kinds of each view it
  can draw, the kinds its nodes name included, as
  `Highlight.Pointed:@pair.compare.left.fill` or
  `IntTally.Tally:@swap.held.shown`, though not for another view that view
  renders.

A place sets only paint and whether it is shown, never how much room anything
takes: its padding, text size, font, weight, stroke width, corners, sizes, and
anchors are its kinds', at every step and in every place, so a place lit at one
step and not the next moves nothing. The same holds for whatever changes a look
from step to step: a pointer's paint shows only where it is, the rest of its
look in every slot, and a listing's lit regions set their own fill, stroke, and
colour only.

```json
{
  "{Index}.pointer": "Highlight",
  "{Index}:found": "Arrow",
  "Highlight.Pointed:@pair.compare.left.fill": "sky-100",
  "IntCell:@swap.held.fill": "neutral-100"
}
```

In a key the last part is the prop, and the dots after `:` the place's. A place
drawn both as a mark and as a number writes its mark's view
`{Index}.pointer:found`. A label and a variable of one name are two places,
`:@held` and `:held`.

### Shared values

A key's mark says what it sets: `$` a token, `<…>` every kind its tag makes,
`{…}` the view a type is drawn with, `:` a place, `=` a value of the data, and
no mark one kind. `@` names only a part of the run, a label, as in the source:
it says when, as `:` says where, so a place drawn from a label's value is
`:@label`.

- A token is one value the starter's kinds share: `$text` (text colour),
  `$font`, `$surface` (the fill of framed values), `$accent` and `$highlight` (a
  pointer's stroke and fill), `$spacing` (framed values' and pointers' padding),
  `$radius` and `$lineWidth`. Every kind that starts with a token's value
  follows it, so `{"$spacing": 0.25}` tightens every framed value and pointer.
- A group sets one prop for every kind its tag makes that has it:
  `<Node>.padding` for every node's kind (never a `<Pointed>`'s or a
  `<Link>`'s), `<Pointed>.fill` for every pointer, `<Link>.strokeWidth` for
  every link, and `<Listing>.syntax` for the listing, as `listing.syntax`. Its
  value is one of the prop's options or a token, as
  `{"<Node>.fill": "$highlight"}`. A group is set only where a variant sets it,
  and never sets `shown`.
- A style is a `$` name holding a group of props, as a CSS class does:
  `$cell.stroke`, `$cell.padding`. A kind inherits one style, or one kind of its
  role, and takes each prop it sets: `IntCell.inherit: "$cell"`, or
  `Goal.inherit: "VertexCard"`. A style's prop is one of its prop's options or a
  token, as `"$cell.fill": "$surface"`, and fits every kind inheriting it. A
  kind cannot inherit a kind that inherits it back, and inherits nothing by
  default (`none`).
- A base is what every kind starts from, written out in the design as values:
  its tokens; a style for each role's look, as `$Value` for every framed value,
  `$Container`, `$Bar`, `$Vertex`, `$Text`, `$Code`, `$Icon`, `$Pointed` and
  `$Link`, which every kind of that role follows; its scales; its palette; and
  the listing's look. `"..."` at the top names it, as `"...": "$textbook"`.
  Every design names its base and holds every role's look: the app has no look
  of its own. A design that comes in naming none, as a first version's or a demo
  example's, gets the starter base, `"...": "$starter"`, written in; one naming
  a base but missing a role's look is refused, naming what is missing.
  - A scale is the steps a prop takes, numbers separated by spaces:
    `scale.spacing` for `padding` and `gap` (em), `scale.radius`, `scale.type`
    for `textSize` and `scale.line` for `strokeWidth` (pixels), and
    `scale.opacity`. Where a design sets one, every kind, group and token takes
    only its steps (a line 0 too), so `"scale": {"radius": "0 4 999"}` refuses
    `radius` 8.
  - A palette names exact colours, as `"palette": {"accent": "#E69F00"}`, and
    each is then an option of every `fill`, `stroke` and `color` beside the
    named colours.
  - A base holds values the source may not use, as the listing's look where no
    `<Listing />` is placed; those are left out without a word.
- A kind's own value overrides what it inherits, that its group, its group its
  role's style in the base, and that the token: with
  `{"$spacing": 0.25, "<Node>.padding": 0.5, "IntCell.padding": 0}`, pointers
  take 0.25, every node's kind 0.5, and IntCell none. A kind set apart once
  stays apart when what it follows changes later, and a place, as
  `IntCell:v.fill`, overrides its kind as before.
- The design reads nested, one object for each style, group and kind, as
  project.design's levels and values and the Choices file show it: `"..."` is
  what a kind inherits, a nested kind sits inside its view's object, and a place
  or a value is a key inside its kind's:

  ```json
  {
    "$cell": { "stroke": "neutral-500", "padding": 0.25, "radius": 4 },
    "<Node>": { "padding": 0 },
    "IntCell": { "...": "$cell", ":target": { "stroke": "violet-500" } },
    "VertexCard": { "...": "$cell", "radius": 999 }
  }
  ```

  The assistant writes the values it sets in the same nested form, as one JSON
  object in a string, applied over the viewed variant's values as a JSON Merge
  Patch: an object merges into what it names, and `null` removes a value, so it
  returns to what it inherits or follows. To make the value cells rounder with a
  darker frame, the goal's own fill removed, and every number shown as a tally:

  ```json
  {
    "$cell": { "radius": 8, "stroke": "neutral-700" },
    "IntCell": { "...": "$cell" },
    "Goal": { "fill": null },
    "{Int}": "IntTally"
  }
  ```

  written in the decision as
  `"values": "{\"$cell\": {\"radius\": 8, \"stroke\": \"neutral-700\"}, \"IntCell\": {\"...\": \"$cell\"}, \"Goal\": {\"fill\": null}, \"{Int}\": \"IntTally\"}"`,
  and `"{}"` for none. Text that is not one JSON object goes back to be written
  again.

### Variants

A variant gives every variable a value, and a presentation draws one. The
starter is each type in its first view, each kind in a plain look for what it
is: values framed, nodes sized by their values filled grey as bars, text and
layouts unframed, and pointers marked in amber. Every variant shows the same
steps, those the scenes pause at. A presentation built after a change keeps the
values of the one it was made from where nothing else sets them, and takes the
starter's for anything new; the assistant sets values with `vary`, or with
`edit` or `revise` for the source it changes, and asking for several variants,
or Another variant (in dev mode), draws the values at random, keeping what the
conversation settled. A value for a variable the design does not have is left
out, and the build warns, naming it; a value outside its variable's options is
refused.

### Declare what varies

The markup decides what can vary, so write it so the choices worth comparing are
variables:

- Give everything that means something of its own a kind of its own, so its look
  is a variable of its own and a variant can leave it out: a title, a caption,
  an index, a pointer's label. In a page, a layout of its own draws it, as
  `<Title />`; inside a view, a node naming its kind, which sees the view's
  value, as `Under` and `Tally` below.
- Draw what the state means with views of its own: an answer, as the position a
  search finds, by a pointer of its own, and a mark meaning something else at
  some steps by another pointer, rendered in `{#if}` or at a label, so a found
  element can look different from a checked one.
- Draw what each step changes that the participant follows; a step whose change
  nothing draws looks like the step before, as a list reversal drawing only
  `cur` would at each step changing `prev`.
- Give a source a listing of the algorithm as taught (see Listing), and more
  than one view of a type where the request leaves open what it shows (see Views
  of types), as a position's number and its element's name; the design decides
  whether a variant shows each, set by the assistant (as `listing.language`
  none).
- Never write a look into the markup: a look the participant asks for is the
  values of a kind.

```svelte
<View of="Int" name="IntTally">
  <Node layout="column"><Node value={this} /><Node kind="Tally">{'•'.repeat(this)}</Node></Node>
</View>
<View of="Values" name="Items">
  <Node>
    {#each this as v, k}
      <Node layout="column">{v}<Node kind="Under">{k}</Node></Node>
    {/each}
  </Node>
</View>
```

## The subset

- Allowed: numbers, strings, booleans, and the arrays and records their types
  make; `if`, `for`, `while`, `do ... while`, each test and each part of a `for`
  header labelled, not `for … of`; `break`, `continue`, and functions at the top
  level of the algorithm block (see Loops and functions); `&&`, `||`, `??`, and
  `? :`; writes with `=`; JavaScript's operators on values, `++`, `+=`,
  `.length`, `push`, `pop`, `shift`, `unshift`, `Type.ofLength(n, x)`, and
  `Math.abs/ceil/floor/max/min/pow/round/sign/sqrt/trunc` and `Math.PI` inside a
  type (see Computing).
- Not allowed: `null` and `undefined`, other functions, such as arrow functions
  and functions inside blocks, anything that hides a loop (searches, copies,
  spreads, whole-array methods), text joined with `+` or templates, `new`,
  classes, `this`, `==`, string methods, other globals, and array or object
  literals except inside a type or `.push`/`.unshift`, or assigned to an element
  or field.
- Limits: 200 steps a presentation shows, at the labels it pauses at; 2,000 ends
  of labels in all; 1,000,000 operations; 10,000 entries per array or object;
  and 10,000 characters per string.

## Library

Nodes say nothing about what a structure means by themselves: nodes laid out as
a row can show an array, a list of linked nodes, a queue, or anything else.
Decide the meaning from the participant's request, and when they leave it open,
offer views that draw each reading.

### Page frame

Every view sits in a page frame, a canvas laid out at a fixed logical width
(1200 pixels) and scaled to fit, so every presentation renders identically
whatever the pane size. The frame is the root `<Node>` of the layout a scene
shows, and its values are that layout's, so each scene's layout keeps its own,
though the presentation keeps the first scene's ratio throughout: its ratio is
`Stacked.ratio` (fit, 16:9, 4:3, 3:2, 1:1, 3:4, or 9:16), fit in the starter,
taking the shape of what it holds between 16:9 and 9:16; keep fit unless the
participant asks for another shape. It lays out what its root holds in the
root's `layout`, a column or a row, `Stacked.gap` apart, spread and aligned by
`Stacked.justify` and `Stacked.align`, as between to put a title at the top and
a note at the bottom, with `Stacked.padding` inside its edge. Use its width: lay
sequences out across it rather than down it. Participants select nodes by
clicking or dragging a box, to point at them in feedback, and the whole page by
clicking the frame's empty space; they scroll to zoom, drag with the middle
button or with Space held to pan, and double-click empty space to reset, and the
view is kept as they step through. Every node is selectable, so draw each thing
a participant might want to point at, such as a cell, a pointer name, or a
caption, as a node of its own.

### Listing

`<Listing />` shows the algorithm as taught beside the view, the flow the
participant follows, in the code or pseudocode they know or a textbook's,
exactly as written, lighting the code each step ran. The algorithm block is what
runs and the listing what is read, and they meet through labels, so the
algorithm is written as the language needs (typed values, labels) while the
listing reads as the lesson; when the algorithm changes, its listing follows.
Place it outside views, in a layout, as
`<Node layout="row"><Listing /><Node layout="column">…</Node></Node>`; it takes
no props or children, and each of its lines is a node participants can select.
The text is a `<script listing="textbook">` block; with several,
`listing.language` chooses which one a presentation shows, the first in the
starter, or `none`.

Mark each part of the text that should light as a region, `@name[text]`. A
region names one of the algorithm's labels (see Steps). A label's full name is
the chain of labels around it in the algorithm: `@test` inside `@pair{` inside
`@pass{` is `@pass.pair.test`. A region names a label in one of three ways:

- by its full name, `@pass.pair.test[…]`;
- by its short name, `@test[…]`, when no other label has that name;
- by nesting inside regions of the labels around it,
  `@pass[… @pair[… @test[…]]]`.

A short name that more than one label has is refused, and the message names
them. A `for` header's labels sit beside its body's label, not inside it (see
Steps). Regions nest as finely as needed, for example
`while @test[@bound[j > 0] and @cmp[A[j] > key]]`. A `[` without a name, as in
`A[i]`, is text, and the marks are not shown. Under a procedure's name, indent
its body one level, as a textbook does. Write `<`, `>` and `&` as they are: a
listing needs no escaping, and an escape such as `&lt;` is refused. Every region
must have a label. A label a scene pauses at needs a region, lit where it
pauses; without one, that step lights nothing and the build warns. A label no
scene pauses at needs none. A region holds the text of what its label marks and
no more: a loop's or an `if`'s own line goes with its test's label or none,
never inside its body's, as `for i = 2 to n` stays outside `@insert[…]`; a test
with a line of its own has a label of its own, as
`while (@more[Waiting(queue)])` with `while @more[the queue is not empty]`, and
the scenes' pauses decide whether to pause there.

- Only the code of labels the steps pause at lights, all in one look: a step's
  label's region with the code inside it; other code stays dark, so label what
  should light, as `@bound[j > 0]`, and pause at it.
- A region lights without the regions inside it that did not run since the code
  around them started, so once `j > 0` fails, `A[j] > key` stays dark. Code kept
  as run lights only once it is done, once the step has left it or, for a loop
  or an `if`, its test has finished, so a comparison whose operands are still
  being found, a line half run, or a loop's line while its test runs stays dark.
- Where a region's own text, outside the regions inside it, has a line for each
  statement its label marks, each line lights for its own statement; otherwise
  it lights as one. A line lights from its first character to its last, never
  its indentation.
- A token, `:name[text]`, marks text as a reference to the place a layout draws
  at `:name` (see Places), as `:mid[A[mid]]` for `{mid}` or `:key[key]` for
  `{key}` in a layout. Its `:` follows a space, a bracket, or the start of a
  line, never a name, so `x := y` and `a : b` hold none. Tokens are written by
  hand, never matched by name, so `:j[A[j + 1]]` names `:j` where the
  pseudocode's `j` is the algorithm's `j - 1`. Tokens and regions nest either
  way, as `:x[A[@left[j - 1]]]`, a region inside a token keeping its prefix; a
  token inside another, an unclosed one, or one naming a place nothing renders
  is an error. When a step's own code, not code kept lit from earlier, overlaps
  a token, the step touches its place: every token naming it and its references
  in the picture light together, in the colour of the place's mark, its pointer
  view's `<Pointed>` fill (`Mark.Pointed:i.fill`) or its value's view's
  (`IntCell:key.fill`), or its stroke where the fill is none or white. In the
  picture, a place is the element a pointer at it points at, or the outermost
  node of a value rendered there or of a pointer view with nodes around its
  `<Pointed>`, a caption's number included. Hovering any reference outlines the
  others, dashed in the place's stroke (its fill where it has none), drawn in a
  darker shade of its hue where it would show at less than 3:1 on the page, so a
  pale fill still outlines. `listing.places`, there only where a listing has
  tokens, says how places light: `fill` (the start: the token filled, a 3px band
  round the node), `underline`, `outline` (a ring), or `none`, which lights
  nothing and links nothing on hover; none takes room.
- A token can also go in the text of a layout or a view, for example
  `<Node kind="Note">Lift :i[A[i]] into :key[key].</Node>`. It means the same as
  in the listing. It is drawn as inline code, a kind of its own named `Code`
  (here `Board.Note.Code`) that starts in monospace. It lights at the same steps
  as the listing's tokens for its place, and hovering it outlines the place's
  other references. A token naming a place nothing renders is refused.
- The lit look is `listing.lit`, with a kind's `fill`, `stroke`, `strokeWidth`,
  `strokeStyle`, `radius`, `weight`, and `padding`, and `color`, `none` keeping
  the listing's ink; a stroke is drawn inside the lit text and its padding takes
  no room, so lighting never moves the text, and a `radius` of 999 makes a pill.
  Each region is a place, by its label's full name, with its own `fill`,
  `stroke`, and `color`, as `listing.lit@insert.compare.left.fill`, falling back
  to its label's mark where the root draws the label as a pointer, so the code a
  mark stands for looks as its cell does, otherwise to `listing.lit`. A region
  in another paint than the region around it is drawn inside it.
- `listing.syntax` sets how the listing's words look: `keywords` (the starter)
  draws its keywords in bold, as textbooks print them; `colour` also colours
  keywords, strings, comments and numbers; `none` draws plain text. The
  listing's name chooses its keywords: `python`, `javascript`, `java` or `c`
  (with C's types, `#include` lines and `/* */` comments), or a name starting
  with one, as `c99`; any other name, such as `textbook`, reads as pseudocode
  (for, while, if, then, return, to, …). So name a listing in a real language by
  that language, as `<script listing="c">` for C code, or its types and strings
  read as plain text. Lit code keeps its own colour over the syntax colour.

Insertion sort, beside a textbook's pseudocode, its tokens naming `i`, `j`, and
`key`:

```svelte
<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 4 });
  const Position = index(Values);
</script>

<script input>
  const values = Values;
</script>

<script algorithm>
  for (@start[let i = Position(1)]; @more[i < values.length]; @next[i++]) @insert{
    @key[const key = values[i];]
    @init[let j = i;]
    while (@test[@bound[Position(0) < j] && @cmp[(values[j - 1]) > key]]) @shift{
      @copy[values[j] = values[j - 1];]
      @down[j--;]
    }
    @place[values[j] = key;]
  }
</script>

<script listing="textbook">
  INSERTION-SORT(A, n)
  1  for @start[i = 2] @more[to n] @next[step 1]
  2      @insert[@key[:key[key] = :i[A[i]]]
  3      // Insert A[i] into the sorted subarray A[1 : i - 1].
  4      @init[j = i - 1]
  5      while @test[@bound[j > 0] and @cmp[A[j] > :key[key]]]
  6          @shift[@copy[:j[A[j + 1]] = A[j]]
  7          @down[j = j - 1]]
  8      @place[:j[A[j + 1]] = :key[key]]]
</script>

<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Position" name="Mark"><Pointed /></View>
<Layout name="Key"><Node>key {key}</Node></Layout>
<View of="Values" name="Cells"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<Layout name="Board">
  <Node layout="row">
    <Listing />
    <Node layout="column"><Key />{values}</Node>
  </Node>
</Layout>

<Layout name="Stacked">
  <Node>
    <Board />
    {i}
    {j}
  </Node>
</Layout>

<Case name="main" values={[5, 2, 4, 1]} />

<Storyboard>
  <Scene name="main" case="main" pause="@insert.key, @insert.shift, @insert.place"><Stacked /></Scene>
</Storyboard>
```

### Maths

Write inline maths as LaTeX between `$$` and `$$`, in a node's text or in a
listing, for example `$$O(n \log n)$$` or `$$\frac{n(n+1)}{2}$$`. `\(…\)` works
too.

- In a node, the maths is typeset as in LaTeX: fractions, sums with limits,
  roots, sub- and superscripts, Greek letters and every command of LaTeX's base
  and `amsmath`. It is a node of kind `Math`, with its own looks in the design,
  and it takes the text colour.
- The build refuses TeX it cannot read, giving the reason.
- In a listing, the maths is written as Unicode text on the line, as `aᵢ ≤ aᵢ₊₁`
  for `$$a_i \le a_{i+1}$$`. There, the build refuses what has no form on one
  line, and says what to write: a fraction (write `(n+1)/2`), stacked limits,
  accents, or a subscript Unicode has no letters for (write `A[mid]`, not
  `A_{mid}`).
- A token, `:i[…]`, or a region, `@x[…]`, cannot be inside maths: write it
  beside the maths. A single `$`, as in `$5`, is text.

### Drawings

When a value is best shown as a picture, such as a playing card's suit, draw it
with SVG shapes in `<Svg>`, inside a node of a view or layout:

```svelte
<View of="Suit" name="SuitMark">
  <Node>
    <Svg viewBox="0 0 24 24" height="1.5" label={this}>
      {#if this === 'hearts'}
        <path d="M12 21 C4 14 2 10 6 6 C9 4 12 6 12 8 C12 6 15 4 18 6 C22 10 20 14 12 21 Z" />
      {:else}
        <path d="M12 3 C4 10 2 14 6 17 C9 19 11 17 12 15 L10 21 H14 L12 15 C13 17 15 19 18 17 C22 14 20 10 12 3 Z" />
      {/if}
    </Svg>
  </Node>
</View>
```

- `viewBox` gives the drawing's coordinates and proportions, `height` its height
  in em of the node's text (1.5 if left out, at most 12), and the width follows
  from the proportions. Both are written as they are, never computed, so every
  value has the same room; the shapes outside the viewBox are cut off.
- `label` is the text the drawing stands for, as `label={this}`, which a screen
  reader reads.
- The shapes are `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`,
  `polygon`, `g`, and `text`, `tspan` and `title` holding words as written. They
  take their geometry (`d`, `cx`, `r`, `points`, `transform`, …) and strokes
  (`stroke-width`, `stroke-linecap`, …), which may be computed from the value,
  as `r={this * 2}`.
- Shapes are filled in the node's text colour; `fill` and `stroke` are
  `currentColor` or `none`, so the design's colours apply.
- `{#if}` and `{#each}` choose the shapes by the value. The value is never shown
  as text inside the drawing: write it in the node beside the drawing, as
  `{this.rank}`.
- A drawing holds nothing else: no link, image, style, script or handler.

Keep a drawing simple: a few shapes that fill the viewBox, with strokes thick
enough to read at a cell's size.

## Node

A node is one of three things:

- a value: `<Node value={7} />` shows a number, string, or boolean, as a view's
  own node does with its value;
- content: `<Node>any text or markup</Node>` shows its children, for titles,
  explanations, captions, indices, and pointer names, and with `layout` arranges
  them, as a view of an array arranges its elements' views, its words each in a
  node of their own; without `layout`, children flow as ordinary text;
- a shape: `<Node />` has no value or children, and draws only its box, for
  marks such as dots, sized by its kind's padding and least size.

### Props

A node's props say what it is and how its children are arranged; its look is its
kind's (see Design). Props starting with `__` are reserved for the library.

- `value`: the number, string, or boolean a value node shows.
- `layout`: `'row'`, `'column'`, `'grid'` (placed by coordinates; see Grid),
  `'free'` (placed by layout; see Free layout and links), or `'stack'` (one over
  the other; see Stack); arranges a node's children.
- `row` and `col`: in a grid, the cell a child is placed in, whole numbers, as
  `row={i} col={j}`; only a grid's children take them. One left out spans every
  track of its axis, and both left out place it at row 0, col 0. `rowSpan` and
  `colSpan` cover more tracks from there (see Grid).
- `kind`: a kind of its own within its view or layout, written as it is, as
  `kind="Header"`, for the node and the nodes inside it (see Design), or chosen
  at each step by an expression of names written in the source, as
  `kind={k === j ? 'AtJ' : undefined}` (see Design). A layout's root node is its
  frame and takes none.
- A look, inside a view, as an expression of its value, as `fill={this.seen}`,
  or an icon, as `icon={this}` (see Props bound to a view's value); anywhere
  else a look is its kind's, and a bare `icon` draws its kind's icon.
- `width` and `height`, inside a view, as an expression of its value, as
  `height={this}`: a length, the value times its kind's unit (see Props bound to
  a view's value); nowhere else.

## Stack

`layout="stack"` puts a node's children in one place, one over the other, the
later ones on top. The stack is as large as its largest child, and each child
with no size of its own fills it, so a lower child's fill shows behind a later
child's text. A hidden child keeps its room, so nothing moves when it comes and
goes. For example, a cell with a highlight behind its value, shown only at the
steps of `@next`:

```svelte
<Node layout="stack"><Node kind="Mark" when="@next"></Node>{v}</Node>
```

The design gives `Mark` its fill. Give the value's own view no fill, or it
covers the layer.

## Grid

`layout="grid"` places each child in a cell by its `row` and `col`, as a table.
Sverlin's grid follows the rules of a CSS grid (CSS Grid Layout, levels 1 and
2), with the differences that "Where a grid differs from CSS" lists. Rows and
columns are grids too: a row is a grid of one row, its children in order, and a
column a grid of one column.

An insertion sort as one grid, a title across every column, a key down column −2
from row 1, the values on row 1 through their view, and the marks `i` and `j` in
lanes below them, `j` reaching −1 before the first cell:

```svelte
<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 6 });
  const Position = index(Values);
</script>

<script input>
  const values = Values;
</script>

<script algorithm>
  for (@start[let i = Position(1)]; @more[i < values.length]; @next[i++]) @insert{
    @take[const key = values[i];
    let j = Position(i - 1);]
    while (@front[j >= 0 && values[j] > key]) @shift{
      @move[values[j + 1] = values[j];
      j--;]
    }
    @drop[values[j + 1] = key;]
  }
</script>

<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Values" name="Cells"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Position" name="Arrow">
  <Node layout="column"><Node kind="Tip" icon /><Node kind="Caption">{place()}</Node></Node>
</View>

<Layout name="Main" of="values, i, j">
  <Node layout="grid">
    <Node kind="Title" row={0}>Insertion sort</Node>
    <Node kind="Key" row={1} rowSpan={3} col={-2}><Node kind="Word">values</Node><Node kind="Word">i</Node><Node kind="Word">j</Node></Node>
    <Node kind="Band" row={1}>{values}</Node>
    <Node kind="Lane" row={2} col={i}>{i}</Node>
    <Node kind="Lane" row={3} col={j}>{j}</Node>
  </Node>
</Layout>

<Case name="main" values={[5, 2, 4, 6, 1, 3]} />
<Storyboard>
  <Scene name="sort" case="main" pause="@insert.take, @insert.shift.move, @insert.drop"><Main /></Scene>
</Storyboard>
```

```json
{ "{Position}": "Arrow", "{Values}": "Cells", "{Int}": "IntCell" }
```

### Cells and coordinates

- A grid holds only nodes, from any number of `{#each}` and `{#if}` blocks, in
  any order; a value or text goes inside one.
- A coordinate is a whole number: a position (`index(...)`), an expression over
  one, as `j - 1`, a loop's index, or a number written in the source. A
  coordinate whose values cannot be worked out, as `values.length - 1`, is still
  placed, with a warning: the grid then keeps only the tracks the run reaches on
  that axis.
- A coordinate outside the array's range, as −1 for `j - 1` before the first
  cell, or the length after the last, extends the grid by a track, so a mark
  there has a place of its own; a position's type allows both, so a grid placed
  by positions keeps a track before the first cell and after the last.
- A node with neither `row` nor `col` is at row 0, col 0. Two cells covering one
  coordinate at one step are drawn over each other, and the build warns: give
  each a `row` or `col` of its own.
- A coordinate no node uses is a gap, as the corner above the headers, a
  triangle of comparisons per pass, or a sparse adjacency matrix placing each
  edge at `row={e.from} col={e.to}`: no placeholder nodes.
- A position in a cell placed by it, as `<Node row={2} col={i}>{i}</Node>`,
  draws through the view the design chooses for its type, so a pointer view with
  no `<Pointed>`, as an arrow and a caption, draws a mark in a lane of its own,
  and slides from cell to cell as the position moves. A position moved by a
  number, as `{j - 1}`, is a position too, and so is a `{@const}` holding one,
  so `{@const before = j - 1}` then `<Node row={4} col={before}>{before}</Node>`
  draws a mark captioned `before` by `{place()}`.
- A cell's kind can come from an expression of names written in the source, as
  `kind={k === j ? 'AtJ' : k < i ? 'Sorted' : undefined}` on
  `{#each values as v, k}<Node row={1} col={k}>{v}</Node>{/each}`, which shades
  the cell at `j` and the sorted part with no `{#if}` doubling the node.
- A grid may hold `<Link>`s among its cells, each drawn straight from cell to
  cell, its ends often computed from the index: a heap drawn as a tree places
  slot `k` by its depth and joins it to its children,
  `<Link from={k} to={2 * k + 1} />` and `<Link from={k} to={2 * k + 2} />`. A
  link belongs to the cells it joins, so it stays while values move through
  them.

### Spans

- A node with only `row` spans every column, and one with only `col` every row,
  as CSS `grid-column: 1 / -1`: the title above spans the whole table.
- `colSpan` and `rowSpan` make a cell cover that many columns or rows from its
  `col` and `row`, as `<Node row={0} col={0} colSpan={6}>`, which keeps a band
  off the key's column. A cell covering several tracks takes no room of its own
  in any of them: where it is larger than they are, with the gaps between them,
  they share the rest equally, as CSS grows them.

### Subgrids

A cell spanning tracks whose children are all nodes is a subgrid, as CSS
`grid-template-columns: subgrid` makes one: it places its children on the grid's
own tracks along the axis it spans, item `k` at coordinate `k` from its own
`col` (or `row`), from 0 where it spans every track. So
`<Node row={1}>{values}</Node>` puts `values[k]` in column `k`, through the row
of items its view draws, and a mark at `col={i}` lines up under it; and the key
above places its words down the rows. A cell whose children are text, as the
title, is one box across its tracks. As in CSS:

- the tracks along that axis are the grid's: every item sizes the track it is
  in, as a cell there does;
- its `align` places each item in its cell;
- along the other axis it is a cell of its own, as large as its largest item;
- its `justify` between, around, or evenly cannot spread tracks it does not own:
  it has no effect, and the build warns.

Unlike CSS, nothing moves an item off its track, so it lines up with every cell
in its column (or row), a mark at `col={i}` included:

- the gap between its items is the grid's; its kind's own `gap` has no effect
  along that axis (CSS would move its items by half the difference);
- its box is drawn as a band across its tracks reaching out past the first and
  last by its padding and border, which the grid keeps room for at its edges
  (CSS would push its first and last items in instead).

### Sizes

Every column is as wide as its widest cell and every row as tall as its tallest
at any step, and there are as many as the coordinates' types allow, an `{#each}`
index up to its array's `max`, so a table filling in, or drawn for a longer
input, never moves: a column no cell here reaches keeps room for one, unless no
value of its coordinate can place one there. A grid in a view sizes them over
every value of its type too, one set every copy shares, so two tables drawn by
one view line up column for column.

The grid's kind has `gap`, between columns and rows; `align`, where each cell
sits in its column and row; and `justify`, how the columns spread where the grid
has more room than they need.

### The basis

The grid's kind also has a basis, the directions its columns and its rows run:
`colX` and `colY` for the columns, `rowX` and `rowY` for the rows, each −1,
−0.5, 0, 0.5, or 1, in pitches. A cell is at `col` times the column direction
plus `row` times the row direction, so to turn or skew a table is a design
choice, not a change to the source. The start, `colX` 1, `colY` 0, `rowX` 0,
`rowY` 1, is a table. Any other basis places every cell at one pitch, the
largest row's height and the largest column's width at any step, in a box round
every coordinate the grid keeps, the contents upright; spans and subgrids then
have no effect, and each cell is centred in its pitch. A col and a row that are
parallel are refused, as every cell would fall on one line.

| Shape     | `colX`, `colY` | `rowX`, `rowY` | Draws                                       |
| --------- | -------------- | -------------- | ------------------------------------------- |
| table     | 1, 0           | 0, 1           | rows and columns (the start)                |
| diamond   | 0.5, 0.5       | −0.5, 0.5      | the table turned 45°                        |
| staggered | 1, 0           | 0.5, 1         | rows shifted by half a cell, as a pyramid   |
| skewed    | 1, 0           | 1, 1           | each row a cell further right than the last |

A longest common subsequence table turned into a diamond, each cell below the
two it is computed from:

```svelte
<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Char = type(['A', 'C', 'G', 'T']);
  const Word = array(Char, { max: 4 });
  const Row = array(Int, { max: 5 });
  const Table = array(Row, { max: 5 });
  const Count = type('integer', { min: 0, max: 5 });
</script>

<script input>
  const x = Word;
  const y = Word;
  const t = Table;
</script>

<script algorithm>
  for (@rowStart[let i = Count(1)]; @rowMore[i < t.length]; @rowNext[i++]) @row{
    for (@cellStart[let j = Count(1)]; @cellMore[j < t[i].length]; @cellNext[j++]) @cell{
      if (@same[x[i - 1] === y[j - 1]]) @diagonal[t[i][j] = t[i - 1][j - 1] + 1;]
      else if (@up[t[i - 1][j] >= t[i][j - 1]]) @fromUp[t[i][j] = t[i - 1][j];]
      else @fromLeft[t[i][j] = t[i][j - 1];]
    }
  }
</script>

<View of="Int" name="Numeral"><Node value={this} /></View>
<View of="Char" name="Letter"><Node value={this} /></View>
<View of="Count" name="CountText"><Node value={this} /></View>

<Layout name="Main" of="y, x, t">
  <Node layout="grid">
    {#each y as c, j}<Node kind="Header" row={0} col={j + 2}>{c}</Node>{/each}
    {#each x as c, i}<Node kind="Header" row={i + 2} col={0}>{c}</Node>{/each}
    {#each t as cells, i}
      {#each cells as cell, j}<Node kind="Cell" row={i + 1} col={j + 1}>{cell}</Node>{/each}
    {/each}
  </Node>
</Layout>

<Case name="main" x={'GATC'} y={'ATGC'} t={[
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0]
  ]} />

<Storyboard>
  <Scene name="main" case="main" pause="@row.cell.diagonal, @row.cell.fromUp, @row.cell.fromLeft"><Main y={y} x={x} t={t} /></Scene>
</Storyboard>
```

```json
{ "Main": { "colX": 0.5, "colY": 0.5, "rowX": -0.5, "rowY": 0.5 } }
```

### Where a grid differs from CSS

A model that knows CSS should not assume these:

- A coordinate outside the range extends the grid by a track, before the first
  or after the last; CSS puts an item at a line past the explicit grid in an
  implicit track, and has no lines before the first.
- A node with no coordinates goes to row 0, col 0, and two cells at one
  coordinate are drawn over each other with a warning; CSS places such items
  automatically in the next free cell.
- A track keeps its largest size over every step and every value its
  coordinates' types allow, so nothing moves; CSS sizes tracks for what the page
  holds now.
- An omitted `row` or `col` spans every track; in CSS an item with no line is
  placed automatically in one track.
- A subgrid is made by spanning tracks with nodes inside, not by a property, and
  numbers its items from its own coordinate, each subgrid inside it going on
  numbering where the last left off.
- A subgrid's own gap, padding and border move none of its items (see Subgrids);
  in CSS they move its items off the tracks.
- The basis has no CSS equivalent.

### Counts

`{#each count(n) as k}…{/each}` draws one copy for each of 0, 1, … up to n − 1.
Use it in a view to draw a small number as marks, for example dots in rows of
five, so a reader sees 7 as 5 and 2 without counting:

```svelte
<View of="Count" name="Dots">
  <Node layout="grid">
    {#each count(this) as k}<Node kind="Dot" row={Math.floor(k / 5)} col={k % 5}>●</Node>{/each}
  </Node>
</View>
```

Or a rating as a row of icons, each one icon its kind's design chooses:

```svelte
<View of="Rating" name="Stars">
  <Node layout="row">{#each count(this) as k}<Node kind="Star" icon />{/each}</Node>
</View>
```

- The count, `n`, is a value of an integer type with a largest value, as `this`
  in a view of `type('integer', { min: 0, max: 10 })`. The view keeps room for
  that largest count at every step, so a growing count never moves anything.
- A count goes up to 100 at most. A larger value reads better as a length: draw
  it as a bar, with `height={this}`.
- `count(…)` is only the list an `{#each}` walks.

## Free layout and links

`layout="free"` places a node's children by layout instead of in a line: use it
for linked structures such as linked lists, trees, and graphs, joined by
`<Link>` components (see Link), and for groups whose arrangement is open, with
or without links. The children are kept clear of each other and gathered
compactly, as their kind's look says (see Design). A node hugs its children
whatever its layout. Every direct child is placed; put content that belongs
together, such as a value and its index, in one child node.

- `flow`: in a free layout, `'x'` or `'y'` makes arrows point rightwards or
  downwards, as for a list or a tree, and every form runs that way. Set it only
  when asked; an undirected graph has no flow.

A free layout's look, `form`, `direction`, `curve`, and `layoutSeed`, is its
kind's (see Design), never a prop, and arrows bend round other nodes and labels.
A selection reports each free layout around the element, with its kind, its
`layoutSeed`, and the form and direction it drew: to keep a layout the
participant liked ("keep this layout but …"), vary that kind's `form`,
`direction` and `layoutSeed` to them, and its `curve` only if they name it.

## Link

`<Link from={edge.from} to={edge.to} />` draws a link between two nodes. Put
links among the children of the node whose children they join, or in a view
rendered there, as of an edge, of a node (see Pools and references), or of what
a labelled expression computed; never in a pointer view, which draws inside the
element it marks. They take no space; give the node a `layout`, `"free"` for a
linked structure or `"row"` or `"column"`, unless it holds an array's `{#each}`,
which runs as the array. Only a free layout places its children by their links;
in a row, column or grid links are drawn over the children, which stay where
they would be without them: in a row or column each arcs over ends side by side
or beside ends one above the other, clear of the boxes, and in a grid each runs
straight from cell to cell, as a heap's edges (see Grid). The row, column or
grid keeps room round its children for the largest arc its links draw at any
step, so its children stay put as links come and go. Each link is selectable, as
a node is, and its look, how it runs and its heads, is its kind's (see Design),
never a prop, as `Arrow.Link` for a link in `Arrow`.

- `from` and `to`: positions from the state, as `edge.from`, naming the node
  drawing the element each points at (or, where only its fields are drawn, the
  node holding its whole `{#each}` item), the index of an `{#each}` over an
  array among them, as `k` in `{#each vertices as v, k}`, or arithmetic of one
  such index and numbers, as `to={2 * k + 1}` for a heap's child, which draws no
  link at a step where it runs past the array's ends; labels giving positions,
  as `@insert.swap.from`. An end naming no element, as a number or text written
  in the view or arithmetic of two indices, fails the build. In a view of an
  element, a link with no `from` starts at the node drawing that element, as a
  node's `next`. An arrow meets what is seen of its end: a node with no stroke
  or fill of its own is met at the bordered or filled boxes inside it, as a
  vertex's name cell rather than the column holding it and its caption, unless
  reaching them would cross that other content: an arrow down from a vertex with
  captions under it leaves just below what is drawn under it at that step, its
  captions or a pointer's label, in line with its name cell, not below room kept
  for a label shown only at other steps. An arrow coming in aslant passes the
  empty corner of a caption wider than the name cell to meet the cell, and
  crosses a pointer's fill round the vertex, so it keeps its place from step to
  step.

A link's children are its label, drawn at its middle over the line (on a wire,
its longest run), the link long enough to hold it and other links bending round
it: text, as `<Link from={k} to={w}>next</Link>`, or views of values and nodes,
as `<Link from={u} to={v}>{cost}</Link>`, each of its own kind, so a weight can
be a white pill on the line, followed from step to step as any value is. A type
drawn only on links, as a weight, starts as plain small text on the stage's
white, kept room for as its words; the design can still box it. The line breaks
round a label, and a labelled link keeps room for an arrow on either side of it.

A link from a node to itself, as a state's transition back to the same state
(`<Link from={k} to={k}>b</Link>`), is a loop over the node: it leaves the top
of the node and returns to it, with its label at the top of the loop. A second
loop on the same node goes over the first. The node keeps room above it for its
loops, so the nodes round it stay clear of them.

In a free layout with links, a node directly among its children starts as a
circle, as a graph's vertex or a machine's state, so links meet its edge; a node
drawn by a view, or one with a layout of its own, keeps its own look.

A link's direction follows from the data. Where the same `<Link>` joins two
elements both ways at exactly the same steps, as neighbour lists naming each
edge from both its ends, the pair is one two-way line, its kind's head at both
ends, and a free layout reads it as undirected: an undirected graph lists each
edge from both ends, a directed one from its source alone. Two `<Link>`s are
never one line, so a doubly linked list's next and prev stay two arrows.

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
<script domain>
  const Name = type(['A', 'B', 'C', 'D', 'E']);
  const Flag = type('boolean');
  const Vertex = record({ name: Name, seen: Flag });
  const Vertices = array(Vertex, { max: 5 });
  const VertexRef = index(Vertices);
  const Out = array(VertexRef, { max: 2 });
  const Slot = index(Out);
  const Adjacency = array(Out, { max: 5 });
  const Queue = array(VertexRef, { max: 5 });
</script>

<script input>
  const vertices = Vertices;
  const out = Adjacency;
</script>

<script algorithm>
  @init[let queue = Queue([0]);]
  while (@more[queue.length > 0]) @visit{
    @take[const current = queue[0];
    queue.shift();
    const around = out[current];]
    for (@first[let slot = Slot(around, 0)]; @another[slot < around.length]; @step[slot++]) @look{
      const w = around[slot];
      if (@check[!vertices[@next[w]].seen]) @add{
        vertices[w].seen = true;
        queue.push(w);
      }
    }
  }
</script>

<View of="Name" name="NameText"><Node value={this} /></View>
<View of="Flag" name="SeenMark"><Node>{this ? '✓' : '·'}</Node></View>
<View of="Vertex" name="VertexCard"><Node layout="column">{this.name}{this.seen}</Node></View>
<View of="VertexRef" name="RefCard"><Node value={this} /></View>
<View of="Queue" name="QueueItems"><Node>{#each this as v}{v}{/each}</Node></View>
<View of="VertexRef" name="Marked"><Pointed /></View>
<Layout name="Graph">
  <Node layout="free">
    {#each vertices as v, k}
      <Node layout="column">{v}<Node kind="VertexNumber">{k}</Node></Node>
      {#each out[k] as w}<Link from={k} to={w} />{/each}
    {/each}
  </Node>
</Layout>
<Layout name="QueueLine"><Node>queue {queue}</Node></Layout>

<Layout name="Stacked">
  <Node>
    <Graph />
    <QueueLine />
    {current}
    {@visit.look.check.next}
  </Node>
</Layout>

<Case name="main" vertices={[
    { name: 'A', seen: true },
    { name: 'B', seen: false },
    { name: 'C', seen: false },
    { name: 'D', seen: false },
    { name: 'E', seen: false }
  ]} out={[[1, 2], [3], [3], [4], []]} />

<Storyboard>
  <Scene name="search" case="main" pause="@init, @visit.take, @visit.look.check, @visit.look.add"><Stacked /></Scene>
</Storyboard>
```
