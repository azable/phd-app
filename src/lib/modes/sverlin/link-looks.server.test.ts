/**
 * How links look in the scenes the server draws: their heads, each shape and size meeting the box
 * it points at, at both ends of a two-way line; two <Link>s drawn as two arrows, never one line;
 * labels drawn from a link's children on its middle; and wires.
 */

import { expect, it } from 'vitest';

import cards from './fixtures/bfs-cards.sverlin?raw';
import undirected from './fixtures/bfs-undirected.sverlin?raw';
import dijkstra from './fixtures/dijkstra-fields.sverlin?raw';
import type { SceneLink, ScenePoint, SceneStep } from './library';
import { pausingEveryLabel } from './testing/every-pause';
import { centreOf, drawnSteps, edgeOf, endsOf, ofKind } from './testing/scenes';

/** A source's scene built with chosen values, at a step. */
/** A step's links between elements, leaving out those from a variable's label, as current's arrow. */
const elementLinks = (step: SceneStep) => step.links.filter(({ from }) => from.includes('['));

async function open(source: string, chosen: Record<string, string | number>, step = 0) {
  const { steps } = await drawnSteps(pausingEveryLabel(source), { chosen });
  return steps[step];
}

/**
 * Each drawn link's ends: where each reaches (a head's tip, or the line's own end), how far that is
 * from the nearest box of a kind, and the shape of its head at each end.
 */
function reaches(step: SceneStep, ...kinds: string[]) {
  const boxes = kinds.flatMap((kind) => ofKind(step, kind)).map(({ box }) => box);
  const gap = ({ x, y }: ScenePoint) =>
    Math.min(
      ...boxes.map((box) =>
        Math.hypot(
          Math.max(box.x - x, 0, x - box.x - box.width),
          Math.max(box.y - y, 0, y - box.y - box.height)
        )
      )
    );
  return elementLinks(step).map((link) => ({
    edge: edgeOf(link),
    start: link.heads?.start?.shape,
    end: link.heads?.end?.shape,
    gaps: endsOf(link).map(gap)
  }));
}

/** Points along a link, its curve sampled or its wire's corners, from start to end. */
function pointsAlong(link: SceneLink): ScenePoint[] {
  if (link.wire) return link.wire;
  const [a, b, c, d] = link.curve!;
  return Array.from({ length: 41 }, (_, k) => {
    const t = k / 40;
    const mix = (p: number, q: number, r: number, s: number) =>
      (1 - t) ** 3 * p + 3 * (1 - t) ** 2 * t * q + 3 * (1 - t) * t ** 2 * r + t ** 3 * s;
    return { x: mix(a.x, b.x, c.x, d.x), y: mix(a.y, b.y, c.y, d.y) };
  });
}

/** A link's middle by length along it. */
function middleOf(link: SceneLink): ScenePoint {
  const points = pointsAlong(link);
  const lengths = points.slice(1).map((p, k) => Math.hypot(p.x - points[k].x, p.y - points[k].y));
  let left = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (const [k, length] of lengths.entries()) {
    if (left <= length) {
      const t = length ? left / length : 0;
      return {
        x: points[k].x + (points[k + 1].x - points[k].x) * t,
        y: points[k].y + (points[k + 1].y - points[k].y) * t
      };
    }
    left -= length;
  }
  return points[points.length - 1];
}

it(
  'draws every head shape and size with its tip on the edge of the box it points at',
  { timeout: 120_000 },
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
      const step = await open(cards, {
        'Graph.form': 'scatter',
        'Graph.layoutSeed': 10,
        'Graph.Link.head': head,
        'Graph.Link.headSize': headSize
      });
      // A card for each vertex but the start, whose name is its box.
      const links = reaches(step, 'VertexCard', 'NameText');
      expect(links, head).toHaveLength(5);
      for (const link of links) {
        expect(link.end, `${head} ${headSize}`).toBe(head);
        expect(link.start).toBeUndefined();
        expect(link.gaps[1], `${head} ${headSize} ${link.edge}`).toBeLessThan(3);
      }
    }
  }
);

it(
  'draws a two-way line’s head at both its ends, each tip on its box, once it has one',
  { timeout: 60_000 },
  async () => {
    const links = reaches(await open(undirected, { 'Graph.Link.head': 'arrow' }), 'VertexCard');
    expect(links).toHaveLength(5);
    for (const link of links) {
      expect(link.edge).toContain(' - ');
      expect([link.start, link.end]).toEqual(['arrow', 'arrow']);
      expect(Math.max(...link.gaps), link.edge).toBeLessThan(3);
    }
  }
);

it(
  'draws two <Link>s joining two elements both ways as two arrows, never one line',
  { timeout: 60_000 },
  async () => {
    const twoTags = undirected
      .replace('[[1, 2], [0, 3], [0, 3], [1, 2, 4], [3]]', '[[1, 2], [3], [3], [4], []]')
      .replace('<Link from={k} to={w} />', '<Link from={k} to={w} /><Link from={w} to={k} />');
    const links = reaches(await open(twoTags, {}), 'VertexCard');
    expect(links).toHaveLength(10);
    expect(
      links.every(({ edge, start, end }) => edge.includes(' -> ') && !start && end === 'arrow')
    ).toBe(true);
  }
);

it(
  'draws a link’s children as its label on its middle, a node of its own kind',
  { timeout: 60_000 },
  async () => {
    const step = await open(dijkstra, {}, 1);
    // Each label's node, drawn over the links, and the middle of the link nearest it.
    const labels = ofKind(step, 'WeightText').map((node) => {
      const centre = centreOf(node.box);
      return {
        text: (node.runs ?? []).map(({ text }) => text).join(' '),
        kind: node.kind,
        visible: true,
        off: Math.min(
          ...elementLinks(step).map((link) => {
            const at = middleOf(link);
            return Math.hypot(centre.x - at.x, centre.y - at.y);
          })
        )
      };
    });
    expect(labels.map(({ text }) => text).sort()).toEqual(['1', '10', '2', '2', '4', '5', '8']);
    for (const label of labels) {
      expect(label.kind).toBe('WeightText');
      expect(label.visible).toBe(true);
      // A curve's middle by length and by its parameter differ where it bends, the more as the
      // vertices sit closer (no room kept round them for a pointer since 7 November 2026).
      expect(label.off, label.text).toBeLessThan(24);
    }
  }
);

it(
  'draws wires in straight runs turning at right angles, round the boxes between',
  { timeout: 60_000 },
  async () => {
    const step = await open(cards, { 'Graph.form': 'natural', 'Graph.Link.route': 'wire' });
    const boxes = ofKind(step, 'VertexCard').map(({ box }) => box);
    const wires = elementLinks(step).map((link) => {
      const corners = link.wire ?? [];
      const square = corners
        .slice(1)
        .every(
          (b, k) => Math.min(Math.abs(b.x - corners[k].x), Math.abs(b.y - corners[k].y)) < 0.5
        );
      // Sampled along it, the wire crosses no vertex's card but at its two ends.
      const crossed = new Set<number>();
      const runs = corners.slice(1).map((b, k) => [corners[k], b] as const);
      const total = runs.reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0);
      let along = 0;
      for (const [a, b] of runs) {
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        for (let at = 0; at < length; at += 2) {
          const done = along + at;
          if (done < total * 0.05 || done > total * 0.95) continue;
          const x = a.x + ((b.x - a.x) * at) / length;
          const y = a.y + ((b.y - a.y) * at) / length;
          boxes.forEach((box, n) => {
            if (
              x > box.x + 1 &&
              x < box.x + box.width - 1 &&
              y > box.y + 1 &&
              y < box.y + box.height - 1
            )
              crossed.add(n);
          });
        }
        along += length;
      }
      return { square, crossed: crossed.size, d: link.curve ? 'C' : JSON.stringify(corners) };
    });
    expect(wires).toHaveLength(5);
    for (const wire of wires) {
      expect(wire.d).not.toContain('C');
      expect(wire.square, wire.d).toBe(true);
      expect(wire.crossed, wire.d).toBeLessThanOrEqual(2);
    }
  }
);
