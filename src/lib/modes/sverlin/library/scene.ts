/**
 * Scene data: what one step of a presentation draws, as plain data, so render targets can draw it
 * again outside the page. Every node and link is placed in the frame's logical coordinates (pixels
 * of the frame, from its top left corner, whatever the zoom), with its look as the page computed
 * it, drawn defaults included, and the palette names the view gave, so a target can keep what a
 * colour means. The app checks what the page sends against ../scene.ts.
 */

import { linkSpecOf } from './node/arrange';
import type { Layout, NodeShape, PaletteColor } from './node/props';

export type ScenePoint = { x: number; y: number };
export type SceneBox = ScenePoint & { width: number; height: number };

/** A node's look, as CSS colours and lengths in frame pixels. A missing fill or stroke is none. */
export type SceneLook = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
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
  key?: string;
  /** Its atomic type name, if typed. */
  type?: string;
  shape: NodeShape;
  /** How it arranges its items or children, if it does. */
  layout?: Layout;
  collection?: true;
  /** A value node's value as shown, and its type's unit. */
  value?: string;
  unit?: string;
  /** Text written in the node itself, outside its child nodes. */
  text?: string;
  box: SceneBox;
  look: SceneLook;
  /** The palette names the view gave its colours, such as 'amber' for the current element. */
  palette?: { fill?: PaletteColor; stroke?: PaletteColor; color?: PaletteColor };
};

export type SceneLink = {
  /** The id of the <Link> component it draws, if it came from one. */
  id?: string;
  /** The keys of the nodes it joins. */
  from: string;
  to: string;
  directed: boolean;
  dashed?: true;
  stroke: string;
  strokeWidth: number;
  /** A cubic curve: its start, two control points, and end. */
  curve: [ScenePoint, ScenePoint, ScenePoint, ScenePoint];
  label?: { text: string; at: ScenePoint; fontSize: number };
};

export type SceneStep = {
  nodes: SceneNode[];
  links: SceneLink[];
  /** Why the step could not be drawn, if it could not. */
  error?: string;
};

export type SceneFrame = { width: number; height: number; background: string };

const round = (value: number) => Math.round(value * 100) / 100;
const shapes: readonly string[] = ['box', 'card', 'plain'] satisfies NodeShape[];
const layouts: readonly string[] = ['row', 'column', 'grid', 'free'] satisfies Layout[];
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
    nodes: [...frame.querySelectorAll<HTMLElement>(nodeSelector)].map((element) =>
      describeNode(element, point, ratio)
    ),
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
  // Lengths inside a node are scaled on screen by the frame and by the root's fit to it.
  const scale = element.offsetWidth ? box.width / element.offsetWidth : ratio;
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
      ? { stroke: style.borderTopColor, strokeWidth }
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
  const palette = Object.fromEntries(
    (['fill', 'stroke', 'color'] as const).flatMap((use) => {
      const name = dataset[`sv${use[0].toUpperCase()}${use.slice(1)}`];
      return name ? [[use, name]] : [];
    })
  ) as SceneNode['palette'];
  const parent = element.parentElement?.closest<HTMLElement>(nodeSelector)?.dataset.svNode;
  return {
    id: dataset.svNode ?? '',
    ...(parent ? { parent } : {}),
    ...(dataset.svKey ? { key: dataset.svKey } : {}),
    ...(dataset.svType ? { type: dataset.svType } : {}),
    shape: (shapes.includes(dataset.svShape ?? '') ? dataset.svShape : 'plain') as NodeShape,
    ...(layouts.includes(dataset.svLayout ?? '') ? { layout: dataset.svLayout as Layout } : {}),
    ...(element.querySelector(':scope > [data-sv-collection]')
      ? { collection: true as const }
      : {}),
    ...(value === undefined ? {} : { value }),
    ...(unit ? { unit } : {}),
    ...(text ? { text } : {}),
    box,
    look,
    ...(palette && Object.keys(palette).length ? { palette } : {})
  };
}

/** Text written in a node itself: outside its value and its child nodes. */
function ownText(element: HTMLElement): string {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const holder = text.parentElement;
    if (holder?.closest(nodeSelector) !== element || holder.closest('.value, svg')) continue;
    const words = text.textContent?.trim();
    if (words) parts.push(words);
  }
  return parts.join(' ');
}

function describeLink(
  path: SVGPathElement,
  point: (x: number, y: number) => ScenePoint,
  ratio: number
): SceneLink | undefined {
  const svg = path.ownerSVGElement;
  const spec = linkSpecOf(path.dataset.svEdge ?? '');
  // Every link is drawn as one cubic curve (see node/route.ts): M x,y C x,y x,y x,y.
  const numbers = (path.getAttribute('d') ?? '').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/giu)?.map(Number);
  if (!svg || !spec || numbers?.length !== 8) return undefined;
  const area = svg.getBoundingClientRect();
  const units = svg.width.baseVal.value;
  // Screen pixels per unit of the drawing, which the frame and the root's fit both scale.
  const toScreen = units ? area.width / units : 1;
  const at = (x: number, y: number) => point(area.left + x * toScreen, area.top + y * toScreen);
  const scale = toScreen * ratio;
  const style = getComputedStyle(path);
  let label: SVGTextElement | undefined;
  for (
    let next = path.nextElementSibling;
    next && !next.matches('path.link');
    next = next.nextElementSibling
  )
    if (next instanceof SVGTextElement && next.classList.contains('label')) label = next;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = numbers;
  return {
    ...(path.dataset.svEdgeId ? { id: path.dataset.svEdgeId } : {}),
    from: spec.from,
    to: spec.to,
    directed: path.hasAttribute('marker-end'),
    ...(path.hasAttribute('stroke-dasharray') ? { dashed: true as const } : {}),
    stroke: style.stroke,
    strokeWidth: round((parseFloat(style.strokeWidth) || 0) * scale),
    curve: [at(x0, y0), at(x1, y1), at(x2, y2), at(x3, y3)],
    ...(label?.textContent
      ? {
          label: {
            text: label.textContent,
            at: at(label.x.baseVal[0]?.value ?? 0, label.y.baseVal[0]?.value ?? 0),
            fontSize: round((parseFloat(getComputedStyle(label).fontSize) || 0) * scale)
          }
        }
      : {})
  };
}
