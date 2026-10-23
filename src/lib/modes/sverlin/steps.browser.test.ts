/**
 * Steps played in a real browser. Run with `pnpm run test:browser`, which the devenv gives a
 * browser (SVERLIN_TEST_BROWSER).
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

it.skipIf(!enabled)(
  'plays a step forward as the state before its code, then the state after it',
  { timeout: 120_000 },
  async () => {
    // Stepping by write, each step is the write of 7; the write of 3 before it leads up to it.
    const source = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
</script>
<script lang="sverlin" input>
  const values = Values([1, 1, 1]);
</script>
<script lang="sverlin">
  for (let i = Index(0); i < values.length; i++) {
    @lead[values[i] = 3;]
    @write[values[i] = 7;]
  }
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
<Node>{#each values as v}{@render Int(v)}{/each}</Node>`;
    const prepared = prepareSvelteComponent(source);
    expect(prepared.masters.write[0].before?.state.values).toEqual([3, 1, 1]);
    expect(prepared.masters.write[0].state.values).toEqual([7, 1, 1]);
    const { javascript } = await bundlePresentation(prepared, 1, { chosen: { frames: 'write' } });
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    const shown = () =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind="IntCell"]'
          )
        ].map((node) => node.innerText.trim())
      );
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    expect(await shown()).toEqual(['7', '1', '1']);
    // Stepping forward shows the next step's before first, then its after.
    await page.evaluate(() => window.postMessage({ type: 'sverlin:step', step: 1 }, '*'));
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind]')
          .length > 0
    );
    const seen: string[][] = [];
    for (let poll = 0; poll < 40; poll++) {
      const now = await shown();
      if (!seen.length || seen.at(-1)!.join() !== now.join()) seen.push(now);
      await page.waitForTimeout(50);
    }
    expect(errors).toEqual([]);
    // From the step before, the 3 written leading up to the step shows first, then the 7 its code
    // writes.
    expect(seen.map((values) => values.join(' '))).toEqual(['7 1 1', '7 3 1', '7 7 1']);
  }
);
