import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { serverMeasure } from './fonts/measure.server';
import { geometryFor, type Geometry } from './library/geometry';
import { parseSheet } from './library/model/css';
import { layOut } from './library/model/layout';
import type { ModelElement } from './library/model/tree';
import { fontList } from './library/fonts';
import { layOutOnServer } from './layout.server';
import { differingSteps } from '$lib/shared/differing-steps';

/** A server bundle whose layout answers with what it is given, as geometry would come back. */
const answering = (body: string) =>
  `globalThis.__sverlinLayOut = async (fonts, devicePixelRatio) => JSON.stringify((() => { ${body} })());`;

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

  it('leaves to the page a text no embedded font draws', async () => {
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
    const first = await bundlePresentation(prepared, 1, {}, { serverLayout: true });
    expect(first.layout).toMatchObject({ server: true, cached: false, errors: [] });
    expect(first.javascript.startsWith('window.__sverlinGeometry=[')).toBe(true);
    const again = await bundlePresentation(prepared, 1, {}, { serverLayout: true });
    expect(again.layout?.cached).toBe(true);
    expect(again.javascript).toBe(first.javascript);
  }, 60_000);

  it('describes what each step draws, alike where a value changes nothing seen', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/search-at.sverlin', 'utf8');
    const prepared = prepareSvelteComponent(source);
    const drawnWith = async (seed: number, chosen: Record<string, string | number>) =>
      (await bundlePresentation(prepared, seed, { chosen }, { serverLayout: true })).layout?.drawn;
    const starter = await drawnWith(1, {});
    expect(starter).toHaveLength(17);
    // Another seed places nothing here; a cell's least size is under what the pointer keeps.
    expect(await drawnWith(2, {})).toEqual(starter);
    expect(await drawnWith(2, { 'IntCell.minSize': 1 })).toEqual(starter);
    // The pointer's fill shows from the second step, where mid first points into the cells.
    expect(
      differingSteps(starter, await drawnWith(2, { 'Arrow.Pointed.fill': 'red-200' }))
    ).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
  }, 60_000);

  it('counts no step where marks differ only in the room kept for labels not yet shown', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/search-labels.sverlin', 'utf8');
    const prepared = prepareSvelteComponent(source);
    const drawnWith = async (labels: boolean) =>
      (
        await bundlePresentation(
          prepared,
          1,
          {
            chosen: {
              'pointers.Index@lo': 'LowerMark',
              'pointers.Index@hi': 'UpperMark',
              'LowerMark.LowerLabel.shown': labels,
              'UpperMark.UpperLabel.shown': labels
            }
          },
          { serverLayout: true }
        )
      ).layout?.drawn;
    const labelled = await drawnWith(true);
    // Before lo and hi are set, both draw the cells alone, the labelled keeping room for its labels.
    expect(differingSteps(labelled, await drawnWith(false))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(differingSteps(labelled, await drawnWith(true))).toEqual([]);
  }, 60_000);

  it('lays a node out in its case, wider uppercase, alike at the starter', async () => {
    const source = readFileSync('src/lib/modes/sverlin/fixtures/search-at.sverlin', 'utf8');
    const prepared = prepareSvelteComponent(source);
    const geometryOf = async (chosen: Record<string, string>) => {
      const { javascript } = await bundlePresentation(
        prepared,
        1,
        { chosen },
        { serverLayout: true }
      );
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
    version: 1,
    fonts: 'f',
    devicePixelRatio,
    borders,
    reserved: [],
    components: [],
    spans: [],
    lines: []
  });

  it('is the one whose borders snap alike at the page’s ratio, in the fonts it draws in', () => {
    const given = [geometry(1, [1, 1.5]), geometry(2, [1, 1.5])];
    expect(geometryFor(given, 'f', 1)?.devicePixelRatio).toBe(1);
    expect(geometryFor(given, 'f', 2)?.devicePixelRatio).toBe(2);
    // At 1.25 a border of one pixel draws 0.8 wide, as none was laid out for.
    expect(geometryFor(given, 'f', 1.25)).toBeUndefined();
    expect(geometryFor(given, 'other', 1)).toBeUndefined();
    expect(geometryFor([geometry(1, [1, 2])], 'f', 3)?.devicePixelRatio).toBe(1);
    expect(geometryFor(undefined, 'f', 1)).toBeUndefined();
  });
});
