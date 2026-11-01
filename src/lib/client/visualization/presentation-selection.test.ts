import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from '$lib/shared/projects/events';

import { timelinePresentations } from './presentation-history';
import { PresentationSelection } from './presentation-selection.svelte';

const operations = { asked: uuid('a01'), answer: uuid('a02'), turn: uuid('a03') };

describe('answering the last of the assistant’s comparisons', () => {
  it('keeps the pair while the answer is saved and the assistant replies', async () => {
    const asked = [version(1), ...pair(2, 'p1')];
    const selection = questions();
    const saving = deferred();
    const answered = selection.answer(pairOf(asked, 'p1'), () => saving.promise, 3);
    expect(shown(selection, asked)).toEqual(['p1-0', 'p1-1']);
    expect(selection.awaiting(asked, 'comparison')).toBe('updating');

    const replying = [...asked, preference(4, 'p1'), requested(5)];
    saving.resolve(true);
    expect(await answered).toBe(true);
    expect(shown(selection, replying)).toEqual(['p1-0', 'p1-1']);
    const running = [...replying, accepted(6), started(7, 5)];
    expect(selection.awaiting(running, 'comparison')).toBe('updating');
  });

  it('moves to the version the reply shows', async () => {
    const asked = [version(1), ...pair(2, 'p1')];
    const selection = questions();
    await selection.answer(pairOf(asked, 'p1'), async () => true, 3);
    const replied = [...asked, preference(4, 'p1'), requested(5), accepted(6), started(7, 5)];
    const revised = [...replied, version(8, 'v2', operations.turn)];
    expect(shown(selection, revised)).toEqual(['v2']);
    expect(selection.awaiting(revised, 'comparison')).toBeUndefined();
  });

  it('moves to the version chosen when the reply only talks', async () => {
    const asked = [version(1), ...pair(2, 'p1')];
    const selection = questions();
    await selection.answer(pairOf(asked, 'p1'), async () => true, 3);
    const replied = [
      ...asked,
      preference(4, 'p1'),
      requested(5),
      accepted(6),
      started(7, 5),
      completed(8)
    ];
    expect(shown(selection, replied)).toEqual(['v1']);
    expect(selection.awaiting(replied, 'comparison')).toBeUndefined();
  });

  it('shows the pair again, not held, when the answer cannot be saved', async () => {
    const asked = [version(1), ...pair(2, 'p1')];
    const selection = questions();
    expect(await selection.answer(pairOf(asked, 'p1'), async () => false, 3)).toBe(false);
    expect(shown(selection, asked)).toEqual(['p1-0', 'p1-1']);
    expect(selection.awaiting(asked, 'comparison')).toBeUndefined();
  });
});

function questions(): PresentationSelection {
  return new PresentationSelection(true, undefined, true);
}

function shown(selection: PresentationSelection, events: ProjectEvent[]): string[] {
  return selection
    .selected(events, 'comparison')
    .map(({ presentation }) => presentation.presentationId);
}

function pairOf(events: ProjectEvent[], name: string) {
  return timelinePresentations(events).filter(({ displaySetId }) => displaySetId === uuid(name));
}

function deferred() {
  let resolve!: (saved: boolean) => void;
  const promise = new Promise<boolean>((done) => (resolve = done));
  return { promise, resolve };
}

/** A UUID whose last digits name it, so presentations read by name in expectations. */
function uuid(name: string): string {
  return `12345678-1234-4123-8123-${name.padStart(12, '0')}`;
}

function envelope(id: number, operationId: string) {
  return { id, operationId, createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, id)).toISOString() };
}

function presentation(presentationId: string, seed: number, source = 'a') {
  return {
    presentationId,
    format: 'browser-bundle-v1',
    mode: 'sverlin',
    stepSignature: 'shared-steps',
    labels: ['Start', 'Result'],
    seed,
    source: { text: source, sha256: source.repeat(64), mediaType: 'text/x-svelte' },
    html: { text: '', sha256: '0'.repeat(64), mediaType: 'text/html' },
    javascript: { text: 'void 0;', sha256: String(seed).repeat(64), mediaType: 'text/javascript' }
  };
}

/** One version of its own source, named by its presentation id, as a reply's change shows it. */
function version(id: number, name = 'v1', operationId = operations.asked): ProjectEvent {
  return {
    ...envelope(id, operationId),
    type: 'visualization.presented',
    actor: { kind: 'system' },
    payload: {
      displaySetId: uuid(`d${id}`),
      slot: 0,
      presentation: presentation(name, id, name === 'v1' ? 'b' : 'c')
    }
  } as ProjectEvent;
}

/** One of the assistant's comparisons, its sides named `<name>-0` and `<name>-1`. */
function pair(id: number, name: string): ProjectEvent[] {
  return [0, 1].map(
    (slot) =>
      ({
        ...envelope(id + slot, operations.asked),
        type: 'visualization.presented',
        actor: { kind: 'system' },
        payload: {
          displaySetId: uuid(name),
          slot,
          question: `Question ${name}?`,
          presentation: presentation(`${name}-${slot}`, id + slot)
        }
      }) as ProjectEvent
  );
}

function preference(id: number, name: string): ProjectEvent {
  return {
    ...envelope(id, operations.answer),
    type: 'visualization.preference-recorded',
    actor: { kind: 'user' },
    payload: {
      displaySetId: uuid(name),
      presentations: [`${name}-0`, `${name}-1`],
      step: 0,
      preferred: `${name}-1`
    }
  } as ProjectEvent;
}

function requested(id: number): ProjectEvent {
  return {
    ...envelope(id, operations.answer),
    type: 'assistant.turn-requested',
    actor: { kind: 'system' },
    payload: { interactionEventId: id - 1, presentationCount: 2 }
  };
}

function accepted(id: number): ProjectEvent {
  return {
    ...envelope(id, operations.turn),
    type: 'operation.accepted',
    actor: { kind: 'system' },
    payload: { kind: 'assistant-turn' }
  };
}

function started(id: number, request: number): ProjectEvent {
  return {
    ...envelope(id, operations.turn),
    type: 'assistant.turn-started',
    actor: { kind: 'system' },
    payload: { requestEventIds: [request], interactionEventIds: [request - 1] }
  };
}

function completed(id: number): ProjectEvent {
  return {
    ...envelope(id, operations.turn),
    type: 'operation.completed',
    actor: { kind: 'system' },
    payload: { kind: 'assistant-turn' }
  };
}
