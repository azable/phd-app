/**
 * Arrows between placed boxes: cubic curves that bend round other boxes and labels, leaving and
 * meeting their ends at the right edge, whatever arrangement placed the boxes.
 */

type Point = { x: number; y: number };

/** A box on the page, by its edges. */
export type Box = { left: number; top: number; right: number; bottom: number };

/**
 * A cubic curve from one box to another that crosses as few obstacles as it can: it tries bends to
 * either side of the straight line, in an order the seed sets, and keeps the first that crosses
 * least. The curve leaves and meets the boxes at their edges.
 */
export function routeCurve(
  from: Box,
  to: Box,
  obstacles: readonly Box[],
  preference: readonly number[],
  ends: { from?: Surround; to?: Surround } = {}
): { path: string; start: Point; end: Point; halfway: Point } {
  const centre = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
  const [p, q] = [centre(from), centre(to)];
  const distance = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const normal = { x: -(q.y - p.y) / distance, y: (q.x - p.x) / distance };
  let best:
    | { path: string; start: Point; end: Point; halfway: Point; bend: number; hits: number }
    | undefined;
  for (const bend of preference) {
    const offset = { x: normal.x * bend * distance, y: normal.y * bend * distance };
    const c1 = { x: p.x + (q.x - p.x) / 3 + offset.x, y: p.y + (q.y - p.y) / 3 + offset.y };
    const c2 = {
      x: p.x + (2 * (q.x - p.x)) / 3 + offset.x,
      y: p.y + (2 * (q.y - p.y)) / 3 + offset.y
    };
    const start = endPoint(from, ends.from, c1);
    const end = endPoint(to, ends.to, c2);
    let hits = 0;
    for (let i = 1; i < 24; i++) {
      const point = cubicAt(start, c1, c2, end, i / 24);
      for (const box of obstacles)
        if (point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom)
          hits++;
    }
    if (!best || hits < best.hits) {
      const round = (value: number) => Math.round(value * 10) / 10;
      best = {
        path: `M${round(start.x)},${round(start.y)} C${round(c1.x)},${round(c1.y)} ${round(c2.x)},${round(c2.y)} ${round(end.x)},${round(end.y)}`,
        start,
        end,
        halfway: cubicAt(start, c1, c2, end, 0.5),
        bend,
        hits
      };
    }
    if (hits === 0) break;
  }
  const { path, start, end, halfway } = best as NonNullable<typeof best>;
  return { path, start, end, halfway };
}

function cubicAt(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y
  };
}

/** Where the line from a box's centre towards a point leaves the box. */
function exitPoint(box: Box, toward: Point): Point {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx === 0 ? Infinity : (box.right - box.left) / 2 / Math.abs(dx),
    dy === 0 ? Infinity : (box.bottom - box.top) / 2 / Math.abs(dy)
  );
  return { x: cx + dx * Math.min(scale, 1), y: cy + dy * Math.min(scale, 1) };
}

/** The node around an arrow's end, when the end is a box inside it, and the node's other content. */
export type Surround = { outer: Box; parts: readonly Box[] };

/**
 * Where an arrow meets its end box, heading towards a point: at the box's edge, or, when the box sits
 * inside a node and the way out to the node's edge crosses the node's other content, such as another
 * field of a record, at the node's own edge instead, still in line with the box.
 */
function endPoint(box: Box, surround: Surround | undefined, toward: Point): Point {
  const inner = exitPoint(box, toward);
  if (!surround) return inner;
  const centre = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
  const outer = exitFrom(surround.outer, centre, toward);
  for (let i = 1; i < 10; i++) {
    const t = i / 10;
    const point = { x: inner.x + (outer.x - inner.x) * t, y: inner.y + (outer.y - inner.y) * t };
    if (
      surround.parts.some(
        (part) =>
          point.x > part.left && point.x < part.right && point.y > part.top && point.y < part.bottom
      )
    )
      return outer;
  }
  return inner;
}

/** Where a ray from a point inside a box, towards another point, leaves the box. */
function exitFrom(box: Box, origin: Point, toward: Point): Point {
  const dx = toward.x - origin.x;
  const dy = toward.y - origin.y;
  const reach = Math.min(
    dx > 0 ? (box.right - origin.x) / dx : dx < 0 ? (box.left - origin.x) / dx : Infinity,
    dy > 0 ? (box.bottom - origin.y) / dy : dy < 0 ? (box.top - origin.y) / dy : Infinity
  );
  return Number.isFinite(reach) ? { x: origin.x + dx * reach, y: origin.y + dy * reach } : origin;
}
