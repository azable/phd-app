<script lang="ts" module>
  export type TourPopover = {
    title: string;
    body: string;
    index: number;
    count: number;
    /** The last step's button: Done ends a tour, Got it a hint. */
    finish: string;
  };
</script>

<script lang="ts">
  import { tick } from 'svelte';

  import { Button } from '$lib/client/components/ui/button';
  import type { InterfacePartId } from '$lib/shared/interface-parts';

  import { findPart } from './spotlight.svelte';
  import { placePopover, popoverSides } from './tours';

  type Props = {
    /** The part spotlighted; the popover is centred when it is not on screen. */
    part?: InterfacePartId;
    /** Dim the rest of the page, for the introduction; hints only ring their part. */
    dim?: boolean;
    popover?: TourPopover;
    /** Move focus to the popover when it opens; off while the viewer is typing. */
    takeFocus?: boolean;
    onNext?: () => void;
    onClose: () => void;
  };

  let { part, dim = false, popover, takeFocus = true, onNext, onClose }: Props = $props();

  type Rect = { top: number; left: number; width: number; height: number };
  const padding = 6;

  let rect = $state.raw<Rect>();
  let innerWidth = $state(0);
  let innerHeight = $state(0);
  const viewport = $derived({ width: innerWidth, height: innerHeight });
  let popoverElement = $state<HTMLElement>();
  let popoverWidth = $state(0);
  let popoverHeight = $state(0);

  // The part moves as panes resize, the timeline scrolls and its content re-renders, so it is
  // found again each frame while shown.
  $effect(() => {
    const shown = part;
    if (!shown) {
      rect = undefined;
      return;
    }
    findPart(shown)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    let frame = requestAnimationFrame(function track() {
      const box = findPart(shown)?.getBoundingClientRect();
      const next = box && { top: box.top, left: box.left, width: box.width, height: box.height };
      if (
        next?.top !== rect?.top ||
        next?.left !== rect?.left ||
        next?.width !== rect?.width ||
        next?.height !== rect?.height
      )
        rect = next;
      frame = requestAnimationFrame(track);
    });
    return () => cancelAnimationFrame(frame);
  });

  // Inside the viewport, so the ring of a part as large as the stage stays visible.
  const ring = $derived(
    rect && {
      top: Math.max(rect.top - padding, 2),
      left: Math.max(rect.left - padding, 2),
      bottom: Math.min(rect.top + rect.height + padding, viewport.height - 2),
      right: Math.min(rect.left + rect.width + padding, viewport.width - 2)
    }
  );

  const position = $derived(
    placePopover(
      ring && {
        top: ring.top,
        left: ring.left,
        width: ring.right - ring.left,
        height: ring.bottom - ring.top
      },
      { width: popoverWidth, height: popoverHeight },
      viewport,
      12,
      16,
      popoverSides(part)
    )
  );

  $effect(() => {
    if (!popover || !takeFocus) return;
    // Each new step is announced and keyboard use continues from it.
    void popover.index;
    void tick().then(() => popoverElement?.focus());
  });

  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented || (!popover && !part)) return;
    onClose();
  }
</script>

<svelte:window bind:innerWidth bind:innerHeight onkeydown={keydown} />

<div class="pointer-events-none fixed inset-0 z-40" data-interface-tour>
  {#if ring}
    <!-- An outline, not a ring: the dimming is a shadow, which would replace a ring's. -->
    <div
      class="fixed rounded-lg outline-2 outline-primary motion-safe:transition-all motion-safe:duration-200"
      style:top="{ring.top}px"
      style:left="{ring.left}px"
      style:width="{ring.right - ring.left}px"
      style:height="{ring.bottom - ring.top}px"
      style:box-shadow={dim ? '0 0 0 100vmax rgb(0 0 0 / 0.45)' : undefined}
      aria-hidden="true"
    ></div>
  {:else if popover && dim}
    <div class="fixed inset-0 bg-black/45" aria-hidden="true"></div>
  {/if}

  {#if popover}
    <div
      bind:this={popoverElement}
      bind:offsetWidth={popoverWidth}
      bind:offsetHeight={popoverHeight}
      class="pointer-events-auto fixed flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-[top,left] motion-safe:duration-200"
      style:top="{position.top}px"
      style:left="{position.left}px"
      style:visibility={popoverWidth ? undefined : 'hidden'}
      role="dialog"
      aria-modal="false"
      aria-labelledby="interface-tour-title"
      aria-describedby="interface-tour-body"
      tabindex="-1"
    >
      {#if popover.count > 1}
        <p class="text-xs text-muted-foreground">{popover.index + 1} of {popover.count}</p>
      {/if}
      <h2 id="interface-tour-title" class="text-sm font-medium">{popover.title}</h2>
      <p id="interface-tour-body" class="text-sm text-muted-foreground">{popover.body}</p>
      <div class="mt-1 flex justify-end gap-2">
        {#if popover.index < popover.count - 1}
          <Button size="sm" variant="ghost" data-interaction="tour-skip" onclick={onClose}
            >Skip</Button
          >
          <Button size="sm" data-interaction="tour-next" onclick={onNext}>Next</Button>
        {:else}
          <Button
            size="sm"
            data-interaction={dim ? 'tour-done' : 'tour-hint-dismiss'}
            onclick={onClose}>{popover.finish}</Button
          >
        {/if}
      </div>
    </div>
  {/if}
</div>
