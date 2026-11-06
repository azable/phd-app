/**
 * Atomic types, and the contexts the library's components share. The presentation entry provides
 * 'sverlin:types'.
 */

import { getContext, setContext, type Snippet } from 'svelte';

import { placedKind, placeLabelKey, placeName, type DesignValues, type Place } from './node/design';
import type { ShownFrame } from './fit';
import type { ArrangeEdge } from './node/arrange';
import type { Layout } from './node/props';
import type { SpanInput, SpanLayout } from './node/span';
import type { ListingPlaces, ListingSyntax } from './steps';

export type TypeContext = {
  /** The atomic type name of item `index` of a container taken from the props, if typed. */
  itemType(container: unknown, index: number): string | undefined;
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
  /** How many elements the collection at a path holds, as values or paths[1]. */
  lengthOf(path: string): number | undefined;
  /** The most elements the collection at a path can hold, its type's max. */
  maxLengthOf?(path: string): number | undefined;
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
 * link with no from starts there.
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

/** Inside a render at a place: the place, whose own variables the kinds of the view it draws take. */
export function providePlace(place: Place | undefined): void {
  setContext('sverlin:place', place);
}

export function placeContext(): Place | undefined {
  return getContext<Place | undefined>('sverlin:place');
}

/**
 * What place() in a view gives: the design's caption for the place the view is rendered at
 * (`:lo.label`), else the place's own name (see placeName), as `lo`, `pair.left` or a label's last
 * name, `next` for `:@scan.next`, or, for a render with no name, its expression as written, as
 * `j - 1`; nothing outside a place.
 */
export function sverlinPlace(): string {
  const place = placeContext();
  if (!place) return '';
  if (!place.at) return place.written ?? '';
  const label = designContext()[placeLabelKey(place.at)];
  return typeof label === 'string' && label ? label : placeName(place.at);
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

/**
 * Whether nodes are hidden, keeping their room, as a link's label or a slot whose value is absent.
 * Hidden only once a step is shown (assembly/entry.ts), and left out of the scene.
 */
export function provideHidden(hidden: boolean): void {
  setContext('sverlin:hidden', hidden);
}

export function hiddenContext(): boolean | undefined {
  return getContext<boolean | undefined>('sverlin:hidden');
}

/**
 * Inside a hidden copy, as a link's label measured or a slot whose value is absent: its nodes name
 * no element, so no identity is shown twice.
 */
export function provideCopy(): void {
  setContext('sverlin:copy', true);
}

export function copyContext(): boolean {
  return getContext<boolean | undefined>('sverlin:copy') ?? false;
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
