import type { TimelinePresentation } from '$lib/client/visualization/presentation-history';
import type { VisualSelection } from '$lib/client/visualization/visual-selection.svelte';
import type {
  FeedbackViewing,
  ViewedPresentation
} from '$lib/shared/projects/events/feedback-submitted';
import type { MessageContent } from '$lib/shared/projects/events/message-content';
import { presentationStepName, type RenderablePresentation } from '$lib/shared/presentations';

import type { ReferenceSegment } from './reference-labels';

/** The elements selected in the visible presentations, as references a message starts with. */
export function selectedFeedbackContext(
  presentations: readonly TimelinePresentation[],
  selections: readonly VisualSelection[] = []
): ReferenceSegment[] {
  return presentations.slice(0, 2).flatMap(({ presentation }) => {
    const selection = selections.find(
      ({ presentationId }) => presentationId === presentation.presentationId
    );
    return selection ? selectionReferences(selection) : [];
  });
}

/**
 * What the participant has on screen, recorded beside a message: the visible presentations at the
 * steps they show (steps, by presentation id), or else a source chosen on its own.
 */
export function feedbackViewing(
  presentations: readonly TimelinePresentation[],
  source?: string,
  steps: Readonly<Record<string, number>> = {}
): FeedbackViewing | undefined {
  const visible = presentations.slice(0, 2);
  if (visible.length)
    return { presentations: visible.map(({ presentation }) => viewedAt(presentation, steps)) };
  return source ? { source } : undefined;
}

/** A reference to a presentation, at the step it shows, by its number and name, if it is visible. */
export function presentationReference(
  presentation: RenderablePresentation,
  steps: Readonly<Record<string, number>> = {}
): ReferenceSegment {
  return { type: 'presentation-ref', ...viewedAt(presentation, steps) };
}

function viewedAt(
  presentation: RenderablePresentation,
  steps: Readonly<Record<string, number>>
): ViewedPresentation {
  const { presentationId } = presentation;
  const step = steps[presentationId];
  if (step === undefined || step < 0) return { presentationId };
  const stepName = presentationStepName(presentation, step);
  return { presentationId, step, ...(stepName ? { stepName } : {}) };
}

/** Start with the selected elements unless the participant deliberately inserted a reference. */
export function feedbackSubmissionContent(
  editorContent: MessageContent,
  selected: readonly ReferenceSegment[]
): MessageContent {
  if (selected.length === 0 || editorContent.some((segment) => segment.type !== 'markdown'))
    return editorContent;
  return [...selected, ...editorContent];
}

/** One element reference per selected element. */
export function selectionReferences(selection: VisualSelection): ReferenceSegment[] {
  return selection.elements.map((element) => ({
    type: 'element-ref',
    presentationId: selection.presentationId,
    step: selection.step,
    element
  }));
}
