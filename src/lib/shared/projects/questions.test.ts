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
        answer: { kind: 'text', eventId: 2, text: 'Students.' }
      }
    ]);
    expect(openQuestion(events)).toBeUndefined();
    expect(openQuestion(events.slice(0, 1))?.eventId).toBe(1);
  });

  it('takes a question’s example as the next presentation its operation shows', () => {
    const events = timeline(
      presented('x', { operationId: 'earlier' }),
      responded({ text: 'Like this?', example: true, elements: ['3:5'] }, 'turn'),
      presented('e', { operationId: 'turn' }),
      presented('f', { operationId: 'turn', slot: 1, displaySetId: 'set-e' })
    );
    expect(projectQuestions(events)).toMatchObject([
      { kind: 'presentation', presentationIds: ['e'], elements: ['3:5'] }
    ]);
    // Without a presentation, as when the example failed to build, it is a question in words.
    expect(projectQuestions(events.slice(0, 2))).toMatchObject([
      { kind: 'text', presentationIds: [] }
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
    expect(answerLabel(preferred)).toBe('tallies');
    expect(answerLabel(answered({ outcome: 'tie' }))).toBe('either is fine');
    expect(answerLabel(answered({ outcome: 'skip' }))).toBe('later');
  });

  it('keeps one question open at a time, a newer one replacing it', () => {
    const events = timeline(responded({ text: 'First?' }), responded({ text: 'Second?' }));
    expect(openQuestion(events)?.text).toBe('Second?');
  });

  it('abbreviates a long answer in its caption', () => {
    const [question] = projectQuestions(
      timeline(responded({ text: 'Why?' }), message('Because '.repeat(20), 1))
    );
    expect(answerLabel(question)).toMatch(/^Because Because .{40,}…$/u);
  });
});
