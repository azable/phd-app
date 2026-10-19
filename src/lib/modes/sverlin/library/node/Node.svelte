<!--
  One node of a visualization: a primitive `value`, children content, or, with `items`, a
  collection. A layout arranges a collection's items, and arranges children too when one is set,
  so annotations such as an index or a pointer are simply nodes beside a value. A shape only picks
  which of the presentation's drawn looks a node takes; every visual property is also a prop of its own.
-->
<script lang="ts" generics="T">
  import { untrack, type Snippet } from 'svelte';

  import Arranged from './Arranged.svelte';
  import type { Template } from './arrange';
  import type { Form } from './forms';
  import Node from './Node.svelte';
  import Pointing from './Pointing.svelte';
  import Slot from './Slot.svelte';
  import {
    defaultsContext,
    elementOf,
    hiddenContext,
    insideComponentBox,
    keyedRef,
    markRendering,
    layoutMemoryContext,
    nodeIdsContext,
    elementSlot,
    pointersContext,
    provideComponentBox,
    provideSequence,
    sequenceContext,
    rendererFor,
    slotContext,
    typeContext,
    wrappedContext
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
    NodeProps,
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
    items,
    layout,
    columns,
    nested = 'row',
    item,
    type,
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
    __slot
  }: {
    /** A primitive to display, when the node has neither items nor children. */
    value?: Primitive;
    /** Child values, which make this node a collection. */
    items?: readonly T[];
    /** How items (default 'row') or, when set, children are arranged. */
    layout?: Layout;
    /** Grid columns; defaults to a near-square grid. */
    columns?: number;
    /** Layout for items that are themselves arrays, when no item snippet is given. */
    nested?: Layout;
    /** Renders each item of a collection from its value, index, and atomic type name, if typed. */
    item?: Snippet<[T, number, string | undefined]>;
    /** An atomic type name, such as 'Int'; its renderer snippet, if the view defines one, draws the value. */
    type?: string;
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
    /** Internal: an id given by the node this one stands for, such as a collection or a renderer's caller. */
    __id?: string;
    /** Internal: the type of the node a renderer draws. */
    __type?: string;
    /** Internal: set by the compiler when <Link> components sit among this node's children. */
    __links?: boolean;
    /** Internal: set by the compiler on a typed component's root, naming the component. */
    __component?: string;
    /** Internal: the element of the state this node draws, such as values[2], given by its collection or a renderer's caller. */
    __slot?: string;
  } = $props();

  const types = typeContext();
  // The presentation's drawn defaults fill in whatever this node's own props leave unset.
  const drawn = defaultsContext();
  // The id a participant's selection refers to this node by (see provideNodeIds).
  const nodeIds = nodeIdsContext();
  const id = untrack(() => __id ?? (__ref ? nodeIds?.claim(keyedRef(__ref, key)) : undefined));
  // The element of the state this node draws: a collection's item, or a component's root, which
  // draws the element its call was given (see Slot.svelte).
  const slot = untrack(() => __slot ?? (__component ? slotContext() : undefined));
  // A typed value node draws through its type's renderer, if the view defines one. Resolved once:
  // each step mounts afresh, and the renderer is marked so nodes inside it never call it again.
  const rendered = untrack(() =>
    type !== undefined && items === undefined && children === undefined
      ? rendererFor(type)
      : undefined
  );
  // The root's pointers into the collection whose element this node draws, outermost (written
  // last) first: the node is then drawn inside them (see Pointing.svelte), once, however many nodes
  // inside also draw the element. A node drawn by its type's renderer leaves it to the renderer's node.
  const element = untrack(() => elementSlot(slot));
  const pointers = untrack(() =>
    !rendered && element && wrappedContext() !== slot
      ? pointersContext()
          .filter((pointer) => pointer.collection === element.collection)
          .toSorted((a, b) => b.order - a.order)
      : []
  );
  const position = element?.index ?? -1;
  const length = untrack(() => (element ? (types?.lengthOf(element.collection) ?? 0) : 0));
  // The value this node draws keeps its identity across steps, so it can be followed as it moves.
  const identity = untrack(() => (slot === undefined ? undefined : types?.identityOf(slot)));
  // The end slots, as far past each end as the farthest-reaching pointer goes.
  const reach = Math.max(0, ...pointers.map((pointer) => pointer.reach));
  const before = Array.from({ length: reach }, (_, place) => place - reach);
  const after = Array.from({ length: reach }, (_, place) => length + place);
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
  if (rendered) markRendering(rendered.name);
  // Only the props the caller set, so a renderer can spread them over its own defaults.
  const callerProps = $derived(
    Object.fromEntries(
      Object.entries({
        shape,
        fill,
        stroke,
        opacity,
        color,
        font,
        size,
        weight,
        padding,
        radius,
        strokeWidth,
        minSize,
        // Links and relations name the renderer's node by this node's key.
        key,
        // A renderer's node takes this node's identity, type, and element, so a selection names the value.
        __id: id,
        __type: type,
        __slot: slot
      }).filter(([, setting]) => setting !== undefined)
    ) as NodeProps
  );
  const unit = $derived(type ? types?.unit(type) : undefined);
  // Every prop as given, to draw this node again inside its pointers.
  const given = $derived({
    value,
    items,
    layout,
    columns,
    nested,
    item,
    type,
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
    __component
  });

  const collection = $derived(items !== undefined);
  const resolvedShape = $derived(
    shape ?? (collection ? drawn.collection.shape : children ? 'plain' : 'box')
  );
  // Links need positions to join, so a node with links and no layout is laid out freely.
  const arrangement = $derived(layout ?? (collection ? 'row' : __links ? 'free' : undefined));
  untrack(() => {
    if (arrangement) provideSequence(arrangement !== 'free');
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
  const gridColumns = $derived(
    columns ?? Math.max(1, Math.ceil(Math.sqrt(items?.length ?? (arrangement === 'grid' ? 4 : 1))))
  );
  const resolvedAlign = $derived(
    align ?? (arrangement === 'column' ? drawn.align.column : drawn.align.row)
  );
  const alignment = $derived(alignments[resolvedAlign]);
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
  {#if collection}
    {#each items ?? [] as child, index (index)}
      {#if item}
        <Slot of={items} at={index}
          >{@render item(child, index, types?.itemType(items, index))}</Slot
        >
      {:else if Array.isArray(child)}
        <Node
          items={child}
          layout={nested}
          shape="plain"
          __id={id && `${id}/${index}`}
          __slot={elementOf(types, items, index)}
        />
      {:else}
        <Node
          value={child !== null && typeof child === 'object'
            ? JSON.stringify(child)
            : (child as Primitive)}
          type={types?.itemType(items, index)}
          __id={id && `${id}/${index}`}
          __slot={elementOf(types, items, index)}
        />
      {/if}
    {/each}
  {:else}
    {@render children?.()}
  {/if}
{/snippet}

{#snippet pointed(props: Record<string, unknown>)}
  <Node {...given} __id={id} __slot={slot} {...props} />
{/snippet}

{#if pointers.length}
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
{:else if rendered}
  <Slot path={slot}>{@render rendered.snippet(value ?? null, callerProps)}</Slot>
{:else}
  <div
    class="sv-node {font ?? ''}"
    data-sv-node={id}
    data-sv-key={key}
    data-sv-component={__component}
    data-sv-slot={slot}
    data-sv-identity={identity}
    data-sv-hidden={hidden === undefined ? undefined : String(hidden)}
    data-sv-type={type ?? __type}
    data-sv-shape={resolvedShape}
    data-sv-layout={arrangement}
    data-sv-fill={paletteName(fill)}
    data-sv-stroke={paletteName(stroke)}
    data-sv-color={paletteName(color)}
    class:cell={!arrangement && resolvedShape === 'box'}
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
        style:--sv-columns={gridColumns}
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
  .grid {
    display: grid;
    grid-template-columns: repeat(var(--sv-columns), max-content);
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
  .uniform.grid {
    grid-template-columns: repeat(var(--sv-columns), 1fr);
    grid-auto-rows: 1fr;
  }
</style>
