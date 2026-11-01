<script lang="ts">
  import { fly } from 'svelte/transition';

  import BotIcon from '@lucide/svelte/icons/bot';
  import CheckIcon from '@lucide/svelte/icons/check';
  import CircleQuestionMarkIcon from '@lucide/svelte/icons/circle-question-mark';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import GaugeIcon from '@lucide/svelte/icons/gauge';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import StickyNoteIcon from '@lucide/svelte/icons/sticky-note';
  import UserRoundIcon from '@lucide/svelte/icons/user-round';
  import XIcon from '@lucide/svelte/icons/x';

  import {
    codeIn,
    codeMarkdown,
    type ReferenceDesign
  } from '$lib/client/artifacts/source-references';
  import * as Avatar from '$lib/client/components/ui/avatar';
  import { Button } from '$lib/client/components/ui/button';
  import { Spinner } from '$lib/client/components/ui/spinner';
  import type { ProjectSession } from '$lib/client/projects/project-session.svelte';
  import { sourceLinksContext } from '$lib/client/projects/source-links.svelte';
  import CandidateIdPill from '$lib/client/visualization/CandidateIdPill.svelte';
  import {
    candidateId,
    pairQuestion,
    presentationDisplayId,
    presentationsById,
    sourceId,
    rememberCandidates,
    timelinePresentations,
    type TimelinePresentation
  } from '$lib/client/visualization/presentation-history';
  import type { PresentationSelection } from '$lib/client/visualization/presentation-selection.svelte';
  import { isSverlinPresentation, type PresentationLayout } from '$lib/shared/presentations';
  import type {
    ElementReference,
    MessageContent as Content,
    MessageContentSegment
  } from '$lib/shared/projects/events/message-content';
  import type { ProjectQuestion } from '$lib/shared/projects/questions';

  import MessageContent from './MessageContent.svelte';
  import PresentationPill from './PresentationPill.svelte';
  import { presentProjectEvent } from './event-presentation';
  import { agentOutcome, agentReasoning, agentTokens } from './agent-requests';
  import { loadReportLine } from './load-reports';
  import { participantTimeline, type VersionPill } from './participant-timeline';

  type Props = {
    session: ProjectSession;
    selection: PresentationSelection;
    layout: PresentationLayout;
    onPresentationChange?: () => void;
    onReferenceRequest?: (presentation: TimelinePresentation) => void;
    /** Show an element reference: seek to its step and select it in its presentation. */
    onElementReference?: (reference: ElementReference) => void;
    /** Highlight the elements a question about a presentation names, once it is shown. */
    onQuestionElements?: (presentationId: string, elements: readonly string[]) => void;
    /** The source chosen on its own, by a pill's code button, if any. */
    chosenSource?: string;
    /** Choose a source on its own, or none, as when one of its variants is chosen. */
    onChooseSource?: (source: { sourceHash: string; parentHash?: string } | undefined) => void;
    /** Show each request to a model, for audit, as in developer view. */
    audit?: boolean;
    /** The request chosen for audit, if any, by its event id. */
    chosenRequest?: number;
    onChooseRequest?: (eventId: number | undefined) => void;
    /** The failure whose source is shown, if any, by its event id. */
    chosenFailure?: number;
    /** Show the source a failure did not build, or none. */
    onChooseFailure?: (
      failure: { eventId: number; source: string; by: 'assistant' | 'save' } | undefined
    ) => void;
  };

  let {
    session,
    selection,
    layout,
    onPresentationChange = () => {},
    onReferenceRequest = () => {},
    onElementReference = () => {},
    onQuestionElements = () => {},
    chosenSource,
    onChooseSource = () => {},
    audit = false,
    chosenRequest,
    onChooseRequest = () => {},
    chosenFailure,
    onChooseFailure = () => {}
  }: Props = $props();
  // Chips and labels elsewhere hold only a presentation id; this names each candidate for them.
  $effect(() => rememberCandidates(timelinePresentations(session.events)));
  const items = $derived(participantTimeline(session.events, { audit }));
  const activityProgress = $derived.by(() => {
    const pendingEvent = session.pendingEvent;
    if (pendingEvent) return presentProjectEvent(pendingEvent).progress;
    if (session.assistantResponding) return 'Assistant is responding…';
    if (session.pending) return 'Recording your update…';
    return 'Generating more visualizations…';
  });
  const visible = $derived(selection.selected(session.events, layout));
  const selectedIds = $derived(visible.map(({ presentation }) => presentation.presentationId));
  // The comparison whose pair the stage shows, by its display set, while nothing hides the stage.
  const openPair = $derived(
    layout === 'comparison' &&
      !chosenSource &&
      chosenRequest === undefined &&
      chosenFailure === undefined &&
      pairQuestion(visible)
      ? visible[0].displaySetId
      : undefined
  );

  function activatePresentation(presentation: TimelinePresentation, event: MouseEvent) {
    onPresentationChange();
    selection.activate(presentation, session.events, layout, event.shiftKey);
  }

  // A pill's code button chooses its source on its own, showing no visualization; choosing the
  // pill shows its variant.
  function chooseSource(sourceHash: string, parentHash?: string) {
    onChooseSource({ sourceHash, ...(parentHash ? { parentHash } : {}) });
  }

  function chooseVariant(variant: TimelinePresentation, event: MouseEvent) {
    onChooseSource(undefined);
    activatePresentation(variant, event);
  }

  // An error message as Markdown: its code, where the source holds it, as source links.
  const links = sourceLinksContext();
  const errorMarkdown = (text: string, source: string, design?: ReferenceDesign) =>
    codeMarkdown(source ? codeIn(source, text, design) : [{ text, code: false }]);
  // What a source's first presentation's build records, which view choices its links are matched by.
  const designOf = (sourceHash: string | undefined): ReferenceDesign | undefined => {
    const presentation = timelinePresentations(session.events).find(
      ({ presentation }) =>
        isSverlinPresentation(presentation) && presentation.source.sha256 === sourceHash
    )?.presentation;
    return presentation?.format === 'browser-bundle-v1'
      ? { renders: presentation.renders, variant: presentation.variant }
      : undefined;
  };

  // The source a parent link last showed, outlined for a moment so the eye finds it.
  let shown = $state<string | undefined>();
  function showVersion(sourceHash: string) {
    document
      .getElementById(`version-${sourceHash}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    shown = sourceHash;
    setTimeout(() => (shown = shown === sourceHash ? undefined : shown), 1500);
  }

  /** Show the presentation a question is about, its elements highlighted. */
  function showQuestion(question: ProjectQuestion) {
    const [presentationId] = question.presentationIds;
    const presentation = timelinePresentations(session.events).find(
      ({ presentation: value }) => value.presentationId === presentationId
    );
    if (!presentation) return;
    onPresentationChange();
    onChooseSource(undefined);
    selection.activate(presentation, session.events, layout);
    onQuestionElements(presentationId, question.elements ?? []);
  }

  /** Show a comparison's pair side by side, as the stage shows a current one, to view or answer. */
  function showComparison(question: ProjectQuestion) {
    const pair = presentationsById(timelinePresentations(session.events), question.presentationIds);
    if (pair.length !== 2) return;
    onPresentationChange();
    onChooseSource(undefined);
    selection.showPair(pair, session.events, layout);
  }

  function activateReference(
    reference: Exclude<MessageContentSegment, { type: 'markdown' }>,
    extend: boolean
  ) {
    const presentation = timelinePresentations(session.events).find(
      ({ presentation: value }) => value.presentationId === reference.presentationId
    );
    if (!presentation) return;
    onPresentationChange();
    selection.activate(presentation, session.events, layout, extend);
    if (reference.type === 'element-ref') onElementReference(reference);
  }

  /** A reply with the pills of what it presented but did not name at its end. */
  const withAppended = (content: Content, appended: readonly string[]): Content => [
    ...content,
    ...appended.map((presentationId) => ({ type: 'presentation-ref' as const, presentationId }))
  ];
</script>

<!-- A presentation in an assistant's message: view, compare, its source, add to feedback. -->
{#snippet line(text: string)}
  <MessageContent content={[{ type: 'markdown', text }]} inline />
{/snippet}

{#snippet versionPill(pill: VersionPill, label?: string, onView?: (event: MouseEvent) => void)}
  {@const id = pill.value.presentation.presentationId}
  {@const sourceHash = pill.sourceHash}
  <PresentationPill
    candidate={candidateId(pill.value.presentation)}
    name={presentationDisplayId(id)}
    summary={pill.summary}
    {label}
    selected={selectedIds.includes(id) && !chosenSource}
    onView={onView ?? ((event) => chooseVariant(pill.value, event))}
    onSource={sourceHash ? () => chooseSource(sourceHash, pill.parentHash) : undefined}
    sourceShown={sourceHash !== undefined && chosenSource === sourceHash}
    onAdd={session.readOnly ? undefined : () => onReferenceRequest(pill.value)}
  />
{/snippet}

{#each items as item (item.id)}
  <li class="flex" class:justify-end={item.kind === 'message'} in:fly={{ y: 12, duration: 180 }}>
    {#if item.kind === 'message'}
      <article
        class="max-w-[88%] rounded-2xl border bg-primary px-4 py-3 text-primary-foreground shadow-md"
      >
        <div class="mb-2 flex flex-wrap items-center gap-2.5">
          <Avatar.Root size="lg" class="shadow-sm" aria-hidden="true">
            <Avatar.Fallback class="[&>svg]:size-5"><UserRoundIcon /></Avatar.Fallback>
          </Avatar.Root>
          <p class="text-base font-medium">{session.userAuthorLabel}</p>
        </div>
        <MessageContent content={item.content} inverted onReferenceActivate={activateReference} />
      </article>
    {:else if item.kind === 'turn'}
      {@const pills = item.pills}
      {#snippet inline(presentationId: string)}
        {@render versionPill(pills[presentationId])}
      {/snippet}
      <!-- One assistant turn: its reply naming its versions, the pills of those it did not name,
        its question, and its comparisons; a turn without a reply says what its versions show. -->
      <article
        class={[
          'max-w-[88%] rounded-2xl border bg-card px-4 py-3 shadow-md',
          shown && item.firsts.includes(shown) && 'ring-2 ring-ring'
        ]}
      >
        {#each item.firsts as sourceHash (sourceHash)}
          <span id={`version-${sourceHash}`}></span>
        {/each}
        {#if item.content}
          <div class="mb-2 flex flex-wrap items-center gap-2.5">
            <Avatar.Root size="lg" class="shadow-sm" aria-hidden="true">
              <Avatar.Fallback class="[&>svg]:size-5"><SparklesIcon /></Avatar.Fallback>
            </Avatar.Root>
            <p class="text-base font-medium">Assistant</p>
          </div>
          <MessageContent
            content={withAppended(item.content, item.appended)}
            onReferenceActivate={activateReference}
            pill={inline}
            pilled={(id) => id in pills}
          />
          {#if item.question}
            {@const { question, pill } = item.question}
            {@const about = pill ? pills[question.presentationIds[0]] : undefined}
            <!-- Its question, the reply's last paragraph, answered by the next message; one about a
              presentation shows it, its elements highlighted, with its pill where the reply does
              not already show it. -->
            <p class="mt-2 text-base leading-7 font-medium wrap-break-word">
              {#if question.presentationIds.length}<button
                  type="button"
                  class="max-w-full rounded-md text-left hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  title="Show what this question is about"
                  onclick={() => showQuestion(question)}>{@render line(question.text)}</button
                >{:else}{@render line(question.text)}{/if}{#if about}{@render versionPill(
                  about,
                  undefined,
                  () => showQuestion(question)
                )}{/if}
            </p>
          {/if}
        {:else}
          {#each item.summaries as summary (summary.sourceHash)}
            <div class="mb-1 flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
              {#if summary.described}
                <div class="min-w-0 flex-1">
                  <MessageContent
                    content={[{ type: 'markdown', text: summary.text }]}
                    source={summary.source}
                    design={designOf(summary.sourceHash)}
                    onRevealSource={() => chooseSource(summary.sourceHash, summary.parentHash)}
                  />
                </div>
              {:else}
                <p class="min-w-0 flex-1">{summary.text}</p>
              {/if}
              {#if summary.parentHash}
                {@const parent = summary.parentHash}
                <span class="flex items-center gap-1.5 text-xs">
                  <span>from</span>
                  <button
                    type="button"
                    class="group flex leading-none focus-visible:outline-none"
                    title="Show the source it was made from"
                    onclick={() => showVersion(parent)}
                  >
                    <CandidateIdPill {...sourceId(parent)} />
                  </button>
                </span>
              {/if}
            </div>
          {/each}
          {#if item.appended.length}
            <p class="flex flex-wrap gap-1">
              {#each item.appended as id (id)}{@render inline(id)}{/each}
            </p>
          {/if}
        {/if}
        {#each item.comparisons as { question, answer } (question.eventId)}
          {@const open = openPair !== undefined && openPair === question.displaySetId}
          <!-- A comparison: a card whose question shows its pair, each side by its label, marked
            by the latest answer; outlined while the stage shows its pair. The question's button
            stretches over the card, the side pills above it. -->
          <div class="mt-3 border-t pt-1.5 text-sm">
            <div
              class={[
                'relative -mx-2 rounded-lg px-2 py-1.5 transition-colors has-[.comparison-target:focus-visible]:ring-2 has-[.comparison-target:focus-visible]:ring-ring',
                open ? 'bg-muted ring-2 ring-ring' : 'has-[.comparison-target:hover]:bg-muted/60'
              ]}
            >
              <p class="font-medium wrap-break-word">
                <button
                  type="button"
                  class="comparison-target max-w-full text-left after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none"
                  title="Show this comparison"
                  aria-current={open ? 'true' : undefined}
                  onclick={() => showComparison(question)}>{@render line(question.text)}</button
                >
              </p>
              <div class="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2 leading-7">
                {#each question.presentationIds as id, slot (id)}
                  {@const label = question.labels?.[slot]}
                  {@const mark = Array.isArray(answer) ? answer[slot] : undefined}
                  {#if pills[id]}<span class="inline-flex min-w-0 items-center gap-1"
                      >{#if mark === 'chosen'}<span
                          class="inline-flex shrink-0 text-primary"
                          title="Your choice"
                          ><CheckIcon class="size-4" aria-hidden="true" /><span class="sr-only"
                            >Your choice:</span
                          ></span
                        >{:else if mark === 'not-chosen'}<span
                          class="inline-flex shrink-0 text-muted-foreground"
                          title="Not chosen"
                          ><XIcon class="size-4" aria-hidden="true" /><span class="sr-only"
                            >Not chosen:</span
                          ></span
                        >{/if}<span class="relative z-10 min-w-0"
                        >{@render versionPill(pills[id], label && `${label}:`)}</span
                      ></span
                    >{/if}
                {/each}
                {#if answer === 'unsure'}<span
                    class="inline-flex items-center gap-1 text-xs text-muted-foreground"
                    title="You were unsure"
                    ><CircleQuestionMarkIcon class="size-3.5" aria-hidden="true" />unsure</span
                  >{/if}
              </div>
            </div>
          </div>
        {/each}
      </article>
    {:else if item.kind === 'note'}
      {@const of = item.of}
      <article class="max-w-[88%] rounded-2xl border border-dashed bg-card px-4 py-3 shadow-md">
        <div class="mb-2 flex flex-wrap items-center gap-2.5">
          <Avatar.Root size="lg" class="shadow-sm" aria-hidden="true">
            <Avatar.Fallback class="[&>svg]:size-5"><StickyNoteIcon /></Avatar.Fallback>
          </Avatar.Root>
          <p class="text-base font-medium">Note</p>
        </div>
        <MessageContent
          content={[{ type: 'markdown', text: item.text }]}
          source={of?.source}
          design={designOf(of?.sourceHash)}
          onRevealSource={() =>
            of &&
            onChooseSource({
              sourceHash: of.sourceHash,
              ...(of.parentHash ? { parentHash: of.parentHash } : {})
            })}
        />
      </article>
    {:else if item.kind === 'request'}
      {@const request = item.value.request}
      {@const tokens = agentTokens(item.value)}
      {@const outcome = item.value.outcome}
      {@const chosen = chosenRequest === request.id}
      {@const reasoning = agentReasoning(item.value).summary}
      <!-- A request to a model, for audit: one compact line; choosing it shows its details, and
        its reasoning summary, where recorded, opens beneath it. -->
      <div class="ml-6 flex w-[calc(100%-1.5rem)] min-w-0 flex-col gap-0.5">
        <button
          type="button"
          class={[
            'flex w-full min-w-0 items-center gap-1.5 rounded-lg border border-dashed px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            chosen && 'border-solid border-primary bg-muted text-foreground'
          ]}
          aria-label={`Agent request ${request.id}: ${agentOutcome(item.value)}`}
          aria-pressed={chosen}
          onclick={() => onChooseRequest(chosen ? undefined : request.id)}
        >
          <BotIcon class="size-3.5 shrink-0" />
          <span class="shrink-0">{request.payload.attempt} · {request.payload.purpose}</span>
          <span class="truncate text-foreground">{agentOutcome(item.value)}</span>
          <span class="ml-auto shrink-0 font-mono">
            {outcome ? `${(outcome.payload.durationMs / 1000).toFixed(1)} s` : '…'}{tokens.read !==
            undefined
              ? ` · ${tokens.read.toLocaleString()}→${tokens.written?.toLocaleString() ?? '?'}`
              : ''}
          </span>
        </button>
        {#if reasoning.length}
          <details class="px-2 text-xs text-muted-foreground open:text-foreground">
            <summary class="cursor-pointer hover:text-foreground">Reasoning</summary>
            <div class="mt-1 flex flex-col gap-1 whitespace-pre-wrap">
              {#each reasoning as paragraph, index (index)}<p>{paragraph}</p>{/each}
            </div>
          </details>
        {/if}
      </div>
    {:else if item.kind === 'load'}
      {@const report = item.event.payload}
      {@const json = JSON.stringify(report, null, 2)}
      <!-- How a presentation loaded, for audit: one compact line; opening it shows the report. -->
      <details
        class="ml-6 w-[calc(100%-1.5rem)] min-w-0 rounded-lg border border-dashed px-2 py-1 text-xs text-muted-foreground open:border-solid open:bg-muted open:text-foreground"
      >
        <summary
          class="flex cursor-pointer list-none items-center gap-1.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <GaugeIcon class="size-3.5 shrink-0" />
          <span class="shrink-0">
            {report.outcome === 'ready' ? 'Loaded' : 'Stalled'}
            {presentationDisplayId(report.presentationId)}
          </span>
          <span class="truncate font-mono">{loadReportLine(report)}</span>
        </summary>
        <div class="relative mt-1">
          <Button
            variant="ghost"
            size="icon-sm"
            class="absolute top-0 right-0"
            aria-label="Copy the load report"
            title="Copy the load report"
            onclick={() => void navigator.clipboard.writeText(json)}
          >
            <CopyIcon />
          </Button>
          <pre class="max-h-80 overflow-auto font-mono text-[11px] whitespace-pre-wrap">{json}</pre>
        </div>
      </details>
    {:else if item.failed}
      {@const failed = item.failed}
      {@const chosen = chosenFailure === item.eventId}
      <!-- Choosing it shows the source that did not build, its problems underlined; code its
        message names links there, choosing it rather than the box. -->
      <article
        class={[
          'relative w-full rounded-2xl border border-destructive/50 bg-destructive/10 px-4 py-3 shadow-md transition-colors hover:border-destructive',
          chosen && 'border-destructive ring-2 ring-destructive/40'
        ]}
      >
        <button
          type="button"
          class="absolute inset-0 rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={`The request could not be completed: ${item.text}`}
          aria-pressed={chosen}
          title={chosen
            ? 'Hide the source that did not build'
            : 'Show the source that did not build'}
          onclick={() => onChooseFailure(chosen ? undefined : { eventId: item.eventId, ...failed })}
        ></button>
        <div class="pointer-events-none relative">
          <p class="text-sm font-medium text-destructive">The request could not be completed</p>
          <div class="mt-1 [&_code.source-ref]:pointer-events-auto">
            <MessageContent
              content={[{ type: 'markdown', text: errorMarkdown(item.text, failed.source) }]}
              source={failed.source}
              onRevealSource={() => onChooseFailure({ eventId: item.eventId, ...failed })}
            />
          </div>
        </div>
      </article>
    {:else}
      <article
        class="w-full rounded-2xl border border-destructive/50 bg-destructive/10 px-4 py-3 shadow-md"
      >
        <p class="text-sm font-medium text-destructive">The request could not be completed</p>
        <div class="mt-1">
          <MessageContent
            content={[
              {
                type: 'markdown',
                text: errorMarkdown(item.text, links?.shown ?? '', links?.shownDesign)
              }
            ]}
          />
        </div>
      </article>
    {/if}
  </li>
{/each}

{#if session.assistantResponding}
  <li in:fly={{ y: 12, duration: 180 }}>
    <div
      class="flex max-w-[88%] items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-base text-muted-foreground shadow-md"
      role="status"
    >
      <Spinner />
      <span>{activityProgress}</span>
    </div>
  </li>
{:else if session.pending}
  <li in:fly={{ y: 12, duration: 180 }}>
    <div
      class="flex max-w-[88%] items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-base text-muted-foreground shadow-md"
      role="status"
    >
      <Spinner />
      <span>{activityProgress}</span>
    </div>
  </li>
{:else if session.refillPending}
  <li in:fly={{ y: 12, duration: 180 }}>
    <div
      class="flex max-w-[88%] items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-base text-muted-foreground shadow-md"
      role="status"
    >
      <Spinner />
      <span>{activityProgress}</span>
    </div>
  </li>
{:else if session.refillError}
  <li in:fly={{ y: 12, duration: 180 }}>
    <div class="flex max-w-[88%] items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-md">
      <p class="text-sm text-muted-foreground">More visualizations could not be generated.</p>
      <Button size="sm" variant="outline" onclick={() => session.retryPresentationRefill()}
        >Retry</Button
      >
    </div>
  </li>
{/if}
