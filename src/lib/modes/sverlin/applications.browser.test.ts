/**
 * A step's application of an operator, drawn by {@render Greater()}, in a real browser. Run with
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

const source = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = collection(Int);
  const Index = index(Values);

  // walking the collection
  const Length = unop((v: Values) => Index(v.length));
  const Before = binop((a: Index, b: Index) => Flag(a < b));
  const Next = unop((p: Index) => Index(p + 1));
  const Prev = unop((p: Index) => Index(p - 1));

  // what the algorithm does
  const Greater = binop((a: Int, b: Int) => Flag(a > b));
</script>

<script lang="sverlin" input>
  const values = Values([5, 1, 4, 2, 3]);
</script>

<script lang="sverlin">
  for (let end = Length(values); Before(Index(1), end); end = Prev(end)) @sweep{
    for (let i = Index(1); Before(i, end); i = Next(i)) @pair{
      if (@test[Greater(values[Prev(i)], values[i])]) @swap{
        const moved = values[Prev(i)];
        values[Prev(i)] = values[i];
        values[i] = moved;
      }
    }
  }
</script>

{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet FlagWord(value: Flag)}<Node tags="answer">{value ? 'yes' : 'no'}</Node>{/snippet}
{#snippet Ask(g: Greater)}
  <Node tags="caption">is {@render Int(g.a)} > {@render Int(g.b)}? {@render Flag(g.value)}</Node>
{/snippet}

<Node tags="title">Bubble sort</Node>
<Node layout="column">
  <Node>{#each values as v}{@render Int(v)}{/each}</Node>
  {@render Greater()}
</Node>`;

/** The caption Ask draws at a step, and whether it is hidden. */
async function captionAt(frames: string, step: number) {
  const prepared = prepareSvelteComponent(source);
  const { javascript } = await bundlePresentation(prepared, 1, { chosen: { frames } });
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
    // At sweep.pair.*, the first step is the first comparison, the second its swap.
    const first = await captionAt('sweep.pair.*', 0);
    expect(first?.text).toMatch(/^is 5 > 1 ?\? yes$/u);
    expect(first?.hidden).toBeUndefined();
    expect((await captionAt('sweep.pair.*', 1))?.hidden).toBe('true');
    // At *, a step is a whole sweep, with several comparisons.
    expect((await captionAt('*', 1))?.hidden).toBe('true');
  }
);
