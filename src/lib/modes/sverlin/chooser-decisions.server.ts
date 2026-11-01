/**
 * The Sverlin chooser on OpenAI's Decisions API, making more variants of a source as it is: each
 * visible choice (what is shown, the listing, views, forms, pacing) is asked as one choice question,
 * which other option is most worth showing next, or to keep it, each answered with the probability
 * of every option, and every variant changes the few the answers most want changed, never one
 * already seen. Asked instead for each variable's value, every answer keeps its starting value with
 * probability 0.99 to 1.
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
import { allowedChange, hides, pictureTree } from '$lib/server/projects/variant-guard';

import sverlinChooser, { type ChooserOutput, type ChooserProject } from './chooser.server';

type DesignValue = string | number | boolean;

/** How many visible choices each variant of a resample changes. */
const changedPerResample = 2;

/** The answer keeping a variable as it is, among a resample question's alternatives. */
const keep = '(keep)';

/** What is shown, views and layouts, forms and pacing are asked first where a design has more variables than a request can ask. */
function priority(key: string): number {
  if (key.endsWith('.shown') || key === 'listing.language') return 0;
  if (key.startsWith('views.') || key.startsWith('pointers.') || key === 'layout') return 1;
  if (key.endsWith('.form')) return 2;
  if (key.startsWith('pause@')) return 3;
  return 4;
}

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

/** The choices a participant sees change at once: what is shown, the listing, views, layouts, forms, pacing. */
const visible = (variable: string) => priority(variable) < 4;

/** Resample questions: for each visible choice, which other option is most worth showing, or keep. */
export function resampleQuestions(asked: readonly Asked[]): ChoiceQuestion[] {
  return asked.map(({ variable, value, options }) => ({
    type: 'choice',
    name: variable,
    instructions: `The participant asked for another variant of this visualization, without changing its source; project.seen lists the variants already shown. ${variable} is now ${JSON.stringify(value)}. Choose the other option most worth showing next, or ${JSON.stringify(keep)} if the conversation or earlier preferences settled it, or changing it would not help.`,
    choices: [
      ...options.filter((option) => option !== value).map((option) => ({ value: String(option) })),
      { value: keep }
    ]
  }));
}

/**
 * The variants of a resample: each changes the next few visible choices the answers most want
 * changed (the likeliest answer other than keep), so it always differs from where it started, and
 * skips a set of changes already seen.
 */
export function resampledVariants(
  asked: readonly Asked[],
  count: number,
  response: Pick<DecisionsResponse, 'answers'>,
  seen: readonly Record<string, DesignValue>[] = [],
  /** Whether a change may be made at all (variant-guard.ts); every change by default. */
  allowed: (variable: string, value: DesignValue) => boolean = () => true
): ChooserOutput {
  const questions = resampleQuestions(asked);
  const ranked = asked
    .map((variable, index) => {
      const answer =
        response.answers.find(({ name }) => name === variable.variable) ?? response.answers[index];
      const probabilities = answer
        ? optionProbabilities(answer, questions[index].choices)
        : new Map<string | boolean, number>();
      const alternatives = variable.options.filter((option) => option !== variable.value);
      const [alternative] = [...alternatives].sort(
        (a, b) => (probabilities.get(String(b)) ?? 0) - (probabilities.get(String(a)) ?? 0)
      );
      // Without an answer, the change is as wanted as keeping it.
      const wanted = probabilities.size ? 1 - (probabilities.get(keep) ?? 0) : 0.5;
      return {
        variable: variable.variable,
        alternative,
        wanted,
        order: priority(variable.variable)
      };
    })
    .filter(
      ({ variable, alternative }) => alternative !== undefined && allowed(variable, alternative)
    )
    .sort((a, b) => b.wanted - a.wanted || a.order - b.order);
  const isSeen = (values: readonly { variable: string; value: DesignValue }[]) =>
    seen.some(
      (variant) =>
        Object.keys(variant).length === values.length &&
        values.every(({ variable, value }) => variant[variable] === value)
    );
  // The next changes from a place in the ranking, at most one of them hiding something; and where
  // the walk ended.
  const changesFrom = (start: number) => {
    const values: { variable: string; value: DesignValue }[] = [];
    let at = start;
    for (; at < start + ranked.length && values.length < changedPerResample; at += 1) {
      const { variable, alternative } = ranked[at % ranked.length];
      const hiding = hides(variable, alternative);
      if (hiding && values.some(({ variable, value }) => hides(variable, value))) continue;
      values.push({ variable, value: alternative });
    }
    return { values, next: at };
  };
  const variants: ChooserOutput['variants'] = [];
  let start = 0;
  let tries = 0;
  while (variants.length < count && ranked.length && tries < ranked.length * 3) {
    tries += 1;
    const { values, next } = changesFrom(start);
    if (isSeen(values) && tries < ranked.length * 2) {
      start += 1;
      continue;
    }
    variants.push({ values, randomise: [] });
    start = next;
  }
  return { variants };
}

function decisionsInput(request: ChatAdapterRequest): string {
  return [
    request.initialPrompt,
    `Context provided by this chat configuration:\n\n${JSON.stringify(request.context)}`,
    `The conversation:\n\n${JSON.stringify(request.messages)}`
  ].join('\n\n');
}

export const decisionsChooserAdapter: ChatAdapter = {
  id: 'openai-decisions',
  async generateReply(request) {
    const project = (request.context as { project: ChooserProject }).project;
    const guard = {
      tree: pictureTree(project.source),
      base: Object.fromEntries(
        project.design.variables.map(({ variable, value }) => [variable, value])
      ),
      settled: project.settled ?? {}
    };
    const asked = askedVariables(project).filter(({ variable }) => visible(variable));
    const response = await createDecisions(
      {
        model: request.parameters.model,
        input: decisionsInput(request),
        questions: resampleQuestions(asked)
      },
      request.signal
    );
    return {
      output: resampledVariants(asked, project.count, response, project.seen, (variable, value) =>
        allowedChange(guard, variable, value)
      ),
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
