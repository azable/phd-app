/**
 * SceneView's moves between steps, in a real browser, for the replay and graph fixtures: every
 * node and link it draws lies between where it was and where it goes, frame by frame, so nothing
 * jumps; fills ease from the old colour to the new; and a value stays in its own place where
 * another like it changes. Run with `pnpm run test:browser`.
 */

import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import costsVariant from './fixtures/dijkstra-costs.json';
import costs from './fixtures/dijkstra-costs.sverlin?raw';
import replay from './fixtures/replay/replay.json';
import natural from './fixtures/ucs-compare-natural.json';
import type { DesignValues } from './library/node/design';
import { browserTestsOn as enabled, openPresentation, settled } from './testing/browser';

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
  }),
  // A glow and a hard shadow round every vertex card, which only paint.
  [
    'dijkstra-effects',
    graphs['./fixtures/dijkstra.sverlin'],
    { 'VertexCard.glow': 'on', 'VertexCard.shadow': 'hard' }
  ]
];

/** The most steps of a fixture moved through, enough to reach its later states without taking long. */
const stepsCompared = 8;
const tolerance = 2;

type Box = { x: number; y: number; width: number; height: number };
type Sample = {
  nodes: Record<string, Box>;
  links: Record<string, number[]>;
  /** The node each moves from, where it had another id, and each node's own text. */
  was: Record<string, string>;
  texts: Record<string, string>;
  /** Each node's box's fill, as the browser resolves it. */
  fills: Record<string, string>;
};

/** SceneView's nodes and links each frame, in the frame's coordinates, until the step settles. */
async function framesTo(page: Page, step: number): Promise<Sample[]> {
  const samples = page.evaluate(
    (step) =>
      new Promise<Sample[]>((resolve) => {
        const samples: Sample[] = [];
        const root = document.getElementById('app')!;
        const sample = () => {
          const nodes: Sample['nodes'] = {};
          const was: Sample['was'] = {};
          const texts: Sample['texts'] = {};
          const fills: Sample['fills'] = {};
          const scene = document.querySelector('svg[data-sv-scene]')!;
          for (const group of scene.querySelectorAll<SVGGElement>(':scope > g[data-sv-node]')) {
            // A node's text drawn over the links is a group of its own, with no box.
            const box = group.querySelector(':scope > rect[data-sv-box]');
            if (!box) continue;
            fills[group.dataset.svNode!] ??= getComputedStyle(box).fill;
            const { x, y, width, height } = (box as SVGRectElement).getBBox();
            nodes[group.dataset.svNode!] ??= { x, y, width, height };
            if (group.dataset.svWas) was[group.dataset.svNode!] = group.dataset.svWas;
            texts[group.dataset.svNode!] ??= [...group.querySelectorAll(':scope > text')]
              .map((text) => text.textContent)
              .join(' ');
          }
          const links: Sample['links'] = {};
          for (const group of scene.querySelectorAll<SVGGElement>('g[data-sv-link]')) {
            const path = group.querySelector('path')!;
            const start = path.getPointAtLength(0);
            const end = path.getPointAtLength(path.getTotalLength());
            links[group.dataset.svLink!] = [start.x, start.y, end.x, end.y];
          }
          samples.push({ nodes, links, was, texts, fills });
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
      const [from, to] = [first.nodes[sample.was[id] ?? id], last.nodes[id]];
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
      const page = await openPresentation(built);
      let moving = 0;
      for (let step = 1; step < Math.min(built.labels.length, stepsCompared); step++) {
        const samples = await framesTo(page, step);
        moving += samples.length - 2;
        expect(jumps(samples), `step ${step}`).toEqual([]);
      }
      expect(moving).toBeGreaterThan(0);
    });
  }

  it.skipIf(!enabled)(
    'eases a node’s fill from its old colour to its new',
    { timeout: 300_000 },
    async () => {
      const source = graphs['./fixtures/dijkstra.sverlin'];
      const built = await bundlePresentation(prepareSvelteComponent(source), 1);
      const page = await openPresentation(built);
      const between: string[] = [];
      for (let step = 1; step < Math.min(built.labels.length, stepsCompared); step++) {
        const samples = await framesTo(page, step);
        const [first, last] = [samples[0], samples.at(-1)!];
        for (const [id, fill] of Object.entries(last.fills)) {
          const was = first.fills[id];
          if (!was || was === fill) continue;
          if (samples.slice(1, -1).some((sample) => ![was, fill].includes(sample.fills[id])))
            between.push(id);
        }
      }
      expect(between.length).toBeGreaterThan(0);
    }
  );

  // A participant's Dijkstra (project d20bd3f6): every vertex's cost shows ∞ until it is updated,
  // each ∞ a node whose id counts the renders before it, so when one cost turns finite the others'
  // ids shift; each must stay in its own vertex, not travel to the next.
  it.skipIf(!enabled)(
    'keeps each ∞ cost in its own vertex as another updates',
    { timeout: 300_000 },
    async () => {
      const built = await bundlePresentation(prepareSvelteComponent(costs), 625810341, {
        base: costsVariant
      });
      const page = await openPresentation(built);
      const travelled: string[] = [];
      let checked = 0;
      for (let step = 1; step < Math.min(built.labels.length, 17); step++) {
        const samples = await framesTo(page, step);
        const [first, last] = [samples[0], samples.at(-1)!];
        for (const [id, box] of Object.entries(last.nodes)) {
          if (last.texts[id] !== '∞') continue;
          checked += 1;
          const start = first.nodes[samples.find((sample) => sample.was[id])?.was[id] ?? id];
          if (start && Math.hypot(start.x - box.x, start.y - box.y) > tolerance)
            travelled.push(
              `step ${step}: ${id} from ${Math.round(start.x)},${Math.round(start.y)}`
            );
        }
        expect(jumps(samples), `step ${step}`).toEqual([]);
      }
      expect(travelled).toEqual([]);
      expect(checked).toBeGreaterThan(10);
    }
  );
});
