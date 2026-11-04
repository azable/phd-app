/**
 * A step's application of an operator, drawn by {@sweep.pair.test}, in a real
 * browser. Run with `pnpm run test:browser`, which the devenv gives a browser (SVERLIN_TEST_BROWSER).
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
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = collection(Int, { max: 8 });
  const Index = index(Values);

  // walking the collection

  // what the algorithm does
</script>

<script input>
  const values = Values([5, 1, 4, 2, 3]);
</script>

<script algorithm>
  for (@last[let end = values.length]; @more[Index(1) < end]; @shrink[end--]) @sweep{
    for (@first[let i = Index(1)]; @inside[i < end]; @step[i++]) @pair{
      if (@test[(values[i - 1]) > values[i]]) @swap{
        const moved = values[i - 1];
        values[i - 1] = values[i];
        values[i] = moved;
      }
    }
  }
</script>

<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Flag" name="FlagWord"><Node>{this ? 'yes' : 'no'}</Node></View>
<View of="@sweep.pair.test" name="Ask">
  <Node>is {this.left} > {this.right}? {this.value}</Node>
</View>
{#snippet Title()}<Node>Bubble sort</Node>{/snippet}
{#snippet Board()}
  <Node layout="column">
    <Node>{#each values as v}{v}{/each}</Node>
    {@sweep.pair.test}
  </Node>
{/snippet}

<Layout name="Main">
  <Node>
    {@render Title()}
    {@render Board()}
  </Node>
</Layout>`;

/** The caption Ask draws at a step, and whether it is hidden. */
async function captionAt(step: number, chosen: Record<string, unknown> = {}) {
  const prepared = prepareSvelteComponent(source);
  // The loop headers move no value the view draws, so the steps are the comparisons and swaps.
  const headers = Object.fromEntries(
    ['last', 'more', 'shrink', 'sweep.first', 'sweep.inside', 'sweep.step'].map((label) => [
      `pause@${label}`,
      'off'
    ])
  );
  const { javascript } = await bundlePresentation(prepared, 1, {
    chosen: { ...headers, ...chosen }
  });
  const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(sandboxDocument('', javascript, 0, 1));
  await page.waitForFunction(() =>
    document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
  );
  if (step) {
    await page.evaluate((to) => window.postMessage({ type: 'sverlin:step', step: to }, '*'), step);
    await page.waitForTimeout(1500);
  }
  const caption = await page.evaluate(() => {
    const node = document.querySelector<HTMLElement>(
      '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind^="Ask"]'
    );
    return (
      node && { text: node.innerText.replace(/\s+/gu, ' ').trim(), hidden: node.dataset.svHidden }
    );
  });
  await page.close();
  expect(errors).toEqual([]);
  return caption;
}

it.skipIf(!enabled)(
  "draw a step's one application of an operator, and nothing where it made none or several",
  { timeout: 120_000 },
  async () => {
    // Step 0 is the input as given, step 1 the first comparison, step 2 its swap.
    expect((await captionAt(0))?.hidden).toBe('true');
    const first = await captionAt(1);
    // A comparison gives a plain boolean, drawn as text (see the guide's Views of what a step computed).
    expect(first?.text).toMatch(/^is 5 > 1 ?\? true$/u);
    expect(first?.hidden).toBeUndefined();
    expect((await captionAt(2))?.hidden).toBe('true');
    // With the comparison's view hidden, nothing draws it.
    expect(await captionAt(1, { 'views.@sweep.pair.test': 'none' })).toBeNull();
  }
);
