import { describe, expect, it } from 'vitest';

import type { MasterStep } from './algorithm/interpret.server';
import {
  bundlePresentation as bundleOnBase,
  compileSvelteComponent as compileCurrent,
  InvalidSvelteSourceError,
  prepareSvelteComponent as prepareCurrent
} from './compile.server';
import { onStarter } from './testing/scenes';
import { starterValues } from './testing/scenes';
import { currentForm } from './testing/legacy-sources';

// Sources built from pieces here are written with parts as snippets; each is read in the current
// form, its parts layouts declaring what they read (see testing/legacy-sources.ts).
const prepareSvelteComponent = (source: string) => prepareCurrent(currentForm(source));
const compileSvelteComponent = (source: string, seed?: number) =>
  compileCurrent(currentForm(source), onStarter({}), seed);
import { linearSearchSource } from './contract';
import bfsReferences from './fixtures/bfs-references.sverlin?raw';
import bst from './fixtures/bst.sverlin?raw';
import dijkstra from './fixtures/dijkstra.sverlin?raw';
import heapTree from './fixtures/heap-tree.sverlin?raw';
import listMarkers from './fixtures/list-markers.sverlin?raw';
import listingPython from './fixtures/listing-python.sverlin?raw';
import { buildVariant as buildOnBase, type VariantRequest } from './design.server';
import { iconNames } from './library/fonts';

// Each request on the starter base where it names none, as every design in the app names one.
const bundlePresentation = (
  component: Parameters<typeof bundleOnBase>[0],
  seed: number,
  request: VariantRequest = {},
  options?: Parameters<typeof bundleOnBase>[3]
) => bundleOnBase(component, seed, onStarter(request), options);
const buildVariant = (
  offered: Parameters<typeof buildOnBase>[0],
  start: Parameters<typeof buildOnBase>[1],
  request: VariantRequest,
  ...rest: Parameters<typeof buildOnBase> extends [unknown, unknown, unknown, ...infer R]
    ? R
    : never
) => buildOnBase(offered, start, onStarter(request), ...rest);

/** The kinds of node a prepared source's design space has, from its variables' keys. */
const kindsOf = (space: Record<string, unknown>) =>
  [
    ...new Set(
      Object.keys(space)
        .filter(
          (key) =>
            !key.startsWith('views.') &&
            !key.startsWith('views.') &&
            !key.startsWith('<') &&
            !key.startsWith('$') &&
            key !== 'layout' &&
            !key.startsWith('Main.') &&
            !/[:=@]/u.test(key) &&
            !/\.(from|hue|order|unit)$/u.test(key)
        )
        .map((key) => key.slice(0, key.lastIndexOf('.')))
    )
  ].sort();

describe('single-component Svelte compilation', () => {
  it('bundles a component and its playback input without executing it', async () => {
    const result = await compileSvelteComponent(
      '<script domain>const Int = type("integer", { min: 0, max: 9 });</script><script algorithm>@run[let n = Int(0);] @a[n = Int(1);] @b[n = Int(2);]</script><View of="Int" name="IntCell"><Node value={this} /></View>\n<Layout name="S"><Node>n</Node></Layout><Layout name="Main"><Node><S />{n}</Node></Layout>'
    );
    // The input as given, then a step at each label, each named by its label and run.
    expect(result.labels).toEqual(['@case.start', '@run#1.end', '@a#1.end', '@b#1.end']);
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
      undefined,
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
      // The scene pauses where i is set and moved, as the caption draws it, and at each
      // comparison.
      expect(bundle.labels).toEqual([
        '@case.start',
        '@first#1.end',
        '@check.equal#1.end',
        '@next#1.end',
        '@check.equal#2.end',
        '@next#2.end',
        '@check.equal#3.end',
        '@next#3.end',
        '@check.equal#4.end',
        '@run#1.end',
        '@case.end'
      ]);
      // Every variant shows the source's steps.
      expect(bundle.steps).toEqual(bundle.labels);
    }
    expect(new Set(bundles.map(({ variant }) => variant['views.Int']))).toEqual(
      new Set(['IntCell', 'IntTally'])
    );
    expect(bundles[0].layoutCode).toContain('[3,8,5,2,7]');
    // The algorithm runs when the source is built, not in the page.
    expect(bundles[0].layoutCode).not.toContain('values[i] === target');
    const again = await bundlePresentation(prepared, 1, { randomise: true });
    expect(again.variant).toEqual(bundles[0].variant);
    // With no values, a copy of `$starter`, which the version records as its design file.
    const plain = await bundlePresentation(prepared, 1);
    expect(plain.variant).toMatchObject(starterValues(prepared.design));
    expect(plain.design).not.toHaveProperty('template');
    expect(plain.design.$text).toBe(plain.variant.$text);
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
  it('reports plain case and algorithm values at their authored line and column', async () => {
    await expect(
      compileSvelteComponent(
        '<script domain>const Int = type("integer", { min: -100, max: 1000 }); const Values = array(Int, { max: 8 });</script>\n<script input>\n  const values = Values;\n</script>\n<script algorithm>\n  @run[let i = 0;]\n\n</script>\n<Case name="main" values={[3, "x"]} />'
      )
    ).rejects.toMatchObject({
      code: 'view_case',
      // The value as the case writes it.
      line: 9,
      column: 27,
      message: expect.stringContaining(
        'In the case main, values: Values[1]: Int values must be whole numbers, not "x"'
      )
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
        '<Layout name="Hi"><Node>Hi</Node></Layout><Layout name="Main"><Node><Hi /></Node></Layout>'
      )
    ).rejects.toThrow('Add a <script algorithm> block');
    await expect(
      compileSvelteComponent('<script algorithm></script><script algorithm></script>')
    ).rejects.toThrow('only one algorithm block');
  });

  it('injects the sverlin library components without authored imports', async () => {
    const result = await compileSvelteComponent(linearSearchSource);
    expect(result.layoutCode).toContain('sv-node');
    expect(result.layoutCode).toContain('sv-node');
    const withoutModuleScript = await compileSvelteComponent(
      '<script algorithm></script><Layout name="X"><Node>x</Node></Layout><Layout name="Main"><Node><X /></Node></Layout>'
    );
    // Its one scene reads no state, so it is one frame, named by the scene.
    expect(withoutModuleScript.labels).toEqual(['main']);
    expect(withoutModuleScript.layoutCode).toContain('sv-node');
  });

  it('puts every recorded value in scope for a script-free view', async () => {
    const result = await compileSvelteComponent(
      '<script domain>const Int = type("integer", { min: -100, max: 1000 }); const Values = array(Int, { max: 8 }); const Index = index(Values); const Flag = type("boolean");</script><script input>const values = Values;</script><Case name="main" values={[4, 9]} />\n<script algorithm>@start[let total = Int(0);]\nfor (@first[let i = Index(0)]; @more[i < values.length]; @next[i++]) {\n  @add[total = total + values[i];]\n}</script>\n<Layout name="Sum"><Node layout="column">{@const doubled = total * 2}<Node>{values.join("+")} = <Node value={total} />; doubled {doubled}</Node></Node></Layout><Layout name="Main"><Node><Sum /></Node></Layout><Storyboard><Scene name="main" case="main" pause="@start.end, @add.end"><Main /></Scene></Storyboard>',
      5
    );
    // The input as given, the start, and a step per addition; the loop's end only drops v, so it
    // is no step.
    expect(result.labels).toEqual(['@case.start', '@start#1.end', '@add#1.end', '@add#2.end']);
    expect(result.variant['Sum.fill']).toBeDefined();
  });

  it('gives every kind of node, the snippet it is in, the variables its role has', () => {
    const { design } = prepareSvelteComponent(
      `<script domain>const Int = type([1, 3]); const Values = array(Int, { max: 8 }); const Position = index(Values);</script><script input>const values = Values;</script><Case name="main" values={[1, 3]} /><script algorithm>@run[let i = Position(0); let j = Position(1);]</script><View of="Int" name="IntCell"><Node value={this} /></View>\n<View of="Position" name="Arrow"><Node layout="column"><Link to={this} /><Node kind="Name">i</Node></Node></View>\n<View of="Position" name="Mark"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>\n<Layout name="Cells"><Node layout="row">{#each values as v}{v}{/each}</Node></Layout><Layout name="Note"><Node>note</Node></Layout><Layout name="Pair"><Node layout="free">{#each values as v}{v}{/each}<Link from={i} to={j} /></Node></Layout><Layout name="Main"><Node><Cells />{i}<Note /><Pair /></Node></Layout>`
    );
    expect(kindsOf(design.space)).toEqual(
      [
        'Arrow',
        'Arrow.<Link>',
        'Arrow.<Link>.<To>',
        'Arrow.Name',
        'Cells',
        'IntCell',
        'Mark',
        'Mark.Caption',
        'Mark.<Link>',
        'Mark.<Link>.<To>',
        'Note',
        'Pair',
        'Pair.<Link>',
        'Pair.<Link>.<To>'
      ].sort()
    );
    expect(design.space['Cells.gap']).toBeDefined();
    expect(design.space['IntCell.gap']).toBeUndefined();
    expect(design.space['Pair.<Link>.strokeStyle']).toEqual(['solid', 'dashed', 'dotted']);
    expect(design.space['views.Int']).toEqual(['IntCell', 'none']);
    // Each render with an argument is a place: its own choice where its type has several views of
    // the kind it draws, and its own paint for the kinds of each.
    expect(design.space['views.Position:i']).toEqual(['Arrow', 'Mark', 'none']);
    expect(starterValues(design)['views.Position:i']).toBe('Arrow');
    expect(design.space['Arrow.<Link>.<To>:i.fill']).toBeDefined();
    expect(design.space['Arrow.Name:i.color']).toBeDefined();
    expect(design.space['Arrow.<Link>:i.padding']).toBeUndefined();
    expect(design.space['IntCell:v.fill']).toBeDefined();
    expect(design.space['views.Int:v']).toBeUndefined();
    expect(design.fallbacks['Mark.<Link>.<To>:i.stroke']).toBe('Mark.<Link>.<To>.stroke');
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

  it('refuses <Pointed>, naming the link form', () => {
    expect(() =>
      prepareSvelteComponent(
        `<script domain>const Int = type([1, 3]); const Values = array(Int, { max: 8 }); const Position = index(Values);</script><script input>const values = Values;</script><Case name="main" values={[1, 3]} /><script algorithm>@run[let i = Position(0);]</script><View of="Int" name="IntCell"><Node value={this} /></View>\n<View of="Position" name="Here"><Pointed /></View>\n<Layout name="Main"><Node>{#each values as v}{v}{/each}{i}</Node></Layout>`
      )
    ).toThrow(
      /<Pointed> is no longer part of the library: draw a pointer as a link from the variable[^]*<Link to=\{this\} \/>/u
    );
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
      ['head="vee"', '<To>.head'],
      ['headSize={12}', 'headSize']
    ])
      await expect(
        view(`<Node layout="free"><Node>a</Node><Link from={0} to={1} ${prop} /></Node>`)
      ).rejects.toMatchObject({
        code: 'unknown_prop',
        message: expect.stringContaining(`here the variable V.<Link>.${variable}`)
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
    await expect(view('<Node layout="free" flow="y" />')).rejects.toMatchObject({
      code: 'unknown_prop',
      message: expect.stringContaining(
        "takes no flow: the way a free layout runs is its kind's direction"
      )
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
  const Values = array(Int, { max: 4 });
</script>
<script input>const values = Values;</script><Case name="main" values={[3, 1, 2]} />
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
      `<script domain>const Int = type([1, 3]);</script><script input>const n = Int;</script><Case name="main" n={1} /><script algorithm>@run[let i = Int(1);]</script>
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
      `<script domain>const Int = type([1, 3]); const Values = array(Int, { max: 8 });</script><script input>const values = Values;</script><Case name="main" values={[1, 3]} /><script algorithm>@run[let i = Int(1);]</script>\n{#snippet V()}${markup}{/snippet}<Layout name="Main"><Node>{@render V()}</Node></Layout>`;
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
    // A lowercase <svg> is refused as a drawing written wrongly, naming <Svg>.
    await expect(view('<svg><circle r="4" /></svg>')).rejects.toMatchObject({
      message: expect.stringContaining('<svg> is written <Svg')
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
        '<script domain>const Int = type([1, 3]);</script><script algorithm>@run[let i = Int(1);]</script>\n<View of="Int" name="IntNote">is <Node value={this} /></View>\n<Layout name="V"><Node>Step {i}</Node>\n<Node>{i}</Node></Layout><Layout name="Main"><Node><V /></Node></Layout>'
      )
    ).resolves.toBeDefined();
  });

  it('refuses words in a node with a layout, which holds only nodes, renders and blocks', async () => {
    const page = (markup: string) =>
      compileSvelteComponent(
        `<script algorithm></script>\n<Layout name="Main"><Node layout="column">${markup}</Node></Layout>\n<Storyboard><Scene name="main"><Main /></Scene></Storyboard>`
      );
    await expect(
      page('<Node kind="Problem" layout="column">Find the target <Node>7</Node></Node>')
    ).rejects.toMatchObject({
      code: 'view_text',
      line: 2,
      message: expect.stringMatching(
        /^"Find the target" is written in a node with a layout, of kind (Main\.)?Problem, .* Put them in a node of their own, as <Node kind="Caption">Find the target<\/Node>\.$/u
      )
    });
    // So inside a block in it.
    await expect(
      page('<Node layout="row">{#if 1 > 0}and{/if}<Node>7</Node></Node>')
    ).rejects.toMatchObject({ code: 'view_text', message: expect.stringContaining('"and"') });
    // Words in a node of their own inside it, and in a link's label, are the node's or the link's.
    await expect(
      page(
        '<Node layout="free">{#each [0, 1] as v, k}<Node>V</Node>{#if k > 0}<Link from={k - 1} to={k}>weight</Link>{/if}{/each}</Node><Node layout="row"><Node kind="Caption">Find the target</Node><Node>7</Node></Node>'
      )
    ).resolves.toBeDefined();
  });

  it('warns of a node with no layout holding two blocks and no words, which flow as text', async () => {
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 4 });
</script>
<script input>
  const values = Values;
</script>
<script algorithm>@run[let n = Int(0);]</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row"><Node>{#each this as v}{v}{/each}</Node></View>
<Layout name="Cells"><Node>{#each values as v}{v}{/each}</Node></Layout>
<Layout name="Goal"><Node>target 7</Node></Layout>
<Layout name="Main">
  <Node layout="column">
    <Node kind="Problem"><Goal /><Cells /></Node>
    <Node>{values}<Node layout="row"><Node>a</Node></Node></Node>
    <Node>values {values} <Goal /></Node>
  </Node>
</Layout>
<Case name="main" values={[1, 2]} />
<Storyboard><Scene name="main" case="main"><Main /></Scene></Storyboard>`;
    const { warnings } = await bundlePresentation(prepareCurrent(source), 1);
    // The third node holds words of its own, so its children are read as a sentence.
    expect(
      warnings
        ?.map(({ message }) => message)
        .filter((warning) => warning.includes('with no layout'))
    ).toEqual([
      '<Node kind="Problem">, a node with no layout, holds <Goal />, <Cells /> and no words of its own: with no layout its children flow as text, wrapping against each other with no gap. Give it a layout, as layout="column" to stack them or layout="row" to set them side by side.',
      'A node with no layout in Main holds {values}, a node with a layout and no words of its own: with no layout its children flow as text, wrapping against each other with no gap. Give it a layout, as layout="column" to stack them or layout="row" to set them side by side.'
    ]);
  });

  it('shows the source’s own listing where the view places a <Listing />, lit per step', async () => {
    const source = [
      '<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = array(Int, { max: 8 }); const Index = index(Values); const Flag = type("boolean");</script>',
      '<script input>const values = Values;</script><Case name="main" values={[3, 8]} />',
      '<script algorithm>@loop[let last = Index(1); for (@from[let i = Index(0)]; @more[i < values.length]; @step[i++]) { last = i; }]</script>',
      '<script listing="code">for @loop[@from[i = 1] @more[to n] @step[step 1]]</script>',
      '<View of="Index" name="IndexCell"><Node value={this} /></View>\n<Layout name="Cells"><Node>{#each values as v}<Node value={v} />{/each}</Node></Layout><Layout name="Main"><Node><Listing /><Cells />{last}</Node></Layout>'
    ].join('\n');
    const prepared = prepareSvelteComponent(source);
    expect(prepared.design.space['<Listing>.language']).toEqual(['code', 'none']);
    expect(starterValues(prepared.design)['<Listing>.language']).toBe('code');
    expect(prepared.listings?.code.text).toBe('for i = 1 to n step 1');
    // The input as given, lighting nothing, then i set, each test, each pass's move, the loop's
    // end, and the end of all, :after.
    const { lit } = prepared.paced(new Set(prepared.pauses.labels));
    expect(lit.code).toHaveLength(9);
    expect(lit.code[0]).toEqual({ current: [], earlier: [] });
    const { layoutCode: javascript } = await bundlePresentation(prepared, 1);
    expect(javascript).toContain('for i = 1 to n step 1');
    // Without a <Listing />, the design has no listing variables.
    expect(prepareSvelteComponent(linearSearchSource).design.space).not.toHaveProperty(
      '<Listing>.language'
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
      `<script domain>const Int = type("integer", { min: -100, max: 1000 }); const Row = array(Int, { max: 8 }); const Grid = array(Row, { max: 8 });</script><script input>const grid = Grid;</script><Case name="main" grid={[[1, 2], [3, 4]]} /><script algorithm></script><View of="Int" name="IntCell"><Node value={this} /></View>\n${view}`;
    const result = await compileSvelteComponent(
      source(
        '<Layout name="Rows"><Node layout="column">{#each grid as row}<Node>{#each row as v}{v}{/each}</Node>{/each}</Node></Layout><Layout name="Main"><Node><Rows /></Node></Layout>'
      )
    );
    expect(result.layoutCode).toContain('sv-node');
    await expect(
      compileSvelteComponent(
        source(
          '<Layout name="G"><Node items={grid} /></Layout><Layout name="Main"><Node><G /></Node></Layout>'
        )
      )
    ).rejects.toMatchObject({
      code: 'unknown_prop',
      message: expect.stringContaining('<Node> has no prop items')
    });
  });

  it('marks the node showing a view’s own value with its type, for its unit', async () => {
    const source = (view: string, more = '') =>
      `<script domain>const Int = type("integer", { min: -100, max: 1000 }); const Height = type("integer", { min: -100, max: 1000, unit: "cm" }); const People = array(Height, { max: 8 });</script><script input>const people = People;</script><Case name="main" people={[150, 170]} /><script algorithm></script>${view}\n{#snippet Everyone()}<Node>{#each people as person}{person}{/each}</Node>{/snippet}<Layout name="Main"><Node>{@render Everyone()}${more}</Node></Layout>`;
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

  it('takes chosen values, keeps the file’s values that still fit, and gives the rest its base', async () => {
    const prepared = prepareSvelteComponent(
      '<script algorithm></script><Layout name="One"><Node value={1} /></Layout><Layout name="Main"><Node><One /></Node></Layout>'
    );
    const built = await bundlePresentation(prepared, 3, {
      chosen: { 'One.radius': 999 },
      // Removed and unfit values of the file leave it, so the kind follows its base.
      base: { 'One.fill': 'blue-100', 'One.textSize': 9, 'gone.width': 2 }
    });
    expect(built.variant).toMatchObject({ 'One.radius': 999, 'One.fill': 'blue-100' });
    expect(built.variant['One.textSize']).toBe(starterValues(prepared.design)['One.textSize']);
    expect(built.variant).not.toHaveProperty('gone.width');
    expect(built.origins).toMatchObject({
      'One.radius': 'chosen',
      'One.fill': 'kept'
    });
    expect(built.design).not.toHaveProperty('One.textSize');
    await expect(
      bundlePresentation(prepared, 3, { chosen: { 'One.radius': 3 } })
    ).rejects.toMatchObject({
      code: 'design_value',
      message: expect.stringContaining('One.radius cannot be 3')
    });
    const { warnings } = await bundlePresentation(prepared, 3, { chosen: { 'One.depth': 2 } });
    expect(warnings?.map(({ message }) => message)).toContainEqual(
      expect.stringContaining('One has no prop depth')
    );
  });

  it('takes the page frame from the layout’s values in the variant', async () => {
    const prepared = prepareSvelteComponent(
      '<script algorithm></script><Layout name="A"><Node>a</Node></Layout><Layout name="Main"><Node><A /></Node></Layout>'
    );
    expect(starterValues(prepared.design)['Main.ratio']).toBe('fit');
    const built = await bundlePresentation(prepared, 1, { chosen: { 'Main.ratio': '4:3' } });
    expect(built.layoutCode).toMatch(/"?ratio"?:"4:3"/u);
    await expect(
      bundlePresentation(prepared, 1, { chosen: { 'Main.ratio': '5:4' } })
    ).rejects.toThrow('Main.ratio cannot be "5:4"');
  });

  it('tags links like nodes, and marks the nodes and roots they join', () => {
    const algorithm =
      '<script domain>const Int = type([1, 2]); const Values = array(Int, { max: 8 }); const Position = index(Values);</script><script input>const values = Values; const i = Position; const j = Position;</script><Case name="main" values={[1, 2]} i={0} j={1} /><script algorithm></script><View of="Int" name="IntCell"><Node value={this} /></View>';
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
      `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = array(Int, { max: 8 });</script><script input>const values = Values;</script><Case name="main" values={${values}} /><script algorithm>@reverse[const t = values[0]; values[0] = values[1]; values[1] = t;]</script>{#snippet V()}${view}{/snippet}<Layout name="Main"><Node>{@render V()}</Node></Layout>`;
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

describe('typed view components', () => {
  const domain = '<script domain>const Int = type([1, 3]); const Flag = type("boolean");</script>';
  const algorithm = '<script algorithm>@run[let i = Int(1);]</script>';
  const component = (view: string) => prepareSvelteComponent(`${domain}${algorithm}${view}`);

  it('reads typed snippets as views of one type, and draws the view the variant chooses for the type', async () => {
    const prepared = component(
      '<View of="Int" name="IntText"><Node value={this} /></View>\n<View of="Int" name="IntPair"><Node layout="row"><Node value={this} /><Node value={this} /></Node></View>\n<Layout name="Main"><Node>{i}</Node></Layout>'
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
    expect(none.layoutCode).toContain('"views.Int":"none"');
  });

  it('orders components after those they render', () => {
    const prepared = prepareSvelteComponent(
      `<script domain>const Int = type([1, 3]); const Row = array(Int, { max: 4 });</script><script algorithm>@start[let values = Row([1, 3]);] @grow[values = Row([1, 3, 1]);]</script><View of="Row" name="Search"><Node layout="row">{#each this as value}{value}{/each}</Node></View>\n<View of="Int" name="Plain"><Node value={this} /></View>\n<View of="Int" name="Boxed"><Node layout="row"><Node value={this} /></Node></View>\n<Layout name="Main"><Node>{values}</Node></Layout>`
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
      `<script domain>const Int = type([1, 3]); const Index = type("integer", { min: -1, max: 3 }); const Values = array(Int, { max: 8 });</script><script input>const values = Values; const target = Int;</script><Case name="main" values={[1, 3, 1]} target={3} /><script algorithm>@start[let i = Index(-1);] @move[i = Index(0);]</script><View of="Int" name="IntView"><Node value={this} /></View>\n<Layout name="Cells"><Node layout="row">{#each values as value, k}<Node>{value}{#if k === i}<Node>i</Node>{/if}</Node>{/each}</Node></Layout><Layout name="Main"><Node>{target}<Cells /></Node></Layout>`
    );
    // i places the pointer, measured where it is first declared; target and the cells go to views.
    expect(prepared.paced(new Set(prepared.pauses.labels)).placements).toEqual([
      { path: 'i', step: 3, values: [-1, 0, 1, 2, 3] }
    ]);
  });

  it('measures a position with every place its type holds, one before its collection to its max', () => {
    const prepared = prepareSvelteComponent(
      `<script domain>const Int = type([1, 3]); const Values = array(Int, { max: 5 }); const Position = index(Values);</script><script input>const values = Values;</script><Case name="main" values={[1, 3, 1]} /><script algorithm>@start[let i = Position(-1);] @move[i = Position(0);]</script><Layout name="Cells"><Node layout="row">{#each values as value, k}<Node>{#if k === i}<Node>i</Node>{/if}</Node>{/each}</Node></Layout><Layout name="Main"><Node><Cells /></Node></Layout>`
    );
    expect(prepared.paced(new Set(prepared.pauses.labels)).placements).toEqual([
      { path: 'i', step: 3, values: [-1, 0, 1, 2, 3, 4, 5] }
    ]);
  });

  it('draws every domain type with its widest values when all of them would be too many', () => {
    const prepared = prepareSvelteComponent(
      `<script domain>const Count = type("integer", { min: 0, max: 999 }); const Ratio = type("number", { min: 0, max: 1, places: 3 }); const Mark = type(["x", "yes"]); const Slot = union(Count, Mark); const Pair = record({ a: Count, b: Mark }); const Row = array(Count, { max: 3 }); const Grid = array(Row, { max: 2 });</script><script algorithm>@run[let r = Ratio(0.125); let g = Grid([[1, 2], [3]]);]</script><View of="Count" name="C"><Node value={this} /></View>\n<View of="Ratio" name="R"><Node value={this} /></View>\n<View of="Mark" name="M"><Node value={this} /></View>\n<View of="Pair" name="P"><Node>{this.a}{this.b}</Node></View>\n<View of="Grid" name="G"><Node layout="column">{#each this as row}<Node>{#each row as count}{count}{/each}</Node>{/each}</Node></View>\n<Layout name="Main"><Node>{r}</Node></Layout>`
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
          '<Layout name="I"><Node>{i}</Node></Layout><Layout name="Main"><Node><I /></Node></Layout>'
        ),
      /Int is a type, and nothing draws it: add a view of it/
    ],
    [
      'rendering a snippet that is not defined',
      () =>
        component(
          '<View of="Int" name="IntCell"><Node value={this} /></View>\n<Layout name="I"><Node>{i}</Node></Layout><Layout name="Main"><Node><I />{@render Compared(i)}</Node></Layout>'
        ),
      /\{@render Compared\(i\)\} is written \{i\}/
    ],
    [
      'a view named after its type',
      () =>
        component(
          '<View of="Int" name="Int"><Node value={this} /></View>\n<Layout name="Main"><Node>{i}</Node></Layout>'
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
          `<script domain>const Flag = type("boolean"); const Flags = record({ a: Flag, b: Flag, c: Flag, d: Flag, e: Flag, f: Flag, g: Flag, h: Flag, i: Flag });</script><script algorithm></script><View of="Flags" name="F"><Node>{#each [this.a, this.b, this.c, this.d, this.e, this.f, this.g, this.h, this.i] as flag}<Node value={flag} />{/each}</Node></View>\n<Layout name="Main"><Node /></Layout>`
        ),
      /F would be drawn with too many values of Flags/
    ]
  ])('rejects %s', (_name, prepare, message) => {
    expect(prepare).toThrow(message);
  });
});

describe('scope', () => {
  const source = (markup: string) =>
    `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = array(Int, { max: 8 }); const Position = index(Values); const Flag = type("boolean");</script><script input>const values = Values;</script><Case name="main" values={[5, 2]} /><script algorithm>for (@from[let i = Position(1)]; @more[i < values.length]; @step[i++]) {\n  @key[const key = values[i];]\n}\n@done[const done = Flag(true);]</script><View of="Int" name="IntText"><Node value={this} /></View>\n${markup}`;

  it('stands a variable out of scope in hidden, with its value from the nearest step', async () => {
    const prepared = prepareSvelteComponent(
      source(
        '<Layout name="Main"><Node>{key}</Node></Layout><Storyboard><Scene name="main" case="main" pause="@key.end, @done.end"><Main /></Scene></Storyboard>'
      )
    );
    const { layoutCode: javascript } = await bundlePresentation(prepared, 1);
    // After the loop, i and key are out of scope: they stand in from the step that had them, and are
    // listed absent (values, the same at every step, is kept once; see library/trace-pack.ts).
    expect(javascript).toContain('i:1,key:2');
    expect(javascript).toContain('["i","key"]');
  });

  it('takes the view reading a variable out of scope at some step itself, hidden there', () => {
    expect(() =>
      prepareSvelteComponent(
        source(
          '<Layout name="K"><Node><Node value={key} /></Node></Layout><Layout name="Main"><Node><K /></Node></Layout>'
        )
      )
    ).not.toThrow();
  });

  it('rejects choosing by a label value, pointing at <When> and at labelling the guarded code', () => {
    const chosen = (test: string) =>
      source(
        `{#snippet Held()}<Node>held</Node>{/snippet}<Layout name="Main"><Node>{#if ${test}}{@render Held()}{/if}</Node></Layout>`
      ).replace('@key[const key = values[i];]', '@key[const key = @at[values[i]];]');
    expect(() => prepareSvelteComponent(chosen('@key.at'))).toThrow(
      `{#if @key.at} would choose what to draw by the label's value, which a view never does: <Node when="@key.at">…</Node>`
    );
    expect(() => prepareSvelteComponent(chosen('@key.at > 0'))).toThrow(
      `A view cannot choose what to draw by a label's value, as {#if @key.at}: <Node when="@key.at">…</Node> shows`
    );
  });

  it.each([
    ['in a node', '<Node>{#if done}Done{/if}</Node>'],
    ['in a block at the top', '{#if done}<Node>Done</Node>{/if}']
  ])('takes a variable declared later read itself %s, hidden until it is declared', (_, part) => {
    expect(() =>
      prepareSvelteComponent(
        source(`<Layout name="D">${part}</Layout><Layout name="Main"><Node><D /></Node></Layout>`)
      )
    ).not.toThrow();
  });

  it('hides a block testing an absent variable with all it holds, through a slot reading it', () => {
    const { component } = prepareSvelteComponent(
      source('<Layout name="Main"><Node>{key}{#if done}<Node>Done</Node>{/if}</Node></Layout>')
    );
    expect(component).toMatch(/inherit: true,\s*reads: \["done"\]/u);
  });

  it('tells a variable the algorithm uses and never declares in the algorithm, before the layout naming it', () => {
    // Depth-first search's first source in benchmark run 4 pushed to order, never declared, and
    // was told only that its layout declared order, which is no variable.
    const source = `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = array(Int, { max: 4 });</script><script input>const values = Values;</script><Case name="main" values={[1, 2]} />
<script algorithm>
  @run[order.push(values[0]);]
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<Layout name="Main"><Node>{values}{order}</Node></Layout>`;
    expect(() => prepareSvelteComponent(source)).toThrow(
      expect.objectContaining({
        line: 3,
        message: expect.stringContaining(
          '"order" is not defined: the algorithm uses it, and neither it nor the input declares it'
        )
      })
    );
  });

  it('refuses a name the algorithm never declares', () => {
    expect(() =>
      prepareSvelteComponent(
        source('<Layout name="Main"><Node>{key}{#if never}<Node>Never</Node>{/if}</Node></Layout>')
      )
    ).toThrow('The view reads never, which is no variable or label of the algorithm');
  });
});

describe('views', () => {
  it('are only drawn with {@render}, never called to make a value', () => {
    const source = `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = array(Int, { max: 8 }); const Index = index(Values);</script><script input>const values = Values;</script><Case name="main" values={[5, 2]} /><script algorithm></script><View of="Int" name="IntText"><Node value={this} /></View>\n<View of="Index" name="IndexLabel"><Node value={this} /></View>\n<View of="Values" name="Row"><Node layout="row">{#each this as v, k}{v}{Index(k)}{/each}</Node></View>\n<Layout name="Main"><Node>{values}</Node></Layout>`;
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
        `${domain}{#snippet A()}<Node layout={1 > 0 ? 'row' : 'spiral'}><Node>a</Node></Node>{/snippet}<Layout name="Main"><Node>{@render A()}</Node></Layout>`
      )
    ).toThrow(`layout={1 > 0 ? 'row' : 'spiral'} can be "spiral"`);
  });
});

describe('views of what a step computed', () => {
  const bubble = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = array(Int, { max: 8 });
  const Index = index(Values);

  // walking the collection

  // what the algorithm does
</script>

<script input>
  const values = Values;
</script><Case name="main" values={[5, 1, 4, 2, 3]} />

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
<Layout name="Board">
  <Node layout="column">
    <Node>{#each values as v}{v}{/each}</Node>
    {@sweep.pair.test}
  </Node>
</Layout>

<Layout name="Main">
  <Node>
    <Title />
    <Board />
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
    const { layoutCode: javascript } = await bundlePresentation(prepared, 1);
    expect(javascript).toMatch(/__applied_(?:ℓ|\\u2113)sweep/u);
  });

  it('pause at each comparison its label runs, and apart from it at each swap', () => {
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
    // Ten comparisons and six swaps, after the input as given, then the end.
    expect(both).toHaveLength(18);
    // Not pausing at the comparisons, the sort plays through its swaps, each comparison leading up
    // to its swap and drawn there.
    const swaps = prepared.paced(new Set(['sweep.pair.swap'])).steps;
    expect(steps(swaps).slice(1, 3)).toEqual([
      ['1,5,4,2,3', ['5 > 1']],
      ['1,4,5,2,3', ['5 > 4']]
    ]);
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
    ).toThrow('whose expression no step of the case evaluates');
  });

  const pairs = (algorithm: string, label: string) => `<script domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = array(Int, { max: 6 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
  const target = Int;
</script>
<script algorithm>
${algorithm}
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="${label}" name="Line"><Node>{this.left}, {this.right}: {this.value}</Node></View>
<Layout name="Main"><Node>{values}{${label}}</Node></Layout>
<Case name="main" values={[1, 2, 4, 7, 9]} target={11} />
<Storyboard>
  <Scene name="scan" case="main"><Main /></Scene>
</Storyboard>`;
  const walk = (
    body: string
  ) => `  @start[let left = Index(values, 0); let right = Index(values, values.length - 1);]
  while (@room[left < right]) @pair{
${body}
    @move[left++;]
  }`;

  it.each([
    ['a declaration', walk('    const sum = @sum[values[left] + values[right]];'), '@pair.sum'],
    [
      'a condition',
      walk('    if (@hit[values[left] + values[right] === target]) @found{ break; }'),
      '@pair.hit'
    ],
    ['an expression statement', walk('    @check[values[left] < target];'), '@pair.check'],
    [
      'a function',
      `  function small(v, t) @small{
    if (@low[v < t]) @yes{ return true; }
    @no[return false;]
  }
  @start[let k = Index(values, 0);]
  while (@more[k < values.length]) @each{
    @ask[small(values[k], target);]
    @next[k++;]
  }`,
      '@small.low'
    ]
  ])(
    'views what a labelled expression in %s computed, its operands and result',
    async (_, algorithm, label) => {
      const built = await bundlePresentation(
        prepareSvelteComponent(pairs(algorithm, label)),
        1,
        {}
      );
      expect(built.labels.length).toBeGreaterThan(1);
    }
  );

  it('says why a label types no view: no such label, or the algorithm failing', () => {
    expect(() =>
      prepareSvelteComponent(
        pairs(walk('    const sum = @sum[values[left] + values[right]];'), '@sum')
      )
    ).toThrow('no label is named: a label inside another is named by both');
    // The algorithm's own problem, a statement in no label beside the others, comes first.
    expect(() =>
      prepareSvelteComponent(
        pairs(
          walk(
            '    const sum = @sum[values[left] + values[right]];\n    if (sum > 99) left = right;'
          ),
          '@pair.sum'
        )
      )
    ).toThrow('is in @pair but in none of the labels beside it');
  });
});

describe('pauses at labels', () => {
  const insertion = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Position = index(Values);
  const Flag = type('boolean');
</script>

<script input>
  const values = Values;
</script><Case name="main" values={[5, 2, 4, 1]} />

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
<View of="Position" name="Highlight"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
<Layout name="Board">
  <Node layout="row">
    <Listing />
    <Node layout="column">
      <Node>{#each values as v}{v}{/each}</Node>
      {@insert.compare}
    </Node>
  </Node>
</Layout>

<Layout name="Main">
  <Node>
    <Board />
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

  it('pauses at the labels given, each comparison and swap a step', () => {
    const prepared = prepareSvelteComponent(insertion);
    const coarse = prepared.paced(new Set(['insert.compare', 'insert.swap'])).steps;
    expect(played(coarse).slice(0, 5)).toEqual([
      '5,2,4,1 | 5 > 2: true | left right | ',
      '2,5,4,1 |  | from to | ',
      '2,5,4,1 | 5 > 4: true | left right | ',
      '2,4,5,1 |  | from to | ',
      '2,4,5,1 | 2 > 4: false | left right | '
    ]);
  });

  it('pauses at each label given, the end of a run holding the marks made inside it', () => {
    const prepared = prepareSvelteComponent(insertion);
    // Left, right, the comparison, the swap's marks with nothing moved, then the swap; the pair in
    // order makes no marks step, as no swap runs.
    expect(played(prepared.paced(fine).steps).slice(0, 11)).toEqual([
      '5,2,4,1 |  | left | ',
      '5,2,4,1 |  | right | ',
      '5,2,4,1 | 5 > 2: true |  | left right',
      '5,2,4,1 |  | from to | ',
      '2,5,4,1 |  |  | from to',
      '2,5,4,1 |  | left | ',
      '2,5,4,1 |  | right | ',
      '2,5,4,1 | 5 > 4: true |  | left right',
      '2,5,4,1 |  | from to | ',
      '2,4,5,1 |  |  | from to',
      '2,4,5,1 |  | left | '
    ]);
  });

  it('lights each pause’s region', () => {
    const prepared = prepareSvelteComponent(insertion);
    const { text } = prepared.listings!.code;
    const lit = prepared
      .paced(fine)
      .lit.code.slice(1, 4)
      .map(({ current }) => current.map(([start, end]) => text.slice(start, end)));
    expect(lit).toEqual([['j - 1'], ['j'], ['A[j - 1] > A[j]']]);
  });
  it('leaves out a pause chosen as a variable, warning that the scenes say where the steps pause', async () => {
    const prepared = prepareSvelteComponent(insertion);
    const { warnings } = await bundlePresentation(prepared, 1, {
      chosen: { 'pause@insert.swap': 'on' }
    });
    expect(warnings?.map(({ message }) => message)).toContainEqual(
      expect.stringContaining('the steps a scene shows are its pause')
    );
  });

  describe('listing regions as places', () => {
    it('gives each region its paint, falling back to the lit look', () => {
      const { design } = prepareSvelteComponent(insertion);
      expect(design.space['<Listing>.lit.radius']).toContain(999);
      expect(design.space['<Listing>.lit.color']).toContain('none');
      expect(design.space['<Listing>.lit@insert.compare.left.fill']).toContain('sky-100');
      expect(design.space['<Listing>.lit@insert.compare.left.radius']).toBeUndefined();
      expect(Object.keys(design.space).some((key) => key.startsWith('listing.earlier'))).toBe(
        false
      );
      expect(starterValues(design)['<Listing>.lit.fill']).toBe('amber-200');
      expect(design.fallbacks['<Listing>.lit@insert.compare.left.fill']).toBe('<Listing>.lit.fill');
      expect(design.fallbacks['<Listing>.lit@insert.swap.fill']).toBe('<Listing>.lit.fill');
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
      const { layoutCode: javascript } = await bundlePresentation(prepared, 1);
      expect(javascript).toMatch(/"?label"?:"insert\.compare\.left"/);
    });
  });
});

describe('pauses inside a run', () => {
  const insertion = prepareSvelteComponent(
    // The pauses-at-labels source, whose listing marks every label.
    `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Position = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[5, 2, 4, 1]} />
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
<View of="Position" name="Highlight"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
<Layout name="Board">
  <Node layout="row">
    <Listing />
    <Node layout="column">
      <Node>{#each values as v}{v}{/each}</Node>
      {@insert.compare}
    </Node>
  </Node>
</Layout>

<Layout name="Main">
  <Node>
    <Board />
    {@insert.compare.left}
    {@insert.compare.right}
    {@insert.swap.from}
    {@insert.swap.to}
  </Node>
</Layout>`
  );
  const { text } = insertion.listings!.code;
  const operands = ['insert.compare.left', 'insert.compare.right'];
  /** The first three steps' marks held, and the listing's text, current and earlier. */
  const firstSteps = (labels: string[]) => {
    const { steps, lit } = insertion.paced(new Set(labels));
    const texts = (ranges: readonly (readonly [number, number])[]) =>
      ranges.map(([start, end]) => text.slice(start, end));
    return [1, 2, 3].map((index) => ({
      held: Object.keys(steps[index].held ?? {}).map((label) => label.split('.').at(-1)),
      current: texts(lit.code[index].current),
      earlier: texts(lit.code[index].earlier)
    }));
  };

  it('show only each pause’s own part inside a run', () => {
    const [left, right, compare] = firstSteps([...operands, 'insert.compare']);
    // Only the operand lights: not what led up to the comparison, outside every pause, nor the rest
    // of the comparison.
    expect(left).toEqual({ held: [], current: ['j - 1'], earlier: [] });
    expect(right).toEqual({ held: [], current: ['j'], earlier: [] });
    // Its own end shows the whole of its run.
    expect(compare).toMatchObject({ held: ['left', 'right'], current: ['A[j - 1] > A[j]'] });
  });

  it('name each step by its label’s run, the same however the steps pause', () => {
    const coarse = insertion.paced(new Set(['insert.compare', 'insert.swap'])).steps;
    const fine = insertion.paced(new Set(insertion.pauses.labels)).steps;
    expect(coarse.map(({ name }) => name).slice(0, 4)).toEqual([
      '@case.start',
      '@insert.compare#1.end',
      '@insert.swap#1.end',
      '@insert.compare#2.end'
    ]);
    // Pausing everywhere, the loop's i is set and tested, then j's bound is tested, first.
    expect(fine.map(({ name }) => name).slice(0, 7)).toEqual([
      '@case.start',
      '@setup#1.end',
      '@guard#1.end',
      '@insert.guard#1.end',
      '@insert.compare.left#1.end',
      '@insert.compare.right#1.end',
      '@insert.compare#1.end'
    ]);
    // Each coarse step is the fine step of its name, holding the same state.
    const byName = new Map(fine.map((step) => [step.name, step.state]));
    for (const { name, state } of coarse) expect(byName.get(name)).toEqual(state);
  });

  it('count each label’s runs and those changing what the view draws, for the assistant', () => {
    const { runs } = insertion.pauses;
    // Each comparison and swap changes what the board draws; an insertion's own end adds nothing
    // beyond them, so pausing there would repeat the step before.
    expect(runs['insert.compare']).toEqual({ runs: 6, drawn: 6 });
    expect(runs['insert.swap']).toEqual({ runs: 5, drawn: 5 });
    expect(runs['insert']).toEqual({ runs: 3, drawn: 0 });
  });

  it('keys a label’s place by its full name only', () => {
    const { space, starter } = insertion.design;
    expect(space['Highlight.<Link>.<To>:@insert.compare.left.fill']).toBeDefined();
    expect(space['Highlight.<Link>.<To>:left.fill']).toBeUndefined();
    const chosen = { 'Highlight.<Link>.<To>:left.fill': 'sky-100' };
    expect(buildVariant(space, starter, { chosen }, 1).dropped).toHaveLength(1);
  });
});

describe('places', () => {
  const source = (view: string, algorithm = '@run[let i = Index(1); let key = Int(2);]') =>
    `<script domain>const Int = type("integer", { min: 0, max: 9 }); const Values = array(Int, { max: 8 }); const Index = index(Values);</script><script input>const values = Values;</script><Case name="main" values={[5, 2]} /><script algorithm>${algorithm}</script><View of="Int" name="IntCell"><Node value={this} /></View>\n<View of="Int" name="IntTally"><Node>{'•'.repeat(this)}</Node></View>\n{#snippet Cells()}<Node>{#each values as v}{v}{/each}</Node>{/snippet}${view}`;

  it('refuses a view rendered by its own name, naming its type', () => {
    expect(() =>
      prepareSvelteComponent(
        source(
          '<Layout name="Key"><Node>{@render IntTally(key)}</Node></Layout><Layout name="Main"><Node><Key /></Node></Layout>'
        )
      )
    ).toThrow("{@render IntTally(key)} is written {key}: a value in braces draws its type's view");
  });

  it("gives a render with an argument its own choice of view and paint, falling back to its type's", () => {
    const view =
      '<Layout name="Key"><Node>{key}</Node></Layout><Layout name="Main"><Node>{@render Cells()}<Key /></Node></Layout>';
    const prepared = prepareSvelteComponent(source(view));
    const { space, starter, renders, fallbacks } = prepared.design;
    expect(space['views.Int:key']).toEqual(['IntCell', 'IntTally', 'none']);
    expect(starter['views.Int:key']).toBe('IntCell');
    expect(fallbacks['views.Int:key']).toBe('views.Int');
    expect(space['IntTally:key.fill']).toBeDefined();
    expect(space['IntCell:v.color']).toBeDefined();
    // The editor's marker after the render names the place's own choice.
    expect(Object.values(renders)).toContain('views.Int:key');
    // A value in braces at the place calls its alias in place of its type, writing nothing beside it.
    expect(prepared.component).toMatch(/\$\.get\(__place\d+\), \(\) => \$\$props\.key/u);
    expect(prepared.component).not.toMatch(/from_(?:html|svg)\(`[^`]*__place/u);
  });

  it('draws a value in braces by its type, refusing its view written as a render of the type', () => {
    expect(() =>
      prepareSvelteComponent(
        source(
          '<Layout name="Key"><Node>{@render Int(key)}</Node></Layout><Layout name="Main"><Node><Key /></Node></Layout>'
        )
      )
    ).toThrow('{@render Int(key)} is written {key}: a value in braces draws its type');
  });

  it('draws a union value by its member’s view, refusing a view of the union', () => {
    const union = (views: string) =>
      `<script domain>const Steps = type("integer", { min: 0, max: 9 }); const None = type(["none"]); const Dist = union(Steps, None); const Dists = array(Dist, { max: 8 });</script><script input>const dists = Dists;</script><Case name="main" dists={[0, "none"]} /><script algorithm>@run[const d = dists[1];]</script>${views}\n<Layout name="Main"><Node>{#each dists as d}{d}{/each}</Node></Layout>`;
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

  it('keeps a label and a variable of one name apart, the label a moment of the run (:@…)', () => {
    const { space } = prepareSvelteComponent(
      source(
        '<Layout name="Shown"><Node>{key} {@shown.key}</Node></Layout><Layout name="Main"><Node><Shown /></Node></Layout>',
        '@shown[let key = Int(2); const picked = @key[values[0]];]'
      )
    ).design;
    expect(
      Object.keys(space)
        .filter((key) => /^IntCell:(?:@shown\.)?key\.fill$/u.test(key))
        .sort()
    ).toEqual(['IntCell:@shown.key.fill', 'IntCell:key.fill']);
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
  const nodes = ListNodes;
  const head = NodeRef;
</script><Case name="main" head={nodes.add(ListNode({ name: 'A', next: nodes.add(ListNode({ name: 'B', next: End('end') })) }))} />
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
<View of="NodeRef" name="Here"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>`;
  const list = `<Layout name="List"><Node layout="free">{#each nodes as n}{n}{/each}</Node></Layout><Layout name="Main"><Node><List />{cur}</Node></Layout>`;
  const box = `<View of="ListNode" name="NodeBox"><Node layout="row">{this.name}<Link to={this.next} /></Node></View>`;

  it('draws every node of a pool, a reference as a pointer, and the end through its view', () => {
    const prepared = prepareSvelteComponent(`${domain}\n${box}\n${list}`);
    expect(prepared.design.space['views.ListNode']).toEqual(['NodeBox', 'none']);
    expect(prepared.design.space['views.NodeRef']).toEqual(['Here', 'none']);
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
      'all(ListNode) is no more: keep the ListNodes in a pool, as const ListNodes = pool(ListNode, { max: 8 }); in the domain and const nodes = ListNodes; in the input'
    ],
    [
      'a link with no from outside a view',
      `<Layout name="Heap"><Node layout="free"><Link to={cur} /></Node></Layout><Layout name="Main"><Node><Heap /></Node></Layout>`,
      /A <Link> with no from starts at the element its view draws/
    ]
  ])('refuses %s', (_name, markup, message) => {
    expect(() => prepareSvelteComponent(`${domain}\n${markup}`)).toThrow(message);
  });
});

describe('the view reaching the code only through labels', () => {
  const swaps = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Position = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[5, 2, 4, 1]} />
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
<View of="Position" name="Highlight"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
<Layout name="Cells">
  <Node layout="row">
    {#each values as v}{v}{/each}
    <Link from={@insert.swap.from} to={@insert.swap.to} />
  </Node>
</Layout>

<Layout name="Main">
  <Node>
    <Cells />
  </Node>
</Layout>`;

  it('take labels giving positions as a link’s ends, hiding it where either gave none', async () => {
    const prepared = prepareSvelteComponent(swaps);
    expect(Object.values(prepared.labelled ?? {}).map(({ label }) => label)).toEqual([
      'insert.swap.from',
      'insert.swap.to'
    ]);
    const { layoutCode: javascript } = await bundlePresentation(prepared, 1);
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

describe('<Node when="@label">', () => {
  const caption = (block: string) => `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Position = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[5, 2, 4, 1]} />
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

  it('takes :before and :after for the first and the last step, :before chained with a label', () => {
    const prepared = prepareSvelteComponent(
      caption(
        '<Node layout="stack"><Node when="@case.start">{@render Caption()}</Node><Node when="@pass">{@render Caption()}</Node></Node><Node when="@case.end">{@render Caption()}</Node>'
      )
    );
    expect(Object.values(prepared.during ?? {})).toEqual(['#before', 'pass', '#after']);
    // The finishing statement and the end, :after, are steps of their own, so the two take turns.
    expect(() =>
      prepareSvelteComponent(
        caption(
          '<Node layout="stack"><Node when="@finish">{@render Caption()}</Node><Node when="@case.end">{@render Caption()}</Node></Node>'
        )
      )
    ).not.toThrow();
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
    // Every pass of the loop is inside the run of @scan, so a node with when="@scan" shows at each.
    const prepared = prepareSvelteComponent(
      chain(
        '<Node when="@scan.step">{@render Caption()}</Node><Node when="@scan">{@render Caption()}</Node>'
      )
    );
    expect(Object.values(prepared.during ?? {})).toEqual(['scan.step', 'scan']);
  });

  it('takes any label, a statement’s or an expression’s, keeping every position', () => {
    for (const label of ['@pass.look', '@pass.look.read', '@pass']) {
      const prepared = prepareSvelteComponent(
        caption(`<Node when="${label}">{@render Caption()}</Node>`)
      );
      expect(Object.values(prepared.during ?? {})).toEqual([label.slice(1)]);
    }
    // A problem after the block points where it is written.
    const source = currentForm(
      caption('<Node when="@pass.look">{@render Caption()}</Node><Bad />')
    );
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
      '{#if @pass.look.read} would choose what to draw by the label\'s value, which a view never does: <Node when="@pass.look.read">…</Node> shows the node at each step inside a span of the label.'
    );
    expect(() =>
      prepareSvelteComponent(
        caption('<Node when="@pass">{@render Caption()}{:else}{@render Caption()}</Node>')
      )
    ).toThrow('{:...} block is invalid');
    expect(() =>
      prepareSvelteComponent(caption('<Node when="step">{@render Caption()}</Node>'))
    ).toThrow('when="step" names no label by its full name');
    expect(() =>
      prepareSvelteComponent(caption('{#if when(@pass) && values}{@render Caption()}{/if}'))
    ).toThrow(
      'when() is not written in a view: write when on the node, as <Node when="@insert.swap">…</Node>'
    );
    expect(() =>
      prepareSvelteComponent(
        caption('{values[0]}').replace(
          '<View of="Int" name="IntCell"><Node value={this} /></View>',
          '<View of="Int" name="IntCell"><Node value={this} /><Node when="@pass"><Node>!</Node></Node></View>'
        )
      )
    ).toThrow('when="@pass" is in a view, which draws only its value');
  });
});

describe('<Node layout="stack"> branches', () => {
  const chain = (block: string) => `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Position = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[5, 2, 4, 1]} />
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
    '<Node layout="stack"><Node when="@pass.look">{@render Looking()}</Node><Node when="@pass.note">{@render Noting()}</Node></Node>';

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

  it('refuses <OneOf> and <When>, and takes labels of any length', () => {
    expect(() =>
      prepareSvelteComponent(
        chain('<OneOf><When of="@pass.look">{@render Looking()}</When></OneOf>')
      )
    ).toThrow('<OneOf> is not written: write when on the node');
    // A label of any length, as @n.
    const short = chain(looking.replace('when="@pass.note"', 'when="@pass.n"')).replace(
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
    // and two of its tests, within a presentation's 200 steps: each step's state repeating the
    // variant made it more than 2 MB.
    const quiet =
      /(first|more|next)(Round|Rounds|Vertex|Vertices|Edge|Edges)$|\.(closer|outgoing)$/u;
    const pause = prepareSvelteComponent(dijkstra)
      .pauses.labels.filter((label) => !quiet.test(label))
      .map((label) => `@${label}.end`)
      .join(', ');
    const prepared = prepareSvelteComponent(dijkstra.replace(/pause="[^"]*"/u, `pause="${pause}"`));
    const { javascript, labels } = await bundlePresentation(prepared, 1);
    // The steps drawing something new, those drawing what the step before drew left out (fewer
    // since the current edge is marked no longer, 7 November 2026).
    expect(labels.length).toBeGreaterThan(30);
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
      '<View of="VertexRef" name="Marked"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>',
      '<View of="VertexRef" name="Marked"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>\n<View of="VertexRef" name="RefCard"><Node value={this} /></View>'
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
  const Vertices = array(Vertex, { max: 8 });
  const VertexRef = index(Vertices);
  const Queue = array(VertexRef, { max: 8 });
  const Edge = record({ from: VertexRef, to: VertexRef });
  const Edges = array(Edge, { max: 8 });
  const Int = type('integer', { min: 0, max: 9 });${more}
</script>
<script input>
  const vertices = Vertices;
  const edges = Edges;
  const queue = Queue;
  const n = Int;
</script><Case name="main" vertices={[{ name: 'A', seen: true }, { name: 'B', seen: false }, { name: 'C', seen: false }]} edges={[{ from: 0, to: 1 }, { from: 1, to: 2 }]} queue={[1, 2]} n={1} />
<script algorithm></script>
<View of="Name" name="NameText"><Node value={this} /></View>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Vertex" name="VertexCard"><Node layout="column">{this.name}</Node></View>
${markup}`;

  it('reads the element in a view of a position, and through a position in a part', () => {
    const { component } = prepareSvelteComponent(
      graph(
        `<View of="VertexRef" name="VertexName">{at(this).name}</View>
<Layout name="Queued"><Node>{#each queue as q}{q}{/each}</Node></Layout>
<Layout name="Ends"><Node>{#each edges as edge}{at(edge.from).name}{at(edge.to)}{/each}</Node></Layout>
<Layout name="Main"><Node><Queued /><Ends /></Node></Layout>`
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
    expect(problem('<Layout name="Shown"><Node>{queue[0].name}</Node></Layout>')).toMatchObject({
      code: 'view_position',
      message: expect.stringContaining(
        'read the element it points at with at(), as at(queue[0]).name'
      )
    });
    expect(
      problem('<Layout name="Shown"><Node>{at(queue[0]).weight}</Node></Layout>')?.message
    ).toContain('A Vertex has no field weight; its fields are name, seen.');
    expect(problem('<Layout name="Shown"><Node>{at(n)}</Node></Layout>')?.message).toContain(
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

  it('builds a scene pausing at fewer labels, and says where to pause less over the limit', async () => {
    const pausing = (pause: string) =>
      `${long}\n<Case name="main" />\n<Storyboard><Scene name="main" case="main" pause="${pause}"><Main /></Scene></Storyboard>`;
    expect(prepareSvelteComponent(pausing('@run.end')).master.length).toBeGreaterThan(300);
    const passes = await bundlePresentation(
      prepareSvelteComponent(pausing('@run.end, @pass.end')),
      1
    );
    expect(passes.labels.length).toBeLessThanOrEqual(6);
    expect(() => prepareSvelteComponent(pausing('@pass.step.end'))).toThrow(
      /scene shows more than 200 steps, most at the end of @pass\.step/
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
      '<Layout name="Table"><Node layout="row"><Node kind="Header">a</Node><Node kind="Header"><Node>b</Node></Node><Node>{i}</Node></Node></Layout><Layout name="Main"><Node><Node kind="Note">n</Node><Table /></Node></Layout>'
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
    [
      'a kind built from text',
      '<Node kind={"Head" + "er"}>a</Node>',
      /every result is a name written in the source/
    ],
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
      `${domain}${algorithm}<View of="Flag" name="FlagText"><Node value={this} /></View>\n<View of="Level" name="LevelText"><Node value={this} /></View>\n<View of="Wide" name="WideText"><Node value={this} /></View>\n${views}\n<Layout name="Main">${page}</Layout>`
    );

  describe('icons', () => {
    const withState = (views: string) =>
      prepareSvelteComponent(
        `${domain.replace('</script>', " const State = type(['open', 'done']);</script>")}<script algorithm>@run[let state = State('open');]</script>${views}\n<Layout name="Main"><Node>{state}</Node></Layout>`
      );

    it('gives each value its own icon, an enumeration unordered, starting on distinct icons', () => {
      const { design } = withState('<View of="State" name="StateMark"><Node icon={this} /></View>');
      expect(design.space['StateMark=open.icon']).toEqual(iconNames);
      expect(starterValues(design)).toMatchObject({
        'StateMark=open.icon': 'circle',
        'StateMark=done.icon': 'circle-dot'
      });
      expect(design.space['StateMark.icon.from']).toBeUndefined();
    });

    it('gives a node drawing only an icon <Node>’s plain look, as a word, and a value cell linked to $cell its frame', () => {
      const { design } = withState(
        '<View of="State" name="StateMark"><Node icon={this} /></View>\n<View of="State" name="StateCell"><Node value={this} /></View>'
      );
      expect(design.bases).toMatchObject({ StateMark: '<Node>', StateCell: '<Node>' });
      expect(starterValues(design, { 'StateCell.inherit': '$cell' })).toMatchObject({
        'StateMark.fill': 'none',
        'StateMark.stroke': 'none',
        'StateMark.strokeWidth': 0,
        'StateMark.padding': 0,
        'StateMark.minSize': 0,
        'StateCell.fill': 'white',
        'StateCell.stroke': 'neutral-300',
        'StateCell.minSize': 2.5
      });
    });

    it('gives a bare icon one variable of its kind, starting unboxed on a distinct icon', () => {
      const { design } = withState(
        '<View of="State" name="StateMark"><Node layout="row"><Node kind="Mark" icon /><Node value={this} /></Node></View>'
      );
      expect(design.space['StateMark.Mark.icon']).toEqual(iconNames);
      expect(starterValues(design)['StateMark.Mark.icon']).toBe('circle-dot');
      expect(starterValues(design)['StateMark.Mark.fill']).toBe('none');
      expect(starterValues(design)['StateMark.Mark.stroke']).toBe('none');
      // Drawn at <Node>'s icon size, a bare icon alone having one.
      expect(starterValues(design)['StateMark.Mark.iconSize']).toBe(20);
      expect(design.space['StateMark.iconSize']).toBeUndefined();
    });

    it('refuses an icon written as it is, the design choosing each value’s', () => {
      expect(() =>
        withState('<View of="State" name="StateMark"><Node icon="flag" /></View>')
      ).toThrow(/icon stands for a view's value[\s\S]*circle, circle-dot/);
    });

    it('refuses an icon on a node arranging children', () => {
      expect(() =>
        withState(
          '<View of="State" name="StateMark"><Node layout="row" icon={this}><Node>{this}</Node></Node></View>'
        )
      ).toThrow(/arranges children, and an icon is drawn in a node of a value or of text/);
    });
  });

  it('gives each value of an unordered domain its own option, false the plainest', () => {
    const { design } = component(
      '<View of="Card" name="CardBox"><Node fill={this.seen}>{this.level}</Node></View>'
    );
    expect(design.space['CardBox=true.fill']).toContain('blue-200');
    expect(starterValues(design)).toMatchObject({
      'CardBox=false.fill': 'neutral-200',
      'CardBox=true.fill': 'blue-200'
    });
  });

  it('maps an ordered domain onto an ordered prop in order, from a first option', () => {
    const { design } = component(
      '<View of="Card" name="CardBox"><Node textSize={this.level}>{this.level}</Node></View>'
    );
    expect(design.space['CardBox.textSize.from']).toEqual([12, 14, 16, 18, 20, 24]);
    expect(design.space['CardBox.textSize.order']).toEqual(['up', 'down']);
    expect(starterValues(design)).toMatchObject({
      'CardBox.textSize.from': 16,
      'CardBox.textSize.order': 'up'
    });
  });

  it('runs an enumeration in its declared order, onto one hue’s shades or an ordered prop', () => {
    const states = (views: string) =>
      prepareSvelteComponent(
        `<script domain>const State = type(['Unseen', 'Queued', 'Done']);</script><script algorithm>@run[let s = State('Queued');]</script><View of="State" name="StateText"><Node value={this} /></View>\n${views}\n<Layout name="Main"><Node>{s}</Node></Layout>`
      );
    const coloured = states('<View of="State" name="Dot"><Node fill={this}>{this}</Node></View>');
    expect(coloured.design.space['Dot.fill.hue']).toContain('teal');
    expect(starterValues(coloured.design)).toMatchObject({
      'Dot.fill.hue': 'blue',
      'Dot.fill.order': 'up'
    });
    expect(coloured.design.space).not.toHaveProperty(['Dot=Unseen.fill']);
    const sized = states(
      '<View of="State" name="Dot"><Node strokeWidth={this}>{this}</Node></View>'
    );
    expect(sized.design.space['Dot.strokeWidth.from']).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(() =>
      states('<View of="State" name="Dot"><Node font={this}>{this}</Node></View>')
    ).toThrow(/an enumeration, whose values run in its declared order, and font's options do not/);
  });

  it('binds a position, its values one before its collection to its max', () => {
    const { design } = prepareSvelteComponent(
      `<script domain>const Int = type('integer', { min: 0, max: 9 }); const Values = array(Int, { max: 2 }); const Position = index(Values);</script><script input>const values = Values;</script><Case name="main" values={[4, 7]} /><script algorithm>@run[let i = Position(0);]</script><View of="Int" name="IntText"><Node value={this} /></View>\n<View of="Position" name="Faded"><Node opacity={this}>{this}</Node></View>\n<View of="Position" name="PositionText"><Node value={this} /></View>\n<Layout name="Main"><Node><Node>{#each values as v}{v}{/each}</Node>{i}</Node></Layout>`
    );
    // -1 to 2, four values, one to each of opacity's four options.
    expect(design.space['Faded.opacity.from']).toEqual([0.25]);
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
    expect(design.space['Bar.width.unit']).toEqual([1, 2, 3, 4, 6, 8, 12, 16, 24]);
    // The largest unit keeping 99, the largest Wide, within 200 pixels.
    expect(starterValues(design)['Bar.width.unit']).toBe(2);
    // From the left, as width runs, until the design places it otherwise; the width is the value,
    // so the kind has no width variable, and a variant naming one is told why.
    expect(design.space['Bar.xAnchor']).toEqual(['start', 'center', 'end']);
    expect(starterValues(design)['Bar.xAnchor']).toBe('start');
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
      `<script domain>const Flag = type('boolean'); const Vertex = record({ seen: Flag }); const Vertices = array(Vertex, { max: 2 }); const Position = index(Vertices); const Graph = record({ vertices: Vertices });</script><script input>const graph = Graph;</script><Case name="main" graph={{ vertices: [{ seen: false }, { seen: true }] }} /><script algorithm>@run[let done = Flag(false);]</script><View of="Flag" name="FlagText"><Node value={this} /></View>\n<View of="Graph" name="Drawing"><Node layout="row">{#each this.vertices as v, j}<Node kind="Dot" fill={v.seen} opacity={j}>x</Node>{/each}</Node></View>\n<Layout name="Main"><Node>{graph}{done}</Node></Layout>`
    );
    expect(starterValues(design)).toMatchObject({
      'Drawing.Dot=false.fill': 'neutral-200',
      'Drawing.Dot=true.fill': 'blue-200'
    });
    // j is a Position, -1 to 2: four values, one to each of opacity's four options.
    expect(design.space['Drawing.Dot.opacity.from']).toEqual([0.25]);
  });

  describe('a label’s operands', () => {
    const labelled = (bound: string, than = 'Level(2)') =>
      prepareSvelteComponent(
        `<script domain>const Level = type('integer', { min: 0, max: 3 }); const Levels = array(Level, { max: 3 }); const Position = index(Levels);</script><script input>const levels = Levels;</script><Case name="main" levels={[3, 1, 2]} /><script algorithm>@start[let i = Position(0);]\nwhile (@more[i < levels.length]) @step{ if (@test[levels[i] > ${than}]) @big[i++;] else @small[i++;] }</script><View of="Level" name="LevelText"><Node value={this} /></View>\n<View of="Position" name="Here"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>\n<View of="@step.test" name="Ask"><Node ${bound}>is {this.left} more than {this.right}?</Node></View>\n<Layout name="Main"><Node><Node>{#each levels as v}{v}{/each}</Node>{@step.test}{i}</Node></Layout>`
      );

    it('binds an operand by the type its runs gave it', () => {
      const { design } = labelled('opacity={this.left}');
      expect(design.space['Ask.opacity.from']).toEqual([0.25]);
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
    expect(starterValues(design)).toMatchObject({
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
      starterValues(
        prepareSvelteComponent(
          `<script domain>const Int = type('integer', { min: 0, max: 9 }); const Values = array(Int, { max: 6 }); const Queue = array(Int, { max: 6 });</script><script input>const values = Values; const queue = Queue;</script><Case name="main" values={[1, 2, 3]} queue={[1]} /><script algorithm>${algorithm}</script><View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Line"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<Layout name="Main"><Node layout="column"><Node layout="row" kind="Fixed">{#each values as v}{v}{/each}</Node><Node layout="column" kind="Growing">{#each queue as v}{v}{/each}</Node>{values}</Node></Layout>`
        ).design
      );
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

  it('has no variable for an axis the view sizes by its value, and warns why when one is chosen', async () => {
    const prepared = prepareSvelteComponent(
      source('<View of="Wide" name="Bar"><Node height={this} /></View>', '{wide}')
    );
    expect(prepared.design.space['Bar.height']).toBeUndefined();
    expect(starterValues(prepared.design)['Bar.yAnchor']).toBe('end');
    const { warnings } = await bundlePresentation(prepared, 1, {
      chosen: { 'Bar.height': 'varying' }
    });
    expect(warnings?.map(({ message }) => message)).toContain(
      "Bar's height is bound to its value in the view, height={…}, so it has no height variable; Bar.yAnchor places it. The value is left out."
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
    expect(design.space['Bar.Length.height.unit']).toBeDefined();
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
      'row and col outside a grid',
      '<Node layout="row"><Node row={0} col={0}>a</Node></Node>',
      /row places a node in a grid/
    ],
    [
      'a span outside a grid',
      '<Node layout="row"><Node colSpan={2}>a</Node></Node>',
      /colSpan places a node in a grid/
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

describe('tokens in captions', () => {
  const captioned = (caption: string) => `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 4 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
</script>
<script algorithm>
  @start[let i = Index(values, 0);]
  while (@more[i < values.length]) @next[i++;]
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Index" name="Mark"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
<Layout name="Board">
  <Node layout="column">
    <Node layout="row">{#each values as v}{v}{/each}</Node>
    <Node kind="Note">${caption}</Node>
    {i}
  </Node>
</Layout>
<Case name="main" values={[3, 1]} />
<Storyboard>
  <Scene name="scan" case="main" pause="@next.end"><Board /></Scene>
</Storyboard>`;

  it('draws a token as inline code, a kind of its own in monospace, linked to its place', () => {
    const { design } = prepareSvelteComponent(captioned('Look at :i[A[i]].'));
    expect(starterValues(design)['Board.Note.Code.font']).toBe('mono');
    expect(design.space).toHaveProperty('<Listing>.places');
  });

  it('refuses a token naming a place nothing renders, and a node written with __code', () => {
    expect(() => prepareSvelteComponent(captioned('Look at :j[A[j]].'))).toThrow(
      'The token :j[…] names :j, which the view renders nowhere'
    );
    expect(() => prepareSvelteComponent(captioned('<Node __code="@i">A[i]</Node>'))).toThrow(
      '__code is reserved for the library'
    );
  });
});

describe('starter looks of a graph', () => {
  const graph = `<script domain>
  const Name = type(['A', 'B', 'C']);
  const State = type(['unseen', 'seen']);
  const Vertex = record({ name: Name, state: State });
  const Vertices = array(Vertex, { max: 3 });
  const VertexRef = index(Vertices);
  const Weight = type('integer', { min: 1, max: 9 });
  const Edge = record({ from: VertexRef, to: VertexRef, weight: Weight });
  const Edges = array(Edge, { max: 3 });
</script>
<script input>
  const vertices = Vertices;
  const edges = Edges;
</script>
<script algorithm>
  @mark[vertices[0].state = 'seen';]
</script>
<View of="Name" name="NameText"><Node value={this} /></View>
<View of="State" name="StateText"><Node value={this} /></View>
<View of="Weight" name="WeightText"><Node value={this} /></View>
<View of="Vertex" name="VertexCard">
  <Node layout="column">
    <Node kind="VertexName">{this.name}</Node>
    <Node kind="StateLabel">{this.state}</Node>
  </Node>
</View>
<Layout name="Graph">
  <Node>
    <Node layout="free">
      {#each vertices as vertex}<Node>{vertex}</Node>{/each}
      {#each edges as edge}<Link from={edge.from} to={edge.to}>{edge.weight}</Link>{/each}
    </Node>
  </Node>
</Layout>
<Case name="main" vertices={[{ name: 'A', state: 'unseen' }, { name: 'B', state: 'unseen' }, { name: 'C', state: 'unseen' }]}
  edges={[{ from: 0, to: 1, weight: 2 }, { from: 1, to: 2, weight: 5 }]} />
<Storyboard>
  <Scene name="main" case="main" pause="@mark.end"><Graph /></Scene>
</Storyboard>`;

  it('starts a link label unboxed, the stage white behind it, so the line breaks round it', () => {
    const { design } = prepareSvelteComponent(graph);
    expect(starterValues(design)['WeightText:edge.weight.fill']).toBe('white');
    expect(starterValues(design)['WeightText:edge.weight.stroke']).toBe('none');
    // Its own paint, not its kind's; its kind's look is what it links, as the template's $label.
    expect(design.fallbacks['WeightText:edge.weight.fill']).toBeUndefined();
    expect(starterValues(design)['WeightText.stroke']).toBe('none');
    expect(starterValues(design, { 'WeightText.inherit': '$label' })['WeightText.textSize']).toBe(
      14
    );
  });

  it('starts the fields of a view of a record arranging its parts unboxed, its card linking $card the one box', () => {
    const { design } = prepareSvelteComponent(graph);
    const card = starterValues(design, { 'VertexCard.inherit': '$card' });
    expect(card['VertexCard.fill']).toBe('white');
    expect(card['VertexCard.stroke']).toBe('neutral-300');
    expect(card['VertexCard.gap']).toBe(0.25);
    expect(starterValues(design)['VertexCard.fill']).toBe('none');
    expect(card['VertexCard.NameText:this.name.fill']).toBe('none');
    expect(card['VertexCard.StateText:this.state.stroke']).toBe('none');
    expect(design.fallbacks['VertexCard.NameText:this.name.fill']).toBeUndefined();
  });

  it('gives the nodes a free layout’s links join the props their function gives, as any node', async () => {
    const { readFileSync } = await import('node:fs');
    const dfa = readFileSync('src/lib/modes/sverlin/fixtures/dfa-loops.sverlin', 'utf8');
    const { design } = prepareSvelteComponent(dfa);
    // <Node kind="StateSlot">{state}</Node> holds a render: a node, its value boxed by its own view.
    expect(design.bases['StateDiagram.StateSlot']).toBe('<Node>');
    expect(design.space['StateDiagram.StateSlot.gap']).toBeUndefined();
    expect(starterValues(design)['StateDiagram.StateSlot.radius']).toBe(0);
    expect(starterValues(design)['StateDiagram.StateSlot.fill']).toBe('none');
  });
});

describe('views of a union', () => {
  /** The geometry the page is given, with each component's box. */
  const unionGeometry = (built: { geometry: unknown }) =>
    built.geometry as { components: [string, { width: number }][] };

  it('gives the views of a union’s members one box, so a cell holding the narrower member is as wide as the rest', async () => {
    const source = `<script domain>
  const Distance = type('integer', { min: 0, max: 999 });
  const Infinite = type(['∞']);
  const Dist = union(Distance, Infinite);
  const Row = array(Dist, { max: 3 });
</script>
<script input>
  const row = Row;
</script>
<script algorithm>
  @look[row[0] = row[0];]
</script>
<View of="Distance" name="DistanceCell"><Node value={this} /></View>
<View of="Infinite" name="InfinityCell"><Node value={this} /></View>
<View of="Row" name="Cells"><Node layout="row">{#each this as d}<Node kind="Cell">{d}</Node>{/each}</Node></View>
<Layout name="Main"><Node>{row}</Node></Layout>
<Case name="main" row={[5, '∞', 12]} />
<Storyboard><Scene name="main" case="main" pause="@look.end"><Main /></Scene></Storyboard>`;
    const prepared = prepareSvelteComponent(source);
    const probe = (name: string) =>
      prepared.components.find((component) => component.name === name);
    expect(probe('DistanceCell')?.unions).toEqual(['Dist']);
    expect(probe('InfinityCell')?.unions).toEqual(['Dist']);
    const order = prepared.components.map(({ name }) => name);
    expect(order.indexOf('Cells')).toBeGreaterThan(order.indexOf('InfinityCell'));
    const built = await bundlePresentation(prepared, 1, {});
    const boxes = new Map(unionGeometry(built).components);
    expect(boxes.get('InfinityCell|Dist')?.width).toBe(boxes.get('DistanceCell|Dist')?.width);
  });

  it('keeps a member’s own box where it draws a value outside the union, as an index drawn alone', async () => {
    // Project 97eba2f1: every index was as wide as "not found", the search result's other member,
    // whatever its text size.
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 4 });
  const Index = index(Values);
  const Status = type(['not found']);
  const Result = union(Index, Status);
</script>
<script input>
  const values = Values;
</script>
<script algorithm>
  @look[let lo = Index(values, 0); let result = Result(Status('not found'));]
</script>
<View of="Index" name="IndexNumber"><Node value={this} /></View>
<View of="Status" name="StatusWord"><Node value={this} /></View>
<Layout name="Main"><Node layout="row">{lo}{result}</Node></Layout>
<Case name="main" values={[1, 2, 3]} />
<Storyboard><Scene name="main" case="main" pause="@look.end"><Main /></Scene></Storyboard>`;
    const built = await bundlePresentation(prepareSvelteComponent(source), 1, {});
    const boxes = new Map(unionGeometry(built).components);
    expect(boxes.get('IndexNumber|Result')?.width).toBe(boxes.get('StatusWord|Result')?.width);
    expect(boxes.get('IndexNumber')!.width).toBeLessThan(boxes.get('StatusWord')!.width);
  });
});

describe('cases', () => {
  it('types a variable the first case never reaches by the cases that do', () => {
    // With one value the loop never runs, so j is declared only in the second case.
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 4 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
</script>
<script algorithm>
  for (@first[let i = Index(values, 1)]; @more[i < values.length]; @next[i++]) @pass{
    @init[let j = i;]
    while (@test[j > 0 && values[j - 1] > values[j]]) @shift{
      const held = values[j];
      values[j] = values[j - 1];
      values[j - 1] = held;
      j--;
    }
  }
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Index" name="Mark"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
<Layout name="Board">
  <Node>
    <Node>{#each values as v}{v}{/each}</Node>
    {j}
  </Node>
</Layout>
<Case name="one" values={[4]} />
<Case name="many" values={[3, 1, 2]} />
<Storyboard>
  <Scene name="one" case="one" pause="@pass.shift.end"><Board /></Scene>
  <Scene name="many" case="many" pause="@pass.shift.end"><Board /></Scene>
</Storyboard>`;
    expect(() => prepareCurrent(source)).not.toThrow();
  });

  it('tells an algorithm that fails to run alone, not each value it would have typed as text', () => {
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 4 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
</script>
<script algorithm>
  for (@first[let i = Index(values, 0)]; @more[i < values.length]; @next[i++]) @scan{
    if (@big[values[i] > 5]) @stop{ break; }
    values[i] = values[i] + 1;
  }
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Index" name="Mark"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
<Layout name="Board">
  <Node>
    <Node>{#each values as v}{v}{/each}</Node>
    {i}
  </Node>
</Layout>
<Case name="main" values={[3, 1, 7]} />
<Storyboard>
  <Scene name="main" case="main" pause="@scan.end"><Board /></Scene>
</Storyboard>`;
    let messages = '';
    try {
      prepareCurrent(source);
    } catch (cause) {
      const error = cause as Error & { others?: Error[] };
      messages = [error, ...(error.others ?? [])].map(({ message }) => message).join('\n');
    }
    expect(messages).toContain('in none of the labels beside it');
    expect(messages).not.toContain('Text outside a <Node>');
  });

  it('tells an algorithm that fails to run alone, not each bound prop as unknown before the run', () => {
    // Project 763e0a02: fill={this.state} on an enumeration was refused beside the failing
    // algorithm, as was every bound prop, burying the one real problem.
    const source = `<script domain>
  const State = type(['seen', 'unseen']);
  const Name = type(['A', 'B']);
  const Vertex = record({ name: Name, state: State });
  const Vertices = array(Vertex, { max: 3 });
  const Index = index(Vertices);
</script>
<script input>
  const vertices = Vertices;
</script>
<script algorithm>
  for (@first[let i = Index(vertices, 0)]; @more[i < vertices.length]; @next[i++]) @visit{
    let junk = 1;
    @mark[vertices[i].state = 'seen';]
  }
</script>
<View of="Name" name="NameText"><Node value={this} /></View>
<View of="State" name="StateText"><Node value={this} /></View>
<View of="Vertex" name="Card"><Node fill={this.state}>{this.name}</Node></View>
<View of="Vertices" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<Layout name="Main"><Node>{vertices}</Node></Layout>
<Case name="main" vertices={[{ name: 'A', state: 'unseen' }, { name: 'B', state: 'unseen' }]} />
<Storyboard><Scene name="s" case="main" pause="@visit.mark.end"><Main /></Scene></Storyboard>`;
    let messages = '';
    try {
      prepareCurrent(source);
    } catch (cause) {
      const error = cause as Error & { others?: Error[] };
      messages = [error, ...(error.others ?? [])].map(({ message }) => message).join('\n');
    }
    expect(messages).toContain('plain number 1');
    expect(messages).not.toContain('cannot be known before the algorithm runs');
    // With the algorithm fixed, the same bound prop builds.
    expect(() => prepareCurrent(source.replace('let junk = 1;\n', ''))).not.toThrow();
  });
});

describe('case inputs', () => {
  it('shows a word given as text in quotes how to write it, not as a number', () => {
    const source = `<script domain>
  const Suit = type(['hearts', 'spades']);
</script>
<script input>
  const suit = Suit;
</script>
<script algorithm>
  @begin[let shown = Suit(suit);]
</script>
<View of="Suit" name="SuitWord"><Node value={this} /></View>
<Layout name="Main"><Node><Node>{shown}</Node></Node></Layout>
<Case name="main" suit="hearts" />
<Storyboard>
  <Scene name="main" case="main" pause="@begin.end"><Main /></Scene>
</Storyboard>`;
    expect(() => prepareCurrent(source)).toThrow(/suit=\{'hearts'\}/u);
  });
});

describe('listing names', () => {
  it.each(['C code', 'c++', 'Python 3'])(
    'takes a listing named %s, whose first word chooses its language',
    (name) => {
      const source = listingPython.replace(
        '<script listing="python">',
        `<script listing="${name}">`
      );
      expect(() => prepareCurrent(source)).not.toThrow();
    }
  );
});
