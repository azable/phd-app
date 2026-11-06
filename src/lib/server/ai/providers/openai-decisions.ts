/**
 * OpenAI's Decisions API (POST /v1/decisions): questions with fixed answers, each answered with
 * a choice and the probability of every option. Called through the SDK's generic request, as the
 * installed SDK predates its decisions resource.
 *
 * The input is text, or one user message of text and image parts, each image an inline base64
 * data URL (the endpoint takes no hosted links or file IDs), up to 128 a request. That shape is
 * from OpenAI's guide (https://developers.openai.com/api/docs/guides/decisions) as quoted by
 * third-party summaries and the TrueFoundry and LiteLLM gateway docs
 * (https://www.truefoundry.com/docs/ai-gateway/decisions, https://docs.litellm.ai/docs/decisions),
 * read 2026-11-06; no request with images has been sent from this app yet.
 *
 * @packageDocumentation
 */

import OpenAI from 'openai';

import { readApiKey, readRequestTimeoutMs } from './openai';

export type DecisionChoice = { value: string | boolean; description?: string };
export type ChoiceQuestion = {
  type: 'choice';
  name: string;
  instructions: string;
  choices: DecisionChoice[];
};

export type DecisionsInputPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string };

/** The most images one request may carry. */
export const maximumDecisionImages = 128;

export type DecisionsRequest = {
  model: string;
  input: string | [{ role: 'user'; content: DecisionsInputPart[] }];
  questions: ChoiceQuestion[];
};

/** A choice answer: the option chosen, and each option's probability where returned. */
export type ChoiceAnswer = {
  type: 'choice' | 'refusal' | string;
  name?: string;
  choice?: string | boolean;
  confidence?: number;
  probabilities?: unknown;
};

export type DecisionsResponse = {
  id?: string;
  model?: string;
  answers: ChoiceAnswer[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

/** The most questions one request may ask. */
export const maximumDecisionQuestions = 400;

export async function createDecisions(
  request: DecisionsRequest,
  signal?: AbortSignal
): Promise<DecisionsResponse> {
  const client = new OpenAI({
    apiKey: readApiKey(),
    maxRetries: 0,
    timeout: readRequestTimeoutMs()
  });
  return client.post<DecisionsResponse>('/decisions', { body: request, signal });
}

/**
 * Each option's probability, by its value: the API's probabilities as numbers in the order of the
 * choices, or as objects naming their value; the chosen option alone where none come back.
 */
export function optionProbabilities(
  answer: ChoiceAnswer,
  choices: readonly DecisionChoice[]
): Map<string | boolean, number> {
  const probabilities = new Map<string | boolean, number>();
  if (Array.isArray(answer.probabilities)) {
    answer.probabilities.forEach((entry: unknown, index) => {
      if (typeof entry === 'number' && choices[index])
        probabilities.set(choices[index].value, entry);
      else if (entry && typeof entry === 'object') {
        const { value, choice, probability } = entry as Record<string, unknown>;
        const key = value ?? choice;
        if (
          (typeof key === 'string' || typeof key === 'boolean') &&
          typeof probability === 'number'
        )
          probabilities.set(key, probability);
      }
    });
  }
  if (!probabilities.size && answer.choice !== undefined) probabilities.set(answer.choice, 1);
  return probabilities;
}
