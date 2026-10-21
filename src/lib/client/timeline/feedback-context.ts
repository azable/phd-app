import type { TimelinePresentation } from '$lib/client/visualization/presentation-history';
import type { VisualSelection } from '$lib/client/visualization/visual-selection.svelte';
import type { MessageContent } from '$lib/shared/projects/events/message-content';

import type { ReferenceSegment } from './reference-labels';

/**
 * Describe what the participant is viewing with retained inline references: the elements selected
 * in a presentation, if any, or else the presentation itself; or a source chosen on its own.
 */
export function automaticFeedbackContext(
  presentations: readonly TimelinePresentation[],
  selections: readonly VisualSelection[] = [],
  source?: string
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
      : [{ type: 'presentation-ref' as const, presentationId: presentation.presentationId }];
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
