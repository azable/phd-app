/**
 * How links look in a real browser: their heads, each shape and size meeting the box it points at,
 * at both ends of a two-way line; two <Link>s drawn as two arrows, never one line; labels drawn from
 * a link's children on its middle; and wires. Run with `pnpm run test:browser`, which the devenv
 * gives a browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import cards from './fixtures/bfs-cards.sverlin?raw';
import undirected from './fixtures/bfs-undirected.sverlin?raw';
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

const layer = '.sv-layer:not(.pending):not(.sv-leaving)';

/** A source's page built with chosen values, at a step. */
async function open(source: string, chosen: Record<string, string | number>, step = 0) {
  const { javascript } = await bundlePresentation(prepareSvelteComponent(source), 1, { chosen });
  const page = await browser!.newPage({ viewport: { width: 1200, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(sandboxDocument('', javascript, 0, 1));
  await page.waitForFunction(() =>
    document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
  );
  await page.evaluate((step) => window.postMessage({ type: 'sverlin:step', step }, '*'), step);
  await page.waitForTimeout(1000);
  return { page, errors };
}

/**
 * Each drawn link's ends on the page: where each of its heads reaches (its tip, past the end of a
 * line stopped short for it) or the line's own end, and how far that is from the nearest box of a
 * kind; with the shape its marker draws at each end.
 */
function reaches(page: Awaited<ReturnType<typeof open>>['page'], kind: string) {
  return page.evaluate(
    ({ layer, kind }) => {
      const boxes = [
        ...document.querySelectorAll<HTMLElement>(`${layer} [data-sv-kind="${kind}"]`)
      ].map((node) => node.getBoundingClientRect());
      const gap = ({ x, y }: DOMPoint) =>
        Math.min(
          ...boxes.map((box) =>
            Math.hypot(
              Math.max(box.left - x, 0, x - box.right),
              Math.max(box.top - y, 0, y - box.bottom)
            )
          )
        );
      const stops = ['arrow', 'open', 'dot', 'diamond'];
      return [...document.querySelectorAll<SVGPathElement>(`${layer} path.link`)].map((path) => {
        const matrix = path.getScreenCTM()!;
        const total = path.getTotalLength();
        const reach = stops.includes(path.dataset.head ?? '') ? Number(path.dataset.headSize) : 0;
        // An end, and the point just inside it, give the way the line runs there.
        const end = (at: number, inward: number, headed: boolean) => {
          const point = path.getPointAtLength(at);
          const before = path.getPointAtLength(inward);
          const span = Math.hypot(point.x - before.x, point.y - before.y) || 1;
          const far = headed ? reach : 0;
          return new DOMPoint(
            point.x + ((point.x - before.x) / span) * far,
            point.y + ((point.y - before.y) / span) * far
          ).matrixTransform(matrix);
        };
        const marker = (attribute: string) => {
          const id = /^url\(#(.+)\)$/u.exec(path.getAttribute(attribute) ?? '')?.[1];
          return id
            ? (document.getElementById(id)?.getAttribute('data-shape') ?? undefined)
            : undefined;
        };
        const [start, finish] = [marker('marker-start'), marker('marker-end')];
        return {
          edge: path.dataset.svEdge ?? '',
          start,
          end: finish,
          gaps: [
            gap(end(0, Math.min(1, total), !!start)),
            gap(end(total, Math.max(0, total - 1), !!finish))
          ]
        };
      });
    },
    { layer, kind }
  );
}

it.skipIf(!enabled)(
  'draws every head shape and size with its tip on the edge of the box it points at',
  { timeout: 300_000 },
  async () => {
    const looks: [string, number][] = [
      ['arrow', 6],
      ['arrow', 16],
      ['open', 16],
      ['vee', 16],
      ['dot', 12],
      ['diamond', 16],
      ['bar', 9]
    ];
    for (const [head, headSize] of looks) {
      const { page, errors } = await open(cards, {
        'Graph.form': 'scatter',
        'Graph.layoutSeed': 10,
        'Graph.Link.head': head,
        'Graph.Link.headSize': headSize
      });
      const links = await reaches(page, 'NameText');
      expect(links, head).toHaveLength(5);
      for (const link of links) {
        expect(link.end, `${head} ${headSize}`).toBe(head);
        expect(link.start).toBeUndefined();
        expect(Math.max(...link.gaps), `${head} ${headSize} ${link.edge}`).toBeLessThan(3);
      }
      expect(errors).toEqual([]);
      await page.close();
    }
  }
);

it.skipIf(!enabled)(
  'draws a two-way line’s head at both its ends, each tip on its box, once it has one',
  { timeout: 120_000 },
  async () => {
    const { page, errors } = await open(undirected, { 'Graph.Link.head': 'arrow' });
    const links = await reaches(page, 'NameText');
    expect(links).toHaveLength(5);
    for (const link of links) {
      expect(link.edge).toContain(' - ');
      expect([link.start, link.end]).toEqual(['arrow', 'arrow']);
      expect(Math.max(...link.gaps), link.edge).toBeLessThan(3);
    }
    expect(errors).toEqual([]);
    await page.close();
  }
);

it.skipIf(!enabled)(
  'draws two <Link>s joining two elements both ways as two arrows, never one line',
  { timeout: 120_000 },
  async () => {
    const twoTags = undirected
      .replace('[[1, 2], [0, 3], [0, 3], [1, 2, 4], [3]]', '[[1, 2], [3], [3], [4], []]')
      .replace('<Link from={k} to={w} />', '<Link from={k} to={w} /><Link from={w} to={k} />');
    const { page, errors } = await open(twoTags, {});
    const links = await reaches(page, 'NameText');
    expect(links).toHaveLength(10);
    expect(
      links.every(({ edge, start, end }) => edge.includes(' -> ') && !start && end === 'arrow')
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }
);

it.skipIf(!enabled)(
  'draws a link’s children as its label on its middle, a node of its own kind',
  { timeout: 120_000 },
  async () => {
    const { page, errors } = await open(dijkstra, {}, 1);
    const labels = await page.evaluate((layer) => {
      const middle = (path: SVGPathElement) => {
        const point = path.getPointAtLength(path.getTotalLength() / 2);
        return new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
      };
      const paths = [...document.querySelectorAll<SVGPathElement>(`${layer} path.link`)].filter(
        (path) => path.style.opacity !== '0'
      );
      return [
        ...document.querySelectorAll<HTMLElement>(`${layer} [data-sv-link-label][data-sv-placed]`)
      ].map((label) => {
        const box = label.getBoundingClientRect();
        const centre = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
        const path = paths.find((each) => each.dataset.svEdgeId === label.dataset.svLinkLabel);
        const at = path ? middle(path) : undefined;
        return {
          text: label.innerText.trim(),
          kind: label.querySelector<HTMLElement>('[data-sv-kind]')?.dataset.svKind,
          visible: getComputedStyle(label).visibility === 'visible',
          off: at ? Math.hypot(centre.x - at.x, centre.y - at.y) : Infinity
        };
      });
    }, layer);
    expect(labels.map(({ text }) => text).sort()).toEqual(['1', '10', '2', '2', '4', '5', '8']);
    for (const label of labels) {
      expect(label.kind).toBe('WeightText');
      expect(label.visible).toBe(true);
      // A curve's middle by length and by its parameter differ a little where it bends.
      expect(label.off, label.text).toBeLessThan(12);
    }
    expect(errors).toEqual([]);
    await page.close();
  }
);

it.skipIf(!enabled)(
  'draws wires in straight runs turning at right angles, round the boxes between',
  { timeout: 120_000 },
  async () => {
    const { page, errors } = await open(cards, {
      'Graph.form': 'layers-down',
      'Graph.Link.route': 'wire'
    });
    const wires = await page.evaluate((layer) => {
      const cards = [
        ...document.querySelectorAll<HTMLElement>(`${layer} [data-sv-kind="VertexCard"]`)
      ].map((node) => node.getBoundingClientRect());
      return [...document.querySelectorAll<SVGPathElement>(`${layer} path.link`)].map((path) => {
        const matrix = path.getScreenCTM()!;
        const corners = [...(path.getAttribute('d') ?? '').matchAll(/(-?[\d.]+),(-?[\d.]+)/gu)].map(
          ([, x, y]) => new DOMPoint(Number(x), Number(y)).matrixTransform(matrix)
        );
        const square = corners
          .slice(1)
          .every(
            (b, k) => Math.min(Math.abs(b.x - corners[k].x), Math.abs(b.y - corners[k].y)) < 0.5
          );
        // Sampled along it, the wire crosses no vertex's card but at its two ends.
        const total = path.getTotalLength();
        const crossed = new Set<number>();
        for (let at = total * 0.05; at < total * 0.95; at += 2) {
          const { x, y } = path.getPointAtLength(at).matrixTransform(matrix);
          cards.forEach((box, n) => {
            if (x > box.left + 1 && x < box.right - 1 && y > box.top + 1 && y < box.bottom - 1)
              crossed.add(n);
          });
        }
        return { square, crossed: crossed.size, d: path.getAttribute('d') ?? '' };
      });
    }, layer);
    expect(wires).toHaveLength(5);
    for (const wire of wires) {
      expect(wire.d).not.toContain('C');
      expect(wire.square, wire.d).toBe(true);
      expect(wire.crossed, wire.d).toBeLessThanOrEqual(2);
    }
    expect(errors).toEqual([]);
    await page.close();
  }
);
