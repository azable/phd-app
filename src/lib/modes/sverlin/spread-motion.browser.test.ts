/**
 * A pointer's painted spread shrinking as the pointer leaves: its fill and its stroke, both shadows,
 * shrink together frame by frame, the stroke never lagging behind in whole pixels as an outline's
 * offset would, nor fading: it keeps its colour as it shrinks into the box. Run with `pnpm run test:browser`.
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { pausingEveryLabel } from './testing/every-pause';

const enabled = process.env.SVERLIN_RUN_BROWSER_TESTS === '1';

let browser: Browser | undefined;
beforeAll(async () => {
  if (!enabled) return;
  // The session's library path can hold libraries of another package set than the browser's.
  const env = { ...process.env } as Record<string, string>;
  delete env.LD_LIBRARY_PATH;
  browser = await chromium.launch({ executablePath: process.env.SVERLIN_TEST_BROWSER, env });
});
afterAll(() => browser?.close());

const source = `<script domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = array(Int, { max: 6 });
  const Index = index(Values);
</script>

<script input>
  const values = Values;
  const target = Int;
</script><Case name="main" values={[7, 42, 3, 18, 25]} target={18} />

<script algorithm>
  @start[let i = Index(0);]
  while (@scan[values[i] !== target]) @next[i++;]
</script>

<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Here"><Pointed /></View>

<Layout name="Main" of="values, i"><Node>{values}{i}</Node></Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} i={i} /></Scene>
</Storyboard>`;

it.skipIf(!enabled)(
  'shrinks a spread fill and its stroke together, frame by frame, as the pointer leaves',
  { timeout: 120_000 },
  async () => {
    const { javascript } = await bundlePresentation(
      prepareSvelteComponent(pausingEveryLabel(source)),
      1,
      {
        chosen: { 'Here.Pointed.spread': 6 }
      }
    );
    const page = await browser!.newPage({ viewport: { width: 700, height: 320 } });
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    await page.evaluate(() => window.postMessage({ type: 'sverlin:step', step: 1 }, '*'));
    await page.waitForTimeout(2500);
    // Each frame's spreads and colours of the cell the pointer leaves, [fill, stroke], and its
    // outline's style.
    const frames = await page.evaluate(async () => {
      const found: { spreads: number[]; colours: string[]; outline: string }[] = [];
      const start = performance.now();
      window.postMessage({ type: 'sverlin:step', step: 2 }, '*');
      while (performance.now() - start < 600) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)');
        const cell = [...(layer?.querySelectorAll<HTMLElement>('.sv-node') ?? [])].find(
          (node) => node.textContent?.trim() === '7'
        );
        if (!cell) continue;
        const style = getComputedStyle(cell);
        const shadows = [
          ...style.boxShadow.matchAll(
            /([a-z]+\([^)]*\)) (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px/g
          )
        ];
        found.push({
          spreads: shadows.map((shadow) => Number(shadow[5])),
          colours: shadows.map((shadow) => shadow[1]),
          outline: style.outlineStyle
        });
      }
      return found;
    });
    await page.close();

    const shrinking = frames.filter(
      ({ spreads }) => spreads.length === 2 && spreads[0] > 0.05 && spreads[0] < 5.95
    );
    expect(shrinking.length).toBeGreaterThan(8);
    // No outline draws the stroke: it is the second shadow, always just outside the fill.
    for (const { spreads, outline } of shrinking) {
      expect(outline).toBe('none');
      expect(spreads[1]).toBeGreaterThan(spreads[0]);
    }
    // The stroke moves at every frame the fill does, never holding a whole pixel, and keeps its
    // colour throughout, shrinking into the box rather than fading.
    for (let at = 1; at < shrinking.length; at++)
      expect(shrinking[at].spreads[1]).toBeLessThan(shrinking[at - 1].spreads[1]);
    expect(new Set(shrinking.map(({ colours }) => colours[1])).size).toBe(1);
  }
);
