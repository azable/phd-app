import { describe, expect, it } from 'vitest';

import type { MasterStep, PauseMode } from './algorithm/interpret.server';
import {
  bundlePresentation,
  compileSvelteComponent,
  InvalidSvelteSourceError,
  pausesOf,
  prepareSvelteComponent
} from './compile.server';
import { linearSearchSource } from './contract';
import { buildVariant } from './design.server';

/** The kinds of node a prepared source's design space has, from its variables' keys. */
const kindsOf = (space: Record<string, unknown>) =>
  [
    ...new Set(
      Object.keys(space)
        .filter(
          (key) =>
            !key.startsWith('views.') &&
            !key.startsWith('pointers.') &&
            !key.startsWith('frame.') &&
            !key.includes('@')
        )
        .map((key) => key.slice(0, key.lastIndexOf('.')))
    )
  ].sort();

describe('single-component Svelte compilation', () => {
  it('bundles a component and its playback input without executing it', async () => {
    const result = await compileSvelteComponent(
      '<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 });</script><script lang="sverlin">let n = Int(0); @a[n = Int(1);] @b[n = Int(2);]</script>{#snippet IntCell(value: Int)}<Node {value} />{/snippet}{#snippet S()}<Node>{step}</Node>{/snippet}{@render S()}{@render Int(n)}'
    );
    // The input as given, then a step per label changing what the view draws.
    expect(result.labels).toEqual(['Step 1', 'Step 2', 'Step 3']);
    expect(result.javascript).toContain('__sverlinStep');
    expect(result.javascript).not.toContain('import "svelte');
  });

  it('rejects imports in instance and module code', async () => {
    await expect(
      compileSvelteComponent(
        '<script>import x from "https://example.com/x.js";</script><h1>{x}</h1>'
      )
    ).rejects.toThrow('cannot import');
    await expect(
      compileSvelteComponent('<script module>import x from "other";</script><h1>{x}</h1>')
    ).rejects.toThrow('cannot import');
    await expect(
      compileSvelteComponent('<script>const x = import("/secret")</script><h1>{x}</h1>')
    ).rejects.toThrow('cannot import');
    await expect(compileSvelteComponent('<h1>{import(window.target)}</h1>')).rejects.toThrow(
      'cannot import'
    );
  });

  it('derives master steps from labels and varies only the variant between seeds', async () => {
    const prepared = prepareSvelteComponent(linearSearchSource);
    // The starter's linear search: the input as given, a step at each check, then its answer.
    expect(prepared.master.map(({ state }) => state.i)).toEqual([undefined, 0, 1, 2, 3, undefined]);
    expect(prepared.master.at(-1)?.state.found).toBe(3);
    const bundles = await Promise.all(
      Array.from({ length: 12 }, (_, seed) =>
        bundlePresentation(prepared, seed + 1, { randomise: true })
      )
    );
    for (const bundle of bundles) {
      expect(bundle.masterSignature).toBe(bundles[0].masterSignature);
      expect(bundle.labels).toEqual(['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5', 'Step 6']);
      expect(bundle.masterSteps).toEqual(prepared.master.map(({ moment }) => moment));
    }
    expect(new Set(bundles.map(({ variant }) => variant['views.Int']))).toEqual(
      new Set(['IntCell', 'IntTally'])
    );
    expect(bundles[0].javascript).toContain('[3,8,5,2,7]');
    // The algorithm runs when the source is built, not in the page.
    expect(bundles[0].javascript).not.toContain('values[i] === target');
    const again = await bundlePresentation(prepared, 1, { randomise: true });
    expect(again.variant).toEqual(bundles[0].variant);
    expect((await bundlePresentation(prepared, 1)).variant).toEqual(prepared.design.starter);
  });

  it('rejects a design block, and a source with no algorithm block', async () => {
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin">\n\n</script>\n<script lang="sverlin" design>\nconst size = 1;\n</script>'
      )
    ).rejects.toMatchObject({
      code: 'sverlin_block',
      line: 4,
      message: expect.stringContaining('Sources have no design block')
    });
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" input>const x = 1;</script>{#snippet X()}<Node>x</Node>{/snippet}{@render X()}'
      )
    ).rejects.toThrow('Add a <script lang="sverlin"> algorithm block');
  });

  it('rejects looks given as props, which are the design’s', async () => {
    const view = (markup: string) =>
      compileSvelteComponent(
        `<script lang="sverlin"></script>\n{#snippet V()}${markup}{/snippet}{@render V()}`
      );
    await expect(view('<Node fill="amber" value={1} />')).rejects.toMatchObject({
      code: 'unknown_prop',
      line: 2,
      message: expect.stringContaining('<Node> fill is a look')
    });
    await expect(view('<Node size={step ? 1 : 2}>x</Node>')).rejects.toThrow('size is a look');
    await expect(
      view(
        '<Node layout="free"><Node key="a" /><Node key="b" /><Link from="a" to="b" stroke="red" /></Node>'
      )
    ).rejects.toThrow('<Link> stroke is a look');
  });

  it('reports the view’s problems together with a block’s, in source order', async () => {
    const failure = await compileSvelteComponent(
      '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 });</script>\n<script lang="sverlin">\n  let i = 0;\n\n</script>\n{#snippet A()}<Node shape="circle">v1</Node>{/snippet}\n{#snippet B()}<Node class="x" />{/snippet}'
    ).catch((cause: InvalidSvelteSourceError) => cause);
    expect(failure).toMatchObject({ line: 3, message: expect.stringContaining('plain number 0') });
    expect((failure as InvalidSvelteSourceError).others).toMatchObject([
      { code: 'unknown_prop', line: 6 },
      { code: 'unknown_prop', line: 7 }
    ]);
  });

  it('places problems at their authored positions', async () => {
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin"></script>\n\n<script module>import x from "y";</script>'
      )
    ).rejects.toMatchObject({ line: 3 });
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin"></script>\n{#snippet A()}<Node>a</Node>{/snippet}\n{#snippet B()}<Node tags="b">b</Node>{/snippet}'
      )
    ).rejects.toMatchObject({
      code: 'unknown_prop',
      line: 3,
      message: expect.stringContaining('name the node by a snippet')
    });
    await expect(
      compileSvelteComponent('<script lang="sverlin"></script>\n\n<Node>a</Node>')
    ).rejects.toMatchObject({ code: 'view_markup', line: 3 });
  });
  it('reports plain input and algorithm values at their authored line and column', async () => {
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 }); const Values = collection(Int); const Reversed = unop((c: Values) => Values(c.slice().reverse()));</script>\n<script lang="sverlin" input>\n  const values = Values([3, "x"]);\n</script>\n<script lang="sverlin">\n  let i = 0;\n\n</script>'
      )
    ).rejects.toMatchObject({
      code: 'algorithm_error',
      line: 3,
      column: 18,
      // The whole call the problem is in, up to (not including) the semicolon.
      endLine: 3,
      endColumn: 34,
      message: expect.stringContaining('Values[1]: Int values must be whole numbers, not "x"')
    });
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 });</script>\n<script lang="sverlin">\n  let i = 0;\n\n</script>'
      )
    ).rejects.toMatchObject({
      line: 3,
      column: 11,
      message: expect.stringContaining('Write it as Int(0)')
    });
  });

  it('reports algorithm errors at their authored line and column', async () => {
    const source =
      '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 });</script><script lang="sverlin">\n  let x = Int(1);\n\n  x = missing;\n</script>\n<Node>{x}</Node>';
    await expect(compileSvelteComponent(source)).rejects.toMatchObject({
      name: 'InvalidSvelteSourceError',
      code: 'algorithm_error',
      line: 4,
      column: 7,
      message: expect.stringContaining('"missing" is not defined')
    });
  });

  it('keeps Svelte error positions after removing the algorithm block', async () => {
    await expect(
      compileSvelteComponent('<script lang="sverlin">\n\n</script>\n\n{#if}')
    ).rejects.toMatchObject({ line: 5 });
  });

  it('requires exactly one algorithm block', async () => {
    await expect(
      compileSvelteComponent('{#snippet Hi()}<Node>Hi</Node>{/snippet}{@render Hi()}')
    ).rejects.toThrow('Add a <script lang="sverlin"> algorithm block');
    await expect(
      compileSvelteComponent('<script lang="sverlin"></script><script lang="sverlin"></script>')
    ).rejects.toThrow('only one algorithm block');
  });

  it('injects the sverlin library components without authored imports', async () => {
    const result = await compileSvelteComponent(linearSearchSource);
    expect(result.javascript).toContain('sv-node');
    expect(result.javascript).toContain('sv-node');
    const withoutModuleScript = await compileSvelteComponent(
      '<script lang="sverlin"></script>{#snippet X()}<Node>x</Node>{/snippet}{@render X()}'
    );
    // The input as given (here none), then the algorithm's one step.
    expect(withoutModuleScript.labels).toEqual(['Step 1', 'Step 2']);
    expect(withoutModuleScript.javascript).toContain('sv-node');
  });

  it('puts every recorded value in scope for a script-free view', async () => {
    const result = await compileSvelteComponent(
      '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 }); const Values = collection(Int); const Add = binop((a: Int, b: Int) => Int(a + b));</script><script lang="sverlin" input>const values = Values([4, 9]);</script>\n<script lang="sverlin">@start[let total = Int(0);]\nfor (const v of values) {\n  @add[total = Add(total, v);]\n}</script>\n{#snippet Sum()}<Node layout="column">{@const doubled = total * 2}<Node>{values.join("+")} = {total}; doubled {doubled}; step {step}, seed {seed}</Node></Node>{/snippet}{@render Sum()}',
      5
    );
    // The input as given, the start, and a step per addition; the loop's end only drops v, so it
    // is no step.
    expect(result.labels).toEqual(['Step 1', 'Step 2', 'Step 3', 'Step 4']);
    expect(result.variant['Sum.fill']).toBeDefined();
  });

  it('gives every kind of node, the snippet it is in, the variables its role has', () => {
    const { design } = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Int = type([1, 3]); const Values = collection(Int); const Position = index(Values);</script><script lang="sverlin" input>const values = Values([1, 3]);</script><script lang="sverlin">let i = Position(0);</script>{#snippet IntCell(value: Int)}<Node {value} />{/snippet}{#snippet Arrow(p: Position)}{#snippet Name()}<Node>i</Node>{/snippet}<Node layout="column"><Pointed />{@render Name()}</Node>{/snippet}{#snippet Mark(p: Position)}<Pointed />{/snippet}{#snippet Cells()}<Node layout="row">{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}{#snippet Note()}<Node>note</Node>{/snippet}{#snippet Pair()}<Node layout="free"><Node key="a" /><Node key="b" /><Link from="a" to="b" /></Node>{/snippet}{@render Cells()}{@render Position(i)}{@render Note()}{@render Pair()}`
    );
    expect(kindsOf(design.space)).toEqual(
      [
        'Arrow',
        'Arrow.Name',
        'Arrow.Pointed',
        'Cells',
        'IntCell',
        'Mark.Pointed',
        'Note',
        'Pair',
        'Pair.Link'
      ].sort()
    );
    expect(design.space['Cells.gap']).toBeDefined();
    expect(design.space['IntCell.gap']).toBeUndefined();
    expect(design.space['Arrow.Pointed.shown']).toBeUndefined();
    expect(design.space['Pair.Link.strokeStyle']).toEqual(['solid', 'dashed', 'dotted']);
    expect(design.space['views.Int']).toEqual(['IntCell', 'none']);
    // Each render with an argument is a place: its own choice where its type has several views of
    // the kind it draws, and its own paint for the kinds of each.
    expect(design.space['pointers.Position@i']).toEqual(['Arrow', 'Mark', 'none']);
    expect(design.starter['pointers.Position@i']).toBe('Arrow');
    expect(design.space['Arrow.Pointed@i.fill']).toBeDefined();
    expect(design.space['Arrow.Name@i.color']).toBeDefined();
    expect(design.space['Arrow.Pointed@i.padding']).toBeUndefined();
    expect(design.space['IntCell@v.fill']).toBeDefined();
    expect(design.space['views.Int@v']).toBeUndefined();
    expect(design.fallbacks['Mark.Pointed@i.stroke']).toBe('Mark.Pointed.stroke');
  });

  it.each([
    ['tags', '{#snippet T()}<Node tags="title">x</Node>{/snippet}{@render T()}', /takes no tags/],
    [
      'a node at the top level',
      '<Node>x</Node>',
      /<Node> at the top level: put it in a snippet without parameters/
    ],
    ['text at the top level', 'Linear search', /Text at the top level cannot be selected/],
    [
      'a render of a snippet worked out as the view runs',
      '{#snippet A()}<Node>a</Node>{/snippet}{#snippet B()}<Node>b</Node>{/snippet}{@render (step ? A : B)()}',
      /names the snippet it draws/
    ],
    [
      'two snippets of one name',
      '{#snippet A()}{#snippet U()}<Node>x</Node>{/snippet}<Node>{@render U()}</Node>{/snippet}{#snippet U()}<Node>y</Node>{/snippet}{@render A()}{@render U()}',
      /Two snippets are named U/
    ],
    [
      'a snippet taking a parameter without a type',
      '{#snippet A(x)}<Node>{x}</Node>{/snippet}{@render A(1)}',
      /A takes a parameter without a type/
    ]
  ])('rejects %s', async (_name, markup, message) => {
    await expect(
      compileSvelteComponent(`<script lang="sverlin"></script>${markup}`)
    ).rejects.toThrow(message);
  });

  it('rejects a <Pointed> and a node of one kind', () => {
    expect(() =>
      prepareSvelteComponent(
        `<script lang="sverlin" domain>const Int = type([1, 3]); const Values = collection(Int); const Position = index(Values);</script><script lang="sverlin" input>const values = Values([1, 3]);</script><script lang="sverlin">let i = Position(0);</script>{#snippet Arrow(p: Position)}{#snippet Pointed()}<Node>i</Node>{/snippet}<Node layout="column"><Pointed />{@render Pointed()}</Node>{/snippet}{#snippet Cells()}<Node layout="row">{#each values as v}<Node value={v} />{/each}</Node>{/snippet}{@render Cells()}{@render Position(i)}`
      )
    ).toThrow(/Arrow\.Pointed is the kind of a <\w+> and of another kind of tag/);
  });

  it('rejects props a library component does not take, and written values it cannot use', async () => {
    const view = (markup: string) =>
      compileSvelteComponent(
        `<script lang="sverlin"></script>\n{#snippet V()}${markup}{/snippet}{@render V()}`
      );
    await expect(view('<Node form="spiral" />')).rejects.toMatchObject({
      code: 'invalid_prop',
      line: 2
    });
    await expect(view('<Node layout="grid" />')).rejects.toThrow("use 'row', 'column', 'free'");
    await expect(view('<Node class="big" />')).rejects.toMatchObject({
      code: 'unknown_prop',
      message: expect.stringContaining('<Node> has no prop class')
    });
    await expect(
      view(
        '<Node layout="free"><Node key="a" /><Node key="b" /><Link from="a" to="b" bow={1} /></Node>'
      )
    ).rejects.toMatchObject({ code: 'unknown_prop' });
    // Values worked out in markup, and props passed on by a spread, are left to the component.
    await expect(
      view('<Node layout={step ? "row" : "column"} value={1} {...{ key: "a" }} />')
    ).resolves.toBeDefined();
  });

  it('draws views only with Node and Link', async () => {
    const view = (markup: string) =>
      compileSvelteComponent(
        `<script lang="sverlin"></script>\n{#snippet V()}${markup}{/snippet}{@render V()}`
      );
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin"></script>\n{#snippet V()}<Node>Hi</Node>{/snippet}{@render V()}\n<style>div { color: red; }</style>'
      )
    ).rejects.toMatchObject({
      code: 'view_style',
      line: 3,
      message: expect.stringContaining('<style>')
    });
    await expect(view('<Node><small>cm</small></Node>')).rejects.toMatchObject({
      code: 'view_markup',
      message: expect.stringContaining('<small>')
    });
    await expect(view('<svg><circle r="4" /></svg>')).rejects.toMatchObject({
      code: 'view_markup'
    });
    await expect(view('<Node>{@html "<b>x</b>"}</Node>')).rejects.toMatchObject({
      code: 'view_markup',
      message: expect.stringContaining('{@html}')
    });
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin"></script><svelte:head><title>x</title></svelte:head>'
      )
    ).rejects.toMatchObject({ code: 'view_markup' });
    await expect(view('<svelte:element this="div" />')).rejects.toMatchObject({
      code: 'view_markup'
    });
    await expect(view('Linear search')).rejects.toMatchObject({ code: 'view_text', line: 2 });
    await expect(view('{#if step}{step}{/if}')).rejects.toMatchObject({ code: 'view_text' });
    // Text inside a node is drawn by it, a view may write text beside its nodes, and whitespace
    // between nodes is ignored.
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" domain>const Int = type([1, 3]);</script><script lang="sverlin">let i = Int(1);</script>\n{#snippet IntNote(value: Int)}is <Node {value} />{/snippet}\n{#snippet V()}<Node>Step {step}</Node>\n<Node>{@render Int(i)}</Node>{/snippet}{@render V()}'
      )
    ).resolves.toBeDefined();
  });

  it('shows the source’s own listing where the view places a <Listing />, lit per step', async () => {
    const source = [
      '<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Index = index(Values); const Flag = type("boolean"); const Length = unop((v: Values) => Index(v.length)); const Before = binop((a: Index, b: Index) => Flag(a < b)); const Next = unop((p: Index) => Index(p + 1));</script>',
      '<script lang="sverlin" input>const values = Values([3, 8]);</script>',
      '<script lang="sverlin">let last = Index(1); @loop[for (let i = Index(0); Before(i, Length(values)); i = Next(i)) { last = i; }]</script>',
      '<script lang="sverlin" listing="code">for @loop[i = 1 to n]</script>',
      '{#snippet IndexCell(p: Index)}<Node value={p} />{/snippet}{#snippet Cells()}<Node>{#each values as v}<Node value={v} />{/each}</Node>{/snippet}<Listing />{@render Cells()}{@render Index(last)}'
    ].join('\n');
    const prepared = prepareSvelteComponent(source);
    expect(prepared.design.space['listing.language']).toEqual(['code', 'none']);
    expect(prepared.design.starter['listing.language']).toBe('code');
    expect(prepared.listings?.code.text).toBe('for i = 1 to n');
    // The input as given, lighting nothing, then a step per pass, each changing last; the loop's
    // end only drops i, so it is no step.
    const { lit } = prepared.paced(new Set(prepared.pauses.defaults));
    expect(lit.code).toHaveLength(3);
    expect(lit.code[0]).toEqual({ current: [], earlier: [] });
    const { javascript } = await bundlePresentation(prepared, 1);
    expect(javascript).toContain('for i = 1 to n');
    // Without a <Listing />, the design has no listing variables.
    expect(prepareSvelteComponent(linearSearchSource).design.space).not.toHaveProperty(
      'listing.language'
    );
  });

  it('rejects a <Listing /> with props or children, inside a view, or with no listing', () => {
    const blocks =
      '<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 });</script><script lang="sverlin">const n = Int(1);</script>\n';
    expect(() => prepareSvelteComponent(`${blocks}<Listing language="python" />`)).toThrow(
      'takes no props or children'
    );
    expect(() =>
      prepareSvelteComponent(
        `${blocks}{#snippet Code(value: Int)}<Node {value} /><Listing />{/snippet}{@render Int(n)}`
      )
    ).toThrow('place <Listing /> outside views');
    expect(() => prepareSvelteComponent(`${blocks}<Listing />`)).toThrow(
      "A <Listing /> shows a listing of the source's own"
    );
  });

  it('rejects view scripts and values that shadow library components', async () => {
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin"></script>\n\n<script>const x = 1;</script>\n{#snippet X()}<Node>{x}</Node>{/snippet}{@render X()}'
      )
    ).rejects.toMatchObject({
      code: 'view_script',
      line: 3,
      message: expect.stringContaining('Views cannot have their own <script>')
    });
    await expect(
      compileSvelteComponent('<script lang="sverlin"></script><script module>const x = 1;</script>')
    ).rejects.toThrow('Views cannot have their own <script>');
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin"></script>\n<script lang="sverlin" inputs>const x = 1;</script>'
      )
    ).rejects.toMatchObject({ code: 'sverlin_block', line: 2 });
    await expect(
      compileSvelteComponent('<script lang="sverlin">const Node = 1;</script><Node>x</Node>')
    ).rejects.toThrow('"Node" names a library component');
  });

  it('draws nested collections with nested {#each} blocks, and no longer takes items', async () => {
    const source = (view: string) =>
      `<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 }); const Row = collection(Int); const Grid = collection(Row);</script><script lang="sverlin" input>const grid = Grid([[1, 2], [3, 4]]);</script><script lang="sverlin"></script>{#snippet IntCell(value: Int)}<Node {value} />{/snippet}${view}`;
    const result = await compileSvelteComponent(
      source(
        '{#snippet Rows()}<Node layout="column">{#each grid as row}<Node>{#each row as v}{@render Int(v)}{/each}</Node>{/each}</Node>{/snippet}{@render Rows()}'
      )
    );
    expect(result.javascript).toContain('sv-node');
    await expect(
      compileSvelteComponent(
        source('{#snippet G()}<Node items={grid} />{/snippet}{@render Grid()}')
      )
    ).rejects.toMatchObject({
      code: 'unknown_prop',
      message: expect.stringContaining('<Node> has no prop items')
    });
  });

  it('marks the node showing a view’s own value with its type, for its unit', async () => {
    const source = (view: string) =>
      `<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 }); const Height = type(Int, { unit: "cm" }); const People = collection(Height);</script><script lang="sverlin" input>const people = People([150, 170]);</script><script lang="sverlin"></script>${view}{#snippet Everyone()}<Node>{#each people as person}{@render Height(person)}{/each}</Node>{/snippet}{@render Everyone()}`;
    const view =
      '{#snippet HeightView(h: Height)}<Node layout="column"><Node value={h} /><Node>tall</Node></Node>{/snippet}';
    const prepared = prepareSvelteComponent(source(view));
    expect(prepared.component.match(/__type: 'Height'/g)).toHaveLength(1);
    await expect(
      compileSvelteComponent(
        source(
          `${view}{#snippet First()}<Node value={people[0]} type="Height" />{/snippet}{@render First()}`
        )
      )
    ).rejects.toMatchObject({ code: 'unknown_prop' });
  });

  it('rejects invalid domain blocks, views, and clashing names', async () => {
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin"></script>\n<script lang="sverlin" domain>\nconst A = type(Integer);\n</script>'
      )
    ).rejects.toMatchObject({
      code: 'algorithm_error',
      line: 3,
      message: expect.stringContaining('Unknown type Integer')
    });
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 });</script><script lang="sverlin"></script>\n{#snippet IntCell(value: Int, node)}{value}{/snippet}'
      )
    ).rejects.toThrow('IntCell takes one value, its type given');
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" domain>const Text = type(["a"]);</script><script lang="sverlin">const Text = 1;</script>'
      )
    ).rejects.toThrow('"Text" names a type');
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" domain>const Node = type("integer", { min: -100, max: 1000 });</script><script lang="sverlin"></script>'
      )
    ).rejects.toThrow('"Node" names a library component');
  });

  it('takes chosen values, keeps base values that still fit, and gives the rest the starter', async () => {
    const prepared = prepareSvelteComponent(
      '<script lang="sverlin"></script>{#snippet One()}<Node value={1} />{/snippet}{@render One()}'
    );
    const built = await bundlePresentation(prepared, 3, {
      chosen: { 'One.radius': 999 },
      // Removed and unfit base values are the starter's instead.
      base: { 'One.fill': 'blue-100', 'One.size': 9, 'gone.width': 2 }
    });
    expect(built.variant).toMatchObject({ 'One.radius': 999, 'One.fill': 'blue-100' });
    expect(built.variant['One.size']).toBe(prepared.design.starter['One.size']);
    expect(built.variant).not.toHaveProperty('gone.width');
    expect(built.origins).toMatchObject({
      'One.radius': 'chosen',
      'One.fill': 'kept',
      'One.size': 'starter'
    });
    await expect(
      bundlePresentation(prepared, 3, { chosen: { 'One.radius': 3 } })
    ).rejects.toMatchObject({
      code: 'design_value',
      message: expect.stringContaining('One.radius cannot be 3')
    });
    await expect(bundlePresentation(prepared, 3, { chosen: { 'One.width': 2 } })).rejects.toThrow(
      'One has no prop width'
    );
  });

  it('takes the page frame from the variant', async () => {
    const prepared = prepareSvelteComponent(
      '<script lang="sverlin"></script>{#snippet A()}<Node>a</Node>{/snippet}{@render A()}'
    );
    expect(prepared.design.starter['frame.ratio']).toBe('16:9');
    const built = await bundlePresentation(prepared, 1, { chosen: { 'frame.ratio': '4:3' } });
    expect(built.javascript).toMatch(/"?ratio"?:"4:3"/u);
    await expect(
      bundlePresentation(prepared, 1, { chosen: { 'frame.ratio': '5:4' } })
    ).rejects.toThrow('frame.ratio cannot be "5:4"');
  });

  it('tags links like nodes, and marks the nodes and roots they join', () => {
    const algorithm = '<script lang="sverlin"></script>';
    const nested = prepareSvelteComponent(
      `${algorithm}\n{#snippet Pair()}<Node layout="free">\n  <Node key="a">a</Node><Node key="b">b</Node>\n  {#if true}<Link from="a" to="b" />{/if}\n</Node>{/snippet}{@render Pair()}`
    );
    expect(nested.component).toMatch(/__ref: ['"]4:13['"]/u);
    expect(nested.component).toMatch(/__links: true/u);
    expect(() =>
      prepareSvelteComponent(
        `${algorithm}{#snippet Pair()}<Node key="a">a</Node><Node key="b">b</Node><Link from="a" to="b" />{/snippet}{@render Pair()}`
      )
    ).toThrow('put it, with the nodes it joins, in a <Node layout="free">');
    expect(() =>
      prepareSvelteComponent(
        `${algorithm}\n{#snippet Pair()}<Node layout="free"><Link from="a" to="b" __id="x" /></Node>{/snippet}{@render Pair()}`
      )
    ).toThrow('Link props starting with __, such as __id, are reserved');
  });

  it('tags every Node with its source position and reserves __ props', async () => {
    const algorithm = '<script lang="sverlin"></script>';
    const { component } = prepareSvelteComponent(
      `${algorithm}\n{#snippet C()}<Node layout="column">\n  {#if true}<Node value={1} />{/if}\n</Node>{/snippet}{@render C()}`
    );
    expect(component).toMatch(/__ref: ['"]2:15['"]/u);
    expect(component).toMatch(/__ref: ['"]3:13['"]/u);
    expect(() =>
      prepareSvelteComponent(`${algorithm}\n{#snippet C()}<Node __id="x" />{/snippet}{@render C()}`)
    ).toThrow(expect.objectContaining({ code: 'reserved_prop', line: 2 }));
  });

  it('rejects authored library imports', async () => {
    await expect(
      compileSvelteComponent('<script>import { Node } from "sverlin";</script><Node value={1} />')
    ).rejects.toThrow('cannot import');
  });

  it.each(['./package.json', 'esbuild/package.json', '/etc/hostname', 'svelte/../../package.json'])(
    'refuses to bundle require(%j) from the server file system',
    async (path) => {
      await expect(
        compileSvelteComponent(
          `<script lang="sverlin"></script>{#snippet R()}<Node>{require(${JSON.stringify(path)})}</Node>{/snippet}{@render R()}`
        )
      ).rejects.toMatchObject({
        name: 'InvalidSvelteSourceError',
        message: expect.stringContaining('cannot load module')
      });
    }
  );

  it('keeps authored line numbers after prelude injection', async () => {
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin"></script>\n{#snippet S()}<Node>\n{$state(1)}</Node>{/snippet}{@render S()}'
      )
    ).rejects.toMatchObject({ line: 3, column: 2 });
  });

  it('identifies the master trace by its recorded states, whatever the view', async () => {
    const source = (values: string, view: string) =>
      `<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Reversed = unop((c: Values) => Values(c.slice().reverse()));</script><script lang="sverlin" input>const values = Values(${values});</script><script lang="sverlin">@reverse[values = Reversed(values);]</script>{#snippet V()}${view}{/snippet}{@render V()}`;
    const signature = async (values: string, view: string) =>
      (await compileSvelteComponent(source(values, view))).masterSignature;
    const first = await signature('[1, 2]', '<Node>{#each values as v}{v}{/each}</Node>');
    expect(
      await signature(
        '[1, 2]',
        '<Node layout="column">{#each values as v}<Node>{v}</Node>{/each}</Node>'
      )
    ).toBe(first);
    expect(await signature('[2, 1]', '<Node>{#each values as v}{v}{/each}</Node>')).not.toBe(first);
  });

  it('retains line and column for assistant source repair', async () => {
    await expect(compileSvelteComponent('<script>let = </script>')).rejects.toMatchObject({
      name: 'InvalidSvelteSourceError',
      line: 1,
      column: 9,
      code: 'js_parse_error'
    } satisfies Partial<InvalidSvelteSourceError>);
  });
});

describe('pointers', () => {
  const view = (markup: string) =>
    `<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Position = index(Values);</script><script lang="sverlin" input>const values = Values([1, 2]);</script><script lang="sverlin">let i = Position(0);</script>{#snippet IntText(value: Int)}<Node {value} />{/snippet}{#snippet Row(list: Values)}<Node layout="row">{#each list as v}{@render Int(v)}{/each}</Node>{/snippet}{@render Values(values)}${markup}`;

  it('draws a view with a <Pointed> around the element its position points at', () => {
    const prepared = prepareSvelteComponent(
      view(
        '{#snippet Arrow(p: Position)}<Node layout="column"><Pointed /><Node>i</Node></Node>{/snippet}{@render Position(i)}'
      )
    );
    expect(prepared.component).toContain('__sverlinPointers');
    expect(prepared.components.map(({ name }) => name)).toContain('Arrow');
    expect(prepared.design.space['Arrow.Pointed.fill']).toBeDefined();
  });

  it('draws a position type rendered by name as a mark outside a node, its number inside one', () => {
    const pointer = '{#snippet Highlight(p: Position)}<Pointed />{/snippet}';
    const caption = '{#snippet At()}<Node>at {@render Position(i)}</Node>{/snippet}{@render At()}';
    const both = prepareSvelteComponent(
      view(
        `{#snippet PositionText(p: Position)}<Node value={p} />{/snippet}${pointer}${caption}{@render Position(i)}`
      )
    );
    expect(both.design.space['views.Position']).toEqual(['PositionText', 'none']);
    expect(both.design.space['pointers.Position']).toEqual(['Highlight', 'none']);
    expect(both.design.starter['pointers.Position']).toBe('Highlight');
    // Each render's variable, by its line:column, for the editor.
    const source = view(
      `{#snippet PositionText(p: Position)}<Node value={p} />{/snippet}${pointer}${caption}{@render Position(i)}`
    );
    const siteOf = (needle: string, from = 0) => {
      const at = source.indexOf(needle, from);
      const before = source.slice(0, at);
      return `${before.split('\n').length}:${at - before.lastIndexOf('\n')}`;
    };
    const inCaption = source.indexOf('{@render Position(i)}');
    expect(both.design.renders).toMatchObject({
      [siteOf('{@render Position(i)}')]: 'views.Position',
      [siteOf('{@render Position(i)}', inCaption + 1)]: 'pointers.Position'
    });
    expect(both.component).toContain('__sverlinPointers');
    // With only pointer views, the type's choice is its pointers variable all the same.
    const marks = prepareSvelteComponent(view(`${pointer}{@render Position(i)}`));
    expect(marks.design.space['pointers.Position']).toEqual(['Highlight', 'none']);
    expect(marks.design.space['views.Position']).toBeUndefined();
    expect(() => prepareSvelteComponent(view(`${pointer}${caption}`))).toThrow(
      'or, to show the position as a number here, add a view that draws it, as {#snippet PositionText(p: Position)}<Node value={p} />{/snippet}'
    );
  });

  it.each([
    [
      '<Pointed> outside a view of an index type',
      '{#snippet P()}<Node><Pointed /></Node>{/snippet}{@render Pair()}',
      /belongs in a view of an index type/
    ],
    [
      'a pointer that is not a view of an index type',
      '{#snippet Mark(v: Int)}<Pointed />{/snippet}',
      /Int is neither an index nor a reference type/
    ],
    [
      'two <Pointed> in one pointer',
      '{#snippet Arrow(p: Position)}<Node><Pointed /><Pointed /></Node>{/snippet}',
      /has 2 <Pointed>/
    ],
    [
      'props <Pointed> does not take',
      '{#snippet Arrow(p: Position)}<Pointed layout="row" />{/snippet}',
      /<Pointed> takes no props/
    ],
    [
      'a pointer rendered in a part of the page',
      '{#snippet Arrow(p: Position)}<Pointed />{/snippet}{#snippet Marks()}{@render Position(i)}{/snippet}{@render Marks()}',
      /rendered at the top of the view, outside blocks other than \{#if\} and outside snippets/
    ],
    [
      'a <Pointed> in a snippet inside its pointer view',
      '{#snippet Arrow(p: Position)}{#snippet Mark()}<Pointed />{/snippet}<Node>{@render Int()}</Node>{/snippet}{@render Position(i)}',
      /A <Pointed> is written in its pointer view itself/
    ]
  ])('rejects %s', (_name, markup, message) => {
    expect(() => prepareSvelteComponent(view(markup))).toThrow(message);
  });
});

describe('typed view components', () => {
  const domain =
    '<script lang="sverlin" domain>const Int = type([1, 3]); const Flag = type("boolean");</script>';
  const algorithm = '<script lang="sverlin">let i = Int(1);</script>';
  const component = (view: string) => prepareSvelteComponent(`${domain}${algorithm}${view}`);

  it('reads typed snippets as views of one type, and draws the view the variant chooses for the type', async () => {
    const prepared = component(
      '{#snippet IntText(value: Int)}<Node {value} />{/snippet}{#snippet IntPair(value: Int)}<Node layout="row"><Node {value} /><Node {value} /></Node>{/snippet}{@render Int(i)}'
    );
    expect(prepared.components).toEqual([
      { name: 'IntText', cases: [1, 3] },
      { name: 'IntPair', cases: [1, 3] }
    ]);
    expect(prepared.component).toContain('__component');
    expect(prepared.design.space['views.Int']).toEqual(['IntText', 'IntPair', 'none']);
    const drawn = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7, 8].map(
        async (seed) =>
          (await bundlePresentation(prepared, seed, { randomise: true })).variant['views.Int']
      )
    );
    expect(new Set(drawn)).toEqual(new Set(['IntText', 'IntPair']));
    const none = await bundlePresentation(prepared, 1, { chosen: { 'views.Int': 'none' } });
    expect(none.javascript).toContain('"views.Int":"none"');
  });

  it('orders components after those they render', () => {
    const prepared = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Int = type([1, 3]); const Row = collection(Int);</script><script lang="sverlin">@start[let values = Row([1, 3]);] @grow[values = Row([1, 3, 1]);]</script>{#snippet Search(values: Row)}<Node layout="row">{#each values as value}{@render Int(value)}{/each}</Node>{/snippet}{#snippet Plain(value: Int)}<Node {value} />{/snippet}{#snippet Boxed(value: Int)}<Node layout="row"><Node {value} /></Node>{/snippet}{@render Row(values)}`
    );
    expect(prepared.components.map(({ name }) => name)).toEqual(['Plain', 'Boxed', 'Search']);
    // Plain and Boxed show their value, so they take every value; Search only passes its values to
    // views, which keep their boxes, so it takes one, filled to the longest Row in the trace.
    expect(Object.fromEntries(prepared.components.map(({ name, cases }) => [name, cases]))).toEqual(
      { Plain: [1, 3], Boxed: [1, 3], Search: [[1, 1, 1]] }
    );
  });

  it('draws a record with one value for each field passed only to a view', () => {
    const prepared = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Vertex = type("integer", { min: 0, max: 5 }); const Weight = type([1, 4, 7]); const Edge = record({ from: Vertex, to: Vertex, weight: Weight });</script><script lang="sverlin"></script>{#snippet VertexView(v: Vertex)}<Node value={v} />{/snippet}{#snippet EdgeView(edge: Edge)}<Node layout="row">{@render Vertex(edge.from)}{@render Vertex(edge.to)}<Node value={edge.weight} /></Node>{/snippet}`
    );
    // from and to go to VertexView; weight is shown, so it takes each of its values.
    expect(prepared.components.find(({ name }) => name === 'EdgeView')?.cases).toEqual(
      [1, 4, 7].map((weight) => ({ from: 0, to: 0, weight }))
    );
  });

  it('measures the root with every value of what it reads for placement', () => {
    const prepared = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Int = type([1, 3]); const Index = type("integer", { min: -1, max: 3 }); const Values = collection(Int); const Reversed = unop((c: Values) => Values(c.slice().reverse()));</script><script lang="sverlin" input>const values = Values([1, 3, 1]); const target = Int(3);</script><script lang="sverlin">@start[let i = Index(-1);] @move[i = Index(0);]</script>{#snippet IntView(value: Int)}<Node {value} />{/snippet}{#snippet Cells()}<Node layout="row">{#each values as value, k}<Node>{@render Int(value)}{#if k === i}<Node>i</Node>{/if}</Node>{/each}</Node>{/snippet}{@render Int(target)}{@render Cells()}`
    );
    // i places the pointer, measured where it is first declared; target and the cells go to views.
    expect(prepared.paced(new Set(prepared.pauses.defaults)).placements).toEqual([
      { path: 'i', step: 3, values: [-1, 0, 1, 2, 3] }
    ]);
  });

  it('measures a position with every place in its collection, and as far past it as the trace goes', () => {
    const prepared = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Int = type([1, 3]); const Values = collection(Int); const Position = index(Values);</script><script lang="sverlin" input>const values = Values([1, 3, 1, 3]);</script><script lang="sverlin">@start[let i = Position(-1);] @move[i = Position(0);]</script>{#snippet Cells()}<Node layout="row">{#each values as value, k}<Node>{#if k === i}<Node>i</Node>{/if}</Node>{/each}</Node>{/snippet}{@render Cells()}`
    );
    expect(prepared.paced(new Set(prepared.pauses.defaults)).placements).toEqual([
      { path: 'i', step: 3, values: [-1, 0, 1, 2, 3] }
    ]);
  });

  it('draws every domain type with its widest values when all of them would be too many', () => {
    const prepared = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Count = type("integer", { min: 0, max: 999 }); const Ratio = type("number", { min: 0, max: 1 }); const Mark = type(["x", "yes"]); const Slot = union(Count, Mark); const Pair = record({ a: Count, b: Mark }); const Row = collection(Count); const Grid = collection(Row);</script><script lang="sverlin">let r = Ratio(0.125); let g = Grid([[1, 2], [3]]);</script>{#snippet C(count: Count)}<Node value={count} />{/snippet}{#snippet R(ratio: Ratio)}<Node value={ratio} />{/snippet}{#snippet S(slot: Slot)}<Node value={slot} />{/snippet}{#snippet P(pair: Pair)}<Node>{pair.a}{pair.b}</Node>{/snippet}{#snippet G(grid: Grid)}<Node layout="column">{#each grid as row}<Node>{#each row as count}{@render Count(count)}{/each}</Node>{/each}</Node>{/snippet}{@render Ratio(r)}`
    );
    expect(Object.fromEntries(prepared.components.map(({ name, cases }) => [name, cases]))).toEqual(
      {
        // A range's ends, and the value in the trace that prints longest.
        C: [0, 999, 1],
        R: [0, 1, 0.125],
        S: [0, 999, 1, 'yes', 'x'],
        P: [0, 999, 1].flatMap((a) => ['x', 'yes'].map((b) => ({ a, b }))),
        // G draws its counts only through C, which keeps its box whichever count it shows.
        G: [
          [
            [0, 0],
            [0, 0]
          ]
        ]
      }
    );
    // C shows a range too large to draw whole, so the page also draws its widest number in the
    // presentation's font.
    expect(prepared.components.find(({ name }) => name === 'C')?.range).toEqual({
      min: 0,
      max: 999
    });
    expect(prepared.components.find(({ name }) => name === 'R')?.range).toBeUndefined();
  });

  it.each([
    [
      'rendering a type nothing draws',
      () => component('{#snippet I()}<Node>{@render Int(i)}</Node>{/snippet}{@render I()}'),
      /Int is a type, and nothing draws it: add a view of it/
    ],
    [
      'rendering a snippet that is not defined',
      () =>
        component(
          '{#snippet IntCell(value: Int)}<Node {value} />{/snippet}{#snippet I()}<Node>{@render Int(i)}</Node>{/snippet}{@render I()}{@render Compared(i)}'
        ),
      /\{@render Compared\(…\)\} draws Compared, which no snippet, type, or operator is named/
    ],
    [
      'a view named after its type',
      () => component('{#snippet Int(value: Int)}<Node {value} />{/snippet}{@render Int(i)}'),
      /Int is a view named after its type/
    ],
    [
      'a part named after a type',
      () => component('{#snippet Int()}<Node>x</Node>{/snippet}{@render Int()}'),
      /The snippet Int has the name of a type/
    ],
    [
      'reading an algorithm variable',
      () => component('{#snippet Cell(value: Int)}<Node value={i} />{/snippet}'),
      /Cell reads i, an input or algorithm variable/
    ],
    [
      'types that are not domain types',
      () => component('{#snippet Cell(value: Number)}<Node {value} />{/snippet}'),
      /Cell's type Number is not a type/
    ],
    [
      'viewing more than one type',
      () => component('{#snippet Cell(value: Int, current: Flag)}<Node {value} />{/snippet}'),
      /Cell takes 2 domain types, Int, Flag; a component views one type/
    ],
    [
      'a parameter before the value',
      () => component('{#snippet Cell(node, value: Int)}<Node {value} />{/snippet}'),
      /Cell takes one value, its type given/
    ],
    [
      'a parameter after the value',
      () => component('{#snippet Cell(value: Int, node)}<Node {value} />{/snippet}'),
      /Cell takes one value, its type given/
    ],
    [
      'components inside markup',
      () =>
        component(
          '{#snippet Part()}<Node>{#snippet Cell(value: Int)}<Node {value} />{/snippet}</Node>{/snippet}{@render Part()}'
        ),
      /components are defined at the top level/
    ],
    [
      'views with more values than can be drawn',
      () =>
        prepareSvelteComponent(
          `<script lang="sverlin" domain>const Flag = type("boolean"); const Flags = record({ a: Flag, b: Flag, c: Flag, d: Flag, e: Flag, f: Flag, g: Flag, h: Flag, i: Flag });</script><script lang="sverlin"></script>{#snippet F(flags: Flags)}<Node>{flags.a}</Node>{/snippet}`
        ),
      /F would be drawn with too many values of Flags/
    ]
  ])('rejects %s', (_name, prepare, message) => {
    expect(prepare).toThrow(message);
  });
});

describe('scope', () => {
  const source = (markup: string) =>
    `<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Position = index(Values); const Flag = type("boolean"); const Length = unop((v: Values) => Position(v.length)); const Before = binop((a: Position, b: Position) => Flag(a < b)); const Next = unop((p: Position) => Position(p + 1));</script><script lang="sverlin" input>const values = Values([5, 2]);</script><script lang="sverlin">for (let i = Position(1); Before(i, Length(values)); i = Next(i)) {\n  @key[const key = values[i];]\n}\n@done[const done = Flag(true);]</script>{#snippet IntText(value: Int)}<Node {value} />{/snippet}${markup}`;

  it('stands a variable out of scope in hidden, with its value from the nearest step', async () => {
    const prepared = prepareSvelteComponent(source('{@render Int(key)}'));
    const { javascript } = await bundlePresentation(prepared, 1);
    // After the loop, i and key are out of scope: they stand in from the step that had them.
    expect(javascript).toContain('values:[5,2],i:1,key:2');
    expect(javascript).toContain('__absent:["i","key"]');
  });

  it('rejects the view reading a variable out of scope at some step itself', () => {
    expect(() =>
      prepareSvelteComponent(source('{#snippet K()}<Node>{key}</Node>{/snippet}{@render K()}'))
    ).toThrow('The view reads key itself, but key is out of scope at some steps');
  });

  it('rejects choosing by a label value, pointing at labelling the guarded code', () => {
    const chosen = source(
      '{#snippet Held()}<Node>held</Node>{/snippet}{#if @at}{@render Held()}{/if}'
    ).replace('@key[const key = values[i];]', '@key[const key = @at[values[i]];]');
    expect(() => prepareSvelteComponent(chosen)).toThrow(
      "A view cannot choose what to draw by a label's value, as {#if @at}"
    );
  });

  it('takes a variable declared later read itself only inside a node, which hides at step 0', () => {
    expect(() =>
      prepareSvelteComponent(
        source('{#snippet D()}<Node>{#if done}Done{/if}</Node>{/snippet}{@render D()}')
      )
    ).not.toThrow();
    expect(() =>
      prepareSvelteComponent(
        source('{#snippet D()}{#if done}<Node>Done</Node>{/if}{/snippet}{@render D()}')
      )
    ).toThrow('The view reads done itself outside any <Node>');
  });
});

describe('views', () => {
  it('are only drawn with {@render}, never called to make a value', () => {
    const source = `<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Index = index(Values);</script><script lang="sverlin" input>const values = Values([5, 2]);</script><script lang="sverlin"></script>{#snippet IntText(value: Int)}<Node {value} />{/snippet}{#snippet IndexLabel(value: Index)}<Node {value} />{/snippet}{#snippet Row(list: Values)}<Node layout="row">{#each list as v, k}{@render Int(v)}{@render Index(Index(k))}{/each}</Node>{/snippet}{@render Values(values)}`;
    expect(() => prepareSvelteComponent(source)).toThrow(
      'Index(…) is a view, which only draws: write {@render Index(value)}'
    );
  });
});

describe('view choices and prop values', () => {
  const domain =
    '<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 3 });</script><script lang="sverlin">const i = Int(1);</script>';

  it('leaves out of a type’s views those that draw the type itself', () => {
    const prepared = prepareSvelteComponent(
      `${domain}{#snippet Plain(value: Int)}<Node {value} />{/snippet}{#snippet Boxed(value: Int)}<Node>{@render Int(value)}</Node>{/snippet}{@render Int(i)}`
    );
    expect(prepared.design.space['views.Int']).toEqual(['Plain', 'none']);
    expect(() =>
      prepareSvelteComponent(
        `${domain}{#snippet Boxed(value: Int)}<Node>{@render Int(value)}</Node>{/snippet}{@render Int(i)}`
      )
    ).toThrow('Every view of Int draws Int itself');
  });

  it('checks every value an expression can give a prop with fixed options', () => {
    expect(() =>
      prepareSvelteComponent(
        `${domain}{#snippet A()}<Node layout={step ? 'row' : 'stack'}><Node>a</Node></Node>{/snippet}{@render A()}`
      )
    ).toThrow(`layout={step ? 'row' : 'stack'} can be "stack"`);
  });
});

describe('views of what a step computed', () => {
  const bubble = `<script lang="sverlin" domain>
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
{#snippet Title()}<Node>Bubble sort</Node>{/snippet}
{#snippet Board()}
  <Node layout="column">
    <Node>{#each values as v}{@render Int(v)}{/each}</Node>
    {@render Greater()}
  </Node>
{/snippet}

{@render Title()}
{@render Board()}`;

  it('take an operator as a type, its views a choice, and keep an application to stand in', () => {
    const prepared = prepareSvelteComponent(bubble);
    expect(prepared.design.space['views.Greater']).toEqual(['Ask', 'none']);
    expect(prepared.applied?.Greater).toEqual({
      state: { a: 5, b: 1, value: true },
      types: { a: 'Int', b: 'Int', value: 'Flag' },
      at: expect.any(Number),
      identities: { a: expect.any(Number), b: expect.any(Number), value: expect.any(Number) }
    });
  });

  it('give a step’s after its one application, and stand one in hidden elsewhere', async () => {
    const prepared = prepareSvelteComponent(bubble);
    const { javascript } = await bundlePresentation(prepared, 1);
    expect(javascript).toContain('__applied_Greater');
  });

  it('pause at each comparison its label runs, and apart from it at each swap', async () => {
    const prepared = prepareSvelteComponent(bubble);
    const steps = (master: typeof prepared.master) =>
      master.map(({ state, applied }) => [
        String(state.values),
        applied?.Greater?.map(({ state }) => `${state.a} > ${state.b}`) ?? []
      ]);
    // The comparison lifts its operands, then the swap moves them, each a step of its own.
    expect(steps(prepared.master).slice(1, 5)).toEqual([
      ['5,1,4,2,3', ['5 > 1']],
      ['1,5,4,2,3', []],
      ['1,5,4,2,3', ['5 > 4']],
      ['1,4,5,2,3', []]
    ]);
    // Ten comparisons and six swaps, after the input as given.
    expect(prepared.master).toHaveLength(17);
    expect(prepared.pauses.defaults).toEqual(['sweep.pair.test', 'sweep.pair.swap']);
    // Not pausing at the comparisons, the sort plays through its swaps, each comparison leading up
    // to its swap and drawn there.
    const swaps = prepared.paced(new Set(['sweep.pair.swap'])).steps;
    expect(steps(swaps).slice(1, 3)).toEqual([
      ['1,5,4,2,3', ['5 > 1']],
      ['1,4,5,2,3', ['5 > 4']]
    ]);
    const paced = await bundlePresentation(prepared, 1, {
      chosen: { 'pause@sweep.pair.test': false }
    });
    expect(paced.labels).toHaveLength(7);
    expect(paced.masterSignature).toBe((await bundlePresentation(prepared, 1)).masterSignature);
  });

  it('reject an operator rendered with a value, or inside a view', () => {
    expect(() =>
      prepareSvelteComponent(bubble.replace('{@render Greater()}', '{@render Greater(values)}'))
    ).toThrow('draws a value of Greater, an operator, whose values are its applications');
    expect(() =>
      prepareSvelteComponent(
        bubble.replace(
          '{#snippet IntCell(value: Int)}<Node {value} />{/snippet}',
          '{#snippet IntCell(value: Int)}<Node {value} />{@render Greater()}{/snippet}'
        )
      )
    ).toThrow('which only the root and its parts know: render it there');
  });

  it('stand in an operator no step applies with its widest value, hidden throughout', () => {
    const prepared = prepareSvelteComponent(
      bubble
        .replace(
          '  // what the algorithm does',
          '  const Less = binop((a: Int, b: Int) => Flag(a < b));\n  // what the algorithm does'
        )
        .replace('{@render Greater()}', '{@render Greater()}{@render Less()}')
        .replace(
          '{#snippet FlagWord',
          '{#snippet Tell(l: Less)}<Node>{@render Flag(l.value)}</Node>{/snippet}\n{#snippet FlagWord'
        )
    );
    expect(Object.keys(prepared.applied?.Less?.state ?? {})).toEqual(['a', 'b', 'value']);
    expect(prepared.applied?.Less?.types).toEqual({ a: 'Int', b: 'Int', value: 'Flag' });
  });
});

describe('pauses at labels', () => {
  const insertion = `<script lang="sverlin" domain>
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
    let j = i;
    while (Before(Position(0), j) && @compare[Greater(values[@left[Prev(j)]], values[@right[j]])]) @swap{
      const moved = values[@from[Prev(j)]];
      values[Prev(j)] = values[@to[j]];
      values[j] = moved;
      j = Prev(j);
    }
  }
</script>

<script lang="sverlin" listing="code">
  for i = 1 to length(A) - 1
    @insert[j = i
    while j > 0 and @compare[A[@left[j - 1]] > A[@right[j]]]
      @swap[moved = A[@from[j - 1]]
      A[j - 1] = A[@to[j]]
      A[j] = moved
      j = j - 1]]
</script>

{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet FlagWord(value: Flag)}<Node>{value ? 'yes' : 'no'}</Node>{/snippet}
{#snippet Ask(g: Greater)}<Node>is {@render Int(g.a)} > {@render Int(g.b)}? {@render Flag(g.value)}</Node>{/snippet}
{#snippet Highlight(p: Position)}<Pointed />{/snippet}
{#snippet Board()}
  <Node layout="row">
    <Listing />
    <Node layout="column">
      <Node>{#each values as v}{@render Int(v)}{/each}</Node>
      {@render Greater()}
    </Node>
  </Node>
{/snippet}

{@render Board()}
{@render Position(@left)}
{@render Position(@right)}
{@render Position(@from)}
{@render Position(@to)}`;
  const fine = new Set([
    'insert.compare',
    'insert.compare.left',
    'insert.compare.right',
    'insert.swap',
    'insert.swap.to'
  ]);

  // Each step: the row after it, its comparison, the marks its code gave, and those held on.
  const played = (master: MasterStep[]) =>
    master.slice(1).map((step) => {
      const comparison = step.applied?.Greater?.[0]?.state;
      const short = (labels?: Record<string, unknown>) =>
        Object.keys(labels ?? {})
          .map((label) => label.slice(label.lastIndexOf('.') + 1))
          .sort()
          .join(' ');
      return [
        String(step.state.values),
        comparison ? `${comparison.a} > ${comparison.b}: ${comparison.value}` : '',
        short(step.labelled),
        short(step.held)
      ].join(' | ');
    });

  it('offers a pause at every label, by its full name, on where the view gives a reason', () => {
    const prepared = prepareSvelteComponent(insertion);
    const pauses = Object.entries(prepared.design.starter).filter(([key]) =>
      key.startsWith('pause@')
    );
    // A label with labels inside it accumulates where it is on; one without is only on or off.
    expect(Object.fromEntries(pauses)).toEqual({
      'pause@insert': 'off',
      'pause@insert.compare': 'accumulate',
      'pause@insert.compare.left': 'off',
      'pause@insert.compare.right': 'off',
      'pause@insert.swap': 'accumulate',
      'pause@insert.swap.from': 'off',
      'pause@insert.swap.to': 'off'
    });
    expect(prepared.design.space['pause@insert.compare']).toEqual(['accumulate', 'on', 'off']);
    expect(prepared.design.space['pause@insert.swap.to']).toEqual(['on', 'off']);
    expect(played(prepared.master).slice(0, 5)).toEqual([
      '5,2,4,1 | 5 > 2: true | left right | ',
      '2,5,4,1 |  | from to | ',
      '2,5,4,1 | 5 > 4: true | left right | ',
      '2,4,5,1 |  | from to | ',
      '2,4,5,1 | 2 > 4: false | left right | '
    ]);
  });

  it('pauses at each label switched on, holding a mark until the run around it finishes', () => {
    const prepared = prepareSvelteComponent(insertion);
    // Left, right, the comparison, the swap's marks with nothing moved, then the swap; the pair in
    // order makes no marks step, as no swap runs.
    expect(played(prepared.paced(fine).steps).slice(0, 11)).toEqual([
      '5,2,4,1 |  | left | ',
      '5,2,4,1 |  | right | left',
      '5,2,4,1 | 5 > 2: true |  | left right',
      '5,2,4,1 |  | from to | ',
      '2,5,4,1 |  |  | from to',
      '2,5,4,1 |  | left | ',
      '2,5,4,1 |  | right | left',
      '2,5,4,1 | 5 > 4: true |  | left right',
      '2,5,4,1 |  | from to | ',
      '2,4,5,1 |  |  | from to',
      '2,4,5,1 |  | left | '
    ]);
  });

  it('lights each pause’s region and lines the presentations up by moment', async () => {
    const prepared = prepareSvelteComponent(insertion);
    const { text } = prepared.listings!.code;
    const lit = prepared
      .paced(fine)
      .lit.code.slice(1, 4)
      .map(({ current }) => current.map(([start, end]) => text.slice(start, end)));
    expect(lit).toEqual([['j - 1'], ['j'], ['A[j - 1] > A[j]']]);
    const coarse = await bundlePresentation(prepared, 1);
    const apart = await bundlePresentation(prepared, 1, {
      chosen: {
        'pause@insert.compare.left': 'on',
        'pause@insert.compare.right': 'on',
        'pause@insert.swap.to': 'on'
      }
    });
    expect(apart.masterSignature).toBe(coarse.masterSignature);
    expect(apart.labels.length).toBeGreaterThan(coarse.labels.length);
    // Every step of the coarse presentation falls on one of the fine one's.
    expect(coarse.masterSteps.every((moment) => apart.masterSteps.includes(moment))).toBe(true);
  });

  it('names a pause by the label’s full name, refusing its short ending', async () => {
    const prepared = prepareSvelteComponent(insertion);
    await expect(
      bundlePresentation(prepared, 1, { chosen: { 'pause@left': 'on' } })
    ).rejects.toThrow('a pause names a label by its full name');
  });
});

describe('pauses accumulate', () => {
  const insertion = prepareSvelteComponent(
    // The pauses-at-labels source, whose listing marks every label.
    `<script lang="sverlin" domain>
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
    let j = i;
    while (Before(Position(0), j) && @compare[Greater(values[@left[Prev(j)]], values[@right[j]])]) @swap{
      const moved = values[@from[Prev(j)]];
      values[Prev(j)] = values[@to[j]];
      values[j] = moved;
      j = Prev(j);
    }
  }
</script>
<script lang="sverlin" listing="code">
  for i = 1 to length(A) - 1
    @insert[j = i
    while j > 0 and @compare[A[@left[j - 1]] > A[@right[j]]]
      @swap[moved = A[@from[j - 1]]
      A[j - 1] = A[@to[j]]
      A[j] = moved
      j = j - 1]]
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet FlagWord(value: Flag)}<Node>{value ? 'yes' : 'no'}</Node>{/snippet}
{#snippet Ask(g: Greater)}<Node>is {@render Int(g.a)} > {@render Int(g.b)}? {@render Flag(g.value)}</Node>{/snippet}
{#snippet Highlight(p: Position)}<Pointed />{/snippet}
{#snippet Board()}
  <Node layout="row">
    <Listing />
    <Node layout="column">
      <Node>{#each values as v}{@render Int(v)}{/each}</Node>
      {@render Greater()}
    </Node>
  </Node>
{/snippet}
{@render Board()}
{@render Position(@left)}
{@render Position(@right)}
{@render Position(@from)}
{@render Position(@to)}`
  );
  const { text } = insertion.listings!.code;
  const operands = { 'insert.compare.left': 'on', 'insert.compare.right': 'on' } as const;
  /** The first three steps' marks held, and the listing's text, current and earlier. */
  const firstSteps = (modes: Record<string, PauseMode>) => {
    const { steps, lit } = insertion.paced(new Map(Object.entries(modes)));
    const texts = (ranges: readonly (readonly [number, number])[]) =>
      ranges.map(([start, end]) => text.slice(start, end));
    return [1, 2, 3].map((index) => ({
      held: Object.keys(steps[index].held ?? {}).map((label) => label.split('.').at(-1)),
      current: texts(lit.code[index].current),
      earlier: texts(lit.code[index].earlier)
    }));
  };

  it('keep the comparison’s earlier parts, marks and code alike, until it finishes', () => {
    const [left, right, compare] = firstSteps({ ...operands, 'insert.compare': 'accumulate' });
    expect(left).toMatchObject({ held: [], current: ['j - 1'] });
    // At the right operand, the left one stays marked, and its code lit faintly.
    expect(right.held).toEqual(['left']);
    expect(right.current).toEqual(['j']);
    expect(right.earlier.join(' ')).toContain('j - 1');
    expect(compare).toMatchObject({ held: ['left', 'right'], current: ['A[j - 1] > A[j]'] });
  });

  it('show only each pause’s own part where the run around it is on', () => {
    const [left, right, compare] = firstSteps({ ...operands, 'insert.compare': 'on' });
    // What led up to the comparison, outside it, is lit faintly; none of the comparison is.
    expect(left).toEqual({
      held: [],
      current: ['j - 1'],
      earlier: ['j = i\n  while j > 0 and']
    });
    expect(right).toEqual({ held: [], current: ['j'], earlier: [] });
    // Its own end shows the whole of its run.
    expect(compare).toMatchObject({ held: ['left', 'right'], current: ['A[j - 1] > A[j]'] });
  });

  it('pass through a label that is off, to the runs around it', () => {
    // Off, the comparison neither pauses nor keeps: the insertion around it, accumulating, keeps.
    const kept = firstSteps({ ...operands, insert: 'accumulate', 'insert.swap': 'accumulate' });
    expect(kept[1].held).toEqual(['left']);
    expect(kept[1].earlier.join(' ')).toContain('j - 1');
    // With nothing around it keeping, only the code since the step before is lit faintly, as the
    // left operand's cell read.
    const none = firstSteps({ ...operands, 'insert.swap': 'accumulate' });
    expect(none[1]).toEqual({ held: [], current: ['j'], earlier: ['A[', '] > A[', ']'] });
  });

  it('nest: an accumulating run keeps its parts from before an inner run that is on', () => {
    const [, right] = firstSteps({ ...operands, insert: 'accumulate', 'insert.compare': 'on' });
    // The insertion's start, before the comparison, stays; the comparison's left operand does not.
    expect(right.held).toEqual([]);
    expect(right.earlier.join(' ')).toContain('j = i');
    expect(right.earlier.join(' ')).not.toContain('j - 1');
  });

  it('take a leaf’s accumulating, which has no pauses inside it, as on', () => {
    expect(
      pausesOf(insertion.pauses, {
        'pause@insert.compare.left': 'accumulate',
        'pause@insert.compare': 'on'
      })
    ).toEqual(
      new Map([
        ['insert.compare', 'on'],
        ['insert.compare.left', 'on'],
        ['insert.swap', 'accumulate']
      ])
    );
  });

  it('read a pause saved as true or false as switched on in its first way, or off', async () => {
    const saved = await bundlePresentation(insertion, 1, {
      chosen: { 'pause@insert.compare.left': true, 'pause@insert.compare': false }
    });
    const named = await bundlePresentation(insertion, 1, {
      chosen: { 'pause@insert.compare.left': 'on', 'pause@insert.compare': 'off' }
    });
    expect(saved.masterSteps).toEqual(named.masterSteps);
    const { values, origins } = buildVariant(
      insertion.design.space,
      insertion.design.starter,
      { base: { 'pause@insert': true, 'pause@insert.swap': false } },
      1
    );
    expect(values['pause@insert']).toBe('accumulate');
    expect(values['pause@insert.swap']).toBe('off');
    expect(origins['pause@insert']).toBe('kept');
  });
});

describe('places', () => {
  const source = (view: string, algorithm = 'let i = Index(1); let key = Int(2);') =>
    `<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Index = index(Values);</script><script lang="sverlin" input>const values = Values([5, 2]);</script><script lang="sverlin">${algorithm}</script>{#snippet IntCell(value: Int)}<Node {value} />{/snippet}{#snippet IntTally(value: Int)}<Node>{'•'.repeat(value)}</Node>{/snippet}{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}${view}`;

  it('refuses a view rendered by its own name, naming its type', () => {
    expect(() =>
      prepareSvelteComponent(
        source('{#snippet Key()}<Node>{@render IntTally(key)}</Node>{/snippet}{@render Key()}')
      )
    ).toThrow(
      "{@render IntTally(…)} names the view IntTally, but which view draws a value is the variant's: render its type, as {@render Int(…)}"
    );
  });

  it("gives a render with an argument its own choice of view and paint, falling back to its type's", () => {
    const view =
      '{#snippet Key()}<Node>{@render Int(key)}</Node>{/snippet}{@render Cells()}{@render Key()}';
    const prepared = prepareSvelteComponent(source(view));
    const { space, starter, renders, fallbacks } = prepared.design;
    expect(space['views.Int@key']).toEqual(['IntCell', 'IntTally', 'none']);
    expect(starter['views.Int@key']).toBe('IntCell');
    expect(fallbacks['views.Int@key']).toBe('views.Int');
    expect(space['IntTally@key.fill']).toBeDefined();
    expect(space['IntCell@v.color']).toBeDefined();
    // The editor's marker after the render names the place's own choice.
    expect(Object.values(renders)).toContain('views.Int@key');
  });

  it('refuses a label and a variable a place would share', () => {
    expect(() =>
      prepareSvelteComponent(
        source(
          '{#snippet Shown()}<Node>{@render Int(key)} {@render Int(@key)}</Node>{/snippet}{@render Shown()}',
          '@start[let key = Int(2);] @pick[const picked = @key[values[0]];]'
        )
      )
    ).toThrow('rename the label');
  });
});

describe('nodes and references', () => {
  const domain = `<script lang="sverlin" domain>
  const Name = type(['A', 'B', 'C']);
  const Flag = type('boolean');
  const End = type(['end']);
  const ListNode = record({ name: Name, next: Next });
  const NodeRef = ref(ListNode);
  const Next = union(NodeRef, End);
  const IsNode = unop((p: Next) => Flag(p !== 'end'));
</script>
<script lang="sverlin" input>
  const head = NodeRef(ListNode({ name: 'A', next: NodeRef(ListNode({ name: 'B', next: End('end') })) }));
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
{#snippet Here(p: NodeRef)}<Pointed />{/snippet}`;
  const heap = `{#snippet Heap()}<Node layout="free" flow="x">{#each all(ListNode) as n}{@render ListNode(n)}{/each}</Node>{/snippet}{@render Heap()}{@render NodeRef(cur)}`;
  const box = `{#snippet NodeBox(n: ListNode)}<Node layout="row">{@render Name(n.name)}<Link to={n.next} /></Node>{/snippet}`;

  it('draws every live node with all(…), a reference as a pointer, and the end through its view', () => {
    const prepared = prepareSvelteComponent(`${domain}${box}${heap}`);
    expect(prepared.design.space['views.ListNode']).toEqual(['NodeBox', 'none']);
    expect(prepared.design.space['pointers.NodeRef']).toEqual(['Here', 'none']);
    // The end a link to no node gives is drawn with its type's view, a choice of its own.
    expect(prepared.design.space['views.End']).toEqual(['EndMark', 'none']);
    expect(prepared.master.at(-1)!.state['ȟListNode']).toEqual([
      { name: 'B', next: 1 },
      { name: 'A', next: 'end' }
    ]);
  });

  it.each([
    [
      'all(…) of a record no reference refers to',
      `${box}{#snippet Heap()}<Node layout="free">{#each all(Name) as n}{@render ListNode(n)}{/each}</Node>{/snippet}{@render Heap()}`,
      /all\(Name\) draws every live node of a record a reference refers to, and Name is not one/
    ],
    [
      'a link with no from outside a view',
      `{#snippet Heap()}<Node layout="free"><Link to={cur} /></Node>{/snippet}{@render Heap()}`,
      /A <Link> with no from starts at the element its view draws/
    ]
  ])('refuses %s', (_name, markup, message) => {
    expect(() => prepareSvelteComponent(`${domain}${markup}`)).toThrow(message);
  });
});
