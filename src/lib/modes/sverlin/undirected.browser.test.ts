/**
 * Links whose direction follows from the data, in a real browser: one <Link> joining two elements
 * both ways at the same steps is one line, whose head starts as none. Run with
 * `pnpm run test:browser`, which the devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import undirected from './fixtures/bfs-undirected.sverlin?raw';

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

/** The links each step of a source draws, shown or kept hidden: each as written, with a head or not. */
async function linksAtEachStep(source: string) {
  const { javascript, labels } = await bundlePresentation(prepareSvelteComponent(source), 1);
  const page = await browser!.newPage({ viewport: { width: 1200, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(sandboxDocument('', javascript, 0, 1));
  await page.waitForFunction(() =>
    document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
  );
  const steps: { edge: string; head: boolean; shown: boolean }[][] = [];
  for (let step = 0; step < labels.length; step++) {
    await page.evaluate((step) => window.postMessage({ type: 'sverlin:step', step }, '*'), step);
    await page.waitForTimeout(700);
    steps.push(
      await page.evaluate(() =>
        [
          ...document.querySelectorAll<SVGPathElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) path.link'
          )
        ]
          .map((path) => ({
            edge: path.dataset.svEdge ?? '',
            head: path.hasAttribute('marker-end'),
            shown: path.style.opacity !== '0'
          }))
          .sort((a, b) => a.edge.localeCompare(b.edge))
      )
    );
  }
  await page.close();
  return { steps, errors };
}

it.skipIf(!enabled)(
  'draws an edge listed from both its ends as one line, and one listed from its source as an arrow',
  { timeout: 180_000 },
  async () => {
    const both = await linksAtEachStep(undirected);
    const lines = [
      'vertices[0] - vertices[1]',
      'vertices[0] - vertices[2]',
      'vertices[1] - vertices[3]',
      'vertices[2] - vertices[3]',
      'vertices[3] - vertices[4]'
    ];
    for (const step of both.steps)
      expect(step).toEqual(lines.map((edge) => ({ edge, head: false, shown: true })));
    expect(both.errors).toEqual([]);

    const directed = await linksAtEachStep(
      undirected.replace('[[1, 2], [0, 3], [0, 3], [1, 2, 4], [3]]', '[[1, 2], [3], [3], [4], []]')
    );
    for (const step of directed.steps)
      expect(step).toEqual(
        [
          'vertices[0] -> vertices[1]',
          'vertices[0] -> vertices[2]',
          'vertices[1] -> vertices[3]',
          'vertices[2] -> vertices[3]',
          'vertices[3] -> vertices[4]'
        ].map((edge) => ({ edge, head: true, shown: true }))
      );
    expect(directed.errors).toEqual([]);
  }
);

it.skipIf(!enabled)(
  'keeps both ways arrows at every step where they are not shown at the same steps',
  { timeout: 180_000 },
  async () => {
    // Each vertex draws its links once it is seen, so A–B shows from A at once, from B later.
    const { steps, errors } = await linksAtEachStep(
      undirected.replace(
        '{#each neighbours[k] as w}\n        <Link from={k} to={w} />\n      {/each}',
        '{#if vertex.seen}{#each neighbours[k] as w}<Link from={k} to={w} />{/each}{/if}'
      )
    );
    const drawn = steps.flat();
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every(({ head }) => head)).toBe(true);
    // At the first step only A's links show; by the last, every vertex draws each of its own.
    expect(steps[0].filter(({ shown }) => shown).map(({ edge }) => edge)).toEqual([
      'vertices[0] -> vertices[1]',
      'vertices[0] -> vertices[2]'
    ]);
    expect(steps.at(-1)?.filter(({ shown }) => shown)).toHaveLength(10);
    expect(errors).toEqual([]);
  }
);

it.skipIf(!enabled)(
  'draws partners naming each other in a row as one line over the cells',
  { timeout: 120_000 },
  async () => {
    const pairs = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Partners = collection(Position);
</script>
<script lang="sverlin" input>
  const values = Values([3, 1, 4, 1]);
  const partner = Partners([1, 0, 3, 2]);
</script>
<script lang="sverlin">
  let i = Position(0);
  @next[i = Position(1);]
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Cells()}
  <Node layout="row">
    {#each values as v, k}{@render Int(v)}<Link from={k} to={partner[k]} />{/each}
  </Node>
{/snippet}
{@render Cells()}`;
    const { steps, errors } = await linksAtEachStep(pairs);
    for (const step of steps)
      expect(step).toEqual([
        { edge: 'values[0] - values[1]', head: false, shown: true },
        { edge: 'values[2] - values[3]', head: false, shown: true }
      ]);
    expect(errors).toEqual([]);
  }
);
