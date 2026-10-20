<script lang="ts">
  import SendIcon from '@lucide/svelte/icons/send';
  import XIcon from '@lucide/svelte/icons/x';

  import { Badge } from '$lib/client/components/ui/badge';
  import { Button } from '$lib/client/components/ui/button';
  import * as Field from '$lib/client/components/ui/field';
  import { Spinner } from '$lib/client/components/ui/spinner';
  import type { ProjectSession } from '$lib/client/projects/project-session.svelte';
  import {
    knownCandidate,
    type TimelinePresentation
  } from '$lib/client/visualization/presentation-history';
  import { baseCandidate } from '$lib/client/visualization/presentation-selection.svelte';
  import type { VisualSelection } from '$lib/client/visualization/visual-selection.svelte';
  import type { MessageContent } from '$lib/shared/projects/events/message-content';

  import MessageContentView from './MessageContent.svelte';
  import {
    automaticFeedbackContext,
    feedbackSubmissionContent,
    selectionReferences
  } from './feedback-context';
  import {
    referenceChipDetail,
    referenceChipLabel,
    referenceChipTitle,
    type ReferenceSegment
  } from './reference-labels';

  type Props = {
    session: ProjectSession;
    presentationCount: 1 | 2;
    presentations: TimelinePresentation[];
    /** Elements selected in the visible presentations. */
    visualSelections?: readonly VisualSelection[];
    onSubmitted?: () => void;
    onDraftChange?: (content: MessageContent, focused: boolean) => void;
  };

  let {
    session,
    presentationCount,
    presentations,
    visualSelections = [],
    onSubmitted = () => {},
    onDraftChange = (_content: MessageContent, _focused: boolean) => {}
  }: Props = $props();
  let editor = $state<HTMLDivElement>();
  let savedRange: Range | undefined;
  let hasContent = $state(false);
  let hasExplicitReferences = $state(false);
  let editorRevision = $state(0);
  let focused = $state(false);
  const automaticContext = $derived(automaticFeedbackContext(presentations, visualSelections));

  export function referencePresentation(presentation: TimelinePresentation): void {
    insertReference({
      type: 'presentation-ref',
      presentationId: presentation.presentation.presentationId
    });
  }

  export function referenceSelection(selection: VisualSelection): void {
    insertReferences(selectionReferences(selection));
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!editor || !session.atHead || session.pending || session.readOnly) return;
    const editorContent = serializeEditor();
    if (editorContent.length === 0) return;
    const content = feedbackSubmissionContent(editorContent, automaticContext);
    const from = baseCandidate(presentations);
    const succeeded = await session.runCommand({
      type: 'feedback',
      content,
      focus: session.focusedEvents,
      presentationCount,
      ...(from ? { from } : {})
    });
    if (succeeded) {
      editorRevision += 1;
      hasContent = false;
      hasExplicitReferences = false;
      savedRange = undefined;
      session.focusedEvents = [];
      onDraftChange([], false);
      onSubmitted();
    }
  }

  function submitOnEnter(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    editor?.closest('form')?.requestSubmit();
  }

  function rememberSelection() {
    if (!editor) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
    if (range && editor.contains(range.commonAncestorContainer)) savedRange = range.cloneRange();
  }

  function updateContentState() {
    rememberSelection();
    const content = serializeEditor();
    hasContent = content.length > 0;
    hasExplicitReferences = content.some((segment) => segment.type !== 'markdown');
    onDraftChange(content, focused);
  }

  function insertReference(reference: ReferenceSegment) {
    insertReferences([reference]);
  }

  function insertReferences(references: ReferenceSegment[]) {
    if (!editor || session.readOnly || !session.atHead) return;
    if (references.length === 0) return;
    editor.focus();
    const range =
      savedRange && editor.contains(savedRange.commonAncestorContainer)
        ? savedRange
        : document.createRange();
    if (!savedRange || !editor.contains(savedRange.commonAncestorContainer)) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    const fragment = document.createDocumentFragment();
    let finalSpacer: Text | undefined;
    for (const reference of references) {
      fragment.append(referenceChip(reference));
      finalSpacer = document.createTextNode('\u00a0');
      fragment.append(finalSpacer);
    }
    range.insertNode(fragment);
    if (!finalSpacer) return;
    range.setStartAfter(finalSpacer);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    savedRange = range.cloneRange();
    hasContent = true;
    hasExplicitReferences = true;
    onDraftChange(serializeEditor(), focused);
  }

  function focusChanged(next: boolean) {
    focused = next;
    if (!next) rememberSelection();
    onDraftChange(serializeEditor(), focused);
  }

  // A chip's label: the candidate's identifier as its pill (see CandidateIdPill.svelte), then what
  // an element chip adds, or the label as text for a candidate not yet known.
  function chipLabel(reference: ReferenceSegment): HTMLSpanElement {
    const label = document.createElement('span');
    label.className = 'inline-flex items-center gap-1';
    const known = knownCandidate(reference.presentationId);
    if (!known) {
      label.className = 'rounded-md bg-muted px-1.5 leading-5';
      label.textContent = referenceChipLabel(reference);
      return label;
    }
    const pill = document.createElement('span');
    pill.className = 'inline-flex overflow-hidden rounded-md leading-5 ring-1 ring-border';
    const source = document.createElement('span');
    source.className = 'px-1.5 font-semibold';
    source.style.backgroundColor = `hsl(${known.hue} 70% 55% / 0.32)`;
    source.textContent = known.source;
    const values = document.createElement('span');
    values.className = 'bg-muted/60 px-1.5';
    values.textContent = known.values;
    pill.append(source, values);
    label.append(pill);
    const detail = referenceChipDetail(reference);
    if (detail) label.append(detail);
    return label;
  }

  function referenceChip(reference: ReferenceSegment): HTMLSpanElement {
    const chip = document.createElement('span');
    chip.contentEditable = 'false';
    chip.dataset.reference = JSON.stringify(reference);
    chip.className =
      'mx-0.5 inline-flex items-center gap-1 rounded-md align-middle font-mono text-xs text-foreground';
    const label = chipLabel(reference);
    chip.title = referenceChipTitle(reference);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove reference ${chip.title}`);
    remove.className = 'rounded-sm text-muted-foreground hover:text-foreground';
    remove.textContent = '×';
    remove.onclick = () => {
      chip.remove();
      updateContentState();
      editor?.focus();
    };
    chip.append(label, remove);
    return chip;
  }

  function serializeEditor(): MessageContent {
    if (!editor) return [];
    const segments: MessageContent = [];
    let markdown = '';
    const flush = () => {
      if (markdown) segments.push({ type: 'markdown', text: markdown });
      markdown = '';
    };
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        markdown += node.textContent ?? '';
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.dataset.reference) {
        flush();
        segments.push(JSON.parse(node.dataset.reference) as ReferenceSegment);
        return;
      }
      if (node.tagName === 'BR') {
        markdown += '\n';
        return;
      }
      const block = node !== editor && (node.tagName === 'DIV' || node.tagName === 'P');
      for (const child of node.childNodes) visit(child);
      if (block) markdown += '\n';
    };
    visit(editor);
    flush();
    const normalized = segments
      .map((segment, index) => {
        if (segment.type !== 'markdown') return segment;
        let text = segment.text;
        if (index === 0) text = text.trimStart();
        else if (segments[index - 1]?.type !== 'markdown') text = text.replace(/^\u00a0/, '');
        if (index === segments.length - 1) text = text.trimEnd();
        else if (segments[index + 1]?.type !== 'markdown') text = text.replace(/\u00a0$/, '');
        return { ...segment, text };
      })
      .filter((segment) => segment.type !== 'markdown' || segment.text.length > 0);
    return normalized as MessageContent;
  }
</script>

<form class="border-t bg-background p-4" data-replay-region="feedback-composer" onsubmit={submit}>
  <Field.FieldGroup>
    <Field.Field>
      {#if session.focusedEvents.length > 0}
        <div class="flex flex-wrap gap-2">
          {#each session.focusedEvents as id (id)}
            <Badge variant="secondary">
              Event #{id}
              <button
                type="button"
                aria-label={`Remove event ${id}`}
                onclick={() => session.removeFocus(id)}
              >
                <XIcon class="size-3" />
              </button>
            </Badge>
          {/each}
        </div>
      {/if}
      <div
        class="overflow-hidden rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring"
      >
        {#if automaticContext.length > 0 && !hasExplicitReferences}
          <div
            class="border-b bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            data-testid="automatic-feedback-context"
          >
            <MessageContentView content={automaticContext} interactive={false} />
          </div>
        {/if}
        {#key editorRevision}
          <div
            bind:this={editor}
            class="message-editor min-h-20 px-3 py-2 text-base outline-none"
            contenteditable={!session.readOnly && session.atHead && !session.pending}
            tabindex={session.readOnly ? -1 : 0}
            role="textbox"
            aria-label="Project feedback"
            aria-multiline="true"
            data-placeholder="Comment on the project or reference a visualization…"
            oninput={updateContentState}
            onkeyup={rememberSelection}
            onmouseup={rememberSelection}
            onfocus={() => focusChanged(true)}
            onfocusout={() => focusChanged(false)}
            onkeydown={submitOnEnter}
          ></div>
        {/key}
        <div class="flex items-center gap-2 border-t px-2 py-1.5">
          <span class="mr-auto text-sm text-muted-foreground">
            {session.atHead
              ? 'Enter submits · Shift+Enter adds a line'
              : 'Return to present to respond'}
          </span>
          <Button
            type="submit"
            size="sm"
            aria-label="Submit project feedback"
            disabled={!session.atHead || !!session.pending || session.readOnly || !hasContent}
          >
            {#if session.pending?.type === 'feedback'}
              <Spinner data-icon="inline-start" />Thinking
            {:else}
              <SendIcon data-icon="inline-start" />Submit
            {/if}
          </Button>
        </div>
      </div>
    </Field.Field>
  </Field.FieldGroup>
</form>

<style>
  .message-editor:empty::before {
    color: var(--muted-foreground);
    content: attr(data-placeholder);
    pointer-events: none;
  }
</style>
