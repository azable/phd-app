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
  /** Where an array or object taken from the props sits in the state, such as edges[0]. */
  pathOf(container: unknown): string | undefined;
  /** The collection a position at a path points into, such as left for i. */
  targetOf(path: string): string | undefined;
  /** How many elements a collection variable holds. */
  lengthOf(name: string): number | undefined;
  /** The variables holding a value of a type, such as the Values collections. */
  variablesOf(typeName: string): string[];
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
   * True while drawing components for every value of their parameters: the components measured
   * before keep their boxes, and no other node keeps a size.
   */
  probing?: boolean;
  /**
   * The largest size each node reaches at any step, by id. Nodes keep it as their least size, so a box
   * whose content changes keeps one size and nothing around it moves.
   */
  reserved: Map<string, { width: number; height: number }>;
  /**
   * The largest size each typed component's root reaches for any value of its parameters, by
   * component; every render of the component keeps it as its least size, so they line up.
   */
  components: Map<string, { width: number; height: number }>;
  /** Each arrangement's contents at every step, and its solution over all of them, by scope. */
  scopes: Map<string, { inputs: Map<number, SpanInput>; span?: SpanLayout }>;
  /** The root's fit at each step. */
  fits: Map<number, number>;
};

export function layoutMemoryContext(): LayoutMemory | undefined {
  return getContext<LayoutMemory | undefined>('sverlin:layout-memory');
}

/**
 * Mark the nodes inside a component whose box is known from rendering all its inputs: they keep
 * their natural sizes, since the box already holds every way they can be drawn.
 */
export function provideComponentBox(): void {
  setContext('sverlin:in-component-box', true);
}

export function insideComponentBox(): boolean {
  return getContext<boolean | undefined>('sverlin:in-component-box') === true;
}

/**
 * The element of the state a component call draws, such as values[2], for the roots of the
 * component it renders; undefined for a value that is not one, such as i + 1 (see node/Slot.svelte).
 */
export function provideSlot(slot: string | undefined): void {
  setContext('sverlin:slot', slot);
}

export function slotContext(): string | undefined {
  return getContext<string | undefined>('sverlin:slot');
}

/**
 * A pointer the root renders, as in {@render Arrow(i)}: drawn not where it is written but around
 * the element its position points at, so the compiler hoists the call into the root's script.
 * `path`, or `of` with `at`, names the position as Slot.svelte names an element.
 */
export type PointerCall = {
  view: () => Snippet<[unknown]>;
  value: () => unknown;
  /** The collection type the pointer's index type points into. */
  into: string;
  /** How many places past each end of the collection its index type goes. */
  reach: number;
  /** The props of the pointer's <Pointed> for a position, which a link it points at takes. */
  paint?: (position: number) => Record<string, unknown>;
  path?: string;
  of?: () => unknown;
  at?: () => string | number;
};

/** A pointer into a collection: its view, where it points, and its place among the root's pointers. */
export type Pointer = {
  view: Snippet<[unknown]>;
  collection: string;
  position: number;
  reach: number;
  order: number;
  paint?: (position: number) => Record<string, unknown>;
};

/** Resolve the root's pointers to the collections and positions they point at, for its nodes. */
export function providePointers(calls: readonly PointerCall[]): void {
  const types = typeContext();
  const pointers = calls.flatMap((call, order): Pointer[] => {
    // A position read through one that points nowhere, as edges[e].to with e at -1, points at
    // nothing this step, but keeps its room in the only collection of its type.
    let found: { collection?: string; position?: number } = {};
    try {
      const path =
        call.path ?? (call.of && call.at ? elementOf(types, call.of(), call.at()) : undefined);
      const position = call.value();
      found = {
        collection: path === undefined ? undefined : types?.targetOf(path),
        position: typeof position === 'number' ? position : undefined
      };
    } catch {
      // Points nowhere.
    }
    const [only, ...others] = types?.variablesOf(call.into) ?? [];
    const collection = found.collection ?? (others.length ? undefined : only);
    return collection
      ? [
          {
            view: call.view(),
            collection,
            position: found.position ?? Number.NaN,
            reach: call.reach,
            order,
            paint: call.paint
          }
        ]
      : [];
  });
  setContext('sverlin:pointers', pointers);
}

export function pointersContext(): readonly Pointer[] {
  return getContext<readonly Pointer[] | undefined>('sverlin:pointers') ?? [];
}

/**
 * Inside a pointer view drawn around an element: how its <Pointed> draws the element, with the
 * props of the pointers outside it, and whether this pointer is at the element or only keeps its
 * room. Undefined where a pointer view is drawn alone, as when it is measured, or at an end slot.
 */
export type PointedSlot = {
  slot: string;
  active: boolean;
  /** An end slot, before the first element or after the last: the element only keeps its room. */
  placeholder: boolean;
  outer: Record<string, unknown>;
  render?: Snippet<[Record<string, unknown>]>;
};

export function providePointed(pointed: PointedSlot | undefined): void {
  setContext('sverlin:pointed', pointed);
}

export function pointedContext(): PointedSlot | undefined {
  return getContext<PointedSlot | undefined>('sverlin:pointed');
}

/** The element already drawn around by pointers, so a node drawing it inside does not again. */
export function provideWrapped(slot: string): void {
  setContext('sverlin:wrapped', slot);
}

export function wrappedContext(): string | undefined {
  return getContext<string | undefined>('sverlin:wrapped');
}

/**
 * Whether nodes are hidden, keeping their room: a pointer's nodes around an element it is not at;
 * false inside its <Pointed>, where the element shows again. Hidden only once a step is shown
 * (assembly/entry.ts), and left out of the scene.
 */
export function provideHidden(hidden: boolean): void {
  setContext('sverlin:hidden', hidden);
}

export function hiddenContext(): boolean | undefined {
  return getContext<boolean | undefined>('sverlin:hidden');
}

/**
 * Whether a node's children are laid out in sequence (a row, column, or grid) rather than freely:
 * a pointer's end slots, before the first element and after the last, belong only in a sequence.
 */
export function provideSequence(sequence: boolean): void {
  setContext('sverlin:sequence', sequence);
}

export function sequenceContext(): boolean | undefined {
  return getContext<boolean | undefined>('sverlin:sequence');
}

/** The element of a collection a slot names, as values[2], or undefined for any other slot. */
export function elementSlot(
  slot: string | undefined
): { collection: string; index: number } | undefined {
  const match = slot ? /^([A-Za-z_$][\w$]*)\[(\d+)\]$/u.exec(slot) : null;
  return match ? { collection: match[1], index: Number(match[2]) } : undefined;
}

/**
 * The node a link's end names: given a position from the state, as from={edge.from}, the node
 * drawing the element it points at, as vertices[2]; otherwise the key it was given.
 */
export function linkEnd(
  types: TypeContext | undefined,
  end: string | number,
  where: { path?: string; of?: unknown; at?: string | number }
): string {
  const path =
    where.path ?? (where.at === undefined ? undefined : elementOf(types, where.of, where.at));
  const target = path === undefined ? undefined : types?.targetOf(path);
  return target !== undefined && typeof end === 'number' ? `${target}[${end}]` : String(end);
}

/** Reset for nodes drawn by <Pointed>: the element keeps the sizes it would have outside it. */
export function leaveComponentBox(): void {
  setContext('sverlin:in-component-box', false);
}

/** The element of a container from the props at an index or field, such as values[2] or edge.from. */
export function elementOf(
  types: TypeContext | undefined,
  container: unknown,
  at: string | number
): string | undefined {
  const path = types?.pathOf(container);
  if (path === undefined) return undefined;
  if (!Array.isArray(container)) return `${path}.${at}`;
  return Number.isInteger(at) ? `${path}[${at}]` : undefined;
}
