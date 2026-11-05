/**
 * Steps drawn from their scene data (library/SceneView.svelte, `?scenes=1`) against the mounted
 * page, in a real browser, for the replay and graph fixtures. At each step the two pages, the same
 * size, are compared node by node (box within 2 px, same text), link by link (ends within 2 px), and
 * by their screenshots (the share of drawn pixels alike); small differences are allowed, so each
 * fixture's scores are written to test-results/scene-parity.json and only gross failures fail. While
 * SceneView moves between steps, every node and link it draws must lie between where it was and
 * where it goes, frame by frame: nothing jumps. Run with `pnpm run test:browser`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';

import type { Page } from 'playwright-core';
import { afterAll, describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import replay from './fixtures/replay/replay.json';
import natural from './fixtures/ucs-compare-natural.json';
import type { DesignValues } from './library/node/design';
import {
  browserTestsOn as enabled,
  openPage,
  openPresentation,
  settled,
  showStep
} from './testing/browser';

const replayed = import.meta.glob<string>('./fixtures/replay/*.sverlin', {
  query: '?raw',
  import: 'default',
  eager: true
});
const graphs = import.meta.glob<string>(
  [
    './fixtures/bfs-captions.sverlin',
    './fixtures/bfs-neighbours.sverlin',
    './fixtures/dijkstra.sverlin',
    './fixtures/dfa-loops.sverlin',
    './fixtures/bst.sverlin',
    './fixtures/ucs-compare.sverlin'
  ],
  { query: '?raw', import: 'default', eager: true }
);

const cases: [name: string, source: string, chosen: DesignValues][] = [
  ...Object.entries(replay as Record<string, { variant: DesignValues }>).map(
    ([name, { variant }]): [string, string, DesignValues] => [
      name,
      replayed[`./fixtures/replay/${name}.sverlin`],
      variant
    ]
  ),
  ...Object.entries(graphs).map(([path, source]): [string, string, DesignValues] => {
    const name = path.replace(/^.*\/(.*)\.sverlin$/u, '$1');
    return [name, source, name === 'ucs-compare' ? (natural as DesignValues) : {}];
  })
];

/** The most steps of a fixture compared, enough to reach its later states without taking long. */
const stepsCompared = 8;
const tolerance = 2;

type Box = { x: number; y: number; width: number; height: number };
type Drawn = {
  nodes: Record<string, { box: Box; text: string }>;
  links: [number, number, number, number][];
};

/** The nodes and links a page shows, on screen: the mounted view's, or SceneView's. */
function drawnOn(page: Page): Promise<Drawn> {
  return page.evaluate(() => {
    const boxOf = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const squeezed = (text: string) => text.replace(/\s+/gu, '').toLowerCase();
    const ends = (path: SVGPathElement): [number, number, number, number] => {
      const matrix = path.getScreenCTM()!;
      const at = (length: number) => {
        const point = path.getPointAtLength(length).matrixTransform(matrix);
        return [point.x, point.y];
      };
      return [...at(0), ...at(path.getTotalLength())] as [number, number, number, number];
    };
    const nodes: Drawn['nodes'] = {};
    const scene = document.querySelector('svg[data-sv-scene]');
    if (scene) {
      for (const group of scene.querySelectorAll<SVGGElement>(':scope > g[data-sv-node]')) {
        const id = group.dataset.svNode!;
        const text = [...scene.querySelectorAll(`g[data-sv-node="${CSS.escape(id)}"] text`)]
          .map((run) => run.textContent ?? '')
          .join('');
        nodes[id] ??= { box: boxOf(group.querySelector('rect')!), text: '' };
        nodes[id].text = squeezed(text);
      }
      const links = [
        ...scene.querySelectorAll<SVGPathElement>('g[data-sv-link] > path:first-child')
      ];
      return { nodes, links: links.map(ends) };
    }
    const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)')!;
    // The frame's own node is the scene's frame, not a node of it, as library/scene.ts describes it.
    const frame = layer.querySelector('.sv-frame')!;
    for (const element of frame.querySelectorAll<HTMLElement>('div[data-sv-node]')) {
      if (element.dataset.svHidden === 'true') continue;
      if (element.closest('.sv-link-label:not([data-sv-placed])')) continue;
      const id = element.dataset.svNode!;
      if (nodes[id]) continue;
      // The node's own text: what no node inside it holds, and what is drawn.
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let text = '';
      for (let each = walker.nextNode(); each; each = walker.nextNode()) {
        const parent = each.parentElement!;
        if (parent.closest('div[data-sv-node]') !== element) continue;
        if (getComputedStyle(parent).display === 'none') continue;
        if (getComputedStyle(parent).visibility === 'hidden') continue;
        text += each.textContent ?? '';
      }
      nodes[id] = { box: boxOf(element), text: squeezed(text) };
    }
    const links = [...layer.querySelectorAll<SVGPathElement>('path[data-sv-edge]')].filter(
      (path) => path.getTotalLength() > 0
    );
    return { nodes, links: links.map(ends) };
  });
}

type Compared = {
  nodes: number;
  boxesOff: string[];
  textsOff: string[];
  linksOff: number;
  links: number;
};

function compare(mounted: Drawn, scene: Drawn): Compared {
  const boxesOff: string[] = [];
  const textsOff: string[] = [];
  for (const [id, { box, text }] of Object.entries(mounted.nodes)) {
    const drawn = scene.nodes[id];
    const off =
      !drawn ||
      Math.abs(drawn.box.x - box.x) > tolerance ||
      Math.abs(drawn.box.y - box.y) > tolerance ||
      Math.abs(drawn.box.x + drawn.box.width - box.x - box.width) > tolerance ||
      Math.abs(drawn.box.y + drawn.box.height - box.y - box.height) > tolerance;
    if (off)
      boxesOff.push(
        drawn
          ? `${id} ${[box, drawn.box].map((b) => [b.x, b.y, b.width, b.height].map(Math.round).join(',')).join(' vs ')}`
          : `${id} missing`
      );
    // Characters compared as a set of counts: a run's order may differ from the DOM's.
    const sorted = (text: string) => [...text].sort().join('');
    if (drawn && sorted(drawn.text) !== sorted(text)) textsOff.push(id);
  }
  let linksOff = Math.abs(mounted.links.length - scene.links.length);
  mounted.links.forEach((ends, i) => {
    const other = scene.links[i];
    if (other && ends.some((value, j) => Math.abs(value - other[j]) > tolerance)) linksOff += 1;
  });
  return {
    nodes: Object.keys(mounted.nodes).length,
    boxesOff,
    textsOff,
    linksOff,
    links: mounted.links.length
  };
}

/**
 * The share of drawn pixels two screenshots draw alike: of the pixels either draws in a colour
 * other than its background, those whose channels differ by at most 48 in the other.
 */
async function likeness(first: Buffer, second: Buffer): Promise<number> {
  const page = await openPage();
  return page.evaluate(
    async ([a, b]) => {
      const pixels = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const [one, two] = await Promise.all([pixels(a), pixels(b)]);
      const differs = (data: Uint8ClampedArray, i: number, other: Uint8ClampedArray, j: number) =>
        Math.max(
          Math.abs(data[i] - other[j]),
          Math.abs(data[i + 1] - other[j + 1]),
          Math.abs(data[i + 2] - other[j + 2])
        );
      let drawn = 0;
      let alike = 0;
      for (let i = 0; i < one.length; i += 4) {
        if (differs(one, i, one, 0) <= 16 && differs(two, i, two, 0) <= 16) continue;
        drawn += 1;
        if (differs(one, i, two, i) <= 48) alike += 1;
      }
      return drawn ? alike / drawn : 1;
    },
    [first.toString('base64'), second.toString('base64')]
  );
}

type Row = {
  fixture: string;
  steps: number;
  nodes: number;
  boxesOff: number;
  textsOff: number;
  links: number;
  linksOff: number;
  pixels: number;
  examples: string[];
};
const rows: Row[] = [];

afterAll(() => {
  if (!rows.length) return;
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/scene-parity.json', `${JSON.stringify(rows, null, 2)}\n`);
  console.table(rows.map(({ examples: _, ...row }) => row));
});

describe('steps drawn from their scenes', () => {
  for (const [name, source, chosen] of cases) {
    it.skipIf(!enabled)(
      `${name} draws as the mounted page does`,
      { timeout: 300_000 },
      async () => {
        const built = await bundlePresentation(prepareSvelteComponent(source), 1, { chosen });
        const errors: string[] = [];
        const options = { viewport: { width: 1200, height: 700 }, still: true, errors };
        const mounted = await openPresentation(built.javascript, options);
        const scene = await openPresentation(built.javascript, { ...options, scenes: true });
        const steps = Math.min(built.labels.length, stepsCompared);
        const row: Row = {
          fixture: name,
          steps,
          nodes: 0,
          boxesOff: 0,
          textsOff: 0,
          links: 0,
          linksOff: 0,
          pixels: 0,
          examples: []
        };
        for (let step = 0; step < steps; step++) {
          if (step) await Promise.all([showStep(mounted, step), showStep(scene, step)]);
          const at = compare(await drawnOn(mounted), await drawnOn(scene));
          row.nodes += at.nodes;
          row.boxesOff += at.boxesOff.length;
          row.textsOff += at.textsOff.length;
          row.links += at.links;
          row.linksOff += at.linksOff;
          row.examples.push(
            ...at.boxesOff.slice(0, 2).map((id) => `step ${step} box ${id}`),
            ...at.textsOff.slice(0, 2).map((id) => `step ${step} text ${id}`)
          );
          const [page, drawn] = [await mounted.screenshot(), await scene.screenshot()];
          row.pixels += await likeness(page, drawn);
          if (process.env.SCENE_PARITY_SHOTS) {
            mkdirSync('test-results/scene-parity', { recursive: true });
            writeFileSync(`test-results/scene-parity/${name}-${step}-page.png`, page);
            writeFileSync(`test-results/scene-parity/${name}-${step}-scene.png`, drawn);
          }
        }
        row.pixels = Math.round((row.pixels / steps) * 1000) / 1000;
        row.examples = row.examples.slice(0, 8);
        rows.push(row);
        expect(errors).toEqual([]);
        // Gross failures only: most of what the page draws is drawn alike.
        expect(row.boxesOff / Math.max(1, row.nodes)).toBeLessThan(0.25);
        expect(row.pixels).toBeGreaterThan(0.5);
      }
    );
  }
});

type Sample = { nodes: Record<string, Box>; links: Record<string, number[]> };

/** SceneView's nodes and links each frame, in the frame's coordinates, until the step settles. */
async function framesTo(page: Page, step: number): Promise<Sample[]> {
  const samples = page.evaluate(
    (step) =>
      new Promise<Sample[]>((resolve) => {
        const samples: Sample[] = [];
        const root = document.getElementById('app')!;
        const sample = () => {
          const nodes: Sample['nodes'] = {};
          const scene = document.querySelector('svg[data-sv-scene]')!;
          for (const group of scene.querySelectorAll<SVGGElement>(':scope > g[data-sv-node]')) {
            // A node's text drawn over the links is a group of its own, with no box.
            const box = group.querySelector(':scope > rect');
            if (!box) continue;
            const { x, y, width, height } = (box as SVGRectElement).getBBox();
            nodes[group.dataset.svNode!] ??= { x, y, width, height };
          }
          const links: Sample['links'] = {};
          for (const group of scene.querySelectorAll<SVGGElement>('g[data-sv-link]')) {
            const path = group.querySelector('path')!;
            const start = path.getPointAtLength(0);
            const end = path.getPointAtLength(path.getTotalLength());
            links[group.dataset.svLink!] = [start.x, start.y, end.x, end.y];
          }
          samples.push({ nodes, links });
          if (root.dataset.svSettled === String(step)) resolve(samples);
          else requestAnimationFrame(sample);
        };
        sample();
        window.postMessage({ type: 'sverlin:step', step }, '*');
      }),
    step
  );
  await settled(page, step);
  return samples;
}

/** How far a point lies from the segment between two others. */
function offSegment(point: number[], from: number[], to: number[]): number {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / length))
    : 0;
  return Math.hypot(point[0] - from[0] - t * dx, point[1] - from[1] - t * dy);
}

/** Every node's corners and link's ends, in each frame, between where they were and where they go. */
function jumps(samples: Sample[]): string[] {
  const [first, last] = [samples[0], samples.at(-1)!];
  const found: string[] = [];
  const check = (
    what: string,
    at: number[],
    from: number[] | undefined,
    to: number[] | undefined
  ) => {
    for (let i = 0; i < at.length; i += 2) {
      const point = at.slice(i, i + 2);
      const distance = Math.min(
        from && to ? offSegment(point, from.slice(i, i + 2), to.slice(i, i + 2)) : Infinity,
        from ? offSegment(point, from.slice(i, i + 2), from.slice(i, i + 2)) : Infinity,
        to ? offSegment(point, to.slice(i, i + 2), to.slice(i, i + 2)) : Infinity
      );
      if (distance > tolerance) {
        found.push(`${what} off by ${Math.round(distance)}`);
        return;
      }
    }
  };
  const corners = ({ x, y, width, height }: Box) => [x, y, x + width, y + height];
  for (const sample of samples.slice(1, -1)) {
    for (const [id, box] of Object.entries(sample.nodes)) {
      const [from, to] = [first.nodes[id], last.nodes[id]];
      check(`node ${id}`, corners(box), from && corners(from), to && corners(to));
    }
    for (const [key, ends] of Object.entries(sample.links)) {
      const base = key.replace(/~old$/u, '');
      check(
        `link ${key}`,
        ends,
        first.links[base],
        key.endsWith('~old') ? undefined : last.links[base]
      );
    }
  }
  return [...new Set(found)];
}

describe('SceneView’s motion', () => {
  for (const [name, source, chosen] of cases.filter(([name]) =>
    ['bfs-captions', 'dijkstra', 'binary-search-bars', 'merge-sort-overview'].includes(name)
  )) {
    it.skipIf(!enabled)(`${name} moves nothing by a jump`, { timeout: 300_000 }, async () => {
      const built = await bundlePresentation(prepareSvelteComponent(source), 1, { chosen });
      const page = await openPresentation(built.javascript, { scenes: true });
      let moving = 0;
      for (let step = 1; step < Math.min(built.labels.length, stepsCompared); step++) {
        const samples = await framesTo(page, step);
        moving += samples.length - 2;
        expect(jumps(samples), `step ${step}`).toEqual([]);
      }
      expect(moving).toBeGreaterThan(0);
    });
  }
});
