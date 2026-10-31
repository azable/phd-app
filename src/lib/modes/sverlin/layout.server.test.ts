import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { serverMeasure } from './fonts/measure.server';
import { geometryFor, type Geometry } from './library/geometry';
import { layOutOnServer } from './layout.server';

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
        `__sverlinHost.width('a 漢字', "normal 400 16px 'Sverlin Sans', 'Sverlin Symbols', system-ui"); return { borders: [] };`
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
});

describe('text measured on the server', () => {
  const sans = "normal 400 16px 'Sverlin Sans', 'Sverlin Symbols', system-ui, sans-serif";

  it('draws a character its face lacks in the embedded fallback, and says which it cannot', () => {
    const measure = serverMeasure();
    // ⊕ is in no text face, only in the fallback.
    expect(measure.width('a ⊕ b', sans)).toBeGreaterThan(measure.width('a b', sans));
    expect(measure.missing.size).toBe(0);
    measure.width('🙂', sans);
    expect([...measure.missing]).toEqual(['🙂']);
  });

  it('takes the bold face from 600 and a size in whole 64ths of a pixel', () => {
    const measure = serverMeasure();
    const at = (weight: number, size: number) =>
      measure.width('Distance', `normal ${weight} ${size}px 'Sverlin Sans', system-ui`);
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
