<script lang="ts">
  import { untrack } from 'svelte';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import ShuffleIcon from '@lucide/svelte/icons/shuffle';
  import { fly } from 'svelte/transition';

  import { Button } from '$lib/client/components/ui/button';
  import * as Empty from '$lib/client/components/ui/empty';
  import { Spinner } from '$lib/client/components/ui/spinner';
  import type { ProjectSession } from '$lib/client/projects/project-session.svelte';
  import type { ProjectOperationKind } from '$lib/shared/projects/events';
  import * as DropdownMenu from '$lib/client/components/ui/dropdown-menu';
  import { isStepName, type PresentationLayout } from '$lib/shared/presentations';
  import { elidedName } from '$lib/client/artifacts/source-references';

  import { baseCandidate, type PresentationSelection } from './presentation-selection.svelte';
  import {
    localPresentationStep,
    presentationHeld,
    presentationPlaybackContext,
    type PresentationPlayback
  } from './presentation-playback.svelte';
  import PresentationViewport from './PresentationViewport.svelte';
  import type { VisualSelection, VisualSelections } from './visual-selection.svelte';
  import type { CanvasView } from '$lib/modes/sandbox';
  import type { DrawnStep } from '$lib/shared/projects/events/message-content';

  type Props = {
    session: ProjectSession;
    selection: PresentationSelection;
    playback: PresentationPlayback;
    layout: PresentationLayout;
    /** Elements selected in the visible presentations, to reference in feedback. */
    visualSelections: VisualSelections;
    onReferenceSelection?: (selection: VisualSelection) => void;
    onViewChange?: (presentationId: string, view: CanvasView) => void;
    /** What a presentation's step on screen drew implicitly. */
    onDrawnChange?: (presentationId: string, drawn: DrawnStep) => void;
    disabled?: boolean;
    /** Kept loaded but out of sight, as while a source is chosen on its own. */
    hidden?: boolean;
  };

  let {
    session,
    selection,
    playback,
    layout,
    visualSelections,
    onReferenceSelection = () => {},
    onViewChange = () => {},
    onDrawnChange = () => {},
    disabled = false,
    hidden = false
  }: Props = $props();
  let preferencePending = $state<string>();

  // Each visible presentation's viewport, by presentation ID, to ask for exports.
  const viewports: Record<string, PresentationViewport | undefined> = $state({});
  let exporting = $state<string>();
  let exportFailure = $state<{ presentationId: string; message: string }>();

  /** Download a presentation rendered to one of its targets' files. */
  async function exportTo(presentationId: string, target: string) {
    exporting = presentationId;
    exportFailure = undefined;
    try {
      const viewport = viewports[presentationId];
      if (!viewport) throw new Error('This visualization has not loaded yet.');
      const file = await viewport.render(target);
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      // The click starts the download at once, so the URL can go.
      setTimeout(() => URL.revokeObjectURL(url));
    } catch (cause) {
      exportFailure = {
        presentationId,
        message: cause instanceof Error ? cause.message : String(cause)
      };
    } finally {
      exporting = undefined;
    }
  }

  const visualizationOperationKinds: readonly ProjectOperationKind[] = [
    'initial-build',
    'feedback',
    'prefer',
    'rebuild',
    'resample',
    'save',
    'restore'
  ];
  const visible = $derived(selection.selected(session.events, layout));
  const preparing = $derived(
    session.refillPending ||
      (!!session.pending && visualizationOperationKinds.includes(session.pending.type))
  );
  const playbackContext = $derived(presentationPlaybackContext(visible));
  $effect.pre(() => {
    const context = playbackContext;
    untrack(() => playback.activate(context));
  });
  const step = $derived(playback.stepFor(playbackContext));
  const stepCount = $derived(playbackContext.stepCount);
  // The step's name, its label elided at the start as chat pills are (@…compare.left#3).
  const stepName = $derived.by(() => {
    const label = playbackContext.frames[step]?.label;
    return isStepName(label) ? label : undefined;
  });
  const shownStepName = $derived.by(() => {
    if (!stepName) return undefined;
    const [label, run] = stepName.split('#');
    const parts = elidedName(label);
    return parts ? `${parts.head}…${parts.tail}#${run}` : stepName;
  });
  const selectedIds = $derived(visible.map(({ presentation }) => presentation.presentationId));
  // A selection belongs to its step and its presentation; stepping or switching drops it.
  $effect(() => {
    const ids = selectedIds;
    const current = step;
    untrack(() => visualSelections.retain(ids, current));
  });
  const preferred = $derived.by(() => {
    if (visible.length !== 2) return undefined;
    const preference = session.events.findLast(
      (event) =>
        event.type === 'visualization.preference-recorded' &&
        event.payload.step === step &&
        event.payload.presentations.every((id) => selectedIds.includes(id))
    );
    return preference?.type === 'visualization.preference-recorded'
      ? preference.payload.preferred
      : undefined;
  });

  function seek(next: number) {
    playback.seek(playbackContext, next);
  }

  async function prefer(preferred: string) {
    if (visible.length !== 2) return;
    preferencePending = preferred;
    selection.pin(visible);
    try {
      const succeeded = await session.runCommand({
        type: 'prefer',
        presentations: [selectedIds[0], selectedIds[1]],
        preferred,
        step
      });
      if (succeeded) {
        selection.returnToLatest();
      }
    } finally {
      preferencePending = undefined;
    }
  }

  async function advancePresentations() {
    if (!visible.length) return;
    const succeeded = await session.runCommand({
      type: 'advance-presentations',
      presentations: selectedIds
    });
    if (succeeded) {
      selection.returnToLatest();
    }
  }

  async function generateVariants() {
    const from = baseCandidate(visible);
    const succeeded = await session.runCommand({
      type: 'resample',
      presentationCount: layout === 'comparison' ? 2 : 1,
      ...(from ? { from } : {})
    });
    if (succeeded) {
      selection.returnToLatest();
    }
  }

  function localStep(entry: (typeof visible)[number]) {
    return localPresentationStep(playbackContext, entry.presentation.presentationId, step);
  }

  function held(entry: (typeof visible)[number]) {
    return presentationHeld(playbackContext, entry.presentation.presentationId, step);
  }
</script>

{#snippet controls()}
  <div
    class="flex min-h-14 shrink-0 items-center justify-center gap-2 border-y bg-background px-3 py-2"
    data-replay-region="presentation-controls"
  >
    {#if layout === 'comparison' && visible.length === 2}
      <Button
        size="lg"
        variant={preferred === selectedIds[0] ? 'default' : 'outline'}
        aria-label="Prefer top candidate"
        onclick={() => prefer(selectedIds[0])}
        disabled={disabled || preferencePending !== undefined}
      >
        {#if preferencePending === selectedIds[0]}
          <Spinner data-icon="inline-start" /> Recording…
        {:else}
          Prefer top candidate
        {/if}
      </Button>
    {/if}
    <Button
      size="lg"
      variant="outline"
      aria-label="Previous visualization step"
      onclick={() => seek(step - 1)}
      disabled={disabled || step === 0}
    >
      <ChevronLeftIcon data-icon="inline-start" />
      Previous
    </Button>
    <!-- A fixed width, so the buttons stay put as the step's name changes. -->
    <span
      class="w-72 shrink-0 truncate text-center text-sm whitespace-nowrap text-muted-foreground"
      title={stepName}
    >
      {stepCount ? `Step ${step + 1} of ${stepCount}` : 'No steps'}{#if shownStepName}<span
          class="mx-1">·</span
        ><code class="font-mono text-xs">{shownStepName}</code>{/if}
    </span>
    <Button
      size="lg"
      variant="outline"
      aria-label="Next visualization step"
      onclick={() => seek(step + 1)}
      disabled={disabled || step >= stepCount - 1}
    >
      Next
      <ChevronRightIcon data-icon="inline-end" />
    </Button>
    {#if layout === 'comparison' && visible.length === 2}
      <Button
        size="lg"
        variant={preferred === selectedIds[1] ? 'default' : 'outline'}
        aria-label="Prefer bottom candidate"
        onclick={() => prefer(selectedIds[1])}
        disabled={disabled || preferencePending !== undefined}
      >
        {#if preferencePending === selectedIds[1]}
          <Spinner data-icon="inline-start" /> Recording…
        {:else}
          Prefer bottom candidate
        {/if}
      </Button>
    {/if}
    {#if selection.buffered && selection.followingLatest && visible.length}
      <Button
        size="sm"
        variant="outline"
        aria-label="Show next visualization pair"
        onclick={advancePresentations}
        {disabled}
      >
        Next pair
      </Button>
    {/if}
    {#if !selection.buffered && session.snapshot.mode === 'sverlin'}
      <Button
        size="sm"
        variant="outline"
        aria-label={layout === 'comparison'
          ? 'Generate another visualization pair'
          : 'Generate another visualization variant'}
        onclick={generateVariants}
        disabled={disabled || !session.atHead}
      >
        {#if session.pending?.type === 'resample'}
          <Spinner data-icon="inline-start" /> Generating…
        {:else}
          <ShuffleIcon data-icon="inline-start" />
          {layout === 'comparison' ? 'New pair' : 'Another variant'}
        {/if}
      </Button>
    {/if}
  </div>
  {#if selection.notice}
    <p class="border-b bg-muted px-3 py-2 text-center text-sm text-muted-foreground" role="status">
      {selection.notice}
    </p>
  {/if}
{/snippet}

<section
  class={['flex min-h-0 flex-1 flex-col', hidden && 'hidden']}
  aria-label="Visualization presentations"
>
  {#if visible.length}
    {#each visible as entry, index (entry.presentation.presentationId)}
      {@const presentationId = entry.presentation.presentationId}
      {@const selected = visualSelections.for(presentationId, step)}
      {@const targets = viewports[presentationId]?.renderTargets() ?? []}
      <div
        class="flex min-h-0 flex-1 overflow-hidden bg-muted/30 p-2"
        data-replay-region={`candidate-${index + 1}`}
        data-replay-presentation-id={entry.presentation.presentationId}
        in:fly={{ x: 24, duration: 180 }}
      >
        <div
          class="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border bg-white shadow-sm"
        >
          {#if held(entry)}
            <p
              class="absolute top-2 right-2 z-10 rounded-md border bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm"
              role="status"
            >
              This version skips this step; showing its previous step.
            </p>
          {/if}
          {#if selected && !session.readOnly}
            <Button
              size="xs"
              variant="secondary"
              class="absolute bottom-2 left-2 z-10 max-w-[70%] truncate shadow-sm"
              onclick={() => onReferenceSelection(selected)}
            >
              Reference {selected.elements.length === 1
                ? selected.elements[0].label
                : `${selected.elements.length} elements`}
            </Button>
          {/if}
          {#if targets.length}
            <div class="absolute top-2 left-2 z-10 flex max-w-[70%] flex-col items-start gap-1">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger disabled={exporting !== undefined}>
                  {#snippet child({ props })}
                    <Button
                      {...props}
                      size="xs"
                      variant="secondary"
                      class="shadow-sm"
                      aria-label="Export this visualization"
                    >
                      {#if exporting === presentationId}
                        <Spinner data-icon="inline-start" /> Exporting…
                      {:else}
                        <DownloadIcon data-icon="inline-start" /> Export
                      {/if}
                    </Button>
                  {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="start">
                  {#each targets as target (target.id)}
                    <DropdownMenu.Item onSelect={() => exportTo(presentationId, target.id)}>
                      {target.title}
                    </DropdownMenu.Item>
                  {/each}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
              {#if exportFailure?.presentationId === presentationId}
                <p
                  role="alert"
                  class="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800"
                >
                  {exportFailure.message}
                </p>
              {/if}
            </div>
          {/if}
          <PresentationViewport
            bind:this={viewports[presentationId]}
            presentation={entry.presentation}
            step={localStep(entry)}
            label={`Visualization ${index + 1}`}
            selection={selected?.elements.map(({ id }) => id) ?? []}
            onSelectionChange={(elements) => visualSelections.set(presentationId, step, elements)}
            onViewChange={(view) => onViewChange(presentationId, view)}
            onDrawnChange={(drawn) => onDrawnChange(presentationId, drawn)}
            onRuntimeError={(failure) =>
              session.reportRuntimeFailure({ presentationId, ...failure })}
            onLoadTiming={(timing) => session.reportLoadTiming(timing)}
          />
        </div>
      </div>
      {#if index === 0}{@render controls()}{/if}
    {/each}
  {:else}
    <div class="flex min-h-0 flex-1 bg-muted/30 p-2">
      <Empty.Root class="border-0" aria-live="polite">
        <Empty.Header>
          {#if preparing}
            <Empty.Media><Spinner /></Empty.Media>
            <Empty.Title>Preparing a visualization…</Empty.Title>
          {:else}
            <Empty.Title>Your visualization will appear here.</Empty.Title>
          {/if}
        </Empty.Header>
      </Empty.Root>
    </div>
  {/if}
</section>
