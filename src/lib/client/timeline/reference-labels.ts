/** Client-facing labels and singleton expansion for retained visualization references. */

import { presentationDisplayId } from '$lib/client/visualization/presentation-history';
import type { MessageContentSegment } from '$lib/shared/projects/events/message-content';

export type ReferenceSegment = Exclude<MessageContentSegment, { type: 'markdown' }>;

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

/** What an element chip adds to its presentation: the step and the element's label. */
export function referenceChipDetail(reference: ReferenceSegment): string | undefined {
  if (reference.type === 'presentation-ref') return undefined;
  return `S${reference.step + 1} · ${shortLabel(reference.element.label)}`;
}

/** Return the full description of one reference chip, shown on hover. */
export function referenceChipTitle(reference: ReferenceSegment): string {
  const presentation = presentationDisplayId(reference.presentationId);
  if (reference.type === 'presentation-ref') return presentation;
  return `${presentation} · step ${reference.step + 1} · ${reference.element.label}`;
}

/** A label cut at a word boundary near the chip length, with an ellipsis if cut. */
function shortLabel(label: string): string {
  if (label.length <= chipLabelLength) return label;
  const cut = label.lastIndexOf(' ', chipLabelLength);
  return `${label.slice(0, cut > chipLabelLength / 2 ? cut : chipLabelLength).trimEnd()}…`;
}
