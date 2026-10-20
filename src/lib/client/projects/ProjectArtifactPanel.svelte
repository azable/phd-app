<script lang="ts">
  import { tick } from 'svelte';

  import EditIcon from '@lucide/svelte/icons/edit-3';
  import SaveIcon from '@lucide/svelte/icons/save';
  import XIcon from '@lucide/svelte/icons/x';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

  import CodeMirrorEditor from '$lib/client/artifacts/CodeMirrorEditor.svelte';
  import DrawnDefaults from '$lib/client/artifacts/DrawnDefaults.svelte';
  import { tagDefaults, type NodeDefaultsTaken } from '$lib/client/artifacts/drawn-defaults';
  import type { DrawnPresentation } from '$lib/client/artifacts/drawn-values';
  import type { SourceHighlight } from '$lib/client/artifacts/selection-highlights';
  import { buildDiagnosticsFor } from '$lib/client/artifacts/source-diagnostics';
  import * as AlertDialog from '$lib/client/components/ui/alert-dialog';
  import { Badge } from '$lib/client/components/ui/badge';
  import { Button } from '$lib/client/components/ui/button';
  import { Spinner } from '$lib/client/components/ui/spinner';

  import CandidateIdPill from '$lib/client/visualization/CandidateIdPill.svelte';
  import { sourceId, type CandidateId } from '$lib/client/visualization/presentation-history';
  import { locateElement } from '$lib/modes/sverlin/element-ref';

  import type { ProjectSession } from './project-session.svelte';

  /** Editing modes exposed to the parent project workspace. */
  export type ProjectArtifactEditMode = 'readonly' | 'editing';

  /** Public properties for the source artifact panel. */
  type Props = {
    session: ProjectSession;
    presentationCount: 1 | 2;
    editMode?: ProjectArtifactEditMode;
    /** Elements selected in visible presentations, with the source each presentation was built from. */
    selectedSources?: readonly { source: string; ids: readonly string[] }[];
    /** What the visible presentations drew, with the source each was built from. */
    drawnSources?: readonly (DrawnPresentation & {
      source: string;
      defaults?: unknown;
      nodeDefaults?: readonly NodeDefaultsTaken[];
      /** The hash of the source it was built from. */
      sourceHash?: string;
      /** Its identifier, `<source>/<values>`. */
      candidate?: CandidateId;
      /** Built before draws were kept, so neither its draws nor its page's defaults are known. */
      unrecorded?: boolean;
    })[];
    /** Called once a save has built its new candidate, so the stage can show it. */
    onSaved?: () => void;
  };

  let {
    session,
    presentationCount,
    editMode = $bindable<ProjectArtifactEditMode>('readonly'),
    selectedSources = [],
    drawnSources = [],
    onSaved = () => {}
  }: Props = $props();

  let draft = $state('');
  // The source a draft was started from, which its markers keep their places in.
  let draftBase = $state('');
  let discardRequested = $state(false);
  let expanded = $state(false);
  let editor = $state<{ focus: () => void } | null>(null);

  const artifact = $derived(session.snapshot.artifacts[session.snapshot.entryArtifactId]);
  // The source the visible presentations were built from, when it is not the newest one: the panel
  // shows it, so their draws can be marked, and editing it builds a new candidate from it.
  const candidateSource = $derived.by(() => {
    if (!session.atHead) return undefined;
    const sources = [...new Set(drawnSources.map(({ source }) => source))];
    return sources.length === 1 && sources[0] !== artifact?.content.text ? sources[0] : undefined;
  });
  const baseSource = $derived(candidateSource ?? artifact?.content.text ?? '');
  const displayedSource = $derived(editMode === 'editing' ? draft : baseSource);
  const dirty = $derived(
    editMode === 'editing' && artifact !== undefined && draft !== artifact.content.text
  );
  // A selection's ids are tag positions in the source its presentation was built from, so they are
  // highlighted only while the editor shows that same text.
  const matching = $derived(selectedSources.filter(({ source }) => source === displayedSource));
  // One highlight per tag, however many of its renders are selected.
  const highlights = $derived(
    matching
      .flatMap(({ ids }) => ids.flatMap((id) => locateElement(displayedSource, id) ?? []))
      .map(({ line, column }): SourceHighlight => ({ line, column }))
      .filter(
        (highlight, index, all) =>
          all.findIndex(
            (other) => other.line === highlight.line && other.column === highlight.column
          ) === index
      )
  );
  const unmatched = $derived(selectedSources.length > matching.length);
  // Draws are marked in the source shown, and keep their places in a draft made from it.
  const markedSource = $derived(editMode === 'editing' ? draftBase : baseSource);
  const drawn = $derived(drawnSources.filter(({ source }) => source === markedSource));
  const drawnTags = $derived(tagDefaults(drawn));
  // Why a visible presentation's draws are not marked: it was built from another version of the
  // source, or before draws were kept.
  const unmarkedNotice = $derived.by(() => {
    const otherSource = drawnSources.filter((presentation) => !drawn.includes(presentation));
    const unrecorded = drawn.filter((presentation) => presentation.unrecorded);
    const [unmarked, reason, remedy] = otherSource.length
      ? [otherSource, 'from another version of the source', '']
      : [unrecorded, 'before drawn values were recorded', ' Resample to see drawn values.'];
    if (!unmarked.length) return undefined;
    const subject =
      unmarked.length > 1
        ? 'These presentations were'
        : unmarked[0].label
          ? `The ${unmarked[0].label} presentation was`
          : 'This presentation was';
    return `${subject} built ${reason}, so the source does not mark what ${unmarked.length > 1 ? 'they' : 'it'} drew.${remedy}`;
  });
  // Problems the latest build of the artifact's source found, underlined in the editor.
  const diagnosed = $derived.by(() => {
    const source = markedSource;
    return { source, items: buildDiagnosticsFor(session.events, source) };
  });

  function startEditing() {
    if (!artifact || !session.atHead || session.pending || session.readOnly) return;
    draft = baseSource;
    draftBase = baseSource;
    expanded = true;
    editMode = 'editing';
    void tick().then(() => editor?.focus());
  }

  function cancelEditing() {
    if (dirty) {
      discardRequested = true;
      return;
    }
    editMode = 'readonly';
  }

  function discardDraft() {
    draft = draftBase;
    discardRequested = false;
    editMode = 'readonly';
  }

  async function saveDraft() {
    if (!artifact || !dirty || session.pending || !session.atHead || session.readOnly) return;
    const succeeded = await session.runCommand({
      type: 'save',
      artifactId: artifact.artifactId,
      source: draft,
      presentationCount
    });
    if (succeeded) {
      editMode = 'readonly';
      onSaved();
    }
  }

  function updateDraft(source: string) {
    draft = source;
  }
</script>

<section class="flex max-h-[38vh] min-h-0 flex-col border-t p-2" aria-label="Project artifact">
  {#if artifact}
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
      <header class="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <EditIcon class="size-4 shrink-0 text-muted-foreground" />
        <div class="mr-auto min-w-0">
          <p class="truncate font-mono text-sm">{artifact.path}</p>
          {#if !session.atHead}
            <p class="text-sm text-muted-foreground">Artifact at event #{session.snapshot.at}</p>
          {/if}
        </div>
        {#if highlights.length}
          <Badge variant="secondary"
            >{highlights.length} selected {highlights.length === 1 ? 'node' : 'nodes'}</Badge
          >
        {/if}
        {#if diagnosed.items.length}
          <Badge variant="destructive"
            >{diagnosed.items.length} build {diagnosed.items.length === 1
              ? 'problem'
              : 'problems'}</Badge
          >
        {/if}
        {#each drawnSources as { candidate, label } (label ?? 'shown')}
          {#if candidate}<CandidateIdPill {...candidate} {label} />{/if}
        {:else}
          <CandidateIdPill {...sourceId(artifact.content.sha256)} />
        {/each}
        <Button
          size="icon-sm"
          variant="ghost"
          onclick={() => (expanded = !expanded)}
          aria-label={expanded ? 'Collapse source' : 'Expand source'}
          aria-expanded={expanded}
        >
          <ChevronDownIcon class={expanded ? 'rotate-180' : ''} />
        </Button>
        {#if editMode === 'readonly'}
          <Button
            size="sm"
            variant="outline"
            onclick={startEditing}
            disabled={!session.atHead || !!session.pending || session.readOnly}
          >
            <EditIcon data-icon="inline-start" />Edit
          </Button>
        {:else}
          <Badge variant="secondary">Editing · workspace locked</Badge>
          <Button size="sm" variant="ghost" onclick={cancelEditing} disabled={!!session.pending}>
            <XIcon data-icon="inline-start" />Cancel
          </Button>
          <Button
            size="sm"
            onclick={saveDraft}
            disabled={!dirty || !!session.pending || session.readOnly}
          >
            {#if session.pending?.type === 'save'}
              <Spinner data-icon="inline-start" />Compiling
            {:else}
              <SaveIcon data-icon="inline-start" />Save & build
            {/if}
          </Button>
        {/if}
      </header>

      {#if expanded && unmatched}
        <p class="border-b bg-muted px-4 py-2 text-sm text-muted-foreground">
          {editMode === 'editing'
            ? 'Selected nodes are not highlighted while the source has unsaved changes.'
            : 'A selected presentation was built from a different source, so its nodes are not highlighted.'}
        </p>
      {/if}

      {#if expanded && unmarkedNotice}
        <p class="border-b bg-muted px-4 py-2 text-sm text-muted-foreground">
          {unmarkedNotice}
        </p>
      {/if}

      {#if expanded && !session.atHead}
        <p class="border-b bg-muted px-4 py-2 text-sm text-muted-foreground">
          Historical source is read-only. Restore this event from the Timeline to make a new current
          version.
        </p>
      {/if}

      {#if expanded}
        <DrawnDefaults presentations={drawn} />
        <div class="min-h-48 flex-1 overflow-hidden">
          <CodeMirrorEditor
            bind:this={editor}
            value={displayedSource}
            language={artifact.language}
            editable={editMode === 'editing' &&
              session.atHead &&
              !session.pending &&
              !session.readOnly}
            ariaLabel="Project visualization source"
            {highlights}
            {drawn}
            {drawnTags}
            drawnSource={markedSource}
            diagnostics={diagnosed}
            onChange={updateDraft}
          />
        </div>
      {/if}
    </div>
  {:else}
    <div class="flex h-full items-center justify-center text-base text-muted-foreground">
      This project state has no entry artifact.
    </div>
  {/if}

  <AlertDialog.Root bind:open={discardRequested}>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Discard unsaved changes?</AlertDialog.Title>
        <AlertDialog.Description>
          The draft has not entered the project Timeline and will be lost.
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>Keep editing</AlertDialog.Cancel>
        <AlertDialog.Action variant="destructive" onclick={discardDraft}>Discard</AlertDialog.Action
        >
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
</section>
