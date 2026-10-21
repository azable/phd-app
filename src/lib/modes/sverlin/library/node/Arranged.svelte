<!--
  Places a node's children by constraint layout (see arrange.ts): it measures each child as laid out
  inside, solves for their positions, places them, and takes the size that hugs them, drawing any
  links as lines or arrows. A nested arrangement that settles later asks its parent to lay out
  again, so sizes flow up and the final layout uses every child's final size.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import {
    arrangementParentContext,
    layoutMemoryContext,
    provideArrangementParent,
    seedContext
  } from '../type-context';
  import {
    arrange,
    keyedRandom,
    layoutSeedFor,
    type Anchor,
    type ArrangeEdge,
    type LinkSpec,
    type Template
  } from './arrange';
  import type { Form } from './forms';
  import type { Align, Spacing } from './props';

  let {
    template,
    align,
    constraints = [],
    flow,
    form,
    curve,
    layoutSeed,
    gap,
    scope,
    children
  }: {
    template: Template;
    align?: Align;
    constraints?: readonly string[];
    flow?: 'x' | 'y';
    /** The form the linked structure takes; unset, the seed draws one. */
    form?: Form;
    curve?: 'straight' | 'curved';
    /**
     * A seed for this arrangement alone, so a layout a participant liked stays the same in every
     * presentation.
     */
    layoutSeed?: number;
    gap: Spacing;
    /** Keys this arrangement's random starts, such as the node's id. */
    scope: string;
    children?: Snippet;
  } = $props();

  /** How a link component is drawn: its kind's look, as CSS (see Link.svelte). */
  type LinkStyle = {
    dashed: boolean;
    label?: string;
    stroke?: string;
    strokeWidth?: string;
    labelColour?: string;
    opacity?: string;
    shown: boolean;
  };
  // A link drawn by no <Link>, as a relation's, is a fine muted line.
  const colourOf = (style?: LinkStyle) => style?.stroke ?? 'var(--sv-muted)';
  const widthOf = (style?: LinkStyle) => {
    const pixels = Number(style?.strokeWidth);
    return Number.isFinite(pixels) && style?.strokeWidth ? `${pixels}px` : '2px';
  };

  const seed = seedContext();
  const memory = layoutMemoryContext();
  // The seed this arrangement draws every choice from: its own pinned layoutSeed, or else one derived
  // from the presentation's seed and its place, so arrangements differ from each other. Selections
  // report it, and pinning it as layoutSeed reproduces the layout exactly, wherever the node moves.
  const drawSeed = $derived(layoutSeed ?? layoutSeedFor(seed, scope));

  // Node ids hold : and #, which an SVG fragment reference cannot. A fragment reference finds the
  // first element with its id in the page, and two steps' layers are in the page while one replaces
  // the other, so each arrangement's markers are named apart: otherwise arrows would take the other
  // layer's arrowheads, of other colours, until it is removed.
  const instance = $props.id();
  const markerId = $derived(`sv-arrow-${scope.replace(/[^\w-]/gu, '_')}-${instance}`);
  const parent = arrangementParentContext();
  let host = $state<HTMLDivElement>();
  let result = $state<{
    width: number;
    height: number;
    edges: ArrangeEdge[];
    choices: { form?: string; curve?: 'straight' | 'curved' };
    styles: Record<string, LinkStyle>;
  }>();
  // Bumped when a nested arrangement settles, to lay out again with its new size.
  let revision = $state(0);
  let pending = false;
  provideArrangementParent({
    changed() {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        revision++;
      });
    }
  });

  /**
   * The width to height of the space this arrangement has: the frame's inside, less what the other
   * top-level nodes take when the root is a column or row, so shapes fill what is left.
   */
  function spaceAspect(): number {
    const frame = host?.closest<HTMLElement>('.sv-frame');
    if (!frame || !host) return 16 / 9;
    const style = getComputedStyle(frame);
    let width = frame.clientWidth - parseFloat(style.paddingLeft) * 2;
    let height = frame.clientHeight - parseFloat(style.paddingTop) * 2;
    const flow = host.closest<HTMLElement>('.sv-flow');
    const top = flow
      ? [...flow.children].find((child) => child.contains(host as Element))
      : undefined;
    if (flow && top) {
      const others = [...flow.children].filter((child) => child !== top) as HTMLElement[];
      const gap = parseFloat(getComputedStyle(flow).rowGap) || 0;
      if (flow.style.flexDirection === 'row')
        width -= others.reduce((sum, child) => sum + child.offsetWidth + gap, 0);
      else height -= others.reduce((sum, child) => sum + child.offsetHeight + gap, 0);
    }
    return Math.max(width, 50) / Math.max(height, 50);
  }

  // Lay out again whenever a child's size changes: a page loaded while hidden measures every child
  // as empty, and children only take their sizes once it is shown.
  $effect(() => {
    if (!host) return;
    let queued = false;
    const observer = new ResizeObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        revision++;
      });
    });
    for (const child of host.children) observer.observe(child);
    return () => observer.disconnect();
  });

  $effect(() => {
    void revision;
    if (!host) return;
    // Link components sit among the children as hidden markers: they are links, not boxes.
    const markers = [...host.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.hasAttribute('data-sv-link')
    );
    const elements = [...host.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.hasAttribute('data-sv-link')
    );
    const specs: LinkSpec[] = markers.map(({ dataset }) => ({
      from: dataset.from ?? '',
      to: dataset.to ?? '',
      directed: dataset.directed !== 'false',
      ...(dataset.svLink ? { id: dataset.svLink } : {}),
      ...(dataset.curve === 'straight' || dataset.curve === 'curved'
        ? { curve: dataset.curve }
        : {}),
      ...(dataset.bend !== undefined && Number.isFinite(Number(dataset.bend))
        ? { bend: Number(dataset.bend) }
        : {})
    }));
    const styles: Record<string, LinkStyle> = Object.fromEntries(
      markers.flatMap(({ dataset }) =>
        dataset.svLink
          ? [
              [
                dataset.svLink,
                {
                  dashed: dataset.dashed === 'true',
                  label: dataset.label,
                  stroke: dataset.stroke,
                  strokeWidth: dataset.strokeWidth,
                  labelColour: dataset.labelColour,
                  opacity: dataset.opacity,
                  shown: dataset.shown !== 'false'
                }
              ]
            ]
          : []
      )
    );
    // Links this step draws, by their components' ids.
    const present = new Set(specs.map(({ id }) => id));
    const drawn = (edge: ArrangeEdge) => edge.id !== undefined && present.has(edge.id);
    const fontSize = parseFloat(getComputedStyle(host).fontSize) || 16;
    const space = gap * fontSize;
    const boxes = elements.map((element, index) => ({
      // A child without a key is known by its node id, which is the same at every step.
      key: element.dataset.svKey ?? element.dataset.svNode ?? `#${index}`,
      // Layout sizes, unaffected by the frame's scale; offsetWidth rounds, so a pixel more keeps
      // a fractional width from wrapping once placed.
      width: element.offsetWidth + 1,
      height: element.offsetHeight + 1
    }));
    // Links attach to the node they name: a keyed node inside a child, or, for a keyed child that
    // holds one value cell among labels, that cell, so arrows meet the value and not its labels.
    const anchors: Record<string, Anchor> = {};
    const parts: Anchor[] = [];
    elements.forEach((element, box) => {
      const frame = element.getBoundingClientRect();
      // Rects are scaled with the frame; the child's own size gives the scale back.
      const ratio = frame.width ? element.offsetWidth / frame.width : 1;
      const anchor = (inner: Element): Anchor => {
        const rect = inner.getBoundingClientRect();
        return {
          box,
          x: (rect.left - frame.left) * ratio,
          y: (rect.top - frame.top) * ratio,
          width: rect.width * ratio,
          height: rect.height * ratio
        };
      };
      for (const inner of element.querySelectorAll<HTMLElement>('[data-sv-key]'))
        if (inner.dataset.svKey) anchors[inner.dataset.svKey] = anchor(inner);
      // A node drawing an element of the state is also found by it, as vertices[2], the outermost
      // such node first, so a link given a position meets the element's whole view.
      for (const inner of [element, ...element.querySelectorAll<HTMLElement>('[data-sv-slot]')])
        if (inner.dataset.svSlot && !(inner.dataset.svSlot in anchors))
          anchors[inner.dataset.svSlot] = anchor(inner);
      const cells = [...element.querySelectorAll('[data-sv-node]')].filter((inner) =>
        inner.querySelector(':scope > .value')
      );
      if (element.dataset.svKey && cells.length === 1)
        anchors[element.dataset.svKey] = anchor(cells[0]);
      // The content inside a child, which arrows bend round: its innermost nodes.
      for (const inner of element.querySelectorAll('[data-sv-node]'))
        if (!inner.querySelector('[data-sv-node]')) parts.push(anchor(inner));
    });
    const options = {
      template,
      align,
      links: specs,
      constraints,
      flow,
      form,
      curve,
      gap: space,
      aspect: spaceAspect()
    };
    // While recording, note what this arrangement contains at this step, by key, so it can be
    // solved once over every step (see node/span.ts).
    if (memory?.recording) {
      let entry = memory.scopes.get(scope);
      if (!entry) memory.scopes.set(scope, (entry = { inputs: new Map() }));
      const keyed = (anchor: Anchor) => ({ ...anchor, box: boxes[anchor.box].key });
      entry.inputs.set(memory.step, {
        seed: drawSeed,
        boxes,
        anchors: Object.fromEntries(Object.entries(anchors).map(([key, a]) => [key, keyed(a)])),
        parts: parts.map(keyed),
        options
      });
    }
    // Children go where the solution over every step put them, and only this step's links are
    // drawn. A child the solution does not know, such as before it is made, is laid out here alone.
    const span = memory?.scopes.get(scope)?.span;
    let shown: NonNullable<typeof result>;
    let placements: { x: number; y: number }[];
    if (span && boxes.every(({ key }) => span.positions[key])) {
      placements = boxes.map(({ key }) => span.positions[key]);
      shown = {
        width: span.width,
        height: span.height,
        edges: span.edges.filter(drawn),
        choices: span.choices,
        styles
      };
    } else {
      const solved = untrack(() =>
        arrange(boxes, { ...options, anchors, parts, random: keyedRandom(drawSeed, 'layout') })
      );
      for (const problem of solved.problems) console.warn(`Node layout: ${problem}`);
      placements = solved.placements;
      shown = {
        width: solved.width,
        height: solved.height,
        edges: solved.edges.filter(drawn),
        choices: solved.choices,
        styles
      };
    }
    elements.forEach((element, index) => {
      element.style.left = `${placements[index].x}px`;
      element.style.top = `${placements[index].y}px`;
    });
    const resized =
      untrack(() => result?.width) !== shown.width ||
      untrack(() => result?.height) !== shown.height;
    result = shown;
    if (resized) parent?.changed();
  });
</script>

<div
  class="sv-arranged"
  data-sv-layout-seed={drawSeed}
  data-sv-form={result?.choices.form}
  data-sv-curve={result?.choices.curve}
  style:width={result ? `${result.width}px` : undefined}
  style:height={result ? `${result.height}px` : undefined}
  style:visibility={result ? undefined : 'hidden'}
>
  <!-- Until laid out, children have room to take their natural width. -->
  <div class="placed" bind:this={host} style:width={result ? undefined : '10000px'}>
    {@render children?.()}
  </div>
  <!-- Arrows are drawn over the nodes, so filled boxes never hide them. -->
  {#if result?.edges.length}
    {@const shown = result}
    {@const styleOf = (edge: ArrangeEdge) => (edge.id ? shown.styles[edge.id] : undefined)}
    {@const colours = [...new Set(shown.edges.map((edge) => colourOf(styleOf(edge))))]}
    <svg class="links" width={shown.width} height={shown.height} aria-hidden="true">
      <defs>
        {#each colours as colour, index (colour)}
          <marker
            id="{markerId}-{index}"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerUnits="userSpaceOnUse"
            markerWidth="9"
            markerHeight="9"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" style:fill={colour} />
          </marker>
        {/each}
      </defs>
      {#each shown.edges as edge, index (index)}
        {@const style = styleOf(edge)}
        {@const colour = colourOf(style)}
        <path
          class="link"
          d={edge.path}
          data-sv-edge={edge.link}
          data-sv-edge-id={edge.id}
          style:stroke={colour}
          style:stroke-width={widthOf(style)}
          style:opacity={style?.shown === false ? 0 : style?.opacity}
          stroke-dasharray={style?.dashed ? '6 4' : undefined}
          marker-end={edge.directed ? `url(#${markerId}-${colours.indexOf(colour)})` : undefined}
        />
        {#if edge.id}
          <!-- A wider, invisible line along a link component, so it can be clicked and selected. -->
          <path
            class="hit"
            d={edge.path}
            data-sv-node={edge.id}
            data-sv-bend={Math.round(edge.bend * 100) / 100}
            data-sv-label={style?.label ?? edge.link.replace(' -> ', ' → ').replace(' - ', ' – ')}
          />
        {/if}
        {#if style?.label}
          <text
            class="label"
            x={edge.middle.x}
            y={edge.middle.y}
            style:fill={style.labelColour}
            style:opacity={style.shown === false ? 0 : style.opacity}>{style.label}</text
          >
        {/if}
      {/each}
    </svg>
  {/if}
</div>

<style>
  .sv-arranged {
    position: relative;
    flex: none;
  }
  .placed {
    position: absolute;
    inset: 0;
  }
  /* Every child is placed by the layout, at its natural size. */
  .placed > :global(*) {
    position: absolute;
  }
  .links {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }
  .links .link {
    fill: none;
    stroke: var(--sv-muted);
    stroke-width: 1.5;
  }
  .links .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 12px;
    pointer-events: stroke;
  }
  .links .label {
    font-size: 0.75em;
    fill: var(--sv-muted);
    text-anchor: middle;
    dominant-baseline: central;
    paint-order: stroke;
    stroke: var(--sv-surface);
    stroke-width: 4px;
  }
</style>
