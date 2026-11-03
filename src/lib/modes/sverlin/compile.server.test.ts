import { describe, expect, it } from 'vitest';

import { stepPlaces } from '$lib/shared/presentations';

import type { MasterStep, PauseMode } from './algorithm/interpret.server';
import {
  bundlePresentation,
  compileSvelteComponent,
  InvalidSvelteSourceError,
  pausesOf,
  prepareSvelteComponent
} from './compile.server';
import { linearSearchSource } from './contract';
import bfsReferences from './fixtures/bfs-references.sverlin?raw';
import bst from './fixtures/bst.sverlin?raw';
import dijkstra from './fixtures/dijkstra.sverlin?raw';
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
            key !== 'layout' &&
            !key.startsWith('Main.') &&
            !key.includes('@')
        )
        .map((key) => key.slice(0, key.lastIndexOf('.')))
    )
  ].sort();

describe('single-component Svelte compilation', () => {
  it('bundles a component and its playback input without executing it', async () => {
    const result = await compileSvelteComponent(
      '<script domain>const Int = type("integer", { min: 0, max: 9 });</script><script algorithm>@run[let n = Int(0);] @a[n = Int(1);] @b[n = Int(2);]</script><View of="Int" name="IntCell"><Node value={this} /></View>{#snippet S()}<Node>n</Node>{/snippet}<Layout name="Main"><Node>{@render S()}{n}</Node></Layout>'
    );
    // The input as given, then a step at each label, each named by its label and run.
    expect(result.labels).toEqual(['start', '@run#1', '@a#1', '@b#1']);
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
    // The starter's linear search: the input as given, then for each check its position set or
    // moved, the test that goes on, the comparison and the pass, then its answer.
    expect(prepared.master.map(({ state }) => state.i)).toEqual([
      undefined,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      2,
      2,
      2,
      2,
      3,
      3,
      3,
      3,
      undefined
    ]);
    expect(prepared.master.at(-1)?.state.found).toBe(3);
    const bundles = await Promise.all(
      Array.from({ length: 12 }, (_, seed) =>
        bundlePresentation(prepared, seed + 1, { randomise: true })
      )
    );
    for (const bundle of bundles) {
      expect(bundle.stepSignature).toBe(bundles[0].stepSignature);
      // The starter pauses where i is set and moved, as the caption draws it, and at each
      // comparison.
      expect(bundle.labels).toEqual([
        'start',
        '@first#1',
        '@check.equal#1',
        '@next#1',
        '@check.equal#2',
        '@next#2',
        '@check.equal#3',
        '@next#3',
        '@check.equal#4',
        '@run#1'
      ]);
      // Every step the source can show: each check's position set or moved, its test, its
      // comparison, and its pass.
      expect(bundle.steps).toEqual([
        'start',
        ...[1, 2, 3, 4].flatMap((n) => [
          ...(n === 1 ? ['@first#1'] : [`@next#${n - 1}`]),
          `@more#${n}`,
          `@check.equal#${n}`,
          `@check#${n}`
        ]),
        '@run#1',
        'end'
      ]);
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
        '<script algorithm>\n\n</script>\n<script design>\nconst size = 1;\n</script>'
      )
    ).rejects.toMatchObject({
      code: 'sverlin_block',
      line: 4,
      message: expect.stringContaining('Sources have no design block')
    });
    await expect(
      compileSvelteComponent(
        '<script input>const x = 1;</script>{#snippet X()}<Node>x</Node>{/snippet}<Layout name="Main"><Node>{@render X()}</Node></Layout>'
      )
    ).rejects.toThrow('Add a <script algorithm> block');
  });

  it('rejects looks given as props, which are the design’s', async () => {
    const view = (markup: string) =>
      compileSvelteComponent(
        `<script algorithm></script>\n{#snippet V()}${markup}{/snippet}<Layout name="Main"><Node>{@render V()}</Node></Layout>`
      );
    await expect(view('<Node fill="amber" value={1} />')).rejects.toMatchObject({
      code: 'unknown_prop',
      line: 2,
      message: expect.stringContaining('<Node> fill is a look')
    });
    await expect(view('<Node textSize={16}>x</Node>')).rejects.toThrow('textSize is a look');
    await expect(view('<Node size={1}>x</Node>')).rejects.toThrow("its text's size is textSize");
    await expect(
      view('<Node layout="free"><Node>a</Node><Link from={0} to={1} stroke="red" /></Node>')
    ).rejects.toThrow('<Link> stroke is a look');
  });

  it('reports the view’s problems together with a block’s, in source order', async () => {
    const failure = await compileSvelteComponent(
      '<script domain>const Int = type("integer", { min: -100, max: 1000 });</script>\n<script algorithm>\n  @run[let i = 0;]\n\n</script>\n{#snippet A()}<Node shape="circle">v1</Node>{/snippet}\n{#snippet B()}<Node class="x" />{/snippet}\n<Layout name="Main"><Node>{@render A()}{@render B()}</Node></Layout>'
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
        '<script algorithm></script>\n\n<script module>import x from "y";</script>'
      )
    ).rejects.toMatchObject({ line: 3 });
    await expect(
      compileSvelteComponent(
        '<script algorithm></script>\n{#snippet A()}<Node>a</Node>{/snippet}\n{#snippet B()}<Node tags="b">b</Node>{/snippet}\n<Layout name="Main"><Node>{@render A()}{@render B()}</Node></Layout>'
      )
    ).rejects.toMatchObject({
      code: 'unknown_prop',
      line: 3,
      message: expect.stringContaining('name the node by a snippet')
    });
    await expect(
      compileSvelteComponent(
        '<script algorithm></script>\n<Layout name="Main"><Node>\n<div>a</div></Node></Layout>'
      )
    ).rejects.toMatchObject({ code: 'view_markup', line: 3 });
  });
  it('reports plain input and algorithm values at their authored line and column', async () => {
    await expect(
      compileSvelteComponent(
        '<script domain>const Int = type("integer", { min: -100, max: 1000 }); const Values = collection(Int);</script>\n<script input>\n  const values = Values([3, "x"]);\n</script>\n<script algorithm>\n  @run[let i = 0;]\n\n</script>'
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
        '<script domain>const Int = type("integer", { min: -100, max: 1000 });</script>\n<script algorithm>\n  @run[let i = 0;]\n\n</script>'
      )
    ).rejects.toMatchObject({
      line: 3,
      column: 16,
      message: expect.stringContaining('Write it as Int(0)')
    });
  });

  it('reports algorithm errors at their authored line and column', async () => {
    const source =
      '<script domain>const Int = type("integer", { min: -100, max: 1000 });</script><script algorithm>\n  @run[let x = Int(1);\n\n  x = missing;]\n</script><Layout name="Main"><Node><Node>{x}</Node></Node></Layout>';
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
      compileSvelteComponent(
        '<script algorithm>\n\n</script>\n\n<Layout name="Main"><Node>{#if}</Node></Layout>'
      )
    ).rejects.toMatchObject({ line: 5 });
  });

  it('requires exactly one algorithm block', async () => {
    await expect(
      compileSvelteComponent(
        '{#snippet Hi()}<Node>Hi</Node>{/snippet}<Layout name="Main"><Node>{@render Hi()}</Node></Layout>'
      )
    ).rejects.toThrow('Add a <script algorithm> block');
    await expect(
      compileSvelteComponent('<script algorithm></script><script algorithm></script>')
    ).rejects.toThrow('only one algorithm block');
  });

  it('injects the sverlin library components without authored imports', async () => {
    const result = await compileSvelteComponent(linearSearchSource);
    expect(result.javascript).toContain('sv-node');
    expect(result.javascript).toContain('sv-node');
    const withoutModuleScript = await compileSvelteComponent(
      '<script algorithm></script>{#snippet X()}<Node>x</Node>{/snippet}<Layout name="Main"><Node>{@render X()}</Node></Layout>'
    );
    // The input as given (here none), then the algorithm's one step, its end.
    expect(withoutModuleScript.labels).toEqual(['start', 'end']);
    expect(withoutModuleScript.javascript).toContain('sv-node');
  });

  it('puts every recorded value in scope for a script-free view', async () => {
    const result = await compileSvelteComponent(
      '<script domain>const Int = type("integer", { min: -100, max: 1000 }); const Values = collection(Int); const Index = index(Values); const Flag = type("boolean");</script><script input>const values = Values([4, 9]);</script>\n<script algorithm>@start[let total = Int(0);]\nfor (@first[let i = Index(0)]; @more[i < values.length]; @next[i++]) {\n  @add[total = total + values[i];]\n}</script>\n{#snippet Sum()}<Node layout="column">{@const doubled = total * 2}<Node>{values.join("+")} = <Node value={total} />; doubled {doubled}</Node></Node>{/snippet}<Layout name="Main"><Node>{@render Sum()}</Node></Layout>',
      5
    );
    // The input as given, the start, and a step per addition; the loop's end only drops v, so it
    // is no step.
    expect(result.labels).toEqual(['start', '@start#1', '@add#1', '@add#2']);
    expect(result.variant['Sum.fill']).toBeDefined();
  });

  it('gives every kind of node, the snippet it is in, the variables its role has', () => {
    const { design } = prepareSvelteComponent(
      `<script domain>const Int = type([1, 3]); const Values = collection(Int); const Position = index(Values);</script><script input>const values = Values([1, 3]);</script><script algorithm>@run[let i = Position(0); let j = Position(1);]</script><View of="Int" name="IntCell"><Node value={this} /></View><View of="Position" name="Arrow">{#snippet Name()}<Node>i</Node>{/snippet}<Node layout="column"><Pointed />{@render Name()}</Node></View><View of="Position" name="Mark"><Pointed /></View>{#snippet Cells()}<Node layout="row">{#each values as v}{v}{/each}</Node>{/snippet}{#snippet Note()}<Node>note</Node>{/snippet}{#snippet Pair()}<Node layout="free">{#each values as v}{v}{/each}<Link from={i} to={j} /></Node>{/snippet}<Layout name="Main"><Node>{@render Cells()}{i}{@render Note()}{@render Pair()}</Node></Layout>`
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
    [
      'tags',
      '{#snippet T()}<Node tags="title">x</Node>{/snippet}<Layout name="Main"><Node>{@render T()}</Node></Layout>',
      /takes no tags/
    ],
    [
      'a node at the top level, beside the layouts',
      '{#snippet T()}<Node>t</Node>{/snippet}<Node>x</Node><Layout name="Main"><Node>{@render T()}</Node></Layout>',
      /the top level holds only parts, views, and layouts/
    ],
    [
      'text in a layout, outside a node',
      '<Layout name="Main"><Node>Linear search</Node></Layout>',
      /Text outside a <Node> cannot be selected/
    ],
    [
      'a render of a snippet worked out as the view runs',
      '{#snippet A()}<Node>a</Node>{/snippet}{#snippet B()}<Node>b</Node>{/snippet}<Layout name="Main"><Node>{@render (1 > 0 ? A : B)()}</Node></Layout>',
      /names the snippet it draws/
    ],
    [
      'two snippets of one name',
      '{#snippet A()}{#snippet U()}<Node>x</Node>{/snippet}<Node>{@render U()}</Node>{/snippet}{#snippet U()}<Node>y</Node>{/snippet}<Layout name="Main"><Node>{@render A()}{@render U()}</Node></Layout>',
      /Two snippets are named U/
    ],
    [
      'a snippet taking a parameter without a type',
      '{#snippet A(x)}<Node>{x}</Node>{/snippet}<Layout name="Main"><Node>{1}</Node></Layout>',
      /A takes a parameter: a snippet takes nothing and is a part of the page/
    ]
  ])('rejects %s', async (_name, markup, message) => {
    await expect(compileSvelteComponent(`<script algorithm></script>${markup}`)).rejects.toThrow(
      message
    );
  });

  it('rejects a <Pointed> and a node of one kind', () => {
    expect(() =>
      prepareSvelteComponent(
        `<script domain>const Int = type([1, 3]); const Values = collection(Int); const Position = index(Values);</script><script input>const values = Values([1, 3]);</script><script algorithm>@run[let i = Position(0);]</script><View of="Position" name="Arrow">{#snippet Pointed()}<Node>i</Node>{/snippet}<Node layout="column"><Pointed />{@render Pointed()}</Node></View>{#snippet Cells()}<Node layout="row">{#each values as v}<Node value={v} />{/each}</Node>{/snippet}<Layout name="Main"><Node>{@render Cells()}{i}</Node></Layout>`
      )
    ).toThrow(/Arrow\.Pointed is the kind of a <\w+> and of another kind of tag/);
  });

  it('rejects props a library component does not take, and written values it cannot use', async () => {
    const view = (markup: string) =>
      compileSvelteComponent(
        `<script algorithm></script>\n{#snippet V()}${markup}{/snippet}<Layout name="Main"><Node>{@render V()}</Node></Layout>`
      );
    // A free layout's look is its kind's, so the markup cannot set it.
    for (const prop of ['form="ring"', 'curve="straight"', 'layoutSeed={3}'])
      await expect(view(`<Node layout="free" ${prop} />`)).rejects.toMatchObject({
        code: 'unknown_prop',
        line: 2,
        message: expect.stringContaining(`here the variable V.${prop.split('=')[0]}`)
      });
    // How a link runs and its heads are its kind's; curve, as it was once called, names its route.
    for (const [prop, variable] of [
      ['curve="curved"', 'route'],
      ['route="wire"', 'route'],
      ['head="vee"', 'head'],
      ['headSize={12}', 'headSize']
    ])
      await expect(
        view(`<Node layout="free"><Node>a</Node><Link from={0} to={1} ${prop} /></Node>`)
      ).rejects.toMatchObject({
        code: 'unknown_prop',
        message: expect.stringContaining(`here the variable V.Link.${variable}`)
      });
    // A label is the link's children, drawn as nodes are.
    await expect(
      view('<Node layout="free"><Node>a</Node><Link from={0} to={1} label="next" /></Node>')
    ).rejects.toMatchObject({
      code: 'unknown_prop',
      message: expect.stringContaining('write its label as its children')
    });
    await expect(
      view('<Node layout="free"><Node>a</Node><Link from={0} to={1} bend={0.3} /></Node>')
    ).rejects.toThrow('<Link> has no prop bend');
    // A link's direction follows from the data: both ways at once is a line.
    await expect(
      view('<Node layout="free"><Node>a</Node><Link from={0} to={1} directed={false} /></Node>')
    ).rejects.toMatchObject({
      code: 'unknown_prop',
      message: expect.stringContaining('its direction follows from the data')
    });
    await expect(view('<Node flow="z" />')).rejects.toMatchObject({
      code: 'invalid_prop',
      line: 2
    });
    await expect(view('<Node layout="table" />')).rejects.toThrow(
      "use 'row', 'column', 'grid', 'free'"
    );
    await expect(view('<Node class="big" />')).rejects.toMatchObject({
      code: 'unknown_prop',
      message: expect.stringContaining('<Node> has no prop class')
    });
    // A child is not named by hand, and a link's ends are what the data points at.
    await expect(view('<Node key="a" />')).rejects.toThrow('<Node> has no prop key');
    for (const end of ['from="a" to={1}', 'from={"a"} to={1}'])
      await expect(
        view(`<Node layout="free"><Node>a</Node><Link ${end} /></Node>`)
      ).rejects.toMatchObject({
        code: 'invalid_prop',
        message: expect.stringContaining('<Link from="…"> names an end by text')
      });
    await expect(
      view('<Node layout="free"><Node>a</Node><Link from={0} to={1} bow={1} /></Node>')
    ).rejects.toMatchObject({ code: 'unknown_prop' });
    // Values worked out in markup, and props passed on by a spread, are left to the component.
    await expect(
      view('<Node layout={1 > 0 ? "row" : "column"} value={1} {...{ key: "a" }} />')
    ).resolves.toBeDefined();
  });

  it("names a view's value this, refusing another name and a this outside a view", () => {
    const source = (markup: string) =>
      `<script domain>const Int = type([1, 3]);</script><script input>const n = Int(1);</script><script algorithm>@run[let i = Int(1);]</script>
${markup}<Layout name="Main"><Node>{n}</Node></Layout>`;
    expect(() =>
      prepareSvelteComponent(source('<View of="Int" name="IntCell"><Node value={this} /></View>'))
    ).not.toThrow();
    expect(() =>
      prepareSvelteComponent(source('{#snippet IntCell(v: Int)}<Node value={v} />{/snippet}'))
    ).toThrow(
      'IntCell takes a value, as only a view does: write it as a view, <View of="Int" name="IntCell">…</View>, its value this'
    );
    expect(() =>
      prepareSvelteComponent(
        source(
          '<View of="Int" name="IntCell"><Node value={this} /></View>{#snippet Part()}<Node>{this}</Node>{/snippet}'
        )
      )
    ).toThrow('this is the value a view draws, and only a view has one');
    // An HTML comment is not markup: a this written there reads nothing.
    expect(() =>
      prepareSvelteComponent(
        source(
          '<!-- a view draws {this} --><View of="Int" name="IntCell"><Node value={this} /></View>'
        )
      )
    ).not.toThrow();
  });

  it('refuses a name the view reads that nothing gives it, where it is written', () => {
    const source = (markup: string) =>
      `<script domain>const Int = type([1, 3]); const Values = collection(Int);</script><script input>const values = Values([1, 3]);</script><script algorithm>@run[let i = Int(1);]</script>\n{#snippet V()}${markup}{/snippet}<Layout name="Main"><Node>{@render V()}</Node></Layout>`;
    expect(() => prepareSvelteComponent(source('<Node>{valeus.length}</Node>'))).toThrow(
      expect.objectContaining({
        code: 'view_name',
        line: 2,
        message: expect.stringContaining('The view reads valeus')
      })
    );
    expect(() => prepareSvelteComponent(source('<Node>{step}</Node>'))).toThrow(
      'The view reads step'
    );
    // Browser globals are never given, in a part or a view.
    expect(() => prepareSvelteComponent(source('<Node>{self.innerWidth}</Node>'))).toThrow(
      'Browser globals, as window or self, are never in scope.'
    );
    // Variables, loop names, {@const} names, snippets' parameters, and Math are given.
    expect(() =>
      prepareSvelteComponent(
        source(
          '{#each values as v, k}{@const twice = v * 2}<Node>{k}: {twice} {Math.max(i, v)}</Node>{/each}'
        )
      )
    ).not.toThrow();
  });

  it('draws views only with Node and Link', async () => {
    const view = (markup: string) =>
      compileSvelteComponent(
        `<script algorithm></script>\n{#snippet V()}${markup}{/snippet}<Layout name="Main"><Node>{@render V()}</Node></Layout>`
      );
    await expect(
      compileSvelteComponent(
        '<script algorithm></script>\n{#snippet V()}<Node>Hi</Node>{/snippet}<Layout name="Main"><Node>{@render V()}</Node></Layout>\n<style>div { color: red; }</style>'
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
        '<script algorithm></script><svelte:head><title>x</title></svelte:head>'
      )
    ).rejects.toMatchObject({ code: 'view_markup' });
    await expect(view('<svelte:element this="div" />')).rejects.toMatchObject({
      code: 'view_markup'
    });
    await expect(view('Linear search')).rejects.toMatchObject({ code: 'view_text', line: 2 });
    await expect(view('{#if 1 > 0}{1}{/if}')).rejects.toMatchObject({ code: 'view_text' });
    // Text inside a node is drawn by it, a view may write text beside its nodes, and whitespace
    // between nodes is ignored.
    await expect(
      compileSvelteComponent(
        '<script domain>const Int = type([1, 3]);</script><script algorithm>@run[let i = Int(1);]</script>\n<View of="Int" name="IntNote">is <Node value={this} /></View>\n{#snippet V()}<Node>Step {i}</Node>\n<Node>{i}</Node>{/snippet}<Layout name="Main"><Node>{@render V()}</Node></Layout>'
      )
    ).resolves.toBeDefined();
  });

  it('shows the source’s own listing where the view places a <Listing />, lit per step', async () => {
    const source = [
      '<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Index = index(Values); const Flag = type("boolean");</script>',
      '<script input>const values = Values([3, 8]);</script>',
      '<script algorithm>@loop[let last = Index(1); for (@from[let i = Index(0)]; @more[i < values.length]; @step[i++]) { last = i; }]</script>',
      '<script listing="code">for @loop[@from[i = 1] @more[to n] @step[step 1]]</script>',
      '<View of="Index" name="IndexCell"><Node value={this} /></View>{#snippet Cells()}<Node>{#each values as v}<Node value={v} />{/each}</Node>{/snippet}<Layout name="Main"><Node><Listing />{@render Cells()}{last}</Node></Layout>'
    ].join('\n');
    const prepared = prepareSvelteComponent(source);
    expect(prepared.design.space['listing.language']).toEqual(['code', 'none']);
    expect(prepared.design.starter['listing.language']).toBe('code');
    expect(prepared.listings?.code.text).toBe('for i = 1 to n step 1');
    // The input as given, lighting nothing, then i set, each test, each pass's move, and the loop's
    // end.
    const { lit } = prepared.paced(pausesOf(prepared.pauses, {}));
    expect(lit.code).toHaveLength(8);
    expect(lit.code[0]).toEqual({ current: [], earlier: [] });
    const { javascript } = await bundlePresentation(prepared, 1);
    expect(javascript).toContain('for i = 1 to n step 1');
    // Without a <Listing />, the design has no listing variables.
    expect(prepareSvelteComponent(linearSearchSource).design.space).not.toHaveProperty(
      'listing.language'
    );
  });

  it('rejects a <Listing /> with props or children, inside a view, or with no listing', () => {
    const blocks =
      '<script domain>const Int = type("integer", { min: 0, max: 9 });</script><script algorithm>@run[const n = Int(1);]</script>\n';
    expect(() =>
      prepareSvelteComponent(
        `${blocks}<Layout name="Main"><Node><Listing language="python" /></Node></Layout>`
      )
    ).toThrow('takes no props or children');
    expect(() =>
      prepareSvelteComponent(
        `${blocks}<View of="Int" name="Code"><Node value={this} /><Listing /></View><Layout name="Main"><Node>{n}</Node></Layout>`
      )
    ).toThrow('place <Listing /> outside views');
    expect(() =>
      prepareSvelteComponent(`${blocks}<Layout name="Main"><Node><Listing /></Node></Layout>`)
    ).toThrow("A <Listing /> shows a listing of the source's own");
  });

  it('rejects view scripts and values that shadow library components', async () => {
    await expect(
      compileSvelteComponent(
        '<script algorithm></script>\n\n<script>const x = 1;</script>\n{#snippet X()}<Node>{x}</Node>{/snippet}<Layout name="Main"><Node>{@render X()}</Node></Layout>'
      )
    ).rejects.toMatchObject({
      code: 'view_script',
      line: 3,
      message: expect.stringContaining('Views cannot have their own <script>')
    });
    await expect(
      compileSvelteComponent('<script algorithm></script><script module>const x = 1;</script>')
    ).rejects.toThrow('Views cannot have their own <script>');
    await expect(
      compileSvelteComponent('<script algorithm></script>\n<script inputs>const x = 1;</script>')
    ).rejects.toMatchObject({ code: 'sverlin_block', line: 2 });
    await expect(
      compileSvelteComponent('<script lang="sverlin">@run[const x = 1;]</script>')
    ).rejects.toThrow(
      'Unrecognized block <script lang="sverlin">; a block is a <script> named by one attribute: <script domain> for the types'
    );
    await expect(
      compileSvelteComponent(
        '<script algorithm>@run[const Node = 1;]</script><Layout name="Main"><Node><Node>x</Node></Node></Layout>'
      )
    ).rejects.toThrow('"Node" names a library component');
  });

  it('draws nested collections with nested {#each} blocks, and no longer takes items', async () => {
    const source = (view: string) =>
      `<script domain>const Int = type("integer", { min: -100, max: 1000 }); const Row = collection(Int); const Grid = collection(Row);</script><script input>const grid = Grid([[1, 2], [3, 4]]);</script><script algorithm></script><View of="Int" name="IntCell"><Node value={this} /></View>${view}`;
    const result = await compileSvelteComponent(
      source(
        '{#snippet Rows()}<Node layout="column">{#each grid as row}<Node>{#each row as v}{v}{/each}</Node>{/each}</Node>{/snippet}<Layout name="Main"><Node>{@render Rows()}</Node></Layout>'
      )
    );
    expect(result.javascript).toContain('sv-node');
    await expect(
      compileSvelteComponent(
        source(
          '{#snippet G()}<Node items={grid} />{/snippet}<Layout name="Main"><Node>{@render Grid()}</Node></Layout>'
        )
      )
    ).rejects.toMatchObject({
      code: 'unknown_prop',
      message: expect.stringContaining('<Node> has no prop items')
    });
  });

  it('marks the node showing a view’s own value with its type, for its unit', async () => {
    const source = (view: string, more = '') =>
      `<script domain>const Int = type("integer", { min: -100, max: 1000 }); const Height = type("integer", { min: -100, max: 1000, unit: "cm" }); const People = collection(Height);</script><script input>const people = People([150, 170]);</script><script algorithm></script>${view}{#snippet Everyone()}<Node>{#each people as person}{person}{/each}</Node>{/snippet}<Layout name="Main"><Node>{@render Everyone()}${more}</Node></Layout>`;
    const view =
      '<View of="Height" name="HeightView"><Node layout="column"><Node value={this} /><Node>tall</Node></Node></View>';
    const prepared = prepareSvelteComponent(source(view));
    expect(prepared.component.match(/__type: 'Height'/g)).toHaveLength(1);
    await expect(
      compileSvelteComponent(
        source(
          `${view}{#snippet First()}<Node value={people[0]} type="Height" />{/snippet}`,
          '{@render First()}'
        )
      )
    ).rejects.toMatchObject({ code: 'unknown_prop' });
  });

  it('rejects invalid domain blocks, views, and clashing names', async () => {
    await expect(
      compileSvelteComponent(
        '<script algorithm></script>\n<script domain>\nconst A = type(Integer);\n</script>'
      )
    ).rejects.toMatchObject({
      code: 'algorithm_error',
      line: 3,
      message: expect.stringContaining('A type is declared on its own, not from another')
    });
    await expect(
      compileSvelteComponent(
        '<script domain>const Int = type("integer", { min: -100, max: 1000 });</script><script algorithm></script>\n{#snippet IntCell(value: Int, node)}{value}{/snippet}<Layout name="Main"><Node /></Layout>'
      )
    ).rejects.toThrow('IntCell takes a parameter: a snippet takes nothing');
    await expect(
      compileSvelteComponent(
        '<script domain>const Text = type(["a"]);</script><script algorithm>@run[const Text = 1;]</script>'
      )
    ).rejects.toThrow('"Text" names a type');
    await expect(
      compileSvelteComponent(
        '<script domain>const Node = type("integer", { min: -100, max: 1000 });</script><script algorithm></script>'
      )
    ).rejects.toThrow('"Node" names a library component');
  });

  it('takes chosen values, keeps base values that still fit, and gives the rest the starter', async () => {
    const prepared = prepareSvelteComponent(
      '<script algorithm></script>{#snippet One()}<Node value={1} />{/snippet}<Layout name="Main"><Node>{@render One()}</Node></Layout>'
    );
    const built = await bundlePresentation(prepared, 3, {
      chosen: { 'One.radius': 999 },
      // Removed and unfit base values are the starter's instead.
      base: { 'One.fill': 'blue-100', 'One.textSize': 9, 'gone.width': 2 }
    });
    expect(built.variant).toMatchObject({ 'One.radius': 999, 'One.fill': 'blue-100' });
    expect(built.variant['One.textSize']).toBe(prepared.design.starter['One.textSize']);
    expect(built.variant).not.toHaveProperty('gone.width');
    expect(built.origins).toMatchObject({
      'One.radius': 'chosen',
      'One.fill': 'kept',
      'One.textSize': 'starter'
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

  it('takes the page frame from the layout’s values in the variant', async () => {
    const prepared = prepareSvelteComponent(
      '<script algorithm></script>{#snippet A()}<Node>a</Node>{/snippet}<Layout name="Main"><Node>{@render A()}</Node></Layout>'
    );
    expect(prepared.design.starter['Main.ratio']).toBe('fit');
    const built = await bundlePresentation(prepared, 1, { chosen: { 'Main.ratio': '4:3' } });
    expect(built.javascript).toMatch(/"?ratio"?:"4:3"/u);
    await expect(
      bundlePresentation(prepared, 1, { chosen: { 'Main.ratio': '5:4' } })
    ).rejects.toThrow('Main.ratio cannot be "5:4"');
  });

  it('tags links like nodes, and marks the nodes and roots they join', () => {
    const algorithm =
      '<script domain>const Int = type([1, 2]); const Values = collection(Int); const Position = index(Values);</script><script input>const values = Values([1, 2]); const i = Position(0); const j = Position(1);</script><script algorithm></script><View of="Int" name="IntCell"><Node value={this} /></View>';
    const nested = prepareSvelteComponent(
      `${algorithm}\n{#snippet Pair()}<Node layout="free">\n  {#each values as v}{v}{/each}\n  {#if true}<Link from={i} to={j} />{/if}\n</Node>{/snippet}<Layout name="Main"><Node>{@render Pair()}</Node></Layout>`
    );
    expect(nested.component).toMatch(/__ref: ['"]4:13['"]/u);
    expect(nested.component).toMatch(/__links: true/u);
    expect(() =>
      prepareSvelteComponent(
        `${algorithm}{#snippet Pair()}<Node>{#each values as v}{v}{/each}</Node><Link from={i} to={j} />{/snippet}<Layout name="Main"><Node>{@render Pair()}</Node></Layout>`
      )
    ).toThrow('put it, with the nodes it joins, in a <Node layout="free">');
    expect(() =>
      prepareSvelteComponent(
        `${algorithm}\n{#snippet Pair()}<Node layout="free"><Link from={i} to={j} __id="x" /></Node>{/snippet}<Layout name="Main"><Node>{@render Pair()}</Node></Layout>`
      )
    ).toThrow('Link props starting with __, such as __id, are reserved');
  });

  it('tags every Node with its source position and reserves __ props', async () => {
    const algorithm = '<script algorithm></script>';
    const { component } = prepareSvelteComponent(
      `${algorithm}\n{#snippet C()}<Node layout="column">\n  {#if true}<Node value={1} />{/if}\n</Node>{/snippet}<Layout name="Main"><Node>{@render C()}</Node></Layout>`
    );
    expect(component).toMatch(/__ref: ['"]2:15['"]/u);
    expect(component).toMatch(/__ref: ['"]3:13['"]/u);
    expect(() =>
      prepareSvelteComponent(
        `${algorithm}\n{#snippet C()}<Node __id="x" />{/snippet}<Layout name="Main"><Node>{@render C()}</Node></Layout>`
      )
    ).toThrow(expect.objectContaining({ code: 'reserved_prop', line: 2 }));
  });

  it('rejects authored library imports', async () => {
    await expect(
      compileSvelteComponent('<script>import { Node } from "sverlin";</script><Node value={1} />')
    ).rejects.toThrow('cannot import');
  });

  it.each(['./package.json', 'esbuild/package.json', '/etc/hostname', 'svelte/../../package.json'])(
    'refuses require(%j) before bundling, as a name the page is not given',
    async (path) => {
      await expect(
        compileSvelteComponent(
          `<script algorithm></script>{#snippet R()}<Node>{require(${JSON.stringify(path)})}</Node>{/snippet}<Layout name="Main"><Node>{@render R()}</Node></Layout>`
        )
      ).rejects.toMatchObject({
        name: 'InvalidSvelteSourceError',
        code: 'view_name',
        message: expect.stringContaining('The view reads require')
      });
    }
  );

  it('keeps authored line numbers after prelude injection', async () => {
    await expect(
      compileSvelteComponent(
        '<script algorithm></script>\n{#snippet S()}<Node>\n{$state(1)}</Node>{/snippet}<Layout name="Main"><Node>{@render S()}</Node></Layout>'
      )
    ).rejects.toMatchObject({ line: 3, column: 2 });
  });

  it('identifies the source by its steps, whatever the view and input', async () => {
    const source = (values: string, view: string) =>
      `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int);</script><script input>const values = Values(${values});</script><script algorithm>@reverse[const t = values[0]; values[0] = values[1]; values[1] = t;]</script>{#snippet V()}${view}{/snippet}<Layout name="Main"><Node>{@render V()}</Node></Layout>`;
    const signature = async (values: string, view: string) =>
      (await compileSvelteComponent(source(values, view))).stepSignature;
    const first = await signature(
      '[1, 2]',
      '<Node>{#each values as v}<Node value={v} />{/each}</Node>'
    );
    expect(
      await signature(
        '[1, 2]',
        '<Node layout="column">{#each values as v}<Node><Node value={v} /></Node>{/each}</Node>'
      )
    ).toBe(first);
    expect(
      await signature('[2, 1]', '<Node>{#each values as v}<Node value={v} />{/each}</Node>')
    ).toBe(first);
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
  /** A source of the values and their row, its parts, and its layout drawing the row and `renders`. */
  const view = (parts: string, renders = '') =>
    `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Position = index(Values);</script><script input>const values = Values([1, 2]);</script><script algorithm>@run[let i = Position(0);]</script><View of="Int" name="IntText"><Node value={this} /></View><View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>${parts}<Layout name="Main"><Node>{values}${renders}</Node></Layout>`;

  it('draws a view with a <Pointed> around the element its position points at', () => {
    const prepared = prepareSvelteComponent(
      view(
        '<View of="Position" name="Arrow"><Node layout="column"><Pointed /><Node>i</Node></Node></View>',
        '{i}'
      )
    );
    expect(prepared.component).toContain('__sverlinPointers');
    expect(prepared.components.map(({ name }) => name)).toContain('Arrow');
    expect(prepared.design.space['Arrow.Pointed.fill']).toBeDefined();
  });

  it('draws a position type rendered by name as a mark outside a node, its number inside one', () => {
    const pointer = '<View of="Position" name="Highlight"><Pointed /></View>';
    const caption = '{#snippet At()}<Node>at {i}</Node>{/snippet}';
    const text = '<View of="Position" name="PositionText"><Node value={this} /></View>';
    const both = prepareSvelteComponent(view(`${text}${pointer}${caption}`, '{@render At()}{i}'));
    expect(both.design.space['views.Position']).toEqual(['PositionText', 'none']);
    expect(both.design.space['pointers.Position']).toEqual(['Highlight', 'none']);
    expect(both.design.starter['pointers.Position']).toBe('Highlight');
    // Each render's variable, by its line:column, for the editor.
    const source = view(`${text}${pointer}${caption}`, '{@render At()}{i}');
    const siteOf = (needle: string, from = 0) => {
      const at = source.indexOf(needle, from);
      const before = source.slice(0, at);
      return `${before.split('\n').length}:${at - before.lastIndexOf('\n')}`;
    };
    const inCaption = source.indexOf('{i}');
    expect(both.design.renders).toMatchObject({
      [siteOf('{i}')]: 'views.Position',
      [siteOf('{i}', inCaption + 1)]: 'pointers.Position'
    });
    expect(both.component).toContain('__sverlinPointers');
    // With only pointer views, the type's choice is its pointers variable all the same.
    const marks = prepareSvelteComponent(view(pointer, '{i}'));
    expect(marks.design.space['pointers.Position']).toEqual(['Highlight', 'none']);
    expect(marks.design.space['views.Position']).toBeUndefined();
    expect(() => prepareSvelteComponent(view(`${pointer}${caption}`, '{@render At()}'))).toThrow(
      'or, to show the position as a number here, add a view that draws it, as <View of="Position" name="PositionText"><Node value={this} /></View>'
    );
  });

  it.each([
    [
      '<Pointed> outside a view of an index type',
      '{#snippet P()}<Node><Pointed /></Node>{/snippet}',
      '{@render Pair()}',
      /belongs in a view of an index type/
    ],
    [
      'a pointer that is not a view of an index type',
      '<View of="Int" name="Mark"><Pointed /></View>',
      '',
      /Int is neither an index nor a reference type/
    ],
    [
      'two <Pointed> in one pointer',
      '<View of="Position" name="Arrow"><Node><Pointed /><Pointed /></Node></View>',
      '',
      /has 2 <Pointed>/
    ],
    [
      'props <Pointed> does not take',
      '<View of="Position" name="Arrow"><Pointed layout="row" /></View>',
      '',
      /<Pointed> takes no props/
    ],
    [
      'a pointer rendered in a part of the page',
      '<View of="Position" name="Arrow"><Pointed /></View>{#snippet Marks()}{i}{/snippet}',
      '{@render Marks()}',
      /rendered at the top of the view, outside blocks other than \{#if\} and outside snippets/
    ],
    [
      'a <Pointed> in a snippet inside its pointer view',
      '<View of="Position" name="Arrow">{#snippet Mark()}<Pointed />{/snippet}<Node>{@render Int()}</Node></View>',
      '{i}',
      /A <Pointed> is written in its pointer view itself/
    ]
  ])('rejects %s', (_name, parts, renders, message) => {
    expect(() => prepareSvelteComponent(view(parts, renders))).toThrow(message);
  });
});

describe('typed view components', () => {
  const domain = '<script domain>const Int = type([1, 3]); const Flag = type("boolean");</script>';
  const algorithm = '<script algorithm>@run[let i = Int(1);]</script>';
  const component = (view: string) => prepareSvelteComponent(`${domain}${algorithm}${view}`);

  it('reads typed snippets as views of one type, and draws the view the variant chooses for the type', async () => {
    const prepared = component(
      '<View of="Int" name="IntText"><Node value={this} /></View><View of="Int" name="IntPair"><Node layout="row"><Node value={this} /><Node value={this} /></Node></View><Layout name="Main"><Node>{i}</Node></Layout>'
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
      `<script domain>const Int = type([1, 3]); const Row = collection(Int);</script><script algorithm>@start[let values = Row([1, 3]);] @grow[values = Row([1, 3, 1]);]</script><View of="Row" name="Search"><Node layout="row">{#each this as value}{value}{/each}</Node></View><View of="Int" name="Plain"><Node value={this} /></View><View of="Int" name="Boxed"><Node layout="row"><Node value={this} /></Node></View><Layout name="Main"><Node>{values}</Node></Layout>`
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
      `<script domain>const Vertex = type("integer", { min: 0, max: 5 }); const Weight = type([1, 4, 7]); const Edge = record({ from: Vertex, to: Vertex, weight: Weight });</script><script algorithm></script><View of="Vertex" name="VertexView"><Node value={this} /></View><View of="Edge" name="EdgeView"><Node layout="row">{this.from}{this.to}<Node value={this.weight} /></Node></View><Layout name="Main"><Node /></Layout>`
    );
    // from and to go to VertexView; weight is shown, so it takes each of its values.
    expect(prepared.components.find(({ name }) => name === 'EdgeView')?.cases).toEqual(
      [1, 4, 7].map((weight) => ({ from: 0, to: 0, weight }))
    );
  });

  it('measures the root with every value of what it reads for placement', () => {
    const prepared = prepareSvelteComponent(
      `<script domain>const Int = type([1, 3]); const Index = type("integer", { min: -1, max: 3 }); const Values = collection(Int);</script><script input>const values = Values([1, 3, 1]); const target = Int(3);</script><script algorithm>@start[let i = Index(-1);] @move[i = Index(0);]</script><View of="Int" name="IntView"><Node value={this} /></View>{#snippet Cells()}<Node layout="row">{#each values as value, k}<Node>{value}{#if k === i}<Node>i</Node>{/if}</Node>{/each}</Node>{/snippet}<Layout name="Main"><Node>{target}{@render Cells()}</Node></Layout>`
    );
    // i places the pointer, measured where it is first declared; target and the cells go to views.
    expect(prepared.paced(pausesOf(prepared.pauses, {})).placements).toEqual([
      { path: 'i', step: 3, values: [-1, 0, 1, 2, 3] }
    ]);
  });

  it('measures a position with every place in its collection, and as far past it as the trace goes', () => {
    const prepared = prepareSvelteComponent(
      `<script domain>const Int = type([1, 3]); const Values = collection(Int); const Position = index(Values);</script><script input>const values = Values([1, 3, 1, 3]);</script><script algorithm>@start[let i = Position(-1);] @move[i = Position(0);]</script>{#snippet Cells()}<Node layout="row">{#each values as value, k}<Node>{#if k === i}<Node>i</Node>{/if}</Node>{/each}</Node>{/snippet}<Layout name="Main"><Node>{@render Cells()}</Node></Layout>`
    );
    expect(prepared.paced(pausesOf(prepared.pauses, {})).placements).toEqual([
      { path: 'i', step: 3, values: [-1, 0, 1, 2, 3] }
    ]);
  });

  it('draws every domain type with its widest values when all of them would be too many', () => {
    const prepared = prepareSvelteComponent(
      `<script domain>const Count = type("integer", { min: 0, max: 999 }); const Ratio = type("number", { min: 0, max: 1, places: 3 }); const Mark = type(["x", "yes"]); const Slot = union(Count, Mark); const Pair = record({ a: Count, b: Mark }); const Row = collection(Count); const Grid = collection(Row);</script><script algorithm>@run[let r = Ratio(0.125); let g = Grid([[1, 2], [3]]);]</script><View of="Count" name="C"><Node value={this} /></View><View of="Ratio" name="R"><Node value={this} /></View><View of="Mark" name="M"><Node value={this} /></View><View of="Pair" name="P"><Node>{this.a}{this.b}</Node></View><View of="Grid" name="G"><Node layout="column">{#each this as row}<Node>{#each row as count}{count}{/each}</Node>{/each}</Node></View><Layout name="Main"><Node>{r}</Node></Layout>`
    );
    expect(Object.fromEntries(prepared.components.map(({ name, cases }) => [name, cases]))).toEqual(
      {
        // A range's ends, and the value in the trace that prints longest.
        C: [0, 999, 1],
        R: [0, 1, 0.125],
        M: ['x', 'yes'],
        // P draws its fields through C and M, which keep their boxes, so one value does.
        P: [{ a: 0, b: 'yes' }],
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
    // So does R, a number type, searched as its smallest steps, each printed with its places.
    expect(prepared.components.find(({ name }) => name === 'R')?.range).toEqual({
      min: 0,
      max: 1,
      places: 3
    });
  });

  it.each([
    [
      'rendering a type nothing draws',
      () =>
        component(
          '{#snippet I()}<Node>{i}</Node>{/snippet}<Layout name="Main"><Node>{@render I()}</Node></Layout>'
        ),
      /Int is a type, and nothing draws it: add a view of it/
    ],
    [
      'rendering a snippet that is not defined',
      () =>
        component(
          '<View of="Int" name="IntCell"><Node value={this} /></View>{#snippet I()}<Node>{i}</Node>{/snippet}<Layout name="Main"><Node>{@render I()}{@render Compared(i)}</Node></Layout>'
        ),
      /\{@render Compared\(…\)\} draws Compared, which no snippet, type, or label is named/
    ],
    [
      'a view named after its type',
      () =>
        component(
          '<View of="Int" name="Int"><Node value={this} /></View><Layout name="Main"><Node>{i}</Node></Layout>'
        ),
      /Int is a view named after its type/
    ],
    [
      'a part named after a type',
      () =>
        component(
          '{#snippet Int()}<Node>x</Node>{/snippet}<Layout name="Main"><Node>{@render Int()}</Node></Layout>'
        ),
      /The snippet Int has the name of a type/
    ],
    [
      'reading an algorithm variable',
      () =>
        component(
          '<View of="Int" name="Cell"><Node value={i} /></View><Layout name="Main"><Node /></Layout>'
        ),
      /Cell reads i, an input or algorithm variable/
    ],
    [
      'reading an algorithm variable past a loop of the same name',
      () =>
        component(
          '<View of="Int" name="Cell"><Node>{#each [1] as i}{/each}{this} at {i}</Node></View><Layout name="Main"><Node /></Layout>'
        ),
      /Cell reads i, an input or algorithm variable/
    ],
    [
      'types that are not domain types',
      () =>
        component(
          '<View of="Number" name="Cell"><Node value={this} /></View><Layout name="Main"><Node /></Layout>'
        ),
      /Cell's type Number is not a type/
    ],
    [
      'a view written as a snippet',
      () =>
        component(
          '{#snippet Cell(this: Int)}<Node value={this} />{/snippet}<Layout name="Main"><Node /></Layout>'
        ),
      /Cell takes a value, as only a view does: write it as a view, <View of="Int" name="Cell">/
    ],
    [
      'a view without a name',
      () =>
        component(
          '<View of="Int"><Node value={this} /></View><Layout name="Main"><Node /></Layout>'
        ),
      /<View of="Int"> has no name: a view is written <View of="Int" name="Bar">/
    ],
    [
      'a view with a prop of another kind',
      () =>
        component(
          '<View of="Int" name="Cell" fill="red"><Node value={this} /></View><Layout name="Main"><Node /></Layout>'
        ),
      /A <View> takes only of, its type or label, and name: fill is no prop of a view/
    ],
    [
      'a view whose type is computed',
      () =>
        component(
          '<View of={Int} name="Cell"><Node value={this} /></View><Layout name="Main"><Node /></Layout>'
        ),
      /A <View>'s of is written as it is, not computed, as of="Int"/
    ],
    [
      'a view holding nothing',
      () => component('<View of="Int" name="Cell" /><Layout name="Main"><Node /></Layout>'),
      /<View of="Int" name="Cell" \/> holds nothing: a view holds what it draws/
    ],
    [
      'a view never closed',
      () =>
        component(
          '<View of="Int" name="Cell"><Node value={this} /><Layout name="Main"><Node /></Layout>'
        ),
      /The <View> is never closed/
    ],
    [
      'a view inside another',
      () =>
        component(
          '<View of="Int" name="Cell"><View of="Int" name="Inner"><Node value={this} /></View></View><Layout name="Main"><Node /></Layout>'
        ),
      /A <View> is written at the top level, beside the parts and layouts, not inside another view/
    ],
    [
      'components inside markup',
      () =>
        component(
          '{#snippet Part()}<Node><View of="Int" name="Cell"><Node value={this} /></View></Node>{/snippet}<Layout name="Main"><Node>{@render Part()}</Node></Layout>'
        ),
      /A <View> is written at the top level, beside the parts and layouts, never inside a part/
    ],
    [
      'views with more values than can be drawn',
      () =>
        prepareSvelteComponent(
          `<script domain>const Flag = type("boolean"); const Flags = record({ a: Flag, b: Flag, c: Flag, d: Flag, e: Flag, f: Flag, g: Flag, h: Flag, i: Flag });</script><script algorithm></script><View of="Flags" name="F"><Node value={this.a} /></View><Layout name="Main"><Node /></Layout>`
        ),
      /F would be drawn with too many values of Flags/
    ]
  ])('rejects %s', (_name, prepare, message) => {
    expect(prepare).toThrow(message);
  });
});

describe('scope', () => {
  const source = (markup: string) =>
    `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Position = index(Values); const Flag = type("boolean");</script><script input>const values = Values([5, 2]);</script><script algorithm>for (@from[let i = Position(1)]; @more[i < values.length]; @step[i++]) {\n  @key[const key = values[i];]\n}\n@done[const done = Flag(true);]</script><View of="Int" name="IntText"><Node value={this} /></View>${markup}`;

  it('stands a variable out of scope in hidden, with its value from the nearest step', async () => {
    const prepared = prepareSvelteComponent(
      source('<Layout name="Main"><Node>{key}</Node></Layout>')
    );
    const { javascript } = await bundlePresentation(prepared, 1);
    // After the loop, i and key are out of scope: they stand in from the step that had them, and are
    // listed absent (values, the same at every step, is kept once; see library/trace-pack.ts).
    expect(javascript).toContain('i:1,key:2');
    expect(javascript).toContain('["i","key"]');
  });

  it('rejects the view reading a variable out of scope at some step itself', () => {
    expect(() =>
      prepareSvelteComponent(
        source(
          '{#snippet K()}<Node><Node value={key} /></Node>{/snippet}<Layout name="Main"><Node>{@render K()}</Node></Layout>'
        )
      )
    ).toThrow('The view reads key itself, but key is out of scope at some steps');
  });

  it('rejects choosing by a label value, pointing at <When> and at labelling the guarded code', () => {
    const chosen = (test: string) =>
      source(
        `{#snippet Held()}<Node>held</Node>{/snippet}<Layout name="Main"><Node>{#if ${test}}{@render Held()}{/if}</Node></Layout>`
      ).replace('@key[const key = values[i];]', '@key[const key = @at[values[i]];]');
    expect(() => prepareSvelteComponent(chosen('@key.at'))).toThrow(
      `{#if @key.at} would choose what to draw by the label's value, which a view never does: <When of="@key.at">…</When>`
    );
    expect(() => prepareSvelteComponent(chosen('@key.at > 0'))).toThrow(
      `A view cannot choose what to draw by a label's value, as {#if @key.at}: <When of="@key.at">…</When> draws`
    );
  });

  it('takes a variable declared later read itself only inside a node, which hides at step 0', () => {
    expect(() =>
      prepareSvelteComponent(
        source(
          '{#snippet D()}<Node>{#if done}Done{/if}</Node>{/snippet}<Layout name="Main"><Node>{@render D()}</Node></Layout>'
        )
      )
    ).not.toThrow();
    expect(() =>
      prepareSvelteComponent(
        source(
          '{#snippet D()}{#if done}<Node>Done</Node>{/if}{/snippet}<Layout name="Main"><Node>{@render D()}</Node></Layout>'
        )
      )
    ).toThrow('The view reads done itself outside any <Node>');
  });
});

describe('views', () => {
  it('are only drawn with {@render}, never called to make a value', () => {
    const source = `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Index = index(Values);</script><script input>const values = Values([5, 2]);</script><script algorithm></script><View of="Int" name="IntText"><Node value={this} /></View><View of="Index" name="IndexLabel"><Node value={this} /></View><View of="Values" name="Row"><Node layout="row">{#each this as v, k}{v}{Index(k)}{/each}</Node></View><Layout name="Main"><Node>{values}</Node></Layout>`;
    expect(() => prepareSvelteComponent(source)).toThrow(
      'Index(…) is a view, which only draws: write {value}'
    );
  });
});

describe('view choices and prop values', () => {
  const domain =
    '<script domain>const Int = type("integer", { min: 0, max: 3 });</script><script algorithm>@run[const i = Int(1);]</script>';

  it('leaves out of a type’s views those that draw the type itself', () => {
    const prepared = prepareSvelteComponent(
      `${domain}<View of="Int" name="Plain"><Node value={this} /></View><View of="Int" name="Boxed"><Node>{this}</Node></View><Layout name="Main"><Node>{i}</Node></Layout>`
    );
    expect(prepared.design.space['views.Int']).toEqual(['Plain', 'none']);
    expect(() =>
      prepareSvelteComponent(
        `${domain}<View of="Int" name="Boxed"><Node>{this}</Node></View><Layout name="Main"><Node>{i}</Node></Layout>`
      )
    ).toThrow('Every view of Int draws Int itself');
  });

  it('checks every value an expression can give a prop with fixed options', () => {
    expect(() =>
      prepareSvelteComponent(
        `${domain}{#snippet A()}<Node layout={1 > 0 ? 'row' : 'stack'}><Node>a</Node></Node>{/snippet}<Layout name="Main"><Node>{@render A()}</Node></Layout>`
      )
    ).toThrow(`layout={1 > 0 ? 'row' : 'stack'} can be "stack"`);
  });
});

describe('views of what a step computed', () => {
  const bubble = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = collection(Int);
  const Index = index(Values);

  // walking the collection

  // what the algorithm does
</script>

<script input>
  const values = Values([5, 1, 4, 2, 3]);
</script>

<script algorithm>
  for (@setup[let end = values.length]; @guard[Index(1) < end]; @onward[end--]) @sweep{
    for (@setup[let i = Index(1)]; @guard[i < end]; @onward[i++]) @pair{
      if (@test[values[i - 1] > values[i]]) @swap{
        const moved = values[i - 1];
        values[i - 1] = values[i];
        values[i] = moved;
      }
    }
  }
</script>

<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Flag" name="FlagWord"><Node>{this ? 'yes' : 'no'}</Node></View>
<View of="@sweep.pair.test" name="Ask">
  <Node>is {this.left} > {this.right}? {this.value}</Node>
</View>
{#snippet Title()}<Node>Bubble sort</Node>{/snippet}
{#snippet Board()}
  <Node layout="column">
    <Node>{#each values as v}{v}{/each}</Node>
    {@sweep.pair.test}
  </Node>
{/snippet}

<Layout name="Main">
  <Node>
    {@render Title()}
    {@render Board()}
  </Node>
</Layout>`;
  // The key of the render of the label @sweep.pair.test.
  const test = 'ℓsweepˑpairˑtest';

  it('take a label as a view’s type, its views a choice, and keep what it computed to stand in', () => {
    const prepared = prepareSvelteComponent(bubble);
    expect(prepared.design.space['views.@sweep.pair.test']).toEqual(['Ask', 'none']);
    expect(Object.values(prepared.applied ?? {})[0]).toEqual({
      state: { left: 5, right: 1, value: true },
      types: { left: 'Int', right: 'Int' },
      at: expect.any(Number),
      identities: { left: expect.any(Number), right: expect.any(Number) }
    });
  });

  it('give a step’s after its one application, and stand one in hidden elsewhere', async () => {
    const prepared = prepareSvelteComponent(bubble);
    const { javascript } = await bundlePresentation(prepared, 1);
    expect(javascript).toMatch(/__applied_(?:ℓ|\\u2113)sweep/u);
  });

  it('pause at each comparison its label runs, and apart from it at each swap', async () => {
    const prepared = prepareSvelteComponent(bubble);
    const both = prepared.paced(new Set(['sweep.pair.test', 'sweep.pair.swap'])).steps;
    const steps = (master: typeof prepared.master) =>
      master.map(({ state, applied }) => [
        String(state.values),
        applied?.[test]?.map(({ state }) => `${state.left} > ${state.right}`) ?? []
      ]);
    // The comparison lifts its operands, then the swap moves them, each a step of its own.
    expect(steps(both).slice(1, 5)).toEqual([
      ['5,1,4,2,3', ['5 > 1']],
      ['1,5,4,2,3', []],
      ['1,5,4,2,3', ['5 > 4']],
      ['1,4,5,2,3', []]
    ]);
    // Ten comparisons and six swaps, after the input as given.
    expect(both).toHaveLength(17);
    // Not pausing at the comparisons, the sort plays through its swaps, each comparison leading up
    // to its swap and drawn there.
    const swaps = prepared.paced(new Set(['sweep.pair.swap'])).steps;
    expect(steps(swaps).slice(1, 3)).toEqual([
      ['1,5,4,2,3', ['5 > 1']],
      ['1,4,5,2,3', ['5 > 4']]
    ]);
    const paced = await bundlePresentation(prepared, 1, {
      chosen: {
        'pause@sweep': 'off',
        'pause@sweep.pair': 'off',
        'pause@sweep.pair.test': 'off'
      }
    });
    expect(paced.labels).toHaveLength(7);
    expect(paced.stepSignature).toBe((await bundlePresentation(prepared, 1)).stepSignature);
  });

  it('refuse a label read inside a view, and a view typed by a label no step evaluates', () => {
    expect(() =>
      prepareSvelteComponent(
        bubble.replace(
          '<View of="Int" name="IntCell"><Node value={this} /></View>',
          '<View of="Int" name="IntCell"><Node value={this} />{@sweep.pair.test}</View>'
        )
      )
    ).toThrow('which only the root and its parts know: write it there');
    expect(() =>
      prepareSvelteComponent(
        bubble
          .replace(
            '@test[values[i - 1] > values[i]]',
            '@test[values[i - 1] > values[i] || (@early[end < Index(0)] && @never[values[0] < values[1]])]'
          )
          .replace(
            '<View of="Flag" name="FlagWord"',
            '<View of="@sweep.pair.test.never" name="Tell"><Node>{this.value}</Node></View>\n<View of="Flag" name="FlagWord"'
          )
      )
    ).toThrow('which labels no expression any step evaluates');
  });
});

describe('pauses at labels', () => {
  const insertion = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Flag = type('boolean');
</script>

<script input>
  const values = Values([5, 2, 4, 1]);
</script>

<script algorithm>
  for (@setup[let i = Position(1)]; @guard[i < values.length]; @onward[i++]) @insert{
    let j = i;
    while (@guard[Position(0) < j] && @compare[(values[@left[j - 1]]) > values[@right[j]]]) @swap{
      const moved = values[@from[j - 1]];
      values[j - 1] = values[@to[j]];
      values[j] = moved;
      j--;
    }
  }
</script>

<script listing="code">
  for (@setup[i = 1]; @guard[i < length(A)]; @onward[i = i + 1])
    @insert[j = i
    while @guard[j > 0] and @compare[A[@left[j - 1]] > A[@right[j]]]
      @swap[moved = A[@from[j - 1]]
      A[j - 1] = A[@to[j]]
      A[j] = moved
      j = j - 1]]
</script>

<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Flag" name="FlagWord"><Node>{this ? 'yes' : 'no'}</Node></View>
<View of="@insert.compare" name="Ask"><Node>is {this.left} > {this.right}? {this.value}</Node></View>
<View of="Position" name="Highlight"><Pointed /></View>
{#snippet Board()}
  <Node layout="row">
    <Listing />
    <Node layout="column">
      <Node>{#each values as v}{v}{/each}</Node>
      {@insert.compare}
    </Node>
  </Node>
{/snippet}

<Layout name="Main">
  <Node>
    {@render Board()}
    {@insert.compare.left}
    {@insert.compare.right}
    {@insert.swap.from}
    {@insert.swap.to}
  </Node>
</Layout>`;
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
      const comparison = step.applied?.['ℓinsertˑcompare']?.[0]?.state;
      const short = (labels?: Record<string, unknown>) =>
        Object.keys(labels ?? {})
          .map((label) => label.slice(label.lastIndexOf('.') + 1))
          .sort()
          .join(' ');
      return [
        String(step.state.values),
        comparison ? `${comparison.left} > ${comparison.right}: ${comparison.value}` : '',
        short(step.labelled),
        short(step.held)
      ].join(' | ');
    });

  it('offers a pause at every label, by its full name, on to start where its runs draw something', () => {
    const prepared = prepareSvelteComponent(insertion);
    const starterPauses = (source: string) =>
      Object.fromEntries(
        Object.entries(prepareSvelteComponent(source).design.starter).filter(([key]) =>
          key.startsWith('pause@')
        )
      );
    // A pass's end draws what its last swap drew, so it starts off; the rest each draw a change.
    // The loop's parts and the bound only move or test i and j, which nothing draws, so they start off.
    expect(starterPauses(insertion)).toEqual({
      'pause@guard': 'off',
      'pause@insert.guard': 'off',
      'pause@onward': 'off',
      'pause@setup': 'off',
      'pause@insert': 'off',
      'pause@insert.compare': 'on',
      'pause@insert.compare.left': 'on',
      'pause@insert.compare.right': 'on',
      'pause@insert.swap': 'on',
      'pause@insert.swap.from': 'on',
      'pause@insert.swap.to': 'on'
    });
    // What the view draws decides them: without its marks or its comparison, only the swap, which
    // moves values, draws something new.
    const bare = insertion.replace(/\{@insert\.[a-z.]*\}\n?/g, '').replace('{@insert.compare}', '');
    expect(bare).not.toContain('{@insert.compare.left}');
    expect(starterPauses(bare)).toEqual({
      'pause@guard': 'off',
      'pause@insert.guard': 'off',
      'pause@onward': 'off',
      'pause@setup': 'off',
      'pause@insert': 'off',
      'pause@insert.compare': 'off',
      'pause@insert.compare.left': 'off',
      'pause@insert.compare.right': 'off',
      'pause@insert.swap': 'on',
      'pause@insert.swap.from': 'off',
      'pause@insert.swap.to': 'off'
    });
    // A label with labels inside it can accumulate; one without is only on or off.
    expect(prepared.design.space['pause@insert.compare']).toEqual(['accumulate', 'on', 'off']);
    expect(prepared.design.space['pause@insert.swap.to']).toEqual(['on', 'off']);
    const coarse = prepared.paced(new Set(['insert.compare', 'insert.swap'])).steps;
    expect(played(coarse).slice(0, 5)).toEqual([
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
    const coarseChoice = {
      'pause@insert': 'off',
      'pause@insert.compare': 'accumulate',
      'pause@insert.compare.left': 'off',
      'pause@insert.compare.right': 'off',
      'pause@insert.swap': 'accumulate',
      'pause@insert.swap.from': 'off',
      'pause@insert.swap.to': 'off'
    };
    const coarse = await bundlePresentation(prepared, 1, { chosen: coarseChoice });
    const apart = await bundlePresentation(prepared, 1, {
      chosen: {
        ...coarseChoice,
        'pause@insert.compare.left': 'on',
        'pause@insert.compare.right': 'on',
        'pause@insert.swap.to': 'on'
      }
    });
    expect(apart.stepSignature).toBe(coarse.stepSignature);
    expect(apart.labels.length).toBeGreaterThan(coarse.labels.length);
    // Both are some of the source's steps, in order, by name.
    expect(apart.steps).toEqual(coarse.steps);
    expect(stepPlaces(coarse.steps, coarse.labels)).toBeDefined();
    expect(stepPlaces(apart.steps, apart.labels)).toBeDefined();
  });

  it('names a pause by the label’s full name, refusing its short ending', async () => {
    const prepared = prepareSvelteComponent(insertion);
    await expect(
      bundlePresentation(prepared, 1, { chosen: { 'pause@left': 'on' } })
    ).rejects.toThrow('a pause names a label by its full name');
  });

  describe('listing regions as places', () => {
    it('gives each region its paint, falling back to its label’s mark', () => {
      const { design } = prepareSvelteComponent(insertion);
      expect(design.space['listing.lit.radius']).toContain(999);
      expect(design.space['listing.lit.color']).toContain('none');
      expect(design.space['listing.lit@insert.compare.left.fill']).toContain('sky-100');
      expect(design.space['listing.lit@insert.compare.left.radius']).toBeUndefined();
      expect(Object.keys(design.space).some((key) => key.startsWith('listing.earlier'))).toBe(
        false
      );
      expect(design.starter['listing.lit.fill']).toBe('amber-200');
      // A region follows the mark where the root draws its label; an unmarked one the lit look.
      expect(design.fallbacks['listing.lit@insert.compare.left.fill']).toBe(
        'Highlight.Pointed@insert.compare.left.fill'
      );
      expect(design.fallbacks['listing.lit@insert.swap.fill']).toBe('listing.lit.fill');
    });

    it('follows the mark through its place to its kind, until set apart', () => {
      const { design } = prepareSvelteComponent(insertion);
      const build = (request: Parameters<typeof buildVariant>[2]) =>
        buildVariant(design.space, design.starter, request, 1, design.fallbacks).values;
      const marked = build({
        chosen: {
          'Highlight.Pointed.fill': 'violet-100',
          'Highlight.Pointed@insert.compare.left.fill': 'sky-100',
          'listing.lit.fill': 'amber-200'
        }
      });
      expect(marked['listing.lit@insert.compare.left.fill']).toBe('sky-100');
      expect(marked['listing.lit@insert.compare.right.fill']).toBe('violet-100');
      expect(marked['listing.lit@insert.compare.fill']).toBe('amber-200');
      // A region given a paint of its own in the variant built on keeps it as the mark changes.
      const apart = build({
        base: { ...marked, 'listing.lit@insert.swap.to.fill': 'red-200' },
        chosen: { 'Highlight.Pointed@insert.swap.to.fill': 'rose-100' }
      });
      expect(apart['listing.lit@insert.swap.to.fill']).toBe('red-200');
    });

    it('hands the page each region by its label’s full name', async () => {
      const prepared = prepareSvelteComponent(insertion);
      expect(prepared.listings?.code.regions.map(({ label }) => label)).toEqual([
        'setup',
        'guard',
        'onward',
        'insert',
        'insert.guard',
        'insert.compare',
        'insert.compare.left',
        'insert.compare.right',
        'insert.swap',
        'insert.swap.from',
        'insert.swap.to'
      ]);
      const { javascript } = await bundlePresentation(prepared, 1);
      expect(javascript).toMatch(/"?label"?:"insert\.compare\.left"/);
    });
  });
});

describe('pauses accumulate', () => {
  const insertion = prepareSvelteComponent(
    // The pauses-at-labels source, whose listing marks every label.
    `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values([5, 2, 4, 1]);
</script>
<script algorithm>
  for (@setup[let i = Position(1)]; @guard[i < values.length]; @onward[i++]) @insert{
    let j = i;
    while (@guard[Position(0) < j] && @compare[(values[@left[j - 1]]) > values[@right[j]]]) @swap{
      const moved = values[@from[j - 1]];
      values[j - 1] = values[@to[j]];
      values[j] = moved;
      j--;
    }
  }
</script>
<script listing="code">
  for (@setup[i = 1]; @guard[i < length(A)]; @onward[i = i + 1])
    @insert[j = i
    while @guard[j > 0] and @compare[A[@left[j - 1]] > A[@right[j]]]
      @swap[moved = A[@from[j - 1]]
      A[j - 1] = A[@to[j]]
      A[j] = moved
      j = j - 1]]
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Flag" name="FlagWord"><Node>{this ? 'yes' : 'no'}</Node></View>
<View of="@insert.compare" name="Ask"><Node>is {this.left} > {this.right}? {this.value}</Node></View>
<View of="Position" name="Highlight"><Pointed /></View>
{#snippet Board()}
  <Node layout="row">
    <Listing />
    <Node layout="column">
      <Node>{#each values as v}{v}{/each}</Node>
      {@insert.compare}
    </Node>
  </Node>
{/snippet}

<Layout name="Main">
  <Node>
    {@render Board()}
    {@insert.compare.left}
    {@insert.compare.right}
    {@insert.swap.from}
    {@insert.swap.to}
  </Node>
</Layout>`
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
    // Only the operand lights: not what led up to the comparison, outside every pause, nor the rest
    // of the comparison, which is on.
    expect(left).toEqual({ held: [], current: ['j - 1'], earlier: [] });
    expect(right).toEqual({ held: [], current: ['j'], earlier: [] });
    // Its own end shows the whole of its run.
    expect(compare).toMatchObject({ held: ['left', 'right'], current: ['A[j - 1] > A[j]'] });
  });

  it('pass through a label that is off, to the runs around it', () => {
    // Off, the comparison neither pauses nor keeps: the insertion around it, accumulating, keeps.
    const kept = firstSteps({ ...operands, insert: 'accumulate', 'insert.swap': 'accumulate' });
    expect(kept[1].held).toEqual(['left']);
    expect(kept[1].earlier.join(' ')).toContain('j - 1');
    // With nothing around it keeping, only the code since the step before could light faintly: the
    // left operand's cell read, in the comparison still being run, which stays dark.
    const none = firstSteps({ ...operands, 'insert.swap': 'accumulate' });
    expect(none[1]).toEqual({ held: [], current: ['j'], earlier: [] });
  });

  it('light as run only code that has run, a statement once the code has left it', () => {
    const fine = {
      ...operands,
      'insert.compare': 'accumulate',
      'insert.swap': 'accumulate',
      'insert.swap.to': 'on'
    } as const;
    const { lit } = insertion.paced(new Map(Object.entries(fine)));
    const texts = (ranges: readonly (readonly [number, number])[]) =>
      ranges.map(([start, end]) => text.slice(start, end));
    // Paused at the left operand: the comparison it is in has not been evaluated, so it is dark, and
    // the code before it is in no run the page pauses at.
    expect(texts(lit.code[1].earlier)).toEqual([]);
    // At the right operand, only the left one, done, is lit faintly.
    expect(texts(lit.code[2].earlier)).toEqual(['j - 1']);
    // Paused at the swap's read of A[j]: its first line ran; its second is half run and the rest
    // has not run, so they stay dark, as does the loop's line, in no run the page pauses at.
    expect(texts(lit.code[4].current)).toEqual(['j']);
    expect(texts(lit.code[4].earlier)).toEqual(['moved = A[j - 1]']);
  });

  it('nest: an accumulating run keeps its parts from before an inner run that is on', () => {
    const [, right] = firstSteps({ ...operands, insert: 'accumulate', 'insert.compare': 'on' });
    // The insertion's start, before the comparison, stays; the comparison's left operand does not.
    expect(right.held).toEqual([]);
    expect(right.earlier.join(' ')).toContain('j = i');
    expect(right.earlier.join(' ')).not.toContain('j - 1');
  });

  it('name each step by its label’s run, the same however the steps pause', () => {
    const coarse = insertion.paced(
      new Map([
        ['insert.compare', 'accumulate'],
        ['insert.swap', 'accumulate']
      ])
    ).steps;
    const fine = insertion.paced(pausesOf(insertion.pauses, {})).steps;
    expect(coarse.map(({ name }) => name).slice(0, 4)).toEqual([
      'start',
      '@insert.compare#1',
      '@insert.swap#1',
      '@insert.compare#2'
    ]);
    // Pausing everywhere, the loop's i is set and tested, then j's bound is tested, first.
    expect(fine.map(({ name }) => name).slice(0, 7)).toEqual([
      'start',
      '@setup#1',
      '@guard#1',
      '@insert.guard#1',
      '@insert.compare.left#1',
      '@insert.compare.right#1',
      '@insert.compare#1'
    ]);
    // Each coarse step is the fine step of its name, holding the same state.
    const byName = new Map(fine.map((step) => [step.name, step.state]));
    for (const { name, state } of coarse) expect(byName.get(name)).toEqual(state);
  });

  it('count each label’s runs and those changing what the view draws, for the chooser', () => {
    const { runs } = insertion.pauses;
    // Each comparison and swap changes what the board draws; an insertion's own end adds nothing
    // beyond them, so pausing there would repeat the step before.
    expect(runs['insert.compare']).toEqual({ runs: 6, drawn: 6 });
    expect(runs['insert.swap']).toEqual({ runs: 5, drawn: 5 });
    expect(runs['insert']).toEqual({ runs: 3, drawn: 0 });
  });

  it('take a leaf’s accumulating, which has no pauses inside it, as on', () => {
    expect(
      pausesOf(insertion.pauses, {
        'pause@insert': 'off',
        'pause@insert.compare.left': 'accumulate',
        'pause@insert.compare': 'on',
        'pause@insert.compare.right': 'off',
        'pause@insert.swap': 'accumulate',
        'pause@insert.swap.from': 'off',
        'pause@insert.swap.to': 'off'
      })
    ).toEqual(
      new Map([
        ['guard', 'on'],
        ['insert.compare', 'on'],
        ['insert.compare.left', 'on'],
        ['insert.guard', 'on'],
        ['insert.swap', 'accumulate'],
        ['onward', 'on'],
        ['setup', 'on']
      ])
    );
  });

  it('keys a label’s place by its full name only', () => {
    const { space, starter } = insertion.design;
    expect(space['Highlight.Pointed@insert.compare.left.fill']).toBeDefined();
    expect(space['Highlight.Pointed@left.fill']).toBeUndefined();
    const chosen = { 'Highlight.Pointed@left.fill': 'sky-100' };
    expect(() => buildVariant(space, starter, { chosen }, 1)).toThrow();
  });
});

describe('places', () => {
  const source = (view: string, algorithm = '@run[let i = Index(1); let key = Int(2);]') =>
    `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int); const Index = index(Values);</script><script input>const values = Values([5, 2]);</script><script algorithm>${algorithm}</script><View of="Int" name="IntCell"><Node value={this} /></View><View of="Int" name="IntTally"><Node>{'•'.repeat(this)}</Node></View>{#snippet Cells()}<Node>{#each values as v}{v}{/each}</Node>{/snippet}${view}`;

  it('refuses a view rendered by its own name, naming its type', () => {
    expect(() =>
      prepareSvelteComponent(
        source(
          '{#snippet Key()}<Node>{@render IntTally(key)}</Node>{/snippet}<Layout name="Main"><Node>{@render Key()}</Node></Layout>'
        )
      )
    ).toThrow(
      "{@render IntTally(…)} names the view IntTally, but which view draws a value is the variant's: write the value in braces, as {…}, drawn by the view views.Int chooses"
    );
  });

  it("gives a render with an argument its own choice of view and paint, falling back to its type's", () => {
    const view =
      '{#snippet Key()}<Node>{key}</Node>{/snippet}<Layout name="Main"><Node>{@render Cells()}{@render Key()}</Node></Layout>';
    const prepared = prepareSvelteComponent(source(view));
    const { space, starter, renders, fallbacks } = prepared.design;
    expect(space['views.Int@key']).toEqual(['IntCell', 'IntTally', 'none']);
    expect(starter['views.Int@key']).toBe('IntCell');
    expect(fallbacks['views.Int@key']).toBe('views.Int');
    expect(space['IntTally@key.fill']).toBeDefined();
    expect(space['IntCell@v.color']).toBeDefined();
    // The editor's marker after the render names the place's own choice.
    expect(Object.values(renders)).toContain('views.Int@key');
    // A value in braces at the place calls its alias in place of its type, writing nothing beside it.
    expect(prepared.component).toMatch(/\$\.get\(__place\d+\), \(\) => \$\$props\.key/u);
    expect(prepared.component).not.toMatch(/from_(?:html|svg)\(`[^`]*__place/u);
  });

  it('draws a value in braces by its type, refusing its view written as a render of the type', () => {
    expect(() =>
      prepareSvelteComponent(
        source(
          '{#snippet Key()}<Node>{@render Int(key)}</Node>{/snippet}<Layout name="Main"><Node>{@render Key()}</Node></Layout>'
        )
      )
    ).toThrow('{@render Int(key)} is written {key}: a value in braces draws its type');
  });

  it('draws a union value by its member’s view, refusing a view of the union', () => {
    const union = (views: string) =>
      `<script domain>const Steps = type("integer", { min: 0, max: 9 }); const None = type(["none"]); const Dist = union(Steps, None); const Dists = collection(Dist);</script><script input>const dists = Dists([0, "none"]);</script><script algorithm>@run[const d = dists[1];]</script>${views}<Layout name="Main"><Node>{#each dists as d}{d}{/each}</Node></Layout>`;
    const prepared = prepareSvelteComponent(
      union(
        '<View of="Steps" name="StepsCell"><Node value={this} /></View><View of="None" name="NoneMark"><Node>–</Node></View>'
      )
    );
    expect(prepared.design.space['views.Steps']).toEqual(['StepsCell', 'none']);
    expect(prepared.design.space['views.None']).toEqual(['NoneMark', 'none']);
    expect(() =>
      prepareSvelteComponent(union('<View of="Dist" name="DistCell"><Node value={this} /></View>'))
    ).toThrow('DistCell views Dist, a union, whose values are drawn by their member');
  });

  it('refuses a label and a variable a place would share', () => {
    expect(() =>
      prepareSvelteComponent(
        source(
          '{#snippet Shown()}<Node>{key} {@key}</Node>{/snippet}<Layout name="Main"><Node>{@render Shown()}</Node></Layout>',
          '@shown[let key = Int(2); const picked = @key[values[0]];]'
        )
      )
    ).toThrow('rename the label');
  });
});

describe('nodes and references', () => {
  const domain = `<script domain>
  const Name = type(['A', 'B', 'C']);
  const Flag = type('boolean');
  const End = type(['end']);
  const ListNode = record({ name: Name, next: Next });
  const NodeRef = ref(ListNode);
  const Next = union(NodeRef, End);
</script>
<script input>
  const head = NodeRef(ListNode({ name: 'A', next: NodeRef(ListNode({ name: 'B', next: End('end') })) }));
</script>
<script algorithm>
  @run[let prev = Next(End('end'));
  let cur = Next(head);]
  while (@guard[cur !== 'end']) @rewire{
    const after = cur.next;
    cur.next = prev;
    prev = cur;
    cur = after;
  }
</script>
<View of="Name" name="NameCell"><Node value={this} /></View>
<View of="End" name="EndMark"><Node>∅</Node></View>
<View of="NodeRef" name="Here"><Pointed /></View>`;
  const heap = `{#snippet Heap()}<Node layout="free" flow="x">{#each all(ListNode) as n}{n}{/each}</Node>{/snippet}<Layout name="Main"><Node>{@render Heap()}{cur}</Node></Layout>`;
  const box = `<View of="ListNode" name="NodeBox"><Node layout="row">{this.name}<Link to={this.next} /></Node></View>`;

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
      `${box}{#snippet Heap()}<Node layout="free">{#each all(Name) as n}{n}{/each}</Node>{/snippet}<Layout name="Main"><Node>{@render Heap()}</Node></Layout>`,
      /all\(Name\) draws every live node of a record a reference refers to, and Name is not one/
    ],
    [
      'a link with no from outside a view',
      `{#snippet Heap()}<Node layout="free"><Link to={cur} /></Node>{/snippet}<Layout name="Main"><Node>{@render Heap()}</Node></Layout>`,
      /A <Link> with no from starts at the element its view draws/
    ]
  ])('refuses %s', (_name, markup, message) => {
    expect(() => prepareSvelteComponent(`${domain}${markup}`)).toThrow(message);
  });
});

describe('the view reaching the code only through labels', () => {
  const swaps = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values([5, 2, 4, 1]);
</script>
<script algorithm>
  for (@setup[let i = Position(1)]; @guard[i < values.length]; @onward[i++]) @insert{
    let j = i;
    while (@guard[Position(0) < j] && @compare[(values[j - 1]) > values[j]]) @swap{
      const moved = values[@from[j - 1]];
      values[j - 1] = values[@to[j]];
      values[j] = moved;
      j--;
    }
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Position" name="Highlight"><Pointed /></View>
{#snippet Cells()}
  <Node layout="row">
    {#each values as v}{v}{/each}
    <Link from={@insert.swap.from} to={@insert.swap.to} />
  </Node>
{/snippet}

<Layout name="Main">
  <Node>
    {@render Cells()}
  </Node>
</Layout>`;

  it('take labels giving positions as a link’s ends, hiding it where either gave none', async () => {
    const prepared = prepareSvelteComponent(swaps);
    expect(Object.values(prepared.labelled ?? {}).map(({ label }) => label)).toEqual([
      'insert.swap.from',
      'insert.swap.to'
    ]);
    const { javascript } = await bundlePresentation(prepared, 1);
    expect(javascript).toContain('__reads');
  });

  it('ask a node joining links for its layout, unless it runs as a collection', () => {
    // A collection's {#each} beside links runs as the collection.
    expect(() =>
      prepareSvelteComponent(swaps.replace('<Node layout="row">\n    {#each', '<Node>\n    {#each'))
    ).not.toThrow();
    expect(() =>
      prepareSvelteComponent(
        swaps.replace(
          '<Node layout="row">\n    {#each values as v}{v}{/each}',
          '<Node>\n    {values[0]}{values[1]}'
        )
      )
    ).toThrow('A <Node> joining links needs a layout: layout="free" for a linked structure');
  });

  it('leave a link with no from in a field’s view to the free layout, the field joining none', () => {
    // A binary search tree whose fields render a view holding <Link to={value} />: the link leaves
    // the element the view draws for the tree's free layout, so a field needs no layout of its own.
    const unlaid = bst.replaceAll('<Node layout="row"><Node>', '<Node><Node>');
    expect(unlaid).not.toContain('<Node layout="row"><Node>L');
    expect(() => prepareSvelteComponent(unlaid)).not.toThrow();
  });

  it('refuse a link in a pointer view, which draws inside the element it marks', () => {
    expect(() =>
      prepareSvelteComponent(
        swaps
          .replace(
            '<View of="Position" name="Highlight"><Pointed /></View>',
            '<View of="Position" name="Highlight"><Pointed /><Link from={this} to={this} /></View>'
          )
          .replace('{@render Cells()}', '{@render Cells()}\n{@insert.swap.to}')
      )
    ).toThrow(
      'Highlight is a pointer view, drawn inside the element it marks, so its <Link> joins'
    );
  });

  it('refuse arithmetic on a label in the view, which draws only what the algorithm computed', () => {
    expect(() =>
      prepareSvelteComponent(
        swaps.replace(
          '<Link from={@insert.swap.from} to={@insert.swap.to} />',
          '<Link from={@insert.swap.to} to={(@insert.swap.to - 1)} />'
        )
      )
    ).toThrow('The view reads @insert.swap.to itself');
  });
});

describe('<When of="@label">', () => {
  const caption = (block: string) => `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values([5, 2, 4, 1]);
</script>
<script algorithm>
  for (@setup[let i = Position(1)]; @guard[i < values.length]; @onward[i++]) @pass{
    @look[const seen = @read[values[i]];]
  }
  @finish[const last = Position(0);]
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
{#snippet Caption()}<Node>Looking</Node>{/snippet}
{#snippet Board()}
  <Node layout="column">
    <Node>{#each values as v}{v}{/each}</Node>
    ${block}
  </Node>
{/snippet}
<Layout name="Main">
  <Node>
    {@render Board()}
  </Node>
</Layout>`;

  it('takes start and end for the first and the last step, start chained with a label', () => {
    const prepared = prepareSvelteComponent(
      caption(
        '<OneOf><When of="start">{@render Caption()}</When><When of="@pass">{@render Caption()}</When></OneOf><When of="end">{@render Caption()}</When>'
      )
    );
    expect(Object.values(prepared.during ?? {})).toEqual(['#start', 'pass', '#end']);
    // The last step ends the finishing statement, so the two would show at one step.
    expect(() =>
      prepareSvelteComponent(
        caption(
          '<OneOf><When of="@finish">{@render Caption()}</When><When of="end">{@render Caption()}</When></OneOf>'
        )
      )
    ).toThrow('branches @finish and end would both show');
  });

  it('takes a run of statements in a row to its last, the labels inside it included', () => {
    const rows = caption('').replace(
      /<script algorithm>[\s\S]*?<\/script>/u,
      `<script algorithm>
  @scan[
    @begin[let i = Position(1);]
    while (@guard[i < values.length]) @step{
      i++;
    }
  ]
</script>`
    );
    const chain = (block: string) =>
      rows.replace('<Node>{#each values', `${block}\n    <Node>{#each values`);
    // Every pass of the loop is inside the run of @scan, so the two branches would show together.
    expect(() =>
      prepareSvelteComponent(
        chain(
          '<OneOf><When of="@scan.step">{@render Caption()}</When><When of="@scan">{@render Caption()}</When></OneOf>'
        )
      )
    ).toThrow('branches @scan.step and @scan would both show');
  });

  it('takes any label, a statement’s or an expression’s, keeping every position', () => {
    for (const label of ['@pass.look', '@pass.look.read', '@pass']) {
      const prepared = prepareSvelteComponent(
        caption(`<When of="${label}">{@render Caption()}</When>`)
      );
      expect(Object.values(prepared.during ?? {})).toEqual([label.slice(1)]);
    }
    // A problem after the block points where it is written.
    const source = caption('<When of="@pass.look">{@render Caption()}</When><Bad />');
    const before = source.slice(0, source.indexOf('<Bad />')).split('\n');
    expect(() => prepareSvelteComponent(source)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('<Bad> is not allowed'),
        line: before.length,
        column: before.at(-1)!.length + 1
      })
    );
  });

  it('refuses {#if} on a label, an {:else}, an of naming no label, when(), and a view', () => {
    expect(() =>
      prepareSvelteComponent(caption('{#if @pass.look.read}{@render Caption()}{/if}'))
    ).toThrow(
      '{#if @pass.look.read} would choose what to draw by the label\'s value, which a view never does: <When of="@pass.look.read">…</When> draws its contents at each step inside a run of the label.'
    );
    expect(() =>
      prepareSvelteComponent(
        caption('<When of="@pass">{@render Caption()}{:else}{@render Caption()}</When>')
      )
    ).toThrow('A <When> has no {:else}');
    expect(() =>
      prepareSvelteComponent(caption('<When of="step">{@render Caption()}</When>'))
    ).toThrow('<When of="step"> is no <When>: ');
    expect(() =>
      prepareSvelteComponent(caption('{#if when(@pass) && values}{@render Caption()}{/if}'))
    ).toThrow('when() is not written in a view: write <When of="@insert.swap">…</When>');
    expect(() =>
      prepareSvelteComponent(
        caption('{values[0]}').replace(
          '<View of="Int" name="IntCell"><Node value={this} /></View>',
          '<View of="Int" name="IntCell"><Node value={this} /><When of="@pass"><Node>!</Node></When></View>'
        )
      )
    ).toThrow('<When of="@pass"> is in a view, which draws only its value');
  });
});

describe('<OneOf> branches', () => {
  const chain = (block: string) => `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values([5, 2, 4, 1]);
</script>
<script algorithm>
  for (@setup[let i = Position(1)]; @guard[i < values.length]; @onward[i++]) @pass{
    @look[const seen = values[i];]
    @note[const again = values[i];]
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
{#snippet Looking()}<Node>Looking</Node>{/snippet}
{#snippet Noting()}<Node>Noting</Node>{/snippet}
{#snippet Board()}
  <Node layout="column">
    <Node>{#each values as v}{v}{/each}</Node>
    ${block}
  </Node>
{/snippet}
<Layout name="Main">
  <Node>
    {@render Board()}
  </Node>
</Layout>`;
  const looking =
    '<OneOf><When of="@pass.look">{@render Looking()}</When><When of="@pass.note">{@render Noting()}</When></OneOf>';

  it('takes a branch per label, keeping every position', () => {
    const prepared = prepareSvelteComponent(chain(looking));
    expect(Object.values(prepared.during ?? {})).toEqual(['pass.look', 'pass.note']);
    // A problem after the chain points where it is written.
    const source = chain(`${looking}<Bad />`);
    const before = source.slice(0, source.indexOf('<Bad />')).split('\n');
    expect(() => prepareSvelteComponent(source)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('<Bad> is not allowed'),
        line: before.length,
        column: before.at(-1)!.length + 1
      })
    );
  });

  it('refuses branches shown at one step and an {:else}, and takes labels of any length', () => {
    expect(() =>
      prepareSvelteComponent(
        chain(
          '<OneOf><When of="@pass">{@render Looking()}</When><When of="@pass.look">{@render Noting()}</When></OneOf>'
        )
      )
    ).toThrow(
      "The <OneOf>'s branches @pass and @pass.look would both show at @pass.look#1, @pass.look#2, @pass.look#3, inside runs of both"
    );
    expect(() =>
      prepareSvelteComponent(
        chain(looking.replace('</When></OneOf>', '{:else}<Node>!</Node></When></OneOf>'))
      )
    ).toThrow('A <When> has no {:else}');
    // A <OneOf> holds only its branches.
    expect(() =>
      prepareSvelteComponent(chain(looking.replace('</When><When', '</When><Node>!</Node><When')))
    ).toThrow('A <OneOf> holds only its <When> branches');
    // A label of any length, as @n.
    const short = chain(looking.replace('of="@pass.note"', 'of="@pass.n"')).replace(
      '@note[',
      '@n['
    );
    expect(Object.values(prepareSvelteComponent(short).during ?? {})).toEqual([
      'pass.look',
      'pass.n'
    ]);
  });
});

describe('the bundle', () => {
  it('embeds each value once where steps share it, so pausing at many labels fits', async () => {
    // Dijkstra on five vertices as an assistant wrote it, paused at every label but its loops' parts
    // and two of its tests, within a variant's 200 steps: each step's state repeating the variant
    // made it more than 2 MB.
    const prepared = prepareSvelteComponent(dijkstra);
    const quiet =
      /(first|more|next)(Round|Rounds|Vertex|Vertices|Edge|Edges)$|\.(closer|outgoing)$/u;
    const everyPause = Object.fromEntries(
      Object.keys(prepared.design.space)
        .filter((key) => key.startsWith('pause@') && !quiet.test(key))
        .map((key) => [key, 'on'])
    );
    const { javascript, labels } = await bundlePresentation(prepared, 1, { chosen: everyPause });
    expect(labels.length).toBeGreaterThan(100);
    expect(javascript.length).toBeLessThan(1024 * 1024);
  });
});

describe('references read in the view', () => {
  it('read a field through a reference from its node in the heap', () => {
    // queue holds references to vertices; q.name reads the name of the vertex q refers to.
    const prepared = prepareSvelteComponent(bfsReferences);
    expect(prepared.component).toContain("$$props['ȟVertex'][$.get(q)].name");
  });

  it('refuse a reference to a node drawn as a value, its place in the heap', () => {
    const drawn = bfsReferences.replace(
      '<View of="VertexRef" name="Marked"><Pointed /></View>',
      '<View of="VertexRef" name="Marked"><Pointed /></View>\n<View of="VertexRef" name="RefCard"><Node value={this} /></View>'
    );
    expect(drawn).toContain('RefCard');
    expect(() => prepareSvelteComponent(drawn)).toThrow(
      'A VertexRef refers to a Vertex and has no value of its own to show'
    );
  });
});

describe('at(p), the element a position points at', () => {
  const graph = (markup: string, more = '') =>
    `<script domain>
  const Name = type(['A', 'B', 'C']);
  const Seen = type('boolean');
  const Vertex = record({ name: Name, seen: Seen });
  const Vertices = collection(Vertex);
  const VertexRef = index(Vertices);
  const Queue = collection(VertexRef);
  const Edge = record({ from: VertexRef, to: VertexRef });
  const Edges = collection(Edge);
  const Int = type('integer', { min: 0, max: 9 });${more}
</script>
<script input>
  const vertices = Vertices([{ name: 'A', seen: true }, { name: 'B', seen: false }, { name: 'C', seen: false }]);
  const edges = Edges([{ from: 0, to: 1 }, { from: 1, to: 2 }]);
  const queue = Queue([1, 2]);
  const n = Int(1);
</script>
<script algorithm></script>
<View of="Name" name="NameText"><Node value={this} /></View>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Vertex" name="VertexCard"><Node layout="column">{this.name}</Node></View>
${markup}`;

  it('reads the element in a view of a position, and through a position in a part', () => {
    const { component } = prepareSvelteComponent(
      graph(
        `<View of="VertexRef" name="VertexName">{at(this).name}</View>
{#snippet Queued()}<Node>{#each queue as q}{q}{/each}</Node>{/snippet}
{#snippet Ends()}<Node>{#each edges as edge}{at(edge.from).name}{at(edge.to)}{/each}</Node>{/snippet}
<Layout name="Main"><Node>{@render Queued()}{@render Ends()}</Node></Layout>`
      )
    );
    // The element, as vertices[p], and nothing past either end.
    expect(component).toMatch(/vertices\[þhis\(\)\]\?\.name/u);
    expect(component).toMatch(/vertices\[þhis\(\)\] === undefined/u);
    expect(component).toMatch(/vertices\[[^\]]*edge[^\]]*\.from[^\]]*\]\?\.name/u);
    expect(component).toMatch(/vertices\[[^\]]*edge[^\]]*\.to[^\]]*\]/u);
    // Drawn as read through the position, inside a slot naming it: edge.from's, as at="from".
    expect(component).toMatch(/through: true/u);
    expect(component).toMatch(/at: ['"]from['"]/u);
  });

  it('refuses a field read on a position, a field the element lacks, and at() of no position', () => {
    const problem = (markup: string) => {
      try {
        prepareSvelteComponent(
          graph(`${markup}<Layout name="Main"><Node>{@render Shown()}</Node></Layout>`)
        );
      } catch (error) {
        return error as { code?: string; message: string };
      }
      return undefined;
    };
    expect(problem('{#snippet Shown()}<Node>{queue[0].name}</Node>{/snippet}')).toMatchObject({
      code: 'view_position',
      message: expect.stringContaining(
        'read the element it points at with at(), as at(queue[0]).name'
      )
    });
    expect(
      problem('{#snippet Shown()}<Node>{at(queue[0]).weight}</Node>{/snippet}')?.message
    ).toContain('A Vertex has no field weight; its fields are name, seen.');
    expect(problem('{#snippet Shown()}<Node>{at(n)}</Node>{/snippet}')?.message).toContain(
      'at(n) reads through a position, and n is of type Int'
    );
  });
});

describe('step limits', () => {
  // Three passes of a hundred steps, each with its test and its move: over 900 pausing at every
  // label, more than one presentation shows.
  const long = `<script domain>
  const Int = type('integer', { min: 0, max: 200 });
  const Flag = type('boolean');
</script>

<script algorithm>
  @run[let n = Int(0);]
  for (@setup[let i = Int(0)]; @guard[i < 3]; @onward[i++]) @pass{
    for (@from[let j = Int(0)]; @more[j < 100]; @next[j++]) @step[n = j + 1;]
  }
</script>

<View of="Int" name="IntCell"><Node value={this} /></View>

<Layout name="Main">
  <Node>{n}</Node>
</Layout>
`;

  it('builds a variant pausing at fewer labels, and says where to pause less over the limit', async () => {
    const prepared = prepareSvelteComponent(long);
    expect(prepared.steps.length).toBeGreaterThan(300);
    const quiet = ['setup', 'guard', 'onward', 'pass.from', 'pass.more', 'pass.next', 'pass.step'];
    const passes = await bundlePresentation(prepared, 1, {
      chosen: Object.fromEntries(quiet.map((label) => [`pause@${label}`, 'off']))
    });
    expect(passes.labels.length).toBeLessThanOrEqual(5);
    await expect(bundlePresentation(prepared, 1)).rejects.toThrow(
      /variant shows more than 200 steps, most at the end of @pass\.step/
    );
  });
});

describe('kinds named by nodes', () => {
  const domain = '<script domain>const Int = type([1, 3]);</script>';
  const algorithm = '<script algorithm>@run[let i = Int(1);]</script>';
  const component = (view: string) =>
    prepareSvelteComponent(
      `${domain}${algorithm}<View of="Int" name="IntText"><Node value={this} /></View>${view}`
    );

  it('gives a node with kind, and the nodes inside it, the kind within its snippet', () => {
    const prepared = component(
      '{#snippet Table()}<Node layout="row"><Node kind="Header">a</Node><Node kind="Header"><Node>b</Node></Node><Node>{i}</Node></Node>{/snippet}<Layout name="Main"><Node><Node kind="Note">n</Node>{@render Table()}</Node></Layout>'
    );
    const kinds = new Set(
      Object.keys(prepared.design.space)
        .filter((key) => /^(Table|Main\.Note)/u.test(key))
        .map((key) => key.slice(0, key.lastIndexOf('.')))
    );
    expect([...kinds].sort()).toEqual(['Main.Note', 'Table', 'Table.Header']);
    expect(prepared.component).not.toContain('kind="');
  });

  it.each([
    ['a computed kind', '<Node kind={"Header"}>a</Node>', /written as it is, not computed/],
    ['a kind not in one capitalised word', '<Node kind="header">a</Node>', /is no kind/],
    ["a snippet's name", '<Node kind="Table">a</Node>', /kind="Table" has a snippet's name/],
    ["a layout's name", '<Node kind="Main">a</Node>', /kind="Main" has a layout's name/],
    ["a type's name", '<Node kind="Int">a</Node>', /kind="Int" has the name of a type/]
  ])('refuses %s', (_name, node, message) => {
    expect(() =>
      component(
        `{#snippet Table()}<Node>${node}</Node>{/snippet}<Layout name="Main"><Node>{@render Table()}</Node></Layout>`
      )
    ).toThrow(message);
  });

  it("refuses a kind on a layout's root node, its frame", () => {
    expect(() => component('<Layout name="Main"><Node kind="Page">{i}</Node></Layout>')).toThrow(
      /root <Node> of the layout Main is the frame/
    );
  });
});

describe('props bound to a view’s value', () => {
  const domain =
    "<script domain>const Flag = type('boolean'); const Level = type('integer', { min: 0, max: 3 }); const Wide = type('integer', { min: 0, max: 99 }); const Card = record({ seen: Flag, level: Level });</script>";
  const algorithm =
    '<script algorithm>@run[let card = Card({ seen: false, level: 1 }); let wide = Wide(5);]</script>';
  const component = (views: string, page = '<Node>{card}</Node>') =>
    prepareSvelteComponent(
      `${domain}${algorithm}<View of="Flag" name="FlagText"><Node value={this} /></View><View of="Level" name="LevelText"><Node value={this} /></View><View of="Wide" name="WideText"><Node value={this} /></View>${views}<Layout name="Main">${page}</Layout>`
    );

  it('gives each value of an unordered domain its own option, false the plainest', () => {
    const { design } = component(
      '<View of="Card" name="CardBox"><Node fill={this.seen}>{this.level}</Node></View>'
    );
    expect(design.space['CardBox.fill@true']).toContain('blue-200');
    expect(design.starter).toMatchObject({
      'CardBox.fill@false': 'neutral-200',
      'CardBox.fill@true': 'blue-200'
    });
  });

  it('maps an ordered domain onto an ordered prop in order, from a first option', () => {
    const { design } = component(
      '<View of="Card" name="CardBox"><Node textSize={this.level}>{this.level}</Node></View>'
    );
    expect(design.space['CardBox.textSize@from']).toEqual([12, 14, 16, 18, 20, 24]);
    expect(design.space['CardBox.textSize@order']).toEqual(['up', 'down']);
    expect(design.starter).toMatchObject({
      'CardBox.textSize@from': 16,
      'CardBox.textSize@order': 'up'
    });
  });

  it.each([
    [
      'a constant look',
      '<View of="Card" name="CardBox"><Node fill={1}>{this.level}</Node></View>',
      /reads nothing of the view's value/
    ],
    [
      'more values than options',
      '<View of="Wide" name="WideBox"><Node opacity={this}>w</Node></View>',
      /can take 100 values, and opacity tells apart 4/
    ],
    [
      'a number on a prop without order',
      '<View of="Card" name="CardBox"><Node font={this.level}>{this.level}</Node></View>',
      /a number, whose values run in order, and font's options do not/
    ],
    [
      'values unknown before the run',
      '<View of="Card" name="CardBox"><Node opacity={this.seen ? Math.random() : 1}>{this.level}</Node></View>',
      /cannot be known before the algorithm runs/
    ]
  ])('refuses %s', (_, views, message) => {
    expect(() => component(views)).toThrow(message);
  });

  it('keeps a look outside a view the design’s', () => {
    expect(() => component('', '<Node><Node fill={card.seen}>x</Node>{card}</Node>')).toThrow(
      /fill is a look, which the design gives every kind of node/
    );
  });
});

describe('grids', () => {
  const domain = '<script domain>const Int = type([1, 3]);</script>';
  const algorithm = '<script algorithm>@run[let i = Int(1);]</script>';
  const component = (view: string) =>
    prepareSvelteComponent(
      `${domain}${algorithm}<View of="Int" name="IntText"><Node value={this} /></View>${view}`
    );
  const table = (grid: string) =>
    component(
      `{#snippet Table()}${grid}{/snippet}<Layout name="Main"><Node>{@render Table()}</Node></Layout>`
    );

  it('places each of a grid’s nodes by row and col, the grid’s kind arranging them', () => {
    const prepared = table(
      '<Node layout="grid"><Node kind="Header" row={0} col={1}>a</Node>{#each [1, 3] as v, j}<Node row={1} col={j}>{v}</Node>{/each}</Node>'
    );
    expect(prepared.design.space['Table.justify']).toBeDefined();
    expect(prepared.design.space['Table.Header.fill']).toBeDefined();
  });

  it.each([
    [
      'a node without col',
      '<Node layout="grid"><Node row={0}>a</Node></Node>',
      /placed by its row and col/
    ],
    [
      'row and col outside a grid',
      '<Node layout="row"><Node row={0} col={0}>a</Node></Node>',
      /row and col place a node in a grid/
    ],
    ['text in a grid', '<Node layout="grid">a</Node>', /A grid holds only nodes/],
    ['a value in a grid', '<Node layout="grid">{i}</Node>', /A grid holds only nodes/],
    [
      'a computed grid',
      '<Node layout={i > 1 ? "grid" : "row"}><Node>a</Node></Node>',
      /written as layout="grid", not computed/
    ]
  ])('refuses %s', (_name, grid, message) => {
    expect(() => table(grid)).toThrow(message);
  });
});
