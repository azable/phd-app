<script lang="ts">
  import { resolve } from '$app/paths';
  import { tick } from 'svelte';

  import { Button } from '$lib/client/components/ui/button';
  import { ScrollArea } from '$lib/client/components/ui/scroll-area';
  import type { ProjectSession } from '$lib/client/projects/project-session.svelte';
  import type { PresentationSelection } from '$lib/client/visualization/presentation-selection.svelte';
  import type { PresentationLayout } from '$lib/shared/presentations';
  import type { TimelinePresentation } from '$lib/client/visualization/presentation-history';
  import type { ElementReference } from '$lib/shared/projects/events/message-content';

  import ParticipantTimeline from './ParticipantTimeline.svelte';

  /** Public properties for the project Timeline. */
  type Props = {
    session: ProjectSession;
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
    /** The source chosen on its own, by its card, if any. */
    chosenSource?: string;
    /** Choose a source on its own, or none, as when one of its variants is chosen. */
    onChooseSource?: (source: { sourceHash: string; parentHash?: string } | undefined) => void;
    /** The model request chosen for audit, if any, by its event id. */
    chosenRequest?: number;
    onChooseRequest?: (eventId: number | undefined) => void;
    /** The failure whose source is shown, if any, by its event id. */
    chosenFailure?: number;
    onChooseFailure?: (
      failure: { eventId: number; source: string; by: 'assistant' | 'save' } | undefined
    ) => void;
  };

  let {
    session,
    selection,
    layout,
    inspect = false,
    onPresentationChange = () => {},
    onViewportChange = () => {},
    onReferenceRequest = () => {},
    onElementReference = () => {},
    chosenSource,
    onChooseSource = () => {},
    chosenRequest,
    onChooseRequest = () => {},
    chosenFailure,
    onChooseFailure = () => {}
  }: Props = $props();
  let viewport = $state<HTMLElement | null>(null);
  let timelineEnd = $state<HTMLElement | null>(null);
  let following = $state(true);
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
    <ol class="flex flex-col gap-3 p-4">
      <ParticipantTimeline
        {session}
        {selection}
        {layout}
        {onPresentationChange}
        {onReferenceRequest}
        {onElementReference}
        {chosenSource}
        {onChooseSource}
        audit={inspect}
        {chosenRequest}
        {onChooseRequest}
        {chosenFailure}
        {onChooseFailure}
      />
      <li class="h-px" aria-hidden="true"><span bind:this={timelineEnd}></span></li>
    </ol>
  </ScrollArea>
</section>
