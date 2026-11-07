/**
 * Comments participants pin in presentations: drafts, kept until the next message or comparison
 * answer carries them (see annotationSegmentSchema), and those already sent, read back from the
 * Timeline, so each presentation shows its pins whenever it is viewed again.
 */

import type { ProjectEvent } from '$lib/shared/projects/events';
import type { Annotation, MessageContent } from '$lib/shared/projects/events/message-content';

/** What a comment is on, as a picture draws it: elements, by id, a point in its frame, or both. */
export type CommentAnchor = { elements?: string[]; point?: { x: number; y: number } };

/**
 * A pin as the picture draws it at a step: its number in its presentation, where, and its words;
 * highlighted while the participant points at the comment in the chat.
 */
export type AnnotationPin = CommentAnchor & {
  n: number;
  text: string;
  draft?: boolean;
  highlighted?: boolean;
};

export class VisualAnnotations {
  drafts = $state.raw<Annotation[]>([]);
  /** The comment the participant points at in the chat, outlined in its picture. */
  pointed = $state.raw<Annotation>();

  add(annotation: Annotation): void {
    this.drafts = [...this.drafts, annotation];
  }

  remove(annotation: Annotation): void {
    this.drafts = this.drafts.filter((draft) => draft !== annotation);
  }

  /** The drafts on these presentations, removed from the drafts as a message takes them. */
  take(presentationIds: readonly string[]): Annotation[] {
    const taken = this.drafts.filter(({ presentationId }) =>
      presentationIds.includes(presentationId)
    );
    if (taken.length) this.drafts = this.drafts.filter((draft) => !taken.includes(draft));
    return taken;
  }
}

/** Every comment sent so far, in the order sent: in messages and in comparisons' answers. */
export function sentAnnotations(events: readonly ProjectEvent[]): Annotation[] {
  const pinned = (content: MessageContent | undefined) =>
    (content ?? []).filter((segment): segment is Annotation => segment.type === 'annotation');
  return events.flatMap((event) =>
    event.type === 'feedback.submitted'
      ? pinned(event.payload.content)
      : event.type === 'visualization.preference-recorded'
        ? pinned(event.payload.comment)
        : []
  );
}

/**
 * The pins one presentation draws at a step: its sent comments, then its drafts, each numbered
 * by its place among all of that presentation's comments, so a number names one comment at every
 * step; the one pointed at, the same object as a sent or draft comment, highlighted.
 */
export function annotationPins(
  presentationId: string,
  step: number,
  sent: readonly Annotation[],
  drafts: readonly Annotation[],
  pointed?: Annotation
): AnnotationPin[] {
  const own = [
    ...sent.map((annotation) => ({ annotation, draft: false })),
    ...drafts.map((annotation) => ({ annotation, draft: true }))
  ].filter(({ annotation }) => annotation.presentationId === presentationId);
  return own.flatMap(({ annotation, draft }, index) =>
    annotation.step === step
      ? [
          {
            n: index + 1,
            ...annotationAnchor(annotation),
            text: annotation.text,
            ...(draft ? { draft } : {}),
            ...(annotation === pointed ? { highlighted: true } : {})
          }
        ]
      : []
  );
}

/** What a comment is on, as its picture draws it. */
export function annotationAnchor({
  elements,
  point
}: Pick<Annotation, 'elements' | 'point'>): CommentAnchor {
  return {
    ...(elements ? { elements: elements.map(({ id }) => id) } : {}),
    ...(point ? { point } : {})
  };
}
