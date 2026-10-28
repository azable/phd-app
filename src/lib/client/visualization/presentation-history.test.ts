import { describe, expect, it } from 'vitest';

import type { ProjectEvent, ProjectEventOf } from '$lib/shared/projects/events';

import {
  availablePresentations,
  candidateId,
  latestPresentations,
  presentationDisplayId,
  timelinePresentations
} from './presentation-history';
import { PresentationSelection } from './presentation-selection.svelte';

const operationId = '12345678-1234-4123-8123-123456789abc';
const setOne = '12345678-1234-4123-8123-123456789abd';
const setTwo = '12345678-1234-4123-8123-123456789abe';
const presentationIds = [
  '12345678-1234-4123-8123-123456789ac1',
  '12345678-1234-4123-8123-123456789ac2',
  '12345678-1234-4123-8123-123456789ac3',
  '12345678-1234-4123-8123-123456789ac4'
];

describe('presentation history', () => {
  it('derives stable readable labels from retained presentation IDs', () => {
    const label = presentationDisplayId(presentationIds[0]);

    expect(label).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-\d{2}$/);
    expect(presentationDisplayId(presentationIds[0])).toBe(label);
    expect(presentationDisplayId(presentationIds[1])).not.toBe(label);
  });

  it('projects the latest generated comparison from retained events', () => {
    const events = comparisonEvents();

    expect(
      latestPresentations(timelinePresentations(events), 'comparison').map(
        ({ presentation }) => presentation.presentationId
      )
    ).toEqual(presentationIds.slice(2));
  });

  it('builds a custom compatible pair and rejects a third selection', () => {
    const events = comparisonEvents();
    const entries = timelinePresentations(events);
    const selection = new PresentationSelection(true);

    expect(
      selection
        .selected(events, 'comparison')
        .map(({ presentation }) => presentation.presentationId)
    ).toEqual(presentationIds.slice(0, 2));

    selection.activate(entries[2], events, 'comparison');
    expect(selection.selectedIds).toEqual([presentationIds[2]]);
    expect(selection.followingLatest).toBe(false);

    selection.activate(entries[0], events, 'comparison', true);
    expect(selection.selectedIds).toEqual([presentationIds[2], presentationIds[0]]);

    selection.activate(entries[3], events, 'comparison', true);
    expect(selection.selectedIds).toEqual([presentationIds[2], presentationIds[0]]);
    expect(selection.notice).toContain('Deselect one');

    selection.activate(entries[0], events, 'comparison', true);
    expect(selection.selectedIds).toEqual([presentationIds[2]]);
  });

  it('implies the layout from how many variants are selected', () => {
    const events = comparisonEvents();
    const entries = timelinePresentations(events);
    let layout: 'single' | 'comparison' = 'single';
    const selection = new PresentationSelection(false, (next) => {
      layout = next;
      return true;
    });

    selection.activate(entries[2], events, layout);
    selection.activate(entries[3], events, layout, true);
    expect(layout).toBe('comparison');
    expect(selection.selectedIds).toEqual([presentationIds[2], presentationIds[3]]);
    expect(
      selection.selected(events, layout).map(({ presentation }) => presentation.presentationId)
    ).toEqual([presentationIds[2], presentationIds[3]]);
    expect(selection.notice).toBeNull();

    // Shift-deselecting back to one variant, or plainly selecting one, returns to single view.
    selection.activate(entries[3], events, layout, true);
    expect(layout).toBe('single');
    expect(selection.selectedIds).toEqual([presentationIds[2]]);
    selection.activate(entries[3], events, layout, true);
    expect(layout).toBe('comparison');
    selection.activate(entries[0], events, layout);
    expect(layout).toBe('single');
    expect(
      selection.selected(events, layout).map(({ presentation }) => presentation.presentationId)
    ).toEqual([presentationIds[0]]);
  });

  it('keeps a fixed single layout and rejects incompatible second variants', () => {
    const events = comparisonEvents();
    const entries = timelinePresentations(events);
    const fixed = new PresentationSelection(false, () => false);
    fixed.activate(entries[2], events, 'single');
    fixed.activate(entries[3], events, 'single', true);
    expect(fixed.selectedIds).toEqual([presentationIds[2]]);
    expect(fixed.notice).toContain('unavailable in single-view mode');

    let switched = false;
    const adjustable = new PresentationSelection(false, () => (switched = true));
    const incompatible = {
      ...entries[3],
      presentation: { ...entries[3].presentation, stepSignature: 'another-scenario' }
    } as (typeof entries)[number];
    adjustable.activate(entries[2], events, 'single');
    adjustable.activate(incompatible, events, 'single', true);
    expect(switched).toBe(false);
    expect(adjustable.notice).toContain('Only compatible versions');
  });

  it('advances the automatic comparison after a committed preference consumes a pair', () => {
    const events = comparisonEvents();
    events.push({
      id: 5,
      type: 'visualization.preference-recorded',
      actor: { kind: 'user' },
      operationId,
      createdAt: '2026-08-30T00:00:05.000Z',
      payload: {
        displaySetId: setOne,
        presentations: [presentationIds[0], presentationIds[1]],
        preferred: presentationIds[0],
        step: 0
      }
    });

    expect(
      new PresentationSelection(true)
        .selected(events, 'comparison')
        .map(({ presentation }) => presentation.presentationId)
    ).toEqual(presentationIds.slice(2));
  });

  it('selects a complete scenario pair instead of combining unrelated buffered views', () => {
    const events: ProjectEvent[] = [
      scenarioPresentationEvent(1, setOne, 0, presentationIds[0], 'b'.repeat(64)),
      scenarioPresentationEvent(2, setTwo, 0, presentationIds[1], 'c'.repeat(64)),
      scenarioPresentationEvent(3, setTwo, 1, presentationIds[2], 'c'.repeat(64))
    ];

    expect(
      availablePresentations(events, 'comparison').map(
        ({ presentation }) => presentation.presentationId
      )
    ).toEqual(presentationIds.slice(1, 3));
  });

  it('pins the evaluated pair while a preference operation is running', () => {
    const events = comparisonEvents();
    const entries = timelinePresentations(events);
    const selection = new PresentationSelection(true);

    selection.pin(entries.slice(0, 2));
    events.push({
      id: 5,
      type: 'visualization.preference-recorded',
      actor: { kind: 'user' },
      operationId,
      createdAt: '2026-08-30T00:00:05.000Z',
      payload: {
        displaySetId: setOne,
        presentations: [presentationIds[0], presentationIds[1]],
        preferred: presentationIds[0],
        step: 0
      }
    });

    expect(selection.followingLatest).toBe(false);
    expect(
      selection
        .selected(events, 'comparison')
        .map(({ presentation }) => presentation.presentationId)
    ).toEqual(presentationIds.slice(0, 2));
  });

  it('keeps non-buffered workspaces on the latest generated display set', () => {
    expect(
      new PresentationSelection()
        .selected(comparisonEvents(), 'comparison')
        .map(({ presentation }) => presentation.presentationId)
    ).toEqual(presentationIds.slice(2));
  });
});

function comparisonEvents(): ProjectEvent[] {
  return [
    presentationEvent(1, setOne, 0, presentationIds[0], 1),
    presentationEvent(2, setOne, 1, presentationIds[1], 2),
    presentationEvent(3, setTwo, 0, presentationIds[2], 3),
    presentationEvent(4, setTwo, 1, presentationIds[3], 4)
  ];
}

function presentationEvent(
  id: number,
  displaySetId: string,
  slot: 0 | 1,
  presentationId: string,
  seed: number
): ProjectEventOf<'visualization.presented'> {
  return {
    id,
    type: 'visualization.presented',
    actor: { kind: 'system' },
    operationId,
    createdAt: `2026-08-30T00:00:0${id}.000Z`,
    payload: {
      displaySetId,
      slot,
      presentation: {
        presentationId,
        format: 'browser-bundle-v1',
        mode: 'sverlin',
        stepSignature: 'shared-steps',
        labels: ['Only step'],
        seed,
        source: { text: 'source', sha256: 'a'.repeat(64), mediaType: 'text/x-svelte' },
        html: { text: '', sha256: '0'.repeat(64), mediaType: 'text/html' },
        javascript: {
          text: 'void 0;',
          sha256: String(seed).repeat(64).slice(0, 64),
          mediaType: 'text/javascript'
        }
      }
    }
  };
}

function scenarioPresentationEvent(
  id: number,
  displaySetId: string,
  slot: 0 | 1,
  presentationId: string,
  scenarioKey: string
): ProjectEventOf<'visualization.presented'> {
  return {
    id,
    type: 'visualization.presented',
    actor: { kind: 'system' },
    operationId,
    createdAt: `2026-08-30T00:00:0${id}.000Z`,
    payload: {
      displaySetId,
      slot,
      presentation: {
        presentationId,
        format: 'browser-bundle-v1',
        mode: 'sverlin',
        stepSignature: 'shared-steps',
        labels: ['Only step'],
        seed: id,
        source: { text: 'source', sha256: scenarioKey, mediaType: 'text/x-svelte' },
        html: { text: '', sha256: '0'.repeat(64), mediaType: 'text/html' },
        javascript: {
          text: 'void 0;',
          sha256: String(id).repeat(64).slice(0, 64),
          mediaType: 'text/javascript'
        }
      }
    }
  };
}

describe('candidate identifiers', () => {
  const candidate = (
    seed: number,
    parameters: Record<string, unknown>,
    source = 'source',
    sha256 = 'a'.repeat(64)
  ) => {
    const { presentation } = presentationEvent(1, setOne, 0, presentationIds[0], seed).payload;
    if (presentation.format !== 'browser-bundle-v1') throw new Error('Expected a Sverlin bundle.');
    return candidateId({
      ...presentation,
      parameters,
      source: { ...presentation.source, text: source, sha256 }
    });
  };

  it('names the source by its hash and the values its random variables took, not the seed', () => {
    const drawn = { Int: 'IntCard', __defaults: { gap: 'small', font: 'serif' } };
    const first = candidate(1, drawn);
    expect(first.source).toBe('aaaaaa');
    expect(candidate(2, { __defaults: { font: 'serif', gap: 'small' }, Int: 'IntCard' })).toEqual(
      first
    );
    expect(candidate(1, { ...drawn, Int: 'IntCell' }).values).not.toBe(first.values);
    expect(candidate(1, drawn, 'source', 'b'.repeat(64)).source).toBe('bbbbbb');
  });

  it('names candidates by their values alone, whatever their seeds, a free layout included', () => {
    const free = '<Node layout="free"><Node key="a" /></Node>';
    expect(candidate(1, {}, free).values).toBe(candidate(2, {}, free).values);
  });
});
