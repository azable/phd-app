<script lang="ts">
  import { fly } from 'svelte/transition';

  import BotIcon from '@lucide/svelte/icons/bot';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import StickyNoteIcon from '@lucide/svelte/icons/sticky-note';
  import UserRoundIcon from '@lucide/svelte/icons/user-round';

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
    presentationDisplayId,
    sourceId,
    rememberCandidates,
    timelinePresentations,
    type TimelinePresentation
  } from '$lib/client/visualization/presentation-history';
  import type { PresentationSelection } from '$lib/client/visualization/presentation-selection.svelte';
  import type { PresentationLayout } from '$lib/shared/presentations';
  import type {
    ElementReference,
    MessageContentSegment
  } from '$lib/shared/projects/events/message-content';

  import MessageContent from './MessageContent.svelte';
  import { presentProjectEvent } from './event-presentation';
  import { agentOutcome, agentTokens } from './agent-requests';
  import { participantTimeline } from './participant-timeline';

  type Props = {
    session: ProjectSession;
    selection: PresentationSelection;
    layout: PresentationLayout;
    onPresentationChange?: () => void;
    onReferenceRequest?: (presentation: TimelinePresentation) => void;
    /** Show an element reference: seek to its step and select it in its presentation. */
    onElementReference?: (reference: ElementReference) => void;
    /** The source chosen on its own, by its card, if any. */
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
  const selectedIds = $derived(
    selection
      .selected(session.events, layout)
      .map(({ presentation }) => presentation.presentationId)
  );

  function activatePresentation(presentation: TimelinePresentation, event: MouseEvent) {
    onPresentationChange();
    selection.activate(presentation, session.events, layout, event.shiftKey);
  }

  // Choosing a card chooses its source on its own, showing no visualization; choosing a variant
  // shows it.
  function chooseSource(item: Extract<(typeof items)[number], { kind: 'version' }>) {
    onChooseSource({
      sourceHash: item.sourceHash,
      ...(item.parentHash ? { parentHash: item.parentHash } : {})
    });
  }

  function chooseVariant(variant: TimelinePresentation, event: MouseEvent) {
    onChooseSource(undefined);
    activatePresentation(variant, event);
  }

  // An error message as Markdown: its code, where the source holds it, as source links.
  const links = sourceLinksContext();
  const errorMarkdown = (text: string, source: string, design?: ReferenceDesign) =>
    codeMarkdown(source ? codeIn(source, text, design) : [{ text, code: false }]);
  // What a card's first presentation's build records, which view choices its links are matched by.
  const designOf = (sourceHash: string | undefined): ReferenceDesign | undefined => {
    const card = items.find((item) => item.kind === 'version' && item.sourceHash === sourceHash);
    const presentation = card?.kind === 'version' ? card.variants[0]?.presentation : undefined;
    return presentation?.format === 'browser-bundle-v1'
      ? { renders: presentation.renders, variant: presentation.variant }
      : undefined;
  };

  // The source card a parent link last showed, outlined for a moment so the eye finds it.
  let shown = $state<string | undefined>();
  function showVersion(sourceHash: string) {
    document
      .getElementById(`version-${sourceHash}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    shown = sourceHash;
    setTimeout(() => (shown = shown === sourceHash ? undefined : shown), 1500);
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
</script>

{#each items as item (item.id)}
  <li
    class="flex"
    class:justify-end={item.kind === 'message' && item.actor === 'user'}
    in:fly={{ y: 12, duration: 180 }}
  >
    {#if item.kind === 'message'}
      <article
        class="max-w-[88%] rounded-2xl border px-4 py-3 shadow-md"
        class:bg-primary={item.actor === 'user'}
        class:text-primary-foreground={item.actor === 'user'}
        class:bg-card={item.actor === 'assistant'}
      >
        <div class="mb-2 flex flex-wrap items-center gap-2.5">
          <Avatar.Root size="lg" class="shadow-sm" aria-hidden="true">
            <Avatar.Fallback class="[&>svg]:size-5">
              {#if item.actor === 'user'}
                <UserRoundIcon />
              {:else}
                <SparklesIcon />
              {/if}
            </Avatar.Fallback>
          </Avatar.Root>
          <p class="text-base font-medium">
            {item.actor === 'user' ? session.userAuthorLabel : 'Assistant'}
          </p>
        </div>
        <MessageContent
          content={item.content}
          inverted={item.actor === 'user'}
          onReferenceActivate={activateReference}
        />
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
    {:else if item.kind === 'presentation'}
      {@const id = item.value.presentation.presentationId}
      {@const selected = selectedIds.includes(id)}
      <article
        class="relative w-full rounded-2xl border bg-card px-4 py-3 shadow-md transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg"
        class:border-primary={selected}
        class:bg-muted={selected}
      >
        <button
          type="button"
          class="absolute inset-0 rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={`Candidate ${presentationDisplayId(id)}`}
          aria-pressed={selected}
          onclick={(event) => activatePresentation(item.value, event)}
        ></button>
        <div class="pointer-events-none relative">
          <span class="flex items-baseline gap-2 text-base font-medium">
            <span>Candidate</span>
            {#if !session.readOnly}
              <button
                type="button"
                class="group pointer-events-auto relative z-10 ml-auto flex leading-none focus-visible:outline-none"
                aria-label={`Add ${presentationDisplayId(id)} to feedback`}
                title="Add to feedback"
                onclick={(event) => {
                  event.stopPropagation();
                  onReferenceRequest(item.value);
                }}
              >
                <CandidateIdPill {...candidateId(item.value.presentation)} />
              </button>
            {:else}
              <span class="ml-auto"
                ><CandidateIdPill {...candidateId(item.value.presentation)} /></span
              >
            {/if}
          </span>
          <span class="mt-1 block text-sm text-muted-foreground"> Click to view </span>
        </div>
      </article>
    {:else if item.kind === 'request'}
      {@const request = item.value.request}
      {@const tokens = agentTokens(item.value)}
      {@const outcome = item.value.outcome}
      {@const chosen = chosenRequest === request.id}
      <!-- A request to a model, for audit: one compact line; choosing it shows its details. -->
      <button
        type="button"
        class={[
          'ml-6 flex w-[calc(100%-1.5rem)] min-w-0 items-center gap-1.5 rounded-lg border border-dashed px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
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
    {:else if item.kind === 'version'}
      {@const current =
        !chosenSource &&
        item.variants.some(({ presentation }) => selectedIds.includes(presentation.presentationId))}
      {@const chosen = chosenSource === item.sourceHash}
      <article
        id={`version-${item.sourceHash}`}
        class={[
          'relative w-full rounded-2xl border bg-card px-4 py-3 shadow-md transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg',
          current && 'border-primary',
          chosen && 'border-primary bg-muted',
          shown === item.sourceHash && 'ring-2 ring-ring'
        ]}
      >
        <!-- Choosing the card shows its source on its own, and what it changes. -->
        <button
          type="button"
          class="absolute inset-0 rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={`Source ${sourceId(item.sourceHash).source}: ${item.summary.replaceAll('`', '')}`}
          aria-pressed={chosen}
          onclick={() => chooseSource(item)}
        ></button>
        <div class="pointer-events-none relative">
          <div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <CandidateIdPill {...sourceId(item.sourceHash)} />
            {#if item.parentHash}
              {@const parent = item.parentHash}
              <span>from</span>
              <button
                type="button"
                class="group pointer-events-auto relative z-10 flex leading-none focus-visible:outline-none"
                title="Show the source it was made from"
                onclick={() => showVersion(parent)}
              >
                <CandidateIdPill {...sourceId(parent)} />
              </button>
            {/if}
          </div>
          {#if item.described}
            <!-- Code it names links to its source; choosing a link shows the card, not the card's click. -->
            <div class="mt-2 [&_code.source-ref]:pointer-events-auto">
              <MessageContent
                content={[{ type: 'markdown', text: item.summary }]}
                source={item.source}
                design={designOf(item.sourceHash)}
                onRevealSource={() => chooseSource(item)}
              />
            </div>
          {:else}
            <p class="mt-2 text-base text-muted-foreground">{item.summary}</p>
          {/if}
          <div class="mt-2 flex flex-wrap justify-end gap-1">
            {#each item.variants as variant (variant.presentation.presentationId)}
              {@const id = variant.presentation.presentationId}
              {@const selected = selectedIds.includes(id) && !chosenSource}
              {@const values = candidateId(variant.presentation).values}
              <span
                class={[
                  'pointer-events-auto relative z-10 inline-flex overflow-hidden rounded-md font-mono text-[11px] leading-5 ring-1',
                  selected ? 'ring-primary' : 'ring-border'
                ]}
              >
                <button
                  type="button"
                  class={[
                    'px-1.5 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                    selected ? 'bg-primary/20' : 'bg-muted/60'
                  ]}
                  aria-label={`View variant ${values}`}
                  aria-pressed={selected}
                  title="View; Shift-click to compare"
                  onclick={(event) => chooseVariant(variant, event)}>{values}</button
                >
                {#if !session.readOnly}
                  <button
                    type="button"
                    class="border-l px-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none"
                    aria-label={`Add ${presentationDisplayId(id)} to feedback`}
                    title="Add to feedback"
                    onclick={() => onReferenceRequest(variant)}>+</button
                  >
                {/if}
              </span>
            {/each}
          </div>
        </div>
      </article>
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
