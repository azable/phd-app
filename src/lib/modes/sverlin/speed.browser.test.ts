/**
 * How long a presentation takes to be ready in a real browser, from the page loading to its first
 * step shown, as the app's loader waits for it. Run with `pnpm run test:browser`, which the devenv
 * gives a browser (SVERLIN_TEST_BROWSER). The budgets are for a developer's machine running the
 * other browser tests alongside, two to three times what each takes alone there, and well under
 * what each took before passes ran together, so they fail when laying out slows, not when the
 * machine is busy.
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import bfs from './fixtures/bfs-dequeue.sverlin?raw';
import dijkstra from './fixtures/dijkstra-fields.sverlin?raw';

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

type Timing = { phase: string; step?: number; ms: number; waiting?: boolean };

/** Load a presentation in a frame, as the app does, and collect the times it reports. */
async function timingsOf(source: string) {
  const { javascript, labels } = await bundlePresentation(prepareSvelteComponent(source), 1);
  const page = await browser!.newPage({ viewport: { width: 1200, height: 800 } });
  await page.setContent(`<iframe style="border: 0; width: 1200px; height: 800px"></iframe>
<script>
  window.timings = [];
  addEventListener('message', ({ data }) => {
    if (data?.type === 'sverlin:timing' && !data.waiting) window.timings.push(data);
  });
</script>`);
  await page.evaluate(
    (document) => {
      window.document.querySelector('iframe')!.srcdoc = document;
    },
    sandboxDocument('', javascript, 0, 1)
  );
  await page.waitForFunction(
    () => (window as unknown as { timings: Timing[] }).timings.some((t) => t.phase === 'ready'),
    null,
    { timeout: 60_000 }
  );
  const timings = await page.evaluate(() => (window as unknown as { timings: Timing[] }).timings);
  await page.close();
  // Each step is two states, the one before its code and the one after.
  return { timings, states: 2 * labels.length };
}

it.skipIf(!enabled)(
  'lays out a breadth-first search of 36 steps within 5 seconds, drawing states alike once',
  { timeout: 120_000 },
  async () => {
    const { timings, states } = await timingsOf(bfs);
    const ready = timings.find((timing) => timing.phase === 'ready')!;
    expect(ready.ms).toBeLessThan(5000);
    // Recording takes at least two rounds over the states; states drawn alike are drawn once each.
    const recorded = timings.filter((timing) => timing.phase === 'recording');
    expect(recorded.length).toBeLessThan(2 * states);
  }
);

it.skipIf(!enabled)(
  'lays out Dijkstra of 97 steps, with a free layout, within 15 seconds',
  { timeout: 120_000 },
  async () => {
    const { timings } = await timingsOf(dijkstra);
    const ready = timings.find((timing) => timing.phase === 'ready')!;
    expect(ready.ms).toBeLessThan(15_000);
  }
);
