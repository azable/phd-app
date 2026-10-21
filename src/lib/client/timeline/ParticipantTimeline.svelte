<script lang="ts">
  import { fly } from 'svelte/transition';

  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import UserRoundIcon from '@lucide/svelte/icons/user-round';

  import * as Avatar from '$lib/client/components/ui/avatar';
  import { Button } from '$lib/client/components/ui/button';
  import { Spinner } from '$lib/client/components/ui/spinner';
  import type { ProjectSession } from '$lib/client/projects/project-session.svelte';
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
  import { participantTimeline } from './participant-timeline';

  type Props = {
    session: ProjectSession;
    selection: PresentationSelection;
    layout: PresentationLayout;
    onPresentationChange?: () => void;
    onReferenceRequest?: (presentation: TimelinePresentation) => void;
    /** Show an element reference: seek to its step and select it in its presentation. */
    onElementReference?: (reference: ElementReference) => void;
    /** Show what the chosen source changes from the source it was made from, or nothing. */
    onShowChanges?: (changes: { sourceHash: string; parentHash: string } | undefined) => void;
  };

  let {
    session,
    selection,
    layout,
    onPresentationChange = () => {},
    onReferenceRequest = () => {},
    onElementReference = () => {},
    onShowChanges = () => {}
  }: Props = $props();
  // Chips and labels elsewhere hold only a presentation id; this names each candidate for them.
  $effect(() => rememberCandidates(timelinePresentations(session.events)));
  const items = $derived(participantTimeline(session.events));
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

  // The source whose card was chosen, rather than one of its variants.
  let chosenSource = $state<string | undefined>();

  function chooseSource(
    item: Extract<(typeof items)[number], { kind: 'version' }>,
    event: MouseEvent
  ) {
    const newest = item.variants.at(-1);
    if (!newest) return;
    activatePresentation(newest, event);
    chosenSource = item.sourceHash;
    onShowChanges(
      item.parentHash ? { sourceHash: item.sourceHash, parentHash: item.parentHash } : undefined
    );
  }

  function chooseVariant(variant: TimelinePresentation, event: MouseEvent) {
    activatePresentation(variant, event);
    chosenSource = undefined;
    onShowChanges(undefined);
  }

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
    {:else if item.kind === 'version'}
      {@const current = item.variants.some(({ presentation }) =>
        selectedIds.includes(presentation.presentationId)
      )}
      {@const chosen = current && chosenSource === item.sourceHash}
      <article
        id={`version-${item.sourceHash}`}
        class={[
          'relative w-full rounded-2xl border bg-card px-4 py-3 shadow-md transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg',
          current && 'border-primary',
          chosen && 'bg-muted',
          shown === item.sourceHash && 'ring-2 ring-ring'
        ]}
      >
        <!-- Choosing the card shows its source: its newest variant, and what it changes. -->
        <button
          type="button"
          class="absolute inset-0 rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={`Source ${sourceId(item.sourceHash).source}: ${item.summary}`}
          aria-pressed={chosen}
          onclick={(event) => chooseSource(item, event)}
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
          <p class={['mt-2 text-base', !item.described && 'text-muted-foreground']}>
            {item.summary}
          </p>
          <div class="mt-2 flex flex-wrap justify-end gap-1">
            {#each item.variants as variant (variant.presentation.presentationId)}
              {@const id = variant.presentation.presentationId}
              {@const selected = selectedIds.includes(id) && !chosen}
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
    {:else}
      <article
        class="w-full rounded-2xl border border-destructive/50 bg-destructive/10 px-4 py-3 shadow-md"
      >
        <p class="text-sm font-medium text-destructive">The request could not be completed</p>
        <p class="mt-1 text-base">{item.text}</p>
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
