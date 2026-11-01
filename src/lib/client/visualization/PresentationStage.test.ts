import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import type { ProjectSession } from '$lib/client/projects/project-session.svelte';
import type { ProjectEvent } from '$lib/shared/projects/events';

import PresentationStage from './PresentationStage.svelte';
import { timelinePresentations } from './presentation-history';
import { PresentationPlayback } from './presentation-playback.svelte';
import { PresentationSelection } from './presentation-selection.svelte';
import { VisualSelections } from './visual-selection.svelte';

const operationId = '12345678-1234-4123-8123-123456789abc';
const displaySetId = '12345678-1234-4123-8123-123456789abd';
const turnId = '12345678-1234-4123-8123-123456789abe';

describe('presentation stage while the project is busy', () => {
  it('freezes answers but keeps stepping', () => {
    const body = stage(askedPair(), true);
    for (const label of [
      'Prefer top candidate',
      'Prefer bottom candidate',
      'Either is fine',
      'Decide later'
    ])
      expect(disabled(body, label)).toBe(true);
    expect(disabled(body, 'Next visualization step')).toBe(false);
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

describe('presentation stage showing a comparison from the timeline', () => {
  const badges = (body: string) =>
    [...body.matchAll(/<p class="rounded-md bg-primary[^"]*">\s*([^<]*?)\s*<\/p>/g)].map(
      ([, text]) => text
    );

  it('shows an answered pair side by side with its question, marking the side chosen', () => {
    const body = stage([...askedPair(), answered(3, { preferred: ids[1] })], false, true);
    expect(body).toContain('Cells or tallies?');
    expect(body).toContain('choose again to change your answer');
    expect(body.match(/data-replay-region="candidate-/g)).toHaveLength(2);
    expect(badges(body)).toEqual(['Your choice']);
    expect(body.indexOf('Your choice')).toBeGreaterThan(body.indexOf('candidate-2'));
    // The controls stay, to change the answer.
    expect(disabled(body, 'Prefer top candidate')).toBe(false);
  });

  it('marks both sides where either is fine, and says a pair was left for later', () => {
    const tie = stage([...askedPair(), answered(3, { outcome: 'tie' })], false, true);
    expect(badges(tie)).toEqual(['Either is fine', 'Either is fine']);
    const later = stage([...askedPair(), answered(3, { outcome: 'skip' })], false, true);
    expect(badges(later)).toEqual([]);
    expect(later).toContain('You left this for later');
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
    expect(disabled(body, 'Prefer bottom candidate')).toBe(false);
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
function stage(events: ProjectEvent[], busy: boolean, opened = false): string {
  const selection = new PresentationSelection(true, undefined, true);
  if (opened)
    selection.showPair(
      timelinePresentations(events).filter((entry) => entry.displaySetId === displaySetId),
      events,
      'comparison'
    );
  const session = {
    events,
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

function askedPair(): ProjectEvent[] {
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
      presentation: {
        presentationId: `12345678-1234-4123-8123-123456789ac${id}`,
        format: 'browser-bundle-v1',
        mode: 'sverlin',
        stepSignature: 'shared-steps',
        labels: ['Start', 'Result'],
        seed: id,
        source: { text: 'source', sha256: 'a'.repeat(64), mediaType: 'text/x-svelte' },
        html: { text: '', sha256: '0'.repeat(64), mediaType: 'text/html' },
        javascript: { text: 'void 0;', sha256: String(id).repeat(64), mediaType: 'text/javascript' }
      }
    }
  }));
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
