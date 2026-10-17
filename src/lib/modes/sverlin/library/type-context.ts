/**
 * Atomic types and their renderers. The presentation entry provides 'sverlin:types'; the authored
 * component registers its top-level type snippets under 'sverlin:renderers'.
 */

import { getContext, setContext, type Snippet } from 'svelte';

import type { NodeDefaults, NodeProps, Primitive } from './node/props';
import type { SpanInput, SpanLayout } from './node/span';

export type TypeContext = {
  /** The atomic type name of item `index` of a container taken from the props, if typed. */
  itemType(container: unknown, index: number): string | undefined;
  /** The type a type refines, if any. */
  parent(typeName: string): string | undefined;
  /** A type's unit, or that of the nearest type it refines. */
  unit(typeName: string): string | undefined;
};

export type Renderer = Snippet<[Primitive, NodeProps]>;

export function typeContext(): TypeContext | undefined {
  return getContext<TypeContext | undefined>('sverlin:types');
}

/**
 * The renderer for a type, or for the nearest type it refines. A renderer is skipped while it is
 * already rendering, so a node inside it never calls it again.
 */
export function rendererFor(typeName: string): { name: string; snippet: Renderer } | undefined {
  const renderers = getContext<Record<string, Renderer> | undefined>('sverlin:renderers');
  const rendering = getContext<ReadonlySet<string> | undefined>('sverlin:rendering');
  const types = typeContext();
  for (let name: string | undefined = typeName; name; name = types?.parent(name)) {
    const snippet = renderers?.[name];
    if (snippet && !rendering?.has(name)) return { name, snippet };
  }
  return undefined;
}

/** Mark a renderer as rendering for the nodes inside it. */
export function markRendering(name: string): void {
  const rendering = getContext<ReadonlySet<string> | undefined>('sverlin:rendering');
  setContext('sverlin:rendering', new Set([...(rendering ?? []), name]));
}

/** The defaults this presentation drew (see node/defaults.ts). */
export function defaultsContext(): NodeDefaults {
  return getContext<NodeDefaults>('sverlin:defaults');
}

/** Hands out the ids rendered nodes carry for selection; see provideNodeIds. */
export type NodeIds = { claim(ref: string): string };

/**
 * Give the nodes of one rendered step their ids. A node's id is its tag's source position (its
 * __ref, such as 12:5), then, for a keyed node, @ and its key, or for a link, @ and its ends such
 * as a->b (see keyedRef), then #2, #3, … for
 * later renders of the same tag and key, such as inside a loop; items a collection draws itself
 * extend their collection's id with /index. Each step mounts afresh and renders in the same order,
 * so the same state always gives the same ids, and a keyed node keeps its id whichever render it is.
 */
export function provideNodeIds(): void {
  const counts = new Map<string, number>();
  setContext<NodeIds>('sverlin:node-ids', {
    claim(ref) {
      const count = (counts.get(ref) ?? 0) + 1;
      counts.set(ref, count);
      return count === 1 ? ref : `${ref}#${count}`;
    }
  });
}

// Element ids are at most 64 characters (elementIdSchema), which leaves a key this many after the
// tag position, a render count, and a few item indices.
const maximumKeyLength = 24;

/**
 * The reference a keyed node claims its id by: its tag's position, @, and its key, encoded so it
 * cannot be read as the #render or /item parts. A key too long to fit leaves the position alone.
 */
export function keyedRef(ref: string, key: string | undefined): string {
  if (key === undefined) return ref;
  const encoded = encodeURIComponent(key);
  return encoded && encoded.length <= maximumKeyLength ? `${ref}@${encoded}` : ref;
}

export function nodeIdsContext(): NodeIds | undefined {
  return getContext<NodeIds | undefined>('sverlin:node-ids');
}

/** Make the presentation's seed available to library components that vary by it. */
export function provideSeed(seed: number): void {
  setContext('sverlin:seed', seed);
}

export function seedContext(): number {
  return getContext<number | undefined>('sverlin:seed') ?? 1;
}

/** The arrangement around a node, told when a nested arrangement's size settles. */
export type ArrangementParent = { changed(): void };

export function provideArrangementParent(parent: ArrangementParent): void {
  setContext('sverlin:arrangement', parent);
}

export function arrangementParentContext(): ArrangementParent | undefined {
  return getContext<ArrangementParent | undefined>('sverlin:arrangement');
}

/**
 * Layouts for a whole presentation, made when the page loads: every node is measured at every step
 * and keeps the largest size it reaches; then every step is laid out hidden, recording what each
 * arrangement contains, and each arrangement is solved once over all of them (see node/span.ts).
 * Showing a step places children where that solution put them, so a seed always gives the same
 * layout for a step, whichever step is shown first, and only what changes moves.
 */
export type LayoutMemory = {
  /** The step being laid out or shown. */
  step: number;
  /** True while recording what arrangements contain; false when showing a step. */
  recording: boolean;
  /** True while only measuring each node's natural size, before anything is recorded. */
  measuring?: boolean;
  /**
   * The largest size each node reaches at any step, by id. Nodes keep it as their least size, so a box
   * whose content changes keeps one size and nothing around it moves.
   */
  reserved: Map<string, { width: number; height: number }>;
  /** Each arrangement's contents at every step, and its solution over all of them, by scope. */
  scopes: Map<string, { inputs: Map<number, SpanInput>; span?: SpanLayout }>;
  /** The root's fit at each step. */
  fits: Map<number, number>;
};

export function layoutMemoryContext(): LayoutMemory | undefined {
  return getContext<LayoutMemory | undefined>('sverlin:layout-memory');
}
