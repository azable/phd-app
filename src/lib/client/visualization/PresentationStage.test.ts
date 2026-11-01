import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import type { ProjectSession } from '$lib/client/projects/project-session.svelte';
import type { ProjectEvent } from '$lib/shared/projects/events';

import PresentationStage from './PresentationStage.svelte';
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

function stage(events: ProjectEvent[], busy: boolean): string {
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
      selection: new PresentationSelection(true, undefined, true),
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
