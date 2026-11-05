/**
 * Scenes drawn as SVG: what one step's scene data (see scene.ts) draws, in the frame's logical
 * coordinates, as plain shapes, and the shapes between two steps' scenes part way through the move
 * from one to the other. SceneView.svelte draws them; nothing here reads the page.
 */

import { headDrawing } from './node/heads';
import type {
  SceneBox,
  SceneHead,
  SceneLink,
  SceneLook,
  SceneMark,
  SceneNode,
  ScenePoint,
  SceneShape,
  SceneStep,
  SceneText
} from './scene';

/** A node as drawn: its box and look, its opacity with its parents', and what it holds. */
export type DrawnNode = {
  id: string;
  kind?: string;
  /** What a selection names it by: its text, its value, or its type. */
  label: string;
  box: SceneBox;
  look: SceneLook;
  opacity: number;
  runs: SceneText[];
  marks: SceneMark[];
  shapes: SceneShape[];
};

/** A link as drawn: its path, its paint, its heads, and its opacity. */
export type DrawnLink = {
  key: string;
  d: string;
  stroke: string;
  strokeWidth: number;
  strokeStyle?: 'dashed' | 'dotted';
  heads: SceneHead[];
  opacity: number;
};

export type DrawnScene = { nodes: DrawnNode[]; links: DrawnLink[] };

const label = (node: SceneNode) =>
  (node.text || node.value || node.runs?.map(({ text }) => text).join(' ') || node.type || 'node')
    .replace(/\s+/gu, ' ')
    .trim();

/** A scene's nodes and links as drawn, a nested node's opacity multiplied with its parents'. */
export function drawnScene(step: SceneStep): DrawnScene {
  const opacities = new Map<string, number>();
  const nodes = step.nodes.map((node): DrawnNode => {
    const opacity =
      (node.look.opacity ?? 1) * (node.parent ? (opacities.get(node.parent) ?? 1) : 1);
    opacities.set(node.id, opacity);
    return {
      id: node.id,
      ...(node.kind ? { kind: node.kind } : {}),
      label: label(node),
      box: node.box,
      look: node.look,
      opacity,
      runs: node.runs ?? [],
      marks: node.marks ?? [],
      shapes: node.shapes ?? []
    };
  });
  const seen = new Map<string, number>();
  const links = step.links.flatMap((link): DrawnLink[] => {
    const d = linkPath(link);
    if (!d) return [];
    // Two links joining the same nodes, as a pair drawn both ways, stay apart by their order.
    const base = link.id ?? `${link.from}>${link.to}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return [
      {
        key: count ? `${base}#${count}` : base,
        d,
        stroke: link.stroke,
        strokeWidth: link.strokeWidth,
        ...(link.strokeStyle ? { strokeStyle: link.strokeStyle } : {}),
        heads: [link.heads?.start, link.heads?.end].filter((head) => head !== undefined),
        opacity: 1
      }
    ];
  });
  return { nodes, links };
}

const num = (value: number) => Math.round(value * 100) / 100;

/** A link's path: its cubic curve, or its wire through its corners. */
export function linkPath(link: SceneLink): string | undefined {
  if (link.curve) {
    const [a, b, c, d] = link.curve;
    return `M${num(a.x)},${num(a.y)} C${num(b.x)},${num(b.y)} ${num(c.x)},${num(c.y)} ${num(d.x)},${num(d.y)}`;
  }
  if (link.wire && link.wire.length > 1) {
    const [first, ...rest] = link.wire;
    return `M${num(first.x)},${num(first.y)} ${rest.map(({ x, y }) => `L${num(x)},${num(y)}`).join(' ')}`;
  }
  return undefined;
}

/** A drawing's shape as a path: its parts, each closed where the shape is. */
export function shapePath(shape: SceneShape): string {
  return shape.parts
    .map(
      (part) =>
        `M${part.map(({ x, y }) => `${num(x)},${num(y)}`).join(' L')}${shape.closed ? ' Z' : ''}`
    )
    .join(' ');
}

/**
 * Where a head's 10 by 10 box goes (see node/heads.ts): laid along the line from its back to its
 * tip, as long and as wide as its size, so its drawing's path can be drawn in it.
 */
export function headTransform(head: SceneHead): string {
  const angle = (Math.atan2(head.tip.y - head.back.y, head.tip.x - head.back.x) * 180) / Math.PI;
  return `translate(${num(head.back.x)} ${num(head.back.y)}) rotate(${num(angle)}) scale(${num(head.size / 10)}) translate(0 -5)`;
}

/** A head's drawing: its path in its box, whether it is filled, or none for no head. */
export const headShape = (head: SceneHead): ReturnType<typeof headDrawing> =>
  headDrawing(head.shape);

/** A box with its stroke drawn inside it, as a CSS border is: inset by half the stroke. */
export function strokeInside(box: SceneBox, width: number): SceneBox {
  const half = width / 2;
  return {
    x: box.x + half,
    y: box.y + half,
    width: Math.max(0, box.width - width),
    height: Math.max(0, box.height - width)
  };
}

/** The page's move eases in and out (see motion.ts): slow at both ends, quickest half way. */
export const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixPoint = (a: ScenePoint, b: ScenePoint, t: number): ScenePoint => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t)
});
const mixBox = (a: SceneBox, b: SceneBox, t: number): SceneBox => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
  width: mix(a.width, b.width, t),
  height: mix(a.height, b.height, t)
});

/** A path's numbers, and its commands as a template, so two paths written alike can be mixed. */
function pathParts(d: string): { numbers: number[]; template: string } {
  const numbers: number[] = [];
  const template = d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/giu, (match) => {
    numbers.push(Number(match));
    return '#';
  });
  return { numbers, template };
}

/** A path part way from one to another, where both are written alike; else none. */
export function mixPath(from: string, to: string, t: number): string | undefined {
  const a = pathParts(from);
  const b = pathParts(to);
  if (a.template !== b.template || a.numbers.length !== b.numbers.length) return undefined;
  let index = 0;
  return b.template.replace(/#/gu, () => {
    const value = num(mix(a.numbers[index], b.numbers[index], t));
    index++;
    return String(value);
  });
}

/**
 * The scene part way through the move from one step to the next, `t` from 0 to 1 already eased: a
 * node both draw moves and grows from its old box to its new, its text with it, and takes its new
 * look; a node only the new step draws fades in where it is, and one only the old step drew fades
 * out where it was. A link both draw eases from its old path to its new where they are written
 * alike, and otherwise fades across; its heads move with it.
 */
export function sceneBetween(from: DrawnScene, to: DrawnScene, t: number): DrawnScene {
  if (t >= 1) return to;
  const before = new Map(from.nodes.map((node) => [node.id, node]));
  const after = new Set(to.nodes.map(({ id }) => id));
  const nodes: DrawnNode[] = to.nodes.map((node) => {
    const old = before.get(node.id);
    if (!old) return { ...node, opacity: node.opacity * t };
    const sameRuns = old.runs.length === node.runs.length;
    return {
      ...node,
      box: mixBox(old.box, node.box, t),
      opacity: mix(old.opacity, node.opacity, t),
      runs: sameRuns
        ? node.runs.map((run, i) => ({ ...run, box: mixBox(old.runs[i].box, run.box, t) }))
        : node.runs,
      marks:
        old.marks.length === node.marks.length
          ? node.marks.map((mark, i) => ({ ...mark, box: mixBox(old.marks[i].box, mark.box, t) }))
          : node.marks
    };
  });
  for (const node of from.nodes)
    if (!after.has(node.id)) nodes.push({ ...node, opacity: node.opacity * (1 - t) });
  const oldLinks = new Map(from.links.map((link) => [link.key, link]));
  const newKeys = new Set(to.links.map(({ key }) => key));
  const links: DrawnLink[] = [];
  for (const link of to.links) {
    const old = oldLinks.get(link.key);
    const d = old ? mixPath(old.d, link.d, t) : undefined;
    if (old && d) {
      const heads =
        old.heads.length === link.heads.length
          ? link.heads.map((head, i) => ({
              ...head,
              back: mixPoint(old.heads[i].back, head.back, t),
              tip: mixPoint(old.heads[i].tip, head.tip, t)
            }))
          : link.heads;
      links.push({ ...link, d, heads });
    } else if (old) {
      links.push({ ...old, key: `${old.key}~old`, opacity: old.opacity * (1 - t) });
      links.push({ ...link, opacity: link.opacity * t });
    } else links.push({ ...link, opacity: link.opacity * t });
  }
  for (const link of from.links)
    if (!newKeys.has(link.key)) links.push({ ...link, opacity: link.opacity * (1 - t) });
  return { nodes, links };
}
