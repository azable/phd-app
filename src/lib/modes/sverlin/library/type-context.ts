/**
 * Atomic types, and the contexts the library's components share. The presentation entry provides
 * 'sverlin:types'.
 */

import { getContext, setContext, type Snippet } from 'svelte';

import { placedKind, placeLabelKey, type DesignValues, type Place } from './node/design';
import type { ShownFrame } from './fit';
import type { ArrangeEdge } from './node/arrange';
import type { Layout } from './node/props';
import type { SpanInput, SpanLayout } from './node/span';
import type { ListingPlaces, ListingSyntax } from './steps';

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
  /** The most elements the collection at a path can hold, its type's max. */
  maxLengthOf?(path: string): number | undefined;
  /**
   * How far before the start and past the end of a collection variable any step records a position
   * bound to it, at a path (as take.from, or edges[2].to for any edge's) or at all: the end slots
   * a pointer drawing it keeps, none where none goes past.
   */
  pastEnds(collection: string, path?: string): { before: number; after: number };
  /**
   * Whether positions at two paths (as current and w, or edges[2].to for any edge's) are each
   * recorded at some step and never at the same element at the same step.
   */
  apart(a: string, b: string): boolean;
  /** The variables holding a value of a type, such as the Values collections. */
  variablesOf(typeName: string): string[];
  /** The type of the value at a path this step, such as End for a node's next at the end. */
  typeAt(path: string): string | undefined;
  /** The type a type refines, if any. */
  parent(typeName: string): string | undefined;
  /** A type's unit, or that of the nearest type it refines. */
  unit(typeName: string): string | undefined;
  /** A number type's decimal places, which every one of its values is drawn with. */
  places?(typeName: string): number | undefined;
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
  /** Where its tokens name places the variant lights, those, and the places the step touches. */
  places?: ListingPlaces;
  touched?: readonly string[];
  /** Its keywords in bold, and with colour every kind of word in its colour too. */
  syntax?: ListingSyntax;
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
 * Layouts for a whole presentation, made when the page loads, before any step is mounted: each
 * step's markup is laid out on the layout model, every node keeping the largest size it reaches,
 * and each arrangement solved once over every step (see model/reserve.ts). Showing a step places
 * children where that solution put them, so a seed always gives the same layout for a step,
 * whichever step is shown first, and only what changes moves.
 */
export type LayoutMemory = {
  /** The step being laid out or shown. */
  step: number;
  /**
   * True while drawing a step's markup to lay out on the layout model, which gives each node its
   * size: no node keeps one as drawn.
   */
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
   * The largest room each row, column or grid holding links keeps for what they draw past its
   * children, by its node's id, over every step: room worked out at one step alone moves the
   * children inside a box that keeps its size as the links change.
   */
  rooms?: Map<string, { top: number; right: number; bottom: number; left: number }>;
  /**
   * Each grid's tracks, by its node's id, or for a grid in a typed view by its site, shared by every
   * copy of the view and its probed values: every column as wide as the widest cell it holds at any
   * step and every row as tall as the tallest, as many as the largest coordinate any step uses, so a
   * grid filling in never moves.
   */
  tracks: Map<string, { columns: number[]; rows: number[]; start?: [number, number] }>;
  /**
   * The largest size each typed component's root reaches for any value of its parameters, by
   * component; every render of the component keeps it as its least size, so they line up.
   */
  components: Map<string, { width: number; height: number }>;
  /** Each arrangement's contents at every step, and its solution over all of them, by scope. */
  scopes: Map<string, { inputs: Map<number, SpanInput>; span?: SpanLayout }>;
  /** The root's fit at each step, as laid out on the server. */
  fits: Map<number, number>;
  /** The frame every step shows in, and the fit it shows at, given by the server (see ./fit.ts). */
  frame?: ShownFrame;
  /**
   * Where asked for, as on the server: the frame, its inside and the root's content at each step,
   * which the fit is worked out from, for how large the picture draws (see
   * ../readability.server.ts).
   */
  extents?: Map<number, FrameExtent>;
  /** The pairs of links drawn as one two-way line at every step (see node/lines.ts). */
  lines: Set<string>;
  /**
   * Each free layout's links as the server drew them at each state, by scope: what the page draws,
   * so no link is ever routed from boxes the page reads mid-move (see model/reserve.ts routesOf).
   */
  routes?: Map<string, Map<number, ArrangeEdge[]>>;
};

type Size = { width: number; height: number };

/**
 * A step's frame, the space inside its border and padding, and its root's content, unscaled; and
 * the root's parts, side by side in a row or one above another.
 */
export type FrameExtent = { frame: Size; inside: Size; content: Size; parts: Size[]; row: boolean };

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

/** Inside a union's value, whose member's view takes the box the union's members share. */
export function provideUnion(union: string): void {
  setContext('sverlin:union', union);
}

export function unionContext(): string | undefined {
  return getContext<string | undefined>('sverlin:union');
}

/** The key of the box a member's view takes inside a value of its union (see record.ts). */
export const unionBoxKey = (view: string, union: string): string => `${view}|${union}`;

/** Inside a typed view, whose every copy shares one set of tracks for each grid it draws. */
export function provideInView(): void {
  setContext('sverlin:in-view', true);
}

export function insideView(): boolean {
  return getContext<boolean | undefined>('sverlin:in-view') === true;
}

/**
 * The element of the state a component call draws, such as values[2], for the roots of the
 * component it renders; undefined for a value that is not one, such as i + 1 (see node/Slot.svelte).
 */
/**
 * The element of the state the nearest node around draws, as nodes[2] for a node's view: a
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
   * A pointer at each position of a list, as {#each spans(@check.at) as p}{@render Checked(p)}{/each}:
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
  /** A reference's pointer, its path holding no position (see PointerCall). */
  ref?: true;
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
    // A pointer the variant draws as none is no pointer.
    const view = call.view();
    if (!view) return [];
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
            view,
            collection,
            position,
            order,
            paint: call.paint,
            reaches: path === undefined ? undefined : types?.reachedFrom(path),
            path,
            ...(inside ? { inside } : {}),
            ...(call.place ? { place: call.place } : {}),
            ...(call.ref ? { ref: true as const } : {})
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

/**
 * What place() in a view gives: the design's label for the place the view is rendered at
 * (`label@lo`), else the place's own name, as `lo` or `pair.left`, or, for a render with no name,
 * its expression as written, as `j - 1`; nothing outside a place.
 */
export function sverlinPlace(): string {
  const place = placeContext();
  if (!place) return '';
  if (!place.at) return place.written ?? '';
  const label = designContext()[placeLabelKey(place.at)];
  return typeof label === 'string' && label ? label : place.at.slice(1);
}

/**
 * Inside a render at a place of the root or a part, until its outermost node: the place, by its
 * name, as @key, which that node refers to (see listing/places.ts).
 */
export function provideRenderPlace(place: string | undefined): void {
  setContext('sverlin:render-place', place);
}

export function renderPlaceContext(): string | undefined {
  return getContext<string | undefined>('sverlin:render-place');
}

export function pointersContext(): readonly Pointer[] {
  return getContext<readonly Pointer[] | undefined>('sverlin:pointers') ?? [];
}

/**
 * The pointers drawn around an element at a position, of those that can point there, outermost
 * first: those never at one element at the same step share a slot, each joining the innermost
 * whose pointers it is apart from, nearest the element, so an element keeps room only for as many
 * labels as are ever there together. Of each slot, the pointer at the position draws, else the first keeps the room.
 */
export function sharedSlots(
  types: TypeContext | undefined,
  pointers: readonly Pointer[],
  position: number
): Pointer[] {
  const apart = (a: Pointer, b: Pointer) =>
    !a.ref &&
    !b.ref &&
    a.path !== undefined &&
    b.path !== undefined &&
    (types?.apart(a.path, b.path) ?? false);
  const slots: Pointer[][] = [];
  for (const pointer of pointers) {
    const slot = slots.findLast((members) => members.every((other) => apart(pointer, other)));
    if (slot) slot.push(pointer);
    else slots.push([pointer]);
  }
  return slots.map(
    (members) => members.find((pointer) => pointer.position === position) ?? members[0]
  );
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
  /** The ids outside the pointer view, which the element it draws claims its own from. */
  ids?: NodeIds;
};

/**
 * Inside a pointer's view: ids claimed apart for each pointer, as one view can draw several, so a
 * node of one pointer's mark keeps its id, and the size it keeps by it (LayoutMemory.reserved),
 * whichever pointers it nests in at a step.
 */
export function providePointerNodeIds(order: number): void {
  const outer = nodeIdsContext();
  if (!outer) return;
  setContext<NodeIds>('sverlin:node-ids', {
    claim: (ref) => outer.claim(keyedRef(ref, `pointer${order}`))
  });
}

/**
 * Inside a pointer's view, until its outermost node or its <Pointed>: that node holds the pointers
 * nested inside it, so it keeps its own pointer's size, not its view's box (see Node).
 */
export function provideInPointerView(inside: boolean): void {
  setContext('sverlin:in-pointer-view', inside);
}

export function inPointerViewContext(): boolean {
  return getContext<boolean | undefined>('sverlin:in-pointer-view') ?? false;
}

/** Where a <Pointed> draws its element: the ids outside the pointer views around it again. */
export function restoreNodeIds(ids: NodeIds | undefined): void {
  if (ids) setContext<NodeIds>('sverlin:node-ids', ids);
}

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
 * The room a pointer's view is drawn in round an element, its slot there (see sharedSlots), for the
 * outermost node it draws: every pointer sharing the slot draws that node at the slot's one size,
 * the largest any of them reaches (see data-sv-room in model/reserve.ts), so the element stays put
 * whichever of them is drawn.
 */
export function providePointerRoom(room: string | undefined): void {
  setContext('sverlin:pointer-room', room);
}

export function pointerRoomContext(): string | undefined {
  return getContext<string | undefined>('sverlin:pointer-room');
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

/**
 * How a node packs its children, where its kind's spacing is packed: along `axis` each child takes
 * its own size, not its slot's, so a growing child moves its neighbours; the node itself keeps the
 * room of every child's largest, so nothing outside it moves. `anchor` is where its children's
 * kind places a box along that axis, which each child reports, so a child expanding grows from it
 * and the room left over sits where it says.
 */
export type Packing = { axis: 'width' | 'height'; anchor: 'flex-start' | 'center' | 'flex-end' };

export function providePacking(packing: Packing | undefined): void {
  setContext('sverlin:packing', packing);
}

export function packingContext(): Packing | undefined {
  return getContext<Packing | undefined>('sverlin:packing');
}

/**
 * A grid around its cells: the coordinates its cells cover at this step, as [row, col], 'all' for
 * every track of a full span, so two cells at one coordinate are found; the coordinate its first
 * row and column take, below 0 where a step places a cell there; and how many rows and columns it
 * keeps, once the page knows (see widenTracks in model/reserve.ts).
 */
export type GridCells = {
  cells: (readonly [number | 'all', number | 'all'])[];
  start: readonly [number, number];
  count?: readonly [number, number];
  basis?: Basis;
};

/**
 * A grid whose basis is not square places each cell itself: at col times the col vector plus row
 * times the row vector, in pitches, from the corner of the box round every coordinate it keeps;
 * a pitch is the largest row's height and the largest column's width, in pixels, with the gap, in
 * em, between pitches (see basis in Node.svelte).
 */
export type Basis = {
  col: readonly [number, number];
  row: readonly [number, number];
  pitch: readonly [number, number];
  origin: readonly [number, number];
  gap: number;
};

/**
 * A subgrid around its items: the axis whose tracks it takes from its grid (0 rows, 1 columns), the
 * coordinate of its first track, and the coordinate its next item takes, which the subgrids inside
 * it share, so their items go on numbering (see subgrid in Node.svelte).
 */
export type Subgrid = { subgrid: 0 | 1; first: number; next: { at: number } };

export function provideGrid(grid: GridCells | Subgrid | undefined): void {
  setContext('sverlin:grid', grid);
}

export function gridContext(): GridCells | Subgrid | undefined {
  return getContext<GridCells | Subgrid | undefined>('sverlin:grid');
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
