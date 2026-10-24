<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount, untrack } from 'svelte';

  import LogOutIcon from '@lucide/svelte/icons/log-out';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import SettingsIcon from '@lucide/svelte/icons/settings';

  import * as Alert from '$lib/client/components/ui/alert';
  import * as AlertDialog from '$lib/client/components/ui/alert-dialog';
  import { Badge } from '$lib/client/components/ui/badge';
  import { Button, buttonVariants } from '$lib/client/components/ui/button';
  import { Input } from '$lib/client/components/ui/input';
  import { Label } from '$lib/client/components/ui/label';
  import * as Resizable from '$lib/client/components/ui/resizable';
  import { Skeleton } from '$lib/client/components/ui/skeleton';
  import { Spinner } from '$lib/client/components/ui/spinner';
  import { Switch } from '$lib/client/components/ui/switch';
  import * as Tabs from '$lib/client/components/ui/tabs';
  import PhaseExpiredDialog from '$lib/client/study/PhaseExpiredDialog.svelte';
  import { ProjectInteractionRecorder } from '$lib/client/study/interaction-recorder';
  import StudyTimer from '$lib/client/study/StudyTimer.svelte';
  import FeedbackComposer from '$lib/client/timeline/FeedbackComposer.svelte';
  import Timeline from '$lib/client/timeline/Timeline.svelte';
  import { agentRequestAt } from '$lib/client/timeline/agent-requests';
  import PresentationStage from '$lib/client/visualization/PresentationStage.svelte';
  import {
    presentationPlaybackContext,
    PresentationPlayback
  } from '$lib/client/visualization/presentation-playback.svelte';
  import { PresentationSelection } from '$lib/client/visualization/presentation-selection.svelte';
  import {
    candidateId,
    timelinePresentations
  } from '$lib/client/visualization/presentation-history';
  import { VisualSelections } from '$lib/client/visualization/visual-selection.svelte';
  import type { PresentationLayout } from '$lib/shared/presentations';
  import type { ProjectTemplateSummary } from '$lib/shared/projects/creation';
  import type { EventId } from '$lib/shared/projects/events';
  import type {
    ElementReference,
    MessageContent
  } from '$lib/shared/projects/events/message-content';
  import { activeProjectOperation } from '$lib/shared/projects/operations';
  import type { DrawnStep } from '$lib/shared/projects/events/message-content';
  import { locateElement } from '$lib/modes/sverlin/element-ref';
  import type {
    StudyInteractionCapturePolicy,
    StudyWorkspaceObservation
  } from '$lib/shared/study/interactions';

  import NewProjectDialog from './NewProjectDialog.svelte';
  import AgentRequestAudit from './AgentRequestAudit.svelte';
  import ProjectArtifactPanel, {
    type ProjectArtifactEditMode
  } from './ProjectArtifactPanel.svelte';
  import { ProjectSession } from './project-session.svelte';
  import { shouldShowPhaseExpiredDialog } from './study-controls';

  type StudyTask =
    | {
        context: 'participant';
        participantId: string;
        runId: string;
        phaseId: string;
        title: string;
        prompt: string;
        deadlineAt?: string;
        expired: boolean;
        layout: PresentationLayout;
        presentationBufferTarget?: number;
        allowEarlyCompletion: boolean;
        interactionCapture?: StudyInteractionCapturePolicy;
        applicationVersion?: string;
        buildSha?: string;
      }
    | {
        context: 'admin-preview';
        runId: string;
        phaseId: string;
        title: string;
        prompt: string;
        deadlineAt: string;
        expired: boolean;
        layout: PresentationLayout;
        presentationBufferTarget?: number;
        allowEarlyCompletion: false;
      };

  type Props = {
    projectId: string;
    templates: ProjectTemplateSummary[];
    authEnabled?: boolean;
    isAdmin?: boolean;
    at?: EventId;
    devMode?: boolean;
    readOnly?: boolean;
    study?: StudyTask;
  };

  let {
    projectId,
    templates,
    authEnabled = false,
    isAdmin = false,
    at,
    devMode = false,
    readOnly = false,
    study
  }: Props = $props();

  // The route keys this component by project ID, so the session is intentionally instance-scoped.
  // svelte-ignore state_referenced_locally
  const session = new ProjectSession(
    projectId,
    isAdmin && study?.context !== 'admin-preview' && !readOnly && devMode,
    study?.layout ?? 'single',
    study?.expired || readOnly ? undefined : study?.presentationBufferTarget,
    readOnly
  );
  const presentationSelection = new PresentationSelection(
    untrack(() => !!study?.presentationBufferTarget),
    // Outside studies the selection implies the layout: two variants compare, one is shown alone.
    (next) => {
      if (!showAdminControls || busy) return false;
      layout = next;
      return true;
    }
  );
  const presentationPlayback = new PresentationPlayback();
  // Elements selected in the visible presentations, to reference in feedback.
  const visualSelections = new VisualSelections();

  // Each selection with the source its presentation was built from, for the source panel.
  const selectedSources = $derived(
    visualSelections.current.flatMap((selection) => {
      const presentation = visiblePresentations.find(
        (entry) => entry.presentation.presentationId === selection.presentationId
      )?.presentation;
      return presentation?.format === 'browser-bundle-v1'
        ? [{ source: presentation.source.text, ids: selection.elements.map(({ id }) => id) }]
        : [];
    })
  );

  /** After the timeline shows an element reference's presentation, seek its step and select it. */
  // Choosing one of the chosen source's variants from the source view shows it, as its pill does.
  function chooseVariant(presentationId: string, extend: boolean) {
    const variant = timelinePresentations(session.events).find(
      ({ presentation }) => presentation.presentationId === presentationId
    );
    if (!variant) return;
    chosenOf = undefined;
    presentationSelection.activate(variant, session.events, layout, extend);
  }

  function showElementReference(reference: ElementReference) {
    const context = presentationPlaybackContext(
      presentationSelection.selected(session.events, layout)
    );
    const step = presentationPlayback.seek(context, reference.step);
    visualSelections.set(reference.presentationId, step, [reference.element]);
  }
  let feedbackComposer = $state<FeedbackComposer>();
  let editMode = $state<ProjectArtifactEditMode>('readonly');
  let renaming = $state(false);
  let titleDraft = $state('');
  // The route keys this component when the study task changes.
  // svelte-ignore state_referenced_locally
  let layout = $state<PresentationLayout>(study?.layout ?? 'single');
  // svelte-ignore state_referenced_locally
  let expired = $state(study?.expired ?? false);
  let studyAdvancing = $state(false);
  let workspaceRoot = $state<HTMLElement>();
  let interactionRecorder = $state.raw<ProjectInteractionRecorder>();
  // The canvas view each visible presentation was last left at, for study observations.
  let canvasViews = $state.raw<Record<string, { zoom: number; panX: number; panY: number }>>({});
  // What each visible presentation's step on screen drew implicitly, as its page last reported it.
  let drawnSteps = $state.raw<Record<string, DrawnStep>>({});
  let timelineObservation = $state<StudyWorkspaceObservation['timeline']>();
  let draftObservation = $state<StudyWorkspaceObservation['draft']>({
    hasContent: false,
    characterCount: 0,
    referenceCount: 0,
    focused: false
  });

  const adminPreview = $derived(study?.context === 'admin-preview');
  const showAdminControls = $derived(isAdmin && !adminPreview && !session.readOnly);
  const developerView = $derived(isAdmin && !adminPreview && !session.readOnly && devMode);
  const busy = $derived(!!session.pending || session.creating);
  const mutationsDisabled = $derived(busy || expired || session.readOnly || editMode === 'editing');
  const presentationCount = $derived<1 | 2>(
    session.loaded && session.snapshot.mode === 'sverlin' && layout === 'comparison' ? 2 : 1
  );
  const visiblePresentations = $derived(presentationSelection.selected(session.events, layout));

  // A request to a model chosen for audit, in developer view: its details fill the stage.
  let chosenRequestId = $state<number | undefined>();
  const auditedRequest = $derived(
    developerView && chosenRequestId !== undefined
      ? agentRequestAt(session.events, chosenRequestId)
      : undefined
  );

  // A source chosen on its own, by its card: no visualization shows, and the source panel fills the
  // stage with its source and what it changes from its parent, until a variant is chosen.
  let chosenOf = $state<{ sourceHash: string; parentHash?: string } | undefined>();
  const chosen = $derived.by(() => {
    if (!chosenOf) return undefined;
    const { sourceHash, parentHash } = chosenOf;
    const built = (hash: string) =>
      timelinePresentations(session.events).flatMap(({ presentation }) =>
        presentation.format === 'browser-bundle-v1' && presentation.source.sha256 === hash
          ? [presentation]
          : []
      );
    const variants = built(sourceHash);
    const newest = variants.at(-1);
    const parent = parentHash ? built(parentHash).at(-1) : undefined;
    return newest
      ? {
          source: newest.source.text,
          sourceHash,
          presentationId: newest.presentationId,
          variants: variants.map((presentation) => ({
            presentationId: presentation.presentationId,
            values: candidateId(presentation).values
          })),
          ...(parent && parentHash
            ? { parent: { source: parent.source.text, sourceHash: parentHash } }
            : {})
        }
      : undefined;
  });

  // What each visible presentation drew, named top and bottom as the stage stacks a pair.
  const drawnSources = $derived(
    visiblePresentations.flatMap(({ presentation }, index) =>
      presentation.format === 'browser-bundle-v1'
        ? [
            {
              source: presentation.source.text,
              sourceHash: presentation.source.sha256,
              presentationId: presentation.presentationId,
              candidate: candidateId(presentation),
              seed: presentation.seed,
              draws: presentation.draws ?? [],
              ...(presentation.variant ? { variant: presentation.variant } : {}),
              ...(presentation.views ? { views: presentation.views } : {}),
              ...(presentation.kinds ? { kinds: presentation.kinds } : {}),
              ...(presentation.leftOut ? { leftOut: presentation.leftOut } : {}),
              ...(presentation.origins ? { origins: presentation.origins } : {}),
              unrecorded: presentation.variant === undefined && presentation.draws === undefined,
              layouts: (drawnSteps[presentation.presentationId]?.layouts ?? []).flatMap(
                ({ node, seed, form, curve }) => {
                  const tag =
                    node === 'frame' ? undefined : locateElement(presentation.source.text, node);
                  return tag ? [{ line: tag.line, column: tag.column, seed, form, curve }] : [];
                }
              ),
              ...(visiblePresentations.length > 1 ? { label: index === 0 ? 'top' : 'bottom' } : {})
            }
          ]
        : []
    )
  );
  const playbackContext = $derived(presentationPlaybackContext(visiblePresentations));

  onMount(() => {
    void session.open();
    if (study?.context === 'participant' && study.interactionCapture && workspaceRoot) {
      interactionRecorder = new ProjectInteractionRecorder({
        projectId,
        participantId: study.participantId,
        capture: study.interactionCapture,
        applicationVersion: study.applicationVersion ?? '0.0.1',
        ...(study.deadlineAt ? { captureEndsAt: study.deadlineAt } : {}),
        readProjectHead: () => session.head,
        ...(study.buildSha ? { buildSha: study.buildSha } : {})
      });
      interactionRecorder.start(workspaceRoot);
    }
    return () => {
      interactionRecorder?.dispose();
      session.dispose();
    };
  });

  $effect(() => {
    const recorder = interactionRecorder;
    if (!recorder || !session.loaded || expired) return;
    const operation = activeProjectOperation(session.events);
    const playbackStep = presentationPlayback.stepFor(playbackContext);
    const frame = playbackContext.frames[playbackStep];
    recorder.recordWorkspaceState(
      {
        projectHead: session.head,
        ...(!session.atHead ? { viewedProjectEvent: session.snapshot.at } : {}),
        ...(operation
          ? {
              activeOperation: {
                id: operation.operationId,
                kind: operation.kind,
                status: operation.status as 'accepted' | 'running'
              }
            }
          : {}),
        connection: session.connection,
        atHead: session.atHead,
        layout,
        visiblePresentationIds: visiblePresentations.map(
          ({ presentation }) => presentation.presentationId
        ),
        followingLatestPresentations: presentationSelection.followingLatest,
        focusedTimelineEvents: session.focusedEvents,
        ...(playbackContext.stepCount
          ? {
              playback: {
                contextKey: playbackContext.key,
                step: playbackStep,
                ...(frame ? { frameKey: frame.key } : {}),
                localSteps: frame
                  ? visiblePresentations.map(({ presentation }) => ({
                      presentationId: presentation.presentationId,
                      step: frame.localSteps[presentation.presentationId] ?? -1
                    }))
                  : []
              }
            }
          : {}),
        ...(timelineObservation ? { timeline: timelineObservation } : {}),
        viewports: visiblePresentations.flatMap(({ presentation }) => {
          const view = canvasViews[presentation.presentationId];
          return view ? [{ presentationId: presentation.presentationId, ...view }] : [];
        }),
        ...(visualSelections.current.length
          ? {
              selections: visualSelections.current.map(({ presentationId, step, elements }) => ({
                presentationId,
                step,
                elements: elements.map(({ id }) => id)
              }))
            }
          : {}),
        draft: draftObservation,
        document: {
          visibility: document.visibilityState === 'hidden' ? 'hidden' : 'visible',
          focused: document.hasFocus(),
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio
          }
        }
      },
      session.head === 0 ? 'started' : 'changed'
    );
  });

  $effect(() => {
    const selectedAt = at;
    untrack(() => session.select(selectedAt));
  });

  function selectProject(event: Event) {
    const selected = (event.currentTarget as HTMLSelectElement).value;
    if (selected === projectId) return;
    const path = resolve('/projects/[projectId]', { projectId: selected });
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    void goto(developerView ? `${path}?dev=1` : path);
  }

  function startRenaming() {
    titleDraft = session.snapshot.title;
    renaming = true;
  }

  async function rename(event: SubmitEvent) {
    event.preventDefault();
    if (await session.runCommand({ type: 'rename', title: titleDraft })) renaming = false;
  }

  function toggleDevMode(enabled: boolean) {
    if (!isAdmin) return;
    const path = resolve('/projects/[projectId]', { projectId });
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    void goto(enabled ? `${path}?dev=1` : path, {
      keepFocus: true,
      noScroll: true,
      replaceState: true
    });
  }

  function expireStudyPhase() {
    expired = true;
    interactionRecorder?.stop();
    session.disablePresentationBuffer();
  }

  function recordDraft(content: MessageContent, focused: boolean) {
    draftObservation = {
      hasContent: content.length > 0,
      characterCount: content.reduce(
        (total, segment) => total + (segment.type === 'markdown' ? segment.text.length : 0),
        0
      ),
      referenceCount: content.filter((segment) => segment.type !== 'markdown').length,
      focused
    };
    interactionRecorder?.recordDraft(content, focused);
  }

  function recordTimeline(value: NonNullable<StudyWorkspaceObservation['timeline']>) {
    if (
      timelineObservation?.following === value.following &&
      timelineObservation.scrollTop === value.scrollTop &&
      timelineObservation.scrollHeight === value.scrollHeight &&
      timelineObservation.clientHeight === value.clientHeight &&
      timelineObservation.normalized === value.normalized
    ) {
      return;
    }
    timelineObservation = value;
  }
</script>

<div
  bind:this={workspaceRoot}
  class="dark h-screen overflow-hidden bg-background text-foreground"
  data-replay-region="workspace"
>
  {#if session.loaded}
    <main class="flex h-full min-w-0 flex-col overflow-hidden">
      {#if study}
        <header
          class="flex items-center gap-3 border-b bg-card px-4 py-2"
          data-replay-region="study-header"
        >
          <div class="mr-auto min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-base font-medium">{study.title}</p>
              {#if study.context === 'admin-preview'}<Badge variant="secondary">Preview</Badge>{/if}
              {#if isAdmin && session.readOnly}
                <Badge variant="outline">Participant data · read-only</Badge>
              {/if}
            </div>
            <p class="truncate text-sm text-muted-foreground">{study.prompt}</p>
          </div>
          {#if study.deadlineAt && !expired}
            <Badge variant="secondary">
              <StudyTimer deadlineAt={study.deadlineAt} onExpire={expireStudyPhase} />
            </Badge>
          {/if}
          {#if study.context === 'admin-preview'}
            <form method="POST" action="?/forcePreview" onsubmit={() => (studyAdvancing = true)}>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={studyAdvancing}
                aria-busy={studyAdvancing}
                aria-label={studyAdvancing ? 'Advancing preview' : undefined}
              >
                {#if studyAdvancing}
                  <Spinner data-icon="inline-start" />Advancing…
                {:else}
                  Next phase
                {/if}
              </Button>
            </form>
            <Button href={resolve('/admin')} size="sm">Return to administration</Button>
          {:else}
            {#if study.allowEarlyCompletion && !expired && !session.readOnly}
              <AlertDialog.Root>
                <AlertDialog.Trigger class={buttonVariants({ size: 'sm', variant: 'outline' })}>
                  Finish task early
                </AlertDialog.Trigger>
                <AlertDialog.Content>
                  <AlertDialog.Header>
                    <AlertDialog.Title>Finish this task early?</AlertDialog.Title>
                    <AlertDialog.Description>
                      The project will be locked immediately and you will advance to the next phase.
                    </AlertDialog.Description>
                  </AlertDialog.Header>
                  <AlertDialog.Footer>
                    <AlertDialog.Cancel disabled={studyAdvancing}>Keep working</AlertDialog.Cancel>
                    <form
                      method="POST"
                      action={`${resolve('/study')}?/early`}
                      onsubmit={() => (studyAdvancing = true)}
                    >
                      <Button
                        type="submit"
                        disabled={studyAdvancing}
                        aria-busy={studyAdvancing}
                        aria-label={studyAdvancing ? 'Finishing task' : undefined}
                      >
                        {#if studyAdvancing}
                          <Spinner data-icon="inline-start" />Finishing…
                        {:else}
                          Finish and continue
                        {/if}
                      </Button>
                    </form>
                  </AlertDialog.Footer>
                </AlertDialog.Content>
              </AlertDialog.Root>
            {/if}
            {#if isAdmin}
              <Button href={resolve('/admin')} size="sm">Return to administration</Button>
            {/if}
            {#if authEnabled}
              <form method="POST" action={resolve('/logout')}>
                <Button type="submit" size="icon-sm" variant="ghost" aria-label="Sign out"
                  ><LogOutIcon /></Button
                >
              </form>
            {/if}
          {/if}
        </header>
      {/if}

      <Resizable.PaneGroup direction="horizontal" class="min-h-0 flex-1">
        <Resizable.Pane defaultSize={32} minSize={24} class="min-w-0">
          <Tabs.Root value="timeline" class="h-full min-w-0 gap-0 rounded-none border-r">
            <Tabs.List
              variant="line"
              class="w-full shrink-0 justify-start rounded-none border-b px-4"
            >
              <Tabs.Trigger value="timeline">Timeline</Tabs.Trigger>
              {#if developerView}<Badge variant="secondary">Developer details</Badge>{/if}
              {#if showAdminControls}
                <select
                  class="ml-auto h-8 max-w-40 rounded-md border bg-background px-2 text-sm"
                  value={projectId}
                  onchange={selectProject}
                  disabled={busy || editMode === 'editing'}
                  aria-label="Open project"
                >
                  {#each session.projects as project (project.projectId)}
                    <option value={project.projectId}>{project.title}</option>
                  {/each}
                </select>
                {#if !session.readOnly}
                  {#if renaming}
                    <form class="flex items-center gap-1" onsubmit={rename}>
                      <Input class="h-8 w-32" bind:value={titleDraft} aria-label="Project title" />
                      <Button type="submit" size="sm">Save</Button>
                    </form>
                  {:else}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onclick={startRenaming}
                      aria-label="Rename project"><PencilIcon /></Button
                    >
                  {/if}
                  <NewProjectDialog
                    {session}
                    {templates}
                    devMode={developerView}
                    disabled={mutationsDisabled}
                  />
                {/if}
              {/if}
            </Tabs.List>
            <Tabs.Content
              value="timeline"
              class="flex min-h-0 flex-1 flex-col"
              data-replay-region="timeline"
            >
              {#if developerView}
                <div class="flex items-center border-b bg-muted px-4 py-2 text-sm">
                  <span class="mr-auto text-muted-foreground">Complete retained event details</span>
                  <Button
                    href={`/api/projects/${encodeURIComponent(projectId)}`}
                    size="xs"
                    variant="outline">Raw JSON</Button
                  >
                </div>
              {/if}
              <Timeline
                {session}
                selection={presentationSelection}
                {layout}
                inspect={developerView}
                onViewportChange={recordTimeline}
                onReferenceRequest={(presentation) =>
                  feedbackComposer?.referencePresentation(presentation)}
                onElementReference={showElementReference}
                chosenSource={chosenOf?.sourceHash}
                onChooseSource={(source) => {
                  chosenOf = source;
                  chosenRequestId = undefined;
                }}
                chosenRequest={auditedRequest ? chosenRequestId : undefined}
                onChooseRequest={(eventId) => {
                  chosenRequestId = eventId;
                  if (eventId !== undefined) chosenOf = undefined;
                }}
              />
              {#if !expired && !session.readOnly}
                <FeedbackComposer
                  bind:this={feedbackComposer}
                  {session}
                  {presentationCount}
                  presentations={chosen ? [] : visiblePresentations}
                  base={chosen?.presentationId}
                  baseSource={chosen?.sourceHash.slice(0, 6)}
                  visualSelections={visualSelections.current}
                  onSubmitted={() => {
                    chosenOf = undefined;
                    presentationSelection.returnToLatest();
                  }}
                  onDraftChange={recordDraft}
                />
              {/if}
            </Tabs.Content>
          </Tabs.Root>
        </Resizable.Pane>

        <Resizable.Handle withHandle />

        <Resizable.Pane
          defaultSize={68}
          minSize={50}
          class="flex min-w-0 flex-col"
          data-replay-region="project-workspace"
        >
          {#if showAdminControls}
            <div class="flex items-center gap-2 border-b px-3 py-1.5 text-sm">
              <div class="ml-auto flex items-center gap-1">
                <div class="flex items-center gap-1">
                  <Switch
                    id="dev-mode"
                    size="sm"
                    checked={developerView}
                    onCheckedChange={toggleDevMode}
                  />
                  <Label for="dev-mode" class="text-sm">Dev</Label>
                </div>
                {#if authEnabled}
                  <Button
                    href={resolve('/admin')}
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Administration"><SettingsIcon /></Button
                  >
                  <form method="POST" action={resolve('/logout')}>
                    <Button type="submit" size="icon-sm" variant="ghost" aria-label="Sign out"
                      ><LogOutIcon /></Button
                    >
                  </form>
                {/if}
              </div>
            </div>
          {/if}
          <PresentationStage
            hidden={chosen !== undefined || auditedRequest !== undefined}
            {session}
            selection={presentationSelection}
            playback={presentationPlayback}
            {layout}
            {visualSelections}
            onReferenceSelection={(selected) => feedbackComposer?.referenceSelection(selected)}
            onViewChange={(presentationId, view) =>
              (canvasViews = { ...canvasViews, [presentationId]: view })}
            onDrawnChange={(presentationId, drawn) =>
              (drawnSteps = { ...drawnSteps, [presentationId]: drawn })}
            disabled={mutationsDisabled}
          />
          {#if auditedRequest}
            <AgentRequestAudit
              value={auditedRequest}
              onClose={() => (chosenRequestId = undefined)}
            />
          {/if}
          <div
            class="contents"
            style:display={auditedRequest ? 'none' : undefined}
            data-replay-region="artifact"
          >
            <ProjectArtifactPanel
              {session}
              {presentationCount}
              {selectedSources}
              {drawnSources}
              onSaved={() => {
                chosenOf = undefined;
                presentationSelection.returnToLatest();
              }}
              {chosen}
              onLeaveSource={() => (chosenOf = undefined)}
              onChooseVariant={chooseVariant}
              bind:editMode
            />
          </div>
        </Resizable.Pane>
      </Resizable.PaneGroup>
    </main>
  {:else}
    <main class="grid h-full place-items-center">
      <div class="flex w-full max-w-md flex-col gap-3">
        <Skeleton class="h-8 w-48" />
        <Skeleton class="h-4 w-2/3" />
        <Skeleton class="h-4 w-5/6" />
      </div>
    </main>
  {/if}

  {#if session.error}
    <div class="pointer-events-none fixed inset-x-6 bottom-6 z-50 mx-auto max-w-3xl">
      <Alert.Root variant="destructive" class="pointer-events-auto">
        <Alert.Title>Project operation failed</Alert.Title>
        <Alert.Description>{session.error}</Alert.Description>
      </Alert.Root>
    </div>
  {/if}
  {#if study && shouldShowPhaseExpiredDialog(isAdmin, study.context)}
    <PhaseExpiredDialog open={expired} context={study.context} />
  {/if}
</div>
