import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectSession } from '$lib/client/projects/project-session.svelte';
import type { ProjectEvent } from '$lib/shared/projects/events';
import { pendingAssistantTurnRequests, projectOperations } from '$lib/shared/projects/operations';

import PresentationStage from './PresentationStage.svelte';
import { timelinePresentations } from './presentation-history';
import { PresentationPlayback } from './presentation-playback.svelte';
import {
  arrivalHighlightMs,
  pickConfirmationMs,
  PresentationSelection
} from './presentation-selection.svelte';
import { VisualSelections } from './visual-selection.svelte';
import { VisualAnnotations } from './visual-annotations.svelte';

const operationId = '12345678-1234-4123-8123-123456789abc';
const displaySetId = '12345678-1234-4123-8123-123456789abd';
const turnId = '12345678-1234-4123-8123-123456789abe';
const secondSetId = '12345678-1234-4123-8123-123456789abf';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('presentation stage while the project is busy', () => {
  it('freezes answers but keeps stepping', () => {
    const body = stage(askedPair(), true);
    for (const label of [
      'Prefer the top version',
      'Prefer the bottom version',
      'Either is fine',
      'Unsure — no preference recorded'
    ])
      expect(disabled(body, label)).toBe(true);
    expect(disabled(body, 'Next visualization step')).toBe(false);
  });

  it('goes to the first or the last step from either end, each disabled where it already is', () => {
    const body = stage(askedPair(['Start', 'Middle', 'Result']), false);
    expect(body).toContain('Step 1 of 3');
    expect(disabled(body, 'First visualization step')).toBe(true);
    expect(disabled(body, 'Last visualization step')).toBe(false);
  });

  it('labels the running operation over the stage, dimming only what it replaces', () => {
    const thinking = stage([...askedPair(), accepted(3)], true);
    expect(thinking).toContain('Thinking…');
    expect(thinking).not.toContain('opacity-60');

    const applying = stage([...askedPair(), accepted(3), changedBuild(4)], true);
    expect(applying).toContain('Applying your change…');
    expect(applying).toContain('opacity-60');
  });
});

const badges = (body: string) =>
  [...body.matchAll(/<p class="rounded-md bg-primary[^"]*">\s*([^<]*?)\s*<\/p>/g)].map(
    ([, text]) => text
  );

describe('presentation stage after the last comparison is answered', () => {
  it('keeps the pair greyed, saying it is updating, with the chosen side marked', async () => {
    const selection = new PresentationSelection(true, undefined, true);
    await selection.answer(
      timelinePresentations(askedPair()),
      async () => true,
      askedPair().length
    );
    vi.advanceTimersByTime(pickConfirmationMs);
    const body = stage(
      [...askedPair(), answered(3, { preferred: ids[1] }), requested(4)],
      false,
      false,
      selection
    );
    expect(body.match(/data-replay-region="candidate-/g)).toHaveLength(2);
    expect(body).toContain('Updating…');
    expect(body).toContain('opacity-50 grayscale');
    expect(badges(body)).toEqual(['Your choice']);
    // Nothing to change while the reply comes, and no caption to shift the stage.
    expect(disabled(body, 'Prefer the top version')).toBe(true);
    expect(body).not.toContain('choose again to change your answer');
  });
});

describe('presentation stage between comparisons', () => {
  const both = () => [...askedPair(), ...secondPair()];

  it('first shows the pick on the pair answered, not dimmed', async () => {
    const selection = new PresentationSelection(true, undefined, true);
    await selection.answer(timelinePresentations(askedPair()), async () => true, 4);
    const body = stage([...both(), answered(5, { preferred: ids[0] })], false, false, selection);
    expect(body).toContain('Cells or tallies?');
    expect(badges(body)).toEqual(['Your choice']);
    expect(body).not.toContain('Updating…');
    expect(body).not.toContain('grayscale');
    expect(disabled(body, 'Prefer the bottom version')).toBe(true);
    expect(body).not.toContain('choose again to change your answer');
  });

  it('then shows the next, its question highlighted a while and counted', async () => {
    const selection = new PresentationSelection(true, undefined, true);
    await selection.answer(timelinePresentations(askedPair()), async () => true, 4);
    vi.advanceTimersByTime(pickConfirmationMs);
    const events = [...both(), answered(5, { preferred: ids[0] })];
    const body = stage(events, false, false, selection);
    expect(body).toContain('Rows or columns?');
    expect(body).toMatch(/Question\s+2\s+of\s+2/u);
    expect(body).toContain('bg-primary/15');
    expect(body).toContain('motion-reduce:transition-none');
    expect(badges(body)).toEqual([]);
    expect(disabled(body, 'Prefer the top version')).toBe(false);

    vi.advanceTimersByTime(arrivalHighlightMs);
    expect(stage(events, false, false, selection)).not.toContain('bg-primary/15');
  });

  it('counts the first of several, and none for a comparison asked alone', () => {
    expect(stage(both(), false)).toMatch(/Question\s+1\s+of\s+2/u);
    expect(stage(askedPair(), false)).not.toContain('Question 1');
  });
});

describe('presentation stage before a project’s first version', () => {
  it('covers the blank starter with a loader while the assistant works', () => {
    const body = stage([...blankProject(), requested(4)], false);
    expect(body).toContain('Making a first version…');
    expect(body).not.toContain('Thinking…');
    // The starter stays laid out beneath, out of reach.
    expect(body).toContain('data-replay-region="candidate-1"');
    expect(body).toMatch(/<div[^>]*\sinert[\s=>]/u);
  });

  it('shows the loader on the empty stage of a project that presents no starter', () => {
    const unpresented = blankProject().slice(0, 2);
    expect(stage([...unpresented, requested(3)], false)).toContain('Making a first version…');
    expect(stage(unpresented, false)).toContain('Your visualization will appear here.');
  });

  it('shows the starter itself while nothing is at work', () => {
    const body = stage(blankProject(), false);
    expect(body).not.toContain('Making a first version…');
    expect(body).not.toMatch(/<div[^>]*\sinert[\s=>]/u);
  });
});

describe('presentation stage during a later turn', () => {
  const shownVersion = () => blankProject().slice(2);

  it('dims the version shown a little, saying it is updating, until the turn ends', () => {
    for (const running of [[requested(4)], [accepted(4)]]) {
      const body = stage([...shownVersion(), ...running], false);
      expect(body).toContain('Updating…');
      expect(body).toContain('opacity-75');
      expect(body).not.toContain('Making a first version…');
    }
    const ended = stage([...shownVersion(), accepted(4), completed(5)], false);
    expect(ended).not.toContain('Updating…');
    expect(ended).not.toContain('opacity-75');
  });

  it('leaves a comparison up undimmed, saying what the turn does', () => {
    const body = stage([...askedPair(), accepted(3)], false);
    expect(body).toContain('Thinking…');
    expect(body).not.toContain('Updating…');
    expect(body).not.toContain('opacity-75');
  });

  it('holds the answers while another turn replies, saying why', () => {
    for (const running of [[requested(3)], [accepted(3)]]) {
      const body = stage([...askedPair(), ...running], false);
      expect(disabled(body, 'Prefer the top version')).toBe(true);
      expect(body).toContain('Answer once the assistant has replied.');
    }
    // The turn that asked the comparison may still be running.
    const asking = { ...accepted(3), operationId } as ProjectEvent;
    const body = stage([...askedPair(), asking], false);
    expect(disabled(body, 'Prefer the top version')).toBe(false);
    expect(body).not.toContain('Answer once the assistant has replied.');
  });
});

describe('presentation stage showing a comparison from the timeline', () => {
  it('shows an answered pair side by side with its question, marking the side chosen', () => {
    const body = stage([...askedPair(), answered(3, { preferred: ids[1] })], false, true);
    expect(body).toContain('Cells or tallies?');
    expect(body).toContain('choose again to change your answer');
    expect(body.match(/data-replay-region="candidate-/g)).toHaveLength(2);
    expect(badges(body)).toEqual(['Your choice']);
    expect(body.indexOf('Your choice')).toBeGreaterThan(body.indexOf('candidate-2'));
    // The controls stay, to change the answer.
    expect(disabled(body, 'Prefer the top version')).toBe(false);
  });

  it('marks both sides where either is fine, and says when the participant was unsure', () => {
    const tie = stage([...askedPair(), answered(3, { outcome: 'tie' })], false, true);
    expect(badges(tie)).toEqual(['Either is fine', 'Either is fine']);
    const unsure = stage([...askedPair(), answered(3, { outcome: 'skip' })], false, true);
    expect(badges(unsure)).toEqual([]);
    expect(unsure).toContain('You were unsure');
  });

  it('fills the button of the answer given, each answer one of a set of buttons', () => {
    const filled = (body: string) =>
      [...body.matchAll(/<button[^>]*aria-label="([^"]*)"[^>]*>/g)]
        .filter(([tag]) => tag.includes('bg-primary'))
        .map(([, label]) => label);
    const unsure = stage([...askedPair(), answered(3, { outcome: 'skip' })], false, true);
    expect(filled(unsure)).toEqual(['Unsure — no preference recorded']);
    const top = stage([...askedPair(), answered(3, { preferred: ids[0] })], false, true);
    expect(filled(top)).toEqual(['Prefer the top version']);
    expect(top).toMatch(/title="Prefer the top version"[^>]*>.*Top/su);
  });
  it('marks the latest answer where the pair was answered again', () => {
    const events = [
      ...askedPair(),
      answered(3, { preferred: ids[1] }),
      answered(4, { preferred: ids[0] })
    ];
    const body = stage(events, false, true);
    expect(badges(body)).toEqual(['Your choice']);
    expect(body.indexOf('Your choice')).toBeLessThan(body.indexOf('candidate-2'));
  });

  it('opens an unanswered pair that is no longer current, to answer', () => {
    const body = stage([...askedPair(), setAside(3)], false, true);
    expect(body.match(/data-replay-region="candidate-/g)).toHaveLength(2);
    expect(badges(body)).toEqual([]);
    expect(body).not.toContain('You answered this');
    expect(disabled(body, 'Prefer the bottom version')).toBe(false);
  });
});

describe('presentation stage showing where a pair differs', () => {
  const differing = () => askedPair(['Start', 'Check 1', 'Check 2', 'Found'], [1, 2]);

  it('opens a current comparison at its first difference, naming the steps that differ', () => {
    const body = stage(differing(), false);
    expect(body).toContain('Step 2 of 4');
    expect(body).toMatch(/Differs at steps\s+2–3/u);
    expect(disabled(body, 'Previous step that differs')).toBe(true);
    expect(disabled(body, 'Next step that differs')).toBe(false);
  });

  it('opens a comparison from the timeline at its first difference too', () => {
    const body = stage([...differing(), setAside(3)], false, true);
    expect(body).toContain('Step 2 of 4');
    expect(body).toMatch(/Differs at steps\s+2–3/u);
  });

  it('says nothing of differences where the server did not record them', () => {
    const body = stage(askedPair(), false);
    expect(body).toContain('Step 1 of 2');
    expect(body).not.toContain('Differs at');
  });
});

const ids = [1, 2].map((id) => `12345678-1234-4123-8123-123456789ac${id}`);

function answered(id: number, answer: object): ProjectEvent {
  return {
    id,
    type: 'visualization.preference-recorded',
    actor: { kind: 'user' },
    operationId: turnId,
    createdAt: `2026-11-01T00:00:0${id}.000Z`,
    payload: { displaySetId, presentations: [ids[0], ids[1]], step: 0, ...answer }
  } as ProjectEvent;
}

/** The pair set aside unanswered, as a moot comparison is, so it is no longer current. */
function setAside(id: number): ProjectEvent {
  return {
    id,
    type: 'visualization.candidates-advanced',
    actor: { kind: 'system' },
    operationId: turnId,
    createdAt: `2026-11-01T00:00:0${id}.000Z`,
    payload: { presentations: ids, reason: 'moot' }
  } as ProjectEvent;
}

/** The stage's markup; opened, with the pair chosen from the timeline rather than current. */
function stage(
  events: ProjectEvent[],
  busy: boolean,
  opened = false,
  selection = new PresentationSelection(true, undefined, true)
): string {
  if (opened)
    selection.showPair(
      timelinePresentations(events).filter((entry) => entry.displaySetId === displaySetId),
      events,
      'comparison'
    );
  const session = {
    events,
    // As the session derives it, which the timeline's indicator also shows.
    assistantResponding:
      pendingAssistantTurnRequests(events).length > 0 ||
      projectOperations(events).some(
        ({ kind, status }) =>
          kind === 'assistant-turn' && (status === 'accepted' || status === 'running')
      ),
    pending: null,
    refillPending: false,
    readOnly: false,
    reportRuntimeFailure() {},
    reportLoadTiming() {}
  } as unknown as ProjectSession;
  return render(PresentationStage, {
    props: {
      session,
      selection,
      playback: new PresentationPlayback(),
      layout: 'comparison',
      visualSelections: new VisualSelections(),
      visualAnnotations: new VisualAnnotations(),
      disabled: busy
    }
  }).body;
}

/** Whether the button with an accessible name is disabled. */
function disabled(body: string, label: string): boolean {
  const tag = body.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0];
  if (!tag) throw new Error(`No ${label} button.`);
  return /\sdisabled(=""|(?=[\s>]))/.test(tag);
}

function askedPair(labels = ['Start', 'Result'], differsAt?: number[]): ProjectEvent[] {
  return [1, 2].map((id) => ({
    id,
    type: 'visualization.presented',
    actor: { kind: 'system' },
    operationId,
    createdAt: `2026-11-01T00:00:0${id}.000Z`,
    payload: {
      displaySetId,
      slot: (id - 1) as 0 | 1,
      question: 'Cells or tallies?',
      ...(differsAt ? { differsAt } : {}),
      presentation: {
        presentationId: `12345678-1234-4123-8123-123456789ac${id}`,
        format: 'browser-bundle-v1',
        mode: 'sverlin',
        stepSignature: 'shared-steps',
        labels,
        steps: labels,
        seed: id,
        source: { text: 'source', sha256: 'a'.repeat(64), mediaType: 'text/x-svelte' },
        html: { text: '', sha256: '0'.repeat(64), mediaType: 'text/html' },
        javascript: { text: 'void 0;', sha256: String(id).repeat(64), mediaType: 'text/javascript' }
      }
    }
  }));
}

/** A blank project showing its starter, built from the source it was created with. */
function blankProject(): ProjectEvent[] {
  const [shown] = askedPair();
  if (shown.type !== 'visualization.presented') throw new Error('Expected a presentation.');
  return [
    {
      id: 1,
      type: 'project.created',
      actor: { kind: 'user' },
      operationId,
      createdAt: '2026-11-01T00:00:01.000Z',
      payload: {
        title: 'Test',
        entryArtifactId: 'main',
        assistantId: 'sverlin-assistant',
        creation: { templateId: 'blank' }
      }
    },
    {
      id: 2,
      type: 'artifact.version-created',
      actor: { kind: 'system' },
      operationId,
      createdAt: '2026-11-01T00:00:02.000Z',
      payload: {
        origin: { kind: 'initial' },
        changes: [
          {
            operation: 'upsert',
            artifact: {
              artifactId: 'main',
              path: 'View.svelte',
              language: 'svelte',
              content: { text: 'source', sha256: 'a'.repeat(64), mediaType: 'text/x-svelte' }
            }
          }
        ]
      }
    },
    {
      ...shown,
      id: 3,
      payload: { displaySetId, slot: 0, presentation: shown.payload.presentation }
    }
  ];
}

function requested(id: number): ProjectEvent {
  return {
    id,
    type: 'assistant.turn-requested',
    actor: { kind: 'system' },
    operationId: turnId,
    createdAt: `2026-11-01T00:00:0${id}.000Z`,
    payload: { interactionEventId: id - 1, presentationCount: 2 }
  };
}

/** A second comparison the same operation asked, after `askedPair`. */
function secondPair(): ProjectEvent[] {
  return askedPair().map((event) => {
    if (event.type !== 'visualization.presented') return event;
    const id = event.id + 2;
    return {
      ...event,
      id,
      payload: {
        ...event.payload,
        displaySetId: secondSetId,
        question: 'Rows or columns?',
        presentation: {
          ...event.payload.presentation,
          presentationId: `12345678-1234-4123-8123-123456789ac${id}`
        }
      }
    } as ProjectEvent;
  });
}

function accepted(id: number): ProjectEvent {
  return {
    id,
    type: 'operation.accepted',
    actor: { kind: 'system' },
    operationId: turnId,
    createdAt: `2026-11-01T00:00:0${id}.000Z`,
    payload: { kind: 'assistant-turn' }
  };
}

function completed(id: number): ProjectEvent {
  return {
    id,
    type: 'operation.completed',
    actor: { kind: 'system' },
    operationId: turnId,
    createdAt: `2026-11-01T00:00:0${id}.000Z`,
    payload: { kind: 'assistant-turn' }
  };
}

function changedBuild(id: number): ProjectEvent {
  return {
    id,
    type: 'build.requested',
    actor: { kind: 'system' },
    operationId: turnId,
    createdAt: `2026-11-01T00:00:0${id}.000Z`,
    payload: {
      purpose: 'assistant-edit',
      input: 'assistant-candidate',
      source: { text: 'changed', sha256: 'b'.repeat(64), mediaType: 'text/x-svelte' },
      sourceLabel: 'View.svelte',
      seed: 1
    }
  };
}
