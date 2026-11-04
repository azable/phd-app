import { describe, expect, it } from 'vitest';

import { stepPlaces } from '$lib/shared/presentations';

import type { MasterStep, PauseMode } from './algorithm/interpret.server';
import {
  bundlePresentation,
  compileSvelteComponent as compileCurrent,
  InvalidSvelteSourceError,
  pausesOf,
  prepareSvelteComponent as prepareCurrent
} from './compile.server';
import { currentForm } from './testing/legacy-sources';

// Sources built from pieces here are written with parts as snippets; each is read in the current
// form, its parts layouts declaring what they read (see testing/legacy-sources.ts).
const prepareSvelteComponent = (source: string) => prepareCurrent(currentForm(source));
const compileSvelteComponent = (...[source, ...rest]: Parameters<typeof compileCurrent>) =>
  compileCurrent(currentForm(source), ...rest);
import { linearSearchSource } from './contract';
import bfsReferences from './fixtures/bfs-references.sverlin?raw';
import bst from './fixtures/bst.sverlin?raw';
import dijkstra from './fixtures/dijkstra.sverlin?raw';
import heapTree from './fixtures/heap-tree.sverlin?raw';
import listMarkers from './fixtures/list-markers.sverlin?raw';
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
      '<script domain>const Int = type("integer", { min: 0, max: 9 });</script><script algorithm>@run[let n = Int(0);] @a[n = Int(1);] @b[n = Int(2);]</script><View of="Int" name="IntCell"><Node value={this} /></View>\n<Layout name="S"><Node>n</Node></Layout><Layout name="Main" of="n"><Node><S />{n}</Node></Layout>'
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
        '<script input>const x = 1;</script><Layout name="X"><Node>x</Node></Layout><Layout name="Main"><Node><X /></Node></Layout>'
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
      '<script domain>const Int = type("integer", { min: -100, max: 1000 });</script>\n<script algorithm>\n  @run[let i = 0;]\n\n</script>\n<Layout name="A"><Node shape="circle">v1</Node></Layout>\n<Layout name="B"><Node class="x" /></Layout>\n<Layout name="Main"><Node><A /><B /></Node></Layout>'
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
        '<script algorithm></script>\n<Layout name="A"><Node>a</Node></Layout>\n<Layout name="B"><Node tags="b">b</Node></Layout>\n<Layout name="Main"><Node><A /><B /></Node></Layout>'
      )
    ).rejects.toMatchObject({
      code: 'unknown_prop',
      line: 3,
      message: expect.stringContaining('its kind is the view or layout it is in')
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
        '<script domain>const Int = type("integer", { min: -100, max: 1000 }); const Values = collection(Int, { max: 8 });</script>\n<script input>\n  const values = Values([3, "x"]);\n</script>\n<script algorithm>\n  @run[let i = 0;]\n\n</script>'
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
      '<script domain>const Int = type("integer", { min: -100, max: 1000 });</script><script algorithm>\n  @run[let x = Int(1);\n\n  x = missing;]\n</script><Layout name="Main" of="x"><Node><Node>{x}</Node></Node></Layout>';
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
        '<Layout name="Hi"><Node>Hi</Node></Layout><Layout name="Main"><Node><Hi /></Node></Layout>'
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
      '<script algorithm></script><Layout name="X"><Node>x</Node></Layout><Layout name="Main"><Node><X /></Node></Layout>'
    );
    // Its one scene reads no state, so it is one frame, named by the scene.
    expect(withoutModuleScript.labels).toEqual(['main']);
    expect(withoutModuleScript.javascript).toContain('sv-node');
  });

  it('puts every recorded value in scope for a script-free view', async () => {
    const result = await compileSvelteComponent(
      '<script domain>const Int = type("integer", { min: -100, max: 1000 }); const Values = collection(Int, { max: 8 }); const Index = index(Values); const Flag = type("boolean");</script><script input>const values = Values([4, 9]);</script>\n<script algorithm>@start[let total = Int(0);]\nfor (@first[let i = Index(0)]; @more[i < values.length]; @next[i++]) {\n  @add[total = total + values[i];]\n}</script>\n<Layout name="Sum" of="total, values"><Node layout="column">{@const doubled = total * 2}<Node>{values.join("+")} = <Node value={total} />; doubled {doubled}</Node></Node></Layout><Layout name="Main" of="total, values"><Node><Sum total={total} values={values} /></Node></Layout>',
      5
    );
    // The input as given, the start, and a step per addition; the loop's end only drops v, so it
    // is no step.
    expect(result.labels).toEqual(['start', '@start#1', '@add#1', '@add#2']);
    expect(result.variant['Sum.fill']).toBeDefined();
  });

  it('gives every kind of node, the snippet it is in, the variables its role has', () => {
    const { design } = prepareSvelteComponent(
      `<script domain>const Int = type([1, 3]); const Values = collection(Int, { max: 8 }); const Position = index(Values);</script><script input>const values = Values([1, 3]);</script><script algorithm>@run[let i = Position(0); let j = Position(1);]</script><View of="Int" name="IntCell"><Node value={this} /></View>\n<View of="Position" name="Arrow"><Node layout="column"><Pointed /><Node kind="Name">i</Node></Node></View>\n<View of="Position" name="Mark"><Pointed /></View>\n<Layout name="Cells" of="values"><Node layout="row">{#each values as v}{v}{/each}</Node></Layout><Layout name="Note"><Node>note</Node></Layout><Layout name="Pair" of="values, i, j"><Node layout="free">{#each values as v}{v}{/each}<Link from={i} to={j} /></Node></Layout><Layout name="Main" of="i, values, j"><Node><Cells values={values} />{i}<Note /><Pair values={values} i={i} j={j} /></Node></Layout>`
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
      '<Layout name="T"><Node tags="title">x</Node></Layout><Layout name="Main"><Node><T /></Node></Layout>',
      /takes no tags/
    ],
    [
      'a node at the top level, beside the layouts',
      '<Layout name="T"><Node>t</Node></Layout><Node>x</Node><Layout name="Main"><Node><T /></Node></Layout>',
      /The top level holds only views and layouts/
    ],
    [
      'text in a layout, outside a node',
      '<Layout name="Main"><Node>Linear search</Node></Layout>',
      /Text outside a <Node> cannot be selected/
    ],
    [
      'a render of a snippet worked out as the view runs',
      '<Layout name="A"><Node>a</Node></Layout><Layout name="B"><Node>b</Node></Layout><Layout name="Main"><Node>{@render (1 > 0 ? A : B)()}</Node></Layout>',
      /drawn by its tag where it is written/
    ],
    [
      'a kind named as a layout',
      '<Layout name="A"><Node><Node kind="U">x</Node></Node></Layout><Layout name="U"><Node>y</Node></Layout><Layout name="Main"><Node><A /><Node kind="U">x</Node></Node></Layout>',
      /kind="U" has a layout's name/
    ],
    [
      'a snippet taking a parameter without a type',
      '{#snippet A(x)}<Node>{x}</Node>{/snippet}<Layout name="Main"><Node>{1}</Node></Layout>',
      /A takes a value, as only a view does/
    ]
  ])('rejects %s', async (_name, markup, message) => {
    await expect(compileSvelteComponent(`<script algorithm></script>${markup}`)).rejects.toThrow(
      message
    );
  });

  it('rejects a <Pointed> and a node of one kind', () => {
    expect(() =>
      prepareSvelteComponent(
        `<script domain>const Int = type([1, 3]); const Values = collection(Int, { max: 8 }); const Position = index(Values);</script><script input>const values = Values([1, 3]);</script><script algorithm>@run[let i = Position(0);]</script><View of="Position" name="Arrow"><Node layout="column"><Pointed /><Node kind="Pointed">i</Node></Node></View>\n<Layout name="Cells" of="values"><Node layout="row">{#each values as v}<Node value={v} />{/each}</Node></Layout><Layout name="Main" of="i, values"><Node><Cells values={values} />{i}</Node></Layout>`
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

  it('resolves a link end computed from an {#each} index, and refuses one naming no element', () => {
    const source = (link: string) =>
      `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int, { max: 4 });
</script>
<script input>const values = Values([3, 1, 2]);</script>
<script algorithm>@run[let n = Int(1);]</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row">
  <Node layout="row">{#each this as v, k}{v}${link}{/each}</Node>
</View>
<Layout name="Main"><Node>{values}</Node></Layout>`;
    // Arithmetic of one index and numbers is a position in the collection the index walks.
    const { component } = prepareSvelteComponent(source('<Link from={k} to={2 * k + 1} />'));
    expect(component).toContain('__toIn');
    expect(component).toContain('__fromIn');
    // A number written in the view, or arithmetic of two indices, names no element.
    expect(() => prepareSvelteComponent(source('<Link from={k} to={3} />'))).toThrow(
      '<Link to={3}> names no element'
    );
    expect(() =>
      prepareSvelteComponent(source('{#each this as w, j}<Link from={k} to={k + j} />{/each}'))
    ).toThrow('<Link to={k + j}> names no element');
  });

  it("names a view's value this, refusing another name and a this outside a view", () => {
    const source = (markup: string) =>
      `<script domain>const Int = type([1, 3]);</script><script input>const n = Int(1);</script><script algorithm>@run[let i = Int(1);]</script>
${markup}\n<Layout name="Main"><Node>{n}</Node></Layout>`;
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
          '<View of="Int" name="IntCell"><Node value={this} /></View>\n<Layout name="Part"><Node>{this}</Node></Layout>'
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
      `<script domain>const Int = type([1, 3]); const Values = collection(Int, { max: 8 });</script><script input>const values = Values([1, 3]);</script><script algorithm>@run[let i = Int(1);]</script>\n{#snippet V()}${markup}{/snippet}<Layout name="Main"><Node>{@render V()}</Node></Layout>`;
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
        '<script algorithm></script>\n<Layout name="V"><Node>Hi</Node></Layout><Layout name="Main"><Node><V /></Node></Layout>\n<style>div { color: red; }</style>'
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
        '<script domain>const Int = type([1, 3]);</script><script algorithm>@run[let i = Int(1);]</script>\n<View of="Int" name="IntNote">is <Node value={this} /></View>\n<Layout name="V" of="i"><Node>Step {i}</Node>\n<Node>{i}</Node></Layout><Layout name="Main" of="i"><Node><V i={i} /></Node></Layout>'
      )
    ).resolves.toBeDefined();
  });

  it('shows the source’s own listing where the view places a <Listing />, lit per step', async () => {
    const source = [
      '<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int, { max: 8 }); const Index = index(Values); const Flag = type("boolean");</script>',
      '<script input>const values = Values([3, 8]);</script>',
      '<script algorithm>@loop[let last = Index(1); for (@from[let i = Index(0)]; @more[i < values.length]; @step[i++]) { last = i; }]</script>',
      '<script listing="code">for @loop[@from[i = 1] @more[to n] @step[step 1]]</script>',
      '<View of="Index" name="IndexCell"><Node value={this} /></View>\n<Layout name="Cells" of="values"><Node>{#each values as v}<Node value={v} />{/each}</Node></Layout><Layout name="Main" of="last, values"><Node><Listing /><Cells values={values} />{last}</Node></Layout>'
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
        `${blocks}<View of="Int" name="Code"><Node value={this} /><Listing /></View>\n<Layout name="Main"><Node>{n}</Node></Layout>`
      )
    ).toThrow('place <Listing /> outside views');
    expect(() =>
      prepareSvelteComponent(`${blocks}<Layout name="Main"><Node><Listing /></Node></Layout>`)
    ).toThrow("A <Listing /> shows a listing of the source's own");
  });

  it('rejects view scripts and values that shadow library components', async () => {
    await expect(
      compileSvelteComponent(
        '<script algorithm></script>\n\n<script>const x = 1;</script>\n<Layout name="X"><Node>{x}</Node></Layout><Layout name="Main"><Node><X /></Node></Layout>'
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
      `<script domain>const Int = type("integer", { min: -100, max: 1000 }); const Row = collection(Int, { max: 8 }); const Grid = collection(Row, { max: 8 });</script><script input>const grid = Grid([[1, 2], [3, 4]]);</script><script algorithm></script><View of="Int" name="IntCell"><Node value={this} /></View>\n${view}`;
    const result = await compileSvelteComponent(
      source(
        '<Layout name="Rows" of="grid"><Node layout="column">{#each grid as row}<Node>{#each row as v}{v}{/each}</Node>{/each}</Node></Layout><Layout name="Main" of="grid"><Node><Rows grid={grid} /></Node></Layout>'
      )
    );
    expect(result.javascript).toContain('sv-node');
    await expect(
      compileSvelteComponent(
        source(
          '<Layout name="G" of="grid"><Node items={grid} /></Layout><Layout name="Main" of="grid"><Node><G grid={grid} /></Node></Layout>'
        )
      )
    ).rejects.toMatchObject({
      code: 'unknown_prop',
      message: expect.stringContaining('<Node> has no prop items')
    });
  });

  it('marks the node showing a view’s own value with its type, for its unit', async () => {
    const source = (view: string, more = '') =>
      `<script domain>const Int = type("integer", { min: -100, max: 1000 }); const Height = type("integer", { min: -100, max: 1000, unit: "cm" }); const People = collection(Height, { max: 8 });</script><script input>const people = People([150, 170]);</script><script algorithm></script>${view}\n{#snippet Everyone()}<Node>{#each people as person}{person}{/each}</Node>{/snippet}<Layout name="Main"><Node>{@render Everyone()}${more}</Node></Layout>`;
    const view =
      '<View of="Height" name="HeightView"><Node layout="column"><Node value={this} /><Node>tall</Node></Node></View>';
    const prepared = prepareSvelteComponent(source(view));
    expect(prepared.component.match(/__type: 'Height'/g)).toHaveLength(1);
    await expect(
      compileSvelteComponent(
        source(
          `${view}\n{#snippet First()}<Node value={people[0]} type="Height" />{/snippet}`,
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
    ).rejects.toThrow('IntCell takes a value, as only a view does');
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
      '<script algorithm></script><Layout name="One"><Node value={1} /></Layout><Layout name="Main"><Node><One /></Node></Layout>'
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
    await expect(bundlePresentation(prepared, 3, { chosen: { 'One.depth': 2 } })).rejects.toThrow(
      'One has no prop depth'
    );
  });

  it('takes the page frame from the layout’s values in the variant', async () => {
    const prepared = prepareSvelteComponent(
      '<script algorithm></script><Layout name="A"><Node>a</Node></Layout><Layout name="Main"><Node><A /></Node></Layout>'
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
      '<script domain>const Int = type([1, 2]); const Values = collection(Int, { max: 8 }); const Position = index(Values);</script><script input>const values = Values([1, 2]); const i = Position(0); const j = Position(1);</script><script algorithm></script><View of="Int" name="IntCell"><Node value={this} /></View>';
    const nested = prepareSvelteComponent(
      `${algorithm}\n{#snippet Pair()}<Node layout="free">\n  {#each values as v}{v}{/each}\n  {#if true}<Link from={i} to={j} />{/if}\n</Node>{/snippet}<Layout name="Main"><Node>{@render Pair()}</Node></Layout>`
    );
    expect(nested.component).toMatch(/__ref: ['"]4:13['"]/u);
    expect(nested.component).toMatch(/__links: true/u);
    expect(() =>
      prepareSvelteComponent(
        `${algorithm}\n{#snippet Pair()}<Node>{#each values as v}{v}{/each}</Node><Link from={i} to={j} />{/snippet}<Layout name="Main"><Node>{@render Pair()}</Node></Layout>`
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
    expect(component).toMatch(/__ref: ['"]2:18['"]/u);
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
        '<script algorithm></script>\n<Layout name="S"><Node>\n{$state(1)}</Node></Layout><Layout name="Main"><Node><S /></Node></Layout>'
      )
    ).rejects.toMatchObject({ line: 3, column: 2 });
  });

  it('identifies the source by its steps, whatever the view and input', async () => {
    const source = (values: string, view: string) =>
      `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int, { max: 8 });</script><script input>const values = Values(${values});</script><script algorithm>@reverse[const t = values[0]; values[0] = values[1]; values[1] = t;]</script>{#snippet V()}${view}{/snippet}<Layout name="Main"><Node>{@render V()}</Node></Layout>`;
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
    `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int, { max: 8 }); const Position = index(Values);</script><script input>const values = Values([1, 2]);</script><script algorithm>@run[let i = Position(0);]</script><View of="Int" name="IntText"><Node value={this} /></View>\n<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>\n${parts}\n<Layout name="Main"><Node>{values}${renders}</Node></Layout>`;

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
    const caption = '<Layout name="At" of="i"><Node>at {i}</Node></Layout>';
    const text = '<View of="Position" name="PositionText"><Node value={this} /></View>';
    const both = prepareSvelteComponent(
      view(`${text}\n${pointer}\n${caption}`, '{@render At()}{i}')
    );
    expect(both.design.space['views.Position']).toEqual(['PositionText', 'none']);
    expect(both.design.space['pointers.Position']).toEqual(['Highlight', 'none']);
    expect(both.design.starter['pointers.Position']).toBe('Highlight');
    // Each render's variable, by its line:column, for the editor.
    const source = currentForm(view(`${text}\n${pointer}\n${caption}`, '{@render At()}{i}'));
    const siteOf = (needle: string, from = 0) => {
      const at = source.indexOf(needle, from);
      const before = source.slice(0, at);
      return `${before.split('\n').length}:${at - before.lastIndexOf('\n')}`;
    };
    expect(both.design.renders).toMatchObject({
      [siteOf('{i}')]: 'views.Position',
      // The root's own {i}, after the caption's tag passing it.
      [siteOf('{i}', source.indexOf('<At i={i} />') + '<At i={i} />'.length)]: 'pointers.Position'
    });
    expect(both.component).toContain('__sverlinPointers');
    // With only pointer views, the type's choice is its pointers variable all the same.
    const marks = prepareSvelteComponent(view(pointer, '{i}'));
    expect(marks.design.space['pointers.Position']).toEqual(['Highlight', 'none']);
    expect(marks.design.space['views.Position']).toBeUndefined();
    expect(() => prepareSvelteComponent(view(`${pointer}\n${caption}`, '{@render At()}'))).toThrow(
      'or, to show the position as a number here, add a view that draws it, as <View of="Position" name="PositionText"><Node value={this} /></View>'
    );
  });

  it.each([
    [
      '<Pointed> outside a view of an index type',
      '<Layout name="P"><Node><Pointed /></Node></Layout>',
      '<P />',
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
      '<View of="Position" name="Arrow"><Pointed /></View>\n<Layout name="Marks" of="i">{i}</Layout>',
      '{@render Marks()}',
      /rendered at the top of the view, outside blocks other than \{#if\}, as/
    ],
    [
      'a <Pointed> in a snippet inside its pointer view',
      '<View of="Position" name="Arrow"><Node kind="Mark"><Pointed /></Node></View>',
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
      '<View of="Int" name="IntText"><Node value={this} /></View>\n<View of="Int" name="IntPair"><Node layout="row"><Node value={this} /><Node value={this} /></Node></View>\n<Layout name="Main" of="i"><Node>{i}</Node></Layout>'
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
      `<script domain>const Int = type([1, 3]); const Row = collection(Int, { max: 4 });</script><script algorithm>@start[let values = Row([1, 3]);] @grow[values = Row([1, 3, 1]);]</script><View of="Row" name="Search"><Node layout="row">{#each this as value}{value}{/each}</Node></View>\n<View of="Int" name="Plain"><Node value={this} /></View>\n<View of="Int" name="Boxed"><Node layout="row"><Node value={this} /></Node></View>\n<Layout name="Main" of="values"><Node>{values}</Node></Layout>`
    );
    expect(prepared.components.map(({ name }) => name)).toEqual(['Plain', 'Boxed', 'Search']);
    // Plain and Boxed show their value, so they take every value; Search only passes its values to
    // views, which keep their boxes, so it takes one, filled to Row's max, longer than any Row in
    // the trace.
    expect(Object.fromEntries(prepared.components.map(({ name, cases }) => [name, cases]))).toEqual(
      { Plain: [1, 3], Boxed: [1, 3], Search: [[1, 1, 1, 1]] }
    );
  });

  it('draws a record with one value for each field passed only to a view', () => {
    const prepared = prepareSvelteComponent(
      `<script domain>const Vertex = type("integer", { min: 0, max: 5 }); const Weight = type([1, 4, 7]); const Edge = record({ from: Vertex, to: Vertex, weight: Weight });</script><script algorithm></script><View of="Vertex" name="VertexView"><Node value={this} /></View>\n<View of="Edge" name="EdgeView"><Node layout="row">{this.from}{this.to}<Node value={this.weight} /></Node></View>\n<Layout name="Main"><Node /></Layout>`
    );
    // from and to go to VertexView; weight is shown, so it takes each of its values.
    expect(prepared.components.find(({ name }) => name === 'EdgeView')?.cases).toEqual(
      [1, 4, 7].map((weight) => ({ from: 0, to: 0, weight }))
    );
  });

  it('measures the root with every value of what it reads for placement', () => {
    const prepared = prepareSvelteComponent(
      `<script domain>const Int = type([1, 3]); const Index = type("integer", { min: -1, max: 3 }); const Values = collection(Int, { max: 8 });</script><script input>const values = Values([1, 3, 1]); const target = Int(3);</script><script algorithm>@start[let i = Index(-1);] @move[i = Index(0);]</script><View of="Int" name="IntView"><Node value={this} /></View>\n<Layout name="Cells" of="values, i"><Node layout="row">{#each values as value, k}<Node>{value}{#if k === i}<Node>i</Node>{/if}</Node>{/each}</Node></Layout><Layout name="Main" of="target, values, i"><Node>{target}<Cells values={values} i={i} /></Node></Layout>`
    );
    // i places the pointer, measured where it is first declared; target and the cells go to views.
    expect(prepared.paced(pausesOf(prepared.pauses, {})).placements).toEqual([
      { path: 'i', step: 3, values: [-1, 0, 1, 2, 3] }
    ]);
  });

  it('measures a position with every place its type holds, one before its collection to its max', () => {
    const prepared = prepareSvelteComponent(
      `<script domain>const Int = type([1, 3]); const Values = collection(Int, { max: 5 }); const Position = index(Values);</script><script input>const values = Values([1, 3, 1]);</script><script algorithm>@start[let i = Position(-1);] @move[i = Position(0);]</script><Layout name="Cells" of="values, i"><Node layout="row">{#each values as value, k}<Node>{#if k === i}<Node>i</Node>{/if}</Node>{/each}</Node></Layout><Layout name="Main" of="values, i"><Node><Cells values={values} i={i} /></Node></Layout>`
    );
    expect(prepared.paced(pausesOf(prepared.pauses, {})).placements).toEqual([
      { path: 'i', step: 3, values: [-1, 0, 1, 2, 3, 4, 5] }
    ]);
  });

  it('draws every domain type with its widest values when all of them would be too many', () => {
    const prepared = prepareSvelteComponent(
      `<script domain>const Count = type("integer", { min: 0, max: 999 }); const Ratio = type("number", { min: 0, max: 1, places: 3 }); const Mark = type(["x", "yes"]); const Slot = union(Count, Mark); const Pair = record({ a: Count, b: Mark }); const Row = collection(Count, { max: 3 }); const Grid = collection(Row, { max: 2 });</script><script algorithm>@run[let r = Ratio(0.125); let g = Grid([[1, 2], [3]]);]</script><View of="Count" name="C"><Node value={this} /></View>\n<View of="Ratio" name="R"><Node value={this} /></View>\n<View of="Mark" name="M"><Node value={this} /></View>\n<View of="Pair" name="P"><Node>{this.a}{this.b}</Node></View>\n<View of="Grid" name="G"><Node layout="column">{#each this as row}<Node>{#each row as count}{count}{/each}</Node>{/each}</Node></View>\n<Layout name="Main" of="r"><Node>{r}</Node></Layout>`
    );
    expect(Object.fromEntries(prepared.components.map(({ name, cases }) => [name, cases]))).toEqual(
      {
        // A range's ends, and the value in the trace that prints longest.
        C: [0, 999, 1],
        R: [0, 1, 0.125],
        M: ['x', 'yes'],
        // P draws its fields through C and M, which keep their boxes, so one value does.
        P: [{ a: 0, b: 'yes' }],
        // G draws its counts only through C, which keeps its box whichever count it shows, its
        // rows and their counts as many as Grid's and Row's max.
        G: [
          [
            [0, 0, 0],
            [0, 0, 0]
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
          '<Layout name="I" of="i"><Node>{i}</Node></Layout><Layout name="Main" of="i"><Node><I i={i} /></Node></Layout>'
        ),
      /Int is a type, and nothing draws it: add a view of it/
    ],
    [
      'rendering a snippet that is not defined',
      () =>
        component(
          '<View of="Int" name="IntCell"><Node value={this} /></View>\n<Layout name="I" of="i"><Node>{i}</Node></Layout><Layout name="Main" of="i"><Node><I i={i} />{@render Compared(i)}</Node></Layout>'
        ),
      /\{@render Compared\(i\)\} is written \{i\}/
    ],
    [
      'a view named after its type',
      () =>
        component(
          '<View of="Int" name="Int"><Node value={this} /></View>\n<Layout name="Main" of="i"><Node>{i}</Node></Layout>'
        ),
      /Int is a view named after its type/
    ],
    [
      'a part named after a type',
      () =>
        component(
          '<Layout name="Int"><Node>x</Node></Layout><Layout name="Main"><Node><Int /></Node></Layout>'
        ),
      /The layout Int has the name of a type/
    ],
    [
      'reading an algorithm variable',
      () =>
        component(
          '<View of="Int" name="Cell"><Node value={i} /></View>\n<Layout name="Main"><Node /></Layout>'
        ),
      /Cell reads i, an input or algorithm variable/
    ],
    [
      'reading an algorithm variable past a loop of the same name',
      () =>
        component(
          '<View of="Int" name="Cell"><Node>{#each [1] as i}{/each}{this} at {i}</Node></View>\n<Layout name="Main"><Node /></Layout>'
        ),
      /Cell reads i, an input or algorithm variable/
    ],
    [
      'types that are not domain types',
      () =>
        component(
          '<View of="Number" name="Cell"><Node value={this} /></View>\n<Layout name="Main"><Node /></Layout>'
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
          '<View of="Int"><Node value={this} /></View>\n<Layout name="Main"><Node /></Layout>'
        ),
      /<View of="Int"> has no name: a view is written <View of="Int" name="Bar">/
    ],
    [
      'a view with a prop of another kind',
      () =>
        component(
          '<View of="Int" name="Cell" fill="red"><Node value={this} /></View>\n<Layout name="Main"><Node /></Layout>'
        ),
      /A <View> takes only of, its type or label, and name: fill is no prop of a view/
    ],
    [
      'a view whose type is computed',
      () =>
        component(
          '<View of={Int} name="Cell"><Node value={this} /></View>\n<Layout name="Main"><Node /></Layout>'
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
          '<View of="Int" name="Cell"><View of="Int" name="Inner"><Node value={this} /></View>\n</View>\n<Layout name="Main"><Node /></Layout>'
        ),
      /A <View> is written at the top level, beside the layouts, not inside another view/
    ],
    [
      'components inside markup',
      () =>
        component(
          '<Layout name="Part"><Node><View of="Int" name="Cell"><Node value={this} /></View>\n</Node></Layout><Layout name="Main"><Node><Part /></Node></Layout>'
        ),
      /A <View> is written at the top level, beside the layouts, never inside a layout/
    ],
    [
      'views with more values than can be drawn',
      () =>
        prepareSvelteComponent(
          `<script domain>const Flag = type("boolean"); const Flags = record({ a: Flag, b: Flag, c: Flag, d: Flag, e: Flag, f: Flag, g: Flag, h: Flag, i: Flag });</script><script algorithm></script><View of="Flags" name="F"><Node value={this.a} /></View>\n<Layout name="Main"><Node /></Layout>`
        ),
      /F would be drawn with too many values of Flags/
    ]
  ])('rejects %s', (_name, prepare, message) => {
    expect(prepare).toThrow(message);
  });
});

describe('scope', () => {
  const source = (markup: string) =>
    `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int, { max: 8 }); const Position = index(Values); const Flag = type("boolean");</script><script input>const values = Values([5, 2]);</script><script algorithm>for (@from[let i = Position(1)]; @more[i < values.length]; @step[i++]) {\n  @key[const key = values[i];]\n}\n@done[const done = Flag(true);]</script><View of="Int" name="IntText"><Node value={this} /></View>\n${markup}`;

  it('stands a variable out of scope in hidden, with its value from the nearest step', async () => {
    const prepared = prepareSvelteComponent(
      source('<Layout name="Main" of="key"><Node>{key}</Node></Layout>')
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
          '<Layout name="K" of="key"><Node><Node value={key} /></Node></Layout><Layout name="Main" of="key"><Node><K key={key} /></Node></Layout>'
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
          '<Layout name="D" of="done"><Node>{#if done}Done{/if}</Node></Layout><Layout name="Main" of="done"><Node><D done={done} /></Node></Layout>'
        )
      )
    ).not.toThrow();
    expect(() =>
      prepareSvelteComponent(
        source(
          '<Layout name="D" of="done">{#if done}<Node>Done</Node>{/if}</Layout><Layout name="Main" of="done"><Node><D done={done} /></Node></Layout>'
        )
      )
    ).toThrow('The view reads done itself outside any <Node>');
  });
});

describe('views', () => {
  it('are only drawn with {@render}, never called to make a value', () => {
    const source = `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int, { max: 8 }); const Index = index(Values);</script><script input>const values = Values([5, 2]);</script><script algorithm></script><View of="Int" name="IntText"><Node value={this} /></View>\n<View of="Index" name="IndexLabel"><Node value={this} /></View>\n<View of="Values" name="Row"><Node layout="row">{#each this as v, k}{v}{Index(k)}{/each}</Node></View>\n<Layout name="Main" of="values"><Node>{values}</Node></Layout>`;
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
      `${domain}<View of="Int" name="Plain"><Node value={this} /></View>\n<View of="Int" name="Boxed"><Node>{this}</Node></View>\n<Layout name="Main"><Node>{i}</Node></Layout>`
    );
    expect(prepared.design.space['views.Int']).toEqual(['Plain', 'none']);
    expect(() =>
      prepareSvelteComponent(
        `${domain}<View of="Int" name="Boxed"><Node>{this}</Node></View>\n<Layout name="Main"><Node>{i}</Node></Layout>`
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
  const Values = collection(Int, { max: 8 });
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
<Layout name="Title"><Node>Bubble sort</Node></Layout>
<Layout name="Board" of="values, @sweep.pair.test">
  <Node layout="column">
    <Node>{#each values as v}{v}{/each}</Node>
    {@sweep.pair.test}
  </Node>
</Layout>

<Layout name="Main" of="values, @sweep.pair.test">
  <Node>
    <Title />
    <Board values={values} />
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
    ).toThrow('which only layouts know: write it in a layout');
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
  const Values = collection(Int, { max: 8 });
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
<Layout name="Board" of="values, @insert.compare">
  <Node layout="row">
    <Listing />
    <Node layout="column">
      <Node>{#each values as v}{v}{/each}</Node>
      {@insert.compare}
    </Node>
  </Node>
</Layout>

<Layout name="Main" of="values, @insert.swap.to, @insert.swap.from, @insert.compare">
  <Node>
    <Board values={values} />
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
  const Values = collection(Int, { max: 8 });
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
<Layout name="Board" of="values, @insert.compare">
  <Node layout="row">
    <Listing />
    <Node layout="column">
      <Node>{#each values as v}{v}{/each}</Node>
      {@insert.compare}
    </Node>
  </Node>
</Layout>

<Layout name="Main" of="values, @insert.swap.to, @insert.swap.from, @insert.compare">
  <Node>
    <Board values={values} />
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
    `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = collection(Int, { max: 8 }); const Index = index(Values);</script><script input>const values = Values([5, 2]);</script><script algorithm>${algorithm}</script><View of="Int" name="IntCell"><Node value={this} /></View>\n<View of="Int" name="IntTally"><Node>{'•'.repeat(this)}</Node></View>\n{#snippet Cells()}<Node>{#each values as v}{v}{/each}</Node>{/snippet}${view}`;

  it('refuses a view rendered by its own name, naming its type', () => {
    expect(() =>
      prepareSvelteComponent(
        source(
          '<Layout name="Key" of="key"><Node>{@render IntTally(key)}</Node></Layout><Layout name="Main" of="key"><Node><Key key={key} /></Node></Layout>'
        )
      )
    ).toThrow("{@render IntTally(key)} is written {key}: a value in braces draws its type's view");
  });

  it("gives a render with an argument its own choice of view and paint, falling back to its type's", () => {
    const view =
      '<Layout name="Key" of="key"><Node>{key}</Node></Layout><Layout name="Main" of="key, values"><Node>{@render Cells()}<Key key={key} /></Node></Layout>';
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
          '<Layout name="Key" of="key"><Node>{@render Int(key)}</Node></Layout><Layout name="Main" of="key"><Node><Key key={key} /></Node></Layout>'
        )
      )
    ).toThrow('{@render Int(key)} is written {key}: a value in braces draws its type');
  });

  it('draws a union value by its member’s view, refusing a view of the union', () => {
    const union = (views: string) =>
      `<script domain>const Steps = type("integer", { min: 0, max: 9 }); const None = type(["none"]); const Dist = union(Steps, None); const Dists = collection(Dist, { max: 8 });</script><script input>const dists = Dists([0, "none"]);</script><script algorithm>@run[const d = dists[1];]</script>${views}\n<Layout name="Main"><Node>{#each dists as d}{d}{/each}</Node></Layout>`;
    const prepared = prepareSvelteComponent(
      union(
        '<View of="Steps" name="StepsCell"><Node value={this} /></View>\n<View of="None" name="NoneMark"><Node>–</Node></View>'
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
          '<Layout name="Shown" of="key, @key"><Node>{key} {@key}</Node></Layout><Layout name="Main" of="key, @key"><Node><Shown key={key} /></Node></Layout>',
          '@shown[let key = Int(2); const picked = @key[values[0]];]'
        )
      )
    ).toThrow('rename the label');
  });
});

describe('pools and references', () => {
  const domain = `<script domain>
  const Name = type(['A', 'B', 'C']);
  const Flag = type('boolean');
  const End = type(['end']);
  const ListNode = record({ name: Name, next: Next });
  const ListNodes = pool(ListNode, { max: 2 });
  const NodeRef = ref(ListNode);
  const Next = union(NodeRef, End);
</script>
<script input>
  const nodes = ListNodes();
  const head = NodeRef(nodes.add(ListNode({ name: 'A', next: nodes.add(ListNode({ name: 'B', next: End('end') })) })));
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
  const list = `<Layout name="List" of="nodes"><Node layout="free" flow="x">{#each nodes as n}{n}{/each}</Node></Layout><Layout name="Main" of="nodes, cur"><Node><List nodes={nodes} />{cur}</Node></Layout>`;
  const box = `<View of="ListNode" name="NodeBox"><Node layout="row">{this.name}<Link to={this.next} /></Node></View>`;

  it('draws every node of a pool, a reference as a pointer, and the end through its view', () => {
    const prepared = prepareSvelteComponent(`${domain}\n${box}\n${list}`);
    expect(prepared.design.space['views.ListNode']).toEqual(['NodeBox', 'none']);
    expect(prepared.design.space['pointers.NodeRef']).toEqual(['Here', 'none']);
    // The end a link to no node gives is drawn with its type's view, a choice of its own.
    expect(prepared.design.space['views.End']).toEqual(['EndMark', 'none']);
    expect(prepared.master.at(-1)!.state.nodes).toEqual([
      { name: 'B', next: 1 },
      { name: 'A', next: 'end' }
    ]);
  });

  it.each([
    [
      'all(…), naming the pool that replaced it',
      `${box}\n<Layout name="Main"><Node layout="free">{#each all(ListNode) as n}{n}{/each}</Node></Layout>`,
      'all(ListNode) is no more: keep the ListNodes in a pool, as const ListNodes = pool(ListNode, { max: 8 }); in the domain and const nodes = ListNodes(); in the input'
    ],
    [
      'a link with no from outside a view',
      `<Layout name="Heap" of="cur"><Node layout="free"><Link to={cur} /></Node></Layout><Layout name="Main" of="cur"><Node><Heap cur={cur} /></Node></Layout>`,
      /A <Link> with no from starts at the element its view draws/
    ]
  ])('refuses %s', (_name, markup, message) => {
    expect(() => prepareSvelteComponent(`${domain}\n${markup}`)).toThrow(message);
  });
});

describe('the view reaching the code only through labels', () => {
  const swaps = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int, { max: 8 });
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
<Layout name="Cells" of="values, @insert.swap.to, @insert.swap.from">
  <Node layout="row">
    {#each values as v}{v}{/each}
    <Link from={@insert.swap.from} to={@insert.swap.to} />
  </Node>
</Layout>

<Layout name="Main" of="values, @insert.swap.to, @insert.swap.from">
  <Node>
    <Cells values={values} />
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
  const Values = collection(Int, { max: 8 });
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
    const source = currentForm(caption('<When of="@pass.look">{@render Caption()}</When><Bad />'));
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
  const Values = collection(Int, { max: 8 });
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
    const source = currentForm(chain(`${looking}<Bad />`));
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
  it('read a field through a reference from its node in its pool', () => {
    // queue holds references to vertices; q.name reads the name of the vertex q refers to.
    const prepared = prepareSvelteComponent(bfsReferences);
    expect(prepared.component).toContain('$$props.vertices[$.get(q)].name');
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
  const Vertices = collection(Vertex, { max: 8 });
  const VertexRef = index(Vertices);
  const Queue = collection(VertexRef, { max: 8 });
  const Edge = record({ from: VertexRef, to: VertexRef });
  const Edges = collection(Edge, { max: 8 });
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
<Layout name="Queued" of="queue"><Node>{#each queue as q}{q}{/each}</Node></Layout>
<Layout name="Ends" of="edges"><Node>{#each edges as edge}{at(edge.from).name}{at(edge.to)}{/each}</Node></Layout>
<Layout name="Main" of="queue, edges"><Node><Queued queue={queue} /><Ends edges={edges} /></Node></Layout>`
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
          graph(`${markup}\n<Layout name="Main"><Node>{@render Shown()}</Node></Layout>`)
        );
      } catch (error) {
        return error as { code?: string; message: string };
      }
      return undefined;
    };
    expect(
      problem('<Layout name="Shown" of="queue"><Node>{queue[0].name}</Node></Layout>')
    ).toMatchObject({
      code: 'view_position',
      message: expect.stringContaining(
        'read the element it points at with at(), as at(queue[0]).name'
      )
    });
    expect(
      problem('<Layout name="Shown" of="queue"><Node>{at(queue[0]).weight}</Node></Layout>')
        ?.message
    ).toContain('A Vertex has no field weight; its fields are name, seen.');
    expect(problem('<Layout name="Shown" of="n"><Node>{at(n)}</Node></Layout>')?.message).toContain(
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

<Layout name="Main" of="n">
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
      `${domain}${algorithm}<View of="Int" name="IntText"><Node value={this} /></View>\n${view}`
    );

  it('gives a node with kind, and the nodes inside it, the kind within its snippet', () => {
    const prepared = component(
      '<Layout name="Table" of="i"><Node layout="row"><Node kind="Header">a</Node><Node kind="Header"><Node>b</Node></Node><Node>{i}</Node></Node></Layout><Layout name="Main" of="i"><Node><Node kind="Note">n</Node><Table i={i} /></Node></Layout>'
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
    [
      "a layout's name",
      '<Node kind="Table">a</Node>',
      /kind="Table" has the name of a view or a layout/
    ],
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
    expect(() =>
      component('<Layout name="Main" of="i"><Node kind="Page">{i}</Node></Layout>')
    ).toThrow(/root <Node> of the layout Main is the frame/);
  });
});

describe('props bound to a view’s value', () => {
  const domain =
    "<script domain>const Flag = type('boolean'); const Level = type('integer', { min: 0, max: 3 }); const Wide = type('integer', { min: 0, max: 99 }); const Card = record({ seen: Flag, level: Level });</script>";
  const algorithm =
    '<script algorithm>@run[let card = Card({ seen: false, level: 1 }); let wide = Wide(5);]</script>';
  const component = (views: string, page = '<Node>{card}</Node>') =>
    prepareSvelteComponent(
      `${domain}${algorithm}<View of="Flag" name="FlagText"><Node value={this} /></View>\n<View of="Level" name="LevelText"><Node value={this} /></View>\n<View of="Wide" name="WideText"><Node value={this} /></View>\n${views}\n<Layout name="Main">${page}</Layout>`
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

  it('runs an enumeration in its declared order, onto one hue’s shades or an ordered prop', () => {
    const states = (views: string) =>
      prepareSvelteComponent(
        `<script domain>const State = type(['Unseen', 'Queued', 'Done']);</script><script algorithm>@run[let s = State('Queued');]</script><View of="State" name="StateText"><Node value={this} /></View>\n${views}\n<Layout name="Main"><Node>{s}</Node></Layout>`
      );
    const coloured = states('<View of="State" name="Dot"><Node fill={this}>{this}</Node></View>');
    expect(coloured.design.space['Dot.fill@hue']).toContain('teal');
    expect(coloured.design.starter).toMatchObject({
      'Dot.fill@hue': 'blue',
      'Dot.fill@order': 'up'
    });
    expect(coloured.design.space).not.toHaveProperty(['Dot.fill@Unseen']);
    const sized = states(
      '<View of="State" name="Dot"><Node strokeWidth={this}>{this}</Node></View>'
    );
    expect(sized.design.space['Dot.strokeWidth@from']).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(() =>
      states('<View of="State" name="Dot"><Node font={this}>{this}</Node></View>')
    ).toThrow(/an enumeration, whose values run in its declared order, and font's options do not/);
  });

  it('binds a position, its values one before its collection to its max', () => {
    const { design } = prepareSvelteComponent(
      `<script domain>const Int = type('integer', { min: 0, max: 9 }); const Values = collection(Int, { max: 2 }); const Position = index(Values);</script><script input>const values = Values([4, 7]);</script><script algorithm>@run[let i = Position(0);]</script><View of="Int" name="IntText"><Node value={this} /></View>\n<View of="Position" name="Faded"><Node opacity={this}>{this}</Node></View>\n<View of="Position" name="PositionText"><Node value={this} /></View>\n<Layout name="Main" of="values, i"><Node><Node>{#each values as v}{v}{/each}</Node>{i}</Node></Layout>`
    );
    // -1 to 2, four values, one to each of opacity's four options.
    expect(design.space['Faded.opacity@from']).toEqual([0.25]);
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

  it('makes a length the value times a unit of its kind, however many values it takes', () => {
    const { design } = component(
      '<View of="Wide" name="Bar"><Node width={this} /></View>',
      '<Node>{wide}</Node>'
    );
    expect(design.space['Bar.width@unit']).toEqual([1, 2, 3, 4, 6, 8, 12, 16, 24]);
    // The largest unit keeping 99, the largest Wide, within 200 pixels.
    expect(design.starter['Bar.width@unit']).toBe(2);
    // From the left, as width runs, until the design places it otherwise; the width is the value,
    // so the kind has no width variable, and a variant naming one is told why.
    expect(design.space['Bar.xAnchor']).toEqual(['start', 'center', 'end']);
    expect(design.starter['Bar.xAnchor']).toBe('start');
    expect(design.space['Bar.width']).toBeUndefined();
    expect(design.space['Bar.height']).toEqual(['uniform', 'varying']);
  });

  it.each([
    [
      'a length below zero',
      '<View of="Wide" name="Bar"><Node height={this - 50} /></View>',
      /can be -50, below zero: a length runs from zero/
    ],
    [
      'a length that is not a number',
      '<View of="Card" name="CardBar"><Node width={this.seen} /></View>',
      /width=\{this.seen\} is not a number/
    ],
    [
      'a constant length',
      '<View of="Card" name="CardBar"><Node width={40} /></View>',
      /a length is the value times a unit, so it reads this/
    ]
  ])('refuses %s', (_, views, message) => {
    expect(() => component(views)).toThrow(message);
  });

  it('refuses a length outside a view', () => {
    expect(() => component('', '<Node><Node width={wide}>x</Node>{card}</Node>')).toThrow(
      /width is a length bound to a view's value/
    );
  });

  it('types an {#each} item by its collection’s element and its index by the position type', () => {
    const { design } = prepareSvelteComponent(
      `<script domain>const Flag = type('boolean'); const Vertex = record({ seen: Flag }); const Vertices = collection(Vertex, { max: 2 }); const Position = index(Vertices); const Graph = record({ vertices: Vertices });</script><script input>const graph = Graph({ vertices: [{ seen: false }, { seen: true }] });</script><script algorithm>@run[let done = Flag(false);]</script><View of="Flag" name="FlagText"><Node value={this} /></View>\n<View of="Graph" name="Drawing"><Node layout="row">{#each this.vertices as v, j}<Node kind="Dot" fill={v.seen} opacity={j}>x</Node>{/each}</Node></View>\n<Layout name="Main" of="graph, done"><Node>{graph}{done}</Node></Layout>`
    );
    expect(design.starter).toMatchObject({
      'Drawing.Dot.fill@false': 'neutral-200',
      'Drawing.Dot.fill@true': 'blue-200'
    });
    // j is a Position, -1 to 2: four values, one to each of opacity's four options.
    expect(design.space['Drawing.Dot.opacity@from']).toEqual([0.25]);
  });

  describe('a label’s operands', () => {
    const labelled = (bound: string, than = 'Level(2)') =>
      prepareSvelteComponent(
        `<script domain>const Level = type('integer', { min: 0, max: 3 }); const Levels = collection(Level, { max: 3 }); const Position = index(Levels);</script><script input>const levels = Levels([3, 1, 2]);</script><script algorithm>@start[let i = Position(0);]\nwhile (@more[i < levels.length]) @step{ if (@test[levels[i] > ${than}]) @big[i++;] else @small[i++;] }</script><View of="Level" name="LevelText"><Node value={this} /></View>\n<View of="Position" name="Here"><Pointed /></View>\n<View of="@step.test" name="Ask"><Node ${bound}>is {this.left} more than {this.right}?</Node></View>\n<Layout name="Main"><Node><Node>{#each levels as v}{v}{/each}</Node>{@step.test}{i}</Node></Layout>`
      );

    it('binds an operand by the type its runs gave it', () => {
      const { design } = labelled('opacity={this.left}');
      expect(design.space['Ask.opacity@from']).toEqual([0.25]);
    });

    it('refuses an operand its runs gave no type, saying how to give it one', () => {
      expect(() => labelled('opacity={this.right}', '2')).toThrow(
        /reads this.right, which @step.test gives no type: .* with a constructor, as Int\(…\)/
      );
    });
  });

  it('refuses an anchor written in the markup', () => {
    expect(() =>
      component('<View of="Wide" name="Bar"><Node height={this} anchor="start" /></View>')
    ).toThrow(
      /takes no anchor: where a box sits in its slot is a look the design gives its kind, not the markup, as the variables Bar.xAnchor and Bar.yAnchor/
    );
  });
});

describe('slots and boxes', () => {
  const source = (views: string, page: string) =>
    `<script domain>const Wide = type('integer', { min: 0, max: 99 });</script><script algorithm>@run[let wide = Wide(5);]</script>${views}\n<Layout name="Main"><Node>${page}</Node></Layout>`;

  it('gives every kind a width and height, its slot’s or its own, and anchors, a row its spacing', () => {
    const { design } = prepareSvelteComponent(
      source(
        '<View of="Wide" name="WideText"><Node value={this} /></View>',
        '<Node layout="row" kind="Pair">{wide}{wide}</Node>'
      )
    );
    expect(design.space['WideText.width']).toEqual(['uniform', 'varying']);
    expect(design.space['WideText.yAnchor']).toEqual(['start', 'center', 'end']);
    expect(design.starter).toMatchObject({
      'WideText.width': 'uniform',
      'WideText.height': 'uniform',
      'WideText.xAnchor': 'center',
      'WideText.yAnchor': 'center',
      'Main.Pair.spacing': 'slots'
    });
    expect(design.space['Main.Pair.spacing']).toEqual(['slots', 'packed']);
    expect(design.space['WideText.spacing']).toBeUndefined();
  });

  it('starts a collection where its first item is, and its items centred only where its length never changes', () => {
    const collections = (algorithm: string) =>
      prepareSvelteComponent(
        `<script domain>const Int = type('integer', { min: 0, max: 9 }); const Values = collection(Int, { max: 6 }); const Queue = collection(Int, { max: 6 });</script><script input>const values = Values([1, 2, 3]); const queue = Queue([1]);</script><script algorithm>${algorithm}</script><View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Line"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<Layout name="Main"><Node layout="column"><Node layout="row" kind="Fixed">{#each values as v}{v}{/each}</Node><Node layout="column" kind="Growing">{#each queue as v}{v}{/each}</Node>{values}</Node></Layout>`
      ).design.starter;
    // values never changes length; queue grows.
    const starter = collections('@grow[queue.push(Int(2));]');
    expect(starter).toMatchObject({
      // A box that varies starts at its first item, along its axis.
      'Main.Fixed.xAnchor': 'start',
      'Main.Growing.yAnchor': 'start',
      'Line.xAnchor': 'start',
      // Items centred where the length is steady, at the start where it changes.
      'Main.Fixed.justify': 'center',
      'Line.justify': 'center',
      'Main.Growing.justify': 'start'
    });
    // Across its axis, and anything not a collection, start as before.
    expect(starter['Main.Fixed.yAnchor']).toBe('center');
    expect(starter['Cell.xAnchor']).toBe('center');
    // A collection type that grows anywhere starts at its start everywhere.
    expect(collections('@grow[values.push(Int(2));]')['Main.Fixed.justify']).toBe('start');
  });

  it('has no variable for an axis the view sizes by its value, and says why when one is chosen', async () => {
    const prepared = prepareSvelteComponent(
      source('<View of="Wide" name="Bar"><Node height={this} /></View>', '{wide}')
    );
    expect(prepared.design.space['Bar.height']).toBeUndefined();
    expect(prepared.design.starter['Bar.yAnchor']).toBe('end');
    await expect(
      bundlePresentation(prepared, 1, { chosen: { 'Bar.height': 'varying' } })
    ).rejects.toThrow(
      "Bar's height is bound to its value in the view, height={…}, so it has no height variable; Bar.yAnchor places it."
    );
  }, 60_000);

  it('refuses a kind sizing an axis by its value in one node and not another', () => {
    expect(() =>
      prepareSvelteComponent(
        source(
          '<View of="Wide" name="Bar"><Node layout="column"><Node height={this} /></Node></View>',
          '{wide}'
        )
      )
    ).toThrow(
      'Bar binds height in one node and not another: one kind of node either sizes by its value or not, so give the node sized by its value a kind of its own, as <Node kind="Length" height={…} />.'
    );
    // A kind passes to the nodes inside it, so the node sized by its value takes its own.
    const { design } = prepareSvelteComponent(
      source(
        '<View of="Wide" name="Bar"><Node layout="column"><Node kind="Length" height={this} /></Node></View>',
        '{wide}'
      )
    );
    expect(design.space['Bar.Length.height']).toBeUndefined();
    expect(design.space['Bar.height']).toEqual(['uniform', 'varying']);
  });

  it('refuses a node sized by its value holding anything, and builds the label beside it', () => {
    expect(() =>
      prepareSvelteComponent(
        source(
          '<View of="Wide" name="Bar"><Node height={this}><Node value={this} /></Node></View>',
          '{wide}'
        )
      )
    ).toThrow(
      '<Node height={this}> holds what it is sized by: a node sized by its value holds nothing, so 0 draws as nothing and 1 as one unit. Put the label beside it, as <Node layout="column"><Node kind="Length" height={this} /><Node value={this} /></Node>.'
    );
    // The form the message shows builds as written.
    const { design } = prepareSvelteComponent(
      source(
        '<View of="Wide" name="Bar"><Node layout="column"><Node kind="Length" height={this} /><Node value={this} /></Node></View>',
        '{wide}'
      )
    );
    expect(design.space['Bar.Length.height@unit']).toBeDefined();
  });

  it('refuses where a box sits, or how a row spaces, written in the markup', () => {
    expect(() =>
      prepareSvelteComponent(
        source(
          '<View of="Wide" name="WideText"><Node value={this} xAnchor="start" /></View>',
          '{wide}'
        )
      )
    ).toThrow(/xAnchor is a look/);
  });
});

describe('grids', () => {
  const domain = '<script domain>const Int = type([1, 3]);</script>';
  const algorithm = '<script algorithm>@run[let i = Int(1);]</script>';
  const component = (view: string) =>
    prepareSvelteComponent(
      `${domain}${algorithm}<View of="Int" name="IntText"><Node value={this} /></View>\n${view}`
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

  it('holds links among the cells it places, their ends computed from the index', () => {
    const { component } = prepareSvelteComponent(heapTree);
    expect(component).toContain('__toIn');
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

describe('tests of a union in a view', () => {
  const withBox = (box: string) =>
    listMarkers.replace(
      /<View of="ListNode" name="NodeBox">[\s\S]*?\n<\/View>/u,
      `<View of="ListNode" name="NodeBox">\n  ${box}\n</View>`
    );

  it('refuses one that tests which member a union holds and reads inside it', () => {
    expect(() =>
      prepareSvelteComponent(
        withBox(
          `<Node layout="row">{this.name}{#if this.next !== 'end'}<Node><Link to={this.next} />{this.next.name}</Node>{/if}</Node>`
        )
      )
    ).toThrow(
      `{#if this.next !== 'end'} tests which member this.next holds and reads inside it: give each member its own view, as <View of="NodeRef" name="…">…</View> and <View of="End" name="…">…</View>, and write {this.next}, which draws the one it holds.`
    );
  });

  it('keeps one that tests a union without reading inside it, or reads a value it tests', () => {
    expect(() =>
      prepareSvelteComponent(
        withBox(
          `<Node layout="row">{this.name}{#if this.next !== 'end'}<Node><Link to={this.next} /></Node>{/if}{#if this.name === 'A'}<Node>first</Node>{/if}</Node>`
        )
      )
    ).not.toThrow();
  });
});
