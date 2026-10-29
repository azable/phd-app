/**
 * A free layout as a box of its own in a real browser: it takes the size of its layout over every
 * step, holding its curves, heads and labels, so what sits beside it stays clear of them, and its
 * layout is the same whatever the frame or its neighbours. Run with `pnpm run test:browser`, which
 * the devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import dijkstra from './fixtures/dijkstra-fields.sverlin?raw';

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

// Dijkstra's graph in a line, its edges arcing over and under it with their weights, under a title
// and beside the listing, as a candidate drew it.
const arcs = {
  'Graph.form': 'line',
  'Graph.curve': 'curved',
  'Graph.layoutSeed': 4,
  'Graph.size': 1.5,
  'Board.size': 1.5,
  'Graph.Link.head': 'diamond',
  'Graph.Link.headSize': 6
};

/** The graph's layout, in its own pixels, and where its box, curves, labels and title are drawn. */
async function graphOf(source: string, chosen: Record<string, string | number>, step = 0) {
  const { javascript } = await bundlePresentation(prepareSvelteComponent(source), 1, { chosen });
  const page = await browser!.newPage({ viewport: { width: 1200, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(sandboxDocument('', javascript, 0, 1));
  await page.waitForFunction(() =>
    document.querySelector('.sv-layer:not(.pending) [data-sv-layout-kind="Graph"]')
  );
  await page.evaluate((step) => window.postMessage({ type: 'sverlin:step', step }, '*'), step);
  await page.waitForTimeout(1000);
  const drawn = await page.evaluate(() => {
    const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)')!;
    const arranged = layer.querySelector<HTMLElement>('[data-sv-layout-kind="Graph"]')!;
    const node = arranged.closest<HTMLElement>('[data-sv-kind="Graph"]')!;
    const placed = arranged.querySelector<HTMLElement>('.placed')!;
    const rect = (element: Element) => {
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return { left, top, right, bottom };
    };
    return {
      layout: {
        width: arranged.offsetWidth,
        height: arranged.offsetHeight,
        children: [...placed.children]
          .filter((child) => !child.hasAttribute('data-sv-link'))
          // To a tenth of a pixel: the solver's last digits are rounding.
          .map((child) => [
            Math.round(parseFloat((child as HTMLElement).style.left) * 10) / 10,
            Math.round(parseFloat((child as HTMLElement).style.top) * 10) / 10
          ])
      },
      nodeHeight: node.offsetHeight,
      box: rect(arranged),
      curves: [...arranged.querySelectorAll('svg path.link')].map(rect),
      labels: [...arranged.querySelectorAll('[data-sv-link-label]')].map(rect),
      title: rect(layer.querySelector('[data-sv-kind="Title"]')!)
    };
  });
  await page.close();
  return { ...drawn, errors };
}

const inside = (
  inner: { left: number; top: number; right: number; bottom: number },
  outer: typeof inner
) =>
  inner.left >= outer.left - 1 &&
  inner.top >= outer.top - 1 &&
  inner.right <= outer.right + 1 &&
  inner.bottom <= outer.bottom + 1;

it.skipIf(!enabled)(
  'sizes a free layout by its layout over every step, holding its curves and labels, clear of its title',
  { timeout: 120_000 },
  async () => {
    const graph = await graphOf(dijkstra, arcs);
    // No band of room kept below the graph: its node is as tall as the layout it draws.
    expect(Math.abs(graph.nodeHeight - graph.layout.height)).toBeLessThan(2);
    expect(graph.curves.length).toBeGreaterThan(0);
    expect(graph.labels.length).toBeGreaterThan(0);
    for (const drawn of [...graph.curves, ...graph.labels]) {
      expect(inside(drawn, graph.box)).toBe(true);
      expect(drawn.top).toBeGreaterThanOrEqual(graph.title.bottom - 1);
    }
    expect(graph.errors).toEqual([]);
  }
);

it.skipIf(!enabled)(
  'lays a free layout out alike whatever the frame or its neighbours',
  { timeout: 120_000 },
  async () => {
    // A snake, whose rows once followed the room it had.
    const snake = { ...arcs, 'Graph.form': 'snake' };
    const wide = await graphOf(dijkstra, { ...snake, 'frame.ratio': '16:9' });
    const square = await graphOf(dijkstra, { ...snake, 'frame.ratio': '1:1' });
    const neighbour = await graphOf(
      dijkstra.replace(
        'Each edge label is its weight.',
        'Each edge label is its weight, the cost of going along that edge from one vertex to the next.'
      ),
      snake
    );
    expect(square.layout).toEqual(wide.layout);
    expect(neighbour.layout).toEqual(wide.layout);
  }
);
