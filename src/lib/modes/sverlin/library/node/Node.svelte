<!--
  One node of a visualization: a primitive `value`, or children content, which makes it a
  collection when it is one {#each} over a collection. A layout arranges its children, so
  annotations such as an index or a pointer are simply nodes beside a value. A shape only picks
  which of the presentation's drawn looks a node takes; every visual property is also a prop of its own.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import Arranged from './Arranged.svelte';
  import type { Template } from './arrange';
  import type { Form } from './forms';
  import Node from './Node.svelte';
  import ItemEnd from './ItemEnd.svelte';
  import Pointing from './Pointing.svelte';
  import {
    defaultsContext,
    copyContext,
    elementOf,
    endSlotContext,
    itemEndsContext,
    provideItemEnds,
    hiddenContext,
    insideComponentBox,
    keyedRef,
    layoutMemoryContext,
    nodeIdsContext,
    elementSlot,
    pointerIdentityContext,
    pointersContext,
    pointsInto,
    reachesInto,
    provideComponentBox,
    providePointerIdentity,
    provideCollectionLayout,
    provideSequence,
    collectionLayoutContext,
    sequenceContext,
    slotContext,
    typeContext,
    wrappedContext,
    type Pointer
  } from '../type-context';
  import { paletteColor, paletteName } from './palette';
  import {
    alignments,
    justifications,
    measure,
    minSizes,
    namedSizes,
    radii,
    spacings,
    strokeWidths
  } from './scales';
  import type {
    Align,
    Justify,
    Layout,
    MinSize,
    NodeColor,
    NodeFont,
    NodeShape,
    NodeSize,
    NodeStroke,
    Primitive,
    Radius,
    ShapeDefaults,
    Spacing,
    StrokeWidth,
    Weight
  } from './props';

  let {
    value,
    layout,
    shape,
    fill,
    stroke,
    opacity,
    color,
    font,
    size,
    weight,
    padding,
    gap,
    align,
    justify,
    radius,
    strokeWidth,
    minSize,
    children,
    key,
    constraints,
    flow,
    form,
    curve,
    layoutSeed,
    __ref,
    __id,
    __type,
    __links,
    __component,
    __slot,
    __text = false,
    __itemOf,
    __itemAt,
    __items
  }: {
    /** A primitive to display, when the node has no children. */
    value?: Primitive;
    /** How children are arranged; a collection's items default to a row. */
    layout?: Layout;
    /** Which drawn look: 'box' for a value, 'plain' for content and collections, unless given. */
    shape?: NodeShape;
    /** Background colour: a palette name such as 'amber' (a light shade), or any CSS colour. */
    fill?: NodeColor;
    /** Stroke colour: a palette name (a strong shade), any CSS colour, or 'none' or false for no stroke. */
    stroke?: NodeStroke;
    /** From 0 (invisible) to 1 (default). */
    opacity?: number;
    /** Text colour: a palette name ('neutral' is muted), or any CSS colour. */
    color?: NodeColor;
    /** Font family; nested nodes inherit it unless they set their own. */
    font?: NodeFont;
    /** A named size, or a size in rem such as 1.2; nested nodes inherit it. */
    size?: NodeSize | number;
    weight?: Weight;
    /** Space inside the frame: a named spacing, or a number of em. */
    padding?: Spacing;
    /** Space between arranged items or children. */
    gap?: Spacing;
    /** How arranged items line up across the layout direction. */
    align?: Align;
    /** How arranged items spread along the layout direction. */
    justify?: Justify;
    radius?: Radius;
    /** Stroke width: 'none', 'thin', 'thick', or a number of pixels. */
    strokeWidth?: StrokeWidth;
    /** The smallest width and height. */
    minSize?: MinSize;
    children?: Snippet;
    /** A name its parent's links and relations refer to this node by. */
    key?: string;
    /** Relations between children by key: above, below, leftOf, rightOf, sameRow, sameColumn. */
    constraints?: readonly string[];
    /** In a free layout, the axis arrows point along: 'x' (rightwards) or 'y' (downwards). */
    flow?: 'x' | 'y';
    /**
     * In a free layout, the form its linked structure takes: in sequence ('line', 'snake', 'wave',
     * 'arc', 'scatter'), as a 'ring', as a tree ('tree-down', 'tree-right', 'radial', 'indented'), or in
     * layers ('layers-down', 'layers-right'), as the structure allows. Unset, each presentation draws
     * one that suits the space.
     */
    form?: Form;
    /** In a free layout, whether arrows prefer to run straight or to curve; unset, each presentation draws it. */
    curve?: 'straight' | 'curved';
    /**
     * Keeps this node's layout of its children the same in every presentation: its shape, spacing,
     * and curves come from this seed instead of the presentation's. Selections report the seed a
     * layout used, so a layout the participant liked can be kept while everything else varies.
     */
    layoutSeed?: number;
    /** Internal: the source position of this node's tag, added by the compiler. */
    __ref?: string;
    /** Internal: an id given by the node this one stands for, such as the node a pointer draws again. */
    __id?: string;
    /** Internal: set by the compiler on a node showing its view's own value: that value's type, which gives its unit. */
    __type?: string;
    /** Internal: set by the compiler when <Link> components sit among this node's children. */
    __links?: boolean;
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
  } = $props();

  const types = typeContext();
  // The presentation's drawn defaults fill in whatever this node's own props leave unset.
  const drawn = defaultsContext();
  // The id a participant's selection refers to this node by (see provideNodeIds).
  const nodeIds = nodeIdsContext();
  const endSlot = endSlotContext();
  const id = untrack(() =>
    endSlot ? undefined : (__id ?? (__ref ? nodeIds?.claim(keyedRef(__ref, key)) : undefined))
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
  // The value this node draws keeps its identity across steps, so it can be followed as it moves;
  // the outermost node a pointer's view draws where the pointer is takes the pointer's.
  const pointerIdentity = pointerIdentityContext();
  if (pointerIdentity) providePointerIdentity(undefined);
  const identity = untrack(() =>
    slot === undefined ? pointerIdentity : endSlot ? undefined : types?.identityOf(slot)
  );
  // The end slots, as far past each end as any step puts one of the pointers' positions: none
  // where the trace never goes past.
  const endsOf = (into: readonly Pointer[], count: number) => {
    const ends = into.map((pointer) => types?.pastEnds(pointer.collection));
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
  const itemEnds = untrack(() => endsOf(itemPointers, itemLength));
  const { before, after } = untrack(() =>
    endsOf(itemEndsContext() === element?.collection ? [] : pointers, length)
  );
  // Inside an item's copy at an end slot, the element draws only the pointers there.
  const atEnd =
    endSlot && element?.collection === endSlot.collection ? endSlot.position : undefined;
  // End slots belong in a sequence; in a free layout, such as a graph, they would be loose boxes.
  const inSequence = sequenceContext() !== false;
  // Nodes a pointer draws where it is not keep their room, hidden, and the element inside shows.
  const hidden = hiddenContext();
  // A node keeps a least size so that changing content never moves anything around it. A typed
  // component's root keeps the largest box the component reaches for any of its inputs (see
  // assembly/entry.ts), and the nodes inside it keep their natural sizes, since that box already
  // holds every way they can be drawn; any other node keeps the largest size it reaches at any step
  // (see LayoutMemory).
  const memory = layoutMemoryContext();
  const box = untrack(() =>
    !pointers.length && __component && memory && (!memory.measuring || memory.probing)
      ? memory.components.get(__component)
      : undefined
  );
  const insideBox = insideComponentBox();
  if (box) provideComponentBox();
  const reserved = untrack(() => {
    if (box) return box;
    if (!memory || memory.measuring || insideBox || !id) return undefined;
    return memory.reserved.get(id);
  });
  const least = (scale: string | undefined, pixels: number | undefined) =>
    pixels === undefined ? scale : scale ? `max(${scale}, ${pixels}px)` : `${pixels}px`;
  const unit = $derived(__type ? types?.unit(__type) : undefined);
  // Every prop as given, to draw this node again inside its pointers.
  const given = $derived({
    value,
    layout,
    shape,
    fill,
    stroke,
    opacity,
    color,
    font,
    size,
    weight,
    padding,
    gap,
    align,
    justify,
    radius,
    strokeWidth,
    minSize,
    children,
    key,
    constraints,
    flow,
    form,
    curve,
    layoutSeed,
    __ref,
    __type,
    __links,
    __component,
    __items
  });

  const collection = $derived(__items !== undefined);
  const resolvedShape = $derived(
    shape ?? (collection ? drawn.collection.shape : children ? 'plain' : 'box')
  );
  // A collection runs the way the presentation drew, or across the collection around it, as rows
  // in a column do. Links need positions to join, so a node with links and no layout is laid out
  // freely.
  const around = collectionLayoutContext();
  const collectionLayout = $derived(
    around === 'row' ? 'column' : around === 'column' ? 'row' : drawn.collection.layout
  );
  const arrangement = $derived(
    layout ?? (collection ? collectionLayout : __links ? 'free' : undefined)
  );
  untrack(() => {
    if (arrangement) provideSequence(arrangement !== 'free');
    if (collection) provideCollectionLayout(arrangement);
  });
  // A plain node has no drawn look: no border, padding, or fill unless its props give them.
  const look = $derived.by((): Partial<ShapeDefaults> => {
    if (resolvedShape === 'plain') return {};
    const base = drawn[resolvedShape];
    // A framed group keeps the frame but not a cell's text size or weight.
    return arrangement ? { ...base, scale: undefined, weight: undefined } : base;
  });
  const fontSize = $derived(
    typeof size === 'number' && Number.isFinite(size)
      ? `${Math.min(Math.max(size, 0.5), 4)}rem`
      : size !== undefined
        ? `${namedSizes[size as NodeSize] ?? 1}rem`
        : look.scale
          ? `${look.scale}em`
          : undefined
  );
  const resolvedWeight = $derived(weight ?? look.weight);
  // stroke="none" or false turns the stroke off whatever its width; otherwise the width
  // comes from the prop, then the drawn defaults.
  const strokeOff = $derived(stroke === 'none' || stroke === false);
  const strokeColour = $derived(
    strokeOff ? undefined : paletteColor((stroke as NodeColor | undefined) ?? look.stroke, 'stroke')
  );
  const resolvedStrokeWidth = $derived.by(() => {
    const width = strokeOff ? 'none' : (strokeWidth ?? look.strokeWidth ?? 'none');
    return typeof width === 'number'
      ? Number.isFinite(width)
        ? `${Math.min(Math.max(width, 0), 20)}px`
        : '0'
      : strokeWidths[width];
  });
  const resolvedAlign = $derived(
    align ?? (arrangement === 'column' ? drawn.align.column : drawn.align.row)
  );
  const alignment = $derived(alignments[resolvedAlign]);
  // The drawn defaults this node takes, by their path in the presentation's recorded defaults, so
  // the source editor can show them beside its tag. The page font is the frame's, not a node's.
  const takenDefaults = $derived(
    [
      shape === undefined && collection && 'collection.shape',
      layout === undefined &&
        collection &&
        around !== 'row' &&
        around !== 'column' &&
        'collection.layout',
      resolvedShape !== 'plain' && [
        radius === undefined && `${resolvedShape}.radius`,
        strokeWidth === undefined && !strokeOff && `${resolvedShape}.strokeWidth`,
        padding === undefined && `${resolvedShape}.padding`,
        fill === undefined && `${resolvedShape}.fill`,
        stroke === undefined && `${resolvedShape}.stroke`,
        size === undefined && look.scale !== undefined && `${resolvedShape}.scale`,
        weight === undefined && look.weight !== undefined && `${resolvedShape}.weight`
      ],
      arrangement &&
        arrangement !== 'free' &&
        align === undefined &&
        `align.${arrangement === 'column' ? 'column' : 'row'}`,
      arrangement && gap === undefined && 'gap'
    ]
      .flat()
      .filter(Boolean)
      .join(' ')
  );
  const justification = $derived(justifications[justify ?? 'start']);
  // Free layouts, and rows or columns with links or relations, are placed by constraint layout;
  // other arrangements are CSS flex and grid, which solve the same constraints in the browser.
  const solved = $derived<Template | undefined>(
    arrangement === 'free'
      ? 'free'
      : (arrangement === 'row' || arrangement === 'column') && (constraints?.length || __links)
        ? arrangement
        : undefined
  );
</script>

{#snippet contents()}
  {@render children?.()}
{/snippet}

{#snippet pointed(props: Record<string, unknown>)}
  <Node {...given} __id={id} __slot={slot} {...props} />
{/snippet}

{#snippet itemCopy()}
  <Node {...given} {__text} __ref={undefined} />
{/snippet}

{#if eachItem && eachItem.index === 0 && inSequence}
  {#each itemEnds.before as end (end)}
    <ItemEnd collection={eachItem.collection} position={end} draw={itemCopy} />
  {/each}
{/if}
{#if atEnd !== undefined}
  {#if pointers.length}
    <Pointing {pointers} position={atEnd} name={slot ?? ''} draw={pointed} placeholder />
  {/if}
{:else if pointers.length}
  {#if position === 0 && inSequence}
    {#each before as end (end)}
      <Pointing {pointers} position={end} name={slot ?? ''} draw={pointed} placeholder />
    {/each}
  {/if}
  <Pointing {pointers} {position} name={slot ?? ''} draw={pointed} />
  {#if position === length - 1 && inSequence}
    {#each after as end (end)}
      <Pointing {pointers} position={end} name={slot ?? ''} draw={pointed} placeholder />
    {/each}
  {/if}
{:else}
  <div
    class="sv-node {font ?? ''}"
    data-sv-node={id}
    data-sv-key={key}
    data-sv-component={__component}
    data-sv-slot={slot}
    data-sv-identity={identity}
    data-sv-hidden={hidden === undefined ? undefined : String(hidden)}
    data-sv-type={__type}
    data-sv-shape={resolvedShape}
    data-sv-layout={arrangement}
    data-sv-defaults={takenDefaults || undefined}
    data-sv-fill={paletteName(fill)}
    data-sv-stroke={paletteName(stroke)}
    data-sv-color={paletteName(color)}
    class:cell={!arrangement && resolvedShape === 'box' && !__text}
    class:text={__text}
    style:font-size={fontSize}
    style:font-weight={resolvedWeight === undefined
      ? undefined
      : resolvedWeight === 'bold'
        ? 700
        : 400}
    style:color={paletteColor(color, 'text')}
    style:background-color={paletteColor(fill ?? look.fill, 'fill')}
    style:border-color={strokeColour}
    style:border-width={resolvedStrokeWidth}
    style:border-radius={radii[radius ?? look.radius ?? 'none']}
    style:padding={measure(spacings, padding ?? look.padding)}
    style:min-width={least(measure(minSizes, minSize), reserved?.width)}
    style:min-height={least(measure(minSizes, minSize), reserved?.height)}
    style:opacity={typeof opacity === 'number' && Number.isFinite(opacity)
      ? Math.min(Math.max(opacity, 0), 1)
      : undefined}
  >
    {#if solved}
      <Arranged
        template={solved}
        align={resolvedAlign}
        {constraints}
        {flow}
        {form}
        {curve}
        {layoutSeed}
        gap={gap ?? drawn.gap}
        scope={id ?? 'node'}
      >
        {@render contents()}
      </Arranged>
    {:else if arrangement}
      <!-- data-sv-collection marks the items of one collection, so the page gives them all the
           largest size any of them reaches (see assembly/entry.ts) and they line up. -->
      <div
        class="items {arrangement}"
        class:uniform={collection}
        data-sv-collection={collection ? id : undefined}
        style:gap={measure(spacings, gap ?? drawn.gap)}
        style:align-items={collection && arrangement === 'column' ? 'center' : alignment}
        style:justify-items={collection
          ? arrangement === 'column'
            ? alignment
            : 'center'
          : undefined}
        style:justify-content={justification}
      >
        {@render contents()}
      </div>
    {:else if children}
      {@render children()}
    {:else if value !== undefined}
      <!-- ∅ shows a value that is not there yet, such as a variable read before its declaration. -->
      <span class="value"
        >{value === null ? '∅' : String(value)}{#if unit}<span class="unit">{unit}</span>{/if}</span
      >
    {/if}
    <!-- A node with no value, items, or children is a shape alone, such as a dot or a bar. -->
  </div>
{/if}
{#if eachItem && eachItem.index === itemLength - 1 && inSequence}
  {#each itemEnds.after as end (end)}
    <ItemEnd collection={eachItem.collection} position={end} draw={itemCopy} />
  {/each}
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
  .sans {
    font-family: system-ui, sans-serif;
  }
  .serif {
    font-family: ui-serif, Georgia, 'Times New Roman', serif;
  }
  .mono {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  }
  .value {
    white-space: nowrap;
  }
  .unit {
    margin-left: 0.2em;
    color: var(--sv-muted);
    font-size: 0.6em;
    font-weight: 400;
  }
  .items {
    display: flex;
  }
  .row {
    flex-direction: row;
  }
  .column {
    flex-direction: column;
  }
  /*
    A collection's items sit on equal tracks, each as large as the largest item, so the items of a
    sequence are evenly spaced however their labels differ; each item keeps its own size, centred
    in its track along the layout direction.
  */
  .uniform {
    display: grid;
  }
  .uniform.row {
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
  }
  .uniform.column {
    grid-auto-rows: 1fr;
  }
</style>
