/**
 * Elements read through positions, at(p), in a real browser. Run with `pnpm run test:browser`,
 * which the devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import bfs from './fixtures/bfs-queue-names.sverlin?raw';
import search from './fixtures/search-at.sverlin?raw';

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

/** The page of a source built with chosen values, and the text of a kind's node at a step. */
async function open(source: string, chosen: Record<string, string>) {
  const { javascript, labels } = await bundlePresentation(prepareSvelteComponent(source), 1, {
    chosen
  });
  const page = await browser!.newPage({ viewport: { width: 1200, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(sandboxDocument('', javascript, 0, 1));
  await page.waitForFunction(() =>
    document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
  );
  const show = async (step: number) => {
    await page.evaluate((step) => window.postMessage({ type: 'sverlin:step', step }, '*'), step);
    await page.waitForTimeout(800);
  };
  const text = (kind: string) =>
    page.evaluate(
      (kind) =>
        (
          document.querySelector<HTMLElement>(
            `.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind="${kind}"]`
          )?.innerText ?? ''
        )
          .replace(/\s+/g, ' ')
          .trim(),
      kind
    );
  return { page, errors, labels, show, text };
}

it.skipIf(!enabled)(
  'draws the queued vertices as the view of their positions chooses: numbers, names, or cards',
  { timeout: 120_000 },
  async () => {
    const added = (labels: readonly string[]) => labels.indexOf('@visit.look.add#2');
    const queued = async (view: string) => {
      const { page, errors, labels, show, text } = await open(bfs, { 'views.VertexRef': view });
      await show(added(labels));
      const shown = await text('QueueItems');
      // The names drawn are the vertices' own: their slots, not the queue's.
      const slots = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind="QueueItems"] [data-sv-slot]'
          )
        ].map((node) => node.dataset.svSlot)
      );
      expect(errors).toEqual([]);
      await page.close();
      return { shown, slots };
    };
    expect(await queued('VertexNumber')).toEqual({ shown: '1 2', slots: ['queue[0]', 'queue[1]'] });
    expect(await queued('VertexName')).toEqual({
      shown: 'B C',
      slots: ['vertices[1].name', 'vertices[2].name']
    });
    expect((await queued('VertexMini')).slots).toContain('vertices[2]');
  }
);

it.skipIf(!enabled)(
  'draws the value a position points at, and nothing past either end',
  { timeout: 120_000 },
  async () => {
    // lo and hi are declared by the algorithm, so they are drawn from its first step on.
    const values = await open(search, { 'views.Index': 'IndexValue' });
    await values.show(1);
    expect(await values.text('Bounds')).toBe('lo 3 hi 71');
    expect(values.errors).toEqual([]);
    await values.page.close();
    const numbers = await open(search, { 'views.Index': 'IndexNumber' });
    await numbers.show(1);
    expect(await numbers.text('Bounds')).toBe('lo 0 hi 6');
    await numbers.page.close();
    // Searching past the largest value, lo ends past the end: its value draws nothing there.
    const past = await open(search.replace('Int(42)', 'Int(99)'), { 'views.Index': 'IndexValue' });
    await past.show(past.labels.length - 1);
    expect(await past.text('Bounds')).toBe('lo hi 71');
    expect(past.errors).toEqual([]);
    await past.page.close();
  }
);
