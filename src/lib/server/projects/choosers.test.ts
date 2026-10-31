import { describe, expect, it } from 'vitest';

import type { ProjectDocument } from '$lib/shared/projects/model';

import {
  chooseVariants,
  chosenRequests,
  differences,
  randomChooser,
  type ChooserRequest,
  type VariantChooser
} from './choosers';

const document = { schemaVersion: 1, projectId: 'p', events: [] } as unknown as ProjectDocument;
const request = (purpose: ChooserRequest['purpose']): ChooserRequest => ({
  document,
  purpose,
  source: 'source',
  count: 2,
  design: {
    variant: { 'Cell.fill': 'white', 'Mark.fill': 'amber-100' },
    origins: { 'Cell.fill': 'kept', 'Mark.fill': 'starter' }
  },
  seen: [],
  operationId: 'o',
  attempt: 1
});
const design = {
  options: { fill: ['white', 'amber-100', 'blue-100'] },
  variables: [
    { variable: 'Cell.fill', options: 'fill', value: 'white' },
    { variable: 'Mark.fill', options: 'fill', value: 'amber-100' }
  ]
};

describe('randomChooser', () => {
  it('draws every variable afresh for more variants of a source', async () => {
    const { choices } = await randomChooser.choose(request('resample'));
    expect(choices).toEqual([
      { chosen: {}, randomise: true },
      { chosen: {}, randomise: true }
    ]);
  });

  it('draws only what is new to a new source', async () => {
    const { choices } = await randomChooser.choose(request('new-source'));
    expect(choices?.[0]).toEqual({ chosen: {}, randomise: ['Mark.fill'] });
  });
});

describe('chooseVariants', () => {
  it('uses the chooser’s choices', async () => {
    const chooser: VariantChooser = {
      id: 'model',
      choose: async ({ document }) => ({
        document,
        choices: [{ chosen: { 'Cell.fill': 'blue-100' } }]
      })
    };
    const chosen = await chooseVariants(chooser, request('resample'));
    expect(chosen.chooser).toBe('model');
    expect(chosen.choices).toEqual([{ chosen: { 'Cell.fill': 'blue-100' } }]);
  });

  it('falls back to the random draw when the chooser returns none', async () => {
    const failing: VariantChooser = { id: 'model', choose: async ({ document }) => ({ document }) };
    const chosen = await chooseVariants(failing, request('resample'));
    expect(chosen.chooser).toBe('random');
    expect(chosen.choices).toHaveLength(2);
  });
});

describe('chosenRequests', () => {
  it('keeps offered values, draws a variant no choice covers, and keeps the base', () => {
    const base = { 'Cell.fill': 'white', 'Mark.fill': 'amber-100' };
    const requests = chosenRequests([1, 2], design, base, [
      { chosen: { 'Cell.fill': 'blue-100', 'Mark.fill': 'not-a-colour', Missing: 1 } }
    ]);
    expect(requests).toEqual([
      { seed: 1, variant: { base, chosen: { 'Cell.fill': 'blue-100' } } },
      { seed: 2, variant: { base, chosen: {}, randomise: true } }
    ]);
  });

  it('keeps only offered variables to draw afresh', () => {
    const [request] = chosenRequests([1], design, undefined, [
      { chosen: {}, randomise: ['Mark.fill', 'Missing'] }
    ]);
    expect(request.variant).toEqual({ chosen: {}, randomise: ['Mark.fill'] });
  });
});

describe('differences', () => {
  it('gives each variant as what it changes, dropping those that change nothing', () => {
    const base = { a: 1, b: 'x' };
    expect(
      differences(
        [
          { a: 1, b: 'y' },
          { a: 1, b: 'x' }
        ],
        base
      )
    ).toEqual([{ b: 'y' }]);
  });
});
