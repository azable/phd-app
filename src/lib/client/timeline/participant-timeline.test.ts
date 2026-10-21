import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from '$lib/shared/projects/events';

import { participantTimeline } from './participant-timeline';

const presentationIds = [
  '12345678-1234-4123-8123-123456789ac1',
  '12345678-1234-4123-8123-123456789ac2'
] as const;

describe('participant Timeline projection', () => {
  it('keeps structured messages, preference actions, and one card per source', () => {
    const items = participantTimeline(events());
    expect(items.map(({ kind }) => kind)).toEqual(['message', 'message', 'version', 'message']);
    // Both presentations were built from one source, so they are two variants of its card.
    expect(items[2]).toMatchObject({ kind: 'version', sourceHash: 'a'.repeat(64) });
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
});

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
