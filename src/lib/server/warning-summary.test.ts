import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from '$lib/shared/projects/events';
import { warningSummary } from './warning-summary';

const presented = (id: number, operationId: string, sha: string, warnings: unknown[]) => ({
  id,
  operationId,
  type: 'visualization.presented',
  payload: { presentation: { format: 'browser-bundle-v1', source: { sha256: sha }, warnings } }
});

/** A turn sent back for two warnings, repaired, then the repair shown again by a later turn. */
const events = [
  {
    id: 1,
    operationId: 'a',
    type: 'ai.generation-requested',
    payload: {
      purpose: 'initial',
      attempt: 1,
      parameters: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' }
    }
  },
  {
    id: 2,
    operationId: 'a',
    type: 'build.requested',
    payload: { purpose: 'assistant-edit', attempt: 1, source: { sha256: 's1' } }
  },
  {
    id: 3,
    operationId: 'a',
    type: 'revision.edits-rejected',
    payload: {
      attempt: 1,
      rejected: 'warnings',
      problems: ['clumped', 'plain'],
      codes: ['label.clumped', 'listing.plain-variable']
    }
  },
  {
    id: 4,
    operationId: 'a',
    type: 'ai.generation-requested',
    payload: { purpose: 'repair', attempt: 2, parameters: { model: 'gpt-6.1-terra' } }
  },
  {
    id: 5,
    operationId: 'a',
    type: 'build.requested',
    payload: { purpose: 'assistant-edit', attempt: 2, source: { sha256: 's2' } }
  },
  presented(6, 'a', 's2', [{ code: 'listing.plain-variable', message: 'plain' }]),
  // A helper's call writes no version of its own.
  {
    id: 7,
    operationId: 'b',
    type: 'ai.generation-requested',
    payload: { purpose: 'helper', attempt: 1, parameters: { model: 'gpt-5.6-luna' } }
  },
  // The same source shown again, and its warnings told again in a later turn's context: not again.
  presented(8, 'b', 's2', [{ code: 'listing.plain-variable', message: 'plain' }]),
  // A presentation stored before codes.
  presented(9, 'c', 's3', ['An old warning.']),
  // A helper's fill picked into the source: the helpers' model wrote it.
  {
    id: 10,
    operationId: 'd',
    type: 'build.requested',
    payload: { purpose: 'picks', source: { sha256: 's4' } }
  },
  presented(11, 'd', 's4', [{ code: 'label.clumped', message: 'clumped' }])
] as unknown as ProjectEvent[];

describe('warning summary', () => {
  it('counts each version once, attributes it, and counts the fixes after a soft return', () => {
    const summary = warningSummary([{ id: 'p', events }]);
    expect(summary.versions).toBe(4);
    expect(summary.codes['listing.plain-variable']).toEqual({
      occurrences: 2,
      projects: 1,
      byModel: { 'gpt-6.1-sol': 1, 'gpt-6.1-terra': 1 },
      byPurpose: { initial: 1, repair: 1 },
      sentBack: 1,
      fixedNext: 0
    });
    expect(summary.codes['label.clumped']).toMatchObject({
      occurrences: 2,
      sentBack: 1,
      fixedNext: 1,
      byPurpose: { initial: 1, 'helper-pick': 1 },
      byModel: { 'gpt-6.1-sol': 1, 'gpt-5.6-luna': 1 }
    });
    expect(summary.occurrences.find(({ eventId }) => eventId === 3)).toMatchObject({
      reasoningEffort: 'medium',
      attempt: 1,
      generationRequestEventId: 1
    });
    expect(summary.codes.uncoded).toMatchObject({ occurrences: 1, byPurpose: { unknown: 1 } });
    expect(summary.occurrences.find(({ eventId }) => eventId === 6)).toMatchObject({
      generationRequestEventId: 4,
      purpose: 'repair'
    });
  });
});
