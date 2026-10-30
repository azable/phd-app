/**
 * Scene data: what one step of a presentation draws, as plain data, so render targets can draw it
 * again outside the page. Every node and link is placed in the frame's logical coordinates (pixels
 * of the frame, from its top left corner, whatever the zoom), with its look as the page computed
 * it, and its kind and the colour names its variant gave, so a target can keep what a colour means. The app checks what the page sends against ../scene.ts.
 */

import { linkSpecOf } from './node/arrange';
import { strokeStyleCss } from './node/design';
import { headShapes, headTrim, type HeadShape } from './node/heads';
import type { Layout } from './node/props';
import { screenScale } from './node/unscaled';

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
  box: SceneBox;
  look: SceneLook;
  /** The colours its variant gave it, by name, such as 'amber-100' for the current element. */
  colours?: { fill?: string; stroke?: string; color?: string };
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
};

export type SceneFrame = { width: number; height: number; background: string };

const round = (value: number) => Math.round(value * 100) / 100;

/** A drawn stroke's style, kept only when it is broken. */
function broken(css: string | undefined): { strokeStyle?: 'dashed' | 'dotted' } {
  const strokeStyle = strokeStyleCss(css);
  return strokeStyle ? { strokeStyle } : {};
}
const layouts: readonly string[] = ['row', 'column', 'free'] satisfies Layout[];
const nodeSelector = 'div[data-sv-node]';

/** The frame a layer shows, at its logical size. */
export function describeFrame(layer: HTMLElement): SceneFrame | undefined {
  const frame = layer.querySelector<HTMLElement>('.sv-frame');
  return frame
    ? {
        width: frame.offsetWidth,
        height: frame.offsetHeight,
        background: getComputedStyle(frame).backgroundColor
      }
    : undefined;
}

/**
 * The free layout an arrangement drew: the node it arranges, the kind whose variables hold its look,
 * that kind's layout seed, and the form and curve it drew.
 */
export type ArrangementLayout = {
  node: string;
  kind?: string;
  seed: number;
  form?: string;
  curve?: string;
};

/** The layout of one arrangement (an .sv-arranged element), once it has laid out. */
export function arrangementLayout(arranged: HTMLElement): ArrangementLayout | undefined {
  const node = arranged.closest<HTMLElement>('[data-sv-node]')?.dataset.svNode;
  const { svLayoutSeed, svLayoutKind, svForm, svCurve } = arranged.dataset;
  if (!node || !Number.isFinite(Number(svLayoutSeed))) return undefined;
  return {
    node,
    ...(svLayoutKind ? { kind: svLayoutKind } : {}),
    seed: Number(svLayoutSeed),
    ...(svForm ? { form: svForm } : {}),
    ...(svCurve ? { curve: svCurve } : {})
  };
}

/** Describe the step a layer shows, once its layout has settled. */
export function describeStep(layer: HTMLElement): SceneStep {
  const error = layer.querySelector('.sv-error')?.textContent ?? undefined;
  const frame = layer.querySelector<HTMLElement>('.sv-frame');
  if (!frame) return { nodes: [], links: [], ...(error ? { error } : {}) };
  const origin = frame.getBoundingClientRect();
  // Rects are scaled with the frame on screen; its own width gives the scale back.
  const ratio = origin.width ? frame.offsetWidth / origin.width : 1;
  const point = (x: number, y: number): ScenePoint => ({
    x: round((x - origin.left) * ratio),
    y: round((y - origin.top) * ratio)
  });
  return {
    // Hidden nodes only keep room, as a pointer's where it is not.
    nodes: [...frame.querySelectorAll<HTMLElement>(nodeSelector)]
      .filter((element) => element.dataset.svHidden !== 'true')
      .map((element) => describeNode(element, point, ratio)),
    links: [...frame.querySelectorAll<SVGPathElement>('path[data-sv-edge]')].flatMap((path) => {
      const link = describeLink(path, point, ratio);
      return link ? [link] : [];
    }),
    ...(error ? { error } : {})
  };
}

function describeNode(
  element: HTMLElement,
  point: (x: number, y: number) => ScenePoint,
  ratio: number
): SceneNode {
  const { dataset } = element;
  const rect = element.getBoundingClientRect();
  const box = {
    ...point(rect.left, rect.top),
    width: round(rect.width * ratio),
    height: round(rect.height * ratio)
  };
  // Lengths inside a node are scaled on screen by the frame and by the root's fit to it; read from
  // the transforms, not the node's width, which rounds, and so is far off for a narrow node.
  const scale = screenScale(element) * ratio;
  const length = (css: string) => round((parseFloat(css) || 0) * scale);
  const style = getComputedStyle(element);
  const transparent = (colour: string) =>
    colour === 'transparent' || /^rgba\(.*,\s*0\)$/u.test(colour);
  const strokeWidth = length(style.borderTopWidth);
  const radius = Math.min(length(style.borderTopLeftRadius), box.width / 2, box.height / 2);
  const padding = [
    style.paddingTop,
    style.paddingRight,
    style.paddingBottom,
    style.paddingLeft
  ].map(length) as [number, number, number, number];
  const opacity = Number(style.opacity);
  const look: SceneLook = {
    ...(transparent(style.backgroundColor) ? {} : { fill: style.backgroundColor }),
    ...(strokeWidth && !transparent(style.borderTopColor)
      ? { stroke: style.borderTopColor, strokeWidth, ...broken(style.borderTopStyle) }
      : {}),
    ...(radius ? { radius: round(radius) } : {}),
    ...(padding.some(Boolean) ? { padding } : {}),
    color: style.color,
    font: style.fontFamily,
    fontSize: length(style.fontSize),
    fontWeight: Number(style.fontWeight) || 400,
    ...(opacity < 1 ? { opacity } : {})
  };
  const shown = element.querySelector(':scope > .value');
  const unit = shown?.querySelector('.unit')?.textContent ?? undefined;
  const value = shown ? (shown.firstChild?.textContent ?? '') : undefined;
  const text = ownText(element);
  const runs = textRuns(element, point, ratio, scale);
  const colours = Object.fromEntries(
    (['fill', 'stroke', 'color'] as const).flatMap((use) => {
      const name = dataset[`sv${use[0].toUpperCase()}${use.slice(1)}`];
      return name && name !== 'none' ? [[use, name]] : [];
    })
  ) as SceneNode['colours'];
  const parent = element.parentElement?.closest<HTMLElement>(nodeSelector)?.dataset.svNode;
  return {
    id: dataset.svNode ?? '',
    ...(parent ? { parent } : {}),
    ...(dataset.svType ? { type: dataset.svType } : {}),
    ...(dataset.svKind ? { kind: dataset.svKind } : {}),
    ...(layouts.includes(dataset.svLayout ?? '') ? { layout: dataset.svLayout as Layout } : {}),
    ...(element.querySelector(':scope > [data-sv-collection]')
      ? { collection: true as const }
      : {}),
    ...(value === undefined ? {} : { value }),
    ...(unit ? { unit } : {}),
    ...(text ? { text } : {}),
    ...(runs.length ? { runs } : {}),
    box,
    look,
    ...(colours && Object.keys(colours).length ? { colours } : {})
  };
}

/**
 * Whether text is the node's own: not in a child node, nor in a hidden one, as the copy of an
 * element that keeps an end slot's room, which has no id of its own. The nearest mark decides, as
 * an element shows again inside a hidden pointer.
 */
function ownedBy(holder: HTMLElement | null, element: HTMLElement): holder is HTMLElement {
  return (
    !!holder &&
    holder.closest(nodeSelector) === element &&
    holder.closest<HTMLElement>('[data-sv-hidden]')?.dataset.svHidden !== 'true'
  );
}

/** Text written in a node itself: outside its value and its child nodes. */
function ownText(element: HTMLElement): string {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const holder = text.parentElement;
    if (!ownedBy(holder, element) || holder.closest('.value, svg')) continue;
    const words = text.textContent?.trim();
    if (words) parts.push(words);
  }
  return parts.join(' ');
}

/**
 * The lines of text a node draws itself, value included: each text node's words, grouped into the
 * lines the page wrapped them onto, measured word by word.
 */
function textRuns(
  element: HTMLElement,
  point: (x: number, y: number) => ScenePoint,
  ratio: number,
  scale: number
): SceneText[] {
  const runs: SceneText[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const holder = node.parentElement;
    if (!ownedBy(holder, element) || holder.closest('svg')) continue;
    const style = getComputedStyle(holder);
    const looks = {
      color: style.color,
      font: style.fontFamily,
      fontSize: round((parseFloat(style.fontSize) || 0) * scale),
      fontWeight: Number(style.fontWeight) || 400
    };
    let line:
      | { words: string[]; left: number; top: number; right: number; bottom: number }
      | undefined;
    const finish = () => {
      if (!line) return;
      const corner = point(line.left, line.top);
      runs.push({
        text: line.words.join(' '),
        box: {
          ...corner,
          width: round((line.right - line.left) * ratio),
          height: round((line.bottom - line.top) * ratio)
        },
        ...looks
      });
    };
    for (const word of (node.textContent ?? '').matchAll(/\S+/gu)) {
      range.setStart(node, word.index);
      range.setEnd(node, word.index + word[0].length);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      // A word more than a pixel lower than the line so far starts a new line.
      if (line && Math.abs(rect.top - line.top) < 1) {
        line.words.push(word[0]);
        line.right = Math.max(line.right, rect.right);
        line.bottom = Math.max(line.bottom, rect.bottom);
      } else {
        finish();
        line = {
          words: [word[0]],
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom
        };
      }
    }
    finish();
  }
  return runs;
}

function describeLink(
  path: SVGPathElement,
  point: (x: number, y: number) => ScenePoint,
  ratio: number
): SceneLink | undefined {
  const svg = path.ownerSVGElement;
  const spec = linkSpecOf(path.dataset.svEdge ?? '');
  // A link is drawn as one cubic curve, M x,y C x,y x,y x,y, or a wire, M x,y L x,y …
  // (see node/route.ts).
  const d = path.getAttribute('d') ?? '';
  const numbers = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/giu)?.map(Number) ?? [];
  const curved = d.includes('C');
  if (!svg || !spec || (curved ? numbers.length !== 8 : numbers.length < 4 || numbers.length % 2))
    return undefined;
  const area = svg.getBoundingClientRect();
  const units = svg.width.baseVal.value;
  // Screen pixels per unit of the drawing, which the frame and the root's fit both scale.
  const toScreen = units ? area.width / units : 1;
  const at = (x: number, y: number) => point(area.left + x * toScreen, area.top + y * toScreen);
  const scale = toScreen * ratio;
  const style = getComputedStyle(path);
  const corners = Array.from({ length: numbers.length / 2 }, (_, i) =>
    at(numbers[2 * i], numbers[2 * i + 1])
  );
  // A head lies along the line where it ends, pointing away from the point before that end: its
  // back at the end where the line stops short for it, else its tip there.
  const shape = headShapes.find((each) => each === path.dataset.head);
  const size = Number(path.dataset.headSize) * scale;
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
    ...(path.hasAttribute('marker-start') ? { start: head(corners[0], corners.slice(1)) } : {}),
    ...(path.hasAttribute('marker-end') ? { end: head(reversed[0], reversed.slice(1)) } : {})
  };
  return {
    ...(path.dataset.svEdgeId ? { id: path.dataset.svEdgeId } : {}),
    from: spec.from,
    to: spec.to,
    directed: spec.directed,
    ...broken(path.dataset.strokeStyle),
    stroke: style.stroke,
    strokeWidth: round((parseFloat(style.strokeWidth) || 0) * scale),
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
