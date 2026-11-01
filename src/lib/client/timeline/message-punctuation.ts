import type {
  MessageContent,
  MessageContentSegment
} from '$lib/shared/projects/events/message-content';

export type JoinedSegment = {
  segment: MessageContentSegment;
  /** Punctuation the next text opens with, kept on the reference's line. */
  punctuation?: string;
  /** What followed that punctuation: a space, or a new paragraph. */
  after?: 'space' | 'paragraph';
};

const leadingPunctuation = /^([.,;:!?)\]…]+)(\s*)/;

/**
 * The segments, each reference taking the punctuation that opens the text after it, so a line never
 * starts with the comma or full stop that belongs to the pill before it.
 */
export function joinTrailingPunctuation(content: MessageContent): JoinedSegment[] {
  const joined: JoinedSegment[] = [];
  for (const segment of content) {
    const previous = joined.at(-1);
    const afterReference =
      previous && previous.segment.type !== 'markdown' && !previous.punctuation;
    const match =
      afterReference && segment.type === 'markdown' && leadingPunctuation.exec(segment.text);
    if (!match || segment.type !== 'markdown') {
      joined.push({ segment });
      continue;
    }
    previous!.punctuation = match[1];
    if (match[2]) previous!.after = match[2].includes('\n\n') ? 'paragraph' : 'space';
    const rest = segment.text.slice(match[0].length);
    if (rest) joined.push({ segment: { ...segment, text: rest } });
  }
  return joined;
}
