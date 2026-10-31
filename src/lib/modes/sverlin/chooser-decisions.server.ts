/**
 * The Sverlin chooser on OpenAI's Decisions API: every open variable asked as one choice question,
 * each answered with the probability of every option. The first variant takes each variable's
 * likeliest option; each further variant changes the variables the answers were least sure of to
 * their next likeliest, so a pair differs in the few choices still open and stays alike elsewhere.
 */

import {
  createDecisions,
  maximumDecisionQuestions,
  optionProbabilities,
  type ChoiceQuestion,
  type DecisionsResponse
} from '$lib/server/chat-adapters/openai-decisions';
import { readRequestTimeoutMs } from '$lib/server/chat-adapters/openai';
import type { ChatAdapter, ChatAdapterRequest } from '$lib/server/chat-adapters/types';
import type { ChatBotConfig } from '$lib/server/chat-bots/types';

import sverlinChooser, { type ChooserOutput, type ChooserProject } from './chooser.server';

type DesignValue = string | number | boolean;

/** How many variables each further variant changes from the first. */
const changedPerVariant = 3;

/** What is shown, views, forms and pacing are asked first where a design has more variables than a request can ask. */
function priority(key: string): number {
  if (key.endsWith('.shown') || key === 'listing.language') return 0;
  if (key.startsWith('views.') || key.startsWith('pointers.')) return 1;
  if (key.endsWith('.form')) return 2;
  if (key.startsWith('pause@')) return 3;
  return 4;
}

const encoded = (value: DesignValue) => (typeof value === 'boolean' ? value : String(value));

type Asked = { variable: string; value: DesignValue; options: readonly DesignValue[] };

/** The variables asked: every one with a choice to make, the most telling first, within the limit. */
function askedVariables(project: ChooserProject): Asked[] {
  return project.design.variables
    .map(({ variable, value, options }) => ({
      variable,
      value,
      options: typeof options === 'string' ? (project.design.options[options] ?? []) : options
    }))
    .filter(({ options }) => options.length > 1)
    .sort((a, b) => priority(a.variable) - priority(b.variable))
    .slice(0, maximumDecisionQuestions);
}

export function chooserQuestions(asked: readonly Asked[]): ChoiceQuestion[] {
  return asked.map(({ variable, value, options }) => ({
    type: 'choice',
    name: variable,
    instructions: `The value of ${variable} in the next variant; it starts as ${JSON.stringify(value)}.`,
    choices: options.map((option) => ({ value: encoded(option) }))
  }));
}

function decisionsInput(request: ChatAdapterRequest): string {
  return [
    request.initialPrompt,
    `Context provided by this chat configuration:\n\n${JSON.stringify(request.context)}`,
    `The conversation:\n\n${JSON.stringify(request.messages)}`
  ].join('\n\n');
}

/** The variants the answers give, as chooser.md's output: each the values it changes. */
export function chosenVariants(
  asked: readonly Asked[],
  count: number,
  response: Pick<DecisionsResponse, 'answers'>
): ChooserOutput {
  const ranked = asked.map((variable, index) => {
    const question = chooserQuestions([variable])[0];
    const answer =
      response.answers.find(({ name }) => name === variable.variable) ?? response.answers[index];
    const probabilities = answer ? optionProbabilities(answer, question.choices) : new Map();
    const options = [...variable.options].sort(
      (a, b) => (probabilities.get(encoded(b)) ?? 0) - (probabilities.get(encoded(a)) ?? 0)
    );
    const best = probabilities.size ? options[0] : variable.value;
    return { ...variable, options, best, sureness: probabilities.get(encoded(best)) ?? 1 };
  });
  const first = new Map(ranked.map(({ variable, best }) => [variable, best]));
  // Least sure first: the choices a participant's answer would say most about.
  const open = ranked
    .filter(({ options, best }) => options.some((option) => option !== best))
    .sort((a, b) => a.sureness - b.sureness);
  const variants = Array.from({ length: count }, (_, index) => {
    const values = new Map(first);
    for (const variable of open.slice((index - 1) * changedPerVariant, index * changedPerVariant))
      values.set(variable.variable, variable.options.find((option) => option !== variable.best)!);
    // A variant identical to where it started changes the least sure choice instead.
    if (ranked.every(({ variable, value }) => values.get(variable) === value) && open[0])
      values.set(open[0].variable, open[0].options.find((option) => option !== open[0].value)!);
    return {
      values: ranked
        .filter(({ variable, value }) => values.get(variable) !== value)
        .map(({ variable }) => ({ variable, value: values.get(variable)! })),
      randomise: []
    };
  });
  return { variants };
}

export const decisionsChooserAdapter: ChatAdapter = {
  id: 'openai-decisions',
  async generateReply(request) {
    const project = (request.context as { project: ChooserProject }).project;
    const asked = askedVariables(project);
    const response = await createDecisions(
      {
        model: request.parameters.model,
        input: decisionsInput(request),
        questions: chooserQuestions(asked)
      },
      request.signal
    );
    return {
      output: chosenVariants(asked, project.count, response),
      providerResponse: response,
      generation: {
        ...(response.model ? { model: response.model } : {}),
        ...(response.id ? { responseId: response.id } : {}),
        ...(response.usage
          ? {
              usage: {
                inputTokens: response.usage.input_tokens ?? 0,
                outputTokens: response.usage.output_tokens ?? 0,
                totalTokens: response.usage.total_tokens ?? 0
              }
            }
          : {})
      }
    };
  },
  requestTimeoutMs: readRequestTimeoutMs
};

/** The chooser's definition, its questions answered by the Decisions API's model. */
export default {
  ...sverlinChooser,
  id: 'sverlin-chooser-decisions',
  attemptProfiles: [{ purpose: 'choosing', parameters: { model: 'gpt-6-luna' } }]
} satisfies ChatBotConfig<ChooserProject, ChooserOutput>;
