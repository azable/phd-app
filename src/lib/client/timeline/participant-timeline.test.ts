import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from '$lib/shared/projects/events';

import { participantTimeline } from './participant-timeline';

const presentationIds = [
  '12345678-1234-4123-8123-123456789ac1',
  '12345678-1234-4123-8123-123456789ac2'
] as const;

describe('participant Timeline projection', () => {
  it('keeps structured messages, preference actions, and the variants each turn made', () => {
    const items = participantTimeline(events());
    expect(items.map(({ kind }) => kind)).toEqual(['message', 'message', 'version', 'message']);
    // Both presentations were built from one source in one turn, so they are its two variants.
    // The card carries its source, which code its summary names is found in.
    expect(items[2]).toMatchObject({
      kind: 'version',
      sourceHash: 'a'.repeat(64),
      source: 'source'
    });
    expect(
      items[2].kind === 'version' &&
        items[2].variants.map(({ presentation }) => presentation.presentationId)
    ).toEqual(presentationIds.slice(0, 2));
    expect(items[0]).toMatchObject({
      kind: 'message',
      actor: 'user',
      content: [{ type: 'markdown', text: 'Show addition' }]
    });
    expect(items[1]).toMatchObject({
      kind: 'message',
      actor: 'assistant'
    });
    expect(items[3]).toMatchObject({
      kind: 'message',
      actor: 'user',
      content: expect.arrayContaining([
        { type: 'markdown', text: 'Preferred' },
        { type: 'presentation-ref', presentationId: presentationIds[0] },
        { type: 'presentation-ref', presentationId: presentationIds[1] }
      ])
    });
  });

  it('shows a variant where it was made, after the turn that first showed its source', () => {
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
    const versions = participantTimeline(values).filter((item) => item.kind === 'version');
    expect(versions).toMatchObject([
      { id: `version-${'a'.repeat(64)}`, first: true },
      { id: `version-${'a'.repeat(64)}-6`, first: false }
    ]);
    expect(
      versions.map((item) => item.variants.map(({ presentation }) => presentation.presentationId))
    ).toEqual([presentationIds.slice(0, 2), [later]]);
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
      kind: 'message',
      actor: 'assistant',
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
