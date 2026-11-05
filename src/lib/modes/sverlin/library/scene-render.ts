/**
 * Scenes drawn as SVG: what one step's scene data (see scene.ts) draws, in the frame's logical
 * coordinates, as plain shapes, and the shapes between two steps' scenes part way through the move
 * from one to the other. SceneView.svelte draws them; nothing here reads the page.
 */

import { headDrawing } from './node/heads';
import type {
  ArrangementLayout,
  SceneBox,
  SceneFrame,
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
  /** What it is drawn by: its id, or, fading out where a new node took its id, its id marked old. */
  key: string;
  id: string;
  parent?: string;
  type?: string;
  kind?: string;
  places?: string[];
  identity?: string;
  arrangement?: SceneNode['arrangement'];
  /** Fading out, gone from the step moved to. */
  leaving?: true;
  /** The node it moves from, where that had another id. */
  was?: string;
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
  /** The id of the <Link> drawing it, which a selection names it by, with its ends. */
  id?: string;
  label: string;
  /** Round its path's points, a curve's control points included. */
  bounds: SceneBox;
  d: string;
  stroke: string;
  strokeWidth: number;
  strokeStyle?: 'dashed' | 'dotted';
  heads: SceneHead[];
  opacity: number;
};

export type DrawnScene = {
  nodes: DrawnNode[];
  links: DrawnLink[];
  /** Its nodes by id, but those fading out. */
  byId: ReadonlyMap<string, DrawnNode>;
};

/** A scene from its nodes and links, indexed. */
export function indexed(nodes: DrawnNode[], links: DrawnLink[]): DrawnScene {
  return {
    nodes,
    links,
    byId: new Map(nodes.flatMap((node) => (node.leaving ? [] : [[node.id, node]])))
  };
}

/** Round a path's points, read from its numbers in pairs. */
function boundsOf(d: string): SceneBox {
  const numbers = (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/giu) ?? []).map(Number);
  const xs = numbers.filter((_, i) => i % 2 === 0);
  const ys = numbers.filter((_, i) => i % 2 === 1);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** A part of a step a selection can name: a node, a link drawn by a <Link>, or the page. */
export type SelectablePart = { label: string; box: SceneBox; parent?: string };

/**
 * Every part of a scene a selection can name, by id, with what the page names it by: a node's text
 * and its nodes' in order, or its type; a link's ends; the page as the frame calls it.
 */
export function selectableParts(
  scene: DrawnScene,
  frame: SceneFrame
): ReadonlyMap<string, SelectablePart> {
  const parts = new Map<string, SelectablePart>();
  if (frame.node)
    parts.set(frame.node.id, {
      label: frame.node.label,
      box: { x: 0, y: 0, width: frame.width, height: frame.height }
    });
  const inside = new Map<string, string[]>();
  for (const node of scene.nodes) {
    const texts = node.runs.map(({ text }) => text);
    for (let id: string | undefined = node.id; id; id = scene.byId.get(id)?.parent)
      inside.set(id, [...(inside.get(id) ?? []), ...texts]);
  }
  for (const node of scene.nodes) {
    const text = (inside.get(node.id) ?? []).join(' ').replace(/\s+/gu, ' ').trim();
    parts.set(node.id, {
      label: text || node.type || 'node',
      box: node.box,
      ...(node.parent ? { parent: node.parent } : {})
    });
  }
  for (const link of scene.links)
    if (link.id) parts.set(link.id, { label: link.label, box: link.bounds });
  return parts;
}

/** The free layouts round a node: the one placing its own children, and the one placing it. */
export function layoutsAround(scene: DrawnScene, id: string): ArrangementLayout[] {
  const own = scene.byId.get(id);
  let placing = own?.parent ? scene.byId.get(own.parent) : undefined;
  while (placing && !placing.arrangement)
    placing = placing.parent ? scene.byId.get(placing.parent) : undefined;
  return [own, placing].flatMap((node) =>
    node?.arrangement ? [{ node: node.id, ...node.arrangement }] : []
  );
}

/** A scene's nodes and links as drawn, a nested node's opacity multiplied with its parents'. */
export function drawnScene(step: SceneStep): DrawnScene {
  const opacities = new Map<string, number>();
  const nodes = step.nodes.map((node): DrawnNode => {
    const opacity =
      (node.look.opacity ?? 1) * (node.parent ? (opacities.get(node.parent) ?? 1) : 1);
    opacities.set(node.id, opacity);
    return {
      key: node.id,
      id: node.id,
      ...(node.parent ? { parent: node.parent } : {}),
      ...(node.type ? { type: node.type } : {}),
      ...(node.kind ? { kind: node.kind } : {}),
      ...(node.places ? { places: node.places } : {}),
      ...(node.identity ? { identity: node.identity } : {}),
      ...(node.arrangement ? { arrangement: node.arrangement } : {}),
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
        ...(link.id ? { id: link.id } : {}),
        label: `${link.from} ${link.directed ? '→' : '–'} ${link.to}`,
        bounds: boundsOf(d),
        d,
        stroke: link.stroke,
        strokeWidth: link.strokeWidth,
        ...(link.strokeStyle ? { strokeStyle: link.strokeStyle } : {}),
        heads: [link.heads?.start, link.heads?.end].filter((head) => head !== undefined),
        opacity: 1
      }
    ];
  });
  return indexed(nodes, links);
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

/**
 * A colour part way from one to another, as CSS mixes them, so any colour the page wrote mixes
 * with any other; none is transparent, so a fill appearing fades in in its own colour.
 */
export function mixColour(
  from: string | undefined,
  to: string | undefined,
  t: number
): string | undefined {
  if (from === to) return to;
  return `color-mix(in srgb, ${to ?? 'transparent'} ${num(t * 100)}%, ${from ?? 'transparent'})`;
}

/** A node's look part way from its old look to its new: its colours and its stroke's width. */
function mixLook(from: SceneLook, to: SceneLook, t: number): SceneLook {
  const colours = (['fill', 'stroke', 'glow'] as const).flatMap((use) => {
    const mixed = mixColour(from[use], to[use], t);
    return mixed ? [[use, mixed]] : [];
  });
  const width = (look: SceneLook) => (look.stroke ? (look.strokeWidth ?? 0) : undefined);
  const [was, is] = [width(from), width(to)];
  return {
    ...to,
    ...Object.fromEntries(colours),
    color: mixColour(from.color, to.color, t) ?? to.color,
    ...(was !== undefined || is !== undefined
      ? { strokeWidth: mix(was ?? is ?? 0, is ?? was ?? 0, t) }
      : {})
  };
}

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

/** The ancestors of a node in a scene, nearest first. */
function ancestors(scene: DrawnScene, node: DrawnNode): DrawnNode[] {
  const found: DrawnNode[] = [];
  for (
    let up = node.parent && scene.byId.get(node.parent);
    up;
    up = up.parent && scene.byId.get(up.parent)
  )
    found.push(up);
  return found;
}

/** A scene's nodes drawing a value, outermost only, as a component's root and a node inside it draw one. */
function byIdentity(scene: DrawnScene): Map<string, DrawnNode[]> {
  const found = new Map<string, DrawnNode[]>();
  for (const node of scene.nodes) {
    if (!node.identity || node.leaving) continue;
    if (ancestors(scene, node).some(({ identity }) => identity === node.identity)) continue;
    found.set(node.identity, [...(found.get(node.identity) ?? []), node]);
  }
  return found;
}

/** How many of two lists agree, from the first, up to the first that differs. */
function sharedFromStart(a: readonly unknown[], b: readonly unknown[]): number {
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;
  return shared;
}

/**
 * Each node of the scene moved to, by key, with the node of the scene moved from that it moves
 * from, as motion.ts pairs the mounted page's. A node drawing a value pairs with a node that drew
 * the same value (its identity), whatever their ids, as a value's node's id counts its renders and
 * shifts when one before it goes; where the value is drawn in several places, each pairs with the
 * place most like it: in the same node, then among the same kinds round it (see pairByRole), then
 * the nearest, so a value staying in its place never travels to another's. What a paired value's
 * node holds pairs in order with what the other held; every other node pairs by id.
 */
export function pairNodes(from: DrawnScene, to: DrawnScene): Map<string, DrawnNode> {
  const pairs = new Map<string, DrawnNode>();
  const claimed = new Set<DrawnNode>();
  const pair = (now: DrawnNode, was: DrawnNode) => {
    pairs.set(now.key, was);
    claimed.add(was);
  };
  const before = byIdentity(from);
  const kinds = (scene: DrawnScene, node: DrawnNode) =>
    ancestors(scene, node).map(({ kind }) => kind);
  const centre = ({ box }: DrawnNode) => [box.x + box.width / 2, box.y + box.height / 2];
  for (const [identity, nodes] of byIdentity(to)) {
    const olds = before.get(identity) ?? [];
    const candidates = nodes
      .flatMap((now, fresh) =>
        olds.map((was, old) => {
          const [a, b] = [centre(now), centre(was)];
          return {
            now,
            was,
            fresh,
            old,
            sameParent: now.parent === was.parent ? 1 : 0,
            role: sharedFromStart(kinds(to, now), kinds(from, was)),
            distance: Math.hypot(a[0] - b[0], a[1] - b[1])
          };
        })
      )
      .toSorted(
        (a, b) =>
          b.sameParent - a.sameParent ||
          b.role - a.role ||
          a.distance - b.distance ||
          a.fresh - b.fresh ||
          a.old - b.old
      );
    for (const { now, was } of candidates)
      if (!pairs.has(now.key) && !claimed.has(was)) pair(now, was);
  }
  // What a value's node holds, where it paired with a node of another id, pairs in order.
  const inside = (scene: DrawnScene, node: DrawnNode) =>
    scene.nodes.filter((other) => !other.leaving && ancestors(scene, other).includes(node));
  for (const now of to.nodes) {
    const was = pairs.get(now.key);
    if (!was || was.id === now.id || !now.identity) continue;
    const olds = inside(from, was);
    inside(to, now).forEach((held, index) => {
      const old = olds[index];
      if (old && old.kind === held.kind && !claimed.has(old) && !pairs.has(held.key))
        pair(held, old);
    });
  }
  for (const now of to.nodes) {
    if (pairs.has(now.key)) continue;
    const was = from.byId.get(now.id);
    if (was && !claimed.has(was)) pair(now, was);
  }
  return pairs;
}

// Each move pairs its scenes once, not at every frame it draws.
const paired = new WeakMap<DrawnScene, { from: DrawnScene; pairs: Map<string, DrawnNode> }>();
function pairsOf(from: DrawnScene, to: DrawnScene): Map<string, DrawnNode> {
  const known = paired.get(to);
  if (known?.from === from) return known.pairs;
  const pairs = pairNodes(from, to);
  paired.set(to, { from, pairs });
  return pairs;
}

/**
 * The scene part way through the move from one step to the next, `t` from 0 to 1 already eased: a
 * node paired with one the old step drew (see pairNodes) moves and grows from its old box to its
 * new, its text with it, and takes its new look; a node paired with none fades in where it is, and
 * an old one paired with none fades out where it was. A link both draw eases from its old path to
 * its new where they are written alike, and otherwise fades across; its heads move with it.
 */
export function sceneBetween(from: DrawnScene, to: DrawnScene, t: number): DrawnScene {
  if (t >= 1) return to;
  const pairs = pairsOf(from, to);
  const moving = new Set(pairs.values());
  const nodes: DrawnNode[] = to.nodes.map((node) => {
    const old = pairs.get(node.key);
    if (!old) return { ...node, opacity: node.opacity * t };
    const sameRuns = old.runs.length === node.runs.length;
    return {
      ...node,
      ...(old.id === node.id ? {} : { was: old.id }),
      box: mixBox(old.box, node.box, t),
      look: mixLook(old.look, node.look, t),
      opacity: mix(old.opacity, node.opacity, t),
      runs: sameRuns
        ? node.runs.map((run, i) => ({
            ...run,
            box: mixBox(old.runs[i].box, run.box, t),
            color: mixColour(old.runs[i].color, run.color, t) ?? run.color,
            ...(run.baseline !== undefined && old.runs[i].baseline !== undefined
              ? { baseline: mix(old.runs[i].baseline!, run.baseline, t) }
              : {})
          }))
        : node.runs,
      marks:
        old.marks.length === node.marks.length
          ? node.marks.map((mark, i) => ({
              ...mark,
              box: mixBox(old.marks[i].box, mark.box, t),
              ...(mark.fill || old.marks[i].fill
                ? { fill: mixColour(old.marks[i].fill, mark.fill, t) }
                : {})
            }))
          : node.marks
    };
  });
  for (const node of from.nodes)
    if (!node.leaving && !moving.has(node))
      nodes.push({
        ...node,
        key: `${node.id}~old`,
        leaving: true,
        opacity: node.opacity * (1 - t)
      });
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
      links.push({
        ...link,
        d,
        heads,
        stroke: mixColour(old.stroke, link.stroke, t) ?? link.stroke
      });
    } else if (old) {
      links.push({ ...old, key: `${old.key}~old`, opacity: old.opacity * (1 - t) });
      links.push({ ...link, opacity: link.opacity * t });
    } else links.push({ ...link, opacity: link.opacity * t });
  }
  for (const link of from.links)
    if (!newKeys.has(link.key)) links.push({ ...link, opacity: link.opacity * (1 - t) });
  return indexed(nodes, links);
}
