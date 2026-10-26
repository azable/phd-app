import type { TimelinePresentation } from '$lib/client/visualization/presentation-history';
import type { VisualSelection } from '$lib/client/visualization/visual-selection.svelte';
import type { MessageContent } from '$lib/shared/projects/events/message-content';

import type { ReferenceSegment } from './reference-labels';

/**
 * Describe what the participant is viewing with retained inline references: the elements selected
 * in a presentation, if any, or else the presentation itself at the step it shows (steps, by
 * presentation id); or a source chosen on its own.
 */
export function automaticFeedbackContext(
  presentations: readonly TimelinePresentation[],
  selections: readonly VisualSelection[] = [],
  source?: string,
  steps: Readonly<Record<string, number>> = {}
): MessageContent {
  const visible = presentations.slice(0, 2);
  if (visible.length === 0)
    return source ? [{ type: 'markdown', text: `Viewing source \`${source}\`.` }] : [];
  const references = visible.map(({ presentation }) => {
    const selection = selections.find(
      ({ presentationId }) => presentationId === presentation.presentationId
    );
    return selection
      ? selectionReferences(selection)
      : [presentationReference(presentation.presentationId, steps)];
  });
  if (references.length === 1) {
    return [
      { type: 'markdown', text: 'Viewing ' },
      ...references[0],
      { type: 'markdown', text: '.' }
    ];
  }
  return [
    { type: 'markdown', text: 'Comparing ' },
    ...references[0],
    { type: 'markdown', text: ' with ' },
    ...references[1],
    { type: 'markdown', text: '.' }
  ];
}

/** A reference to a presentation, at the step it shows if it is visible. */
export function presentationReference(
  presentationId: string,
  steps: Readonly<Record<string, number>> = {}
): ReferenceSegment {
  const step = steps[presentationId];
  return {
    type: 'presentation-ref',
    presentationId,
    ...(step !== undefined && step >= 0 ? { step } : {})
  };
}

/** Prepend automatic context unless the participant deliberately inserted an inline reference. */
export function feedbackSubmissionContent(
  editorContent: MessageContent,
  automaticContext: MessageContent
): MessageContent {
  if (
    automaticContext.length === 0 ||
    editorContent.some((segment) => segment.type !== 'markdown')
  ) {
    return editorContent;
  }
  const prose = editorContent
    .flatMap((segment) => (segment.type === 'markdown' ? [segment.text] : []))
    .join('\n');
  return automaticContext.map((segment, index) =>
    index === automaticContext.length - 1 && segment.type === 'markdown'
      ? { ...segment, text: `${segment.text}\n\n${prose}` }
      : segment
  );
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
