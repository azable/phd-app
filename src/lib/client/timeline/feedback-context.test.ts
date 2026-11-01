import { describe, expect, it } from 'vitest';

import type { TimelinePresentation } from '$lib/client/visualization/presentation-history';

import {
  feedbackSubmissionContent,
  feedbackViewing,
  selectedFeedbackContext
} from './feedback-context';

const presentationIds = [
  '12345678-1234-4123-8123-123456789ac1',
  '12345678-1234-4123-8123-123456789ac2'
] as const;

const words = [{ type: 'markdown' as const, text: 'Lecture' }];

describe('feedback context', () => {
  it('leaves the message as the participant wrote it where nothing is selected', () => {
    const shown = [presentation(4, presentationIds[0]), presentation(5, presentationIds[1])];
    expect(feedbackSubmissionContent(words, selectedFeedbackContext(shown))).toEqual(words);
  });

  it('starts the message with the elements selected in a visible presentation', () => {
    const element = { id: '62:7#2', label: 'Int 8' };
    const selected = selectedFeedbackContext(
      [presentation(4, presentationIds[0]), presentation(5, presentationIds[1])],
      [{ presentationId: presentationIds[1], step: 2, elements: [element] }]
    );
    expect(feedbackSubmissionContent(words, selected)).toEqual([
      { type: 'element-ref', presentationId: presentationIds[1], step: 2, element },
      ...words
    ]);
  });

  it('preserves deliberately inserted chips exactly instead of adding the selection', () => {
    const explicit = [
      { type: 'markdown' as const, text: 'The spacing in ' },
      { type: 'presentation-ref' as const, presentationId: presentationIds[1] },
      { type: 'markdown' as const, text: ' is clearer.' }
    ];
    const selected = selectedFeedbackContext(
      [presentation(4, presentationIds[0])],
      [{ presentationId: presentationIds[0], step: 0, elements: [{ id: '1:1', label: 'x' }] }]
    );
    expect(feedbackSubmissionContent(explicit, selected)).toEqual(explicit);
  });

  it('records each visible presentation at the step it shows, by its number and name', () => {
    expect(
      feedbackViewing(
        [presentation(4, presentationIds[0]), presentation(5, presentationIds[1])],
        undefined,
        { [presentationIds[0]]: 2, [presentationIds[1]]: -1 }
      )
    ).toEqual({
      presentations: [
        { presentationId: presentationIds[0], step: 2, stepName: '@check#2' },
        { presentationId: presentationIds[1] }
      ]
    });
  });

  it('records a source chosen on its own, and nothing where nothing is on screen', () => {
    expect(feedbackViewing([], 'abc123')).toEqual({ source: 'abc123' });
    expect(feedbackViewing([])).toBeUndefined();
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
        text: JSON.stringify({
          format: 'sverlin-html-frames',
          version: 1,
          frames: ['start', '@check#1', '@check#2'].map((label) => ({ label, html: '<p>step</p>' }))
        }),
        mediaType: 'application/json',
        sha256: 'b'.repeat(64)
      }
    }
  };
}
