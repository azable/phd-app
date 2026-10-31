/**
 * Whether a step's picture is sound, from its scene data (see scene.ts): no two nodes overlap
 * unless one holds the other, no text runs out of its node, nothing lies outside the frame, and
 * every link reaches a node at each end. Layouts may change with how they are worked out; these
 * are what must hold whatever the layout.
 */

import type { SceneBox, SceneFrame, ScenePoint, SceneStep } from './scene';

/** How far apart, in frame pixels, two edges may be and still count as meeting: scenes round. */
const slack = 0.5;
/** How far a link's end may stop short of the node it reaches: heads end at the border's middle. */
const reach = 2;

const overlap = (a: SceneBox, b: SceneBox) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > slack &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > slack;

const inside = (inner: SceneBox, outer: SceneBox) =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  inner.x + inner.width <= outer.x + outer.width + slack &&
  inner.y + inner.height <= outer.y + outer.height + slack;

const distance = (point: ScenePoint, box: SceneBox) =>
  Math.hypot(
    Math.max(box.x - point.x, 0, point.x - box.x - box.width),
    Math.max(box.y - point.y, 0, point.y - box.y - box.height)
  );

/** Points along a cubic curve, its ends included: its control points can lie off it. */
function along([p, c, d, q]: readonly ScenePoint[]): ScenePoint[] {
  return Array.from({ length: 11 }, (_, index) => {
    const t = index / 10;
    const u = 1 - t;
    const mix = (a: number, b: number, e: number, f: number) =>
      u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * e + t * t * t * f;
    return { x: mix(p.x, c.x, d.x, q.x), y: mix(p.y, c.y, d.y, q.y) };
  });
}

/** What is unsound in a step's picture, as sentences naming the nodes and links concerned. */
export function unsound(frame: SceneFrame, step: SceneStep): string[] {
  const problems: string[] = [];
  const nodes = step.nodes.filter(({ box }) => box.width > 0 && box.height > 0);
  const parents = new Map(step.nodes.map((node) => [node.id, node.parent]));
  const holds = (outer: string, inner: string) => {
    for (let at = parents.get(inner); at !== undefined; at = parents.get(at))
      if (at === outer) return true;
    return false;
  };
  // A node drawn inside another is held by it, though a hidden node between them leaves no parent.
  const nested = (a: SceneBox, b: SceneBox) => inside(a, b) || inside(b, a);
  nodes.forEach((a, index) => {
    for (const b of nodes.slice(index + 1))
      if (
        a.id !== b.id &&
        !holds(a.id, b.id) &&
        !holds(b.id, a.id) &&
        !nested(a.box, b.box) &&
        overlap(a.box, b.box)
      )
        problems.push(`nodes ${a.id} and ${b.id} overlap`);
    for (const run of a.runs ?? [])
      if (!inside(run.box, a.box)) problems.push(`text "${run.text}" runs out of node ${a.id}`);
    if (!inside(a.box, { x: 0, y: 0, width: frame.width, height: frame.height }))
      problems.push(`node ${a.id} lies outside the frame`);
  });
  for (const link of step.links) {
    const points = link.curve ? along(link.curve) : (link.wire ?? []);
    const ends = [link.heads?.start?.tip ?? points[0], link.heads?.end?.tip ?? points.at(-1)];
    for (const end of ends)
      if (end && !nodes.some(({ box }) => distance(end, box) <= reach))
        problems.push(`link ${link.from} -> ${link.to} ends away from any node`);
    for (const point of points)
      if (distance(point, { x: 0, y: 0, width: frame.width, height: frame.height }) > slack) {
        problems.push(`link ${link.from} -> ${link.to} runs outside the frame`);
        break;
      }
  }
  return problems;
}
