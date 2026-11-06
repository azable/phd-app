import { describe, expect, it } from 'vitest';

import insertion from '../fixtures/insertion-decisions.sverlin?raw';
import { bundlePresentation, prepareSvelteComponent } from '../compile.server';
import { withStarterBase } from '../design.server';
import { candidateFacts, factsText, pausedLabels } from './candidate-facts.server';

describe('what the app measures of a candidate', () => {
  it('reads the labels the scenes pause at', () => {
    expect(pausedLabels('<Scene pause="@a, @b.c" /><Scene pause="@a, :after" />')).toEqual([
      '@a',
      '@b.c'
    ]);
  });

  it('measures a build, checks the constraints it can, and says which it cannot', async () => {
    const built = await bundlePresentation(
      prepareSvelteComponent(insertion),
      1,
      withStarterBase({})
    );
    const result = candidateFacts(built, insertion, [
      'every label runs',
      `at most ${built.labels.length} steps`,
      'a cycle in the graph'
    ]);
    if (!('facts' in result)) throw new Error(result.dropped);
    const { facts } = result;
    expect(facts.steps).toBe(built.labels.length);
    expect(facts.labelsNotRun).toEqual([]);
    expect(facts.constraints).toEqual({
      met: ['every label runs', `at most ${built.labels.length} steps`],
      broken: [],
      unchecked: ['a cycle in the graph']
    });
    expect(facts.score).toBeGreaterThan(2);
    expect(factsText(facts)).toContain('not checked: a cycle in the graph');
    expect(candidateFacts(built, insertion, ['at most 1 steps'])).toEqual({
      dropped: 'breaks at most 1 steps'
    });
  });
});
