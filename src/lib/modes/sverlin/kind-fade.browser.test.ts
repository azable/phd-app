/**
 * A cell an {#if} draws as one kind or another, as a binary search's cells still in range or ruled
 * out, fades from its old look to its new as it changes kind, where it would switch at once. Run with
 * `pnpm run test:browser`.
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';

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
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
</script>

<script input>
  const values = Values;
  const target = Int;
</script>

<script algorithm>
  @range[let lo = Index(values, 0); let hi = Index(values, values.length - 1);]
  while (@open[lo <= hi]) @probe{
    @pick[const mid = Index(values, Math.floor((lo + hi) / 2));]
    if (@hit[values[mid] === target]) @found{ return; }
    if (@less[values[mid] < target]) @right{ lo = mid + 1; } else @left{ hi = mid - 1; }
  }
  @missing[return;]
</script>

<View of="Int" name="Cell"><Node value={this} /></View>

<Layout name="Search" of="values, lo, hi">
  <Node layout="row">
    {#each values as v, k}{#if lo <= k && k <= hi}<Node kind="Live">{v}</Node>{:else}<Node kind="Out">{v}</Node>{/if}{/each}
  </Node>
</Layout>

<Case name="main" values={[2, 5, 7, 9, 12, 15, 20, 31]} target={20} />

<Storyboard>
  <Scene name="search" case="main" pause="@probe.pick, @probe.right">
    <Search values={values} lo={lo} hi={hi} />
  </Scene>
</Storyboard>`;

it.skipIf(!enabled)(
  'fades a cell from its old kind’s look to its new as the search rules it out',
  { timeout: 120_000 },
  async () => {
    const built = await bundlePresentation(prepareSvelteComponent(source), 1, {
      chosen: { 'Search.Out.opacity': 0.25 }
    });
    const right = built.labels.indexOf('@probe.right#1');
    expect(right).toBeGreaterThan(0);
    const page = await browser!.newPage({ viewport: { width: 700, height: 320 } });
    await page.setContent(sandboxDocument('', built.javascript, 0, 1));
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    await page.evaluate(
      (step) => window.postMessage({ type: 'sverlin:step', step }, '*'),
      right - 1
    );
    await page.waitForTimeout(2000);
    // Each frame's opacity of the first cell's frame, ruled out at this step.
    const opacities = await page.evaluate(async (step) => {
      const found: number[] = [];
      const start = performance.now();
      window.postMessage({ type: 'sverlin:step', step }, '*');
      while (performance.now() - start < 700) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)');
        const cell = layer?.querySelector<HTMLElement>('[data-sv-kind$="Out"]');
        if (cell) found.push(Number(getComputedStyle(cell).opacity));
      }
      return found;
    }, right);
    await page.close();

    const between = opacities.filter((opacity) => opacity > 0.3 && opacity < 0.95);
    expect(between.length).toBeGreaterThan(5);
    expect(opacities.at(-1)).toBeCloseTo(0.25, 2);
  }
);
