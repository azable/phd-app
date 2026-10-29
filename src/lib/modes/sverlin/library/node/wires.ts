/**
 * Wires: links drawn in straight runs that turn only at right angles, as in a circuit or a
 * flowchart. Each is the shortest such path, with as few turns as it can take, along lines just
 * clear of every box and halfway between them, round the boxes between its ends; runs of several
 * wires along one line are then spread apart by WebCola's grid router. Its router itself takes
 * only boxes whose rows and columns line up, as a grid's, so free layouts route here.
 */

import { GridRouter } from 'webcola/dist/src/gridrouter';

import type { Box } from './route';

type Point = { x: number; y: number };

/** How far apart runs side by side are kept, and how far clear of a box a run passes, in pixels. */
const spread = 6;
const clearance = 10;
/** What a turn costs, in pixels of run, so a wire turns only where it saves at least that much. */
const turn = 40;

/**
 * A child a wire may end at: its box, and the boxes inside it that wires meet instead, as a
 * vertex's name cell inside the column holding its caption too.
 */
export type WireChild = { box: Box; ends?: readonly Box[] };

/** A wire's end: a child, and which of its inner boxes, if any, it meets. */
export type WireEnd = { child: number; end?: number };

/**
 * The corners of a wire for each link, from the edge of the box at its start to the edge of the box
 * at its end, round every other child; a wire meeting a box inside a child may run inside that
 * child to reach it. All of an arrangement's wires are routed together, so their runs keep apart.
 */
export function routeWires(
  children: readonly WireChild[],
  links: readonly { from: WireEnd; to: WireEnd }[]
): Point[][] {
  if (!links.length) return [];
  const boxOf = ({ child, end }: WireEnd) =>
    end === undefined ? children[child].box : (children[child].ends?.[end] ?? children[child].box);
  const all = children.flatMap(({ box, ends }) => [box, ...(ends ?? [])]);
  const lines = (low: (box: Box) => number, high: (box: Box) => number) => {
    const at = [
      ...new Set(
        all.flatMap((box) => [
          low(box) - clearance,
          (low(box) + high(box)) / 2,
          high(box) + clearance
        ])
      )
    ].sort((a, b) => a - b);
    const between = at.slice(1).map((value, i) => (value + at[i]) / 2);
    return [...new Set([...at, ...between].map((value) => Math.round(value * 2) / 2))].sort(
      (a, b) => a - b
    );
  };
  const xs = lines(
    (box) => box.left,
    (box) => box.right
  );
  const ys = lines(
    (box) => box.top,
    (box) => box.bottom
  );
  // One point per crossing, shared by every wire through it, so the grid router can tell where
  // wires run together.
  const points = ys.map((y) => xs.map((x) => ({ x, y })));
  const paths = links.map(({ from, to }) => {
    const [start, end] = [boxOf(from), boxOf(to)];
    const obstacles = children.flatMap(({ box }, child) =>
      child === from.child || child === to.child ? [] : [box]
    );
    return clipped(
      shortest(xs, ys, points, start, end, obstacles) ?? elbow(start, end),
      start,
      end
    );
  });
  // Runs along one line are spread apart in the order the wires leave and join it.
  const order = GridRouter.orderEdges(paths.map((path) => [...path]));
  const routes = paths.map((path) => GridRouter.makeSegments(path));
  GridRouter.nudgeSegments(routes, 'x', 'y', order, spread);
  GridRouter.nudgeSegments(routes, 'y', 'x', order, spread);
  return routes.map((segments) =>
    segments
      .flatMap((segment, index) => (index ? [segment[1]] : segment))
      .map(({ x, y }) => ({ x, y }))
  );
}

const inside = ({ x, y }: Point, box: Box) =>
  x > box.left && x < box.right && y > box.top && y < box.bottom;

/**
 * The cheapest path along the lines from one box's centre to another's, its length and its turns,
 * through no obstacle: every crossing it passes.
 */
function shortest(
  xs: readonly number[],
  ys: readonly number[],
  points: readonly (readonly Point[])[],
  start: Box,
  end: Box,
  obstacles: readonly Box[]
): Point[] | undefined {
  const centre = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
  const nearest = (values: readonly number[], value: number) =>
    values.reduce(
      (best, each, i) => (Math.abs(each - value) < Math.abs(values[best] - value) ? i : best),
      0
    );
  const [from, to] = [centre(start), centre(end)];
  const source = { i: nearest(xs, from.x), j: nearest(ys, from.y) };
  const target = { i: nearest(xs, to.x), j: nearest(ys, to.y) };
  const open = (i: number, j: number) => !obstacles.some((box) => inside(points[j][i], box));
  // A run between neighbouring crossings is open where its middle is clear of every box.
  const runs = (i: number, j: number, di: number, dj: number) =>
    open(i + di, j + dj) &&
    !obstacles.some((box) =>
      inside(
        {
          x: (points[j][i].x + points[j + dj][i + di].x) / 2,
          y: (points[j][i].y + points[j + dj][i + di].y) / 2
        },
        box
      )
    );
  // Dijkstra over crossings and the way into them, across or down, so turns can cost.
  const key = (i: number, j: number, across: boolean) => ((j * xs.length + i) << 1) | +across;
  const cost = new Map<number, number>();
  const back = new Map<number, number>();
  const queue: [number, number, number, boolean][] = [];
  const push = (c: number, i: number, j: number, across: boolean, from?: number) => {
    const k = key(i, j, across);
    if ((cost.get(k) ?? Infinity) <= c) return;
    cost.set(k, c);
    if (from !== undefined) back.set(k, from);
    queue.push([c, i, j, across]);
    for (let n = queue.length - 1; n > 0; ) {
      const parent = (n - 1) >> 1;
      if (queue[parent][0] <= queue[n][0]) break;
      [queue[parent], queue[n]] = [queue[n], queue[parent]];
      n = parent;
    }
  };
  const pop = () => {
    const top = queue[0];
    const last = queue.pop() as (typeof queue)[number];
    if (queue.length) {
      queue[0] = last;
      for (let n = 0; ; ) {
        const [l, r] = [2 * n + 1, 2 * n + 2];
        let least = n;
        if (l < queue.length && queue[l][0] < queue[least][0]) least = l;
        if (r < queue.length && queue[r][0] < queue[least][0]) least = r;
        if (least === n) break;
        [queue[least], queue[n]] = [queue[n], queue[least]];
        n = least;
      }
    }
    return top;
  };
  push(0, source.i, source.j, true);
  push(0, source.i, source.j, false);
  let reached: number | undefined;
  while (queue.length) {
    const [c, i, j, across] = pop();
    const k = key(i, j, across);
    if (c > (cost.get(k) ?? Infinity)) continue;
    if (i === target.i && j === target.j) {
      reached = k;
      break;
    }
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const [ni, nj] = [i + di, j + dj];
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length || !runs(i, j, di, dj)) continue;
      const goes = di !== 0;
      const length = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]);
      push(c + length + (goes === across ? 0 : turn), ni, nj, goes, k);
    }
  }
  if (reached === undefined) return undefined;
  const path: Point[] = [];
  for (let k: number | undefined = reached; k !== undefined; k = back.get(k)) {
    const cell = k >> 1;
    path.push(points[Math.floor(cell / xs.length)][cell % xs.length]);
  }
  // Every crossing it passes, shared with the wires that pass it too, for the grid router to order.
  return path.reverse();
}

/** A wire with no clear way round: across from its start, then down to its end. */
function elbow(start: Box, end: Box): Point[] {
  const [from, to] = [
    { x: (start.left + start.right) / 2, y: (start.top + start.bottom) / 2 },
    { x: (end.left + end.right) / 2, y: (end.top + end.bottom) / 2 }
  ];
  return [from, { x: to.x, y: from.y }, to];
}

/** A path from centre to centre cut where it leaves its start box and where it enters its end box. */
function clipped(path: readonly Point[], start: Box, end: Box): Point[] {
  const within = ({ x, y }: Point, box: Box) =>
    x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  // Where a straight run from a point inside a box crosses the box's edge.
  const edge = (from: Point, toward: Point, box: Box) =>
    from.y === toward.y
      ? { x: toward.x > from.x ? box.right : box.left, y: from.y }
      : { x: from.x, y: toward.y > from.y ? box.bottom : box.top };
  const leave = path.findIndex((point, n) => n > 0 && !within(point, start));
  const left =
    leave < 0 ? [...path] : [edge(path[leave - 1], path[leave], start), ...path.slice(leave)];
  const enter = left.findLastIndex((point, n) => n < left.length - 1 && !within(point, end));
  return enter < 0 ? left : [...left.slice(0, enter + 1), edge(left[enter + 1], left[enter], end)];
}
