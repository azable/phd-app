<script lang="ts">
  import { resolve } from '$app/paths';
  import { tick } from 'svelte';
  import { fly } from 'svelte/transition';

  import { Button } from '$lib/client/components/ui/button';
  import { ScrollArea } from '$lib/client/components/ui/scroll-area';
  import { Spinner } from '$lib/client/components/ui/spinner';
  import type { ProjectSession } from '$lib/client/projects/project-session.svelte';
  import type { PresentationSelection } from '$lib/client/visualization/presentation-selection.svelte';
  import type { PresentationLayout } from '$lib/shared/presentations';
  import type { TimelinePresentation } from '$lib/client/visualization/presentation-history';
  import type { ElementReference } from '$lib/shared/projects/events/message-content';

  import ParticipantTimeline from './ParticipantTimeline.svelte';
  import TimelineEventCard from './TimelineEventCard.svelte';
  import { presentProjectEvent } from './event-presentation';

  /** Public properties for the project Timeline. */
  type Props = {
    session: ProjectSession;
    seed: number;
    selection: PresentationSelection;
    layout: PresentationLayout;
    inspect?: boolean;
    onPresentationChange?: () => void;
    onViewportChange?: (value: {
      following: boolean;
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      normalized: number;
    }) => void;
    onReferenceRequest?: (presentation: TimelinePresentation) => void;
    /** Show an element reference: seek to its step and select it in its presentation. */
    onElementReference?: (reference: ElementReference) => void;
    /** Show what the chosen source changes from the source it was made from, or nothing. */
    onShowChanges?: (changes: { sourceHash: string; parentHash: string } | undefined) => void;
  };

  let {
    session,
    seed,
    selection,
    layout,
    inspect = false,
    onPresentationChange = () => {},
    onViewportChange = () => {},
    onReferenceRequest = () => {},
    onElementReference = () => {},
    onShowChanges = () => {}
  }: Props = $props();
  let viewport = $state<HTMLElement | null>(null);
  let timelineEnd = $state<HTMLElement | null>(null);
  let following = $state(true);
  const activityProgress = $derived.by(() => {
    const pendingEvent = session.pendingEvent;
    if (pendingEvent) return presentProjectEvent(pendingEvent).progress;
    if (session.assistantResponding) return 'Assistant is responding…';
    if (session.pending) return 'Recording the update…';
    return 'Generating more visualizations…';
  });
  const projectPath = $derived(
    `${resolve('/projects/[projectId]', { projectId: session.projectId })}${inspect ? '?dev=1' : ''}`
  );

  $effect(() => {
    const node = viewport;
    if (!node) return;
    const updateFollowing = () => {
      following = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      const maximum = Math.max(0, node.scrollHeight - node.clientHeight);
      onViewportChange({
        following,
        scrollTop: Math.max(0, Math.round(node.scrollTop)),
        scrollHeight: Math.max(0, Math.round(node.scrollHeight)),
        clientHeight: Math.max(0, Math.round(node.clientHeight)),
        normalized: maximum ? Math.min(1, Math.max(0, node.scrollTop / maximum)) : 1
      });
    };
    updateFollowing();
    node.addEventListener('scroll', updateFollowing, { passive: true });
    return () => node.removeEventListener('scroll', updateFollowing);
  });

  $effect.pre(() => {
    const eventCount = session.events.length;
    if (!session.atHead || !following || eventCount === 0) return;
    void tick().then(() => timelineEnd?.scrollIntoView({ block: 'end' }));
  });
</script>

<section class="flex min-h-0 flex-1 flex-col" aria-label="Project Timeline">
  {#if !session.atHead}
    <div class="flex items-center gap-2 border-b bg-muted px-4 py-2 text-sm">
      <span class="mr-auto"
        >Viewing historical state · mutations are disabled; playback remains available</span
      >
      <Button href={projectPath} size="sm" variant="outline" aria-label="Return to present"
        >Return to present</Button
      >
    </div>
  {/if}
  <ScrollArea bind:viewportRef={viewport} class="min-h-0 flex-1">
    <ol class:timeline={inspect} class="flex flex-col gap-3 p-4" class:pr-6={inspect}>
      {#if inspect}
        {#each session.events as event (event.id)}
          <li class="timeline-event relative pl-8" in:fly={{ y: 12, duration: 180 }}>
            <TimelineEventCard {event} {seed} {session} {inspect} />
          </li>
        {/each}
        {#if session.pending || session.assistantResponding || session.refillPending}
          <li class="timeline-event relative pl-8" in:fly={{ y: 12, duration: 180 }}>
            <div
              class="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-base text-muted-foreground shadow-md"
              role="status"
            >
              <Spinner />
              <span>{activityProgress}</span>
            </div>
          </li>
        {/if}
      {:else}
        <ParticipantTimeline
          {session}
          {selection}
          {layout}
          {onPresentationChange}
          {onReferenceRequest}
          {onElementReference}
          {onShowChanges}
        />
      {/if}
      <li class="h-px" aria-hidden="true"><span bind:this={timelineEnd}></span></li>
    </ol>
  </ScrollArea>
</section>

<style>
  .timeline {
    --timeline-stalk: color-mix(in oklab, var(--primary) 42%, var(--border));
  }

  .timeline-event::before {
    position: absolute;
    top: -0.75rem;
    bottom: -0.75rem;
    left: 0.72rem;
    width: 2px;
    content: '';
    background: var(--timeline-stalk);
  }

  .timeline-event:first-child::before {
    top: 1rem;
  }

  .timeline-event:nth-last-child(2)::before {
    bottom: calc(100% - 1rem);
  }
</style>
