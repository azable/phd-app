import { describe, expect, it } from 'vitest';

import { optionProbabilities } from '$lib/server/chat-adapters/openai-decisions';

import {
  chooserQuestions,
  chosenVariants,
  resampleQuestions,
  resampledVariants
} from './chooser-decisions.server';

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

describe('resampledVariants', () => {
  const visibleAsked = [
    { variable: 'listing.language', value: 'textbook', options: ['textbook', 'none'] },
    {
      variable: 'views.VertexRef',
      value: 'VertexNumber',
      options: ['VertexNumber', 'VertexName', 'none']
    },
    {
      variable: 'Graph.form',
      value: 'natural',
      options: ['natural', 'line', 'snake', 'wave', 'arc', 'scatter']
    },
    { variable: 'pause@visit', value: 'on', options: ['on', 'off'] }
  ];
  // As the API answers: probabilities as { value, probability }, keep the likeliest where settled.
  const realShape = {
    answers: [
      {
        type: 'choice',
        name: 'listing.language',
        choice: '(keep)',
        probabilities: [
          { value: 'none', probability: 0.1 },
          { value: '(keep)', probability: 0.9 }
        ],
        confidence: 0.9
      },
      {
        type: 'choice',
        name: 'views.VertexRef',
        choice: 'VertexName',
        probabilities: [
          { value: 'VertexName', probability: 0.7 },
          { value: 'none', probability: 0.05 },
          { value: '(keep)', probability: 0.25 }
        ],
        confidence: 0.7
      },
      {
        type: 'choice',
        name: 'Graph.form',
        choice: 'snake',
        probabilities: [
          { value: 'line', probability: 0.2 },
          { value: 'snake', probability: 0.4 },
          { value: '(keep)', probability: 0.4 }
        ],
        confidence: 0.4
      },
      {
        type: 'choice',
        name: 'pause@visit',
        choice: '(keep)',
        probabilities: [
          { value: 'off', probability: 0.3 },
          { value: '(keep)', probability: 0.7 }
        ],
        confidence: 0.7
      }
    ]
  };

  it('changes the visible choices most wanted, even for one variant', () => {
    const { variants } = resampledVariants(visibleAsked, 1, realShape);
    expect(variants).toEqual([
      {
        values: [
          { variable: 'views.VertexRef', value: 'VertexName' },
          { variable: 'Graph.form', value: 'snake' }
        ],
        randomise: []
      }
    ]);
  });

  it('gives a pair different changes', () => {
    const { variants } = resampledVariants(visibleAsked, 2, realShape);
    expect(variants[1].values.map(({ variable }) => variable)).toEqual([
      'pause@visit',
      'listing.language'
    ]);
  });

  it('skips a set of changes already seen', () => {
    const seen = [{ 'views.VertexRef': 'VertexName', 'Graph.form': 'snake' }];
    const { variants } = resampledVariants(visibleAsked, 1, realShape, seen);
    expect(variants[0].values).toEqual([
      { variable: 'Graph.form', value: 'snake' },
      { variable: 'pause@visit', value: 'off' }
    ]);
  });

  it('still changes something visible when every answer says keep', () => {
    const settled = {
      answers: visibleAsked.map(({ variable }) => ({
        type: 'choice',
        name: variable,
        choice: '(keep)',
        probabilities: [{ value: '(keep)', probability: 1 }]
      }))
    };
    const { variants } = resampledVariants(visibleAsked, 1, settled);
    expect(variants[0].values).toHaveLength(2);
  });

  it('asks each choice with its alternatives and keep', () => {
    const [listing] = resampleQuestions(visibleAsked);
    expect(listing.choices).toEqual([{ value: 'none' }, { value: '(keep)' }]);
  });
});
