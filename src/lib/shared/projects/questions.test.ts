import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from './events';
import { answerLabel, openQuestion, projectQuestions } from './questions';

/** Events numbered in order, each in the operation named. */
function timeline(...events: object[]): ProjectEvent[] {
  return events.map(
    (event, index) => ({ id: index + 1, operationId: 'op', ...event }) as unknown as ProjectEvent
  );
}
const responded = (question?: object, operationId = 'op') => ({
  type: 'assistant.responded',
  operationId,
  payload: { content: [], ...(question ? { question } : {}) }
});
const presented = (
  presentationId: string,
  options: {
    displaySetId?: string;
    slot?: number;
    question?: string;
    label?: string;
    operationId?: string;
  } = {}
) => ({
  type: 'visualization.presented',
  operationId: options.operationId ?? 'op',
  payload: {
    displaySetId: options.displaySetId ?? `set-${presentationId}`,
    slot: options.slot ?? 0,
    ...(options.question ? { question: options.question } : {}),
    ...(options.label ? { label: options.label } : {}),
    presentation: {
      format: 'browser-bundle-v1',
      presentationId,
      variant: {
        'views.Int': presentationId === 'b' ? 'IntTally' : 'IntCell',
        'Cell.fill': 'white'
      }
    }
  }
});
const message = (text: string, answers?: number) => ({
  type: 'feedback.submitted',
  payload: { content: [{ type: 'markdown', text }], focus: [], ...(answers ? { answers } : {}) }
});

describe('questions', () => {
  it('reads a question in words with the message answering it', () => {
    const events = timeline(responded({ text: 'Who is it for?' }), message('Students.', 1));
    expect(projectQuestions(events)).toEqual([
      {
        kind: 'text',
        eventId: 1,
        text: 'Who is it for?',
        presentationIds: [],
        answer: { kind: 'text', eventId: 2, content: [{ type: 'markdown', text: 'Students.' }] }
      }
    ]);
    expect(openQuestion(events)).toBeUndefined();
    expect(openQuestion(events.slice(0, 1))?.eventId).toBe(1);
  });

  it('reads a question about the presentation its turn made, recorded after it', () => {
    const events = timeline(
      presented('x', { operationId: 'earlier' }),
      presented('e', { operationId: 'turn' }),
      responded({ text: 'Like this?', presentationId: 'e', elements: ['3:5'] }, 'turn')
    );
    expect(projectQuestions(events)).toMatchObject([
      { kind: 'presentation', presentationIds: ['e'], elements: ['3:5'] }
    ]);
  });

  it('reads a pair with its question and the answer by side, either is fine, or later', () => {
    const pair = [
      presented('a', { displaySetId: 's', question: 'Cells or tallies?', label: 'cells' }),
      presented('b', {
        displaySetId: 's',
        slot: 1,
        question: 'Cells or tallies?',
        label: 'tallies'
      })
    ];
    const answered = (payload: object) =>
      projectQuestions(
        timeline(...pair, {
          type: 'visualization.preference-recorded',
          payload: { displaySetId: 's', presentations: ['a', 'b'], step: 0, ...payload }
        })
      )[0];
    const preferred = answered({ preferred: 'b' });
    expect(preferred).toMatchObject({
      kind: 'pair',
      eventId: 1,
      presentationIds: ['a', 'b'],
      labels: ['cells', 'tallies'],
      answer: { kind: 'preferred', presentationId: 'b' }
    });
    const words = (text: string) => [{ type: 'markdown', text }];
    expect(answerLabel(preferred)).toEqual(words('tallies'));
    expect(answerLabel(answered({ outcome: 'tie' }))).toEqual(words('either is fine'));
    expect(answerLabel(answered({ outcome: 'skip' }))).toEqual(words('later'));
  });

  it('keeps one question open at a time, a newer one replacing it', () => {
    const events = timeline(responded({ text: 'First?' }), responded({ text: 'Second?' }));
    expect(openQuestion(events)?.text).toBe('Second?');
  });

  it('abbreviates a long answer in its caption', () => {
    const [question] = projectQuestions(
      timeline(responded({ text: 'Why?' }), message('Because '.repeat(20), 1))
    );
    expect(answerLabel(question)).toEqual([
      { type: 'markdown', text: expect.stringMatching(/^Because Because .{40,}…$/u) }
    ]);
  });

  it('keeps an answer’s references and only what words keeps, on one line', () => {
    const reference = { type: 'presentation-ref', presentationId: 'a' };
    const [question] = projectQuestions(
      timeline(responded({ text: 'Why?' }), {
        type: 'feedback.submitted',
        payload: {
          content: [
            { type: 'markdown', text: 'Viewing ' },
            reference,
            { type: 'markdown', text: '.\n\nLike\nthis' }
          ],
          focus: [],
          answers: 1
        }
      })
    );
    expect(answerLabel(question, (content) => content.slice(1))).toEqual([
      reference,
      { type: 'markdown', text: '. Like this' }
    ]);
  });
});
