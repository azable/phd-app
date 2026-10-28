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
  import type { Form } from './forms';
  import Node from './Node.svelte';
  import ItemEnd from './ItemEnd.svelte';
  import Overhang from './Overhang.svelte';
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
    leftOutContext,
    layoutMemoryContext,
    nodeIdsContext,
    overhangContext,
    provideOverhang,
    elementSlot,
    pointerAroundContext,
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
    collectionLayoutContext,
    sequenceContext,
    slotContext,
    provideDrawn,
    typeContext,
    wrappedContext,
    type Pointer
  } from '../type-context';
  import { colourCss, lookUp, paintProps, placedKind, strokeStyleCss } from './design';
  import { alignments, justifications } from './scales';
  import type { Align, Justify, Layout, Primitive } from './props';

  let {
    value,
    layout,
    children,
    flow,
    __view = 'root',
    __over,
    __ref,
    __id,
    __type,
    __links,
    __field = false,
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
    children?: Snippet;
    /** In a free layout, the axis arrows point along: 'x' (rightwards) or 'y' (downwards). */
    flow?: 'x' | 'y';
    /** Internal: the snippet this node is in, by its path, which is its kind; added by the compiler. */
    __view?: string;
    /**
     * Internal: the kind of the pointer drawing this node again, and whether it is at it: its paint
     * shows only where it is, and its other props hold in every slot, so slots keep one size.
     */
    __over?: { kind: string; active: boolean; placed?: string };
    /** Internal: the source position of this node's tag, added by the compiler. */
    __ref?: string;
    /** Internal: an id given by the node this one stands for, such as the node a pointer draws again. */
    __id?: string;
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
  } = $props();

  const types = typeContext();
  // This node's look: the variant's values for its kind, or for a pointer drawing it again.
  const design = designContext();
  // A pointer drawing this node again gives its paint where it is, and its other props everywhere;
  // a render at a place gives its own where the variant sets them (see placedKind).
  const placed = untrack(() => placedKind(placeContext(), __view));
  const look = (prop: string): unknown => {
    const over = __over && (__over.active || !paintProps.has(prop)) ? __over : undefined;
    return over
      ? lookUp(design, over.kind, over.placed, prop)
      : lookUp(design, __view, placed, prop);
  };
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
  // The value this node draws keeps its identity across steps, so it can be followed as it moves;
  // the outermost node a pointer's view draws where the pointer is takes the pointer's.
  const pointerIdentity = pointerIdentityContext();
  if (pointerIdentity) providePointerIdentity(undefined);
  // The element the outermost node of a pointer's view is drawn around, active or not.
  const drawnAround = pointerAroundContext();
  if (drawnAround) providePointerAround(undefined);
  const identity = untrack(() =>
    slot === undefined ? pointerIdentity : endSlot ? undefined : types?.identityOf(slot)
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
  // Where the collection this node is an item or element of hangs its end slots, if outside it.
  const overhang = overhangContext();
  // Nodes a pointer draws where it is not keep their room, hidden, and the element inside shows.
  // Hidden at this step with every render it holds, keeping its room, its children with it.
  const hiddenHere = untrack(
    () => __ref !== undefined && (hiddenSitesContext()?.has(__ref) ?? false)
  );
  if (hiddenHere) provideHidden(true);
  const hidden = hiddenHere ? true : hiddenContext();
  // Left out of the presentation, as its kind's shown false leaves it out (see left-out.ts).
  const leftOut = untrack(() => __ref !== undefined && (leftOutContext()?.has(__ref) ?? false));
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
    children,
    flow,
    __view,
    __ref,
    __type,
    __links,
    __component,
    __items
  });

  const collection = $derived(__items !== undefined);
  // A collection runs as a row, or across the collection around it, as rows in a column do. A
  // node joining links states its layout (the compiler refuses one that does not).
  const around = collectionLayoutContext();
  const collectionLayout = $derived(
    around === 'row' ? 'column' : around === 'column' ? 'row' : 'row'
  );
  const arrangement = $derived(layout ?? (collection ? collectionLayout : undefined));
  untrack(() => {
    if (arrangement) provideSequence(arrangement !== 'free');
    if (collection) provideCollectionLayout(arrangement);
  });
  const measured = (prop: string, unit: string) => {
    const setting = look(prop);
    return typeof setting === 'number' ? `${setting}${unit}` : undefined;
  };
  const strokeColour = $derived(colourCss(look('stroke')));
  const borderWidth = $derived(
    strokeColour && typeof look('strokeWidth') === 'number' ? (look('strokeWidth') as number) : 0
  );
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
  // A collection whose overflow is excluded hangs its end slots outside its box (see Overhang).
  const excluded = $derived(collection && look('overflow') === 'excluded');
  untrack(() => {
    if (collection)
      provideOverhang(
        excluded && (arrangement === 'row' || arrangement === 'column')
          ? { layout: arrangement, gap }
          : undefined
      );
  });
  // Free layouts are placed by constraint layout (see Arranged); rows and columns are CSS flex and
  // grid, and their links never move their children: they are drawn over them (see LinkOverlay).
  const free = $derived(arrangement === 'free');
  const overlaid = $derived(
    __links && (arrangement === 'row' || arrangement === 'column') ? arrangement : undefined
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

{#if look('shown') === false || leftOut}
  <!-- Left out of this presentation: drawn nowhere, keeping no room. -->
{:else}
  {#if eachItem && eachItem.index === 0 && inSequence && itemEnds.before.length}
    <Overhang {overhang} side="before">
      {#each itemEnds.before as end (end)}
        <ItemEnd collection={eachItem.collection} position={end} draw={itemCopy} />
      {/each}
    </Overhang>
  {/if}
  {#if atEnd !== undefined}
    {#if pointers.length}
      <Pointing {pointers} position={atEnd} name={slot ?? ''} draw={pointed} placeholder />
    {/if}
  {:else if pointers.length}
    {#if position === 0 && inSequence && before.length}
      <Overhang {overhang} side="before">
        {#each before as end (end)}
          <Pointing {pointers} position={end} name={slot ?? ''} draw={pointed} placeholder />
        {/each}
      </Overhang>
    {/if}
    <Pointing {pointers} {position} name={slot ?? ''} draw={pointed} />
    {#if position === length - 1 && inSequence && after.length}
      <Overhang {overhang} side="after">
        {#each after as end (end)}
          <Pointing {pointers} position={end} name={slot ?? ''} draw={pointed} placeholder />
        {/each}
      </Overhang>
    {/if}
  {:else}
    <div
      class="sv-node {typeof font === 'string' ? font : ''}"
      data-sv-node={id}
      data-sv-kind={__over?.active ? __over.kind : __view}
      data-sv-component={__component}
      data-sv-slot={slot}
      data-sv-identity={identity}
      data-sv-around={drawnAround}
      data-sv-item={eachItem ? `${eachItem.collection}[${eachItem.index}]` : undefined}
      data-sv-hidden={hidden === undefined ? undefined : String(hidden)}
      data-sv-type={__type}
      data-sv-layout={arrangement}
      data-sv-fill={look('fill')}
      data-sv-stroke={look('stroke')}
      data-sv-color={look('color')}
      class:cell={(!arrangement && !children && !__text) || __field}
      class:text={__text}
      style:font-size={measured('size', 'rem')}
      style:font-weight={weight === 'bold' ? 700 : weight === 'normal' ? 400 : undefined}
      style:color={colourCss(look('color'))}
      style:background-color={colourCss(look('fill'))}
      style:border-color={strokeColour}
      style:border-style={strokeStyleCss(look('strokeStyle'))}
      style:border-width={`${borderWidth}px`}
      style:border-radius={measured('radius', 'px')}
      style:padding={measured('padding', 'em')}
      style:min-width={least(measured('minSize', 'em'), reserved?.width)}
      style:min-height={least(measured('minSize', 'em'), reserved?.height)}
      style:opacity={look('opacity') as number | undefined}
    >
      {#if free}
        <Arranged
          {flow}
          form={look('form') as Form | undefined}
          curve={look('curve') as 'straight' | 'curved' | undefined}
          layoutSeed={look('layoutSeed') as number | undefined}
          kind={__over?.kind ?? __view}
          {gap}
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
          style:gap={`${gap}em`}
          style:align-items={collection && arrangement === 'column' ? 'center' : alignment}
          style:justify-items={collection
            ? arrangement === 'column'
              ? alignment
              : 'center'
            : undefined}
          style:justify-content={justification}
          style:width={collection && arrangement === 'row' && packed ? 'max-content' : undefined}
          style:margin-inline-start={collection && arrangement === 'row' && justify !== 'start'
            ? 'auto'
            : undefined}
          style:margin-inline-end={collection && arrangement === 'row' && justify !== 'end'
            ? 'auto'
            : undefined}
          style:position={excluded || overlaid ? 'relative' : undefined}
        >
          {@render contents()}
          {#if overlaid}
            <LinkOverlay axis={overlaid} />
          {/if}
        </div>
      {:else if children}
        {@render children()}
      {:else if value !== undefined}
        <!-- ∅ shows a value that is not there yet, such as a variable read before its declaration. -->
        <span class="value"
          >{value === null ? '∅' : String(value)}{#if unit}<span class="unit">{unit}</span
            >{/if}</span
        >
      {/if}
      <!-- A node with no value, items, or children is a shape alone, such as a dot or a bar. -->
    </div>
  {/if}
  {#if eachItem && eachItem.index === itemLength - 1 && inSequence && itemEnds.after.length}
    <Overhang {overhang} side="after">
      {#each itemEnds.after as end (end)}
        <ItemEnd collection={eachItem.collection} position={end} draw={itemCopy} />
      {/each}
    </Overhang>
  {/if}
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
