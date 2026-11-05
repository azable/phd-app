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
  import type { PairAnswers } from '$lib/client/visualization/pair-answers';
  import { baseCandidate } from '$lib/client/visualization/presentation-selection.svelte';
  import type { VisualSelection } from '$lib/client/visualization/visual-selection.svelte';
  import type { MessageContent } from '$lib/shared/projects/events/message-content';

  import MessageContentView from './MessageContent.svelte';
  import {
    feedbackSubmissionContent,
    feedbackViewing,
    presentationReference,
    selectedFeedbackContext,
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
    /** The candidate feedback builds on, where none is shown, as for a source chosen on its own. */
    base?: string;
    /** That source's id, recorded as what the participant is viewing. */
    baseSource?: string;
    /** The step each visible presentation shows, by its id. */
    steps?: Readonly<Record<string, number>>;
    /**
     * The pair on the stage, answered here in place of Submit: picking an answer sends the draft
     * with it as its comment (see PresentationStage.svelte, `pairAnswers`).
     */
    pair?: PairAnswers & { key: string; question?: string; onanswer: (answer: string) => void };
  };

  let {
    session,
    presentationCount,
    presentations,
    visualSelections = [],
    onSubmitted = () => {},
    onDraftChange = (_content: MessageContent, _focused: boolean) => {},
    base,
    baseSource,
    steps = {},
    pair: offered
  }: Props = $props();
  // The pair the participant chose to write about something else instead, until another shows.
  let writingInstead = $state<string>();
  const pair = $derived(offered && offered.key !== writingInstead ? offered : undefined);
  let editor = $state<HTMLDivElement>();
  let savedRange: Range | undefined;
  let hasContent = $state(false);
  // Enter pressed on a note while a pair is open: the note waits for an answer, so say so.
  let enterWithPair = $state(false);
  let hasExplicitReferences = $state(false);
  let editorRevision = $state(0);
  let focused = $state(false);
  const selected = $derived(selectedFeedbackContext(presentations, visualSelections));
  // While the assistant replies, every system says it is thinking; where its turn runs apart from
  // the message that asked for it, a message written meanwhile can still be sent, for its next turn.
  const thinking = $derived(session.pending?.type === 'feedback' || session.assistantResponding);
  const queueing = $derived(thinking && !session.pending && hasContent);

  export function referencePresentation(presentation: TimelinePresentation): void {
    insertReference(presentationReference(presentation.presentation, steps));
  }

  export function referenceSelection(selection: VisualSelection): void {
    insertReferences(selectionReferences(selection));
  }

  /** The draft, as a message would send it, to go with an answer to the pair; none when empty. */
  export function takeComment(): MessageContent | undefined {
    const draft = serializeEditor();
    return draft.length ? feedbackSubmissionContent(draft, selected) : undefined;
  }

  /** Empty the box once what it held is sent. */
  export function clear(): void {
    editorRevision += 1;
    hasContent = false;
    enterWithPair = false;
    hasExplicitReferences = false;
    savedRange = undefined;
    session.focusedEvents = [];
    onDraftChange([], false);
  }

  async function send(editorContent: MessageContent): Promise<boolean> {
    if (!session.atHead || session.pending || session.readOnly) return false;
    const content = feedbackSubmissionContent(editorContent, selected);
    const from = base ?? baseCandidate(presentations);
    const viewing = feedbackViewing(presentations, baseSource, steps);
    return session.runCommand({
      type: 'feedback',
      content,
      focus: session.focusedEvents,
      presentationCount,
      ...(from ? { from } : {}),
      ...(viewing ? { viewing } : {})
    });
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!editor || pair) return;
    const editorContent = serializeEditor();
    if (editorContent.length === 0) return;
    if (await send(editorContent)) {
      clear();
      onSubmitted();
    }
  }

  function submitOnEnter(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    // With a pair open, the draft goes with its answer, never on its own.
    if (pair) {
      enterWithPair = hasContent;
      return;
    }
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
        {#if selected.length > 0 && !hasExplicitReferences}
          <div
            class="border-b bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            data-testid="feedback-selection"
          >
            <MessageContentView content={selected} interactive={false} />
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
            data-placeholder={pair
              ? 'Add a note to your answer (optional): a change you want, or what you like…'
              : 'Comment on the project or reference a visualization…'}
            oninput={updateContentState}
            onkeyup={rememberSelection}
            onmouseup={rememberSelection}
            onfocus={() => focusChanged(true)}
            onfocusout={() => focusChanged(false)}
            onkeydown={submitOnEnter}
          ></div>
        {/key}
        {#if pair && session.atHead}
          <!-- The pair's answers stand in for Submit, each sending the draft with it. -->
          <div
            class="flex flex-wrap items-center justify-center gap-1.5 border-t bg-muted p-1"
            role="group"
            aria-label="Your answer"
          >
            {#each pair.answers as { answer, label, text, icons } (answer)}
              <Button
                size="sm"
                variant={pair.chosen === answer ? 'default' : 'outline'}
                aria-label={label}
                title={label}
                onclick={() => pair?.onanswer(answer)}
                disabled={pair.disabled || session.readOnly}
              >
                {#each icons as Icon, index (index)}<Icon
                    data-icon={index === 0 ? 'inline-start' : undefined}
                    class={index > 0 ? '-ml-1' : undefined}
                  />{/each}
                {text}
              </Button>
            {/each}
            <Button
              size="sm"
              variant="ghost"
              title="Write a message about something else; the pair stays open"
              onclick={() => {
                writingInstead = pair?.key;
                enterWithPair = false;
              }}
              disabled={session.readOnly}
            >
              Write instead
            </Button>
          </div>
          {#if enterWithPair && hasContent && !pair.waiting}
            <p class="border-t px-3 py-1.5 text-sm text-muted-foreground" role="status">
              Pick an answer to send your note with it.
            </p>
          {/if}
          {#if pair.waiting}
            <p class="border-t px-3 py-1.5 text-sm text-muted-foreground" role="status">
              Answer once the assistant has replied.
            </p>
          {/if}
        {:else}
          <div class="flex items-center gap-2 border-t px-2 py-1.5">
            <span class="mr-auto text-sm text-muted-foreground">
              {!session.atHead
                ? 'Return to present to respond'
                : queueing
                  ? 'The assistant reads this once it has replied'
                  : 'Enter submits · Shift+Enter adds a line'}
            </span>
            <Button
              type="submit"
              size="sm"
              aria-label="Submit project feedback"
              disabled={!session.atHead || !!session.pending || session.readOnly || !hasContent}
            >
              {#if thinking && !queueing}
                <Spinner data-icon="inline-start" />Thinking
              {:else}
                <SendIcon data-icon="inline-start" />Submit
              {/if}
            </Button>
          </div>
        {/if}
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
