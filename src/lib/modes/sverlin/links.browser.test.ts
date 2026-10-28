/**
 * Links between labelled places drawn in a real browser. Run with `pnpm run test:browser`, which the
 * devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import bfs from './fixtures/bfs-neighbours.sverlin?raw';
import cards from './fixtures/bfs-cards.sverlin?raw';
import bubble from './fixtures/bubble-arrow.sverlin?raw';
import dijkstra from './fixtures/dijkstra-fields.sverlin?raw';
import list from './fixtures/list-markers.sverlin?raw';
import visitOrder from './fixtures/bfs-visit-order.sverlin?raw';

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
{#snippet Cells()}
  <Node layout="row">
    {#each values as v}{@render Int(v)}{/each}
    <Link from={@insert.swap.from} to={@insert.swap.to} />
  </Node>
{/snippet}
{@render Cells()}`;

it.skipIf(!enabled)(
  'joins the two swapped cells with an arrow at the swap step only',
  { timeout: 120_000 },
  async () => {
    const prepared = prepareSvelteComponent(insertion);
    const { javascript } = await bundlePresentation(prepared, 1, {
      chosen: {
        'pause@insert': 'off',
        'pause@insert.compare': 'accumulate',
        'pause@insert.compare.left': 'off',
        'pause@insert.compare.right': 'off',
        'pause@insert.swap': 'accumulate',
        'pause@insert.swap.from': 'off',
        'pause@insert.swap.to': 'off'
      }
    });
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    const layer = '.sv-layer:not(.pending):not(.sv-leaving)';
    // Each arrow drawn: the elements it joins, whether it shows, and where its ends are.
    const arrows = () =>
      page.evaluate(
        (layer) =>
          [...document.querySelectorAll<SVGPathElement>(`${layer} path.link`)].map((path) => ({
            joins: path.dataset.svEdge ?? '',
            shown: path.style.opacity !== '0'
          })),
        layer
      );
    const cells = () =>
      page
        .evaluate(
          (layer) =>
            [...document.querySelectorAll<HTMLElement>(`${layer} [data-sv-kind="IntCell"]`)].map(
              (cell) => Math.round(cell.getBoundingClientRect().left)
            ),
          layer
        )
        .then((lefts) => lefts.toSorted((a, b) => a - b));
    // The values as the row reads, left to right.
    const row = () =>
      page.evaluate(
        (layer) =>
          [...document.querySelectorAll<HTMLElement>(`${layer} [data-sv-kind="IntCell"]`)]
            .map((cell) => [cell.getBoundingClientRect().left, cell.textContent?.trim()] as const)
            .toSorted(([a], [b]) => a - b)
            .map(([, text]) => text)
            .join(' '),
        layer
      );
    // Whether the shown arrow rises above the cells, arcing over them, from left to right.
    const arcs = () =>
      page.evaluate((layer) => {
        const path = [...document.querySelectorAll<SVGPathElement>(`${layer} path.link`)].find(
          (link) => link.style.opacity !== '0'
        );
        const cell = document.querySelector<HTMLElement>(`${layer} [data-sv-kind="IntCell"]`);
        const numbers = (path?.getAttribute('d') ?? '').match(/-?[\d.]+/g)?.map(Number) ?? [];
        return Boolean(
          path &&
          cell &&
          path.getBoundingClientRect().top < cell.getBoundingClientRect().top &&
          numbers[0] < numbers[numbers.length - 2]
        );
      }, layer);
    const go = async (step: number) => {
      await page.evaluate((step) => window.postMessage({ type: 'sverlin:step', step }, '*'), step);
      await page.waitForTimeout(800);
    };
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    // Step 1, comparing 5 and 2: no label gave the link's ends, so it is laid out hidden.
    await go(1);
    const placed = await cells();
    expect(await row()).toBe('5 2 4 1');
    expect((await arrows()).filter(({ shown }) => shown)).toEqual([]);
    // Step 2, swapping them: an arrow from the first cell to the second, arcing over them, and
    // the values in their new order.
    await go(2);
    expect((await arrows()).filter(({ shown }) => shown)).toEqual([
      { joins: 'values[0] -> values[1]', shown: true }
    ]);
    expect(await arcs()).toBe(true);
    expect(await row()).toBe('2 5 4 1');
    // Step 3, the next comparison: hidden again, the cells in the places they were, the values in
    // the order the state has.
    await go(3);
    expect((await arrows()).filter(({ shown }) => shown)).toEqual([]);
    expect(await cells()).toEqual(placed);
    expect(await row()).toBe('2 5 4 1');
    expect(errors).toEqual([]);
    await page.close();
  }
);

// A swap as an operation, whose view, rendered among the cells, brings its link in.
const traded = insertion
  .replace(
    '  const Greater = binop((a: Int, b: Int) => Flag(a > b));',
    `  const Greater = binop((a: Int, b: Int) => Flag(a > b));
  const Pair = record({ a: Position, b: Position });
  const Adjacent = binop((a: Position, b: Position) => Pair({ a, b }));
  const Swap = binop((v: Values, at: Pair) =>
    Values([...v.slice(0, at.a), v[at.b], v[at.a], ...v.slice(at.b + 1)])
  );`
  )
  .replace(
    `      const moved = values[@from[Prev(j)]];
      values[Prev(j)] = values[@to[j]];
      values[j] = moved;
      j = Prev(j);`,
    `      values = @trade[Swap(values, Adjacent(Prev(j), j))];
      j = Prev(j);`
  )
  .replace(
    '    <Link from={@insert.swap.from} to={@insert.swap.to} />',
    '    {@render Swap(@insert.swap.trade)}'
  )
  .replace(
    '{#snippet Cells()}',
    '{#snippet Trade(s: Swap)}<Link from={s.at.a} to={s.at.b} />{/snippet}\n{#snippet Cells()}'
  );

it.skipIf(!enabled)(
  'lays out the link an operator’s view brings in among the cells, at its steps only',
  { timeout: 120_000 },
  async () => {
    expect(traded).toContain('{@render Swap(@insert.swap.trade)}');
    const prepared = prepareSvelteComponent(traded);
    const { javascript } = await bundlePresentation(prepared, 1, {
      chosen: {
        'pause@insert': 'off',
        'pause@insert.compare': 'accumulate',
        'pause@insert.compare.left': 'off',
        'pause@insert.compare.right': 'off',
        'pause@insert.swap': 'accumulate',
        'pause@insert.swap.trade': 'off'
      }
    });
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    const layer = '.sv-layer:not(.pending):not(.sv-leaving)';
    const shown = () =>
      page.evaluate(
        (layer) =>
          [...document.querySelectorAll<SVGPathElement>(`${layer} path.link`)]
            .filter((path) => path.style.opacity !== '0')
            .map((path) => path.dataset.svEdge ?? ''),
        layer
      );
    const go = async (step: number) => {
      await page.evaluate((step) => window.postMessage({ type: 'sverlin:step', step }, '*'), step);
      await page.waitForTimeout(800);
    };
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    await go(1);
    expect(await shown()).toEqual([]);
    await go(2);
    expect(await shown()).toEqual(['values[0] -> values[1]']);
    await go(3);
    expect(await shown()).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }
);

it.skipIf(!enabled)(
  'arcs over two cells side by side though the link is written in a column',
  { timeout: 120_000 },
  async () => {
    // Bubble sort as an assistant wrote it: the arrow is among a column's children, its ends two
    // cells of the row inside it.
    const prepared = prepareSvelteComponent(bubble);
    const chosen = Object.fromEntries(
      prepared.pauses.labels.map((label) => [
        `pause@${label}`,
        label === 'pass.pair.compare' || label === 'pass.pair.swap' ? 'accumulate' : 'off'
      ])
    );
    const { javascript, labels } = await bundlePresentation(prepared, 1, { chosen });
    const swap = labels.indexOf('@pass.pair.swap#1');
    expect(swap).toBeGreaterThan(0);
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    await page.evaluate((step) => window.postMessage({ type: 'sverlin:step', step }, '*'), swap);
    await page.waitForTimeout(1500);
    const drawn = await page.evaluate(() => {
      const layer = '.sv-layer:not(.pending):not(.sv-leaving)';
      const path = [...document.querySelectorAll<SVGPathElement>(`${layer} path.link`)].find(
        (link) => link.style.opacity !== '0'
      );
      const cells = [...document.querySelectorAll<HTMLElement>(`${layer} [data-sv-kind="IntCell"]`)]
        .map((cell) => cell.getBoundingClientRect())
        .toSorted((a, b) => a.left - b.left);
      const box = path?.getBoundingClientRect();
      return box
        ? {
            top: box.top,
            width: box.width,
            cellsTop: Math.min(...cells.map((cell) => cell.top)),
            pitch: cells[1].left - cells[0].left
          }
        : undefined;
    });
    // Over the cells, and spanning from one cell's middle to the next's, not a stub in the gap.
    expect(drawn).toBeDefined();
    expect(drawn!.top).toBeLessThan(drawn!.cellsTop);
    expect(drawn!.width).toBeGreaterThan(drawn!.pitch * 0.6);
    expect(errors).toEqual([]);
    await page.close();
  }
);

it.skipIf(!enabled)(
  'joins each vertex k to its neighbours, an {#each} index a position into what it walks',
  { timeout: 120_000 },
  async () => {
    const { javascript } = await bundlePresentation(prepareSvelteComponent(bfs), 1);
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    const layer = '.sv-layer:not(.pending):not(.sv-leaving)';
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    await page.evaluate(() => window.postMessage({ type: 'sverlin:step', step: 1 }, '*'));
    await page.waitForTimeout(800);
    const edges = await page.evaluate(
      (layer) =>
        [...document.querySelectorAll<SVGPathElement>(`${layer} path.link`)]
          .filter((path) => path.style.opacity !== '0')
          .map((path) => path.dataset.svEdge ?? '')
          .sort(),
      layer
    );
    expect(edges).toEqual([
      'vertices[0] -> vertices[1]',
      'vertices[0] -> vertices[2]',
      'vertices[1] -> vertices[3]',
      'vertices[2] -> vertices[3]',
      'vertices[3] -> vertices[4]'
    ]);
    expect(errors).toEqual([]);
    await page.close();
  }
);

it.skipIf(!enabled)(
  'keeps a node a pointer’s view is drawn around in the free layout, its links ending at it',
  { timeout: 120_000 },
  async () => {
    const { javascript } = await bundlePresentation(prepareSvelteComponent(list), 1);
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    const layer = '.sv-layer:not(.pending):not(.sv-leaving)';
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    // Each drawn link's ends, and how far each is from the nearest list node's box.
    const gaps = () =>
      page.evaluate((layer) => {
        const boxes = [...document.querySelectorAll<HTMLElement>(`${layer} [data-sv-slot]`)]
          .filter((node) => /^ȟListNode\[\d+\]$/u.test(node.dataset.svSlot ?? ''))
          .map((node) => node.getBoundingClientRect());
        const distance = (x: number, y: number) =>
          Math.min(
            ...boxes.map((box) =>
              Math.hypot(
                Math.max(box.left - x, 0, x - box.right),
                Math.max(box.top - y, 0, y - box.bottom)
              )
            )
          );
        return [...document.querySelectorAll<SVGPathElement>(`${layer} path.link`)]
          .filter((path) => path.style.opacity !== '0')
          .map((path) => {
            const matrix = path.getScreenCTM()!;
            const start = path.getPointAtLength(0).matrixTransform(matrix);
            const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
            return Math.round(Math.max(distance(start.x, start.y), distance(end.x, end.y)));
          });
      }, layer);
    // The steps the evaluation found broken: B marked at step 1, C at step 9.
    for (const step of [1, 9]) {
      await page.evaluate((step) => window.postMessage({ type: 'sverlin:step', step }, '*'), step);
      await page.waitForTimeout(1200);
      const ends = await gaps();
      expect(ends.length, `step ${step}`).toBeGreaterThan(0);
      expect(Math.max(...ends), `step ${step}`).toBeLessThan(8);
    }
    expect(errors).toEqual([]);
    await page.close();
  }
);

it.skipIf(!enabled)(
  'meets a vertex drawn in a borderless column at its framed name cell, straight or curved',
  { timeout: 120_000 },
  async () => {
    const prepared = prepareSvelteComponent(cards);
    for (const curve of ['straight', 'curved']) {
      const { javascript } = await bundlePresentation(prepared, 1, {
        chosen: { 'Graph.form': 'scatter', 'Graph.layoutSeed': 10, 'Graph.Link.curve': curve }
      });
      const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(sandboxDocument('', javascript, 0, 1));
      const layer = '.sv-layer:not(.pending):not(.sv-leaving)';
      await page.waitForFunction(() =>
        document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
      );
      await page.waitForTimeout(800);
      // How far each drawn link's ends are from the nearest name cell, the vertex's framed box.
      const gaps = await page.evaluate((layer) => {
        const cells = [
          ...document.querySelectorAll<HTMLElement>(`${layer} [data-sv-kind="NameText"]`)
        ].map((node) => node.getBoundingClientRect());
        const distance = (x: number, y: number) =>
          Math.min(
            ...cells.map((box) =>
              Math.hypot(
                Math.max(box.left - x, 0, x - box.right),
                Math.max(box.top - y, 0, y - box.bottom)
              )
            )
          );
        return [...document.querySelectorAll<SVGPathElement>(`${layer} path.link`)].map((path) => {
          const matrix = path.getScreenCTM()!;
          const start = path.getPointAtLength(0).matrixTransform(matrix);
          const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
          return Math.round(Math.max(distance(start.x, start.y), distance(end.x, end.y)));
        });
      }, layer);
      expect(gaps, curve).toHaveLength(5);
      expect(Math.max(...gaps), curve).toBeLessThan(3);
      expect(errors).toEqual([]);
      await page.close();
    }
  }
);

it.skipIf(!enabled)(
  'draws edges to vertices drawn by their fields, the {#each} item standing for each',
  { timeout: 120_000 },
  async () => {
    const { javascript } = await bundlePresentation(prepareSvelteComponent(dijkstra), 1);
    const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(sandboxDocument('', javascript, 0, 1));
    const layer = '.sv-layer:not(.pending):not(.sv-leaving)';
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
    );
    await page.evaluate(() => window.postMessage({ type: 'sverlin:step', step: 1 }, '*'));
    await page.waitForTimeout(1200);
    const drawn = await page.evaluate(
      (layer) => ({
        edges: [...document.querySelectorAll<SVGPathElement>(`${layer} path.link`)]
          .filter((path) => path.style.opacity !== '0')
          .map((path) => path.dataset.svEdge ?? '')
          .sort(),
        weights: [...document.querySelectorAll(`${layer} .links text.label`)]
          .map((label) => label.textContent ?? '')
          .sort()
      }),
      layer
    );
    expect(drawn.edges).toEqual([
      'vertices[0] - vertices[1]',
      'vertices[0] - vertices[2]',
      'vertices[1] - vertices[2]',
      'vertices[1] - vertices[3]',
      'vertices[2] - vertices[3]',
      'vertices[2] - vertices[4]',
      'vertices[3] - vertices[4]'
    ]);
    expect(drawn.weights).toHaveLength(7);
    expect(errors).toEqual([]);
    await page.close();
  }
);

it.skipIf(!enabled)(
  'draws a graph alike in presentations that differ only in a pause, whatever their seeds',
  { timeout: 120_000 },
  async () => {
    // Eval2's BFS: "show some more steps" turned on one pause, and the graph took another form.
    const prepared = prepareSvelteComponent(visitOrder);
    const placed = async (seed: number, chosen: Record<string, string | number>) => {
      const { javascript } = await bundlePresentation(prepared, seed, { chosen });
      const page = await browser!.newPage({ viewport: { width: 1200, height: 700 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(sandboxDocument('', javascript, 0, seed));
      await page.waitForFunction(() =>
        document.querySelector('.sv-layer:not(.pending) [data-sv-layout-kind="Graph"]')
      );
      await page.waitForTimeout(800);
      const positions = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-layout-kind="Graph"] > .placed > *'
          )
        ].map((child) => [child.style.left, child.style.top])
      );
      expect(errors).toEqual([]);
      await page.close();
      return positions;
    };
    const fewer = await placed(1546190931, { 'pause@visit.look': 'off' });
    expect(fewer.length).toBeGreaterThan(1);
    expect(await placed(487362115, { 'pause@visit.look': 'on' })).toEqual(fewer);
    // The graph's own layout seed does move it.
    expect(await placed(1546190931, { 'Graph.layoutSeed': 2 })).not.toEqual(fewer);
  }
);

it.skipIf(!enabled)(
  'draws the same form from the same values whatever the space, listing shown or not',
  { timeout: 120_000 },
  async () => {
    const prepared = prepareSvelteComponent(visitOrder);
    const formOf = async (language: string, width: number) => {
      const { javascript } = await bundlePresentation(prepared, 1, {
        chosen: { 'listing.language': language }
      });
      // A comparison gives each presentation half the stage.
      const page = await browser!.newPage({ viewport: { width, height: 700 } });
      await page.setContent(sandboxDocument('', javascript, 0, 1));
      await page.waitForFunction(() =>
        document.querySelector(
          '.sv-layer:not(.pending) [data-sv-layout-kind="Graph"][data-sv-form]'
        )
      );
      const form = await page.evaluate(
        () =>
          document.querySelector<HTMLElement>(
            '.sv-layer:not(.pending) [data-sv-layout-kind="Graph"]'
          )?.dataset.svForm
      );
      await page.close();
      return form;
    };
    const forms = [
      await formOf('textbook', 1200),
      await formOf('none', 1200),
      await formOf('textbook', 600)
    ];
    expect(forms).toEqual(['layers-down', 'layers-down', 'layers-down']);
  }
);
