import { describe, expect, it } from 'vitest';

import {
  bundlePresentation,
  compileSvelteComponent,
  InvalidSvelteSourceError,
  prepareSvelteComponent
} from './compile.server';
import { linearSearchSource } from './contract';
import { keyedRandom } from './algorithm/random.server';
import { drawDefaults as drawWith } from './library/node/defaults';

describe('single-component Svelte compilation', () => {
  it('bundles a component and its playback input without executing it', async () => {
    const result = await compileSvelteComponent(
      '<script lang="sverlin">yield; yield;</script><Node>{step}</Node>'
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

  it('derives master steps from yield and varies only the design between seeds', async () => {
    const prepared = prepareSvelteComponent(linearSearchSource);
    expect(prepared.master.map(({ state }) => state.i)).toEqual([-1, 0, 1, 2, 3]);
    const bundles = await Promise.all(
      Array.from({ length: 12 }, (_, seed) => bundlePresentation(prepared, seed + 1))
    );
    for (const bundle of bundles) {
      expect(bundle.masterSignature).toBe(bundles[0].masterSignature);
      expect(bundle.labels).toEqual(['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5']);
      expect(bundle.masterSteps).toEqual([0, 1, 2, 3, 4]);
      expect(['i', 'index', '↑']).toContain(bundle.parameters.pointerName);
    }
    expect(new Set(bundles.map(({ parameters }) => parameters.showIndices))).toEqual(
      new Set([true, false])
    );
    expect(bundles[0].javascript).toContain('[3,8,5,2,7]');
    expect(bundles[0].javascript).not.toContain('yield');
    const again = await bundlePresentation(prepared, 1);
    expect(again.parameters).toEqual(bundles[0].parameters);
  });

  it('reports design errors at their authored position and rejects name clashes', async () => {
    const design =
      '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 });</script><script lang="sverlin">\nlet x = Int(1);\nyield;\n</script>\n<script lang="sverlin" design>\nconst size = int(4, 1);\n</script>';
    await expect(compileSvelteComponent(design)).rejects.toMatchObject({
      code: 'algorithm_error',
      line: 6,
      message: expect.stringContaining('minimum ≤ maximum')
    });
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 });</script><script lang="sverlin">let x = Int(1); yield;</script><script lang="sverlin" design>const x = 2;</script>'
      )
    ).rejects.toThrow('"x" is defined in the design block');
    await expect(
      compileSvelteComponent('<script lang="sverlin" input>const x = 1;</script><Node>x</Node>')
    ).rejects.toThrow('Add a <script lang="sverlin"> algorithm block');
  });

  it('checks every value a design constant or condition can give a prop, for any seed', async () => {
    const view = (design: string, markup: string) =>
      compileSvelteComponent(
        `<script lang="sverlin">yield;</script>\n<script lang="sverlin" design>${design}</script>\n${markup}`
      );
    await expect(
      view("const cell = pick(['box', 'circle']);", '<Node shape={cell} value={1} />')
    ).rejects.toMatchObject({
      code: 'invalid_prop',
      line: 3,
      message: expect.stringContaining(
        '<Node> shape={cell} can be "circle", from the design value cell, which is not a value it takes'
      )
    });
    await expect(
      view("const look = { radius: pick(['small', 'round']) };", '<Node radius={look.radius} />')
    ).rejects.toThrow('from the design value look.radius');
    await expect(view('', "<Node layout={step ? 'row' : 'stack'} />")).rejects.toThrow(
      `layout={step ? 'row' : 'stack'} can be "stack"`
    );
    await expect(
      view(
        "const cell = pick(['box', 'card']); const gap = pick(['small', 2]);",
        '<Node shape={cell} gap={gap} radius={step ? undefined : "full"} />'
      )
    ).resolves.toBeDefined();
  });

  it('reports the view’s problems together with a block’s, in source order', async () => {
    const failure = await compileSvelteComponent(
      '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 });</script>\n<script lang="sverlin">\n  let i = 0;\n  yield;\n</script>\n<Node shape="circle">v1</Node>\n<Node class="x" />'
    ).catch((cause: InvalidSvelteSourceError) => cause);
    expect(failure).toMatchObject({ line: 3, message: expect.stringContaining('plain number 0') });
    expect((failure as InvalidSvelteSourceError).others).toMatchObject([
      { code: 'invalid_prop', line: 6 },
      { code: 'unknown_prop', line: 7 }
    ]);
  });

  it('places name clashes and invalid design values at their declarations', async () => {
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 });</script>\n<script lang="sverlin">\n  let x = Int(1);\n  yield;\n</script>\n<script lang="sverlin" design>\n  const x = 2;\n</script>'
      )
    ).rejects.toMatchObject({ code: 'name_clash', line: 7, column: 3 });
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 });</script>\n<script lang="sverlin">\n  let $x = Int(1);\n  yield;\n</script>\n<script lang="sverlin" design>\n  const $xy = 1;\n  const $x = 2;\n</script>'
      )
    ).rejects.toMatchObject({ code: 'name_clash', line: 8, column: 3 });
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin">yield;</script>\n<script lang="sverlin" design>\n  const frame = { spread: "row" };\n</script>'
      )
    ).rejects.toMatchObject({
      code: 'design_value',
      line: 3,
      message: expect.stringContaining('frame has no setting spread')
    });
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin">yield;</script>\n\n<script module>import x from "y";</script>'
      )
    ).rejects.toMatchObject({ line: 3 });
  });

  it('reports plain input and algorithm values at their authored line and column', async () => {
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 }); const Values = collection(Int);</script>\n<script lang="sverlin" input>\n  const values = Values([3, "x"]);\n</script>\n<script lang="sverlin">\n  let i = 0;\n  yield;\n</script>'
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
        '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 });</script>\n<script lang="sverlin">\n  let i = 0;\n  yield;\n</script>'
      )
    ).rejects.toMatchObject({
      line: 3,
      column: 11,
      message: expect.stringContaining('Write it as Int(0)')
    });
  });

  it('reports algorithm errors at their authored line and column', async () => {
    const source =
      '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 });</script><script lang="sverlin">\n  let x = Int(1);\n  yield;\n  x = missing;\n</script>\n<Node>{x}</Node>';
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
      compileSvelteComponent('<script lang="sverlin">\nyield;\n</script>\n\n{#if}')
    ).rejects.toMatchObject({ line: 5 });
  });

  it('requires exactly one algorithm block', async () => {
    await expect(compileSvelteComponent('<Node>Hi</Node>')).rejects.toThrow(
      'Add a <script lang="sverlin"> algorithm block'
    );
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin">yield;</script><script lang="sverlin">yield;</script>'
      )
    ).rejects.toThrow('only one algorithm block');
  });

  it('injects the sverlin library components without authored imports', async () => {
    const result = await compileSvelteComponent(linearSearchSource);
    expect(result.javascript).toContain('sv-node');
    expect(result.javascript).toContain('sv-node');
    const withoutModuleScript = await compileSvelteComponent(
      '<script lang="sverlin">yield;</script><Node>x</Node>'
    );
    expect(withoutModuleScript.labels).toEqual(['Step 1']);
    expect(withoutModuleScript.javascript).toContain('sv-node');
  });

  it('puts every recorded and design value in scope for a script-free view', async () => {
    const result = await compileSvelteComponent(
      '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 }); const Values = collection(Int);</script><script lang="sverlin" input>const values = Values([4, 9]);</script>\n<script lang="sverlin">let total = Int(0); yield; for (const v of values) total += v; yield;</script>\n<script lang="sverlin" design>const accent = pick(["red"]);</script>\n<Node layout="column">{@const doubled = total * 2}<Node color={accent}>{values.join("+")} = {total}; doubled {doubled}; step {step}, seed {seed}</Node></Node>',
      5
    );
    expect(result.labels).toEqual(['Step 1', 'Step 2']);
    expect(result.parameters).toMatchObject({ accent: 'red' });
  });

  it('rejects props a library component does not take, and written values it cannot use', async () => {
    const view = (markup: string) =>
      compileSvelteComponent(`<script lang="sverlin">yield;</script>\n${markup}`);
    await expect(view('<Node shape="circle">v1</Node>')).rejects.toMatchObject({
      code: 'invalid_prop',
      line: 2,
      message: expect.stringContaining('radius="full"')
    });
    await expect(view("<Node form={'spiral'} />")).rejects.toMatchObject({ code: 'invalid_prop' });
    await expect(view('<Node minSize="huge" />')).rejects.toThrow('or a number in braces');
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
        '{#snippet Int(value, node)}<Node {value} {...node} />{/snippet}<Node shape={step ? "box" : "card"} radius="full" minSize={3} value={1} />'
      )
    ).resolves.toBeDefined();
  });

  it('draws views only with Node and Link, styled by their props', async () => {
    const view = (markup: string) =>
      compileSvelteComponent(`<script lang="sverlin">yield;</script>\n${markup}`);
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

  it('rejects view scripts and values that shadow library components', async () => {
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin">yield;</script>\n\n<script>const x = 1;</script>\n<Node>{x}</Node>'
      )
    ).rejects.toMatchObject({
      code: 'view_script',
      line: 3,
      message: expect.stringContaining('Views cannot have their own <script>')
    });
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin">yield;</script><script module>const x = 1;</script>'
      )
    ).rejects.toThrow('Views cannot have their own <script>');
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin">yield;</script>\n<script lang="sverlin" inputs>const x = 1;</script>'
      )
    ).rejects.toMatchObject({ code: 'sverlin_block', line: 2 });
    await expect(
      compileSvelteComponent('<script lang="sverlin">const Node = 1; yield;</script><Node>x</Node>')
    ).rejects.toThrow('"Node" names a library component');
  });

  it('renders nested arrays as nested nodes without an item snippet', async () => {
    const result = await compileSvelteComponent(
      '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 }); const Row = collection(Int); const Grid = collection(Row);</script><script lang="sverlin" input>const grid = Grid([[1, 2], [3, 4]]);</script><script lang="sverlin">yield;</script><Node layout="column"><Node items={grid} layout="column" nested="row" /><Node items={[1, 2, 3, 4]} layout="grid" columns={2} /></Node>'
    );
    expect(result.javascript).toContain('sv-node');
  });

  it('embeds atomic types and registers renderer snippets named after types', async () => {
    const result = await compileSvelteComponent(
      '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 }); const Height = type(Int, { unit: "cm" }); const People = collection(Height);</script><script lang="sverlin" input>const people = People([150, 170]);</script><script lang="sverlin">yield;</script>{#snippet Int(value, node)}<Node radius="full" {value} {...node} />{/snippet}{#snippet helper(x)}{x}{/snippet}<Node items={people} />'
    );
    expect(result.javascript).toContain('people[1]');
    expect(result.javascript).toContain('sverlin:renderers');
  });

  it('rejects invalid domain blocks, renderers, and clashing names', async () => {
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin">yield;</script>\n<script lang="sverlin" domain>\nconst A = type(Integer);\n</script>'
      )
    ).rejects.toMatchObject({
      code: 'algorithm_error',
      line: 3,
      message: expect.stringContaining('Unknown type Integer')
    });
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" domain>const Int = type("integer", { min: -100, max: 1000 });</script><script lang="sverlin">yield;</script>\n{#snippet Int(value, node, extra)}{value}{/snippet}'
      )
    ).rejects.toMatchObject({
      code: 'type_renderer',
      line: 2,
      message: expect.stringContaining('at most (value, node)')
    });
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" domain>const Text = type(["a"]);</script><script lang="sverlin">const Text = 1; yield;</script>'
      )
    ).rejects.toThrow('"Text" names a type');
    await expect(
      compileSvelteComponent(
        '<script lang="sverlin" domain>const Node = type("integer", { min: -100, max: 1000 });</script><script lang="sverlin">yield;</script>'
      )
    ).rejects.toThrow('"Node" names a library component');
  });

  it('records drawn defaults with the design values, which cannot opt out of them', async () => {
    const source = '<script lang="sverlin">yield;</script><Node value={1} />';
    const drawn = await compileSvelteComponent(source, 3);
    expect(drawn.parameters.__defaults).toEqual(drawWith((key) => keyedRandom(3, key)));
    await expect(
      compileSvelteComponent(
        `${source}<script lang="sverlin" design>const defaults = 'fixed';</script>`
      )
    ).rejects.toThrow('The design value defaults is no longer supported');
  });

  it('resolves the page frame from the design value frame', async () => {
    const algorithm = '<script lang="sverlin">yield;</script><Node>a</Node>';
    const design = (body: string) => `${algorithm}<script lang="sverlin" design>${body}</script>`;
    await expect(compileSvelteComponent(design("const frame = '4:3';"))).resolves.toBeDefined();
    await expect(
      compileSvelteComponent(
        design("const frame = { justify: pick(['start', 'between']), padding: 2 };")
      )
    ).resolves.toBeDefined();
    await expect(compileSvelteComponent(design("const frame = '5:4';"))).rejects.toThrow(
      'frame.ratio must be one of'
    );
    await expect(
      compileSvelteComponent(design("const frame = { spread: 'row' };"))
    ).rejects.toThrow('frame has no setting spread');
    await expect(
      compileSvelteComponent(design("const frame = { padding: 'huge' };"))
    ).rejects.toThrow('frame.padding must be one of');
    await expect(
      compileSvelteComponent(
        design("const frame = { layout: 'free', constraints: ['note below cells'] };")
      )
    ).resolves.toBeDefined();
    await expect(
      compileSvelteComponent(design("const frame = { layout: 'grid' };"))
    ).rejects.toThrow('frame.layout must be one of');
    await expect(
      compileSvelteComponent(design('const frame = { constraints: [1] };'))
    ).rejects.toThrow('frame.constraints must be a list of strings');
  });

  it('tags links like nodes, and marks the nodes and roots they join', () => {
    const algorithm = '<script lang="sverlin">yield;</script>';
    const nested = prepareSvelteComponent(
      `${algorithm}\n<Node layout="free">\n  <Node key="a">a</Node><Node key="b">b</Node>\n  {#if true}<Link from="a" to="b" />{/if}\n</Node>`
    );
    expect(nested.component).toMatch(/__ref: ['"]4:13['"]/u);
    expect(nested.component).toMatch(/__links: true/u);
    expect(nested.topLevelLinks).toBeUndefined();
    const top = prepareSvelteComponent(
      `${algorithm}<Node key="a">a</Node><Node key="b">b</Node><Link from="a" to="b" />`
    );
    expect(top.topLevelLinks).toBe(true);
    expect(() => prepareSvelteComponent(`${algorithm}\n<Link from="a" to="b" __id="x" />`)).toThrow(
      'Link props starting with __, such as __id, are reserved'
    );
  });

  it('tags every Node with its source position and reserves __ props', async () => {
    const algorithm = '<script lang="sverlin">yield;</script>';
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
          `<script lang="sverlin">yield;</script><Node>{require(${JSON.stringify(path)})}</Node>`
        )
      ).rejects.toMatchObject({
        name: 'InvalidSvelteSourceError',
        message: expect.stringContaining('cannot load module')
      });
    }
  );

  it('keeps authored line numbers after prelude injection', async () => {
    await expect(
      compileSvelteComponent('<script lang="sverlin">yield;</script>\n<Node>\n{$state(1)}</Node>')
    ).rejects.toMatchObject({ line: 3, column: 2 });
  });

  it('identifies the master trace by its recorded states, whatever the view', async () => {
    const source = (values: string, view: string) =>
      `<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int);</script><script lang="sverlin" input>const values = Values(${values});</script><script lang="sverlin">yield; values.reverse(); yield;</script>${view}`;
    const signature = async (values: string, view: string) =>
      (await compileSvelteComponent(source(values, view))).masterSignature;
    const first = await signature('[1, 2]', '<Node items={values} />');
    expect(await signature('[1, 2]', '<Node layout="column" items={values} />')).toBe(first);
    expect(await signature('[2, 1]', '<Node items={values} />')).not.toBe(first);
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
    `<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Position = index(Values);</script><script lang="sverlin" input>const values = Values([1, 2]);</script><script lang="sverlin">let i = Position(0); yield;</script><script lang="sverlin" design>const Int = IntText;</script>{#snippet IntText(value: Int)}<Node {value} />{/snippet}{#snippet Row(list: Values)}<Node layout="row">{#each list as v}{@render Int(v)}{/each}</Node>{/snippet}{@render Row(values)}${markup}`;

  it('draws a view with a <Pointed> around the element its position points at', () => {
    const prepared = prepareSvelteComponent(
      view(
        '{#snippet Arrow(p: Position)}<Node layout="column"><Pointed fill="amber" /><Node>i</Node></Node>{/snippet}{@render Arrow(i)}'
      )
    );
    expect(prepared.component).toContain('__sverlinPointers');
    expect(prepared.components.map(({ name }) => name)).toContain('Arrow');
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
      /Int is not an index type/
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
  const algorithm = '<script lang="sverlin">let i = Int(1); yield;</script>';
  const component = (view: string, design = '') =>
    prepareSvelteComponent(
      `${domain}${algorithm}${design ? `<script lang="sverlin" design>${design}</script>` : ''}${view}`
    );

  it('reads typed snippets as views of one type, and draws the view a design value named after the type picks', async () => {
    const prepared = component(
      '{#snippet IntText(value: Int)}<Node {value} />{/snippet}{#snippet IntBold(value: Int, node)}<Node {value} weight="bold" {...node} />{/snippet}{@render Int(i)}<Node value={i} type="Int" />',
      'const Int = pick([IntText, IntBold]);'
    );
    expect(prepared.components).toEqual([
      { name: 'IntText', cases: [1, 3] },
      { name: 'IntBold', cases: [1, 3] }
    ]);
    expect(prepared.component).toContain('__component');
    const drawn = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7, 8].map(
        async (seed) => (await bundlePresentation(prepared, seed)).parameters.Int
      )
    );
    expect(new Set(drawn)).toEqual(new Set(['IntText', 'IntBold']));
  });

  it('lets a design value named after a type fix its view, and another name choose among views', async () => {
    const views =
      '{#snippet IntText(value: Int)}<Node {value} />{/snippet}{#snippet IntBold(value: Int)}<Node {value} weight="bold" />{/snippet}';
    const fixed = component(`${views}{@render Int(i)}`, 'const Int = IntBold;');
    expect((await bundlePresentation(fixed, 1)).parameters.Int).toBe('IntBold');
    const chosen = component(`${views}{@render Look(i)}`, 'const Look = pick([IntText, IntBold]);');
    expect(['IntText', 'IntBold']).toContain((await bundlePresentation(chosen, 1)).parameters.Look);
  });

  it('draws no view a design value does not pick, and orders components after those they render', async () => {
    const prepared = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Int = type([1, 3]); const Row = collection(Int);</script><script lang="sverlin">let values = Row([1, 3]); yield; values = Row([1, 3, 1]); yield;</script><script lang="sverlin" design>const Int = pick([Plain, Bold]);</script>{#snippet Search(values: Row)}<Node layout="row">{#each values as value}{@render Cell(value)}{/each}</Node>{/snippet}{#snippet Cell(value: Int)}<Node>{@render Int(value)}</Node>{/snippet}{#snippet Plain(value: Int)}<Node {value} />{/snippet}{#snippet Bold(value: Int)}<Node {value} weight="bold" />{/snippet}{@render Search(values)}`
    );
    // Cell views Int too, but only Plain and Bold are picked.
    const drawn = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7, 8].map(
        async (seed) => (await bundlePresentation(prepared, seed)).parameters.Int
      )
    );
    expect(new Set(drawn)).toEqual(new Set(['Plain', 'Bold']));
    expect(prepared.components.map(({ name }) => name)).toEqual([
      'Plain',
      'Bold',
      'Cell',
      'Search'
    ]);
    // Plain and Bold show their value, so they take every value; Cell and Search only pass theirs to
    // views, which keep their boxes, so they take one. Search is filled to the longest Row in the
    // trace.
    expect(Object.fromEntries(prepared.components.map(({ name, cases }) => [name, cases]))).toEqual(
      {
        Plain: [1, 3],
        Bold: [1, 3],
        Cell: [1],
        Search: [[1, 1, 1]]
      }
    );
  });

  it('draws a record with one value for each field passed only to a view', () => {
    const prepared = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Vertex = type("integer", { min: 0, max: 5 }); const Weight = type([1, 4, 7]); const Edge = record({ from: Vertex, to: Vertex, weight: Weight });</script><script lang="sverlin">yield;</script>{#snippet VertexView(v: Vertex)}<Node value={v} />{/snippet}{#snippet EdgeView(edge: Edge)}<Node layout="row">{@render VertexView(edge.from)}{@render VertexView(edge.to)}<Node value={edge.weight} /></Node>{/snippet}`
    );
    // from and to go to VertexView; weight is shown, so it takes each of its values.
    expect(prepared.components.find(({ name }) => name === 'EdgeView')?.cases).toEqual(
      [1, 4, 7].map((weight) => ({ from: 0, to: 0, weight }))
    );
  });

  it('measures the root with every value of what it reads for placement', () => {
    const prepared = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Int = type([1, 3]); const Index = type("integer", { min: -1, max: 3 }); const Values = collection(Int);</script><script lang="sverlin" input>const values = Values([1, 3, 1]); const target = Int(3);</script><script lang="sverlin">let i = Index(-1); yield; i = Index(0); yield;</script><script lang="sverlin" design>const Int = IntView;</script>{#snippet IntView(value: Int)}<Node {value} />{/snippet}{@render Int(target)}<Node layout="row">{#each values as value, k}<Node>{@render Int(value)}{#if k === i}<Node>i</Node>{/if}</Node>{/each}</Node>`
    );
    // i places the pointer; target and the cells go to views.
    expect(prepared.placements).toEqual([{ path: 'i', step: 0, values: [-1, 0, 1, 2, 3] }]);
  });

  it('measures a position with every place in its collection, and either end', () => {
    const prepared = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Int = type([1, 3]); const Values = collection(Int); const Position = index(Values);</script><script lang="sverlin" input>const values = Values([1, 3, 1, 3]);</script><script lang="sverlin">let i = Position(-1); yield; i = Position(0); yield;</script><Node layout="row">{#each values as value, k}<Node>{#if k === i}<Node>i</Node>{/if}</Node>{/each}</Node>`
    );
    expect(prepared.placements).toEqual([{ path: 'i', step: 0, values: [-1, 0, 1, 2, 3, 4] }]);
  });

  it('draws every domain type with its widest values when all of them would be too many', () => {
    const prepared = prepareSvelteComponent(
      `<script lang="sverlin" domain>const Count = type("integer", { min: 0, max: 999 }); const Ratio = type("number", { min: 0, max: 1 }); const Mark = type(["x", "yes"]); const Slot = union(Count, Mark); const Pair = record({ a: Count, b: Mark }); const Row = collection(Count); const Grid = collection(Row);</script><script lang="sverlin">let r = Ratio(0.125); let g = Grid([[1, 2], [3]]); yield;</script>{#snippet C(count: Count)}<Node value={count} />{/snippet}{#snippet R(ratio: Ratio)}<Node value={ratio} />{/snippet}{#snippet S(slot: Slot)}<Node value={slot} />{/snippet}{#snippet P(pair: Pair)}<Node>{pair.a}{pair.b}</Node>{/snippet}{#snippet G(grid: Grid)}<Node items={grid} />{/snippet}{@render R(r)}`
    );
    expect(Object.fromEntries(prepared.components.map(({ name, cases }) => [name, cases]))).toEqual(
      {
        // A range's ends, and the value in the trace that prints longest.
        C: [0, 999, 1],
        R: [0, 1, 0.125],
        S: [0, 999, 1, 'yes', 'x'],
        P: [0, 999, 1].flatMap((a) => ['x', 'yes'].map((b) => ({ a, b }))),
        G: [0, 999, 1].map((value) => [
          [value, value],
          [value, value]
        ])
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
      () => component('{#snippet IntText(value: Int)}<Node {value} />{/snippet}{@render Int(i)}'),
      /Int is a type, and nothing draws it: choose its view in the design block, as in const Int = pick\(\[IntText\]\);/
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
      'a value after the node',
      () => component('{#snippet Cell(node, value: Int)}<Node {value} />{/snippet}'),
      /Cell takes its value first/
    ],
    [
      'components inside markup',
      () =>
        component('<Node items={[1]}>{#snippet item(value: Int)}<Node {value} />{/snippet}</Node>'),
      /components are defined at the top level/
    ],
    [
      'choices between views of different types',
      () =>
        component(
          '{#snippet A(value: Int)}<Node {value} />{/snippet}{#snippet B(value: Flag)}<Node {value} />{/snippet}',
          'const Look = pick([A, B]);'
        ),
      /Look chooses between components that view different types/
    ],
    [
      'a type’s design value choosing a view of another type',
      () =>
        component(
          '{#snippet A(value: Int)}<Node {value} />{/snippet}{#snippet B(value: Flag)}<Node {value} />{/snippet}',
          'const Int = B;'
        ),
      /Int chooses B, which views Flag/
    ],
    [
      'views with more values than can be drawn',
      () =>
        prepareSvelteComponent(
          `<script lang="sverlin" domain>const Flag = type("boolean"); const Flags = record({ a: Flag, b: Flag, c: Flag, d: Flag, e: Flag, f: Flag, g: Flag, h: Flag, i: Flag });</script><script lang="sverlin">yield;</script>{#snippet F(flags: Flags)}<Node>{flags.a}</Node>{/snippet}`
        ),
      /F would be drawn with too many values of Flags/
    ]
  ])('rejects %s', (_name, prepare, message) => {
    expect(prepare).toThrow(message);
  });
});
