/**
 * The links of a node laid out in a row or column, drawn over it (see LinkOverlay.svelte): routed
 * between the boxes of the elements their ends name, and the room they draw past its children,
 * which its padding grows to hold. Read the same whether the node is mounted or a step's markup laid
 * out on the layout model (see model/reserve.ts).
 */

import { headDrawing, headTrim } from './heads';
import type { Line } from './LinkLines.svelte';
import { labelsIn, markerLook } from './markers';
import { descendants, type Reader } from './reader';
import { curvePath, pathBounds, routeCurve, wirePath, type Box } from './route';
import { seenParts, unionOf } from './visible';
import { routeWires } from './wires';

/** Room on each side of a box, in pixels. */
export type Sides = { top: number; right: number; bottom: number; left: number };

/** A host's links routed: the lines to draw, where their labels go, and what they reach. */
export type OverlayRoute<E> = {
  lines: Line[];
  labels: { label: E; middle: { x: number; y: number } }[];
  /** The host's children's boxes, and every box the links draw: paths, heads and labels. */
  children: Box[];
  reached: Box[];
};

/**
 * Route the links a row or column holds, each between the boxes of the elements its ends name,
 * inside the host: an arc that clears the boxes between and around them, over ends side by side or
 * to the right of ends one above the other, or a wire round them; its label on its middle.
 */
export function routeOverlay<E>(read: Reader<E>, host: E, axis: 'row' | 'column'): OverlayRoute<E> {
  // Where an element is laid out in the host, in its own units.
  const boxOf = (element: E): Box => {
    const { x, y, width, height } = read.boxIn(element, host);
    return { left: x, top: y, right: x + width, bottom: y + height };
  };
  const isMarker = (element: E) => read.attribute(element, 'data-sv-link') !== undefined;
  const children = read
    .children(host)
    .filter(
      (child) => !isMarker(child) && read.attribute(child, 'data-sv-link-label') === undefined
    );
  const markers = read
    .children(host)
    .filter((child) => isMarker(child) && read.attribute(child, 'data-sv-hoist') === undefined);
  const labels = labelsIn(read, host);
  // An end names the node drawing an element of the state, the outermost first, met where it is
  // seen (see visible.ts).
  const anchors: Record<string, Box> = {};
  for (const child of children)
    for (const inner of [child, ...descendants(read, child)]) {
      const name = read.attribute(inner, 'data-sv-slot');
      if (name && !(name in anchors)) anchors[name] = unionOf(seenParts(read, inner).map(boxOf));
    }
  const boxes = children.map(boxOf);
  const centre = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
  const overlaps = (a: Box, b: Box) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  const linked = markers.flatMap((marker) => {
    const from = anchors[read.attribute(marker, 'data-from') ?? ''];
    const to = anchors[read.attribute(marker, 'data-to') ?? ''];
    return from && to && from !== to
      ? [{ marker, from, to, ...markerLook((name) => read.attribute(marker, name)) }]
      : [];
  });
  // Wires are routed together round the cells, so their runs keep apart: each between the cells
  // holding its ends, or the boxes inside them it meets.
  const cellOf = (end: Box) => boxes.findIndex((box) => overlaps(box, end));
  const wired = linked.filter(
    ({ route, from, to }) =>
      route === 'wire' && cellOf(from) >= 0 && cellOf(to) >= 0 && cellOf(from) !== cellOf(to)
  );
  const same = (a: Box, b: Box) => a.left === b.left && a.top === b.top && a.right === b.right;
  const inner = boxes.map(() => [] as Box[]);
  for (const { from, to } of wired)
    for (const end of [from, to]) {
      const cell = boxes[cellOf(end)];
      const ends = inner[cellOf(end)];
      if (!same(cell, end) && !ends.some((each) => same(each, end))) ends.push(end);
    }
  const wireEnd = (end: Box) => {
    const ends = inner[cellOf(end)];
    const at = ends.findIndex((each) => same(each, end));
    return { child: cellOf(end), ...(ends.length ? { end: Math.max(0, at) } : {}) };
  };
  const wires = new Map(
    routeWires(
      boxes.map((box, cell) => ({ box, ends: inner[cell] })),
      wired.map(({ from, to }) => ({ from: wireEnd(from), to: wireEnd(to) }))
    ).map((corners, i) => [wired[i], corners])
  );
  const placed: OverlayRoute<E>['labels'] = [];
  const reached: Box[] = [];
  const lines = linked.map((link): Line => {
    const { marker, from, to, route, head } = link;
    const attribute = (name: string) => read.attribute(marker, name);
    const directed = attribute('data-directed') !== 'false';
    const heads = { start: !directed, end: true };
    const trim = {
      start: heads.start ? headTrim(head?.shape, head?.size ?? 0) : 0,
      end: headTrim(head?.shape, head?.size ?? 0)
    };
    const corners = wires.get(link);
    let path: string;
    let middle: { x: number; y: number };
    let ends: { start: { x: number; y: number }; end: { x: number; y: number } };
    if (corners?.length) ({ path, middle, ...ends } = wirePath(corners, trim));
    else {
      const [p, q] = [centre(from), centre(to)];
      // Ends side by side arc over them, ends one above the other beside them, wherever the link
      // is written: a link in a column can join two cells of a row inside it.
      const wide = Math.abs(q.x - p.x);
      const tall = Math.abs(q.y - p.y);
      const sideBySide = wide === tall ? axis === 'row' : wide > tall;
      const across = sideBySide ? q.x - p.x : q.y - p.y;
      // A straight link runs straight; else it arcs over ends side by side, or to the right of
      // ends one above the other, further where the first arc would cross a box. Ends far apart
      // arc about as high as their boxes, not in proportion to how far apart they are, so the
      // room the host keeps for the arc stays small.
      const extent = sideBySide
        ? Math.max(from.bottom - from.top, to.bottom - to.top)
        : Math.max(from.right - from.left, to.right - to.left);
      const low = Math.min(0.8, extent / Math.hypot(wide, tall));
      const order =
        route === 'straight'
          ? [0]
          : across
            ? [...new Set([low, Math.min(0.8, low * 1.5), 0.8, 1.1])].map(
                (amount) => -amount * Math.sign(across)
              )
            : [0.3, -0.3];
      const obstacles = boxes.filter((box) => !overlaps(box, from) && !overlaps(box, to));
      const routed = routeCurve(from, to, obstacles, order);
      ({ path, ...ends } = curvePath(routed.curve, trim));
      middle = routed.halfway;
    }
    const id = attribute('data-sv-link');
    const label = id ? labels.get(id) : undefined;
    if (label) placed.push({ label, middle });
    reached.push(pathBounds(path));
    const reach = headDrawing(head?.shape) ? (head?.size ?? 0) : 0;
    for (const { x, y } of [...(heads.start ? [ends.start] : []), ends.end])
      if (reach)
        reached.push({ left: x - reach, top: y - reach, right: x + reach, bottom: y + reach });
    if (label) {
      const { width, height } = read.size(label);
      reached.push({
        left: middle.x - width / 2,
        top: middle.y - height / 2,
        right: middle.x + width / 2,
        bottom: middle.y + height / 2
      });
    }
    return {
      path,
      link: `${attribute('data-from')}${directed ? ' -> ' : ' - '}${attribute('data-to')}`,
      ...(id ? { id } : {}),
      heads,
      ...(head ? { head } : {}),
      style: link.style
    };
  });
  return { lines, labels: placed, children: boxes, reached };
}

/**
 * The room each side needs for what the links draw past the children there, beyond the host's own
 * padding: measured from the children, it stays the same once added, wherever they sit inside.
 */
export function overlayRoom(
  children: readonly Box[],
  reached: readonly Box[],
  padding: Sides
): Sides {
  // How far what the links draw reaches past the children on a side, outward from the host.
  const past = (side: keyof Box, outward: 1 | -1) => {
    const farthest = (boxes: readonly Box[]) =>
      Math.max(...boxes.map((box) => outward * box[side]));
    return children.length && reached.length ? farthest(reached) - farthest(children) : 0;
  };
  return {
    top: Math.max(0, past('top', -1) - padding.top),
    right: Math.max(0, past('right', 1) - padding.right),
    bottom: Math.max(0, past('bottom', 1) - padding.bottom),
    left: Math.max(0, past('left', -1) - padding.left)
  };
}
