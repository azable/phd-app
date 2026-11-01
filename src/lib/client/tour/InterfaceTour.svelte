<script lang="ts">
  import { Portal } from 'bits-ui';
  import { onMount } from 'svelte';

  import CircleQuestionMarkIcon from '@lucide/svelte/icons/circle-question-mark';

  import { Button } from '$lib/client/components/ui/button';
  import * as DropdownMenu from '$lib/client/components/ui/dropdown-menu';
  import type { VisualizationMode } from '$lib/shared/presentations';

  import TourOverlay from './TourOverlay.svelte';
  import { clearHighlight, findPart, spotlight } from './spotlight.svelte';
  import { hintTours, introTour, SeenTours, type Tour } from './tours';

  type Props = {
    mode: VisualizationMode;
    /** Whose progress this is, so viewers sharing a browser each see the tour. */
    viewer: string;
    /** Start the introduction and hints by themselves, for participants. */
    auto: boolean;
    /** Offer resetting what has been seen, to try the tour again. */
    canReset?: boolean;
    /** Told the tour step on screen, or none, for the interaction recording. */
    onShown?: (shown: { id: string; step: number; count: number } | undefined) => void;
  };

  let { mode, viewer, auto, canReset = false, onShown }: Props = $props();

  // The workspace is keyed by project, so the system and viewer are fixed for this instance.
  // svelte-ignore state_referenced_locally
  const seen = new SeenTours(viewer);
  // svelte-ignore state_referenced_locally
  const intro = introTour(mode);
  // svelte-ignore state_referenced_locally
  const hints = hintTours(mode);
  const workspace = '[data-replay-region="workspace"]';

  let active = $state<{ tour: Tour; index: number; quiet: boolean; dim: boolean }>();
  let returnFocus: HTMLElement | undefined;

  const step = $derived(active?.tour.steps[active.index]);

  function reportShown() {
    onShown?.(
      active && { id: active.tour.id, step: active.index, count: active.tour.steps.length }
    );
  }

  function typing() {
    const element = document.activeElement;
    return (
      element instanceof HTMLElement &&
      (element.isContentEditable || element.matches('input, textarea, select'))
    );
  }

  function start(tour: Tour, options: { dim: boolean; quiet: boolean }) {
    seen.add(tour.id);
    clearHighlight();
    returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    active = { tour, index: 0, ...options };
    reportShown();
  }

  function startIntro() {
    start(intro, { dim: true, quiet: false });
  }

  function close() {
    const focusInTour = document.activeElement?.closest('[data-interface-tour]');
    active = undefined;
    reportShown();
    clearHighlight();
    if (focusInTour && returnFocus?.isConnected) returnFocus.focus();
    returnFocus = undefined;
    scheduleHints();
  }

  function next() {
    if (active && active.index < active.tour.steps.length - 1) {
      active.index += 1;
      reportShown();
    } else close();
  }

  // A hint shows the first time its first part is on screen, keeping the steps found then.
  function showHint() {
    if (!auto || active || !seen.has(intro.id)) return;
    const root = document.querySelector(workspace) ?? document;
    for (const hint of hints) {
      if (seen.has(hint.id) || !findPart(hint.steps[0].part, root)) continue;
      const steps = hint.steps.filter(({ part }, index) => index === 0 || findPart(part, root));
      start({ ...hint, steps }, { dim: false, quiet: typing() });
      return;
    }
  }

  let scheduled = 0;
  function scheduleHints() {
    if (scheduled) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      showHint();
    });
  }

  onMount(() => {
    const root = document.querySelector(workspace) ?? document.body;
    const observer = new MutationObserver(scheduleHints);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'aria-pressed', 'class', 'hidden']
    });
    // After the workspace's first layout, so the parts are where the tour points.
    const frame = requestAnimationFrame(() => {
      if (auto && !seen.has(intro.id)) startIntro();
      else scheduleHints();
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scheduled);
    };
  });
</script>

{#if canReset}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          size="icon-sm"
          variant="ghost"
          class="ml-auto"
          aria-label="Interface help"
          title="Interface help"
          data-interface-part="help"
          data-interaction="tour-help"><CircleQuestionMarkIcon /></Button
        >
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end">
      <DropdownMenu.Item onSelect={startIntro}>Show the introduction</DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => seen.reset()}>
        Reset introduction and hints
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{:else}
  <Button
    size="icon-sm"
    variant="ghost"
    class="ml-auto"
    aria-label="Interface help"
    title="Interface help"
    data-interface-part="help"
    data-interaction="tour-help"
    onclick={startIntro}><CircleQuestionMarkIcon /></Button
  >
{/if}

<Portal to={workspace}>
  <TourOverlay
    part={step?.part ?? spotlight.highlighted}
    dim={active?.dim}
    popover={active && step
      ? {
          title: step.title,
          body: step.body,
          index: active.index,
          count: active.tour.steps.length,
          finish: active.dim ? 'Done' : 'Got it'
        }
      : undefined}
    takeFocus={!active?.quiet}
    onNext={next}
    onClose={close}
  />
</Portal>
