<script lang="ts">
  import { untrack } from 'svelte';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { fly } from 'svelte/transition';

  import { Button } from '$lib/client/components/ui/button';
  import * as Empty from '$lib/client/components/ui/empty';
  import { Spinner } from '$lib/client/components/ui/spinner';
  import type { ProjectSession } from '$lib/client/projects/project-session.svelte';
  import type { ProjectOperationKind } from '$lib/shared/projects/events';
  import type { ProjectCommandInput } from '$lib/shared/projects/model';
  import * as DropdownMenu from '$lib/client/components/ui/dropdown-menu';
  import { isStepName, type PresentationLayout } from '$lib/shared/presentations';
  import { elidedName } from '$lib/client/artifacts/source-references';
  import { projectQuestions } from '$lib/shared/projects/questions';

  import { type PresentationSelection } from './presentation-selection.svelte';
  import {
    localPresentationStep,
    presentationHeld,
    presentationPlaybackContext,
    type PresentationPlayback
  } from './presentation-playback.svelte';
  import { pairQuestion } from './presentation-history';
  import PresentationViewport from './PresentationViewport.svelte';
  import { stageActivity } from './stage-activity';
  import type { VisualSelection, VisualSelections } from './visual-selection.svelte';
  import type { CanvasView } from '$lib/modes/sandbox';

  type Props = {
    session: ProjectSession;
    selection: PresentationSelection;
    playback: PresentationPlayback;
    layout: PresentationLayout;
    /** Elements selected in the visible presentations, to reference in feedback. */
    visualSelections: VisualSelections;
    onReferenceSelection?: (selection: VisualSelection) => void;
    onViewChange?: (presentationId: string, view: CanvasView) => void;
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
    disabled = false,
    hidden = false
  }: Props = $props();
  // Whether an answer to the shown pair is being saved.
  let answering = $state(false);

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
  const question = $derived(layout === 'comparison' ? pairQuestion(visible) : undefined);
  // The latest answer to the assistant's comparison shown, once given; answering again changes it.
  const recorded = $derived(
    question
      ? projectQuestions(session.events).find(
          ({ kind, displaySetId }) => kind === 'pair' && displaySetId === visible[0].displaySetId
        )?.answer
      : undefined
  );
  const preparing = $derived(
    session.refillPending ||
      (!!session.pending && visualizationOperationKinds.includes(session.pending.type))
  );
  // What the project's running operations are doing, shown over the visualization.
  const activity = $derived.by(() => {
    const shown = visible[0]?.presentation;
    const source = shown?.format === 'browser-bundle-v1' ? shown.source : shown?.authored;
    return stageActivity(session.events, source?.sha256, session.pending ?? undefined);
  });
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
  // The side preferred: the comparison's latest answer, or for another pair its answer at this step.
  const preferred = $derived.by(() => {
    if (visible.length !== 2) return undefined;
    if (question) return recorded?.kind === 'preferred' ? recorded.presentationId : undefined;
    const preference = session.events.findLast(
      (event) =>
        event.type === 'visualization.preference-recorded' &&
        event.payload.step === step &&
        event.payload.presentations.every((id) => selectedIds.includes(id))
    );
    return preference?.type === 'visualization.preference-recorded' &&
      'preferred' in preference.payload
      ? preference.payload.preferred
      : undefined;
  });

  function seek(next: number) {
    playback.seek(playbackContext, next);
  }

  /**
   * Answer the pair: prefer one side, or say either is fine (tie) or decide later (skip). What
   * follows shows at once; if the answer cannot be saved, the pair shows again at its step.
   */
  async function prefer(answer: string | 'tie' | 'skip') {
    if (visible.length !== 2 || answering) return;
    const answered = visible;
    const at = step;
    const command: ProjectCommandInput = {
      type: 'prefer',
      presentations: [selectedIds[0], selectedIds[1]],
      ...(answer === 'tie' || answer === 'skip' ? { outcome: answer } : { preferred: answer }),
      step: at
    };
    answering = true;
    try {
      const saved = await selection.answer(answered, () => session.runCommand(command));
      if (!saved) playback.seek(presentationPlaybackContext(answered), at);
    } finally {
      answering = false;
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
        disabled={disabled || answering}
      >
        Prefer top candidate
      </Button>
    {/if}
    <Button
      size="lg"
      variant="outline"
      aria-label="Previous visualization step"
      onclick={() => seek(step - 1)}
      disabled={step === 0}
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
      disabled={step >= stepCount - 1}
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
        disabled={disabled || answering}
      >
        Prefer bottom candidate
      </Button>
    {/if}
    {#if layout === 'comparison' && visible.length === 2}
      <!-- Beside preferring a side: the two are equally good, or the question can wait. -->
      <div class="flex flex-col gap-0.5">
        <Button
          size="xs"
          variant="ghost"
          aria-label="Either is fine"
          onclick={() => prefer('tie')}
          disabled={disabled || answering}
        >
          Either is fine
        </Button>
        <Button
          size="xs"
          variant="ghost"
          aria-label="Decide later"
          onclick={() => prefer('skip')}
          disabled={disabled || answering}
        >
          Decide later
        </Button>
      </div>
    {/if}
    {#if selection.buffered && !selection.questionPairs && selection.followingLatest && visible.length}
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
    {#if question}
      <p
        class="shrink-0 border-b bg-background px-3 py-2 text-center text-base font-medium"
        data-replay-region="comparison-question"
      >
        {question}
        {#if recorded}
          <!-- What was answered, which the controls below change. -->
          <span class="block text-sm font-normal text-muted-foreground">
            {recorded.kind === 'skip'
              ? 'You left this for later; answer it now if you like.'
              : 'You answered this; choose again to change your answer.'}
          </span>
        {/if}
      </p>
    {/if}
    {#each visible as entry, index (entry.presentation.presentationId)}
      {@const presentationId = entry.presentation.presentationId}
      {@const choice =
        recorded?.kind === 'tie'
          ? 'Either is fine'
          : recorded?.kind === 'preferred' && recorded.presentationId === presentationId
            ? 'Your choice'
            : undefined}
      {@const selected = visualSelections.for(presentationId, step)}
      {@const targets = viewports[presentationId]?.renderTargets() ?? []}
      <!-- Each candidate; the side the comparison's latest answer chose is outlined and badged, or
        both where either is fine. -->
      <div
        class="flex min-h-0 flex-1 overflow-hidden bg-muted/30 p-2"
        data-replay-region={`candidate-${index + 1}`}
        data-replay-presentation-id={entry.presentation.presentationId}
        in:fly={{ x: 24, duration: 180 }}
      >
        <div
          class={[
            'relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border bg-white shadow-sm',
            choice && 'border-primary ring-2 ring-primary'
          ]}
        >
          <div class="absolute top-2 right-2 z-10 flex flex-col items-end gap-1">
            {#if choice}
              <p
                class="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-sm"
              >
                {choice}
              </p>
            {/if}
            {#if index === 0 && activity}
              <p
                class="flex items-center gap-1.5 rounded-md border bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm"
                role="status"
                aria-live="polite"
              >
                <Spinner class="size-3" aria-hidden="true" />{activity.label}
              </p>
            {/if}
            {#if held(entry)}
              <p
                class="rounded-md border bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm"
                role="status"
              >
                This version skips this step; showing its previous step.
              </p>
            {/if}
          </div>
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
          <!-- Dimmed while an operation replaces it, so it reads as the old version. -->
          <div
            class={[
              'flex min-h-0 min-w-0 flex-1 transition-opacity',
              activity?.replacing && 'opacity-60'
            ]}
          >
            <PresentationViewport
              bind:this={viewports[presentationId]}
              presentation={entry.presentation}
              step={localStep(entry)}
              label={`Visualization ${index + 1}`}
              selection={selected?.elements.map(({ id }) => id) ?? []}
              onSelectionChange={(elements) => visualSelections.set(presentationId, step, elements)}
              onViewChange={(view) => onViewChange(presentationId, view)}
              onRuntimeError={(failure) =>
                session.reportRuntimeFailure({ presentationId, ...failure })}
              onLoadTiming={(timing) => session.reportLoadTiming(timing)}
            />
          </div>
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
