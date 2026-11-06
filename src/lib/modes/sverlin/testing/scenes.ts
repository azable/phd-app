/**
 * What the tests read from the scenes the server draws of a presentation's steps (see
 * ../library/model/scene-of.ts), which is all the page draws: nodes by kind, a node's text as its
 * reader sees it, and where links start and end.
 */

import {
  bundlePresentation as bundleOnBase,
  prepareSvelteComponent,
  type SvelteBundle
} from '../compile.server';
import { withStarterBase, type VariantRequest } from '../design.server';
import { baseKey } from '../library/node/design';
import { starterBase } from '../library/node/starter-base';
import type { ServedScenes } from '../server-scenes';
import type { SceneBox, SceneLink, SceneNode, ScenePoint, SceneStep } from '../library';

/**
 * A test's request on the starter base: as a design entering the app (see withStarterBase), and a
 * hand-written variant to build on that names no base, as a test's few values, with the starter base
 * under it, as every variant the app builds holds one.
 */
export function onStarterBase(request: VariantRequest): VariantRequest {
  const { base, chosen } = request;
  const named = [base, chosen].some((values) => values && Object.hasOwn(values, baseKey));
  return base && Object.keys(base).length && !named
    ? { ...request, base: { ...starterBase, ...base } }
    : withStarterBase(request);
}

/** The build's bundlePresentation, its request on the starter base where it names none. */
export const bundlePresentation = (
  prepared: Parameters<typeof bundleOnBase>[0],
  seed: number,
  request: VariantRequest = {},
  options?: Parameters<typeof bundleOnBase>[3]
): Promise<SvelteBundle> => bundleOnBase(prepared, seed, onStarterBase(request), options);

/**
 * Every step's scene of a source, built with a seed and a variant on the starter base where it
 * names none (see onStarterBase), and the build.
 */
export async function drawnSteps(
  source: string,
  request: VariantRequest = {},
  seed = 1
): Promise<ServedScenes & { built: SvelteBundle }> {
  const built = await bundlePresentation(prepareSvelteComponent(source), seed, request);
  if (!built.layout.scenes) throw new Error('The server drew no scenes.');
  return { ...built.layout.scenes, built };
}

export const ofKind = (step: SceneStep, kind: string): SceneNode[] =>
  step.nodes.filter((node) => node.kind === kind);

/** Whether a node lies inside another, at any depth. */
export function isInside(step: SceneStep, node: SceneNode, outer: SceneNode | undefined): boolean {
  const parents = new Map(step.nodes.map(({ id, parent }) => [id, parent]));
  for (let up = node.parent; up; up = parents.get(up)) if (up === outer?.id) return true;
  return false;
}

/**
 * A node's text and its nodes', in reading order (line by line, each from the left), its spaces
 * collapsed, as a reader sees it.
 */
export function textOf(step: SceneStep, node: SceneNode | undefined): string {
  if (!node) return '';
  const parents = new Map(step.nodes.map(({ id, parent }) => [id, parent]));
  const within = (id: string | undefined): boolean =>
    !!id && (id === node.id || within(parents.get(id)));
  return step.nodes
    .filter(({ id }) => within(id))
    .flatMap(({ runs = [] }) => runs)
    .toSorted((a, b) =>
      centreOf(a.box).y < b.box.y ? -1 : centreOf(b.box).y < a.box.y ? 1 : a.box.x - b.box.x
    )
    .map(({ text }) => text)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** A link as written: its ends' keys, - for a line or -> for an arrow. */
export const edgeOf = ({ from, to, directed }: SceneLink): string =>
  `${from} ${directed ? '->' : '-'} ${to}`;

/** Where a link starts and where it ends, at its heads' tips where it has them. */
export function endsOf(link: SceneLink): [ScenePoint, ScenePoint] {
  const points = link.curve ?? link.wire ?? [];
  return [link.heads?.start?.tip ?? points[0], link.heads?.end?.tip ?? points[points.length - 1]];
}

/** Whether a point lies in a box, or within some pixels of it. */
export const within = ({ x, y }: ScenePoint, box: SceneBox, slack = 0): boolean =>
  x >= box.x - slack &&
  x <= box.x + box.width + slack &&
  y >= box.y - slack &&
  y <= box.y + box.height + slack;

export const centreOf = ({ x, y, width, height }: SceneBox): ScenePoint => ({
  x: x + width / 2,
  y: y + height / 2
});
