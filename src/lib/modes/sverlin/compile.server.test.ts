import { describe, expect, it } from 'vitest';

import {
  bundlePresentation,
  compileSvelteComponent,
  InvalidSvelteSourceError,
  prepareSvelteComponent
} from './compile.server';
import { linearSearchSource } from './contract';

/** The kinds of node a prepared source's design space has, from its variables' keys. */
const kindsOf = (space: Record<string, unknown>) =>
  [
    ...new Set(
      Object.keys(space)
        .filter((key) => !key.startsWith('views.') && !key.startsWith('frame.') && key !== 'frames')
        .map((key) => key.slice(0, key.lastIndexOf('.')))
    )
  ].sort();

describe('single-component Svelte compilation', () => {
  it('bundles a component and its playback input without executing it', async () => {
    const result = await compileSvelteComponent(
      '<script lang="sverlin">@a[;] @b[;]</script><Node>{step}</Node>'
    );
    expect(result.labels).toEqual(['Step 1', 'Step 2']);
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
    // The starter's linear search: its start, a step at each check, then its end.
    expect(prepared.master.map(({ state }) => state.i)).toEqual([undefined, 0, 1, 2, 3, undefined]);
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
      compileSvelteComponent('<script lang="sverlin" input>const x = 1;</script><Node>x</Node>')
    ).rejects.toThrow('Add a <script lang="sverlin"> algorithm block');
  });

  it('rejects looks given as props, which are the design’s', async () => {
    const view = (markup: string) =>
      compileSvelteComponent(`<script lang="sverlin"></script>\n${markup}`);
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
      '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 });</script>\n<script lang="sverlin">\n  let i = 0;\n\n</script>\n<Node shape="circle">v1</Node>\n<Node class="x" />'
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
        '<script lang="sverlin"></script>\n<Node>a</Node>\n<Node tags={step ? name : "b"}>b</Node>'
      )
    ).rejects.toMatchObject({ code: 'view_tags', line: 3 });
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
    await expect(compileSvelteComponent('<Node>Hi</Node>')).rejects.toThrow(
      'Add a <script lang="sverlin"> algorithm block'
    );
    await expect(
      compileSvelteComponent('<script lang="sverlin"></script><script lang="sverlin"></script>')
    ).rejects.toThrow('only one algorithm block');
  });

  it('injects the sverlin library components without authored imports', async () => {
    const result = await compileSvelteComponent(linearSearchSource);
    expect(result.javascript).toContain('sv-node');
    expect(result.javascript).toContain('sv-node');
    const withoutModuleScript = await compileSvelteComponent(
      '<script lang="sverlin"></script><Node>x</Node>'
    );
    expect(withoutModuleScript.labels).toEqual(['Step 1']);
    expect(withoutModuleScript.javascript).toContain('sv-node');
  });

  it('puts every recorded value in scope for a script-free view', async () => {
    const result = await compileSvelteComponent(
      '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 }); const Values = collection(Int); const Add = binop((a: Int, b: Int) => Int(a + b));</script><script lang="sverlin" input>const values = Values([4, 9]);</script>\n<script lang="sverlin">@start[let total = Int(0);]\nfor (const v of values) {\n  @add[total = Add(total, v);]\n}</script>\n<Node layout="column">{@const doubled = total * 2}<Node tags="sum">{values.join("+")} = {total}; doubled {doubled}; step {step}, seed {seed}</Node></Node>',
      5
    );
    // The start, a step per addition, then the end.
    expect(result.labels).toEqual(['Step 1', 'Step 2', 'Step 3', 'Step 4']);
    expect(result.variant['root[sum].fill']).toBeDefined();
  });

  it('gives every kind of node, from its view and tags, the variables its role has', () => {
    const { design } = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Int = type([1, 3]); const Values = collection(Int); const Position = index(Values); const Flag = type('boolean');</script><script lang="sverlin" input>const values = Values([1, 3]);</script><script lang="sverlin">let i = Position(0); let found = Flag(false);</script>{#snippet IntCell(value: Int)}<Node {value} />{/snippet}{#snippet Arrow(p: Position)}<Node layout="column"><Pointed tags={['current', found && 'found']} /><Node tags="label">i</Node></Node>{/snippet}{#snippet Mark(p: Position)}<Pointed />{/snippet}<Node layout="row">{#each values as v}{@render Int(v)}{/each}</Node>{@render Arrow(i)}<Node tags={found ? 'done' : null}>note</Node><Node layout="free"><Node key="a" /><Node key="b" /><Link from="a" to="b" /></Node>`
    );
    expect(kindsOf(design.space)).toEqual(
      [
        'root',
        'root[done]',
        'root[link]',
        'IntCell',
        'Arrow',
        'Arrow[current]',
        'Arrow[current,found]',
        'Arrow[label]',
        'Mark[pointed]'
      ].sort()
    );
    expect(design.space['root.gap']).toBeDefined();
    expect(design.space['IntCell.gap']).toBeUndefined();
    expect(design.space['Arrow[current].shown']).toBeUndefined();
    expect(design.space['root[link].strokeStyle']).toEqual(['solid', 'dashed', 'dotted']);
    expect(design.space['views.Int']).toEqual(['IntCell', 'none']);
  });

  it.each([
    [
      'tags that cannot be read before the view runs',
      '<Node tags={name}>x</Node>',
      /tags=\{name\} cannot be read before the view runs/
    ],
    [
      'more kinds than one tag may make',
      "<Node tags={[step && 'a', step && 'b', step && 'c', step && 'd', step && 'e']}>x</Node>",
      /make 32 kinds of node, more than 16/
    ]
  ])('rejects %s', async (_name, markup, message) => {
    await expect(
      compileSvelteComponent(`<script lang="sverlin"></script>${markup}`)
    ).rejects.toThrow(message);
  });

  it('rejects a <Pointed> and a node of one kind', () => {
    expect(() =>
      prepareSvelteComponent(
        `<script lang="sverlin" domain>const Int = type([1, 3]); const Values = collection(Int); const Position = index(Values);</script><script lang="sverlin" input>const values = Values([1, 3]);</script><script lang="sverlin">let i = Position(0);</script>{#snippet Arrow(p: Position)}<Node layout="column"><Pointed tags="x" /><Node tags="x">i</Node></Node>{/snippet}<Node layout="row">{#each values as v}<Node value={v} />{/each}</Node>{@render Arrow(i)}`
      )
    ).toThrow(/and by another kind of tag/);
  });

  it('rejects props a library component does not take, and written values it cannot use', async () => {
    const view = (markup: string) =>
      compileSvelteComponent(`<script lang="sverlin"></script>\n${markup}`);
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
      view(
        '{#snippet Int(value, node)}<Node {value} {...node} />{/snippet}<Node layout={step ? "row" : "column"} value={1} />'
      )
    ).resolves.toBeDefined();
  });

  it('draws views only with Node and Link', async () => {
    const view = (markup: string) =>
      compileSvelteComponent(`<script lang="sverlin"></script>\n${markup}`);
    await expect(view('<Node>Hi</Node>\n<style>div { color: red; }</style>')).rejects.toMatchObject(
      { code: 'view_style', line: 3, message: expect.stringContaining('<style>') }
    );
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
    await expect(view('<svelte:head><title>x</title></svelte:head>')).rejects.toMatchObject({
      code: 'view_markup'
    });
    await expect(view('<svelte:element this="div" />')).rejects.toMatchObject({
      code: 'view_markup'
    });
    await expect(view('Linear search')).rejects.toMatchObject({ code: 'view_text', line: 2 });
    await expect(view('{#if step}{step}{/if}')).rejects.toMatchObject({ code: 'view_text' });
    // Text inside a node or a snippet is drawn by a node, and whitespace between nodes is ignored.
    await expect(
      view(
        '{#snippet Note(text)}{text}{/snippet}\n<Node>Step {step}</Node>\n<Node>{@render Note("x")}</Node>'
      )
    ).resolves.toBeDefined();
  });

  it('shows the source’s own listing where the view places a <Listing />, lit per step', async () => {
    const source = [
      '<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Index = index(Values); const Flag = type("boolean"); const Length = unop((v: Values) => Index(v.length)); const Before = binop((a: Index, b: Index) => Flag(a < b)); const Next = unop((p: Index) => Index(p + 1));</script>',
      '<script lang="sverlin" input>const values = Values([3, 8]);</script>',
      '<script lang="sverlin">@loop[for (let i = Index(0); Before(i, Length(values)); i = Next(i)) {}]</script>',
      '<script lang="sverlin" listing="code">for @loop[i = 1 to n]</script>',
      '<Node layout="row"><Listing /><Node>{#each values as v}<Node value={v} />{/each}</Node></Node>'
    ].join('\n');
    const prepared = prepareSvelteComponent(source);
    expect(prepared.design.space['listing.language']).toEqual(['code', 'none']);
    expect(prepared.design.starter['listing.language']).toBe('code');
    expect(prepared.listings?.code.text).toBe('for i = 1 to n');
    // A step per pass, then the end.
    expect(prepared.listings?.code.lit.loop).toHaveLength(3);
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
        `${blocks}{#snippet Code(value: Int)}<Node {value} /><Listing />{/snippet}{@render Code(n)}`
      )
    ).toThrow('place <Listing /> outside views');
    expect(() => prepareSvelteComponent(`${blocks}<Listing />`)).toThrow(
      "A <Listing /> shows a listing of the source's own"
    );
  });

  it('rejects view scripts and values that shadow library components', async () => {
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin"></script>\n\n<script>const x = 1;</script>\n<Node>{x}</Node>'
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
        '<Node layout="column">{#each grid as row}<Node>{#each row as v}{@render Int(v)}{/each}</Node>{/each}</Node>'
      )
    );
    expect(result.javascript).toContain('sv-node');
    await expect(compileSvelteComponent(source('<Node items={grid} />'))).rejects.toMatchObject({
      code: 'unknown_prop',
      message: expect.stringContaining('<Node> has no prop items')
    });
  });

  it('marks the node showing a view’s own value with its type, for its unit', async () => {
    const source = (view: string) =>
      `<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 }); const Height = type(Int, { unit: "cm" }); const People = collection(Height);</script><script lang="sverlin" input>const people = People([150, 170]);</script><script lang="sverlin"></script>${view}<Node>{#each people as person}{@render Height(person)}{/each}</Node>`;
    const view =
      '{#snippet HeightView(h: Height)}<Node layout="column"><Node value={h} /><Node>tall</Node></Node>{/snippet}';
    const prepared = prepareSvelteComponent(source(view));
    expect(prepared.component.match(/__type: 'Height'/g)).toHaveLength(1);
    await expect(
      compileSvelteComponent(source(`${view}<Node value={people[0]} type="Height" />`))
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
    const prepared = prepareSvelteComponent('<script lang="sverlin"></script><Node value={1} />');
    const built = await bundlePresentation(prepared, 3, {
      chosen: { 'root.radius': 999 },
      // Removed and unfit base values are the starter's instead.
      base: { 'root.fill': 'blue-100', 'root.size': 9, 'gone.width': 2 }
    });
    expect(built.variant).toMatchObject({ 'root.radius': 999, 'root.fill': 'blue-100' });
    expect(built.variant['root.size']).toBe(prepared.design.starter['root.size']);
    expect(built.variant).not.toHaveProperty('gone.width');
    expect(built.origins).toMatchObject({
      'root.radius': 'chosen',
      'root.fill': 'kept',
      'root.size': 'starter'
    });
    await expect(
      bundlePresentation(prepared, 3, { chosen: { 'root.radius': 3 } })
    ).rejects.toMatchObject({
      code: 'design_value',
      message: expect.stringContaining('root.radius cannot be 3')
    });
    await expect(bundlePresentation(prepared, 3, { chosen: { 'root.width': 2 } })).rejects.toThrow(
      'root has no prop width'
    );
  });

  it('takes the page frame from the variant', async () => {
    const prepared = prepareSvelteComponent('<script lang="sverlin"></script><Node>a</Node>');
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
      `${algorithm}\n<Node layout="free">\n  <Node key="a">a</Node><Node key="b">b</Node>\n  {#if true}<Link from="a" to="b" />{/if}\n</Node>`
    );
    expect(nested.component).toMatch(/__ref: ['"]4:13['"]/u);
    expect(nested.component).toMatch(/__links: true/u);
    expect(() =>
      prepareSvelteComponent(
        `${algorithm}<Node key="a">a</Node><Node key="b">b</Node><Link from="a" to="b" />`
      )
    ).toThrow('put it, with the nodes it joins, in a <Node layout="free">');
    expect(() =>
      prepareSvelteComponent(
        `${algorithm}\n<Node layout="free"><Link from="a" to="b" __id="x" /></Node>`
      )
    ).toThrow('Link props starting with __, such as __id, are reserved');
  });

  it('tags every Node with its source position and reserves __ props', async () => {
    const algorithm = '<script lang="sverlin"></script>';
    const { component } = prepareSvelteComponent(
      `${algorithm}\n<Node layout="column">\n  {#if true}<Node value={1} />{/if}\n</Node>`
    );
    expect(component).toMatch(/__ref: ['"]2:1['"]/u);
    expect(component).toMatch(/__ref: ['"]3:13['"]/u);
    expect(() => prepareSvelteComponent(`${algorithm}\n<Node __id="x" />`)).toThrow(
      expect.objectContaining({ code: 'reserved_prop', line: 2 })
    );
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
          `<script lang="sverlin"></script><Node>{require(${JSON.stringify(path)})}</Node>`
        )
      ).rejects.toMatchObject({
        name: 'InvalidSvelteSourceError',
        message: expect.stringContaining('cannot load module')
      });
    }
  );

  it('keeps authored line numbers after prelude injection', async () => {
    await expect(
      compileSvelteComponent('<script lang="sverlin"></script>\n<Node>\n{$state(1)}</Node>')
    ).rejects.toMatchObject({ line: 3, column: 2 });
  });

  it('identifies the master trace by its recorded states, whatever the view', async () => {
    const source = (values: string, view: string) =>
      `<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Reversed = unop((c: Values) => Values(c.slice().reverse()));</script><script lang="sverlin" input>const values = Values(${values});</script><script lang="sverlin">@reverse[values = Reversed(values);]</script>${view}`;
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
    `<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Position = index(Values);</script><script lang="sverlin" input>const values = Values([1, 2]);</script><script lang="sverlin">let i = Position(0);</script>{#snippet IntText(value: Int)}<Node {value} />{/snippet}{#snippet Row(list: Values)}<Node layout="row">{#each list as v}{@render Int(v)}{/each}</Node>{/snippet}{@render Row(values)}${markup}`;

  it('draws a view with a <Pointed> around the element its position points at', () => {
    const prepared = prepareSvelteComponent(
      view(
        '{#snippet Arrow(p: Position)}<Node layout="column"><Pointed tags="current" /><Node>i</Node></Node>{/snippet}{@render Arrow(i)}'
      )
    );
    expect(prepared.component).toContain('__sverlinPointers');
    expect(prepared.components.map(({ name }) => name)).toContain('Arrow');
    expect(prepared.design.space['Arrow[current].fill']).toBeDefined();
  });

  it.each([
    [
      '<Pointed> outside a view of an index type',
      '<Node><Pointed /></Node>',
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
      /<Pointed> has no prop layout/
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
      `<script lang="sverlin" domain>const Int = type([1, 3]); const Row = collection(Int);</script><script lang="sverlin">@start[let values = Row([1, 3]);] @grow[values = Row([1, 3, 1]);]</script>{#snippet Search(values: Row)}<Node layout="row">{#each values as value}{@render Int(value)}{/each}</Node>{/snippet}{#snippet Plain(value: Int)}<Node {value} />{/snippet}{#snippet Boxed(value: Int)}<Node layout="row"><Node {value} /></Node>{/snippet}{@render Search(values)}`
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
      `<script lang="sverlin" domain>const Vertex = type("integer", { min: 0, max: 5 }); const Weight = type([1, 4, 7]); const Edge = record({ from: Vertex, to: Vertex, weight: Weight });</script><script lang="sverlin"></script>{#snippet VertexView(v: Vertex)}<Node value={v} />{/snippet}{#snippet EdgeView(edge: Edge)}<Node layout="row">{@render VertexView(edge.from)}{@render VertexView(edge.to)}<Node value={edge.weight} /></Node>{/snippet}`
    );
    // from and to go to VertexView; weight is shown, so it takes each of its values.
    expect(prepared.components.find(({ name }) => name === 'EdgeView')?.cases).toEqual(
      [1, 4, 7].map((weight) => ({ from: 0, to: 0, weight }))
    );
  });

  it('measures the root with every value of what it reads for placement', () => {
    const prepared = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Int = type([1, 3]); const Index = type("integer", { min: -1, max: 3 }); const Values = collection(Int); const Reversed = unop((c: Values) => Values(c.slice().reverse()));</script><script lang="sverlin" input>const values = Values([1, 3, 1]); const target = Int(3);</script><script lang="sverlin">@start[let i = Index(-1);] @move[i = Index(0);]</script>{#snippet IntView(value: Int)}<Node {value} />{/snippet}{@render Int(target)}<Node layout="row">{#each values as value, k}<Node>{@render Int(value)}{#if k === i}<Node>i</Node>{/if}</Node>{/each}</Node>`
    );
    // i places the pointer; target and the cells go to views.
    expect(prepared.placements['*']).toEqual([{ path: 'i', step: 0, values: [-1, 0, 1, 2, 3] }]);
  });

  it('measures a position with every place in its collection, and as far past it as the trace goes', () => {
    const prepared = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Int = type([1, 3]); const Values = collection(Int); const Position = index(Values);</script><script lang="sverlin" input>const values = Values([1, 3, 1, 3]);</script><script lang="sverlin">@start[let i = Position(-1);] @move[i = Position(0);]</script><Node layout="row">{#each values as value, k}<Node>{#if k === i}<Node>i</Node>{/if}</Node>{/each}</Node>`
    );
    expect(prepared.placements['*']).toEqual([{ path: 'i', step: 0, values: [-1, 0, 1, 2, 3] }]);
  });

  it('draws every domain type with its widest values when all of them would be too many', () => {
    const prepared = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Count = type("integer", { min: 0, max: 999 }); const Ratio = type("number", { min: 0, max: 1 }); const Mark = type(["x", "yes"]); const Slot = union(Count, Mark); const Pair = record({ a: Count, b: Mark }); const Row = collection(Count); const Grid = collection(Row);</script><script lang="sverlin">let r = Ratio(0.125); let g = Grid([[1, 2], [3]]);</script>{#snippet C(count: Count)}<Node value={count} />{/snippet}{#snippet R(ratio: Ratio)}<Node value={ratio} />{/snippet}{#snippet S(slot: Slot)}<Node value={slot} />{/snippet}{#snippet P(pair: Pair)}<Node>{pair.a}{pair.b}</Node>{/snippet}{#snippet G(grid: Grid)}<Node layout="column">{#each grid as row}<Node>{#each row as count}{@render C(count)}{/each}</Node>{/each}</Node>{/snippet}{@render R(r)}`
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
      () => component('<Node>{@render Int(i)}</Node>'),
      /Int is a type, and nothing draws it: add a view of it/
    ],
    [
      'a view named after its type',
      () => component('{#snippet Int(value: Int)}<Node {value} />{/snippet}{@render Int(i)}'),
      /Int is a view named after its type/
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
      () => component('<Node>{#snippet Cell(value: Int)}<Node {value} />{/snippet}</Node>'),
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
    `<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Position = index(Values); const Flag = type("boolean"); const Length = unop((v: Values) => Position(v.length)); const Before = binop((a: Position, b: Position) => Flag(a < b)); const Next = unop((p: Position) => Position(p + 1));</script><script lang="sverlin" input>const values = Values([5, 2]);</script><script lang="sverlin">for (let i = Position(1); Before(i, Length(values)); i = Next(i)) {\n  @key[const key = values[i];]\n}</script>{#snippet IntText(value: Int)}<Node {value} />{/snippet}${markup}`;

  it('stands a variable out of scope in hidden, with its value from the nearest step', async () => {
    const prepared = prepareSvelteComponent(source('{@render Int(key)}'));
    const { javascript } = await bundlePresentation(prepared, 1);
    expect(javascript).toContain('{i:1,key:2,values:[5,2]');
    expect(javascript).toContain('__absent:["i","key"]');
  });

  it('rejects the view reading a variable out of scope at some step itself', () => {
    expect(() => prepareSvelteComponent(source('<Node>{key}</Node>'))).toThrow(
      'The view reads key itself, but key is out of scope at some steps'
    );
  });
});

describe('views', () => {
  it('are only drawn with {@render}, never called to make a value', () => {
    const source = `<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Index = index(Values);</script><script lang="sverlin" input>const values = Values([5, 2]);</script><script lang="sverlin"></script>{#snippet IntText(value: Int)}<Node {value} />{/snippet}{#snippet IndexLabel(value: Index)}<Node {value} />{/snippet}{#snippet Row(list: Values)}<Node layout="row">{#each list as v, k}{@render Int(v)}{@render Index(Index(k))}{/each}</Node>{/snippet}{@render Row(values)}`;
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
      prepareSvelteComponent(`${domain}<Node layout={step ? 'row' : 'stack'}><Node>a</Node></Node>`)
    ).toThrow(`layout={step ? 'row' : 'stack'} can be "stack"`);
  });
});
