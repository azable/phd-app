/**
 * OpenAI's Decisions API (POST /v1/decisions): predicate questions, each a statement answered with
 * the probability that it is true. Called through the SDK's generic request, as the installed SDK
 * predates its decisions resource.
 *
 * The input is text, or one user message of text and image parts, each image an inline base64
 * data URL (the endpoint takes no hosted links or file IDs), up to 128 a request. That shape is
 * from OpenAI's guide (https://developers.openai.com/api/docs/guides/decisions) as quoted by
 * third-party summaries and the TrueFoundry and LiteLLM gateway docs
 * (https://www.truefoundry.com/docs/ai-gateway/decisions, https://docs.litellm.ai/docs/decisions),
 * read 2026-11-06. A request with a predicate and a picture, sent 2026-11-07 to gpt-6-luna, was
 * answered `{ type: 'predicate', name, probability }`, the probability to two decimals.
 *
 * @packageDocumentation
 */

import OpenAI from 'openai';

import { readApiKey, readRequestTimeoutMs } from './openai';

export type PredicateQuestion = { type: 'predicate'; name: string; instructions: string };

export type DecisionsInputPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string };

/** The most images one request may carry. */
export const maximumDecisionImages = 128;

export type DecisionsRequest = {
  model: string;
  input: string | [{ role: 'user'; content: DecisionsInputPart[] }];
  questions: PredicateQuestion[];
};

/** A predicate answer: the probability that its statement is true; a refusal has none. */
export type PredicateAnswer = {
  type: 'predicate' | 'refusal' | string;
  name?: string;
  probability?: number;
};

export type DecisionsResponse = {
  id?: string;
  model?: string;
  answers: PredicateAnswer[];
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
