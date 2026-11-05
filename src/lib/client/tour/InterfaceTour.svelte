<script lang="ts">
  import { Portal } from 'bits-ui';
  import { onMount } from 'svelte';

  import CircleQuestionMarkIcon from '@lucide/svelte/icons/circle-question-mark';

  import { Button } from '$lib/client/components/ui/button';
  import type { VisualizationMode } from '$lib/shared/presentations';

  import TourOverlay from './TourOverlay.svelte';
  import { clearHighlight, findPart, spotlight } from './spotlight.svelte';
  import { deferredStep, hintTours, introTour, SeenTours, type Tour } from './tours';

  type Props = {
    mode: VisualizationMode;
    /** Whose progress this is, so viewers sharing a browser each see the tour. */
    viewer: string;
    /** Start the introduction and hints by themselves, for participants. */
    auto: boolean;
    /** Told the tour step on screen, or none, for the interaction recording. */
    onShown?: (shown: { id: string; step: number; count: number } | undefined) => void;
  };

  let { mode, viewer, auto, onShown }: Props = $props();

  // The workspace is keyed by project, so the system and viewer are fixed for this instance.
  // svelte-ignore state_referenced_locally
  const seen = new SeenTours(viewer);
  // svelte-ignore state_referenced_locally
  const intro = introTour(mode);
  // svelte-ignore state_referenced_locally
  const hints = hintTours(mode);
  const workspace = '[data-replay-region="workspace"]';

  // The tour shown, and what closing it marks seen: itself, and any steps it owes as hints.
  let active = $state<{
    tour: Tour;
    index: number;
    quiet: boolean;
    dim: boolean;
    marks: string[];
  }>();
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

  function start(tour: Tour, options: { dim: boolean; quiet: boolean }, marks = [tour.id]) {
    clearHighlight();
    returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    active = { tour, index: 0, ...options, marks };
    reportShown();
  }

  // The introduction's steps whose parts are on screen; it owes the others as hints.
  function startIntro() {
    const root = document.querySelector(workspace) ?? document;
    const shown = intro.steps.filter(({ part }) => findPart(part, root));
    const owed = deferred.filter(({ step }) => !shown.includes(step)).map(({ owed }) => owed);
    start({ ...intro, steps: shown }, { dim: true, quiet: false }, [intro.id, ...owed]);
  }

  // The help button: the introduction and every hint whose part is on screen, in one tour.
  function startHelp() {
    const root = document.querySelector(workspace) ?? document;
    const steps = [...intro.steps, ...hints.flatMap(({ steps }) => steps)].filter(({ part }) =>
      findPart(part, root)
    );
    const unique = steps.filter(
      (step, index) => steps.findIndex((s) => s.part === step.part) === index
    );
    start({ id: intro.id, steps: unique }, { dim: true, quiet: false });
  }

  // Seen once closed (Done, Skip, Got it or Escape), so a reload while it shows shows it again.
  function close() {
    for (const id of active?.marks ?? []) seen.add(id);
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

  // The introduction's steps as hints, each shown once the introduction owes it.
  const deferred = intro.steps.map((step) => ({ step, ...deferredStep(intro, step) }));
  // The hint whose part was found last frame, and where, to show it once it stays put.
  let settling: string | undefined;

  // A hint shows the first time its first part is on screen and laid out, keeping the steps found
  // then: first the steps the introduction left out, then the system's own hints.
  function showHint() {
    if (!auto || active || !seen.has(intro.id)) return;
    const root = document.querySelector(workspace) ?? document;
    const owed = deferred.filter(({ owed }) => seen.has(owed)).map(({ hint }) => hint);
    for (const hint of [...owed, ...hints]) {
      if (seen.has(hint.id)) continue;
      const box = findPart(hint.steps[0].part, root)?.getBoundingClientRect();
      if (!box?.width || !box.height) continue;
      const place = `${hint.id} ${box.top} ${box.left} ${box.width} ${box.height}`;
      if (settling !== place) {
        settling = place;
        scheduleHints();
        return;
      }
      settling = undefined;
      const steps = hint.steps.filter(({ part }, index) => index === 0 || findPart(part, root));
      start({ ...hint, steps }, { dim: false, quiet: typing() });
      return;
    }
    settling = undefined;
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

<Button
  size="icon-sm"
  variant="ghost"
  class="ml-auto"
  aria-label="Interface help"
  title="Interface help"
  data-interface-part="help"
  data-interaction="tour-help"
  onclick={startHelp}><CircleQuestionMarkIcon /></Button
>

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
