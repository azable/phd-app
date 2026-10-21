/**
 * The Sverlin chooser: after the assistant's source builds, it chooses the values of the variants
 * its presentations are built with, from the source's design space.
 */

import * as v from 'valibot';

import { visualizationParticipantIntake } from '$lib/server/chat-bots/participant-intake';
import type { AiDesign } from '$lib/server/chat-bots/project-context';
import type { ChatBotConfig } from '$lib/server/chat-bots/types';

import chooser from './chooser.md?raw';
import guide from './README.md?raw';

/** What the chooser is given: the new source, what it changes, how many variants, and its design. */
export type ChooserProject = {
  source: string;
  summary?: string;
  count: number;
  design: AiDesign;
};

const designValue = v.union([v.string(), v.number(), v.boolean()]);

/** One variant the chooser returns: the values it changes, and the variables to draw afresh. */
export type ChosenVariant = {
  values: { variable: string; value: string | number | boolean }[];
  randomise: string[];
};
export type ChooserOutput = { variants: ChosenVariant[] };

const outputSchema = v.strictObject({
  variants: v.array(
    v.strictObject({
      values: v.array(v.strictObject({ variable: v.string(), value: designValue })),
      randomise: v.array(v.string())
    })
  )
});

const promptText = (markdown: string) => markdown.replace(/<!--[\s\S]*?-->\s*/gu, '').trim();
// The guide's Design section says what kinds, variables, and options are.
const design = guide.slice(guide.indexOf('\n## Design\n'), guide.indexOf('\n## The subset\n'));

export default {
  id: 'sverlin-chooser',
  participantIntake: visualizationParticipantIntake,
  initialPrompt: [promptText(chooser), promptText(design)].join('\n\n'),
  buildContext: ({ project, attempt }) => ({ project, attemptContext: attempt }),
  attemptProfiles: [
    {
      purpose: 'choosing',
      parameters: { model: 'gpt-5.6-luna', reasoningEffort: 'low', maxOutputTokens: 4000 }
    }
  ],
  responseFormat: {
    name: 'design_variants',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        variants: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              values: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    variable: { type: 'string', description: 'A key from project.design.' },
                    value: {
                      anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
                      description: 'One of the variable’s options.'
                    }
                  },
                  required: ['variable', 'value']
                }
              },
              randomise: {
                type: 'array',
                items: { type: 'string' },
                description: 'Keys of variables to draw afresh at random.'
              }
            },
            required: ['values', 'randomise']
          }
        }
      },
      required: ['variants']
    }
  },
  parseOutput: (value) => v.parse(outputSchema, value)
} satisfies ChatBotConfig<ChooserProject, ChooserOutput>;
