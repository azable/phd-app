import type {
  MessageContent,
  MessageContentSegment
} from '$lib/shared/projects/events/message-content';

export type JoinedSegment = {
  segment: MessageContentSegment;
  /** Punctuation the next text opens with, kept on the reference's line. */
  punctuation?: string;
  /**
   * What follows the segment: a space, or a new paragraph. Markdown drops the space at a text's
   * ends, so a reference and the words around it are kept apart here.
   */
  after?: 'space' | 'paragraph';
};

const leadingPunctuation = /^([.,;:!?)\]…]+)(\s*)/;
const leadingSpace = /^\s+/;
const leadingWord = /^[\p{L}\p{N}]/u;
const trailingSpace = /[^\S\n]$/;

/**
 * The segments, each reference taking the punctuation that opens the text after it, so a line never
 * starts with the comma or full stop that belongs to the pill before it, and set apart from the
 * words before and after it as the text has them, or by a space where a word runs on from it.
 */
export function joinTrailingPunctuation(content: MessageContent): JoinedSegment[] {
  const joined: JoinedSegment[] = [];
  for (const segment of content) {
    const previous = joined.at(-1);
    const afterReference =
      previous && previous.segment.type !== 'markdown' && !previous.punctuation;
    if (!afterReference || segment.type !== 'markdown') {
      if (
        previous?.segment.type === 'markdown' &&
        segment.type !== 'markdown' &&
        trailingSpace.test(previous.segment.text)
      )
        previous.after = 'space';
      joined.push({ segment });
      continue;
    }
    const match = leadingPunctuation.exec(segment.text);
    if (match) previous.punctuation = match[1];
    const space = match ? match[2] : (leadingSpace.exec(segment.text)?.[0] ?? '');
    if (space) previous.after = space.includes('\n\n') ? 'paragraph' : 'space';
    else if (!match && leadingWord.test(segment.text)) previous.after = 'space';
    const rest = segment.text.slice(match ? match[0].length : space.length);
    if (rest) joined.push({ segment: { ...segment, text: rest } });
  }
  return joined;
}
