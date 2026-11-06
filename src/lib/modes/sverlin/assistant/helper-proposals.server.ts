/**
 * What a helper is given and what it returns (design: "Helpers: skeletons with holes"): a task is a
 * skeleton, the holes it fills, constraints the app can check, and how many proposals; a proposal is
 * a fill for each of those holes, with a name, what it shows, and the shape it aims at. The app, not
 * the helper, measures each fill once built.
 */

import * as v from 'valibot';

import type { Hole } from './skeleton.server';

/** The most proposals one helper call returns: one by default, as each call tries a direction. */
export const maximumProposals = 3;

/** What the main agent may ask of a round beyond the skeleton: constraints and a count. */
export const helperTaskSchema = v.object({
  skeleton: v.pipe(v.string(), v.minLength(1)),
  constraints: v.optional(v.array(v.pipe(v.string(), v.maxLength(200))), []),
  count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(maximumProposals)), 1)
});
export type HelperTask = v.InferOutput<typeof helperTaskSchema>;

const proposalSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60)),
  description: v.pipe(v.string(), v.trim(), v.maxLength(300)),
  fills: v.array(v.object({ hole: v.string(), markup: v.string() })),
  aimedAspect: v.optional(v.string(), '')
});
export type Proposal = v.InferOutput<typeof proposalSchema>;

/** A helper's reply: its proposals, those that do not parse left out. */
export function parseProposals(output: unknown): Proposal[] {
  const proposals = (output as { proposals?: unknown } | undefined)?.proposals;
  if (!Array.isArray(proposals)) return [];
  return proposals.flatMap((proposal) => {
    const parsed = v.safeParse(proposalSchema, proposal);
    return parsed.success ? [parsed.output] : [];
  });
}

/** A proposal's fills by hole name, the last of a name winning. */
export const fillsOf = (proposal: Proposal): Record<string, string> =>
  Object.fromEntries(proposal.fills.map(({ hole, markup }) => [hole, markup]));

/** The response format of a helper call, strict as OpenAI's structured outputs need. */
export const proposalsFormat = {
  name: 'hole_fills',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      proposals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'A short name, as cycle-and-tie.' },
            description: { type: 'string', description: 'What it shows, in one sentence.' },
            fills: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  hole: { type: 'string', description: 'The name of the hole it fills.' },
                  markup: { type: 'string', description: 'The markup that takes its place.' }
                },
                required: ['hole', 'markup']
              }
            },
            aimedAspect: {
              type: 'string',
              description: 'The shape it aims at, as 3:2, or an empty string.'
            }
          },
          required: ['name', 'description', 'fills', 'aimedAspect']
        }
      }
    },
    required: ['proposals']
  }
} as const;

/**
 * The words of one helper call: the holes it fills with their tasks, a direction to try, the
 * constraints, what is known of the participant, and the skeleton.
 */
export function holeHelperTask({
  skeleton,
  holes,
  count,
  direction,
  constraints,
  background
}: {
  skeleton: string;
  holes: readonly Hole[];
  count: number;
  direction?: string;
  constraints: readonly string[];
  background?: string;
}): string {
  const listed = holes
    .map(
      (hole) =>
        `- ${hole.name} (${hole.kind}${hole.of ? ` of ${hole.of}` : ''}): ${hole.task || 'open'}`
    )
    .join('\n');
  return [
    `Fill ${holes.length === 1 ? 'the hole' : 'these holes together, so they suit each other'}:\n${listed}`,
    `Return JSON {"proposals":[{"name","description","fills":[{"hole","markup"}],"aimedAspect"}]} with ${count} proposal${count === 1 ? '' : 's'}${direction ? `, trying ${direction}` : ''}.`,
    ...(constraints.length
      ? [`Constraints the app checks:\n${constraints.map((line) => `- ${line}`).join('\n')}`]
      : []),
    ...(background ? [`What the participant has said and settled:\n${background}`] : []),
    `The skeleton:\n\n${skeleton}`
  ].join('\n\n');
}
