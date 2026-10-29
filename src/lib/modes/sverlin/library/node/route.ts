/**
 * Arrows between placed boxes: cubic curves that bend round other boxes and labels, leaving and
 * meeting their ends at the right edge, whatever arrangement placed the boxes; and the paths drawn
 * for them and for wires, stopped short where heads are drawn.
 */

type Point = { x: number; y: number };

/** A box on the page, by its edges. */
export type Box = { left: number; top: number; right: number; bottom: number };

/** A routed arrow: a cubic curve's start, two control points and end, and its middle. */
export type Routed = { curve: [Point, Point, Point, Point]; halfway: Point };

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * A curve's path, stopped short of its start and its end by lengths along it, as for heads drawn
 * there: the part of the same curve between, so a shorter line keeps its shape.
 */
export function curvePath(
  [a, b, c, d]: readonly [Point, Point, Point, Point],
  trim: { start: number; end: number }
): { path: string; start: Point; end: Point } {
  const samples = 48;
  const points = Array.from({ length: samples + 1 }, (_, i) => cubicAt(a, b, c, d, i / samples));
  const lengths = [0];
  for (let i = 1; i <= samples; i++)
    lengths.push(
      lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    );
  const total = lengths[samples];
  // The parameter at a length along the curve, between samples by their straight lengths.
  const at = (length: number) => {
    const i = Math.max(
      1,
      lengths.findIndex((each) => each >= length)
    );
    const span = lengths[i] - lengths[i - 1] || 1;
    return Math.min(1, (i - 1 + (length - lengths[i - 1]) / span) / samples);
  };
  // A head never swallows a short link whole: the trims shrink to keep a fifth of it.
  const asked = trim.start + trim.end;
  const scale = asked ? Math.min(1, (total * 0.8) / asked) : 0;
  const t0 = trim.start ? at(trim.start * scale) : 0;
  const t1 = trim.end ? at(total - trim.end * scale) : 1;
  const [p0, p1, p2, p3] = subCurve(a, b, c, d, t0, t1);
  return {
    path: `M${round(p0.x)},${round(p0.y)} C${round(p1.x)},${round(p1.y)} ${round(p2.x)},${round(p2.y)} ${round(p3.x)},${round(p3.y)}`,
    start: p0,
    end: p3
  };
}

/** The part of a cubic curve between two of its parameters, as a cubic curve of its own. */
function subCurve(a: Point, b: Point, c: Point, d: Point, t0: number, t1: number) {
  const split = (p: readonly Point[], t: number) => {
    const lerp = (u: Point, v: Point) => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
    const [ab, bc, cd] = [lerp(p[0], p[1]), lerp(p[1], p[2]), lerp(p[2], p[3])];
    const [abc, bcd] = [lerp(ab, bc), lerp(bc, cd)];
    const mid = lerp(abc, bcd);
    return { before: [p[0], ab, abc, mid], after: [mid, bcd, cd, p[3]] };
  };
  const tail = split([a, b, c, d], t0).after;
  return split(tail, t0 < 1 ? (t1 - t0) / (1 - t0) : 1).before as [Point, Point, Point, Point];
}

/**
 * A wire's path, its corners joined by straight runs, stopped short of its ends by lengths along
 * its first and last runs, and the middle of its longest run, where its label goes.
 */
export function wirePath(
  points: readonly Point[],
  trim: { start: number; end: number }
): { path: string; start: Point; end: Point; middle: Point } {
  const shown = points.map((point) => ({ ...point }));
  // A run shorter than its head keeps a sliver, so the head still points along it.
  const pull = (from: Point, toward: Point, length: number) => {
    const span = Math.hypot(toward.x - from.x, toward.y - from.y);
    if (!span || !length) return;
    const step = Math.min(length, Math.max(0, span - 1));
    from.x += ((toward.x - from.x) / span) * step;
    from.y += ((toward.y - from.y) / span) * step;
  };
  if (shown.length > 1) {
    pull(shown[0], shown[1], trim.start);
    pull(shown[shown.length - 1], shown[shown.length - 2], trim.end);
  }
  let middle = shown[0] ?? { x: 0, y: 0 };
  let longest = -1;
  for (let i = 1; i < shown.length; i++) {
    const span = Math.hypot(shown[i].x - shown[i - 1].x, shown[i].y - shown[i - 1].y);
    if (span > longest) {
      longest = span;
      middle = { x: (shown[i].x + shown[i - 1].x) / 2, y: (shown[i].y + shown[i - 1].y) / 2 };
    }
  }
  return {
    path: shown.map(({ x, y }, i) => `${i ? 'L' : 'M'}${round(x)},${round(y)}`).join(' '),
    start: shown[0],
    end: shown[shown.length - 1],
    middle
  };
}

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
): Routed {
  const centre = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
  const [p, q] = [centre(from), centre(to)];
  const distance = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const normal = { x: -(q.y - p.y) / distance, y: (q.x - p.x) / distance };
  let best: (Routed & { hits: number }) | undefined;
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
    if (!best || hits < best.hits)
      best = { curve: [start, c1, c2, end], halfway: cubicAt(start, c1, c2, end, 0.5), hits };
    if (hits === 0) break;
  }
  const { curve, halfway } = best as NonNullable<typeof best>;
  return { curve, halfway };
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
