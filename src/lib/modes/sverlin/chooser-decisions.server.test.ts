import { describe, expect, it } from 'vitest';

import { optionProbabilities } from '$lib/server/chat-adapters/openai-decisions';

import { resampleQuestions, resampledVariants } from './chooser-decisions.server';

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
