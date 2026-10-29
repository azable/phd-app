/**
 * Atomic types, and the contexts the library's components share. The presentation entry provides
 * 'sverlin:types'.
 */

import { getContext, setContext, type Snippet } from 'svelte';

import { placedKind, type DesignValues, type Place } from './node/design';
import type { Layout } from './node/props';
import type { SpanInput, SpanLayout } from './node/span';

export type TypeContext = {
  /** The atomic type name of item `index` of a container taken from the props, if typed. */
  itemType(container: unknown, index: number): string | undefined;
  /**
   * Every collection a position at a path points into at any step, its indices left out, so
   * edges[2].to reaches what any edge's to does.
   */
  reachedFrom(path: string): ReadonlySet<string> | undefined;
  /** The identity of the value at a path, the same at every step the value stays itself. */
  identityOf(path: string): number | undefined;
  /** Whether a variable is out of scope at this step, standing in hidden with another's value. */
  absent(name: string): boolean;
  /** The identity of the element a reference refers to this step; none once it is gone. */
  refOf(path: string): number | undefined;
  /** The element with an identity this step, as queue[2]. */
  elementWith(identity: number): string | undefined;
  /** Where an array or object taken from the props sits in the state, such as edges[0]. */
  pathOf(container: unknown): string | undefined;
  /** The collection a position at a path points into, such as left for i. */
  targetOf(path: string): string | undefined;
  /** Every collection or record a variable holds at any step, by identity. */
  heldBy(name: string): ReadonlySet<number> | undefined;
  /** How many elements the collection at a path holds, as values or paths[1]. */
  lengthOf(path: string): number | undefined;
  /**
   * How far before the start and past the end of a collection variable any step records a position
   * bound to it, at a path (as take.from, or edges[2].to for any edge's) or at all: the end slots
   * a pointer drawing it keeps, none where none goes past.
   */
  pastEnds(collection: string, path?: string): { before: number; after: number };
  /** The variables holding a value of a type, such as the Values collections. */
  variablesOf(typeName: string): string[];
  /** The type of the value at a path this step, such as End for a node's next at the end. */
  typeAt(path: string): string | undefined;
  /** The type a type refines, if any. */
  parent(typeName: string): string | undefined;
  /** A type's unit, or that of the nearest type it refines. */
  unit(typeName: string): string | undefined;
};

export function typeContext(): TypeContext | undefined {
  return getContext<TypeContext | undefined>('sverlin:types');
}

/**
 * The view each end type draws with, as the variant chooses it (views.End): an end is a value a
 * link to no node gives, as a list's last next, and its link draws it where it is.
 */
type Ends = Readonly<Record<string, () => Snippet<[unknown]> | undefined>>;

export function provideEnds(ends: Ends): void {
  setContext('sverlin:ends', ends);
}

export function endsContext(): Ends | undefined {
  return getContext<Ends | undefined>('sverlin:ends');
}

/** The <Node> tags and renders the presentation leaves out, by their line:column (see left-out.ts). */
export function leftOutContext(): ReadonlySet<string> | undefined {
  return getContext<ReadonlySet<string> | undefined>('sverlin:left-out');
}

/**
 * The <Node> tags hidden at this step, keeping their room, as every render they hold is hidden here
 * (see hiddenAt in left-out.ts), by their line:column.
 */
export function hiddenSitesContext(): ReadonlySet<string> | undefined {
  return getContext<ReadonlySet<string> | undefined>('sverlin:hidden-sites');
}

/** The presentation's variant: every variable of its design space, by key (see node/design.ts). */
export function designContext(): DesignValues {
  return getContext<DesignValues | undefined>('sverlin:design') ?? {};
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
 * cannot be read as the #render or /item parts. A key too long to fit is shortened to a hash of
 * it, so a link whose ends change between steps is still a different link.
 */
export function keyedRef(ref: string, key: string | undefined): string {
  if (key === undefined) return ref;
  const encoded = encodeURIComponent(key);
  if (!encoded) return ref;
  return encoded.length <= maximumKeyLength ? `${ref}@${encoded}` : `${ref}@~${hashOf(key)}`;
}

/** A short hash of a text (FNV-1a), the same for the same text at every step. */
function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function nodeIdsContext(): NodeIds | undefined {
  return getContext<NodeIds | undefined>('sverlin:node-ids');
}

/**
 * The algorithm as a listing in the language the variant chose, and what the shown step lights in
 * it: the code it finished and the code it keeps as run, alike, as [start, end] offsets.
 */
export type ShownListing = {
  text: string;
  /** Its regions, by their labels' full names, outer before inner, each painted as its place says. */
  regions: readonly { label: string; start: number; end: number }[];
  lit: readonly (readonly [number, number])[];
};

export function listingContext(): ShownListing | undefined {
  return getContext<ShownListing | undefined>('sverlin:listing');
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
  /** The pairs of links drawn as one two-way line at every step (see node/lines.ts). */
  lines: Set<string>;
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
/**
 * The element of the state the nearest node around draws, as ȟListNode[2] for a node's view: a
 * link with no from starts there, inside pointers drawn around it too.
 */
export function provideDrawn(element: string): void {
  setContext('sverlin:drawn', element);
}

export function drawnContext(): string | undefined {
  return getContext<string | undefined>('sverlin:drawn');
}

export function provideSlot(slot: string | undefined): void {
  setContext('sverlin:slot', slot);
}

export function slotContext(): string | undefined {
  return getContext<string | undefined>('sverlin:slot');
}

/**
 * Inside a component call reading through a position, as {@render Name(at(p).name)}: the element
 * it draws, and the identity of the place it is drawn for, as the queue entry p is. The element is
 * drawn where it is held too, so its nodes here move as that place (see movingIdentity).
 */
export type Through = { element: string; identity: string | undefined };

export function provideThrough(through: Through): void {
  setContext('sverlin:through', through);
}

export function throughContext(): Through | undefined {
  return getContext<Through | undefined>('sverlin:through');
}

/**
 * The identity a node drawing the value at a path moves by: the value's own, or inside a call
 * reading through a position, its place's, followed by the path below the element, as 29.seen.
 */
export function movingIdentity(
  types: TypeContext | undefined,
  through: Through | undefined,
  path: string
): string | undefined {
  const below =
    through && path.startsWith(through.element) ? path.slice(through.element.length) : undefined;
  if (through && below !== undefined && /^(?:[.[]|$)/u.test(below))
    return through.identity && through.identity + below;
  const identity = types?.identityOf(path);
  return identity === undefined ? undefined : String(identity);
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
  /** The props of the pointer's <Pointed> for a position, which a link it points at takes. */
  paint?: (position: number) => Record<string, unknown>;
  path?: string;
  of?: () => unknown;
  at?: () => string | number;
  /** The state variables its position is read from; with one out of scope it points nowhere. */
  reads?: readonly string[];
  /** Whether the {#if} branches it is rendered in are taken; where they are not, it points nowhere. */
  shown?: () => boolean;
  /** A reference's pointer: it points at the element the reference refers to, wherever it is. */
  ref?: boolean;
  /**
   * Its view's base kinds: those of the nodes around its <Pointed>, where the variant leaving one
   * out leaves the pointer undrawn, as the element drawn inside it would go too; and its
   * <Pointed>'s, whose overflow says whether it is drawn past its collection's ends.
   */
  kinds?: () => { around: readonly string[]; pointed: string } | undefined;
  /** The place it is rendered at, whose own variables its view's kinds take. */
  place?: Place;
  /**
   * A pointer at each position of a list, as {#each runs(@check.at) as p}{@render Checked(p)}{/each}:
   * the list, named by `path`, each item's path its own.
   */
  list?: () => unknown;
};

/** A pointer into a collection: its view, where it points, and its place among the root's pointers. */
export type Pointer = {
  view: Snippet<[unknown]>;
  collection: string;
  position: number;
  order: number;
  paint?: (position: number) => Record<string, unknown>;
  /** Every collection it points into at any step, where it keeps its room. */
  reaches?: ReadonlySet<string>;
  /** The path its position is read from this step, as take.from: its end slots are that path's. */
  path?: string;
  /** Whether it is left out past its collection's ends, keeping no end slots there. */
  inside?: boolean;
  /** The place it is rendered at (see Place). */
  place?: Place;
};

/** Resolve the root's pointers to the collections and positions they point at, for its nodes. */
export function providePointers(calls: readonly PointerCall[]): void {
  const types = typeContext();
  const design = designContext();
  const each = calls.flatMap((call): PointerCall[] => {
    if (!call.list) return [call];
    const items = call.list();
    return Array.isArray(items)
      ? items.map((item, k) => ({
          ...call,
          list: undefined,
          path: `${call.path}[${k}]`,
          value: () => item
        }))
      : [];
  });
  const pointers = each.flatMap((call, order): Pointer[] => {
    const kinds = call.kinds?.();
    const shown = (kind: string) =>
      design[`${placedKind(call.place, kind) ?? kind}.shown`] ?? design[`${kind}.shown`];
    if (kinds?.around.some((kind) => shown(kind) === false)) return [];
    const inside = kinds !== undefined && design[`${kinds.pointed}.overflow`] === 'hidden';
    // A position read through one that points nowhere, as edges[e].to with e at -1, points at
    // nothing this step, but keeps its room in the only collection of its type; so does one read
    // from a variable out of scope, which stands in with another step's value.
    let found: { collection?: string; position?: number } = {};
    let path: string | undefined;
    try {
      path = call.path ?? (call.of && call.at ? elementOf(types, call.of(), call.at()) : undefined);
      const absent =
        (call.reads?.some((name) => types?.absent(name)) ?? false) ||
        (call.shown ? !call.shown() : false);
      if (call.ref) {
        // A reference points at the element with the identity it refers to, wherever it is.
        const identity = path === undefined || absent ? undefined : types?.refOf(path);
        const element = elementSlot(
          identity === undefined ? undefined : types?.elementWith(identity)
        );
        found = { collection: element?.collection, position: element?.index };
      } else {
        const position = call.value();
        found = {
          collection: path === undefined ? undefined : types?.targetOf(path),
          position: typeof position === 'number' && !absent ? position : undefined
        };
      }
    } catch {
      // Points nowhere.
    }
    const [only, ...others] = types?.variablesOf(call.into) ?? [];
    const collection = found.collection ?? (others.length ? undefined : only);
    // One left out past the ends points nowhere there.
    const length = collection === undefined ? 0 : (types?.lengthOf(collection) ?? 0);
    const position =
      found.position === undefined || (inside && (found.position < 0 || found.position >= length))
        ? Number.NaN
        : found.position;
    return collection
      ? [
          {
            view: call.view(),
            collection,
            position,
            order,
            paint: call.paint,
            reaches: path === undefined ? undefined : types?.reachedFrom(path),
            path,
            ...(inside ? { inside } : {}),
            ...(call.place ? { place: call.place } : {})
          }
        ]
      : [];
  });
  setContext('sverlin:pointers', pointers);
}

/** Inside a render at a place: the place, whose own variables the kinds of the view it draws take. */
export function providePlace(place: Place | undefined): void {
  setContext('sverlin:place', place);
}

export function placeContext(): Place | undefined {
  return getContext<Place | undefined>('sverlin:place');
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
 * The identity of a pointer where it is, for the outermost node its view draws there: the same at
 * every step, so the node moves with the pointer between steps. Its <Pointed> element keeps its own.
 */
export function providePointerIdentity(identity: string | undefined): void {
  setContext('sverlin:pointer-identity', identity);
}

export function pointerIdentityContext(): string | undefined {
  return getContext<string | undefined>('sverlin:pointer-identity');
}

/**
 * The element a pointer's view is drawn around, for the outermost node it draws, whether or not the
 * pointer is there: so a free layout knows that node as the element (see Arranged.svelte).
 */
export function providePointerAround(slot: string | undefined): void {
  setContext('sverlin:pointer-around', slot);
}

export function pointerAroundContext(): string | undefined {
  return getContext<string | undefined>('sverlin:pointer-around');
}

/**
 * Inside the hidden copy of an element that keeps an end slot's room: its nodes name no element, so
 * no pointer is drawn at them and no identity is shown twice.
 */
export function provideCopy(): void {
  setContext('sverlin:copy', true);
}

export function copyContext(): boolean {
  return getContext<boolean | undefined>('sverlin:copy') ?? false;
}

/**
 * Inside the hidden copy of an {#each} item's node that keeps an end slot's room: the element of
 * that collection inside draws only the pointers at the end slot, and no node claims an id or an
 * identity, so the item's own nodes keep theirs.
 */
export function provideEndSlot(slot: { collection: string; position: number }): void {
  setContext('sverlin:end-slot', slot);
}

export function endSlotContext(): { collection: string; position: number } | undefined {
  return getContext<{ collection: string; position: number } | undefined>('sverlin:end-slot');
}

/**
 * Inside an {#each} item's node, which keeps the end slots of the collection it is an item of:
 * the element inside keeps none of its own.
 */
/** How a collection whose overflow is excluded hangs its end slots outside its box. */
export type Overhang = { layout: 'row' | 'column'; gap: number };

/** Tell a collection's items whether its end slots hang outside its box, and how. */
export function provideOverhang(overhang: Overhang | undefined): void {
  setContext('sverlin:overhang', overhang);
}

export function overhangContext(): Overhang | undefined {
  return getContext<Overhang | undefined>('sverlin:overhang');
}

export function provideItemEnds(collection: string): void {
  setContext('sverlin:item-ends', collection);
}

export function itemEndsContext(): string | undefined {
  return getContext<string | undefined>('sverlin:item-ends');
}

/**
 * Whether a node's children are laid out in sequence (a row or column) rather than freely:
 * a pointer's end slots, before the first element and after the last, belong only in a sequence.
 */
export function provideSequence(sequence: boolean): void {
  setContext('sverlin:sequence', sequence);
}

export function sequenceContext(): boolean | undefined {
  return getContext<boolean | undefined>('sverlin:sequence');
}

/** The way the collection around a node runs, so a collection inside it runs across it, as rows in a column do. */
export function provideCollectionLayout(layout: Layout | undefined): void {
  setContext('sverlin:collection-layout', layout);
}

export function collectionLayoutContext(): Layout | undefined {
  return getContext<Layout | undefined>('sverlin:collection-layout');
}

/**
 * The element of a collection a slot names, as values[2] or the cell paths[1][2], or undefined for
 * any other slot.
 */
export function elementSlot(
  slot: string | undefined
): { collection: string; index: number } | undefined {
  const match = slot ? /^(.+)\[(\d+)\]$/u.exec(slot) : null;
  return match ? { collection: match[1], index: Number(match[2]) } : undefined;
}

/**
 * Whether a pointer keeps room in the collection at a path: the variable it points into holds it,
 * now or at another step, as row holds rows of paths, or holds one of its siblings, so the rows of
 * a grid line up.
 */
export function reachesInto(
  types: TypeContext | undefined,
  pointer: Pointer,
  collection: string
): boolean {
  if (pointer.collection === collection || pointer.reaches?.has(collection)) return true;
  const held = types?.heldBy(pointer.collection);
  if (!held) return false;
  const parent = elementSlot(collection)?.collection;
  const siblings =
    parent === undefined
      ? [collection]
      : Array.from({ length: types?.lengthOf(parent) ?? 0 }, (_, index) => `${parent}[${index}]`);
  return siblings.some((sibling) => {
    const identity = types?.identityOf(sibling);
    return identity !== undefined && held.has(identity);
  });
}

/** Whether a pointer points into the collection at a path at this step. */
export function pointsInto(
  types: TypeContext | undefined,
  pointer: Pointer,
  collection: string
): boolean {
  const identity = types?.identityOf(collection);
  return (
    pointer.collection === collection ||
    (identity !== undefined && types?.identityOf(pointer.collection) === identity)
  );
}

/**
 * The node a link's end names: given a position from the state, as from={edge.from}, the node
 * drawing the element it points at, as vertices[2]; otherwise the key it was given.
 */
export function linkEnd(
  types: TypeContext | undefined,
  end: string | number,
  where: { path?: string; of?: unknown; at?: string | number; in?: unknown }
): string {
  // An {#each} index, a position into the collection it walks.
  const base = where.in === undefined ? undefined : types?.pathOf(where.in);
  if (base !== undefined && typeof end === 'number') return `${base}[${end}]`;
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
