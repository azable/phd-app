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
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
</script>
<script input>
  const values = Values([5, 1, 4]);
</script>
<script algorithm>
  const i = Index(1);
  const j = Index(0);
</script>
{#snippet IntCell(this: Int)}<Node value={this} />{/snippet}
{#snippet First(this: Index)}<Pointed />{/snippet}
{#snippet Second(this: Index)}<Pointed />{/snippet}
{#snippet Cells()}<Node>{#each values as v}{v}{/each}</Node>{/snippet}

<Layout name="Main">
  <Node>
    {@render Cells()}
    {i}
    {j}
  </Node>
</Layout>`;
    // Both are drawn by First unless a variant gives a place its own view, as j's here.
    const { javascript } = await bundlePresentation(prepareSvelteComponent(source), 1, {
      chosen: { 'pointers.Index@j': 'Second' }
    });
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
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
</script>
<script input>
  const values = Values([5, 1, 4]);
</script>
<script algorithm>
  const i = Index(2);
</script>
{#snippet IntCell(this: Int)}<Node value={this} />{/snippet}
{#snippet IndexText(this: Index)}<Node value={this} />{/snippet}
{#snippet Highlight(this: Index)}<Pointed />{/snippet}
{#snippet Cells()}<Node>{#each values as v}{v}{/each}</Node>{/snippet}
{#snippet At()}<Node>at {i}</Node>{/snippet}

<Layout name="Main">
  <Node>
    {@render Cells()}
    {@render At()}
    {i}
  </Node>
</Layout>`;
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

it.skipIf(!enabled)(
  'colours one render apart through its place, the other drawn as its kind is',
  { timeout: 120_000 },
  async () => {
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
</script>
<script input>
  const values = Values([5, 1, 4]);
</script>
<script algorithm>
  const i = Index(1);
  const j = Index(0);
</script>
{#snippet IntCell(this: Int)}<Node value={this} />{/snippet}
{#snippet Highlight(this: Index)}<Pointed />{/snippet}
{#snippet Cells()}<Node>{#each values as v}{v}{/each}</Node>{/snippet}

<Layout name="Main">
  <Node>
    {@render Cells()}
    {i}
    {j}
  </Node>
</Layout>`;
    const { javascript } = await bundlePresentation(prepareSvelteComponent(source), 1, {
      chosen: { 'Highlight.Pointed@j.fill': 'sky-100' }
    });
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    await page.evaluate(() => window.postMessage({ type: 'sverlin:step', step: 1 }, '*'));
    await page.waitForTimeout(1500);
    const fills = await page.evaluate(() =>
      Object.fromEntries(
        [
          ...document.querySelectorAll<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind="Highlight.Pointed"]'
          )
        ]
          .filter((node) => node.dataset.svHidden !== 'true')
          .map((node) => [node.innerText.trim(), getComputedStyle(node).backgroundColor])
      )
    );
    expect(errors).toEqual([]);
    // i keeps the kind's amber; j, at 5, takes its place's sky.
    expect(Object.keys(fills).sort()).toEqual(['1', '5']);
    expect(fills['5']).not.toBe(fills['1']);
  }
);

it.skipIf(!enabled)(
  'draws one render with another view of its type through its place',
  { timeout: 120_000 },
  async () => {
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
</script>
<script input>
  const values = Values([5, 1, 4]);
</script>
<script algorithm>
  const key = Int(3);
</script>
{#snippet IntCell(this: Int)}<Node value={this} />{/snippet}
{#snippet IntTally(this: Int)}<Node>{'•'.repeat(this)}</Node>{/snippet}
{#snippet Cells()}<Node>{#each values as v}{v}{/each}</Node>{/snippet}
{#snippet Key()}<Node>key {key}</Node>{/snippet}

<Layout name="Main">
  <Node>
    {@render Cells()}
    {@render Key()}
  </Node>
</Layout>`;
    const { javascript } = await bundlePresentation(prepareSvelteComponent(source), 1, {
      chosen: { 'views.Int@key': 'IntTally' }
    });
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
          '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind^="Int"]'
        )
      ]
        .filter((node) => node.dataset.svHidden !== 'true')
        .map((node) => [node.innerText.trim(), node.dataset.svKind])
    );
    expect(errors).toEqual([]);
    // The cells are drawn by views.Int's IntCell; key, at its place, by IntTally.
    expect(kinds).toEqual(
      expect.arrayContaining([
        ['5', 'IntCell'],
        ['•••', 'IntTally']
      ])
    );
  }
);
