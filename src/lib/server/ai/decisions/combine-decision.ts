/**
 * The choosing stage's decision (ai/bots/helper-pipeline.ts): the designing model reads each hole
 * group's shortlist, with each option's facts and scores, and returns which options go together,
 * one from each group it uses, and why. The app builds only those combinations, so builds stay
 * linear in what is shown. Mode-neutral: groups and options are named by id; a mode says what they
 * are.
 */

import * as v from 'valibot';

/** The longest reason a combination may give, in characters: a sentence or two. */
export const maximumCombinationWhy = 500;

const combinationSchema = v.object({
  /** The option chosen from each group the combination uses, by their ids. */
  picks: v.array(v.object({ group: v.string(), option: v.string() })),
  why: v.pipe(v.string(), v.trim(), v.maxLength(maximumCombinationWhy))
});

export const combineDecisionSchema = v.object({ combinations: v.array(combinationSchema) });
export type CombineDecision = v.InferOutput<typeof combineDecisionSchema>;

/** The response format of the choosing call, strict as OpenAI's structured outputs need. */
export const combineDecisionFormat = {
  name: 'combinations',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      combinations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            picks: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  group: { type: 'string', description: 'A group id, as listed.' },
                  option: { type: 'string', description: 'An option id of that group.' }
                },
                required: ['group', 'option']
              }
            },
            why: {
              type: 'string',
              description:
                'Why these go together and what the participant gains, in one or two sentences.'
            }
          },
          required: ['picks', 'why']
        }
      }
    },
    required: ['combinations']
  }
} as const;

export type ShortlistedOption = {
  id: string;
  name: string;
  description: string;
  facts: string;
  score?: number;
  answers?: Record<string, number>;
};

export type ShortlistedGroup = {
  id: string;
  /** What the group's holes ask for, in a line each. */
  holes: string[];
  options: ShortlistedOption[];
};

/** The choosing call's instructions. */
export const choosingInstructions = `You choose which alternatives a participant sees. Helpers filled the holes of a skeleton the assistant wrote; the app built each fill, measured it, and a decision model scored pictures of it. Each group below is one hole, or holes that must suit each other, with its shortlist.

Return combinations: each takes one option from each group it uses, and a group it leaves out keeps the skeleton's own part. Choose combinations that differ in a way that teaches the participant something about the idea, not small variations, and that suit each other: a view that reads well at the size its layout draws it. Prefer higher scores and readable text, but a lower score that shows the idea more clearly may win; say why in one or two sentences a participant could follow. Return at most the number of combinations asked, best first.`;

/** The choosing call's input: the task, the most combinations, and each group's shortlist. */
export function choosingInput(
  groups: readonly ShortlistedGroup[],
  most: number,
  task?: string
): string {
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return [
    ...(task ? [`The assistant's task: ${task}`] : []),
    `Return at most ${most} combination${most === 1 ? '' : 's'}.`,
    ...groups.map((group) =>
      [
        `Group ${group.id}: ${group.holes.join('; ')}`,
        ...group.options.map((option) => {
          const scored =
            option.score === undefined
              ? 'not scored'
              : `score ${percent(option.score)} (${Object.entries(option.answers ?? {})
                  .map(([question, yes]) => `${question} ${percent(yes)}`)
                  .join(', ')})`;
          return `- ${option.id} "${option.name}": ${option.description}. ${option.facts}; ${scored}`;
        })
      ].join('\n')
    )
  ].join('\n\n');
}

/**
 * The combinations of a decision that name real groups and options, each group at most once,
 * duplicates and empty ones left out, at most `most`.
 */
export function validCombinations(
  decision: unknown,
  groups: readonly ShortlistedGroup[],
  most: number
): CombineDecision['combinations'] {
  const parsed = v.safeParse(combineDecisionSchema, decision);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  return parsed.output.combinations
    .map((combination) => {
      const used = new Set<string>();
      const picks = combination.picks.filter(({ group, option }) => {
        const known = groups.find((each) => each.id === group);
        if (!known?.options.some((each) => each.id === option) || used.has(group)) return false;
        used.add(group);
        return true;
      });
      return { ...combination, picks };
    })
    .filter(({ picks }) => {
      const key = picks
        .map(({ group, option }) => `${group}=${option}`)
        .sort()
        .join(',');
      if (!picks.length || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, most);
}
