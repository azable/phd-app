<!--
  Places a free layout's children by constraint layout (see arrange.ts): it measures each child as
  laid out inside, solves for their positions, places them, and takes the size that holds everything
  it draws, drawing any links over them (see LinkLines.svelte) and placing their labels on their
  middles, or nearby where a middle is not clear (see arrangement.ts). Its layout follows from its
  children, its links and its kind's values alone, never from the space around it. A nested
  arrangement that settles later asks its parent to lay out again, so sizes flow up and the final
  layout uses every child's final size.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import {
    arrangementParentContext,
    layoutMemoryContext,
    provideArrangementParent
  } from '../type-context';
  import type { ArrangeEdge } from './arrange';
  import { arrangeChildren } from './arrangement';
  import type { Form } from './forms';
  import LinkLines, { type LineStyle } from './LinkLines.svelte';
  import { placeLabels } from './markers';
  import type { Spacing } from './props';
  import { mountedReader } from './reader';

  let {
    flow,
    form,
    curve,
    layoutSeed,
    kind,
    gap,
    scope,
    children
  }: {
    flow?: 'x' | 'y';
    /** The form the linked structure takes; unset, or one it cannot take, its natural one. */
    form?: Form;
    curve?: 'straight' | 'curved';
    /** The seed of its kind's layout, the variant's; unset, 1. */
    layoutSeed?: number;
    /** The kind whose variables hold its look, reported with a selection. */
    kind?: string;
    gap: Spacing;
    /** Keys this arrangement's random starts, such as the node's id. */
    scope: string;
    children?: Snippet;
  } = $props();

  const memory = layoutMemoryContext();

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
    styles: Record<string, LineStyle>;
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
    const placed = host;
    const props = { flow, form, curve, layoutSeed, gap, scope };
    const laid = untrack(() => arrangeChildren(mountedReader(placed), placed, props, memory));
    for (const problem of laid.problems) console.warn(`Node layout: ${problem}`);
    laid.elements.forEach((element, index) => {
      element.style.left = `${laid.placements[index].x}px`;
      element.style.top = `${laid.placements[index].y}px`;
    });
    placeLabels(
      placed,
      laid.edges.flatMap((edge) => {
        const label = edge.id === undefined ? undefined : laid.labels.get(edge.id);
        return label ? [{ label, middle: edge.middle }] : [];
      })
    );
    const resized =
      untrack(() => result?.width) !== laid.width || untrack(() => result?.height) !== laid.height;
    result = {
      width: laid.width,
      height: laid.height,
      edges: laid.edges,
      choices: laid.choices,
      styles: laid.styles
    };
    if (resized) parent?.changed();
  });
</script>

<!-- data-sv-arrange carries its props, for a step laid out on the layout model (model/drawn.ts). -->
<div
  class="sv-arranged"
  data-sv-arrange={JSON.stringify({ flow, form, curve, layoutSeed, gap, scope })}
  data-sv-layout-seed={layoutSeed}
  data-sv-layout-kind={layoutSeed === undefined ? undefined : kind}
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
    <svg class="links" width={shown.width} height={shown.height} aria-hidden="true">
      <LinkLines
        prefix={markerId}
        lines={shown.edges.map((edge) => ({
          ...edge,
          ...(edge.id && shown.styles[edge.id] ? { style: shown.styles[edge.id] } : {})
        }))}
      />
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
  /* Every child is placed by the layout, at its natural size: never narrowed by the room left
     to its right, as by a layout solved before the children had sizes, which would wrap their
     text and keep them in that shape. */
  .placed > :global(*) {
    position: absolute;
    width: max-content;
  }
  .links {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }
</style>
