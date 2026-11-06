<!--
  One node of a visualization: a primitive `value`, or children content, which makes it a
  collection when it is one {#each} over a collection. A layout arranges its children, so
  annotations such as an index or a pointer are simply nodes beside a value. Its look is the
  variant's values for its kind, the snippet it is in (see design.ts), not props of its own.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import Arranged from './Arranged.svelte';
  import LinkOverlay from './LinkOverlay.svelte';
  import type { Direction, Form } from './forms';
  import Node from './Node.svelte';
  import ItemEnd from './ItemEnd.svelte';
  import Pointing from './Pointing.svelte';
  import {
    designContext,
    copyContext,
    elementOf,
    endSlotContext,
    itemEndsContext,
    provideItemEnds,
    hiddenContext,
    hiddenSitesContext,
    provideHidden,
    insideComponentBox,
    unionBoxKey,
    unionContext,
    insideView,
    provideInView,
    leftOutContext,
    listingContext,
    provideRenderPlace,
    renderPlaceContext,
    layoutMemoryContext,
    movingIdentity,
    nodeIdsContext,
    elementSlot,
    pointedContext,
    pointerAroundContext,
    pointerRoomContext,
    providePointerRoom,
    inPointerViewContext,
    provideInPointerView,
    pointerIdentityContext,
    placeContext,
    pointersContext,
    pointsInto,
    reachesInto,
    provideComponentBox,
    providePointerAround,
    providePointerIdentity,
    provideCollectionLayout,
    provideSequence,
    providePacking,
    packingContext,
    provideGrid,
    gridContext,
    collectionLayoutContext,
    sequenceContext,
    slotContext,
    provideDrawn,
    throughContext,
    typeContext,
    wrappedContext,
    type Basis,
    type Packing,
    type Pointer
  } from '../type-context';
  import {
    addedReach,
    anchorOrigin,
    boxEffects,
    caseCss,
    colourCss,
    decorationCss,
    fillStyleCss,
    kindKey,
    lookUp,
    offsetReach,
    paintProps,
    paintReach,
    placedKind,
    scaleReach,
    strokeStyleCss,
    widerReach
  } from './design';
  import { boundLength, boundLook, slotAnchor, type BoundDomain } from './bound';
  import { fontClass, iconGlyph } from '../fonts';
  import { lightOf, namedPlaces, nodeLight } from '../listing/places';
  import { alignments, justifications } from './scales';
  import type { Align, Justify, Layout, Primitive } from './props';

  let {
    value,
    layout,
    row,
    col,
    rowSpan = 1,
    colSpan = 1,
    children,
    flow,
    icon: kindIcon = false,
    __view: chosenView = 'root',
    __kindOf,
    __over,
    __ref,
    __id,
    __again = false,
    __type,
    __links,
    __field = false,
    __component,
    __slot,
    __text = false,
    __itemOf,
    __itemAt,
    __items,
    __places,
    __code,
    __math,
    __mathText,
    __extent,
    __nodes = false,
    __domains,
    __packedAlong,
    ...bound
  }: {
    /** A primitive to display, when the node has no children. */
    value?: Primitive;
    /** Written bare, as <Node icon />: one icon, its kind's design's. */
    icon?: boolean;
    /** How children are arranged; a collection's items default to a row. */
    layout?: Layout;
    /**
     * In a grid, the cell this node is placed in, as loop indices; one left out spans every track
     * of its axis, and both, cell (0, 0).
     */
    row?: number;
    col?: number;
    /** In a grid, how many rows and columns its cell covers from its row and col. */
    rowSpan?: number;
    colSpan?: number;
    children?: Snippet;
    /** In a free layout, the axis arrows point along: 'x' (rightwards) or 'y' (downwards). */
    flow?: 'x' | 'y';
    /** Internal: the snippet this node is in, by its path, which is its kind; added by the compiler. */
    __view?: string;
    /** Internal: set by the compiler on a node whose kind is an expression: the names it reads with the variables each stands for (a {@const} name the ones its value reads), their values, and the expression over them. */
    __kindOf?: {
      reads: readonly (readonly string[])[];
      values: readonly unknown[];
      choose: (...values: unknown[]) => string;
    };
    /**
     * Internal: the kind of the pointer drawing this node again, and whether it is at it: its paint
     * shows only where it is, and its other props hold in every slot, so slots keep one size.
     */
    __over?: { kind: string; active: boolean; placed?: string };
    /** Internal: the source position of this node's tag, added by the compiler. */
    __ref?: string;
    /** Internal: an id given by the node this one stands for, such as the node a pointer draws again. */
    __id?: string;
    /** Internal: set where this node is drawn again by itself, inside its pointers or as a copy: it is no grid cell, the node drawing it being one. */
    __again?: boolean;
    /** Internal: set by the compiler on a node showing its view's own value: that value's type, which gives its unit. */
    __type?: string;
    /** Internal: set by the compiler when <Link> components sit among this node's children. */
    __links?: boolean;
    /** Internal: set by the compiler on a field, a node holding only links that start at it: its content is centred, as a cell's is. */
    __field?: boolean;
    /** Internal: set by the compiler on a typed component's root, naming the component. */
    __component?: string;
    /** Internal: the element of the state this node draws, such as values[2], given by the node a pointer draws again. */
    __slot?: string;
    /** Internal: set by the compiler on a node writing text around views, which sit inline in it. */
    __text?: boolean;
    /** Internal: set by the compiler on the one node an {#each} draws each item in: the collection and the item's index. */
    __itemOf?: unknown;
    __itemAt?: number;
    /** Internal: set by the compiler on a node whose children are one {#each}: what it iterates, which makes this node a collection. */
    __items?: ArrayLike<unknown>;
    /** Internal: the places of the root's pointers at the element this node draws again, by their names (see Pointed). */
    __places?: readonly string[];
    /** Internal: the place a caption's token names, as @i for $i[A[i]] (see captionTokens in layout-tags). */
    __code?: string;
    /**
     * Internal: inline maths, the SVG MathJax drew for it when the presentation was built, and the
     * text the PDF draws in its place (see maths-svg.server.ts).
     */
    __math?: string;
    __mathText?: string;
    /**
     * Internal: the values a view binds props to, as __bound_fill for fill={this.state}, set by the
     * compiler, with the values each can take (see bound.ts).
     */
    __domains?: Readonly<Record<string, BoundDomain>>;
    /** Internal: for a pointer's copy of an element, how the element's row packs it. */
    __packedAlong?: Packing;
    /**
     * Internal: every row and column a grid's cells can take for any input, from their coordinates'
     * types, null where they cannot be worked out (see gridExtents in bound-props.server.ts).
     */
    __extent?: readonly [readonly number[] | null, readonly number[] | null];
    /** Internal: set by the compiler on a grid's child whose children are all nodes, which can then be its items (see subgrid). */
    __nodes?: boolean;
    [bound: `__bound_${string}`]: unknown;
  } = $props();

  const types = typeContext();
  // Where a variable its kind expression reads is absent, the expression read a stand-in: it is
  // chosen again with that name undefined.
  const absentRead = (n: number) => __kindOf?.reads[n].some((name) => types?.absent(name)) ?? false;
  const __view = $derived(
    __kindOf?.reads.some((_, n) => absentRead(n))
      ? __kindOf.choose(...__kindOf.values.map((value, n) => (absentRead(n) ? undefined : value)))
      : chosenView
  );
  // This node's look: the variant's values for its kind, or for a pointer drawing it again.
  const design = designContext();
  // A pointer drawing this node again gives its paint where it is, and its other props everywhere;
  // a render at a place gives its own where the variant sets them (see placedKind).
  const placed = untrack(() => placedKind(placeContext(), __view));
  // How a box sits in its slot is its own kind's, wherever a pointer draws it again.
  const slotProps = new Set(['width', 'height', 'xAnchor', 'yAnchor']);
  const look = (prop: string): unknown => {
    const over =
      __over && !slotProps.has(prop) && (__over.active || !paintProps.has(prop))
        ? __over
        : undefined;
    if (over) return lookUp(design, over.kind, over.placed, prop);
    // A prop the view binds takes the option its value maps to, where the design gives one.
    const domain = __domains?.[prop];
    const mapped = domain
      ? boundLook(design, __view, prop, bound[`__bound_${prop}`], domain)
      : undefined;
    return mapped ?? lookUp(design, __view, placed, prop);
  };
  // The icon the view binds, as icon={this}: its value's, wherever a pointer draws it again; or,
  // written bare, the one its kind's design gives.
  const icon = $derived(
    __domains?.icon
      ? iconGlyph(boundLook(design, __view, 'icon', bound.__bound_icon, __domains.icon))
      : kindIcon
        ? iconGlyph(look('icon'))
        : undefined
  );
  // A length the view binds, as width={this}: its value times its kind's unit, in pixels.
  const lengthOf = (prop: 'width' | 'height') =>
    __domains?.[prop] ? boundLength(design, __view, prop, bound[`__bound_${prop}`]) : undefined;
  const valueWidth = $derived(lengthOf('width'));
  const valueHeight = $derived(lengthOf('height'));
  // A box takes its slot's width and height, the largest it reaches, or along an axis its kind
  // varies, or its value sizes, its own, in a slot that keeps the largest, so nothing around it
  // moves, placed by its kind's anchor. A parent packing its children along an axis keeps no slot
  // for them there: each takes its own size, and the parent the room of them all.
  const packing = untrack(() => __packedAlong ?? packingContext());
  const packedAlong = packing?.axis;
  const varies = (axis: 'width' | 'height') =>
    Boolean(__domains?.[axis]) || look(axis) === 'varying';
  const varyingWidth = $derived(varies('width'));
  const varyingHeight = $derived(varies('height'));
  const slotWidth = $derived(varyingWidth && packedAlong !== 'width');
  const slotHeight = $derived(varyingHeight && packedAlong !== 'height');
  const keepsSlot = (axis: 'width' | 'height') =>
    !(axis === 'width' ? varyingWidth : varyingHeight) && packedAlong !== axis;
  const xAnchor = $derived(slotAnchor(look('xAnchor'), 'x', __domains));
  const yAnchor = $derived(slotAnchor(look('yAnchor'), 'y', __domains));
  // A packed child tells its row where its kind places a box along the row, so an expansion grows
  // from there: around its centre by default, its neighbours moving apart equally.
  untrack(() => {
    if (packing) packing.anchor = packing.axis === 'width' ? xAnchor : yAnchor;
  });
  // A pointer's kind may expand the element it is at by its expand on each side. In a row that
  // packs, the box grows, taking room the row keeps for it (see packRoom); elsewhere it is paint, its
  // fill spread and its stroke drawn further out.
  const expandOf = (value: unknown) => (typeof value === 'number' ? value : 0);
  const expanded = $derived(expandOf(look('expand')));
  // Paint round the box takes no room of its own, so the box sits in a room keeping its largest
  // reach on each side in any state: its own kind's shadow and glow, and a pointer's at it, active
  // or not, with the pointer's spread and its expansion where it is painted. So no paint lies over
  // a neighbour or past the drawing's edge, and nothing moves as a pointer comes and goes.
  const paintedReach = untrack(() => {
    const own = paintReach(
      lookUp(design, __view, placed, 'shadow'),
      lookUp(design, __view, placed, 'glow')
    );
    if (!__over) return own;
    const of = (prop: string) => lookUp(design, __over.kind, __over.placed, prop);
    const spreads =
      (packedAlong === undefined ? expandOf(of('expand')) : 0) + expandOf(of('spread'));
    return widerReach(own, paintReach(of('shadow'), of('glow'), spreads));
  });
  const growth = $derived(packedAlong === undefined ? 0 : expanded);
  // The box's fill spread and its stroke drawn further out: a pointer's spread, and its expansion
  // where it is painted, one drawing for both.
  const spread = $derived((packedAlong === undefined ? expanded : 0) + expandOf(look('spread')));
  // The id a participant's selection refers to this node by (see provideNodeIds).
  const nodeIds = nodeIdsContext();
  const endSlot = endSlotContext();
  const id = untrack(() =>
    endSlot ? undefined : (__id ?? (__ref ? nodeIds?.claim(__ref) : undefined))
  );
  // The element of the state this node draws: a collection's item, or a component's root, which
  // draws the element its call was given (see Slot.svelte). A hidden copy draws none.
  const copy = copyContext();
  const slot = untrack(() =>
    copy ? undefined : (__slot ?? (__component ? slotContext() : undefined))
  );
  // The root's pointers that can point into the collection whose element this node draws, as
  // those pointing elsewhere this step keep their room, outermost (written last) first: the node
  // is then drawn inside them (see Pointing.svelte), once, however many nodes
  // inside also draw the element.
  const element = untrack(() => elementSlot(slot));
  untrack(() => {
    if (element && slot) provideDrawn(slot);
  });
  const pointers = untrack(() =>
    element && wrappedContext() !== slot
      ? pointersContext()
          .filter((pointer) => reachesInto(types, pointer, element.collection))
          .map((pointer) =>
            pointsInto(types, pointer, element.collection)
              ? pointer
              : { ...pointer, position: Number.NaN }
          )
          .toSorted((a, b) => b.order - a.order)
      : []
  );
  const position = element?.index ?? -1;
  const length = untrack(() => (element ? (types?.lengthOf(element.collection) ?? 0) : 0));
  // The value this node draws keeps its identity across steps, so it can be followed as it moves,
  // or read through a position, its place's; the outermost node a pointer's view draws where the
  // pointer is takes the pointer's.
  const pointerIdentity = pointerIdentityContext();
  if (pointerIdentity) providePointerIdentity(undefined);
  // The element the outermost node of a pointer's view is drawn around, active or not.
  const drawnAround = pointerAroundContext();
  if (drawnAround) providePointerAround(undefined);
  // The slot it is drawn in there, which every pointer sharing it draws at one size.
  const pointerRoom = pointerRoomContext();
  if (pointerRoom) providePointerRoom(undefined);
  // A pointer view's outermost node, not the element its <Pointed> draws (see provideInPointerView).
  const pointerViewRoot = inPointerViewContext();
  if (pointerViewRoot) provideInPointerView(false);
  // The places this node refers to, where a listing's token names them (see listing/places.ts):
  // those of the pointers at the element it draws, the render at a place it is the outermost node
  // of, or the pointer at a place whose view it is the outermost node of where the pointer is.
  const renderPlace = renderPlaceContext();
  if (renderPlace) provideRenderPlace(undefined);
  const listing = listingContext();
  const ownPlaces = untrack(() => {
    const place = placeContext();
    return namedPlaces(listing, [
      renderPlace,
      drawnAround && pointerIdentity && place && !place.within ? place.at : undefined
    ]);
  });
  const identity = untrack(() =>
    slot === undefined
      ? pointerIdentity
      : endSlot
        ? undefined
        : movingIdentity(types, throughContext(), slot)
  );
  // The end slots, as far past each end as any step puts one of the pointers' positions: none
  // where the trace never goes past.
  const endsOf = (into: readonly Pointer[], count: number, collection?: string) => {
    // A pointer reaching this collection at some step keeps its end slots here at every step; one
    // left out past the ends keeps none.
    const ends = into
      .filter((pointer) => !pointer.inside)
      .map((pointer) =>
        types?.pastEnds(
          collection && pointer.reaches?.has(collection) ? collection : pointer.collection,
          pointer.path
        )
      );
    const reachBefore = Math.max(0, ...ends.map((end) => end?.before ?? 0));
    const reachAfter = Math.max(0, ...ends.map((end) => end?.after ?? 0));
    return {
      before: Array.from({ length: reachBefore }, (_, place) => place - reachBefore),
      after: Array.from({ length: reachAfter }, (_, place) => count + place)
    };
  };
  // An {#each} item's node keeps its collection's end slots, as hidden copies of itself beside the
  // first item and the last, so that labels drawn with each element line up in them too; the
  // element inside then keeps none.
  const eachItem = untrack(() =>
    __itemOf === undefined || endSlot
      ? undefined
      : elementSlot(elementOf(types, __itemOf, __itemAt ?? 0))
  );
  const itemPointers = untrack(() =>
    eachItem
      ? pointersContext().filter((pointer) => reachesInto(types, pointer, eachItem.collection))
      : []
  );
  if (eachItem && itemPointers.length) provideItemEnds(eachItem.collection);
  const itemLength = untrack(() => (eachItem ? (types?.lengthOf(eachItem.collection) ?? 0) : 0));
  const itemEnds = untrack(() => endsOf(itemPointers, itemLength, eachItem?.collection));
  const { before, after } = untrack(() =>
    endsOf(itemEndsContext() === element?.collection ? [] : pointers, length, element?.collection)
  );
  // Inside an item's copy at an end slot, the element draws only the pointers there.
  const atEnd =
    endSlot && element?.collection === endSlot.collection ? endSlot.position : undefined;
  // End slots belong in a sequence; in a free layout, such as a graph, they would be loose boxes.
  const inSequence = sequenceContext() !== false;
  // Nodes a pointer draws where it is not keep their room, hidden, and the element inside shows.
  // Hidden at this step with every render it holds, keeping its room, its children with it.
  const hiddenHere = untrack(
    () => __ref !== undefined && (hiddenSitesContext()?.has(__ref) ?? false)
  );
  if (hiddenHere) provideHidden(true);
  const hidden = hiddenHere ? true : hiddenContext();
  // A node only keeping its room refers to nothing.
  const places = untrack(() =>
    hidden ? [] : namedPlaces(listing, [...ownPlaces, ...(__places ?? []), __code])
  );
  const lightColour = untrack(() => lightOf(listing, places));
  const light = lightColour ? nodeLight(listing?.places?.look, lightColour) : {};
  // Left out of the presentation, as its kind's shown false leaves it out (see left-out.ts).
  const leftOut = untrack(() => __ref !== undefined && (leftOutContext()?.has(__ref) ?? false));
  // A node keeps a least size so that changing content never moves anything around it. A typed
  // component's root keeps the largest box the component reaches for any of its inputs (see
  // assembly/entry.ts), and the nodes inside it keep their natural sizes, since that box already
  // holds every way they can be drawn; any other node keeps the largest size it reaches at any step
  // (see LayoutMemory).
  const memory = layoutMemoryContext();
  // Inside a value of a union, a member's view takes the box the union's members share.
  const union = unionContext();
  // A pointer view's outermost node holds the pointers nested inside it, so one view drawn for
  // several pointers would take the largest nest's box for each: it keeps its own pointer's size by
  // its id instead (see providePointerNodeIds).
  const box = untrack(() =>
    !pointers.length &&
    !pointerViewRoot &&
    __component &&
    memory &&
    (!memory.measuring || memory.probing)
      ? ((union ? memory.components.get(unionBoxKey(__component, union)) : undefined) ??
        memory.components.get(__component))
      : undefined
  );
  const insideBox = insideComponentBox();
  if (box) provideComponentBox();
  const reserved = untrack(() => {
    if (box) return box;
    if (!memory || memory.measuring || insideBox || !id) return undefined;
    return memory.reserved.get(id);
  });
  // Its words' largest size at any step (see model/reserve.ts), kept inside a typed component's box
  // too, so words that change keep one block and what their line holds stays put.
  const wordsKept = untrack(() =>
    !memory || memory.measuring || !id ? undefined : memory.reserved.get(`w:${id}`)
  );
  const leastOf = (scale: string | undefined, pixels: number | undefined) =>
    pixels === undefined ? scale : scale ? `max(${scale}, ${pixels}px)` : `${pixels}px`;
  // A pointer's transforms move and scale its whole drawing, the marks round the element with it:
  // they are drawn on the outermost node its view draws around the element (the element itself,
  // where the view is a <Pointed> alone), only where the pointer is, scaled from that node's
  // anchors. They take no room, so that node's room keeps their reach in every state: an offset's
  // distance, and a scale's growth of the node's kept size, which the page learns from the layout
  // memory and the measuring pass works out from the same size (see data-sv-scale in reserve.ts).
  const transformer = untrack(() => {
    if (drawnAround === undefined) return undefined;
    if (__over) return __over;
    const kind = kindKey(__view.split('.')[0], 'Pointed');
    return {
      kind,
      placed: placedKind(placeContext(), kind),
      active: pointedContext()?.active ?? false
    };
  });
  const transformOf = (prop: string): number => {
    const value = transformer ? lookUp(design, transformer.kind, transformer.placed, prop) : 0;
    return typeof value === 'number' ? value : 0;
  };
  const scaled = untrack(() => Math.max(1, transformOf('scale')));
  const anchorsOf = () => ({ x: xAnchor, y: yAnchor });
  const reach = untrack(() => {
    const moved = addedReach(
      paintedReach,
      offsetReach(transformOf('offsetX'), transformOf('offsetY'))
    );
    return reserved && scaled > 1 && !memory?.measuring
      ? addedReach(moved, scaleReach(scaled, anchorsOf(), reserved))
      : moved;
  });
  const reaches =
    scaled > 1 || reach.top > 0 || reach.right > 0 || reach.bottom > 0 || reach.left > 0;
  const reachPadding = reaches
    ? `${reach.top}px ${reach.right}px ${reach.bottom}px ${reach.left}px`
    : undefined;
  // Measuring knows no kept sizes yet, so the room says how it scales, and the layout model adds
  // the scale's reach from the size its node keeps.
  const scaleRoom = untrack(() =>
    scaled > 1 && memory?.measuring ? `${scaled} ${anchorsOf().x} ${anchorsOf().y}` : undefined
  );
  const transform = $derived.by(() => {
    if (!transformer?.active) return undefined;
    const x = transformOf('offsetX');
    const y = transformOf('offsetY');
    const parts = [
      x || y ? `translate(${x}px, ${y}px)` : '',
      scaled > 1 ? `scale(${scaled})` : ''
    ].filter(Boolean);
    return parts.length ? parts.join(' ') : undefined;
  });
  const transformOrigin = $derived(transform ? anchorOrigin(anchorsOf()) : undefined);
  const unit = $derived(__type ? types?.unit(__type) : undefined);
  // A number type draws every value with its places, as 3.00, so values line up and keep one width.
  const decimals = $derived(__type ? types?.places?.(__type) : undefined);
  const printed = $derived(
    value === null
      ? '∅'
      : typeof value === 'number' && decimals !== undefined
        ? value.toFixed(decimals)
        : String(value)
  );
  // Every prop as given, to draw this node again inside its pointers.
  const given = $derived({
    value,
    layout,
    children,
    flow,
    __view,
    __ref,
    __type,
    __links,
    __component,
    __items,
    __domains,
    __again: true,
    ...bound
  });

  const collection = $derived(__items !== undefined);
  // A collection runs as a row, or across the collection around it, as rows in a column do. A
  // node joining links states its layout (the compiler refuses one that does not).
  const around = collectionLayoutContext();
  const collectionLayout = $derived(
    around === 'row' ? 'column' : around === 'column' ? 'row' : 'row'
  );
  const arrangement = $derived(layout ?? (collection ? collectionLayout : undefined));
  // A grid's child is placed in the cell its row and col name, covering rowSpan rows and colSpan
  // columns from there; an axis left out spans all its tracks, and a child with neither is at
  // (0, 0). The nodes inside it are no grid's children, unless it is a subgrid. A grid keeps the
  // tracks the page worked out over every step (see LayoutMemory), so it never moves as it fills in.
  const gridAround = untrack(() => (__again ? undefined : gridContext()));
  const grid = gridAround && !('subgrid' in gridAround) ? gridAround : undefined;
  const inSubgrid = gridAround && 'subgrid' in gridAround ? gridAround : undefined;
  const cell = untrack(() =>
    grid
      ? {
          row: row ?? (col === undefined ? 0 : ('all' as const)),
          col: col ?? (row === undefined ? 0 : ('all' as const)),
          rowSpan,
          colSpan
        }
      : undefined
  );
  // A cell spanning tracks along an axis whose children are all nodes places them on those tracks,
  // as a CSS subgrid does: item k at coordinate k from the cell's own (from 0 where it spans every
  // track), its gap and align its own, its box drawn as a band behind them. A collection among them
  // running along that axis is a subgrid too, its items going on numbering, so {values} drawn by
  // its view puts values[k] at coordinate k. A node drawn round pointers, or with room round it for
  // its paint, is no subgrid: its cell holds it whole.
  const shownHere = untrack(() => look('shown') !== false && !leftOut);
  const subgrid = untrack((): 0 | 1 | undefined => {
    if (!shownHere || pointers.length || reaches) return undefined;
    if (inSubgrid) {
      const along = inSubgrid.subgrid === 1 ? 'row' : 'column';
      return collection && arrangement === along ? inSubgrid.subgrid : undefined;
    }
    if (!cell || !__nodes || grid?.basis) return undefined;
    if (cell.col === 'all') return 1;
    if (cell.row === 'all') return 0;
    if (cell.colSpan > 1) return 1;
    if (cell.rowSpan > 1) return 0;
    return undefined;
  });
  // The coordinate a subgrid's numbering starts at, or a subgrid's item takes, along its axis.
  const numbered = untrack(() => {
    if (inSubgrid) {
      if (!shownHere) return undefined;
      const at = inSubgrid.next.at;
      if (subgrid === undefined) inSubgrid.next.at += 1;
      return at;
    }
    if (!cell || subgrid === undefined) return undefined;
    const at = subgrid === 1 ? cell.col : cell.row;
    return at === 'all' ? 0 : at;
  });
  // Two cells covering one coordinate at a step are drawn over each other, and the build warns
  // (see warn in library/record.ts), as a grid places each cell where it is written. A subgrid is
  // a band behind its items, which may lie over other cells.
  const warning = untrack(() => {
    if (subgrid !== undefined) {
      const justify = look('justify');
      return justify === 'between' || justify === 'around' || justify === 'evenly'
        ? `A subgrid takes its grid's tracks, so justify ${String(justify)} cannot spread them: it has no effect along the ${subgrid === 1 ? 'columns' : 'rows'}.`
        : undefined;
    }
    if (!cell || !grid) return undefined;
    // A coordinate below 0 or past the last track extends the grid by a track (see widenTracks).
    if (![cell.row, cell.col].every((at) => at === 'all' || Number.isInteger(at)))
      throw new Error(
        `A grid's cell is placed at whole numbers, not row ${cell.row}, col ${cell.col}.`
      );
    if (![cell.rowSpan, cell.colSpan].every((span) => Number.isInteger(span) && span >= 1))
      throw new Error(
        `A grid's cell covers a whole number of tracks from 1, not rowSpan ${cell.rowSpan}, colSpan ${cell.colSpan}.`
      );
    const covered = (at: number | 'all', span: number) =>
      at === 'all' ? (['all'] as const) : Array.from({ length: span }, (_, k) => at + k);
    const mine = covered(cell.row, cell.rowSpan).flatMap((r) =>
      covered(cell.col, cell.colSpan).map((c) => [r, c] as const)
    );
    const meets = (a: number | 'all', b: number | 'all') => a === 'all' || b === 'all' || a === b;
    const met = mine.find(([r, c]) => grid.cells.some(([r2, c2]) => meets(r, r2) && meets(c, c2)));
    grid.cells.push(...mine);
    if (!met) return undefined;
    const axis = (name: string, at: number | 'all') =>
      at === 'all' ? `every ${name}` : `${name} ${at}`;
    return `Two cells of a grid cover ${axis('row', met[0])}, ${axis('col', met[1])} at one step, so they are drawn over each other: give each a row or col of its own.`;
  });
  // The CSS line a coordinate takes: tracks start at the smallest coordinate any step reaches, which
  // the page knows once it has measured every step; while measuring, a cell is sized alone. A full
  // span covers every track the page keeps, and one track while measuring, or, for a subgrid, the
  // tracks its items reach. Inside a subgrid, lines count from its first track, and the other
  // axis is its own single track.
  const line = (at: number, start: number) => Math.max(1, at - start + 1);
  const lines = (at: number | 'all', span: number, axis: 0 | 1) =>
    at === 'all'
      ? { start: 1, end: grid?.count?.[axis] ? `span ${grid.count[axis]}` : undefined }
      : {
          start: line(at, grid?.start[axis] ?? 0),
          end: span > 1 ? `span ${span}` : undefined
        };
  const subgridLines = (axis: 0 | 1) => {
    if (!inSubgrid || numbered === undefined) return undefined;
    if (axis !== inSubgrid.subgrid) return { start: 1, end: undefined };
    const count = subgrid === undefined ? 1 : (__items?.length ?? 0);
    return {
      start: line(numbered, inSubgrid.first),
      end: count > 1 ? `span ${count}` : undefined
    };
  };
  const rowLines = untrack(() => (cell ? lines(cell.row, cell.rowSpan, 0) : subgridLines(0)));
  const colLines = untrack(() => (cell ? lines(cell.col, cell.colSpan, 1) : subgridLines(1)));
  // The coordinates a cell's markup carries, by which the page sizes its grid's tracks (see
  // widenTracks): a subgrid's item gives only those along the subgrid's axis.
  const cellAttributes = untrack(() => {
    if (cell)
      return {
        row: cell.row,
        col: cell.col,
        rowSpan: cell.rowSpan > 1 && cell.row !== 'all' ? cell.rowSpan : undefined,
        colSpan: cell.colSpan > 1 && cell.col !== 'all' ? cell.colSpan : undefined
      };
    if (!inSubgrid || numbered === undefined || subgrid !== undefined) return undefined;
    return {
      row: inSubgrid.subgrid === 0 ? numbered : undefined,
      col: inSubgrid.subgrid === 1 ? numbered : undefined,
      rowSpan: undefined,
      colSpan: undefined
    };
  });
  // A grid in a typed view is drawn by every copy of the view and for every value it is probed
  // with, so it keeps its tracks by its site, one set they all share and line up by.
  const inView = untrack(() => Boolean(__component) || insideView());
  untrack(() => {
    if (__component) provideInView();
  });
  const gridKey = untrack(() =>
    arrangement !== 'grid' ? undefined : inView ? (__ref ? `view:${__ref}` : undefined) : id
  );
  const tracks = untrack(() =>
    gridKey && memory && !memory.measuring ? memory.tracks.get(gridKey) : undefined
  );
  // A grid's basis, its kind's: the directions its columns and its rows run, each an x and a y in
  // pitches; a square one is a table, which CSS lays out. Any other places every cell at one
  // pitch, the largest row's height and the largest column's width at any step, in a box round
  // every coordinate the grid keeps, so nothing moves; while the page measures, the cells are
  // sized as a table's.
  const basis = untrack((): Basis | undefined => {
    if (arrangement !== 'grid') return undefined;
    const component = (prop: string, start: number) => {
      const value = look(prop);
      return typeof value === 'number' ? value : start;
    };
    const vectors = {
      col: [component('colX', 1), component('colY', 0)] as const,
      row: [component('rowX', 0), component('rowY', 1)] as const
    };
    if (vectors.col[0] * vectors.row[1] - vectors.col[1] * vectors.row[0] === 0)
      throw new Error(
        `A grid's basis needs a col and a row that are not parallel: col [${vectors.col.join(', ')}] and row [${vectors.row.join(', ')}] put every cell on one line.`
      );
    const square =
      vectors.col[0] === 1 && vectors.col[1] === 0 && vectors.row[0] === 0 && vectors.row[1] === 1;
    if (square || !tracks) return undefined;
    const [firstRow, firstColumn] = tracks.start ?? [0, 0];
    const rows = [firstRow, firstRow + Math.max(0, tracks.rows.length - 1)];
    const columns = [firstColumn, firstColumn + Math.max(0, tracks.columns.length - 1)];
    const corners = rows.flatMap((r) => columns.map((c) => [r, c] as const));
    const along = (axis: 0 | 1) =>
      Math.min(...corners.map(([r, c]) => c * vectors.col[axis] + r * vectors.row[axis]));
    return {
      ...vectors,
      pitch: [Math.max(0, ...tracks.rows), Math.max(0, ...tracks.columns)],
      origin: [along(0), along(1)],
      gap: typeof look('gap') === 'number' ? (look('gap') as number) : 0
    };
  });
  // The box round a basis grid's cells: as far as its farthest corner, plus a pitch.
  const basisBox = untrack(() => {
    if (!basis || !tracks) return undefined;
    const [firstRow, firstColumn] = tracks.start ?? [0, 0];
    const corners = [firstRow, firstRow + Math.max(0, tracks.rows.length - 1)].flatMap((r) =>
      [firstColumn, firstColumn + Math.max(0, tracks.columns.length - 1)].map((c) => [r, c])
    );
    const extent = (axis: 0 | 1) =>
      Math.max(...corners.map(([r, c]) => c * basis.col[axis] + r * basis.row[axis])) -
      basis.origin[axis];
    const length = (axis: 0 | 1) => {
      const pitch = axis === 0 ? basis.pitch[1] : basis.pitch[0];
      return `calc(${extent(axis)} * (${pitch}px + ${basis.gap}em) + ${pitch}px)`;
    };
    return { width: length(0), height: length(1) };
  });
  // Where a basis grid places a cell: at its coordinates through the basis, from the box's corner,
  // a pitch large, its node placed in it as the grid's align says.
  const basisPlace = untrack(() => {
    const placing = grid?.basis;
    if (!placing || !cell) return undefined;
    const at = (coordinate: number | 'all') => (coordinate === 'all' ? 0 : coordinate);
    const offset = (axis: 0 | 1) => {
      const pitch = axis === 0 ? placing.pitch[1] : placing.pitch[0];
      const units =
        at(cell.col) * placing.col[axis] + at(cell.row) * placing.row[axis] - placing.origin[axis];
      return `calc(${units} * (${pitch}px + ${placing.gap}em))`;
    };
    return {
      left: offset(0),
      top: offset(1),
      width: `${placing.pitch[1]}px`,
      height: `${placing.pitch[0]}px`
    };
  });
  // A subgrid's first track: its own coordinate, or, spanning every track, its grid's first.
  const subgridFirst = untrack(() => {
    if (subgrid === undefined || numbered === undefined) return undefined;
    if (inSubgrid) return numbered;
    const at = subgrid === 1 ? cell?.col : cell?.row;
    return at === 'all' ? (grid?.start[subgrid] ?? 0) : numbered;
  });
  untrack(() =>
    provideGrid(
      subgrid !== undefined && numbered !== undefined && subgridFirst !== undefined
        ? {
            subgrid,
            first: subgridFirst,
            next: inSubgrid?.next ?? { at: numbered }
          }
        : arrangement === 'grid'
          ? {
              cells: [],
              start: tracks?.start ?? [0, 0],
              ...(tracks ? { count: [tracks.rows.length, tracks.columns.length] as const } : {}),
              ...(basis ? { basis } : {})
            }
          : undefined
    )
  );
  untrack(() => {
    // A subgrid's items are its grid's cells, which need no end slots: a coordinate past the ends
    // extends the grid.
    if (subgrid !== undefined) provideSequence(false);
    else if (arrangement) provideSequence(arrangement === 'row' || arrangement === 'column');
    if (collection) provideCollectionLayout(arrangement);
  });
  // Packing applies as a step shows; while the page measures, children keep their slots, so this
  // node's room is every child's largest.
  const packs = untrack(
    () =>
      (arrangement === 'row' || arrangement === 'column') &&
      subgrid === undefined &&
      look('spacing') === 'packed' &&
      !memory?.measuring
  );
  const ownPacking = $state<Packing>({
    axis: untrack(() => (arrangement === 'row' ? 'width' : 'height')),
    anchor: 'center'
  });
  untrack(() => providePacking(packs ? ownPacking : undefined));
  // The room a packed collection keeps for its pointers' expansions: one for each pointer that can
  // point into it, along it, and one across, at the largest expand any pointer's kind takes. While
  // the page measures it is padding at its end, so the room it keeps holds them; as a step shows,
  // that room is its least size and the expanded box takes it.
  const packRoom = untrack(() => {
    if (!collection || look('spacing') !== 'packed' || !__items) return undefined;
    if (arrangement !== 'row' && arrangement !== 'column') return undefined;
    const largest = Math.max(
      0,
      ...Object.entries(design)
        .filter(([key, value]) => key.endsWith('.expand') && typeof value === 'number')
        .map(([, value]) => value as number)
    );
    const path = types?.pathOf(__items);
    const count = path
      ? pointersContext().filter((pointer) => reachesInto(types, pointer, path)).length
      : 0;
    if (!largest || !count) return undefined;
    const along = 2 * largest * count;
    const across = 2 * largest;
    return arrangement === 'row'
      ? { width: along, height: across }
      : { width: across, height: along };
  });
  const trackCss = (sizes: readonly number[] | undefined) =>
    sizes?.length ? sizes.map((size) => `${size}px`).join(' ') : undefined;
  const measured = (prop: string, unit: string) => {
    const setting = look(prop);
    return typeof setting === 'number' ? `${setting}${unit}` : undefined;
  };
  // A node sized by its value holds nothing (the build refuses anything inside it), so it is its
  // length along it exactly, with no padding there, and 0 draws no length.
  const valuePadding = $derived.by(() => {
    const padding = measured('padding', 'em');
    if (valueWidth === undefined && valueHeight === undefined) return padding;
    const across = valueHeight === undefined ? (padding ?? '0') : '0';
    const along = valueWidth === undefined ? (padding ?? '0') : '0';
    return `${across} ${along}`;
  });
  // Its padding's four sides, top, right, bottom, left, each with pixels added where it grows.
  const paddingSides = (padding: string | undefined, add: readonly number[]) => {
    const [top = '0', right = top, bottom = top, left = right] = (padding ?? '0').split(/\s+/u);
    const sides = [top, right, bottom, left].map((side, index) =>
      add[index] ? `calc(${side} + ${add[index]}px)` : side
    );
    return add.some(Boolean) ? sides.join(' ') : padding;
  };
  const boxPadding = $derived.by(() => {
    if (growth) return paddingSides(valuePadding, [growth, growth, growth, growth]);
    if (packRoom && memory?.measuring)
      return paddingSides(valuePadding, [0, packRoom.width, packRoom.height, 0]);
    return valuePadding;
  });
  const grown = (least: string | undefined) =>
    growth ? (least ? `calc(${least} + ${2 * growth}px)` : `${2 * growth}px`) : least;
  const sized = (length: number | undefined) => (length !== undefined ? `${length}px` : undefined);
  const least = (length: number | undefined, axis: 'width' | 'height') =>
    length !== undefined
      ? `${length}px`
      : leastOf(measured('minSize', 'em'), keepsSlot(axis) ? reserved?.[axis] : undefined);
  const strokeColour = $derived(colourCss(look('stroke')));
  // Its stroke width holds in every state, as strokeWidth is not paint: a stroke of no colour keeps
  // its width, transparent, so a pointer colouring it moves nothing inside.
  const borderWidth = $derived(
    typeof look('strokeWidth') === 'number' ? (look('strokeWidth') as number) : 0
  );
  const fillColour = $derived(colourCss(look('fill')));
  const textColour = $derived(colourCss(look('color')));
  // Its shadow and glow, round the box it draws at this step, and its fill's style over its fill.
  const effects = $derived(
    boxEffects(look('shadow'), look('glow'), {
      stroke: strokeColour && borderWidth > 0 ? strokeColour : undefined,
      fill: fillColour,
      text: textColour
    })
  );
  // An expansion painted round the box: its fill spread out, and its stroke drawn at the spread's
  // edge, the border showing the fill beneath it. A solid stroke is a second shadow just outside the
  // fill's, so both shrink together between steps; an outline's offset animates in whole pixels and
  // would lag behind. A dashed or dotted stroke, which no shadow draws, stays an outline.
  const spreadStroke = $derived(spread > 0 && strokeColour !== undefined && borderWidth > 0);
  const strokeDashes = $derived(strokeStyleCss(look('strokeStyle')));
  const spreadShadow = $derived(
    spread > 0
      ? [
          fillColour ? `0 0 0 ${spread}px ${fillColour}` : undefined,
          spreadStroke && !strokeDashes
            ? `0 0 0 ${spread + borderWidth}px ${strokeColour}`
            : undefined
        ]
          .filter(Boolean)
          .join(', ') || undefined
      : undefined
  );
  const spreadOutline = $derived(
    spreadStroke && strokeDashes ? `${borderWidth}px ${strokeDashes} ${strokeColour}` : undefined
  );
  const fillStyle = $derived(fillColour ? fillStyleCss(look('fillStyle')) : undefined);
  // Its own text's line: the value's or the text it writes, never its child nodes', and its case,
  // which its child nodes inherit unless they set their own.
  const decoration = $derived(decorationCss(look('decoration')));
  const textCase = $derived(caseCss(look('case')));
  // Whether its own look draws a box, a stroke or a fill, whatever a pointer at it paints at a step:
  // an arrow to an element whose node draws none meets the boxes inside it that do (see visible.ts).
  const framed = $derived.by(() => {
    const own = (prop: string) => lookUp(design, __view, placed, prop);
    const width = look('strokeWidth');
    return (
      colourCss(own('fill')) !== undefined ||
      (colourCss(own('stroke')) !== undefined && typeof width === 'number' && width > 0)
    );
  });
  const font = $derived(look('font'));
  const weight = $derived(look('weight'));
  const gap = $derived((look('gap') as number | undefined) ?? 0);
  const resolvedAlign = $derived((look('align') as Align | undefined) ?? 'center');
  const alignment = $derived(alignments[resolvedAlign]);
  const justify = $derived((look('justify') as Justify | undefined) ?? 'start');
  const justification = $derived(justifications[justify]);
  // A row of a collection given more room than its tracks need, as a view keeping the widest box
  // any of its renders reaches, keeps its tracks and puts the room where justify says; between,
  // around, and evenly spread the tracks over it instead.
  const packed = $derived(justify === 'start' || justify === 'center' || justify === 'end');
  // A packed row keeping room for its pointers' expansions puts that room where its items' kind
  // places a box (see Packing): around them by default, so an expanded item grows about its centre,
  // the items before it moving back as far as those after move on.
  const roomAt = $derived(
    packs && packRoom
      ? ownPacking.anchor
      : justify === 'start'
        ? 'flex-start'
        : justify === 'end'
          ? 'flex-end'
          : 'center'
  );
  // A collection keeps room for its type's max elements: drawn to be measured, it holds an empty
  // track for each element it lacks, which the items' equal tracks size as one of them, so the
  // node keeps that size at every step (see model/reserve.ts). A component's box is probed full.
  const spares = $derived(
    collection && memory?.measuring && !insideBox && __items
      ? Math.max(
          0,
          (types?.maxLengthOf?.(types.pathOf(__items) ?? '') ?? 0) - (__items.length ?? 0)
        )
      : 0
  );
  // Free layouts are placed by constraint layout (see Arranged); rows and columns are CSS grids,
  // and their links never move their children: they are drawn over them (see LinkOverlay).
  const free = $derived(arrangement === 'free');
  // A node with no layout holding a value, words, or links of a field is a cell: what it holds is
  // one box placed in its own by its alignment, centred unless its kind says otherwise, so a box
  // larger than its content (a slot shared with a larger value, as a union's) holds it alike.
  const holdsOne = $derived(__field || (!arrangement && subgrid === undefined));
  const overlaid = $derived(
    __links && (arrangement === 'row' || arrangement === 'column' || arrangement === 'grid')
      ? arrangement
      : undefined
  );
</script>

{#snippet contents()}
  {@render children?.()}
{/snippet}

{#snippet pointed(props: Record<string, unknown>)}
  <Node
    {...given}
    __id={id}
    __slot={slot}
    {...props}
    __packedAlong={packing}
    __places={[...ownPlaces, ...((props.__places as string[] | undefined) ?? [])]}
  />
{/snippet}

{#snippet itemCopy()}
  <Node {...given} {__text} __ref={undefined} />
{/snippet}

{#snippet nodeBox()}
  <div
    class="sv-node {typeof font === 'string' ? fontClass(font) : ''}"
    data-sv-node={id}
    data-sv-kind={__over?.active ? __over.kind : __view}
    data-sv-component={pointerViewRoot ? undefined : __component}
    data-sv-slot={slot}
    data-sv-identity={identity}
    data-sv-around={drawnAround}
    data-sv-room={pointerRoom}
    data-sv-item={eachItem ? `${eachItem.collection}[${eachItem.index}]` : undefined}
    data-sv-hidden={hidden === undefined ? undefined : String(hidden)}
    data-sv-type={__type}
    data-sv-layout={arrangement}
    data-sv-fill={look('fill')}
    data-sv-stroke={look('stroke')}
    data-sv-color={look('color')}
    data-sv-framed={framed ? 'true' : undefined}
    data-sv-shadow={effects.shadow}
    data-sv-glow={effects.glow ? 'on' : undefined}
    data-sv-fill-style={fillStyle?.style}
    data-sv-decoration={decoration ? look('decoration') : undefined}
    data-sv-place={places.length ? places.join(' ') : undefined}
    data-sv-light={lightColour ? `${listing?.places?.look ?? 'fill'}|${lightColour}` : undefined}
    class:cell={holdsOne}
    class:math={__math !== undefined}
    style:font-size={measured('textSize', 'px')}
    style:font-weight={weight === 'bold' ? 700 : weight === 'normal' ? 400 : undefined}
    style:color={textColour}
    style:background-color={fillColour}
    style:background-image={fillStyle?.css}
    style:box-shadow={[spreadShadow, effects.css, light.shadow].filter(Boolean).join(', ') ||
      undefined}
    style:outline={light.outline ?? spreadOutline}
    style:outline-offset={light.outlineOffset ?? (spreadOutline ? `${spread}px` : undefined)}
    style:text-transform={textCase?.transform}
    style:font-variant-caps={textCase?.caps}
    style:text-decoration-line={__text ? decoration : undefined}
    style:border-color={spreadStroke
      ? 'transparent'
      : (strokeColour ?? (borderWidth > 0 ? 'transparent' : undefined))}
    style:border-style={strokeStyleCss(look('strokeStyle'))}
    style:border-width={`${borderWidth}px`}
    style:border-radius={measured('radius', 'px')}
    style:padding={boxPadding}
    style:width={sized(valueWidth)}
    style:height={sized(valueHeight)}
    style:min-width={subgrid === undefined ? grown(least(valueWidth, 'width')) : undefined}
    style:min-height={subgrid === undefined ? grown(least(valueHeight, 'height')) : undefined}
    style:opacity={look('opacity') as number | undefined}
    style:transform
    style:transform-origin={transformOrigin}
    class:sv-subgrid={subgrid !== undefined}
    data-sv-subgrid={subgrid === undefined ? undefined : subgrid === 1 ? 'col' : 'row'}
    data-sv-row={subgrid !== undefined ? cellAttributes?.row : undefined}
    data-sv-col={subgrid !== undefined ? cellAttributes?.col : undefined}
    data-sv-row-span={subgrid !== undefined ? cellAttributes?.rowSpan : undefined}
    data-sv-col-span={subgrid !== undefined ? cellAttributes?.colSpan : undefined}
    data-sv-warning={subgrid !== undefined ? warning : undefined}
    style:grid-row-start={subgrid !== undefined ? rowLines?.start : undefined}
    style:grid-row-end={subgrid !== undefined ? rowLines?.end : undefined}
    style:grid-column-start={subgrid !== undefined ? colLines?.start : undefined}
    style:grid-column-end={subgrid !== undefined ? colLines?.end : undefined}
    style:grid-template-columns={subgrid === 1 ? 'subgrid' : undefined}
    style:grid-template-rows={subgrid === 0 ? 'subgrid' : undefined}
    style:column-gap={subgrid === 1 ? `${gap}em` : undefined}
    style:row-gap={subgrid === 0 ? `${gap}em` : undefined}
    style:align-items={subgrid !== undefined || holdsOne ? alignment : undefined}
    style:justify-items={subgrid !== undefined || holdsOne ? alignment : undefined}
  >
    {#if subgrid !== undefined}
      <!-- A subgrid's items are its grid's cells, placed on its tracks (see subgrid). -->
      {@render contents()}
    {:else if free}
      <Arranged
        {flow}
        form={look('form') as Form | undefined}
        direction={look('direction') as Direction | undefined}
        curve={look('curve') as 'straight' | 'curved' | undefined}
        layoutSeed={look('layoutSeed') as number | undefined}
        kind={__over?.kind ?? __view}
        {gap}
        scope={id ?? 'node'}
      >
        {@render contents()}
      </Arranged>
    {:else if arrangement === 'grid'}
      <!-- data-sv-grid names the grid whose tracks the page keeps (see model/reserve.ts); align
             places each cell in its column and row, and justify spreads the columns. -->
      <div
        class="sv-grid"
        data-sv-grid={gridKey}
        data-sv-extent={__extent?.map((every) => every?.join(' ') ?? '').join(',')}
        style:gap={`${gap}em`}
        style:align-items={alignment}
        style:justify-items={alignment}
        style:justify-content={justification}
        style:grid-template-columns={basis ? undefined : trackCss(tracks?.columns)}
        style:grid-template-rows={basis ? undefined : trackCss(tracks?.rows)}
        data-sv-overlaid={overlaid ? '' : undefined}
        style:position={overlaid || basis ? 'relative' : undefined}
        style:width={basisBox?.width}
        style:height={basisBox?.height}
      >
        {@render contents()}
        {#if overlaid}
          <LinkOverlay />
        {/if}
      </div>
    {:else if arrangement === 'stack'}
      <!-- A stack holds its children in one place, later ones on top, each as large as the largest. -->
      <div class="sv-stack">
        {@render contents()}
      </div>
    {:else if arrangement}
      <!-- data-sv-collection marks the items of one collection, so the page gives them all the
             largest size any of them reaches (see model/reserve.ts) and they line up;
             data-sv-overlaid, a row or column whose links are drawn over it (see LinkOverlay). -->
      <div
        class="items {arrangement}"
        class:uniform={collection && !packs}
        data-sv-collection={collection ? id : undefined}
        data-sv-overlaid={overlaid ? '' : undefined}
        style:gap={`${gap}em`}
        style:align-items={arrangement === 'column' ? 'center' : alignment}
        style:justify-items={arrangement === 'column'
          ? collection && packs
            ? 'center'
            : alignment
          : collection
            ? 'center'
            : undefined}
        style:justify-content={justification}
        style:width={collection && arrangement === 'row' && (packed || (packs && packRoom))
          ? 'max-content'
          : undefined}
        style:margin-inline-start={collection && arrangement === 'row' && roomAt !== 'flex-start'
          ? 'auto'
          : undefined}
        style:margin-inline-end={collection && arrangement === 'row' && roomAt !== 'flex-end'
          ? 'auto'
          : undefined}
        style:position={overlaid ? 'relative' : undefined}
      >
        {@render contents()}
        {#each { length: spares } as _, index (index)}
          <div class="spare" aria-hidden="true"></div>
        {/each}
        {#if overlaid}
          <LinkOverlay />
        {/if}
      </div>
    {:else if __math}
      <!-- MathJax's SVG, built on the server and checked to hold only shapes (see maths-svg.server.ts). -->
      <!-- eslint-disable svelte/no-at-html-tags -->
      <span class="math" role="img" aria-label={__mathText} data-sv-math-text={__mathText}
        >{@html __math}</span
      >
      <!-- eslint-enable svelte/no-at-html-tags -->
    {:else if children}
      <!-- Words, with any views set in their line, are one box in the cell, as a value is. -->
      <div
        class="words"
        class:text={__text}
        data-sv-words={id}
        style:min-width={wordsKept ? `${wordsKept.width}px` : undefined}
        style:min-height={wordsKept ? `${wordsKept.height}px` : undefined}
      >
        {#if icon}<span class="icon" aria-hidden="true">{icon}&nbsp;</span>{/if}{@render children()}
      </div>
    {:else if value !== undefined}
      <!-- ∅ shows a value that is not there yet, such as a variable read before its declaration. -->
      {#if icon}<span class="icon" aria-hidden="true">{icon}&nbsp;</span>{/if}<span
        class="value"
        style:text-decoration-line={decoration}
        >{printed}{#if unit}<span class="unit">{unit}</span>{/if}</span
      >
    {:else if icon}
      <span class="icon" aria-hidden="true">{icon}</span>
    {/if}
    <!-- A node with no value, items, or children is a shape alone, such as a dot. -->
  </div>
{/snippet}

{#snippet drawn()}
  {#if eachItem && eachItem.index === 0 && inSequence && itemEnds.before.length}
    {#each itemEnds.before as end (end)}
      <ItemEnd collection={eachItem.collection} position={end} draw={itemCopy} />
    {/each}
  {/if}
  {#if atEnd !== undefined}
    {#if pointers.length}
      <Pointing {pointers} position={atEnd} name={slot ?? ''} draw={pointed} placeholder />
    {/if}
  {:else if pointers.length}
    {#if position === 0 && inSequence && before.length}
      {#each before as end (end)}
        <Pointing {pointers} position={end} name={slot ?? ''} draw={pointed} placeholder />
      {/each}
    {/if}
    <Pointing {pointers} {position} name={slot ?? ''} draw={pointed} />
    {#if position === length - 1 && inSequence && after.length}
      {#each after as end (end)}
        <Pointing {pointers} position={end} name={slot ?? ''} draw={pointed} placeholder />
      {/each}
    {/if}
  {:else if slotWidth || slotHeight || reaches}
    <!-- A box of its own size in the slot that keeps the largest it reaches (see varies), with room
      round it for the paint it reaches past it with (see reach). -->
    <div
      class="sv-room"
      data-sv-scale={scaleRoom}
      style:padding={reachPadding}
      style:justify-content={xAnchor}
      style:align-items={yAnchor}
      style:min-width={slotWidth ? leastOf(undefined, reserved?.width) : undefined}
      style:min-height={slotHeight ? leastOf(undefined, reserved?.height) : undefined}
    >
      {@render nodeBox()}
    </div>
  {:else}
    {@render nodeBox()}
  {/if}
  {#if eachItem && eachItem.index === itemLength - 1 && inSequence && itemEnds.after.length}
    {#each itemEnds.after as end (end)}
      <ItemEnd collection={eachItem.collection} position={end} draw={itemCopy} />
    {/each}
  {/if}
{/snippet}

{#if !shownHere}
  <!-- Left out of this presentation: drawn nowhere, keeping no room. -->
{:else if subgrid !== undefined}
  <!-- A subgrid is a cell of its grid itself, a band behind its items. -->
  {@render nodeBox()}
{:else if cellAttributes}
  <!-- A grid's child, in the cell its row and col place it in, over its spans; or a subgrid's. -->
  <div
    class="sv-cell"
    data-sv-row={cellAttributes.row}
    data-sv-col={cellAttributes.col}
    data-sv-row-span={cellAttributes.rowSpan}
    data-sv-col-span={cellAttributes.colSpan}
    data-sv-warning={warning}
    style:grid-row-start={basisPlace ? undefined : rowLines?.start}
    style:grid-row-end={basisPlace ? undefined : rowLines?.end}
    style:grid-column-start={basisPlace ? undefined : colLines?.start}
    style:grid-column-end={basisPlace ? undefined : colLines?.end}
    style:position={basisPlace ? 'absolute' : undefined}
    style:left={basisPlace?.left}
    style:top={basisPlace?.top}
    style:width={basisPlace?.width}
    style:height={basisPlace?.height}
    style:align-items={basisPlace ? 'center' : undefined}
    style:justify-content={basisPlace ? 'center' : undefined}
  >
    {@render drawn()}
  </div>
{:else}
  {@render drawn()}
{/if}

<style>
  .sv-node {
    box-sizing: border-box;
    border-style: solid;
    line-height: 1.5;
  }
  .cell {
    display: grid;
    place-items: center;
  }
  /*
    Text written around views: the views sit in the line like words, centred on it, each its own
    size, and the line wraps between them.
  */
  .text > :global(.sv-node) {
    display: inline-grid;
    place-items: center;
    vertical-align: middle;
  }
  /*
    Inline maths sits on the text's baseline, as a word does, its SVG raised or lowered by its own
    vertical-align, the baseline MathJax gave it.
  */
  .text > :global(.sv-node.math) {
    display: inline;
    vertical-align: baseline;
  }
  /* A view with room round it for its paint sits in the line as the view alone would. */
  .text > :global(.sv-room) {
    display: inline-flex;
    vertical-align: middle;
  }
  .sv-room {
    display: flex;
  }
  .value {
    white-space: nowrap;
  }
  .unit {
    margin-left: 0.2em;
    color: var(--sv-muted);
    font-size: 0.6em;
    font-weight: 400;
    /* A unit keeps its own case, as ms or MB. */
    text-transform: none;
    font-variant-caps: normal;
  }
  /*
    A row or column is a grid of one row or one column, each child a track as large as itself, in
    order, an end slot a track before the first or after the last like the rest.
  */
  .items {
    display: grid;
  }
  .row {
    grid-auto-flow: column;
    grid-auto-columns: max-content;
  }
  .column {
    grid-auto-flow: row;
    grid-auto-rows: max-content;
  }
  /*
    A grid places each cell by its row and col, each column as wide as its widest cell and each row
    as tall as its tallest; a cell holds its node at the node's own size.
  */
  .sv-grid {
    display: grid;
    grid-auto-columns: max-content;
    grid-auto-rows: max-content;
  }
  .sv-cell {
    display: flex;
  }
  /*
    A subgrid takes its grid's tracks along one axis (see subgrid); its other axis is one track, as
    large as its largest item.
  */
  .sv-subgrid {
    display: grid;
    grid-auto-columns: max-content;
    grid-auto-rows: max-content;
  }
  /*
    A stack is one cell every child is placed in, as large as its largest child in each direction;
    each child stretches to fill it, so a lower child's fill shows behind a later one's text.
  */
  .sv-stack {
    display: grid;
    grid-auto-columns: max-content;
    grid-auto-rows: max-content;
  }
  .sv-stack > :global(*) {
    grid-row-start: 1;
    grid-column-start: 1;
  }
  /*
    A collection's items sit on equal tracks, each as large as the largest item, so the items of a
    sequence are evenly spaced however their labels differ; each item keeps its own size, centred
    in its track along the layout direction.
  */
  .uniform.row {
    grid-auto-columns: 1fr;
  }
  .uniform.column {
    grid-auto-rows: 1fr;
  }
</style>
