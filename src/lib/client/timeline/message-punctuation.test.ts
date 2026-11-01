import { describe, expect, it } from 'vitest';

import type { MessageContent } from '$lib/shared/projects/events/message-content';

import { joinTrailingPunctuation } from './message-punctuation';

const reference = { type: 'presentation-ref', presentationId: 'p1' } as MessageContent[number];
const text = (value: string) => ({ type: 'markdown', text: value }) as MessageContent[number];

describe('joinTrailingPunctuation', () => {
  it('moves the punctuation opening the next text onto the reference', () => {
    expect(joinTrailingPunctuation([text('as '), reference, text(', compare these')])).toEqual([
      { segment: text('as ') },
      { segment: reference, punctuation: ',', after: 'space' },
      { segment: text('compare these') }
    ]);
  });

  it('drops text that was only punctuation', () => {
    expect(joinTrailingPunctuation([text('as in '), reference, text('.')])).toEqual([
      { segment: text('as in ') },
      { segment: reference, punctuation: '.' }
    ]);
  });

  it('keeps a new paragraph after the punctuation', () => {
    expect(joinTrailingPunctuation([text('Viewing '), reference, text('.\n\nWith code?')])).toEqual(
      [
        { segment: text('Viewing ') },
        { segment: reference, punctuation: '.', after: 'paragraph' },
        { segment: text('With code?') }
      ]
    );
  });

  it('leaves text after a reference that opens with a word', () => {
    expect(joinTrailingPunctuation([reference, text(' and more.')])).toEqual([
      { segment: reference },
      { segment: text(' and more.') }
    ]);
  });
});
