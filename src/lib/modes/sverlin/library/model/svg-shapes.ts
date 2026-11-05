/**
 * The shapes an inline SVG draws, a drawing's or maths', read from its markup on the layout model
 * rather than from the page: each shape's outline as lines through points, its transforms and the
 * viewBox applied, as the page's scene follows a drawn shape along its outline (see drawingShapes
 * in ../scene.ts).
 */

import type { ScenePoint, SceneShape } from '../scene';
import { isElement, type ModelElement } from './tree';

/** An affine transform, as SVG's matrix(a b c d e f). */
export type Matrix = [number, number, number, number, number, number];

const identity: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply([a, b, c, d, e, f]: Matrix, [g, h, i, j, k, l]: Matrix): Matrix {
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f
  ];
}

const apply = ([a, b, c, d, e, f]: Matrix, x: number, y: number): ScenePoint => ({
  x: a * x + c * y + e,
  y: b * x + d * y + f
});

const numbersIn = (text: string) =>
  text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/giu)?.map(Number) ?? [];

/** A transform attribute's matrix: its functions applied left to right. */
export function transformOf(text: string | undefined): Matrix {
  let matrix = identity;
  for (const [, name, args] of (text ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/gu)) {
    const n = numbersIn(args);
    let own: Matrix = identity;
    if (name === 'matrix' && n.length === 6) own = n as Matrix;
    else if (name === 'translate') own = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
    else if (name === 'scale') own = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (name === 'rotate') {
      const angle = ((n[0] ?? 0) * Math.PI) / 180;
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
      const [cx, cy] = [n[1] ?? 0, n[2] ?? 0];
      own = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
    } else if (name === 'skewX') own = [1, 0, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (name === 'skewY') own = [1, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    matrix = multiply(matrix, own);
  }
  return matrix;
}

/** The matrix from an svg root's own units to its box, by its viewBox (xMidYMid meet). */
export function viewBoxMatrix(svg: ModelElement, width: number, height: number): Matrix {
  const box = numbersIn(svg.attributes.viewBox ?? svg.attributes.viewbox ?? '');
  if (box.length !== 4 || !box[2] || !box[3]) return identity;
  const [minX, minY, w, h] = box;
  const scale = Math.min(width / w, height / h);
  return [
    scale,
    0,
    0,
    scale,
    (width - w * scale) / 2 - minX * scale,
    (height - h * scale) / 2 - minY * scale
  ];
}

type Segment = ScenePoint[];
/** A shape's outline in its own units: each part's corners and curves as control points. */
type Outline = { parts: { start: ScenePoint; segments: Segment[] }[]; closed: boolean };

/** A path's outline: each subpath, each segment a line (one point) or a cubic (three). */
function pathOutline(d: string): Outline {
  const parts: Outline['parts'] = [];
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gu) ?? [];
  let at = 0;
  let command = '';
  let current = { x: 0, y: 0 };
  let start = current;
  let control: ScenePoint | undefined;
  let quadratic: ScenePoint | undefined;
  const number = () => Number(tokens[at++]);
  const hasNumber = () => at < tokens.length && !/^[a-zA-Z]$/u.test(tokens[at]);
  const segments = () => {
    if (!parts.length) parts.push({ start: current, segments: [] });
    return parts[parts.length - 1].segments;
  };
  const cubic = (c1: ScenePoint, c2: ScenePoint, end: ScenePoint) => {
    segments().push([c1, c2, end]);
    control = c2;
    current = end;
  };
  while (at < tokens.length) {
    if (/^[a-zA-Z]$/u.test(tokens[at])) command = tokens[at++];
    else if (!command) break;
    const relative = command === command.toLowerCase();
    const base = relative ? current : { x: 0, y: 0 };
    const point = () => {
      const x = number();
      const y = number();
      return { x: base.x + x, y: base.y + y };
    };
    const upper = command.toUpperCase();
    const before = { control, quadratic };
    control = undefined;
    quadratic = undefined;
    if (upper === 'Z') {
      if (current.x !== start.x || current.y !== start.y) segments().push([start]);
      current = start;
      command = '';
      continue;
    }
    if (!hasNumber()) break;
    switch (upper) {
      case 'M':
        current = start = point();
        parts.push({ start: current, segments: [] });
        command = relative ? 'l' : 'L';
        break;
      case 'L':
        current = point();
        segments().push([current]);
        break;
      case 'H':
        current = { x: number() + (relative ? current.x : 0), y: current.y };
        segments().push([current]);
        break;
      case 'V':
        current = { x: current.x, y: number() + (relative ? current.y : 0) };
        segments().push([current]);
        break;
      case 'C':
        cubic(point(), point(), point());
        break;
      case 'S': {
        const c1 = before.control
          ? { x: 2 * current.x - before.control.x, y: 2 * current.y - before.control.y }
          : current;
        cubic(c1, point(), point());
        break;
      }
      case 'Q':
      case 'T': {
        const q =
          upper === 'Q'
            ? point()
            : before.quadratic
              ? { x: 2 * current.x - before.quadratic.x, y: 2 * current.y - before.quadratic.y }
              : current;
        const end = point();
        const from = current;
        cubic(
          { x: from.x + (2 / 3) * (q.x - from.x), y: from.y + (2 / 3) * (q.y - from.y) },
          { x: end.x + (2 / 3) * (q.x - end.x), y: end.y + (2 / 3) * (q.y - end.y) },
          end
        );
        control = undefined;
        quadratic = q;
        break;
      }
      case 'A': {
        const rx = Math.abs(number());
        const ry = Math.abs(number());
        const rotation = number();
        const large = number() !== 0;
        const sweep = number() !== 0;
        const end = point();
        for (const piece of arcCubics(current, end, rx, ry, rotation, large, sweep))
          cubic(piece[0], piece[1], piece[2]);
        control = undefined;
        break;
      }
      default:
        at = tokens.length;
    }
  }
  return { parts, closed: /z\s*$/iu.test(d) };
}

/** An elliptical arc as cubics of at most a quarter turn each (SVG 2's arc implementation notes). */
function arcCubics(
  from: ScenePoint,
  to: ScenePoint,
  rx: number,
  ry: number,
  rotation: number,
  large: boolean,
  sweep: boolean
): [ScenePoint, ScenePoint, ScenePoint][] {
  if (!rx || !ry || (from.x === to.x && from.y === to.y)) return [[from, to, to]];
  const phi = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const grow = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (grow > 1) {
    rx *= Math.sqrt(grow);
    ry *= Math.sqrt(grow);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const factor =
    (large === sweep ? -1 : 1) *
    Math.sqrt(Math.max(0, numerator / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (factor * rx * y1) / ry;
  const cy1 = (-factor * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const count = Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9) || 1;
  const step = delta / count;
  const k = (4 / 3) * Math.tan(step / 4);
  const on = (theta: number) => ({
    x: cx + rx * Math.cos(theta) * cos - ry * Math.sin(theta) * sin,
    y: cy + rx * Math.cos(theta) * sin + ry * Math.sin(theta) * cos
  });
  const tangent = (theta: number) => ({
    x: -rx * Math.sin(theta) * cos - ry * Math.cos(theta) * sin,
    y: -rx * Math.sin(theta) * sin + ry * Math.cos(theta) * cos
  });
  return Array.from({ length: count }, (_, index) => {
    const a = start + index * step;
    const b = a + step;
    const [p, q] = [on(a), on(b)];
    const [ta, tb] = [tangent(a), tangent(b)];
    return [
      { x: p.x + k * ta.x, y: p.y + k * ta.y },
      { x: q.x - k * tb.x, y: q.y - k * tb.y },
      index === count - 1 ? to : q
    ];
  });
}

const length = (element: ModelElement, name: string) => Number(element.attributes[name] ?? 0) || 0;

/** A basic shape's outline, as a path's, in its own units. */
function shapeOutline(element: ModelElement): Outline | undefined {
  const { tag, attributes } = element;
  const ellipse = (cx: number, cy: number, rx: number, ry: number): Outline =>
    rx > 0 && ry > 0
      ? pathOutline(
          `M${cx + rx},${cy}A${rx},${ry} 0 0 1 ${cx - rx},${cy}A${rx},${ry} 0 0 1 ${cx + rx},${cy}Z`
        )
      : { parts: [], closed: true };
  switch (tag) {
    case 'path':
      return pathOutline(attributes.d ?? '');
    case 'circle':
      return ellipse(
        length(element, 'cx'),
        length(element, 'cy'),
        length(element, 'r'),
        length(element, 'r')
      );
    case 'ellipse':
      return ellipse(
        length(element, 'cx'),
        length(element, 'cy'),
        length(element, 'rx'),
        length(element, 'ry')
      );
    case 'rect': {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((name) => length(element, name));
      if (!(w > 0 && h > 0)) return { parts: [], closed: true };
      const rx = Math.min(length(element, attributes.rx ? 'rx' : 'ry'), w / 2);
      const ry = Math.min(length(element, attributes.ry ? 'ry' : 'rx'), h / 2);
      if (!rx || !ry) return pathOutline(`M${x},${y}H${x + w}V${y + h}H${x}Z`);
      return pathOutline(
        `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`
      );
    }
    case 'line':
      return pathOutline(
        `M${length(element, 'x1')},${length(element, 'y1')}L${length(element, 'x2')},${length(element, 'y2')}`
      );
    case 'polyline':
    case 'polygon': {
      const n = numbersIn(attributes.points ?? '');
      if (n.length < 4) return undefined;
      const corners = Array.from(
        { length: Math.floor(n.length / 2) },
        (_, i) => `${n[2 * i]},${n[2 * i + 1]}`
      );
      return {
        ...pathOutline(`M${corners.join('L')}${tag === 'polygon' ? 'Z' : ''}`),
        closed: tag === 'polygon'
      };
    }
    default:
      return undefined;
  }
}

/** A point on a cubic. */
function onCubic(p0: ScenePoint, [c1, c2, p3]: Segment, t: number): ScenePoint {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y
  };
}

const distance = (a: ScenePoint, b: ScenePoint) => Math.hypot(b.x - a.x, b.y - a.y);

// As the page follows a shape: points about three quarters of a frame pixel apart, and at most 400
// for a shape (see drawingShapes in ../scene.ts).
const shapeSpacing = 0.75;
const shapePoints = 400;

/** An outline as lines through points in frame pixels, given the matrix to them. */
function traced(outline: Outline, matrix: Matrix): ScenePoint[][] {
  const mapped = outline.parts.map(({ start, segments }) => ({
    start: apply(matrix, start.x, start.y),
    segments: segments.map((segment) => segment.map(({ x, y }) => apply(matrix, x, y)))
  }));
  // A cubic's length is near its control polygon's; enough to space the points.
  let total = 0;
  for (const { start, segments } of mapped) {
    let from = start;
    for (const segment of segments) {
      let at = from;
      for (const point of segment) {
        total += distance(at, point);
        at = point;
      }
      from = segment[segment.length - 1];
    }
  }
  const step = Math.max(shapeSpacing, total / shapePoints);
  const round = (value: number) => Math.round(value * 100) / 100;
  return mapped
    .map(({ start, segments }) => {
      const points = [start];
      let from = start;
      for (const segment of segments) {
        if (segment.length === 1) points.push(segment[0]);
        else {
          const reach =
            distance(from, segment[0]) +
            distance(segment[0], segment[1]) +
            distance(segment[1], segment[2]);
          const count = Math.max(1, Math.ceil(reach / step));
          for (let index = 1; index <= count; index++)
            points.push(onCubic(from, segment, index / count));
        }
        from = segment[segment.length - 1];
      }
      return points.map(({ x, y }) => ({ x: round(x), y: round(y) }));
    })
    .filter((part) => part.length > 1);
}

type Inherited = { fill: string; stroke: string; strokeWidth: number; evenOdd: boolean };

/**
 * The shapes an svg root draws, given the matrix from its own box to frame pixels and its text
 * colour, which currentColor names. Text in it is not traced, as the page's scene leaves it.
 */
export function svgShapes(
  svg: ModelElement,
  toFrame: Matrix,
  width: number,
  height: number,
  color: string
): SceneShape[] {
  const shapes: SceneShape[] = [];
  const paint = (value: string | undefined, above: string) =>
    value === undefined || value === 'inherit'
      ? above
      : /^currentcolor$/iu.test(value)
        ? color
        : value;
  const visit = (element: ModelElement, matrix: Matrix, above: Inherited) => {
    const { attributes } = element;
    const own: Inherited = {
      fill: paint(attributes.fill ?? element.style.fill, above.fill),
      stroke: paint(attributes.stroke ?? element.style.stroke, above.stroke),
      strokeWidth:
        attributes['stroke-width'] === undefined
          ? above.strokeWidth
          : Number.parseFloat(attributes['stroke-width']) || 0,
      evenOdd:
        attributes['fill-rule'] === undefined
          ? above.evenOdd
          : attributes['fill-rule'] === 'evenodd'
    };
    const at = element === svg ? matrix : multiply(matrix, transformOf(attributes.transform));
    if (['text', 'tspan', 'title', 'defs', 'marker', 'clipPath', 'mask'].includes(element.tag))
      return;
    const outline = shapeOutline(element);
    if (outline) {
      const units = Math.hypot(at[0], at[1]);
      const fill = own.fill === 'none' || element.tag === 'line' ? undefined : own.fill;
      const stroke = own.stroke === 'none' ? undefined : own.stroke;
      const strokeWidth = Math.round(own.strokeWidth * units * 100) / 100;
      if (fill || (stroke && strokeWidth)) {
        const parts = traced(outline, at);
        if (parts.length)
          shapes.push({
            parts,
            closed:
              outline.closed || ['circle', 'ellipse', 'rect', 'polygon'].includes(element.tag),
            ...(fill ? { fill } : {}),
            ...(stroke && strokeWidth ? { stroke, strokeWidth } : {}),
            ...(own.evenOdd ? { evenOdd: true as const } : {})
          });
      }
    }
    for (const child of element.children) if (isElement(child)) visit(child, at, own);
  };
  visit(svg, multiply(toFrame, viewBoxMatrix(svg, width, height)), {
    fill: '#000000',
    stroke: 'none',
    strokeWidth: 1,
    evenOdd: false
  });
  return shapes;
}
