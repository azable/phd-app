/**
 * Labels as values, and what has happened, in a real browser. Run with `pnpm run test:browser`,
 * which the devenv gives a browser (SVERLIN_TEST_BROWSER).
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

const domain = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = collection(Int);
  const Index = index(Values);
  const Length = unop((v: Values) => Index(v.length));
  const Before = binop((a: Index, b: Index) => Flag(a < b));
  const Next = unop((p: Index) => Index(p + 1));
  const Prev = unop((p: Index) => Index(p - 1));
  const Greater = binop((a: Int, b: Int) => Flag(a > b));
  const Equal = binop((a: Int, b: Int) => Flag(a === b));
</script>`;

/** Each step's visible nodes, as kind:text, from the first step on. */
async function stepsOf(source: string, frames: string, count: number): Promise<string[][]> {
  const prepared = prepareSvelteComponent(source);
  // A source with one way to step has no frames variable.
  const chosen = 'frames' in prepared.design.space ? { frames } : {};
  const { javascript } = await bundlePresentation(prepared, 1, { chosen });
  const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(sandboxDocument('', javascript, 0, 1));
  await page.waitForFunction(() =>
    document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
  );
  const steps: string[][] = [];
  for (let step = 0; step < count; step++) {
    await page.evaluate((to) => window.postMessage({ type: 'sverlin:step', step: to }, '*'), step);
    await page.waitForTimeout(2500);
    steps.push(
      await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind]'
          )
        ]
          .filter((node) => getComputedStyle(node).visibility !== 'hidden')
          .map((node) => `${node.dataset.svKind}:${node.innerText.replace(/\s+/gu, ' ').trim()}`)
      )
    );
  }
  await page.close();
  expect(errors).toEqual([]);
  return steps;
}

it.skipIf(!enabled)(
  'show the key each step of a whole insertion inserted, though out of scope at its after',
  { timeout: 120_000 },
  async () => {
    const source = `${domain}
<script lang="sverlin" input>
  const values = Values([5, 2, 8, 1]);
</script>
<script lang="sverlin">
  for (let i = Index(1); Before(i, Length(values)); i = Next(i)) @insert{
    const key = @key[values[i]];
    let j = i;
    while (Before(Index(0), j) && Greater(values[Prev(j)], key)) {
      values[j] = values[Prev(j)];
      j = Prev(j);
    }
    values[j] = key;
  }
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet Inserting()}<Node>inserting {@render Int(@insert.key)}</Node>{/snippet}
{@render Cells()}
{@render Inserting()}`;
    const keys = (await stepsOf(source, 'insert', 4)).map((nodes) =>
      nodes.find((node) => node.startsWith('Inserting'))
    );
    // The page opens on the input, before any key, the node hidden whole; then one key per step.
    expect(keys).toEqual([
      undefined,
      'Inserting:inserting 2',
      'Inserting:inserting 8',
      'Inserting:inserting 1'
    ]);
  }
);

it.skipIf(!enabled)(
  'say what a swap swapped, from the values its code read before the exchange',
  { timeout: 120_000 },
  async () => {
    const source = `${domain}
<script lang="sverlin" input>
  const values = Values([5, 1, 4]);
</script>
<script lang="sverlin">
  for (let end = Length(values); Before(Index(1), end); end = Prev(end)) @sweep{
    for (let i = Index(1); Before(i, end); i = Next(i)) @pair{
      @test[if (Greater(values[Prev(i)], values[i])) @swap{
        const moved = @a[values[Prev(i)]];
        values[Prev(i)] = @b[values[i]];
        values[i] = moved;
      }]
    }
  }
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet Swapped()}<Node>swap {@render Int(@swap.a)} and {@render Int(@swap.b)}</Node>{/snippet}
{@render Cells()}
{@render Swapped()}`;
    const [, first] = await stepsOf(source, 'sweep.pair.test.swap', 2);
    expect(first).toContain('Swapped:swap 5 and 1');
    // At a comparison that swaps nothing, the caption hides whole, its text with its values.
    // [5, 1, 4]: the first sweep swaps twice; the second sweep's 1 > 4 swaps nothing.
    const [, , , compare] = await stepsOf(source, 'sweep.pair.test', 4);
    expect(compare.some((node) => node.startsWith('Swapped'))).toBe(false);
  }
);

it.skipIf(!enabled)(
  'mark every cell a search has checked so far, and point from a for … of variable',
  { timeout: 120_000 },
  async () => {
    const search = `${domain}
<script lang="sverlin" input>
  const values = Values([3, 8, 5, 2]);
  const target = Int(5);
</script>
<script lang="sverlin">
  for (let i = Index(0); Before(i, Length(values)); i = Next(i)) @check{
    if (Equal(values[@at[i]], target)) break;
  }
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Checked(p: Index)}<Pointed />{/snippet}
{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}
{@render Cells()}
{#each runs(@check.at) as p}{@render Checked(p)}{/each}`;
    const checked = (await stepsOf(search, 'check', 4)).map((nodes) =>
      nodes.filter((node) => node.startsWith('Checked')).map((node) => node.split(':')[1])
    );
    // The input as given, nothing checked yet; then each check adds its cell.
    expect(checked).toEqual([[], ['3'], ['3', '8'], ['3', '8', '5']]);

    const counting = `<script lang="sverlin" domain>
  const Digit = type('integer', { min: 0, max: 9 });
  const Count = type('integer', { min: 0, max: 9 });
  const Digits = collection(Digit);
  const Counts = collection(Count);
  const At = ref(Digits);
  const Inc = unop((n: Count) => Count(n + 1));
</script>
<script lang="sverlin" input>
  const digits = Digits([3, 1, 4]);
  const counts = Counts([0, 0, 0, 0, 0]);
</script>
<script lang="sverlin">
  for (const v of digits) @count{ counts[v] = Inc(counts[v]); }
</script>
{#snippet DigitCell(value: Digit)}<Node {value} />{/snippet}
{#snippet CountCell(value: Count)}<Node {value} />{/snippet}
{#snippet Reading(r: At)}<Pointed />{/snippet}
{#snippet DigitRow()}<Node>{#each digits as d}{@render Digit(d)}{/each}</Node>{/snippet}
{#snippet CountRow()}<Node>{#each counts as c}{@render Count(c)}{/each}</Node>{/snippet}
{@render DigitRow()}
{@render CountRow()}
{@render At(v)}`;
    const reading = (await stepsOf(counting, 'count', 4)).map(
      (nodes) => nodes.find((node) => node.startsWith('Reading'))?.split(':')[1]
    );
    // The page opens on the input as given, v not yet declared; then each digit counted.
    expect(reading).toEqual([undefined, '3', '1', '4']);
  }
);
