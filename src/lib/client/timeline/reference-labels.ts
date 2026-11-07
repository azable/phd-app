/** Client-facing labels and singleton expansion for retained visualization references. */

import { presentationDisplayId } from '$lib/client/visualization/presentation-history';
import type { MessageContentSegment } from '$lib/shared/projects/events/message-content';

export type ReferenceSegment = Exclude<
  MessageContentSegment,
  { type: 'markdown' | 'interface-ref' }
>;

/** Expand a reference into the individually actionable chips shown to participants. */
export function singletonReferenceSegments(reference: ReferenceSegment): ReferenceSegment[] {
  return [reference];
}

// An element chip shows this much of the element's label; the full label is on hover.
const chipLabelLength = 20;

/** Return the compact, participant-facing label for one reference chip. */
export function referenceChipLabel(reference: ReferenceSegment): string {
  const presentation = presentationDisplayId(reference.presentationId);
  const detail = referenceChipDetail(reference);
  return detail ? `${presentation} · ${detail}` : presentation;
}

/** What a chip adds to its presentation: the step, and an element's label or a comment's words. */
export function referenceChipDetail(reference: ReferenceSegment): string | undefined {
  if (reference.type === 'presentation-ref')
    return reference.step === undefined ? undefined : `Step ${reference.step + 1}`;
  if (reference.type === 'annotation')
    return `Step ${reference.step + 1} · 💬 ${shortLabel(reference.text)}`;
  return `Step ${reference.step + 1} · ${shortLabel(reference.element.label)}`;
}

/** Return the full description of one reference chip, shown on hover. */
export function referenceChipTitle(reference: ReferenceSegment): string {
  const presentation = presentationDisplayId(reference.presentationId);
  if (reference.step === undefined) return presentation;
  const step = `step ${reference.step + 1}${reference.stepName ? `, ${reference.stepName}` : ''}`;
  if (reference.type === 'presentation-ref') return `${presentation} · ${step}`;
  if (reference.type === 'annotation')
    return `${presentation} · ${step}${annotatedLabels(reference)}: ${reference.text}`;
  return `${presentation} · ${step} · ${reference.element.label}`;
}

/** What a comment's elements showed, after a separator; nothing for a comment on no element. */
export function annotatedLabels({
  elements
}: Extract<ReferenceSegment, { type: 'annotation' }>): string {
  return elements ? ` · ${elements.map(({ label }) => label).join(', ')}` : '';
}

/** A label cut at a word boundary near the chip length, with an ellipsis if cut. */
function shortLabel(label: string): string {
  if (label.length <= chipLabelLength) return label;
  const cut = label.lastIndexOf(' ', chipLabelLength);
  return `${label.slice(0, cut > chipLabelLength / 2 ? cut : chipLabelLength).trimEnd()}…`;
}
