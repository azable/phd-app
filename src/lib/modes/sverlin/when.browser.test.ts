/**
 * {#when @label} blocks drawn in a real browser. Run with `pnpm run test:browser`, which the devenv
 * gives a browser (SVERLIN_TEST_BROWSER).
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

const insertion = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Flag = type('boolean');
  const Length = unop((v: Values) => Position(v.length));
  const Before = binop((a: Position, b: Position) => Flag(a < b));
  const Prev = unop((p: Position) => Position(p - 1));
  const Next = unop((p: Position) => Position(p + 1));
  const Greater = binop((a: Int, b: Int) => Flag(a > b));
</script>
<script lang="sverlin" input>
  const values = Values([5, 2, 4, 1]);
</script>
<script lang="sverlin">
  for (let i = Position(1); Before(i, Length(values)); i = Next(i)) @insert{
    let j = i;
    while (Before(Position(0), j) && @compare[Greater(values[@left[Prev(j)]], values[@right[j]])]) @swap{
      const moved = values[@from[Prev(j)]];
      values[Prev(j)] = values[@to[j]];
      values[j] = moved;
      j = Prev(j);
    }
  }
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Caption()}<Node>Swap</Node>{/snippet}
{#snippet Board()}
  <Node layout="column">
    <Node>{#each values as v}{@render Int(v)}{/each}</Node>
    {#when @insert.swap}{@render Caption()}{/when}
  </Node>
{/snippet}
{@render Board()}`;

const off = {
  'pause@insert': 'off',
  'pause@insert.compare.left': 'off',
  'pause@insert.compare.right': 'off',
  'pause@insert.swap.from': 'off'
};

/** Each step's caption: whether "Swap" shows, and the board's size and cells' places, sorted. */
async function stepsOf(chosen: Record<string, string>, count: number) {
  const prepared = prepareSvelteComponent(insertion);
  const { javascript } = await bundlePresentation(prepared, 1, { chosen });
  const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(sandboxDocument('', javascript, 0, 1));
  await page.waitForFunction(() =>
    document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
  );
  const seen: { swap: boolean; board: string; cells: number[] }[] = [];
  for (let step = 1; step <= count; step++) {
    await page.evaluate((step) => window.postMessage({ type: 'sverlin:step', step }, '*'), step);
    await page.waitForTimeout(700);
    seen.push(
      await page.evaluate(() => {
        const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)')!;
        const caption = layer.querySelector<HTMLElement>('[data-sv-kind="Caption"]');
        const board = layer.querySelector<HTMLElement>('[data-sv-kind="Board"]')!;
        const box = board.getBoundingClientRect();
        return {
          swap: Boolean(caption) && caption?.dataset.svHidden !== 'true',
          board: `${Math.round(box.width)}x${Math.round(box.height)}`,
          cells: [...layer.querySelectorAll<HTMLElement>('[data-sv-kind="IntCell"]')]
            .map((cell) => Math.round(cell.getBoundingClientRect().left))
            .toSorted((a, b) => a - b)
        };
      })
    );
  }
  expect(errors).toEqual([]);
  await page.close();
  return seen;
}

it.skipIf(!enabled)(
  'shows its contents at the steps inside a run of the label, keeping their room elsewhere',
  { timeout: 120_000 },
  async () => {
    // Coarse: each comparison, then each swap. "Swap" shows at the swaps alone.
    const coarse = await stepsOf(
      {
        ...off,
        'pause@insert.compare': 'accumulate',
        'pause@insert.swap': 'accumulate',
        'pause@insert.swap.to': 'off'
      },
      4
    );
    expect(coarse.map(({ swap }) => swap)).toEqual([false, true, false, true]);
    // The caption keeps its room where hidden, so the board and its cells stay put.
    expect(new Set(coarse.map(({ board }) => board)).size).toBe(1);
    expect(new Set(coarse.map(({ cells }) => cells.join())).size).toBe(1);
    // Fine, pausing at the swap's read of A[j] too: inside the swap's run, so "Swap" shows there.
    const fine = await stepsOf(
      {
        ...off,
        'pause@insert.compare': 'accumulate',
        'pause@insert.swap': 'accumulate',
        'pause@insert.swap.to': 'on'
      },
      4
    );
    expect(fine.map(({ swap }) => swap)).toEqual([false, true, true, false]);
  }
);
