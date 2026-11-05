/**
 * How long a presentation takes to be ready in a real browser, from the page loading to its first
 * step shown, as the app's loader waits for it, hosted as the app hosts it and sent its scenes as
 * it asks. Run with `pnpm run test:browser`, which the devenv gives a browser
 * (SVERLIN_TEST_BROWSER). The budgets are those the page had when it mounted the step shown, for a
 * developer's machine running the other browser tests alongside, so they fail when showing a step
 * slows, not when the machine is busy.
 */

import { expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import bfs from './fixtures/bfs-dequeue.sverlin?raw';
import dijkstra from './fixtures/dijkstra-fields.sverlin?raw';
import { browserTestsOn as enabled, openHosted } from './testing/browser';
import { pausingEveryLabel } from './testing/every-pause';

/** How long after loading the page said it was ready. */
async function readyAfter(source: string): Promise<number> {
  const built = await bundlePresentation(prepareSvelteComponent(pausingEveryLabel(source)), 1);
  const hosted = await openHosted(built, { viewport: { width: 1200, height: 800 } });
  const [ready] = (await hosted.messages('sverlin:timing')).filter(
    ({ phase }) => phase === 'ready'
  );
  return Number(ready.ms);
}

it.skipIf(!enabled)('shows a breadth-first search of 36 steps within a second', async () => {
  expect(await readyAfter(bfs)).toBeLessThan(1000);
});

it.skipIf(!enabled)('shows Dijkstra of 97 steps within a third of a second', async () => {
  expect(await readyAfter(dijkstra)).toBeLessThan(300);
});
