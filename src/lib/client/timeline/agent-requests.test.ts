import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from '$lib/shared/projects/events';

import { agentOutcome, agentRequestAt, agentRequests } from './agent-requests';

const operationId = '12345678-1234-4123-8123-123456789abc';
const text = (value: unknown) => ({
  text: typeof value === 'string' ? value : JSON.stringify(value),
  sha256: 'a'.repeat(64),
  mediaType: 'application/json'
});
const envelope = (operationId: string) => ({
  operationId,
  actor: { kind: 'system' as const },
  createdAt: '2026-10-21T00:00:00.000Z'
});
const requested = (id: number, attempt: number): ProjectEvent => ({
  id,
  type: 'ai.generation-requested',
  ...envelope(operationId),
  payload: {
    attempt,
    purpose: attempt === 1 ? 'initial' : 'repair',
    prompt: text({ initialPrompt: 'Instructions', messages: [], context: {} }),
    promptTemplateSha256: 'a'.repeat(64),
    requestedModel: 'test-model',
    parameters: {}
  }
});
const succeeded = (id: number, attempt: number, decision: unknown): ProjectEvent => ({
  id,
  type: 'ai.generation-succeeded',
  ...envelope(operationId),
  payload: {
    attempt,
    adapterId: 'test-adapter',
    requestedModel: 'test-model',
    durationMs: 1000,
    usage: { inputTokens: 100, outputTokens: 10 },
    response: text({ output_text: JSON.stringify({ reply: [], decision }) })
  }
});
const happened = (id: number, type: 'build.succeeded' | 'operation.completed'): ProjectEvent =>
  ({ id, type, ...envelope(operationId), payload: {} }) as unknown as ProjectEvent;

describe('agent requests', () => {
  const edit = { action: 'edit', edits: [{ find: 'a', replace: 'b' }], summary: 'Changes a' };
  const events = [
    requested(1, 1),
    succeeded(2, 1, edit),
    requested(3, 2),
    succeeded(4, 2, { ...edit, edits: [edit.edits[0], edit.edits[0]] }),
    happened(5, 'build.succeeded'),
    happened(6, 'operation.completed')
  ];

  it('pairs each request with its outcome and what followed, until the next request', () => {
    const [first, second] = agentRequests(events);
    expect(first).toMatchObject({ request: { id: 1 }, outcome: { id: 2 }, followed: true });
    expect(first.actions).toEqual([]);
    expect(second.actions.map(({ id }) => id)).toEqual([5, 6]);
    expect(agentRequestAt(events, 3)?.outcome?.id).toBe(4);
  });

  it('says what the model decided, and infers edits that did not apply from a repair', () => {
    const [first, second] = agentRequests(events);
    expect(agentOutcome(first)).toBe('Edit · 1 edit → edits did not apply');
    expect(agentOutcome(second)).toBe('Edit · 2 edits');
  });
});
