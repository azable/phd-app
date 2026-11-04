import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildBatch } from './build.server';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { serverMeasure } from './fonts/measure.server';
import { geometryFor, geometryVersion, type Geometry } from './library/geometry';
import { parseSheet } from './library/model/css';
import { layOut } from './library/model/layout';
import type { ModelElement } from './library/model/tree';
import { fontList } from './library/fonts';
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
    const { geometries, failure } = await layOutOnServer(
      answering(
        `return { borders: [], seen: [typeof process, typeof require, typeof fetch, typeof setTimeout] };`
      )
    );
    expect(failure).toBeUndefined();
    expect((geometries?.[0] as unknown as { seen: string[] }).seen).toEqual([
      'undefined',
      'undefined',
      'undefined',
      'undefined'
    ]);
  });

  it('stops a presentation that never ends, and one that takes too much memory', async () => {
    const brief = { memoryMb: 64, loadMs: 1000, layOutMs: 1000 };
    const endless = await layOutOnServer(answering('for (;;) {}'), brief);
    expect(endless.geometries).toBeUndefined();
    expect(endless.failure).toMatch(/time/iu);
    const hungry = await layOutOnServer(
      answering('const kept = []; for (;;) kept.push(new Array(1e6).fill(1));'),
      brief
    );
    expect(hungry.geometries).toBeUndefined();
    expect(hungry.failure).toMatch(/memory|disposed/iu);
  }, 120_000);

  it('reports a text no embedded font draws', async () => {
    const { geometries, failure } = await layOutOnServer(
      answering(
        `__sverlinHost.width('a 漢字', "normal 400 16px 'Vis Sans', 'Vis Symbols', system-ui"); return { borders: [] };`
      )
    );
    expect(geometries).toBeUndefined();
    expect(failure).toBe('no embedded font has 漢 字');
  });

  it('gives every step of a presentation, and keeps it for the next asking', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/search-at.sverlin', 'utf8');
    const prepared = prepareSvelteComponent(source);
    const first = await bundlePresentation(prepared, 1, {});
    expect(first.layout).toMatchObject({ cached: false, errors: [] });
    expect(first.javascript.startsWith('window.__sverlinGeometry=[')).toBe(true);
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
    const { javascript, layout } = await bundlePresentation(prepared, 1);
    const { readability } = layout;
    // The frame and fit it is measured at are those the page is given and draws at.
    const prefix = 'window.__sverlinGeometry=';
    const [given] = JSON.parse(
      javascript.slice(prefix.length, javascript.indexOf(';\n'))
    ) as Geometry[];
    expect(readability?.frame.height).toBe(given.frame?.height);
    expect(readability?.scale).toBeCloseTo(
      (given.frame?.fit ?? 0) * Math.min(928 / 1200, 608 / (given.frame?.height ?? 1))
    );
    // Seven cells and two bounds fit the frame at their written size or larger, as most text is 16 px.
    expect(readability?.scale).toBeGreaterThan(0.5);
    expect(readability?.text).toBeGreaterThanOrEqual(smallestReadableText);
    expect(readability?.smallest).toBeLessThanOrEqual(readability?.text ?? 0);
  }, 60_000);

  it('describes what each step draws, alike where a value changes nothing seen', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/search-at.sverlin', 'utf8');
    const prepared = everyPause(source);
    const drawnWith = async (seed: number, chosen: Record<string, string | number>) =>
      (await bundlePresentation(prepared, seed, { chosen })).layout.drawn;
    const starter = await drawnWith(1, {});
    // Steps drawing what the step before drew, as a loop's test, are left out.
    expect(starter).toHaveLength(11);
    // Another seed places nothing here; a cell's least size is under what the pointer keeps.
    expect(await drawnWith(2, {})).toEqual(starter);
    expect(await drawnWith(2, { 'IntCell.minSize': 1 })).toEqual(starter);
    // The pointer's fill shows from the second step, where mid first points into the cells.
    expect(
      differingSteps(starter, await drawnWith(2, { 'Arrow.Pointed.fill': 'red-200' }))
    ).toEqual(Array.from({ length: 10 }, (_, index) => index + 1));
  }, 60_000);

  it('counts no step where marks differ only in the room kept for labels not yet shown', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/search-labels.sverlin', 'utf8');
    const prepared = everyPause(source);
    const drawnWith = async (labels: boolean) =>
      (
        await bundlePresentation(prepared, 1, {
          chosen: {
            'pointers.Index@lo': 'LowerMark',
            'pointers.Index@hi': 'UpperMark',
            'LowerMark.LowerLabel.shown': labels,
            'UpperMark.UpperLabel.shown': labels
          }
        })
      ).layout?.drawn;
    const labelled = await drawnWith(true);
    // Before lo and hi are set, both draw the cells alone, the labelled keeping room for its labels.
    expect(differingSteps(labelled, await drawnWith(false))).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 1)
    );
    expect(differingSteps(labelled, await drawnWith(true))).toEqual([]);
  }, 60_000);

  it('keeps the room of a node sized by its value at its type’s largest value times its unit', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/bars.sverlin', 'utf8');
    const { javascript, layout } = await bundlePresentation(prepareSvelteComponent(source), 1);
    expect(layout.errors).toEqual([]);
    const prefix = 'window.__sverlinGeometry=';
    const [given] = JSON.parse(
      javascript.slice(prefix.length, javascript.indexOf(';\n'))
    ) as Geometry[];
    // Values up to 9 at the starter's 16 pixels per unit: 144 pixels, whatever the input reaches.
    expect(new Map(given.components).get('Bar')?.height).toBe(144);
  }, 60_000);

  it('keeps room round each box for the paint it reaches past it with, in every state', async () => {
    const size = async (shadow: string) => {
      const source = `<script domain>const Int = type('integer', { min: 0, max: 9 }); const Values = array(Int, { max: 3 }); const Index = index(Values);</script><script input>const values = Values;</script><Case name="main" values={[1, 2, 3]} /><script algorithm>@start[let i = Index(0);]
while (@more[i < 2]) @next[i++;]</script><View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Here"><Pointed /></View>
<Layout name="Main" of="values, i"><Node>{values}{i}</Node></Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} i={i} /></Scene>
</Storyboard>`;
      const { javascript, layout } = await bundlePresentation(prepareSvelteComponent(source), 1, {
        chosen: { 'Cell.shadow': shadow, 'Row.gap': 0, 'Here.Pointed.glow': 'on' }
      });
      expect(layout.errors).toEqual([]);
      const prefix = 'window.__sverlinGeometry=';
      const [given] = JSON.parse(
        javascript.slice(prefix.length, javascript.indexOf(';\n'))
      ) as Geometry[];
      return new Map(given.components).get('Row')!;
    };
    const plain = await size('none');
    const lifted = await size('lifted');
    // Every cell keeps the pointer glow's 10 pixels each side, at it or not, so nothing moves as
    // it passes. Lifted reaches 12 each side, 8 above and 16 below: 2 more on each side of each of
    // the three cells and 6 more below, and nothing more above.
    expect(lifted.width - plain.width).toBeCloseTo(3 * 4, 0);
    expect(lifted.height - plain.height).toBeCloseTo(6, 0);
  }, 60_000);

  it('keeps room round each box for how far a pointer moves or scales it, in every state', async () => {
    const sizes = async (chosen: Record<string, string | number>) => {
      const source = `<script domain>const Int = type('integer', { min: 0, max: 9 }); const Values = array(Int, { max: 3 }); const Index = index(Values);</script><script input>const values = Values;</script><Case name="main" values={[1, 2, 3]} /><script algorithm>@start[let i = Index(0);]
while (@more[i < 2]) @next[i++;]</script><View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Here"><Pointed /></View>
<Layout name="Main" of="values, i"><Node>{values}{i}</Node></Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} i={i} /></Scene>
</Storyboard>`;
      const { javascript, layout } = await bundlePresentation(prepareSvelteComponent(source), 1, {
        chosen: { 'Row.gap': 0, ...chosen }
      });
      expect(layout.errors).toEqual([]);
      const prefix = 'window.__sverlinGeometry=';
      const [given] = JSON.parse(
        javascript.slice(prefix.length, javascript.indexOf(';\n'))
      ) as Geometry[];
      const components = new Map(given.components);
      return { row: components.get('Row')!, cell: components.get('Cell')! };
    };
    const plain = await sizes({});
    // A lift of 8 keeps 8 above every cell, at it or not, so nothing moves as it passes.
    const lifted = await sizes({ 'Here.Pointed.offsetY': -8 });
    expect(lifted.row.width).toBeCloseTo(plain.row.width, 0);
    expect(lifted.row.height - plain.row.height).toBeCloseTo(8, 0);
    // A scale of 1.2 from the cell's bottom grows it upward only, and from its centre sideways:
    // a fifth of its height above, a tenth of its width each side, of each of the three cells.
    const grown = await sizes({ 'Here.Pointed.scale': 1.2, 'Cell.yAnchor': 'end' });
    const { width, height } = plain.cell;
    expect(grown.row.height - plain.row.height).toBe(Math.ceil(0.2 * height));
    expect(grown.row.width - plain.row.width).toBe(3 * 2 * Math.ceil(Math.ceil(0.2 * width) / 2));
  }, 60_000);

  it('keeps a view’s room for every branch it could draw, not only those the input takes', async () => {
    const box = async (cell: string) => {
      const source = `<script domain>const Int = type('integer', { min: 0, max: 999 }); const Values = array(Int, { max: 2 });</script><script input>const values = Values;</script><Case name="main" values={[1, 2]} /><script algorithm>@run[values[0] = Int(3);]</script><View of="Int" name="Cell">${cell}</View>\n<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>\n<Layout name="Main" of="values"><Node>{values}</Node></Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} /></Scene>
</Storyboard>`;
      const { javascript, layout } = await bundlePresentation(prepareSvelteComponent(source), 1);
      expect(layout.errors).toEqual([]);
      const prefix = 'window.__sverlinGeometry=';
      const [given] = JSON.parse(
        javascript.slice(prefix.length, javascript.indexOf(';\n'))
      ) as Geometry[];
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
      const { javascript, layout } = await bundlePresentation(prepareSvelteComponent(source), 1);
      expect(layout.errors).toEqual([]);
      const prefix = 'window.__sverlinGeometry=';
      const [given] = JSON.parse(
        javascript.slice(prefix.length, javascript.indexOf(';\n'))
      ) as Geometry[];
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
      const { javascript, layout } = await bundlePresentation(prepareSvelteComponent(source), 1);
      expect(layout.errors).toEqual([]);
      const prefix = 'window.__sverlinGeometry=';
      const [given] = JSON.parse(
        javascript.slice(prefix.length, javascript.indexOf(';\n'))
      ) as Geometry[];
      return Math.max(...given.reserved.map(([, size]) => size.width));
    };
    const four = await widest(8, '[1, 2, 3, 4]');
    expect(await widest(8, '[1, 2, 3, 4, 5, 6, 7, 8]')).toBe(four);
    expect(await widest(4, '[1, 2, 3, 4]')).toBeLessThan(four);
  }, 60_000);

  it('keeps each grid column and row at its largest, and refuses two cells at one coordinate', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/lcs-grid.sverlin', 'utf8');
    const { javascript, layout } = await bundlePresentation(prepareSvelteComponent(source), 1);
    expect(layout.errors).toEqual([]);
    const prefix = 'window.__sverlinGeometry=';
    const [given] = JSON.parse(
      javascript.slice(prefix.length, javascript.indexOf(';\n'))
    ) as Geometry[];
    // The headers at row 0 and col 0 and the table from 1: six of each, the corner left empty.
    const [[, tracks]] = given.tracks;
    expect(tracks.columns).toHaveLength(6);
    expect(tracks.rows).toHaveLength(6);
    expect(Math.min(...tracks.columns, ...tracks.rows)).toBeGreaterThan(0);
    const twice = source.replace('row={i + 1} col={j + 1}', 'row={i} col={j + 1}');
    const clashing = await bundlePresentation(prepareSvelteComponent(twice), 1);
    expect(clashing.layout.errors.join(' ')).toMatch(/Two cells of a grid are at row 0, col 2/);
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
    const { javascript, layout } = await bundlePresentation(prepareSvelteComponent(source), 1);
    expect(layout.errors).toEqual([]);
    const prefix = 'window.__sverlinGeometry=';
    const [given] = JSON.parse(
      javascript.slice(prefix.length, javascript.indexOf(';\n'))
    ) as Geometry[];
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
      const { javascript } = await bundlePresentation(prepared, 1, { chosen });
      const prefix = 'window.__sverlinGeometry=';
      expect(javascript.startsWith(prefix)).toBe(true);
      return JSON.parse(javascript.slice(prefix.length, javascript.indexOf(';\n'))) as Geometry[];
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

describe('the geometry a page draws with', () => {
  const geometry = (devicePixelRatio: number, borders: number[]): Geometry => ({
    version: geometryVersion,
    devicePixelRatio,
    borders,
    reserved: [],
    tracks: [],
    components: [],
    spans: [],
    lines: []
  });

  it('is the one whose borders snap alike at the page’s ratio, or else the nearest', () => {
    const given = [geometry(1, [1, 1.5]), geometry(2, [1, 1.5])];
    expect(geometryFor(given, 1)?.devicePixelRatio).toBe(1);
    expect(geometryFor(given, 2)?.devicePixelRatio).toBe(2);
    // At 1.25 a border of one pixel draws 0.8 wide, as none was laid out for: 1 is nearest.
    expect(geometryFor(given, 1.25)?.devicePixelRatio).toBe(1);
    expect(geometryFor(given, 1.75)?.devicePixelRatio).toBe(2);
    expect(geometryFor([geometry(1, [1, 2])], 3)?.devicePixelRatio).toBe(1);
    expect(geometryFor([{ ...geometry(1, []), version: geometryVersion - 1 }], 1)).toBeUndefined();
    expect(geometryFor(undefined, 1)).toBeUndefined();
  });
});
