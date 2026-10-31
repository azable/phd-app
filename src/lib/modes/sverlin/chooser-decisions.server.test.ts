import { describe, expect, it } from 'vitest';

import { optionProbabilities } from '$lib/server/chat-adapters/openai-decisions';

import { chooserQuestions, chosenVariants } from './chooser-decisions.server';

const asked = [
  { variable: 'listing.language', value: 'textbook', options: ['textbook', 'none'] },
  { variable: 'Cell.fill', value: 'white', options: ['white', 'blue-100', 'amber-100'] },
  { variable: 'Cell.radius', value: 4, options: [0, 4, 8] },
  { variable: 'Cell.shown', value: true, options: [true, false] }
];

const answers = {
  answers: [
    { type: 'choice', name: 'listing.language', choice: 'none', probabilities: [0.2, 0.8] },
    { type: 'choice', name: 'Cell.fill', choice: 'white', probabilities: [0.9, 0.06, 0.04] },
    { type: 'choice', name: 'Cell.radius', choice: '8', probabilities: [0.2, 0.3, 0.5] },
    { type: 'choice', name: 'Cell.shown', choice: true, probabilities: [0.99, 0.01] }
  ]
};

describe('chooserQuestions', () => {
  it('asks each variable with its options, numbers as strings and flags as booleans', () => {
    const [, , radius, shown] = chooserQuestions(asked);
    expect(radius.choices).toEqual([{ value: '0' }, { value: '4' }, { value: '8' }]);
    expect(shown.choices).toEqual([{ value: true }, { value: false }]);
  });
});

describe('chosenVariants', () => {
  it('keeps starting values unless another is clearly likelier, then changes the least sure', () => {
    const { variants } = chosenVariants(asked, 2, answers);
    // The listing's none is 0.6 likelier than its start; the radius's 8 only 0.2, so it stays 4.
    expect(variants[0].values).toEqual([{ variable: 'listing.language', value: 'none' }]);
    // The three least sure, the radius (0.3), the listing (0.8) and the fill (0.9), each to its next
    // likeliest; the listing so comes back to where it started.
    expect(variants[1].values).toEqual([
      { variable: 'Cell.fill', value: 'blue-100' },
      { variable: 'Cell.radius', value: 8 }
    ]);
  });

  it('never returns the starting variant unchanged', () => {
    const sure = {
      answers: asked.map(({ variable, value, options }) => ({
        type: 'choice',
        name: variable,
        choice: typeof value === 'boolean' ? value : String(value),
        probabilities: options.map((option) =>
          option === value ? 0.9 : 0.1 / (options.length - 1)
        )
      }))
    };
    const { variants } = chosenVariants(asked, 1, sure);
    expect(variants[0].values).toHaveLength(1);
  });
});

describe('optionProbabilities', () => {
  const choices = [{ value: 'a' }, { value: 'b' }];
  it('reads probabilities in the order of the choices, or by value', () => {
    expect([
      ...optionProbabilities({ type: 'choice', probabilities: [0.3, 0.7] }, choices)
    ]).toEqual([
      ['a', 0.3],
      ['b', 0.7]
    ]);
    expect([
      ...optionProbabilities(
        { type: 'choice', probabilities: [{ value: 'b', probability: 0.6 }] },
        choices
      )
    ]).toEqual([['b', 0.6]]);
  });

  it('takes the choice alone where no probabilities come back', () => {
    expect([...optionProbabilities({ type: 'choice', choice: 'a' }, choices)]).toEqual([['a', 1]]);
  });
});
