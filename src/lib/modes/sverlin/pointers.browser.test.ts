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
  const Values = collection(Int, { max: 8 });
  const Index = index(Values);
</script>
<script input>
  const values = Values([5, 1, 4]);
</script>
<script algorithm>
  const i = Index(1);
  const j = Index(0);
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Index" name="First"><Pointed /></View>
<View of="Index" name="Second"><Pointed /></View>
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
  const Values = collection(Int, { max: 8 });
  const Index = index(Values);
</script>
<script input>
  const values = Values([5, 1, 4]);
</script>
<script algorithm>
  const i = Index(2);
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Index" name="IndexText"><Node value={this} /></View>
<View of="Index" name="Highlight"><Pointed /></View>
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
  const Values = collection(Int, { max: 8 });
  const Index = index(Values);
</script>
<script input>
  const values = Values([5, 1, 4]);
</script>
<script algorithm>
  const i = Index(1);
  const j = Index(0);
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Index" name="Highlight"><Pointed /></View>
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
  const Values = collection(Int, { max: 8 });
</script>
<script input>
  const values = Values([5, 1, 4]);
</script>
<script algorithm>
  const key = Int(3);
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Int" name="IntTally"><Node>{'•'.repeat(this)}</Node></View>
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

it.skipIf(!enabled)(
  'moves nothing inside an element when a pointer colours its stroke, its width held in every state',
  { timeout: 120_000 },
  async () => {
    // A cell that lays out its value from its start: a stroke appearing inside it would push it.
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 999 });
  const Values = collection(Int, { max: 5 });
  const Position = index(Values);
</script>
<script input>
  const values = Values([42, 3, 815, 26, 9]);
</script>
<script algorithm>
  @start[let i = Position(0);]
  while (@more[i < values.length]) @step{
    @halve[values[i] = Int(Math.floor(values[i] / 2));]
    @next[i++;]
  }
</script>
<View of="Int" name="Cell">
  <Node layout="row"><Node value={this} />{#if this === 7}<Node>lucky</Node>{/if}</Node>
</View>
<View of="Values" name="Row">
  <Node layout="row">{#each this as v}{v}{/each}</Node>
</View>
<View of="Position" name="Here"><Pointed /></View>
<Layout name="Main">
  <Node>{values}{i}</Node>
</Layout>`;
    const { javascript } = await bundlePresentation(prepareSvelteComponent(source), 1, {});
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    // Each cell's value, by its index in the row, at each step: its position never moves.
    const positions: Record<number, Set<string>> = {};
    for (let step = 0; step < 6; step++) {
      await page.evaluate(
        (to) => window.postMessage({ type: 'sverlin:step', step: to }, '*'),
        step
      );
      await page.waitForTimeout(1500);
      const drawn = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) .value'
          )
        ]
          .filter((value) => getComputedStyle(value).visibility !== 'hidden')
          .map((value) => {
            const { x, y } = value.getBoundingClientRect();
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
      );
      drawn.forEach((at, index) => (positions[index] ??= new Set()).add(at));
    }
    expect(errors).toEqual([]);
    expect(Object.keys(positions)).toHaveLength(5);
    for (const at of Object.values(positions)) expect([...at]).toHaveLength(1);
  }
);

type Drawn = { left: number; right: number; text: string; shadow: string; outline: string };

/** Each step's cells, left to right, and the row around them, as drawn, with the chosen looks. */
async function scanned(chosen: Record<string, string | number>) {
  const source = `<script domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = collection(Int, { max: 6 });
  const Index = index(Values);
</script>
<script input>
  const values = Values([7, 42, 3, 18, 25]);
  const target = Int(18);
</script>
<script algorithm>
  @start[let i = Index(0);]
  while (@scan[values[i] !== target]) @next[i++;]
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Here"><Pointed /></View>
<Layout name="Main"><Node>{values}{i}</Node></Layout>`;
  const { javascript, labels } = await bundlePresentation(prepareSvelteComponent(source), 1, {
    chosen
  });
  const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(sandboxDocument('', javascript, 0, 1));
  await page.waitForFunction(() =>
    document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
  );
  const steps: { cells: Drawn[]; row: number }[] = [];
  for (let step = 0; step < labels.length; step++) {
    await page.evaluate((to) => window.postMessage({ type: 'sverlin:step', step: to }, '*'), step);
    await page.waitForTimeout(1500);
    steps.push(
      await page.evaluate(() => {
        const layer = '.sv-layer:not(.pending):not(.sv-leaving)';
        const cells = [...document.querySelectorAll<HTMLElement>(`${layer} .value`)]
          .filter((value) => getComputedStyle(value).visibility !== 'hidden')
          .map((value) => {
            const node = value.closest<HTMLElement>('.sv-node')!;
            const box = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {
              left: box.left,
              right: box.right,
              text: value.innerText,
              shadow: style.boxShadow,
              outline: style.outlineOffset
            };
          });
        const row = document.querySelector<HTMLElement>(`${layer} [data-sv-kind="Row"]`)!;
        return { cells, row: row.getBoundingClientRect().width };
      })
    );
  }
  await page.close();
  expect(errors).toEqual([]);
  return steps;
}

it.skipIf(!enabled)(
  'expands the pointed cell as paint in a row of slots, moving no cell',
  { timeout: 120_000 },
  async () => {
    const steps = await scanned({ 'Here.Pointed.expand': 4 });
    const lefts = (index: number) =>
      new Set(steps.map(({ cells }) => cells[index].left.toFixed(1)));
    for (let index = 0; index < 5; index++) expect(lefts(index).size).toBe(1);
    expect(new Set(steps.map(({ row }) => row.toFixed(1))).size).toBe(1);
    // Where the pointer is, its cell is painted 4px larger: a spread of its fill and its outline.
    expect(steps.some(({ cells }) => cells.some((cell) => / 4px/u.test(cell.shadow)))).toBe(true);
    expect(steps.some(({ cells }) => cells.some((cell) => cell.outline === '4px'))).toBe(true);
  }
);

it.skipIf(!enabled)(
  'expands the pointed cell in a packed row, pushing its neighbours, the row never growing',
  { timeout: 120_000 },
  async () => {
    const steps = await scanned({ 'Here.Pointed.expand': 4, 'Row.spacing': 'packed' });
    // The row keeps one size; a neighbour of the pointed cell moves as the pointer passes it.
    expect(new Set(steps.map(({ row }) => row.toFixed(1))).size).toBe(1);
    expect(new Set(steps.map(({ cells }) => cells[2].left.toFixed(1))).size).toBeGreaterThan(1);
    // Each cell the pointer passes, 7, 42, 3 and 18, grows while it is there, every one by the same
    // amount: 4px each side, at the page's fit, from the step that declares i.
    const growths = [0, 1, 2, 3].map((index) => {
      const widths = steps.slice(1).map(({ cells }) => cells[index].right - cells[index].left);
      return Math.max(...widths) - Math.min(...widths);
    });
    expect(growths[0]).toBeGreaterThan(4);
    for (const growth of growths) expect(growth).toBeCloseTo(growths[0], 1);
    // Between neighbours the gap is the same, the expanded cell's included.
    for (const { cells } of steps) {
      const gaps = cells.slice(1).map((cell, index) => (cell.left - cells[index].right).toFixed(1));
      expect(new Set(gaps).size).toBe(1);
    }
  }
);
