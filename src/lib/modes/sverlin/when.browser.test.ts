/**
 * <When of="@label"> and <OneOf> drawn in a real browser. Run with `pnpm run test:browser`, which the devenv
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

const insertion = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values([5, 2, 4, 1]);
</script>
<script algorithm>
  for (let i = Position(1); (i < values.length); i++) @insert{
    let j = i;
    while ((Position(0) < j) && @compare[(values[@left[j - 1]]) > values[@right[j]]]) @swap{
      const moved = values[@from[j - 1]];
      values[j - 1] = values[@to[j]];
      values[j] = moved;
      j--;
    }
  }
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Caption()}<Node>Swap</Node>{/snippet}
{#snippet Board()}
  <Node layout="column">
    <Node>{#each values as v}{v}{/each}</Node>
    <When of="@insert.swap">{@render Caption()}</When>
  </Node>
{/snippet}

<Layout name="Main">
  <Node>
    {@render Board()}
  </Node>
</Layout>`;

const off = {
  'pause@insert': 'off',
  'pause@insert.compare.left': 'off',
  'pause@insert.compare.right': 'off',
  'pause@insert.swap.from': 'off'
};

/**
 * Each step's captions: whether "Swap" shows and where, whether the question does and where, and the
 * board's size and the row's cells' places, sorted.
 */
async function stepsOf(chosen: Record<string, string>, count: number, source = insertion) {
  const prepared = prepareSvelteComponent(source);
  const { javascript } = await bundlePresentation(prepared, 1, { chosen });
  const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(sandboxDocument('', javascript, 0, 1));
  await page.waitForFunction(() =>
    document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
  );
  const seen: {
    swap: boolean;
    asked: boolean;
    at: { swap?: string; asked?: string };
    board: string;
    cells: number[];
  }[] = [];
  for (let step = 1; step <= count; step++) {
    await page.evaluate((step) => window.postMessage({ type: 'sverlin:step', step }, '*'), step);
    await page.waitForTimeout(1500);
    seen.push(
      await page.evaluate(() => {
        const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)')!;
        const caption = layer.querySelector<HTMLElement>('[data-sv-kind="Caption"]');
        const question = layer.querySelector<HTMLElement>('[data-sv-kind="Ask"]');
        const board = layer.querySelector<HTMLElement>('[data-sv-kind="Board"]')!;
        const box = board.getBoundingClientRect();
        const shows = (node: HTMLElement | null) =>
          Boolean(node) && node?.dataset.svHidden !== 'true';
        const place = (node: HTMLElement | null) => {
          if (!node) return undefined;
          const { top, height } = node.getBoundingClientRect();
          return `${Math.round(top + height / 2)}`;
        };
        return {
          swap: shows(caption),
          asked: shows(question),
          at: { swap: place(caption), asked: place(question) },
          board: `${Math.round(box.width)}x${Math.round(box.height)}`,
          cells: [...layer.querySelectorAll<HTMLElement>('[data-sv-kind="IntCell"]')]
            .filter((cell) => !cell.closest('[data-sv-kind="Ask"]'))
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

it.skipIf(!enabled)(
  'draws a chain of branches in one place, each at its label’s steps',
  { timeout: 120_000 },
  async () => {
    const chained = insertion
      .replace(
        '{#snippet Caption()}',
        "{#snippet FlagWord(value: Flag)}<Node>{value ? 'yes' : 'no'}</Node>{/snippet}\n{#snippet Ask(g: Greater)}<Node>Is {g.a} greater than {g.b}? {g.value}</Node>{/snippet}\n{#snippet Caption()}"
      )
      .replace(
        '<When of="@insert.swap">{@render Caption()}</When>',
        '<OneOf><When of="@insert.compare">{@insert.compare}</When><When of="@insert.swap">{@render Caption()}</When></OneOf>'
      );
    const steps = await stepsOf(
      {
        ...off,
        'pause@insert.compare': 'accumulate',
        'pause@insert.swap': 'accumulate',
        'pause@insert.swap.to': 'off'
      },
      4,
      chained
    );
    // The question at each comparison, "Swap" at each swap, never both.
    expect(steps.map(({ asked, swap }) => [asked, swap])).toEqual([
      [true, false],
      [false, true],
      [true, false],
      [false, true]
    ]);
    // In one place: the question and "Swap" on one line, the board and its cells staying put.
    expect(steps[0].at.asked).toBe(steps[1].at.swap);
    expect(new Set(steps.map(({ board }) => board)).size).toBe(1);
    expect(new Set(steps.map(({ cells }) => cells.join())).size).toBe(1);
  }
);
