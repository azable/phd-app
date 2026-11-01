import { describe, expect, it } from 'vitest';

import type { ProjectEvent, ProjectOperationKind } from '$lib/shared/projects/events';

import { stageActivity } from './stage-activity';

const operationId = '12345678-1234-4123-8123-123456789abc';
const shown = 'a'.repeat(64);
const changed = 'b'.repeat(64);

describe('stage activity', () => {
  it('says the assistant is thinking until it builds, and nothing once it replies alone', () => {
    expect(stageActivity(accepted('assistant-turn'), shown)).toEqual({
      label: 'Thinking…',
      replacing: false
    });
    expect(stageActivity([...accepted('assistant-turn'), completed(3)], shown)).toBeUndefined();
  });

  it('thinks while a message waits for an assistant turn to take it up', () => {
    const requested: ProjectEvent = {
      id: 1,
      type: 'assistant.turn-requested',
      actor: { kind: 'system' },
      operationId,
      createdAt: at(1),
      payload: { interactionEventId: 1, presentationCount: 2 }
    };
    expect(stageActivity([requested], shown)?.label).toBe('Thinking…');
  });

  it('applies a change that builds another source, dimming the shown version', () => {
    expect(stageActivity([...accepted('assistant-turn'), build(3, changed)], shown)).toEqual({
      label: 'Applying your change…',
      replacing: true
    });
  });

  it('builds comparisons of the shown source with their count, not dimming it', () => {
    expect(stageActivity([...accepted('assistant-turn'), build(3, shown, 2)], shown)).toEqual({
      label: 'Building 2 versions…',
      replacing: false
    });
    expect(stageActivity([...accepted('resample'), build(3, shown)], shown)?.label).toBe(
      'Building…'
    );
  });

  it('shows nothing once the operation presents, while the rest of its batch builds', () => {
    const presented = {
      id: 4,
      type: 'visualization.presented',
      actor: { kind: 'system' },
      operationId,
      createdAt: at(4),
      payload: {}
    } as unknown as ProjectEvent;
    expect(
      stageActivity([...accepted('assistant-turn'), build(3, shown, 2), presented], shown)
    ).toBeUndefined();
  });

  it('applies saved and restored sources, and says nothing for answers or refills', () => {
    expect(stageActivity(accepted('save'), shown)).toEqual({
      label: 'Applying your change…',
      replacing: true
    });
    expect(stageActivity(accepted('restore'), shown)?.replacing).toBe(true);
    expect(stageActivity(accepted('prefer'), shown)).toBeUndefined();
    expect(stageActivity(accepted('presentation-refill'), shown)).toBeUndefined();
  });

  it('names a command sent but not yet accepted', () => {
    expect(stageActivity([], shown, { type: 'save', operationId })?.label).toBe(
      'Applying your change…'
    );
  });
});

function at(id: number): string {
  return `2026-11-01T00:00:0${id}.000Z`;
}

function accepted(kind: ProjectOperationKind): ProjectEvent[] {
  return [
    {
      id: 1,
      type: 'operation.accepted',
      actor: { kind: 'user' },
      operationId,
      createdAt: at(1),
      payload: { kind }
    }
  ];
}

function completed(id: number): ProjectEvent {
  return {
    id,
    type: 'operation.completed',
    actor: { kind: 'system' },
    operationId,
    createdAt: at(id),
    payload: { kind: 'assistant-turn' }
  };
}

function build(id: number, sha256: string, batchSize?: number): ProjectEvent {
  return {
    id,
    type: 'build.requested',
    actor: { kind: 'system' },
    operationId,
    createdAt: at(id),
    payload: {
      purpose: 'assistant-edit',
      input: 'assistant-candidate',
      source: { text: 'source', sha256, mediaType: 'text/x-svelte' },
      sourceLabel: 'View.svelte',
      seed: 1,
      ...(batchSize ? { batchSize } : {})
    }
  };
}
