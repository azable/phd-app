import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from '$lib/shared/projects/events';

import { choiceFamily, preferenceSummary } from './preference-summary';
import type { AiDesign } from './project-context';

const design: AiDesign = {
  options: { fill: ['none', 'white', 'amber-200', 'sky-200'], font: ['sans', 'serif'] },
  variables: [
    { variable: 'views.Int', options: ['IntCell', 'IntTally', 'none'], value: 'IntCell' },
    { variable: 'Note.shown', options: [true, false], value: true },
    { variable: 'Graph.form', options: ['natural', 'line', 'snake'], value: 'natural' },
    { variable: 'Graph.layoutSeed', options: [1, 2, 3], value: 1 },
    { variable: 'Cell.fill', options: 'fill', value: 'white' },
    { variable: 'Mark.fill', options: 'fill', value: 'white' },
    { variable: 'Cell.font', options: 'font', value: 'sans' }
  ]
};

/** A pair of the two variants presented and answered, its events numbered from `first`. */
function duel(
  left: Record<string, string | number>,
  right: Record<string, string | number>,
  preferred: 0 | 1,
  first = 1
): ProjectEvent[] {
  const presented = (variant: Record<string, string | number>, slot: number) => ({
    id: first + slot,
    type: 'visualization.presented',
    payload: {
      presentation: {
        format: 'browser-bundle-v1',
        presentationId: `p${first + slot}`,
        variant
      }
    }
  });
  return [
    presented(left, 0),
    presented(right, 1),
    {
      id: first + 2,
      type: 'visualization.preference-recorded',
      payload: {
        presentations: [`p${first}`, `p${first + 1}`],
        preferred: `p${first + preferred}`
      }
    }
  ] as unknown as ProjectEvent[];
}

function answered(left: string, right: string, preferred: 0 | 1): ProjectEvent[] {
  return duel({ 'views.Int': left }, { 'views.Int': right }, preferred);
}

describe('the preference summary', () => {
  it('weighs views, what is shown and forms before fonts and colours', () => {
    expect(choiceFamily('views.Int').impact).toBeGreaterThan(choiceFamily('Graph.form').impact);
    expect(choiceFamily('Graph.form').impact).toBeGreaterThan(choiceFamily('Cell.font').impact);
    expect(choiceFamily('Cell.font').impact).toBeGreaterThan(choiceFamily('Cell.fill').impact);
    expect(choiceFamily('pointers.Index@j').family).toBe('views');
  });

  it('says where each touched choice stands, what to ask next, and what was never compared', () => {
    const summary = preferenceSummary(answered('IntCell', 'IntTally', 1), design)!;
    expect(summary).toMatchObject({
      answered: 1,
      later: 0,
      choices: [
        {
          variable: 'views.Int',
          likeliest: 'IntTally',
          state: 'open',
          answers: 1,
          compared: 2,
          unexplored: 1
        }
      ]
    });
    // Forms, what is shown and views before fonts and colours, colours as one question, by how
    // much each changes the picture and how unsure the model is; the seed is never asked.
    expect(summary.askNext.map(({ variables }) => variables)).toEqual([
      ['Graph.form'],
      ['Note.shown'],
      ['views.Int'],
      ['Cell.font'],
      ['Cell.fill', 'Mark.fill']
    ]);
    expect(summary.unexplored).toEqual([
      { family: 'shown', count: 1, examples: ['Note.shown'] },
      { family: 'arrangement', count: 1, examples: ['Graph.form'] },
      { family: 'lettering', count: 1, examples: ['Cell.font'] },
      { family: 'colour', count: 2, examples: ['Cell.fill', 'Mark.fill'] }
    ]);
  });

  it('stays small for a large design', () => {
    const large: AiDesign = {
      options: design.options,
      variables: Array.from({ length: 200 }, (_, index) => ({
        variable: `Kind${index}.fill`,
        options: 'fill',
        value: 'white'
      }))
    };
    const summary = preferenceSummary([], large)!;
    expect(summary.askNext).toHaveLength(1);
    expect(summary.askNext[0].variables).toHaveLength(4);
    expect(summary.unexplored).toEqual([
      {
        family: 'colour',
        count: 200,
        examples: ['Kind0.fill', 'Kind1.fill', 'Kind2.fill', 'Kind3.fill']
      }
    ]);
    expect(JSON.stringify(summary).length).toBeLessThan(500);
  });

  it('shows a free layout never compared first, a first automatic layout being a guess', () => {
    expect(preferenceSummary([], design)!.showFirst).toEqual({
      variables: ['Graph.form', 'Graph.layoutSeed'],
      family: 'arrangement',
      layout: true
    });
    // Once its arrangement was compared, even by its seed alone, the choice of views comes next.
    const seeds = duel({ 'Graph.layoutSeed': 1 }, { 'Graph.layoutSeed': 2 }, 0);
    expect(preferenceSummary(seeds, design)!.showFirst).toEqual({
      variables: ['views.Int'],
      family: 'views'
    });
    // Once that was compared too, nothing is left to show first: fonts and colours never are.
    const both = [...seeds, ...duel({ 'views.Int': 'IntCell' }, { 'views.Int': 'IntTally' }, 1, 4)];
    expect(preferenceSummary(both, design)!.showFirst).toBeUndefined();
  });

  it('has nothing to say of a design without choices', () => {
    expect(preferenceSummary([], { options: {}, variables: [] })).toBeUndefined();
  });
});
