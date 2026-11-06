import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildBatch } from './build.server';
import { prepareSvelteComponent } from './compile.server';
import { bundlePresentation } from './testing/scenes';
import { serverMeasure } from './fonts/measure.server';
import { type Geometry } from './library/geometry';
import { parseSheet } from './library/model/css';
import { layOut } from './library/model/layout';
import type { ModelElement } from './library/model/tree';
import { fontList, iconGlyph, iconNames } from './library/fonts';
import { layOutOnServer } from './layout.server';
import { differingSteps } from '$lib/shared/differing-steps';
import { smallestReadableText } from '$lib/shared/readability';

// Every label paused at, the finest steps a source has, as the starter was before it thinned them.
/** A source prepared with its scene pausing at every label. */
const everyPause = (source: string) => {
  const labels = prepareSvelteComponent(source).pauses.labels.map((label) => `@${label}`);
  return prepareSvelteComponent(source.replace(/pause="[^"]*"/u, `pause="${labels.join(', ')}"`));
};

/** A server bundle whose layout answers with what it is given, as geometry would come back. */
const answering = (body: string) =>
  `globalThis.__sverlinLayOut = async (devicePixelRatio) => JSON.stringify((() => { ${body} })());`;

describe('laying out on the server', () => {
  it('runs the presentation with nothing of Node in reach', async () => {
    const { geometry, failure } = await layOutOnServer(
      answering(
        `return { borders: [], seen: [typeof process, typeof require, typeof fetch, typeof setTimeout] };`
      )
    );
    expect(failure).toBeUndefined();
    expect((geometry as unknown as { seen: string[] }).seen).toEqual([
      'undefined',
      'undefined',
      'undefined',
      'undefined'
    ]);
  });

  it('stops a presentation that never ends, and one that takes too much memory', async () => {
    const brief = { memoryMb: 64, loadMs: 1000, layOutMs: 1000 };
    const endless = await layOutOnServer(answering('for (;;) {}'), brief);
    expect(endless.geometry).toBeUndefined();
    expect(endless.failure).toMatch(/time/iu);
    const hungry = await layOutOnServer(
      answering('const kept = []; for (;;) kept.push(new Array(1e6).fill(1));'),
      brief
    );
    expect(hungry.geometry).toBeUndefined();
    expect(hungry.failure).toMatch(/memory|disposed/iu);
  }, 120_000);

  it('reports a text no embedded font draws', async () => {
    const { geometry, failure } = await layOutOnServer(
      answering(
        `__sverlinHost.width('a 漢字', "normal 400 16px 'Vis Sans', 'Vis Symbols', system-ui"); return { borders: [] };`
      )
    );
    expect(geometry).toBeUndefined();
    expect(failure).toBe('no embedded font has 漢 字');
  });

  it('routes each free layout’s links at every state, the page drawing them as given', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/bfs-captions.sverlin', 'utf8');
    const prepared = prepareSvelteComponent(source);
    const { geometry, labels } = await bundlePresentation(prepared, 1, {});
    // Every state of every step has its routes.
    {
      const [[, sets]] = geometry.routes ?? [];
      const states = new Set(sets.flatMap(([drawing]) => drawing));
      for (let step = 0; step < labels.length; step++) expect(states).toContain(2 * step + 1);
      expect(sets.every(([, edges]) => edges.every(({ path }) => path.startsWith('M')))).toBe(true);
    }
  });

  it('gives every step of a presentation, and keeps it for the next asking', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/search-at.sverlin', 'utf8');
    const prepared = prepareSvelteComponent(source);
    const first = await bundlePresentation(prepared, 1, {});
    expect(first.layout).toMatchObject({ cached: false, errors: [] });
    expect(first.layout.scenes?.steps.length).toBe(first.labels.length);
    const again = await bundlePresentation(prepared, 1, {});
    expect(again.layout?.cached).toBe(true);
    expect(again.javascript).toBe(first.javascript);
  }, 60_000);

  it('fails the build of a presentation the server cannot lay out, saying what to change', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/search-at.sverlin', 'utf8');
    const [result] = await buildBatch(source.replace('<Node>lo</Node>', '<Node>漢字</Node>'), [
      { seed: 1 }
    ]);
    expect(result).toMatchObject({ ok: false, failureKind: 'source' });
    expect(result.ok || result.diagnostics[0]).toMatchObject({
      code: 'layout_failed',
      message: expect.stringContaining('characters no embedded font has (漢 字)')
    });
  }, 60_000);

  it('measures how large it draws on a typical stage', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/search-at.sverlin', 'utf8');
    const prepared = prepareSvelteComponent(source);
    const { geometry, layout } = await bundlePresentation(prepared, 1);
    const { readability } = layout;
    // The frame and fit it is measured at are those the page is given and draws at.
    const given = geometry;
    expect(readability?.frame.height).toBe(given.frame?.height);
    expect(readability?.scale).toBeCloseTo(
      (given.frame?.fit ?? 0) * Math.min(928 / 1200, 608 / (given.frame?.height ?? 1))
    );
    // Seven cells and two bounds fit the frame at their written size or larger, as most text is 16 px.
    expect(readability?.scale).toBeGreaterThan(0.5);
    expect(readability?.text).toBeGreaterThanOrEqual(smallestReadableText);
    expect(readability?.smallest).toBeLessThanOrEqual(readability?.text ?? 0);
    // The content as drawn covers part of the frame, its padding the rest.
    expect(readability?.fill).toBeGreaterThan(0);
    expect(readability?.fill).toBeLessThanOrEqual(1);
  }, 60_000);

  it('describes what each step draws, alike where a value changes nothing seen', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/search-at.sverlin', 'utf8');
    const prepared = everyPause(source);
    const drawnWith = async (seed: number, chosen: Record<string, string | number>) =>
      (await bundlePresentation(prepared, seed, { chosen })).layout.drawn;
    const starter = await drawnWith(1, {});
    // Steps drawing what the step before drew are left out: a loop's test, and the steps setting
    // only mid, which the view does not read.
    expect(starter).toHaveLength(5);
    // Another seed places nothing here.
    expect(await drawnWith(2, {})).toEqual(starter);
    // The link's target fill shows from the second step, where mid first points into the cells.
    expect(
      differingSteps(starter, await drawnWith(2, { 'Arrow.Link.targetFill': 'red-200' }))
    ).toEqual(Array.from({ length: 4 }, (_, index) => index + 1));
  }, 60_000);

  it('fails a view that fails to draw its steps, which would otherwise all seem alike', async () => {
    // Project 0c34d124's first source: its view calls the domain's DeltaIndex, which it cannot reach.
    const source = readFileSync('src/lib/modes/sverlin/fixtures/dfa-panels.sverlin', 'utf8')
      .replaceAll(
        '{#each states as state, k}',
        '{#each states as state, k}{@const row = DeltaIndex(delta, k)}'
      )
      .replaceAll('delta[k]', 'delta[row]');
    const [result] = await buildBatch(source, [{ seed: 1 }]);
    expect(result.ok || result.diagnostics[0]).toMatchObject({
      code: 'draw_failed',
      message: expect.stringMatching(
        /^The view failed to draw at steps 1, 3, .*: DeltaIndex is not defined\./u
      )
    });
  }, 60_000);

  it('draws differently for a panel shown or not, and alike for the same choices', async () => {
    const prepared = prepareSvelteComponent(
      readFileSync('src/lib/modes/sverlin/fixtures/dfa-panels.sverlin', 'utf8')
    );
    const drawnWith = async (chosen: Record<string, string | boolean>) =>
      (await bundlePresentation(prepared, 1, { chosen })).layout.drawn ?? [];
    const graph = await drawnWith({ 'Graph.shown': true, 'Table.shown': false });
    const every = graph.map((_, step) => step);
    // The project's comparison: a graph or a table, free-layout nodes against a grid.
    expect(
      differingSteps(graph, await drawnWith({ 'Graph.shown': false, 'Table.shown': true }))
    ).toEqual(every);
    expect(
      differingSteps(graph, await drawnWith({ 'Graph.shown': true, 'Table.shown': false }))
    ).toEqual([]);
    const shown = await drawnWith({});
    expect(differingSteps(shown, await drawnWith({ 'listing.language': 'none' }))).toEqual(every);
  }, 120_000);

  it('counts the steps where labels differ, the room their lanes keep included', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/search-labels.sverlin', 'utf8');
    const prepared = everyPause(source);
    const drawnWith = async (labels: boolean) =>
      (
        await bundlePresentation(prepared, 1, {
          chosen: {
            'views.Index:lo': 'LowerMark',
            'views.Index:hi': 'UpperMark',
            'LowerMark.LowerLabel.shown': labels,
            'UpperMark.UpperLabel.shown': labels
          }
        })
      ).layout?.drawn;
    const labelled = await drawnWith(true);
    // A label's lane keeps its room at every step, before lo and hi are set too, so the two differ
    // at every step.
    expect(differingSteps(labelled, await drawnWith(false))).toEqual(
      Array.from({ length: 5 }, (_, index) => index)
    );
    expect(differingSteps(labelled, await drawnWith(true))).toEqual([]);
  }, 60_000);

  it('keeps the room of a node sized by its value at its type’s largest value times its unit', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/bars.sverlin', 'utf8');
    const { geometry, layout } = await bundlePresentation(prepareSvelteComponent(source), 1);
    expect(layout.errors).toEqual([]);
    const given = geometry;
    // Values up to 9 at the starter's 16 pixels per unit: 144 pixels, whatever the input reaches.
    expect(new Map(given.components).get('Bar')?.height).toBe(144);
  }, 60_000);

  it('keeps room round each box for the paint it reaches past it with, in every state', async () => {
    const size = async (shadow: string) => {
      const source = `<script domain>const Int = type('integer', { min: 0, max: 9 }); const Values = array(Int, { max: 3 }); const Index = index(Values);</script><script input>const values = Values;</script><Case name="main" values={[1, 2, 3]} /><script algorithm>@start[let i = Index(0);]
while (@more[i < 2]) @next[i++;]</script><View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Here"><Node layout="column"><Link to={this} /><Node kind="Caption">{place()}</Node></Node></View>
<Layout name="Main" of="values, i"><Node>{values}{i}</Node></Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} i={i} /></Scene>
</Storyboard>`;
      const { geometry, layout } = await bundlePresentation(prepareSvelteComponent(source), 1, {
        chosen: { 'Cell.shadow': shadow, 'Row.gap': 0, 'Cell.glow': 'on' }
      });
      expect(layout.errors).toEqual([]);
      const given = geometry;
      return new Map(given.components).get('Row')!;
    };
    const plain = await size('none');
    const lifted = await size('lifted');
    // Every cell keeps its glow's 10 pixels each side. Lifted reaches 12 each side, 8 above and 16 below: 2 more on each side of each of
    // the three cells and 6 more below, and nothing more above.
    expect(lifted.width - plain.width).toBeCloseTo(3 * 4, 0);
    expect(lifted.height - plain.height).toBeCloseTo(6, 0);
  }, 60_000);

  it('keeps a view’s room for every branch it could draw, not only those the input takes', async () => {
    const box = async (cell: string) => {
      const source = `<script domain>const Int = type('integer', { min: 0, max: 999 }); const Values = array(Int, { max: 2 });</script><script input>const values = Values;</script><Case name="main" values={[1, 2]} /><script algorithm>@run[values[0] = Int(3);]</script><View of="Int" name="Cell">${cell}</View>\n<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>\n<Layout name="Main" of="values"><Node>{values}</Node></Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} /></Scene>
</Storyboard>`;
      const { geometry, layout } = await bundlePresentation(prepareSvelteComponent(source), 1);
      expect(layout.errors).toEqual([]);
      const given = geometry;
      return new Map(given.components).get('Cell')!;
    };
    const plain = await box('<Node layout="row"><Node value={this} /></Node>');
    // No input value is 7, and 0 to 999 is too many to draw each: only the branch's being measured
    // either way gives it room.
    const lucky = await box(
      '<Node layout="row"><Node value={this} />{#if this === 7}<Node>lucky</Node>{/if}</Node>'
    );
    expect(lucky.width).toBeGreaterThan(plain.width + 20);
  }, 60_000);

  it('keeps a grid’s columns for every coordinate its type allows, not only those the input reaches', async () => {
    const tracks = async (col: string) => {
      const source = `<script domain>const Int = type('integer', { min: 0, max: 9 }); const Values = array(Int, { max: 5 });</script><script input>const values = Values;</script><Case name="main" values={[1, 2]} /><script algorithm>@run[values[0] = Int(3);]</script><View of="Int" name="Cell"><Node value={this} /></View>\n<Layout name="Main" of="values"><Node><Node layout="grid">{#each values as v, i}<Node row={0} col={${col}}>{v}</Node>{/each}</Node></Node></Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} /></Scene>
</Storyboard>`;
      const { geometry, layout } = await bundlePresentation(prepareSvelteComponent(source), 1);
      expect(layout.errors).toEqual([]);
      const given = geometry;
      return given.tracks[0][1];
    };
    // Two values drawn, but i runs to the max's 4: five columns, each room for a cell.
    const plain = await tracks('i');
    expect(plain.columns).toHaveLength(5);
    expect(new Set(plain.columns).size).toBe(1);
    // Only even columns can hold a cell, so the odd ones stay gaps.
    const even = await tracks('2 * i');
    expect(even.columns).toHaveLength(9);
    expect(even.columns.filter((width, index) => index % 2 === 1 && width > 0)).toEqual([]);
  }, 60_000);

  it('keeps a collection’s room at its type’s max, whatever the input’s length', async () => {
    const widest = async (max: number, input: string) => {
      const source = `<script domain>const Int = type('integer', { min: 0, max: 9 }); const Values = array(Int, { max: ${max} });</script><script input>const values = Values;</script><Case name="main" values={${input}} /><script algorithm>@run[values[0] = Int(9);]</script><View of="Int" name="IntCell"><Node value={this} /></View>\n<Layout name="Main" of="values"><Node><Node>{#each values as v}{v}{/each}</Node></Node></Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} /></Scene>
</Storyboard>`;
      const { geometry, layout } = await bundlePresentation(prepareSvelteComponent(source), 1);
      expect(layout.errors).toEqual([]);
      const given = geometry;
      return Math.max(...given.reserved.map(([, size]) => size.width));
    };
    const four = await widest(8, '[1, 2, 3, 4]');
    expect(await widest(8, '[1, 2, 3, 4, 5, 6, 7, 8]')).toBe(four);
    expect(await widest(4, '[1, 2, 3, 4]')).toBeLessThan(four);
  }, 60_000);

  it('keeps each grid column and row at its largest, and warns of two cells at one coordinate', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/lcs-grid.sverlin', 'utf8');
    const { geometry, layout } = await bundlePresentation(prepareSvelteComponent(source), 1);
    expect(layout.errors).toEqual([]);
    const given = geometry;
    // The headers at row 0 and col 0 and the table from 1: six of each, the corner left empty.
    const [[, tracks]] = given.tracks;
    expect(tracks.columns).toHaveLength(6);
    expect(tracks.rows).toHaveLength(6);
    expect(Math.min(...tracks.columns, ...tracks.rows)).toBeGreaterThan(0);
    const twice = source.replace('row={i + 1} col={j + 1}', 'row={i} col={j + 1}');
    const drawnTwice = await bundlePresentation(prepareSvelteComponent(twice), 1);
    expect(drawnTwice.warnings?.map(({ message }) => message)).toContainEqual(
      expect.stringMatching(/^Two cells of a grid cover row 0, col 2 at one step/u)
    );
  }, 60_000);
  it('gives a grid in a view one set of tracks, its widest over every value, that every copy shares', async () => {
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 999 });
  const Row = array(Int, { max: 2 });
  const Table = array(Row, { max: 2 });
</script>
<script input>
  const a = Table;
  const b = Table;
</script><Case name="main" a={[[1, 2], [3, 4]]} b={[[5, 6], [7, 8]]} />
<script algorithm>
  @grow[a[0][0] = Int(999);]
</script>
<View of="Int" name="Numeral"><Node value={this} /></View>
<View of="Table" name="Grid">
  <Node layout="grid">{#each this as cells, i}{#each cells as cell, j}<Node row={i} col={j}>{cell}</Node>{/each}{/each}</Node>
</View>
<Layout name="Main" of="a, b"><Node layout="row">{a}{b}</Node></Layout>

<Storyboard>
  <Scene name="main" case="main"><Main a={a} b={b} /></Scene>
</Storyboard>`;
    const { geometry, layout } = await bundlePresentation(prepareSvelteComponent(source), 1);
    expect(layout.errors).toEqual([]);
    const given = geometry;
    // One set for the view's grid, drawn for a and b: every column as wide as 999 needs from the
    // first step, as the view is probed with the widest values, so nothing moves when 999 appears.
    const inView = given.tracks.filter(([key]) => key.startsWith('view:'));
    expect(inView).toHaveLength(1);
    const [[, tracks]] = inView;
    expect(tracks.columns).toHaveLength(2);
    expect(tracks.rows).toHaveLength(2);
    expect(tracks.columns[0]).toBe(tracks.columns[1]);
    const box = new Map(given.components).get('Grid');
    expect(box?.width).toBeGreaterThanOrEqual(tracks.columns[0] + tracks.columns[1]);
  }, 60_000);

  it('lays a node out in its case, wider uppercase, alike at the starter', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/search-at.sverlin', 'utf8');
    const prepared = prepareSvelteComponent(source);
    const geometryOf = async (chosen: Record<string, string>) => {
      const { geometry } = await bundlePresentation(prepared, 1, { chosen });
      return [geometry];
    };
    const reservedWidth = (geometries: Geometry[]) =>
      geometries[0].reserved.reduce((sum, [, { width }]) => sum + width, 0);
    const starter = await geometryOf({});
    expect(await geometryOf({ 'Bounds.case': 'normal' })).toEqual(starter);
    expect(reservedWidth(await geometryOf({ 'Bounds.case': 'uppercase' }))).toBeGreaterThan(
      reservedWidth(starter)
    );
  }, 60_000);
});

describe('text measured on the server', () => {
  const sans = "normal 400 16px 'Vis Sans', 'Vis Symbols', system-ui, sans-serif";

  it('draws a character its face lacks in the embedded fallback, and says which it cannot', () => {
    const measure = serverMeasure();
    // ⊕ is in no text face, only in the fallback.
    expect(measure.width('a ⊕ b', sans)).toBeGreaterThan(measure.width('a b', sans));
    expect(measure.missing.size).toBe(0);
    measure.width('🙂', sans);
    expect([...measure.missing]).toEqual(['🙂']);
  });

  it('draws an icon in the embedded icon face, each the same advance, as the page does', () => {
    const measure = serverMeasure();
    const font = `normal 700 20px ${fontList('sans')}`;
    for (const name of iconNames)
      expect(measure.width(iconGlyph(name) ?? '', font)).toBeCloseTo(17, 5);
    expect(measure.missing.size).toBe(0);
  });

  it('measures a case through the layout model as the page draws it', () => {
    const measure = serverMeasure();
    const family = fontList('sans');
    const font = (size: number) => `normal 700 ${size}px ${family}`;
    const advance = (width: number) => Math.ceil(width * 64 - 1e-6) / 64;
    const widthIn = (style: Record<string, string>) => {
      const text: ModelElement = { tag: 'span', attributes: {}, style: {}, children: ['Lo, hi'] };
      const root: ModelElement = {
        tag: 'div',
        attributes: {},
        style: { 'font-family': family, 'font-weight': '700', 'font-size': '20px', ...style },
        children: [text]
      };
      return layOut(root, { rules: parseSheet(''), measure }).boxes.get(text)?.width;
    };
    expect(widthIn({})).toBe(advance(measure.width('Lo, hi', font(20))));
    expect(widthIn({ 'text-transform': 'uppercase' })).toBe(
      advance(measure.width('LO, HI', font(20)))
    );
    // Synthesized small caps: the capitals and punctuation at 20px, the rest uppercased at 14px.
    expect(widthIn({ 'font-variant-caps': 'small-caps' })).toBe(
      advance(
        measure.width('L', font(20)) +
          measure.width('O', font(14)) +
          measure.width(', ', font(20)) +
          measure.width('HI', font(14))
      )
    );
    expect(widthIn({ 'text-transform': 'uppercase' })).toBeGreaterThan(widthIn({}) as number);
  });

  it('takes the bold face from 600 and a size in whole 64ths of a pixel', () => {
    const measure = serverMeasure();
    const at = (weight: number, size: number) =>
      measure.width('Distance', `normal ${weight} ${size}px 'Vis Sans', system-ui`);
    expect(at(600, 16)).toBe(at(700, 16));
    expect(at(500, 16)).toBe(at(400, 16));
    expect(at(400, 13.6)).toBe(at(400, 13.59375));
  });
});

describe('link labels', () => {
  const source = readFileSync('src/lib/modes/sverlin/fixtures/dijkstra.sverlin', 'utf8');

  it('start as plain text where their type is drawn only on links, keeping room for the words', async () => {
    const prepared = prepareSvelteComponent(source);
    expect(prepared.design.starter).toMatchObject({
      'WeightText.padding': 0,
      'WeightText.minSize': 0,
      'WeightText.stroke': 'none',
      'WeightText.fill': 'white',
      'WeightText.textSize': 14
    });
    const width = async (chosen: Record<string, string | number> = {}) =>
      (await bundlePresentation(prepared, 1, { chosen })).layout.readability?.content.width ?? 0;
    // Boxed as a value, the labels need more room between the vertices.
    const boxed = {
      'WeightText.padding': 0.375,
      'WeightText.minSize': 2.5,
      'WeightText.textSize': 20
    };
    expect(await width()).toBeLessThan(await width(boxed));
  });

  it('keep the box of a type also drawn elsewhere, only unboxed on the line', () => {
    const shared = source.replace(
      '<View of="Weight" name="WeightText"><Node value={this} /></View>',
      '<View of="Weight" name="WeightText"><Node value={this} /></View>\n<Layout name="Extra" of="edges"><Node>{edges[0].weight}</Node></Layout>'
    );
    expect(prepareSvelteComponent(shared).design.starter['WeightText.minSize']).not.toBe(0);
  });
});
