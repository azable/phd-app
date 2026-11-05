<script lang="ts">
  import { untrack } from 'svelte';
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import CheckIcon from '@lucide/svelte/icons/check';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import ChevronsLeftIcon from '@lucide/svelte/icons/chevrons-left';
  import ChevronsRightIcon from '@lucide/svelte/icons/chevrons-right';
  import CircleQuestionMarkIcon from '@lucide/svelte/icons/circle-question-mark';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import EqualIcon from '@lucide/svelte/icons/equal';
  import { prefersReducedMotion } from 'svelte/motion';
  import { fade, fly } from 'svelte/transition';

  import { Button } from '$lib/client/components/ui/button';
  import MessageContent from '$lib/client/timeline/MessageContent.svelte';
  import * as Empty from '$lib/client/components/ui/empty';
  import { Spinner } from '$lib/client/components/ui/spinner';
  import type { ProjectSession } from '$lib/client/projects/project-session.svelte';
  import type { ProjectOperationKind } from '$lib/shared/projects/events';
  import type { ProjectCommandInput } from '$lib/shared/projects/model';
  import type { MessageContent as Message } from '$lib/shared/projects/events/message-content';
  import * as DropdownMenu from '$lib/client/components/ui/dropdown-menu';
  import {
    isStepName,
    isSverlinPresentation,
    sceneOfLabel,
    type PresentationLayout
  } from '$lib/shared/presentations';
  import { elidedName } from '$lib/client/artifacts/source-references';
  import { projectQuestions } from '$lib/shared/projects/questions';
  import { nearestDifference, stepRanges } from '$lib/shared/differing-steps';

  import { type PresentationSelection } from './presentation-selection.svelte';
  import {
    localPresentationStep,
    presentationHeld,
    presentationPlaybackContext,
    type PresentationPlayback
  } from './presentation-playback.svelte';
  import { comparisonProgress, pairQuestion, timelinePresentations } from './presentation-history';
  import PresentationViewport from './PresentationViewport.svelte';
  import { assistantTurnAfter, blankStarter, stageActivity } from './stage-activity';
  import type { VisualSelection, VisualSelections } from './visual-selection.svelte';
  import type { CanvasView } from '$lib/modes/sandbox';
  import type { PairAnswers } from './pair-answers';

  type PairAnswer = { kind: 'preferred'; presentationId: string } | { kind: 'tie' | 'skip' };

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
    /** What the participant wrote in the chat, sent with an answer to the pair as its comment. */
    takeComment?: () => Message | undefined;
    /** The comment was sent with the answer, so the chat can let it go. */
    onCommentSent?: () => void;
    /** The chat shows the pair's answers in place of its Submit (see `pairAnswers`), so the stage does not. */
    answersInChat?: boolean;
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
    hidden = false,
    takeComment = () => undefined,
    onCommentSent = () => {},
    answersInChat = false
  }: Props = $props();
  // Whether an answer to the shown pair is being saved.
  let answering = $state(false);
  // The answer just given to one of the assistant's comparisons, marked before it is recorded.
  let picked = $state<{ displaySetId?: string; answer: PairAnswer }>();

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
  // The comparison's answer as marked: the one just given until it is recorded, then the latest.
  const markedAnswer = $derived(
    question && picked && picked.displaySetId === visible[0].displaySetId ? picked.answer : recorded
  );
  // The pair just answered, kept dimmed while the assistant replies to it.
  const awaiting = $derived(selection.awaiting(session.events, layout));
  // A reply on its way that will change the stage, which the pair's answers wait for.
  const replyPending = $derived(
    visible.length === 2 && assistantTurnAfter(session.events, visible[0].operationId)
  );
  const uid = $props.id();
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
  // Whether the assistant, or any operation, is working on the project.
  const working = $derived(preparing || session.assistantResponding || !!activity);
  // Before a project's first version, a loader shows while it is made: on the empty stage, as every
  // system shows it, or over a blank project's starter, which stands in for that version.
  const firstVersionPending = $derived(timelinePresentations(session.events).length === 0);
  const makingFirst = $derived(
    working &&
      visible.length > 0 &&
      visible.every(({ presentation }) => blankStarter(session.events, presentation))
  );
  // A later turn with no comparison up: the version shown stays, dimmed a little, until it ends.
  const updatingVersion = $derived(
    session.assistantResponding && !question && !makingFirst && visible.length > 0
  );
  // What the stage says it is doing, and how it dims the version it shows meanwhile.
  const status = $derived(
    awaiting === 'updating' || updatingVersion
      ? 'Updating…'
      : awaiting || makingFirst
        ? undefined
        : activity?.label
  );
  const dimmed = $derived<'answered' | 'replaced' | 'updating' | undefined>(
    awaiting === 'updating'
      ? 'answered'
      : activity?.replacing
        ? 'replaced'
        : updatingVersion
          ? 'updating'
          : undefined
  );
  // Which of its operation's comparisons this is, and whether it has just replaced the one answered.
  const progress = $derived(
    question ? comparisonProgress(timelinePresentations(session.events), visible) : undefined
  );
  const arrived = $derived(selection.arrived(session.events, layout));
  /**
   * A comparison that replaces the one answered takes the focus the answer's button had, so the
   * keyboard and screen readers continue from its question.
   */
  function focusOnArrival(bar: HTMLElement) {
    if (!arrived) return;
    const focused = document.activeElement;
    if (focused === document.body || (focused && bar.closest('section')?.contains(focused)))
      bar.focus({ preventScroll: true });
  }
  /**
   * A version's entrance: one of the assistant's comparisons fades in, anything else slides;
   * neither moves with reduced motion.
   */
  function enter(node: Element) {
    if (prefersReducedMotion.current) return { duration: 0 };
    return question ? fade(node, { duration: 250 }) : fly(node, { x: 24, duration: 180 });
  }
  const playbackContext = $derived(presentationPlaybackContext(visible));
  $effect.pre(() => {
    const context = playbackContext;
    untrack(() => playback.activate(context));
  });
  // A comparison shown again from the timeline opens at its first difference, as a new one does;
  // once, so stepping from there is free.
  let reopenedShown: object | undefined;
  $effect.pre(() => {
    const reopened = selection.reopened;
    const context = playbackContext;
    if (!reopened || reopened === reopenedShown) return;
    const ids = visible.map(({ presentation }) => presentation.presentationId);
    if (ids.length !== 2 || !reopened.ids.every((id) => ids.includes(id))) return;
    reopenedShown = reopened;
    untrack(() => playback.openAtFirstDifference(context));
  });
  const step = $derived(playback.stepFor(playbackContext));
  const stepCount = $derived(playbackContext.stepCount);
  // The step's name, its label elided at the start as chat pills are (@…compare.left#3); in
  // developer view only, as participants follow the step's number.
  // The scene the step is in, where a Sverlin storyboard has several: its name and its title.
  const scene = $derived.by(() =>
    visible.length && visible.every(({ presentation }) => isSverlinPresentation(presentation))
      ? sceneOfLabel(playbackContext.frames[step]?.label)
      : undefined
  );
  const sceneText = $derived(scene && `${scene.scene}${scene.title ? ` — ${scene.title}` : ''}`);
  const stepName = $derived.by(() => {
    if (!session.developerView) return undefined;
    const label = scene ? scene.step : playbackContext.frames[step]?.label;
    return isStepName(label) ? label : undefined;
  });
  const shownStepName = $derived.by(() => {
    if (!stepName) return undefined;
    const [label, run] = stepName.split('#');
    const parts = elidedName(label);
    return parts ? `${parts.head}…${parts.tail}#${run}` : stepName;
  });
  // Where a pair's sides draw differently, as the server laid them out, and the nearest either way.
  const differsAt = $derived(playbackContext.differsAt);
  const earlierDifference = $derived(differsAt && nearestDifference(differsAt, step, -1));
  const laterDifference = $derived(differsAt && nearestDifference(differsAt, step, 1));
  const selectedIds = $derived(visible.map(({ presentation }) => presentation.presentationId));
  // A selection belongs to its step and its presentation; stepping or switching drops it.
  $effect(() => {
    const ids = selectedIds;
    const current = step;
    untrack(() => visualSelections.retain(ids, current));
  });
  // The answer given, its button filled: the side preferred, either (tie) or unsure (skip); the
  // comparison's latest answer, or for another pair its answer at this step.
  const chosen = $derived.by((): string | undefined => {
    if (visible.length !== 2) return undefined;
    if (question)
      return markedAnswer?.kind === 'preferred' ? markedAnswer.presentationId : markedAnswer?.kind;
    const preference = session.events.findLast(
      (event) =>
        event.type === 'visualization.preference-recorded' &&
        event.payload.step === step &&
        event.payload.presentations.every((id) => selectedIds.includes(id))
    );
    if (preference?.type !== 'visualization.preference-recorded') return undefined;
    return 'preferred' in preference.payload
      ? preference.payload.preferred
      : preference.payload.outcome;
  });
  // The four answers, one set of buttons; the pair is stacked, so its sides are top and bottom.
  const answers = $derived([
    {
      answer: selectedIds[0],
      label: 'Prefer the top version',
      text: 'Top',
      icons: [CheckIcon, ArrowUpIcon]
    },
    {
      answer: selectedIds[1],
      label: 'Prefer the bottom version',
      text: 'Bottom',
      icons: [CheckIcon, ArrowDownIcon]
    },
    { answer: 'tie', label: 'Either is fine', text: 'Either', icons: [EqualIcon] },
    {
      answer: 'skip',
      label: 'Unsure — no preference recorded',
      text: 'Unsure',
      icons: [CircleQuestionMarkIcon]
    }
  ]);

  /** The pair's answers, for the chat to show: the four buttons, the one given, and whether they wait. */
  export function pairAnswers(): PairAnswers {
    return {
      answers,
      chosen,
      disabled: disabled || answering || !!awaiting || replyPending,
      waiting: replyPending && !awaiting
    };
  }

  function seek(next: number) {
    playback.seek(playbackContext, next);
  }

  /**
   * Answer the pair: prefer one side, or say either is fine (tie) or unsure (skip). What follows
   * shows as the selection decides (`PresentationSelection.answer`); if the answer cannot be saved,
   * the pair shows again at its step.
   */
  export async function prefer(answer: string | 'tie' | 'skip'): Promise<void> {
    if (visible.length !== 2 || answering) return;
    const answered = visible;
    const at = step;
    const tieOrSkip = answer === 'tie' || answer === 'skip';
    const comment = takeComment();
    const command: ProjectCommandInput = {
      type: 'prefer',
      presentations: [selectedIds[0], selectedIds[1]],
      ...(tieOrSkip ? { outcome: answer } : { preferred: answer }),
      step: at,
      ...(comment ? { comment } : {})
    };
    answering = true;
    picked = {
      displaySetId: answered[0].displaySetId,
      answer: tieOrSkip ? { kind: answer } : { kind: 'preferred', presentationId: answer }
    };
    try {
      const saved = await selection.answer(
        answered,
        () => session.runCommand(command),
        session.head
      );
      if (!saved) playback.seek(presentationPlaybackContext(answered), at);
      else if (comment) onCommentSent();
    } finally {
      answering = false;
      picked = undefined;
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

{#snippet loader(title: string)}
  <Empty.Root class="border-0" aria-live="polite">
    <Empty.Header>
      <Empty.Media><Spinner /></Empty.Media>
      <Empty.Title>{title}</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{/snippet}

{#snippet controls()}
  <div
    class="flex min-h-14 shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-2 border-y bg-background px-3 py-2"
    data-replay-region="presentation-controls"
  >
    <!-- Stepping, apart from the answers so neither is taken for the other. -->
    <div class="flex max-w-full min-w-0 items-center gap-2">
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
      <div class="flex w-72 min-w-0 flex-col items-center">
        <span
          class="w-full truncate text-center text-sm whitespace-nowrap text-muted-foreground"
          title={[sceneText, stepName].filter(Boolean).join(': ') || undefined}
        >
          {stepCount ? `Step ${step + 1} of ${stepCount}` : 'No steps'}{#if sceneText}<span
              class="mx-1">·</span
            ><span class="text-foreground" data-replay-region="scene-name">{sceneText}</span
            >{/if}{#if shownStepName}<span class="mx-1">·</span><code class="font-mono text-xs"
              >{shownStepName}</code
            >{/if}
        </span>
        {#if differsAt?.length}
          <!-- Where the pair differs, the only steps worth comparing, and a jump to the nearest, its
            buttons 32-pixel targets that reach a little into the rows around. -->
          <span
            class="flex max-w-full items-center gap-1 text-xs text-muted-foreground"
            data-replay-region="differing-steps"
          >
            <Button
              size="icon"
              variant="ghost"
              class="-my-1"
              aria-label="Previous step that differs"
              title="Previous step that differs"
              onclick={() => earlierDifference !== undefined && seek(earlierDifference)}
              disabled={earlierDifference === undefined}
            >
              <ChevronsLeftIcon />
            </Button>
            <span class="truncate">
              Differs at step{differsAt.length > 1 ? 's' : ''}
              {stepRanges(differsAt)}
            </span>
            <Button
              size="icon"
              variant="ghost"
              class="-my-1"
              aria-label="Next step that differs"
              title="Next step that differs"
              onclick={() => laterDifference !== undefined && seek(laterDifference)}
              disabled={laterDifference === undefined}
            >
              <ChevronsRightIcon />
            </Button>
          </span>
        {/if}
      </div>
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
    </div>
    {#if layout === 'comparison' && visible.length === 2 && !answersInChat}
      <!-- The answers, on a tinted strip of their own. -->
      <div
        class="flex flex-wrap items-center justify-center gap-1.5 rounded-lg bg-muted p-1"
        role="group"
        aria-label="Your answer"
        aria-describedby={replyPending && !awaiting ? `${uid}-unavailable` : undefined}
      >
        {#each answers as { answer, label, text, icons } (answer)}
          <Button
            size="lg"
            variant={chosen === answer ? 'default' : 'outline'}
            aria-label={label}
            title={label}
            onclick={() => prefer(answer)}
            disabled={disabled || answering || !!awaiting || replyPending}
          >
            {#each icons as Icon, index (index)}<Icon
                data-icon={index === 0 ? 'inline-start' : undefined}
                class={index > 0 ? '-ml-1' : undefined}
              />{/each}
            {text}
          </Button>
        {/each}
      </div>
      {#if replyPending && !awaiting}
        <p id={`${uid}-unavailable`} class="text-sm text-muted-foreground" role="status">
          Answer once the assistant has replied.
        </p>
      {/if}
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
      <!-- Tinted for a moment when it replaces the comparison just answered; the colour changes at
        once with reduced motion. -->
      <p
        {@attach focusOnArrival}
        tabindex="-1"
        class={[
          'shrink-0 border-b px-3 py-2 text-center text-base font-medium outline-none',
          'transition-colors duration-700 motion-reduce:transition-none',
          arrived ? 'bg-primary/15' : 'bg-background'
        ]}
        data-replay-region="comparison-question"
      >
        {#if progress && progress.count > 1}
          <span class="mr-2 text-sm font-normal text-muted-foreground tabular-nums">
            Question {progress.number} of {progress.count}
          </span>
        {/if}
        <MessageContent content={[{ type: 'markdown', text: question }]} inline />
        {#if recorded && !picked && !awaiting}
          <!-- What was answered, which the controls below change. -->
          <span class="block text-sm font-normal text-muted-foreground">
            {recorded.kind === 'skip'
              ? 'You were unsure; answer it now if you like.'
              : 'You answered this; choose again to change your answer.'}
          </span>
        {/if}
      </p>
    {/if}
    {#each visible as entry, index (entry.presentation.presentationId)}
      {@const presentationId = entry.presentation.presentationId}
      {@const choice =
        markedAnswer?.kind === 'tie'
          ? 'Either is fine'
          : markedAnswer?.kind === 'preferred' && markedAnswer.presentationId === presentationId
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
        in:enter
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
            {#if index === 0 && status}
              <p
                class="flex items-center gap-1.5 rounded-md border bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm"
                role="status"
                aria-live="polite"
              >
                <Spinner class="size-3" aria-hidden="true" />{status}
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
          {#if makingFirst}
            <!-- Over the starter, which stays laid out beneath so nothing moves when it lifts. -->
            <div class="absolute inset-0 z-20 flex bg-background">
              {@render loader('Making a first version…')}
            </div>
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
          <!-- Dimmed while an operation replaces it, so it reads as the old version, a little while the
            assistant works on it, and greyed while the assistant replies to the pair. -->
          <div
            inert={makingFirst}
            class={[
              'flex min-h-0 min-w-0 flex-1 transition-[opacity,filter]',
              dimmed === 'replaced' && 'opacity-60',
              dimmed === 'updating' && 'opacity-75',
              dimmed === 'answered' && 'opacity-50 grayscale'
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
      {#if working}
        {@render loader(
          firstVersionPending ? 'Making a first version…' : 'Preparing a visualization…'
        )}
      {:else}
        <Empty.Root class="border-0" aria-live="polite">
          <Empty.Header>
            <Empty.Title>Your visualization will appear here.</Empty.Title>
          </Empty.Header>
        </Empty.Root>
      {/if}
    </div>
  {/if}
</section>
