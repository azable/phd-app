import { describe, expect, it, vi } from 'vitest';

import type { DecisionsRequest } from '$lib/server/ai/providers/openai-decisions';
import {
  componentQuestions,
  contextQuestions,
  scoreOptions,
  scoringRequest,
  shortlists,
  type ScoringOption
} from './scoring';
import { choosingInput, validCombinations } from '../decisions/combine-decision';

const picture = 'data:image/png;base64,AAAA';
const option = (
  id: string,
  group: string,
  measure: number,
  look: ScoringOption['look'] = 'context'
) =>
  ({
    id,
    group,
    look,
    pictures: [picture],
    facts: '3:2, text 12 px',
    measure
  }) satisfies ScoringOption;

/** A decision model that says yes with the probability each option's id names, as "o80" 0.8. */
const decide = vi.fn(async (request: DecisionsRequest) => {
  const text = typeof request.input === 'string' ? request.input : JSON.stringify(request.input);
  const yes = Number(/"o(\d+)/u.exec(text)?.[1] ?? 50) / 100;
  return {
    answers: request.questions.map((question) => ({
      type: 'choice',
      name: question.name,
      choice: yes >= 0.5,
      probabilities: [yes, 1 - yes]
    })),
    usage: { input_tokens: 900, output_tokens: 0 }
  };
});

describe('the scoring stage', () => {
  it('asks a component about itself and a part in context about the picture, with its pictures', () => {
    const component = scoringRequest(option('a', 'g', 1, 'component'), 'gpt-6-luna');
    expect(component.questions).toBe(componentQuestions);
    const context = scoringRequest(option('b', 'g', 1), 'gpt-6-luna');
    expect(context.questions).toBe(contextQuestions);
    expect(context.input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: expect.stringContaining('Measured: 3:2, text 12 px') },
          { type: 'input_image', image_url: picture }
        ]
      }
    ]);
  });

  it('scores each option by its mean probability of yes, and records pictures by size only', async () => {
    const options = [option('o80', 'g', 1), option('o30', 'g', 2)].map((each) => ({
      ...each,
      facts: `${each.id} "${each.id}"`
    }));
    const { scores, calls } = await scoreOptions(options, 'gpt-6-luna', decide);
    expect(scores.get('o80')?.score).toBeCloseTo(0.8);
    expect(scores.get('o30')?.answers).toEqual({
      no_overlap: 0.3,
      text_readable: 0.3,
      focus_clear: 0.3
    });
    expect(JSON.stringify(calls[0].request)).not.toContain('base64');
  });

  it('gives an option whose call fails no score, and asks nothing of one with no pictures', async () => {
    const failing = vi.fn(async () => {
      throw new Error('unavailable');
    });
    const { scores, calls } = await scoreOptions([option('a', 'g', 1)], 'm', failing);
    expect(scores.size).toBe(0);
    expect(calls[0].error).toBeInstanceOf(Error);
    const none = await scoreOptions([{ ...option('b', 'g', 1), pictures: [] }], 'm', failing);
    expect(none.calls).toEqual([]);
  });

  it('shortlists each group by score, then by the app’s measure where none is scored', () => {
    const options = [
      option('a', 'x', 3),
      option('b', 'x', 1),
      option('c', 'x', 2),
      option('d', 'y', 1)
    ];
    const scored = new Map([['b', { score: 0.9, answers: {} }]]);
    const listed = shortlists(options, scored, 2);
    expect(listed.get('x')?.map(({ id }) => id)).toEqual(['b', 'a']);
    expect(listed.get('y')?.map(({ id }) => id)).toEqual(['d']);
    // With scoring off, the measure alone ranks.
    expect(
      shortlists(options, new Map(), 3)
        .get('x')
        ?.map(({ id }) => id)
    ).toEqual(['a', 'c', 'b']);
  });
});

describe('the choosing stage', () => {
  const groups = [
    {
      id: 'g1',
      holes: ['view (view of Int): bars'],
      options: [
        { id: 'g1o1', name: 'Bars', description: 'bars', facts: '' },
        { id: 'g1o2', name: 'Dots', description: 'dots', facts: '' }
      ]
    },
    {
      id: 'g2',
      holes: ['layout (layout of Main): wide'],
      options: [
        {
          id: 'g2o1',
          name: 'Wide',
          description: 'wide',
          facts: '',
          score: 0.7,
          answers: { no_overlap: 0.9 }
        }
      ]
    }
  ];

  it('tells the designing model each group’s shortlist with scores', () => {
    const input = choosingInput(groups, 2, 'show the order');
    expect(input).toContain('Return at most 2 combinations.');
    expect(input).toContain('Group g2: layout (layout of Main): wide');
    expect(input).toContain('- g2o1 "Wide": wide. ; score 70% (no_overlap 90%)');
    expect(input).toContain('- g1o1 "Bars": bars. ; not scored');
  });

  it('keeps only combinations of real options, one per group, no repeats, at most as asked', () => {
    const decision = {
      combinations: [
        {
          picks: [
            { group: 'g1', option: 'g1o1' },
            { group: 'g2', option: 'g2o1' }
          ],
          why: 'bars read at this width'
        },
        {
          picks: [
            { group: 'g2', option: 'g2o1' },
            { group: 'g1', option: 'g1o1' }
          ],
          why: 'the same again'
        },
        {
          picks: [
            { group: 'g1', option: 'g1o2' },
            { group: 'g1', option: 'g1o1' }
          ],
          why: 'one per group'
        },
        { picks: [{ group: 'g3', option: 'x' }], why: 'no such group' },
        { picks: [{ group: 'g2', option: 'g2o1' }], why: 'over the limit' }
      ]
    };
    expect(validCombinations(decision, groups, 2)).toEqual([
      {
        picks: [
          { group: 'g1', option: 'g1o1' },
          { group: 'g2', option: 'g2o1' }
        ],
        why: 'bars read at this width'
      },
      { picks: [{ group: 'g1', option: 'g1o2' }], why: 'one per group' }
    ]);
    expect(validCombinations({ views: [] }, groups, 2)).toEqual([]);
  });
});
