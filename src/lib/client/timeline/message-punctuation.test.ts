import { describe, expect, it } from 'vitest';

import type { MessageContent } from '$lib/shared/projects/events/message-content';

import { joinTrailingPunctuation } from './message-punctuation';

const reference = { type: 'presentation-ref', presentationId: 'p1' } as MessageContent[number];
const text = (value: string) => ({ type: 'markdown', text: value }) as MessageContent[number];

describe('joinTrailingPunctuation', () => {
  it('moves the punctuation opening the next text onto the reference', () => {
    expect(joinTrailingPunctuation([text('as '), reference, text(', compare these')])).toEqual([
      { segment: text('as '), after: 'space' },
      { segment: reference, punctuation: ',', after: 'space' },
      { segment: text('compare these') }
    ]);
  });

  it('drops text that was only punctuation', () => {
    expect(joinTrailingPunctuation([text('as in '), reference, text('.')])).toEqual([
      { segment: text('as in '), after: 'space' },
      { segment: reference, punctuation: '.' }
    ]);
  });

  it('keeps a new paragraph after the punctuation', () => {
    expect(joinTrailingPunctuation([text('Viewing '), reference, text('.\n\nWith code?')])).toEqual(
      [
        { segment: text('Viewing '), after: 'space' },
        { segment: reference, punctuation: '.', after: 'paragraph' },
        { segment: text('With code?') }
      ]
    );
  });

  it('keeps the space after a reference that markdown would drop', () => {
    expect(joinTrailingPunctuation([reference, text(' and more.')])).toEqual([
      { segment: reference, after: 'space' },
      { segment: text('and more.') }
    ]);
    expect(joinTrailingPunctuation([reference, text('\n\nNext.')])).toEqual([
      { segment: reference, after: 'paragraph' },
      { segment: text('Next.') }
    ]);
  });

  it('sets a word written straight after a reference apart from it', () => {
    expect(joinTrailingPunctuation([text('See '), reference, text('I chose it.')])).toEqual([
      { segment: text('See '), after: 'space' },
      { segment: reference, after: 'space' },
      { segment: text('I chose it.') }
    ]);
  });
});
