/**
 * Scene data: what one step of a presentation draws, as plain data, which the server draws (see
 * model/scene-of.ts), the page draws with SceneView.svelte, and render targets draw again. Every
 * node and link is placed in the frame's logical coordinates (pixels of the frame, from its top
 * left corner, whatever the zoom), with its look as the layout model worked it out, and its kind
 * and the colour names its variant gave, so a target can keep what a colour means.
 */

import { linkSpecOf } from './node/arrange';
import { strokeStyleCss, type Shadow } from './node/design';
import type { TextCase } from './model/text-case';
import { headShapes, headTrim, type HeadShape } from './node/heads';
import type { Layout } from './node/props';

export type ScenePoint = { x: number; y: number };
export type SceneBox = ScenePoint & { width: number; height: number };

/** A node's look, as CSS colours and lengths in frame pixels. A missing fill or stroke is none. */
export type SceneLook = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** A broken border; a missing one is solid. */
  strokeStyle?: 'dashed' | 'dotted';
  radius?: number;
  /** Top, right, bottom, and left. */
  padding?: [number, number, number, number];
  color: string;
  font: string;
  fontSize: number;
  fontWeight: number;
  /** Its own opacity, below 1; a nested node's multiplies with its parents'. */
  opacity?: number;
  /**
   * Paint round its box, which takes no room: its shadow (see shadows in node/design.ts), hard's in
   * its stroke colour or else its text's, and its glow's colour, its stroke's or else its fill's.
   */
  shadow?: Shadow;
  glow?: string;
  /**
   * Its place's light at the step, where the step touches a place it draws (see
   * listing/places.ts): a 3px band round it, a line under it, or a ring off it, in a CSS colour.
   */
  light?: { look: 'fill' | 'underline' | 'outline'; colour: string };
  /** Its fill's style, where it is not solid. */
  fillStyle?: 'hatched';
};

export type SceneNode = {
  /** The id selections name it by (see provideNodeIds). */
  id: string;
  /** The node it sits in, if any. */
  parent?: string;
  /** Its atomic type name, if typed. */
  type?: string;
  /** Its kind of node, as Compared.Pointed: what its look is the variant's values for. */
  kind?: string;
  /** How it arranges its items or children, if it does. */
  layout?: Layout;
  collection?: true;
  /** A value node's value as shown, and its type's unit. */
  value?: string;
  unit?: string;
  /** Text written in the node itself, outside its child nodes. */
  text?: string;
  /** Every line of text the node draws itself, value included, where the page put it. */
  runs?: SceneText[];
  /** Paint behind parts of its text that are no nodes: a listing's lit code, a link's label. */
  marks?: SceneMark[];
  /** The shapes of its drawings (see drawings.server.ts), as the page drew them. */
  shapes?: SceneShape[];
  box: SceneBox;
  look: SceneLook;
  /** The colours its variant gave it, by name, such as 'amber-100' for the current element. */
  colours?: { fill?: string; stroke?: string; color?: string };
  /** The places it refers to, where a listing's tokens name them (see listing/places.ts). */
  places?: string[];
  /** The value it draws, by the trace's identity, the same at every step it is drawn. */
  identity?: string;
  /** The free layout it arranges its children by, as a selection names it. */
  arrangement?: Omit<ArrangementLayout, 'node'>;
  /**
   * The element it is drawn under at this step, as nodes[2], where it draws a variable whose link
   * reaches that element in a free layout: it moves with the variable, as a pointer's label does.
   */
  follows?: string;
};

/** One line of one piece of text, as the page laid it out, with its own style. */
export type SceneText = {
  text: string;
  /** From the left of its first word to the right of its last, the height of its line. */
  box: SceneBox;
  color: string;
  font: string;
  fontSize: number;
  fontWeight: number;
  /** A line under or through it; `text` is as written, and `case` says how it is drawn. */
  decoration?: 'underline' | 'strike';
  case?: TextCase;
  /** A link's label, drawn over the links, as the page draws it. */
  overLinks?: true;
  /** The places it refers to, as a listing's token names them (see listing/places.ts). */
  places?: string[];
  /** Where its baseline is, its font's ascent below the top of its box, as the page draws it. */
  baseline?: number;
};

/** Paint behind a stretch of text: its box, colours, corners, and stroke drawn inside it. */
export type SceneMark = {
  box: SceneBox;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeStyle?: 'dashed' | 'dotted';
  radius?: number;
  /** A link's label, drawn over the links. */
  overLinks?: true;
};

/** One shape of a drawing: its outline as lines through points, one list for each part. */
export type SceneShape = {
  parts: ScenePoint[][];
  closed: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  evenOdd?: true;
};

export type SceneLink = {
  /** The id of the <Link> component it draws, if it came from one. */
  id?: string;
  /** The keys of the nodes it joins. */
  from: string;
  to: string;
  /** Whether it points one way, rather than being a two-way line. */
  directed: boolean;
  strokeStyle?: 'dashed' | 'dotted';
  stroke: string;
  strokeWidth: number;
  /** A cubic curve: its start, two control points, and end; or a wire, its corners in order. */
  curve?: [ScenePoint, ScenePoint, ScenePoint, ScenePoint];
  wire?: ScenePoint[];
  /** The heads at its ends, each in the line's colour. */
  heads?: { start?: SceneHead; end?: SceneHead };
};

/**
 * A head: its shape (see node/heads.ts), as long as it is wide, from its back to its tip along the
 * line where it ends.
 */
export type SceneHead = { shape: HeadShape; size: number; back: ScenePoint; tip: ScenePoint };

export type SceneStep = {
  nodes: SceneNode[];
  links: SceneLink[];
  /** Why the step could not be drawn, if it could not. */
  error?: string;
  /**
   * The value each value it copies was copied from, by the identities' places (see copiedFrom in
   * motion.ts), when moving to it from the step before it.
   */
  copies?: Record<string, number>;
};

export type SceneFrame = {
  width: number;
  height: number;
  background: string;
  /** The page's own node, which a click on the frame's empty space selects, and what it is called. */
  node?: { id: string; label: string };
  /** The colour each place a listing's tokens name lights in (see listing/places.ts). */
  places?: Record<string, string>;
  /** The colour each place outlines its references in on hover, seen on the background (lineColour). */
  placeLines?: Record<string, string>;
};

const round = (value: number) => Math.round(value * 100) / 100;

/** A drawn stroke's style, kept only when it is broken. */
function broken(css: string | undefined): { strokeStyle?: 'dashed' | 'dotted' } {
  const strokeStyle = strokeStyleCss(css);
  return strokeStyle ? { strokeStyle } : {};
}

/**
 * The free layout an arrangement drew: the node it arranges, the kind whose variables hold its look,
 * that kind's layout seed, and the form, direction and curve it drew.
 */
export type ArrangementLayout = {
  node: string;
  kind?: string;
  seed: number;
  form?: string;
  direction?: string;
  curve?: string;
};

/**
 * Text pieces as they read, joined as written, so `A[`, `i` and `]` from separate text nodes (a
 * block between them) read `A[i]`; a piece left out (undefined) parts its neighbours.
 */
export function readingText(pieces: readonly (string | undefined)[]): string {
  return pieces
    .map((piece) => piece ?? ' ')
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * A link as a scene draws it, from its path as drawn (see node/route.ts) and its look: `at` takes
 * a point of the path to frame pixels, and `headSize` is in frame pixels, from the route the server
 * gives (see model/scene-of.ts).
 */
export function sceneLink(drawn: {
  d: string;
  link: string;
  id?: string;
  at: (x: number, y: number) => ScenePoint;
  head?: string;
  headSize: number;
  start: boolean;
  end: boolean;
  strokeStyle?: string;
  stroke: string;
  strokeWidth: number;
}): SceneLink | undefined {
  const spec = linkSpecOf(drawn.link);
  // A link is drawn as one cubic curve, M x,y C x,y x,y x,y, or a wire, M x,y L x,y …
  const numbers = drawn.d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/giu)?.map(Number) ?? [];
  const curved = drawn.d.includes('C');
  if (!spec || (curved ? numbers.length !== 8 : numbers.length < 4 || numbers.length % 2))
    return undefined;
  const corners = Array.from({ length: numbers.length / 2 }, (_, i) =>
    drawn.at(numbers[2 * i], numbers[2 * i + 1])
  );
  // A head lies along the line where it ends, pointing away from the point before that end: its
  // back at the end where the line stops short for it, else its tip there.
  const shape = headShapes.find((each) => each === drawn.head);
  const size = drawn.headSize;
  const head = (end: ScenePoint, before: readonly ScenePoint[]): SceneHead | undefined => {
    if (!shape || !Number.isFinite(size)) return undefined;
    const from = before.find(({ x, y }) => x !== end.x || y !== end.y);
    if (!from) return undefined;
    const length = Math.hypot(end.x - from.x, end.y - from.y);
    const [dx, dy] = [(end.x - from.x) / length, (end.y - from.y) / length];
    const shifted = { x: round(end.x + dx * size), y: round(end.y + dy * size) };
    const behind = { x: round(end.x - dx * size), y: round(end.y - dy * size) };
    return headTrim(shape, size)
      ? { shape, size: round(size), back: end, tip: shifted }
      : { shape, size: round(size), back: behind, tip: end };
  };
  const reversed = [...corners].reverse();
  const heads = {
    ...(drawn.start ? { start: head(corners[0], corners.slice(1)) } : {}),
    ...(drawn.end ? { end: head(reversed[0], reversed.slice(1)) } : {})
  };
  return {
    ...(drawn.id ? { id: drawn.id } : {}),
    from: spec.from,
    to: spec.to,
    directed: spec.directed,
    ...broken(drawn.strokeStyle),
    stroke: drawn.stroke,
    strokeWidth: drawn.strokeWidth,
    ...(curved
      ? { curve: corners as [ScenePoint, ScenePoint, ScenePoint, ScenePoint] }
      : { wire: corners }),
    ...(heads.start || heads.end
      ? {
          heads: {
            ...(heads.start ? { start: heads.start } : {}),
            ...(heads.end ? { end: heads.end } : {})
          }
        }
      : {})
  };
}
