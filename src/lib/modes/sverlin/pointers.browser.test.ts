/**
 * Pointers drawn around the elements they point at, in a real browser. Run with
 * `pnpm run test:browser`, which the devenv gives a browser (SVERLIN_TEST_BROWSER).
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
  'paints each element in the kind of the pointer at it, though a pointer written later is elsewhere',
  { timeout: 120_000 },
  async () => {
    const source = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
</script>
<script lang="sverlin" input>
  const values = Values([5, 1, 4]);
</script>
<script lang="sverlin">
  const i = Index(1);
  const j = Index(0);
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet First(p: Index)}<Pointed />{/snippet}
{#snippet Second(p: Index)}<Pointed />{/snippet}
{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}
{@render Cells()}
{@render First(i)}
{@render Second(j)}`;
    const { javascript } = await bundlePresentation(prepareSvelteComponent(source), 1);
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    // Step 0 is the input as given, before i and j are declared; step 1 has both.
    await page.evaluate(() => window.postMessage({ type: 'sverlin:step', step: 1 }, '*'));
    await page.waitForTimeout(1500);
    const kinds = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind]'
        )
      ]
        .filter((node) => node.dataset.svHidden !== 'true')
        .map((node) => [node.innerText.trim(), node.dataset.svKind])
    );
    expect(errors).toEqual([]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ['5', 'Second.Pointed'],
        ['1', 'First.Pointed'],
        ['4', 'IntCell']
      ])
    );
  }
);

it.skipIf(!enabled)(
  'draws a position type rendered by name as a mark outside a node and its number inside one',
  { timeout: 120_000 },
  async () => {
    const source = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
</script>
<script lang="sverlin" input>
  const values = Values([5, 1, 4]);
</script>
<script lang="sverlin">
  const i = Index(2);
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet IndexText(p: Index)}<Node value={p} />{/snippet}
{#snippet Highlight(p: Index)}<Pointed />{/snippet}
{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet At()}<Node>at {@render Index(i)}</Node>{/snippet}
{@render Cells()}
{@render At()}
{@render Index(i)}`;
    const { javascript } = await bundlePresentation(prepareSvelteComponent(source), 1);
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    await page.evaluate(() => window.postMessage({ type: 'sverlin:step', step: 1 }, '*'));
    await page.waitForTimeout(1500);
    const kinds = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind]'
        )
      ]
        .filter((node) => node.dataset.svHidden !== 'true')
        .map((node) => [node.innerText.replace(/\s+/gu, ' ').trim(), node.dataset.svKind])
    );
    expect(errors).toEqual([]);
    // The cell at i is marked; the caption shows i's number.
    expect(kinds).toEqual(
      expect.arrayContaining([
        ['4', 'Highlight.Pointed'],
        ['2', 'IndexText'],
        ['at 2', 'At']
      ])
    );
  }
);
