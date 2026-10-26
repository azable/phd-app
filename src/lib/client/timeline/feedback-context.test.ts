import { describe, expect, it } from 'vitest';

import type { TimelinePresentation } from '$lib/client/visualization/presentation-history';

import { automaticFeedbackContext, feedbackSubmissionContent } from './feedback-context';

const presentationIds = [
  '12345678-1234-4123-8123-123456789ac1',
  '12345678-1234-4123-8123-123456789ac2'
] as const;

describe('automatic feedback context', () => {
  it('retains the one visible presentation before participant prose', () => {
    const context = automaticFeedbackContext([presentation(4, presentationIds[0])]);
    expect(
      feedbackSubmissionContent([{ type: 'markdown', text: 'Make it clearer.' }], context)
    ).toEqual([
      { type: 'markdown', text: 'Viewing ' },
      { type: 'presentation-ref', presentationId: presentationIds[0] },
      { type: 'markdown', text: '.\n\nMake it clearer.' }
    ]);
  });

  it('references each visible presentation at the step it shows', () => {
    expect(
      automaticFeedbackContext(
        [presentation(4, presentationIds[0]), presentation(5, presentationIds[1])],
        [],
        undefined,
        { [presentationIds[0]]: 2, [presentationIds[1]]: -1 }
      )
    ).toEqual([
      { type: 'markdown', text: 'Comparing ' },
      { type: 'presentation-ref', presentationId: presentationIds[0], step: 2 },
      { type: 'markdown', text: ' with ' },
      { type: 'presentation-ref', presentationId: presentationIds[1] },
      { type: 'markdown', text: '.' }
    ]);
  });

  it('references selected elements in place of their presentation', () => {
    const element = { id: '62:7#2', label: 'Int 8' };
    expect(
      automaticFeedbackContext(
        [presentation(4, presentationIds[0]), presentation(5, presentationIds[1])],
        [{ presentationId: presentationIds[1], step: 2, elements: [element] }]
      )
    ).toEqual([
      { type: 'markdown', text: 'Comparing ' },
      { type: 'presentation-ref', presentationId: presentationIds[0] },
      { type: 'markdown', text: ' with ' },
      { type: 'element-ref', presentationId: presentationIds[1], step: 2, element },
      { type: 'markdown', text: '.' }
    ]);
  });

  it('references both visible presentations in a comparison', () => {
    expect(
      automaticFeedbackContext([
        presentation(4, presentationIds[0]),
        presentation(5, presentationIds[1])
      ])
    ).toEqual([
      { type: 'markdown', text: 'Comparing ' },
      { type: 'presentation-ref', presentationId: presentationIds[0] },
      { type: 'markdown', text: ' with ' },
      { type: 'presentation-ref', presentationId: presentationIds[1] },
      { type: 'markdown', text: '.' }
    ]);
  });

  it('preserves deliberately inserted chips exactly instead of duplicating context', () => {
    const explicit = [
      { type: 'markdown' as const, text: 'The spacing in ' },
      { type: 'presentation-ref' as const, presentationId: presentationIds[1] },
      { type: 'markdown' as const, text: ' is clearer.' }
    ];
    const context = automaticFeedbackContext([
      presentation(4, presentationIds[0]),
      presentation(5, presentationIds[1])
    ]);
    expect(feedbackSubmissionContent(explicit, context)).toEqual(explicit);
  });
});

function presentation(eventId: number, presentationId: string): TimelinePresentation {
  return {
    eventId,
    eventType: 'visualization.presented',
    operationId: '12345678-1234-4123-8123-123456789abc',
    slot: eventId === 4 ? 0 : 1,
    presentation: {
      format: 'html-frames-v1',
      presentationId,
      stepSignature: 'shared',
      authored: {
        text: '{}',
        mediaType: 'application/json',
        sha256: 'a'.repeat(64)
      },
      rendered: {
        text: '{}',
        mediaType: 'application/json',
        sha256: 'b'.repeat(64)
      }
    }
  };
}
