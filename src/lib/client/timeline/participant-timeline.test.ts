import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from '$lib/shared/projects/events';

import { loadReportLine } from './load-reports';
import {
  participantTimeline,
  withoutRepeatedQuestion,
  type ParticipantTimelineItem
} from './participant-timeline';

const presentationIds = [
  '12345678-1234-4123-8123-123456789ac1',
  '12345678-1234-4123-8123-123456789ac2'
] as const;

type Turn = Extract<ParticipantTimelineItem, { kind: 'turn' }>;
const turns = (items: ParticipantTimelineItem[]) =>
  items.filter((item): item is Turn => item.kind === 'turn');

describe('participant Timeline projection', () => {
  it('groups a turn into one message that names its versions, and keeps preference actions', () => {
    const items = participantTimeline(events());
    expect(items.map(({ kind }) => kind)).toEqual(['message', 'turn', 'message']);
    expect(items[0]).toMatchObject({
      kind: 'message',
      actor: 'user',
      content: [{ type: 'markdown', text: 'Show addition' }]
    });
    // The reply names both presentations, so none is appended; each pill carries its source.
    const [turn] = turns(items);
    expect(turn).toMatchObject({ appended: [], comparisons: [], firsts: ['a'.repeat(64)] });
    expect(Object.keys(turn.pills)).toEqual([...presentationIds]);
    expect(turn.pills[presentationIds[0]]).toMatchObject({
      sourceHash: 'a'.repeat(64),
      summary: 'A source'
    });
    expect(items[2]).toMatchObject({
      kind: 'message',
      actor: 'user',
      content: expect.arrayContaining([
        { type: 'markdown', text: 'Preferred' },
        { type: 'presentation-ref', presentationId: presentationIds[0] },
        { type: 'presentation-ref', presentationId: presentationIds[1] }
      ])
    });
  });

  it('appends the versions a reply does not name as pills at its end', () => {
    const values = events();
    const responded = values[1];
    if (responded.type !== 'assistant.responded') throw new Error('Missing response.');
    responded.payload.content = [
      { type: 'markdown', text: 'Adds the digits:' },
      { type: 'presentation-ref', presentationId: presentationIds[1] }
    ];
    const [turn] = turns(participantTimeline(values));
    expect(turn.appended).toEqual([presentationIds[0]]);
    expect(Object.keys(turn.pills).toSorted()).toEqual([...presentationIds].toSorted());
  });

  it('shows a pair in its turn with its question and the preferred side’s label, which replaces the preference message', () => {
    const items = participantTimeline(askedPair());
    expect(items.map(({ kind }) => kind)).toEqual(['message', 'turn']);
    expect(turns(items)[0]).toMatchObject({
      appended: [],
      comparisons: [
        {
          question: {
            text: 'Cells or tallies?',
            presentationIds: [...presentationIds],
            labels: ['cells', 'tallies']
          },
          answer: [{ type: 'markdown', text: 'cells' }]
        }
      ]
    });
  });

  it('shows either is fine on an undesigned pair, and a question in words in its turn, its answer the next message', () => {
    const values = events();
    values[4] = {
      ...values[4],
      payload: { presentations: [...presentationIds], outcome: 'tie', step: 0 }
    } as ProjectEvent;
    const responded = values[1];
    if (responded.type !== 'assistant.responded') throw new Error('Missing response.');
    responded.payload.question = { text: 'Who is it for?' };
    values.push(answer(6, 'Students'));
    const items = participantTimeline(values);
    expect(items.map(({ kind }) => kind)).toEqual(['message', 'turn', 'message', 'message']);
    expect(items[1]).toMatchObject({
      question: { question: { text: 'Who is it for?' }, pill: false }
    });
    expect(items[1]).not.toHaveProperty('question.answer');
    expect(items[2]).toMatchObject({
      content: expect.arrayContaining([{ type: 'markdown', text: 'Either is fine:' }])
    });
    expect(items[3]).toMatchObject({ content: [{ type: 'markdown', text: 'Students' }] });
  });

  it('gives a question a pill only where the message does not show what it is about', () => {
    const asking = (question: { text: string; presentationId?: string }) => {
      const values = events();
      const responded = values[1];
      if (responded.type !== 'assistant.responded') throw new Error('Missing response.');
      responded.payload.content = [
        { type: 'markdown', text: 'Adds the digits:' },
        { type: 'presentation-ref', presentationId: presentationIds[1] }
      ];
      responded.payload.question = question;
      return turns(participantTimeline(values))[0];
    };
    // About a presentation the reply names: no pill of its own.
    expect(
      asking({ text: 'Too dense?', presentationId: presentationIds[1] }).question
    ).toMatchObject({ pill: false });
    // About a presentation the turn made but did not name: its pill, in place of the appended one.
    const example = asking({ text: 'Like this?', presentationId: presentationIds[0] });
    expect(example.question).toMatchObject({ pill: true });
    expect(example.appended).toEqual([]);
    expect(Object.keys(example.pills)).toContain(presentationIds[0]);
  });

  it('names in a reply recorded after them the versions its turn made, with no pill appended', () => {
    const [feedback, responded, ...rest] = events();
    if (responded.type !== 'assistant.responded') throw new Error('Missing response.');
    const presented = rest.filter(({ type }) => type === 'visualization.presented');
    responded.payload.content = [
      { type: 'presentation-ref', presentationId: presentationIds[0] },
      { type: 'markdown', text: 'is an initial visualisation of addition.' }
    ];
    responded.payload.question = { text: 'Too dense?', presentationId: presentationIds[0] };
    const values = [feedback, ...presented, responded].map(
      (event, index) => ({ ...event, id: index + 1 }) as ProjectEvent
    );
    const [turn] = turns(participantTimeline(values));
    expect(turn.appended).toEqual([presentationIds[1]]);
    expect(turn.question).toMatchObject({
      question: { presentationIds: [presentationIds[0]] },
      pill: false
    });
  });

  it('shows a question about an earlier presentation with its pill', () => {
    const values = events();
    values.push({
      id: 6,
      type: 'assistant.responded',
      actor: { kind: 'assistant', botId: 'sverlin-assistant' },
      operationId: '82345678-1234-4234-8234-123456789abc',
      createdAt: '2026-08-30T00:00:06.000Z',
      payload: {
        content: [{ type: 'markdown', text: 'One thing first.' }],
        question: { text: 'Is the carry clear?', presentationId: presentationIds[0] }
      }
    });
    const [, later] = turns(participantTimeline(values));
    expect(later).toMatchObject({ appended: [], question: { pill: true } });
    expect(Object.keys(later.pills)).toEqual([presentationIds[0]]);
  });

  it('leaves out of a reply its last sentence where that says its question again', () => {
    const values = events();
    const responded = values[1];
    if (responded.type !== 'assistant.responded') throw new Error('Missing response.');
    responded.payload.content = [
      { type: 'markdown', text: 'I’ll keep the listing, as in ' },
      { type: 'presentation-ref', presentationId: presentationIds[0] },
      { type: 'markdown', text: '. Who is it for, and how familiar are they with linear search?' }
    ];
    responded.payload.question = {
      text: 'Who is it for, and how familiar are they with linear search?'
    };
    expect(turns(participantTimeline(values))[0].content).toEqual([
      { type: 'markdown', text: 'I’ll keep the listing, as in ' },
      { type: 'presentation-ref', presentationId: presentationIds[0] },
      { type: 'markdown', text: '.' }
    ]);
  });

  it('shows a variant where it was made, in a turn of its own, after the turn that first showed its source', () => {
    const later = '12345678-1234-4123-8123-123456789ac3';
    const values = events();
    const [, , first] = values;
    if (
      first.type !== 'visualization.presented' ||
      first.payload.presentation.format !== 'browser-bundle-v1'
    )
      throw new Error('Missing presentation.');
    values.push({
      ...first,
      id: 6,
      operationId: '72345678-1234-4234-8234-123456789abc',
      payload: {
        ...first.payload,
        slot: 0,
        presentation: { ...first.payload.presentation, presentationId: later, seed: 9 }
      }
    });
    expect(turns(participantTimeline(values))).toMatchObject([
      { id: 'assistant-2', firsts: ['a'.repeat(64)], summaries: [] },
      { id: 'presented-6', firsts: [], summaries: [], appended: [later] }
    ]);
  });

  it('says what a source shows where its turn has no reply', () => {
    const values = events().filter(({ type }) => type !== 'assistant.responded');
    const [turn] = turns(participantTimeline(values));
    expect(turn).not.toHaveProperty('content');
    expect(turn).toMatchObject({
      summaries: [{ sourceHash: 'a'.repeat(64), text: 'A source', source: 'source' }],
      appended: [...presentationIds]
    });
  });

  it('retains exact comparison references inline', () => {
    const values = events().slice(1, 5);
    values.push({
      id: 6,
      type: 'feedback.submitted',
      actor: { kind: 'user' },
      operationId: '32345678-1234-4234-8234-123456789abc',
      createdAt: '2026-08-30T00:00:06.000Z',
      payload: {
        focus: [],
        content: [
          { type: 'markdown', text: 'Compare' },
          { type: 'presentation-ref', presentationId: presentationIds[0] },
          { type: 'markdown', text: 'with' },
          { type: 'presentation-ref', presentationId: presentationIds[1] }
        ]
      }
    });
    expect(participantTimeline(values).at(-1)).toMatchObject({
      kind: 'message',
      actor: 'user',
      content: expect.arrayContaining([
        expect.objectContaining({ type: 'presentation-ref', presentationId: presentationIds[0] })
      ])
    });
  });

  it('presents known UUIDs from historical assistant Markdown as references', () => {
    const values = events();
    const response = values.find((event) => event.type === 'assistant.responded');
    if (response?.type !== 'assistant.responded') throw new Error('Missing assistant response.');
    response.payload.content = [
      {
        type: 'markdown',
        text: `Prefer presentation \`${presentationIds[0]}\` over the outlined treatment.`
      }
    ];

    expect(participantTimeline(values)[1]).toMatchObject({
      kind: 'turn',
      appended: [presentationIds[1]],
      content: [
        { type: 'markdown', text: 'Prefer presentation ' },
        { type: 'presentation-ref', presentationId: presentationIds[0] },
        { type: 'markdown', text: ' over the outlined treatment.' }
      ]
    });
  });

  it('gives a failure the source of its last build that failed on its code', () => {
    const items = participantTimeline(
      failedOperation('assistant-turn', [
        { input: 'assistant-candidate', source: 'first attempt', failureKind: 'source' },
        { input: 'assistant-candidate', source: 'repaired attempt', failureKind: 'source' }
      ])
    );
    expect(items.at(-1)).toMatchObject({
      kind: 'error',
      failed: { source: 'repaired attempt', by: 'assistant' }
    });
  });

  it('gives a failed save its saved source', () => {
    const items = participantTimeline(
      failedOperation('save', [
        { input: 'committed-artifact', source: 'saved by hand', failureKind: 'source' }
      ])
    );
    expect(items.at(-1)).toMatchObject({
      kind: 'error',
      failed: { source: 'saved by hand', by: 'save' }
    });
  });

  it('shows an info notice as a note, and no other notice', () => {
    const notice = (id: number, severity: 'info' | 'warning' | 'error'): ProjectEvent => ({
      id,
      type: 'system.notified',
      actor: { kind: 'system' },
      operationId: `62345678-1234-4234-8234-12345678900${id}`,
      createdAt: `2026-08-30T00:02:0${id}.000Z`,
      payload: { severity, message: `Click \`@left\` (${severity}).` }
    });
    const items = participantTimeline([
      notice(1, 'info'),
      notice(2, 'warning'),
      notice(3, 'error')
    ]);
    expect(items).toEqual([
      { id: 'note-1', kind: 'note', text: 'Click `@left` (info).', eventId: 1 }
    ]);
  });

  it('makes a note about the card before it', () => {
    const note: ProjectEvent = {
      id: 99,
      type: 'system.notified',
      actor: { kind: 'system' },
      operationId: '62345678-1234-4234-8234-123456789999',
      createdAt: '2026-08-30T00:09:00.000Z',
      payload: { severity: 'info', message: 'Click `source`.' }
    };
    expect(participantTimeline([...events(), note]).at(-1)).toMatchObject({
      kind: 'note',
      of: { sourceHash: 'a'.repeat(64), source: 'source' }
    });
  });

  it('gives no source to a failure whose builds did not fail on their code', () => {
    const items = participantTimeline(
      failedOperation('assistant-turn', [
        { input: 'assistant-candidate', source: 'never compiled', failureKind: 'infrastructure' }
      ])
    );
    expect(items.at(-1)).toMatchObject({ kind: 'error' });
    expect(items.at(-1)).not.toHaveProperty('failed');
  });

  it('shows how a presentation loaded only for audit, as developer view does', () => {
    const before = events();
    const loaded: ProjectEvent = {
      id: before.length + 1,
      type: 'visualization.loaded',
      actor: { kind: 'system' },
      operationId: '12345678-1234-4123-8123-123456789abf',
      createdAt: '2026-01-01T00:00:10.000Z',
      payload: {
        presentationId: presentationIds[0],
        outcome: 'ready',
        sinceLoadMs: 84,
        layout: 'server',
        measuringMs: 0,
        recordingMs: 3,
        showingMs: 20,
        passes: 1,
        mostChanges: 0,
        visibility: 'visible',
        devicePixelRatio: 2,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/142.0.0.0 Safari/537.36'
      }
    };
    expect(participantTimeline([...before, loaded])).toEqual(participantTimeline(before));
    expect(participantTimeline([...before, loaded], { audit: true }).at(-1)).toEqual({
      id: `load-${loaded.id}`,
      kind: 'load',
      event: loaded
    });
    expect(loadReportLine(loaded.payload)).toBe('server layout · 84 ms · Chrome/macOS · 2×');
  });
});

describe('a reply without its repeated question', () => {
  const reply = (text: string) => [{ type: 'markdown' as const, text }];

  it('drops a last paragraph that rewords the question, as seen in trials', () => {
    expect(
      withoutRepeatedQuestion(
        reply(
          'Linear search, checking each cell in turn:\n\nWould you like me to suggest some alternatives to compare—for example, different ways to mark the current cell or arrange the pseudocode?'
        ),
        'Would you like me to suggest alternatives to compare, such as different current-cell markers or pseudocode arrangements?'
      )
    ).toEqual(reply('Linear search, checking each cell in turn:'));
  });

  it('drops a last sentence that holds the question or is held by it, whatever its case and marks', () => {
    expect(
      withoutRepeatedQuestion(
        reply('Here it is. To refine it, **who is it for?**'),
        'Who is it for?'
      )
    ).toEqual(reply('Here it is.'));
    expect(withoutRepeatedQuestion(reply('Done. Who is it for?'), 'So, who is it for?')).toEqual(
      reply('Done.')
    );
  });

  it('keeps a reply whose ending asks something else or only shares a word with the question', () => {
    const kept = [
      ['Done. Would you like me to compare colours?', 'Would you like to compare fonts?'],
      ['Shown with cells.', 'Cells or tallies for the numbers, or neither?'],
      ['Who is it for?', 'Should it print in grey?']
    ];
    for (const [text, question] of kept)
      expect(withoutRepeatedQuestion(reply(text), question)).toEqual(reply(text));
    expect(withoutRepeatedQuestion(reply('Who is it for?'), undefined)).toEqual(
      reply('Who is it for?')
    );
  });

  it('leaves nothing of a reply that is only the question', () => {
    expect(withoutRepeatedQuestion(reply('Who is it for?'), 'Who is it for?')).toEqual([]);
  });
});

/** An operation whose builds each fail as given, in order, then the operation itself. */
function failedOperation(
  kind: 'assistant-turn' | 'save',
  builds: {
    input: 'assistant-candidate' | 'committed-artifact';
    source: string;
    failureKind: 'source' | 'infrastructure';
  }[]
): ProjectEvent[] {
  const operationId = '42345678-1234-4234-8234-123456789abc';
  const envelope = (id: number) => ({
    id,
    actor: { kind: 'system' as const },
    operationId,
    createdAt: `2026-08-30T00:01:${String(id).padStart(2, '0')}.000Z`
  });
  return [
    ...builds.flatMap(({ input, source, failureKind }, index): ProjectEvent[] => {
      const buildId = `52345678-1234-4234-8234-12345678900${index}`;
      return [
        {
          ...envelope(2 * index + 1),
          type: 'build.requested',
          payload: {
            purpose: input === 'assistant-candidate' ? 'assistant-edit' : 'manual-edit',
            input,
            source: { text: source, sha256: 'd'.repeat(64), mediaType: 'text/x-svelte' },
            sourceLabel: 'Main.svelte',
            seed: 1,
            buildId
          }
        },
        {
          ...envelope(2 * index + 2),
          type: 'build.failed',
          payload: { durationMs: 1, buildId, failureKind, diagnostics: [], repairEligible: true }
        }
      ];
    }),
    {
      ...envelope(2 * builds.length + 1),
      type: 'operation.failed',
      payload: { kind, failureKind: 'domain', message: 'The source did not build.' }
    }
  ];
}

/** The base events, their pair asking a question with a label on each side. */
function askedPair(): ProjectEvent[] {
  return events().map(
    (event): ProjectEvent =>
      event.type === 'visualization.presented'
        ? {
            ...event,
            payload: {
              ...event.payload,
              question: 'Cells or tallies?',
              label: event.payload.slot ? 'tallies' : 'cells',
              presentation: {
                ...event.payload.presentation,
                variant: { 'views.Int': event.payload.slot ? 'IntTally' : 'IntCell' }
              } as typeof event.payload.presentation
            }
          }
        : event
  );
}

/** The participant's message answering the base reply's question. */
function answer(id: number, text: string): ProjectEvent {
  return {
    id,
    type: 'feedback.submitted',
    actor: { kind: 'user' },
    operationId: '32345678-1234-4234-8234-123456789abc',
    createdAt: `2026-08-30T00:00:0${id}.000Z`,
    payload: { content: [{ type: 'markdown', text }], focus: [], answers: 2 }
  };
}

function events(): ProjectEvent[] {
  const operationId = '12345678-1234-4123-8123-123456789abc';
  const displaySetId = '12345678-1234-4123-8123-123456789abd';
  const base = {
    format: 'browser-bundle-v1' as const,
    mode: 'sverlin' as const,
    stepSignature: 'shared',
    labels: ['Only step'],
    source: { text: 'source', sha256: 'a'.repeat(64), mediaType: 'text/x-svelte' },
    html: { text: '', sha256: 'c'.repeat(64), mediaType: 'text/html' },
    javascript: { text: 'void 0;', sha256: 'b'.repeat(64), mediaType: 'text/javascript' }
  };
  return [
    {
      id: 1,
      type: 'feedback.submitted',
      actor: { kind: 'user' },
      operationId,
      createdAt: '2026-08-30T00:00:01.000Z',
      payload: { content: [{ type: 'markdown', text: 'Show addition' }], focus: [] }
    },
    {
      id: 2,
      type: 'assistant.responded',
      actor: { kind: 'assistant', botId: 'sverlin-assistant' },
      operationId,
      createdAt: '2026-08-30T00:00:02.000Z',
      payload: {
        content: [
          { type: 'markdown', text: 'Here are' },
          { type: 'presentation-ref', presentationId: presentationIds[0] },
          { type: 'markdown', text: 'and' },
          { type: 'presentation-ref', presentationId: presentationIds[1] }
        ]
      }
    },
    ...presentationIds.map(
      (presentationId, slot): ProjectEvent => ({
        id: slot + 3,
        type: 'visualization.presented',
        actor: { kind: 'assistant', botId: 'sverlin-assistant' },
        operationId,
        createdAt: `2026-08-30T00:00:0${slot + 3}.000Z`,
        payload: {
          displaySetId,
          slot: slot as 0 | 1,
          presentation: { ...base, presentationId, seed: slot + 1 }
        }
      })
    ),
    {
      id: 5,
      type: 'visualization.preference-recorded',
      actor: { kind: 'user' },
      operationId: '22345678-1234-4234-8234-123456789abc',
      createdAt: '2026-08-30T00:00:05.000Z',
      payload: {
        displaySetId,
        presentations: [...presentationIds],
        preferred: presentationIds[0],
        step: 0
      }
    }
  ];
}
