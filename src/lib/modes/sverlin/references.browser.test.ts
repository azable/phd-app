/**
 * Fields read through references in a real browser. Run with `pnpm run test:browser`, which the
 * devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import bfs from './fixtures/bfs-references.sverlin?raw';

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

it.skipIf(!enabled)(
  'draws the names of the queued vertices, read through their references',
  { timeout: 120_000 },
  async () => {
    const { javascript } = await bundlePresentation(prepareSvelteComponent(bfs), 1);
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    const line = async (step: number) => {
      await page.evaluate((step) => window.postMessage({ type: 'sverlin:step', step }, '*'), step);
      await page.waitForTimeout(800);
      return page.evaluate(() =>
        (
          document.querySelector<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind="Line"]'
          )?.innerText ?? ''
        ).replace(/\s+/g, ' ')
      );
    };
    // A is taken, then its neighbours B and C are queued in turn.
    expect(await line(1)).toBe('queue:');
    expect(await line(3)).toBe('queue: B');
    expect(errors).toEqual([]);
    await page.close();
  }
);
