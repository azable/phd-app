/**
 * Fields read through references in a real browser. Run with `pnpm run test:browser`, which the
 * devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { expect, it } from 'vitest';

import { browserTestsOn as enabled, openPage, showStep } from './testing/browser';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { pausingEveryLabel } from './testing/every-pause';
import bfs from './fixtures/bfs-references.sverlin?raw';

it.skipIf(!enabled)(
  'draws the names of the queued vertices, read through their references',
  { timeout: 120_000 },
  async () => {
    const { javascript } = await bundlePresentation(
      prepareSvelteComponent(pausingEveryLabel(bfs)),
      1
    );
    const page = await openPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    const line = async (step: number) => {
      await showStep(page, step);
      return page.evaluate(() =>
        (
          document.querySelector<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind="Line"]'
          )?.innerText ?? ''
        ).replace(/\s+/g, ' ')
      );
    };
    // A is taken, then its neighbours B and C are queued in turn; step 0 is the scene's start,
    // :before, and step 1 the queue holding A.
    expect(await line(1)).toBe('queue: A');
    expect(await line(2)).toBe('queue:');
    expect(await line(4)).toBe('queue: B');
    expect(errors).toEqual([]);
    await page.close();
  }
);
