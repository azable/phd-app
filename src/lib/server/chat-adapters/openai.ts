/**
 * OpenAI Responses API implementation of the provider-neutral chat adapter.
 *
 * @packageDocumentation
 */

import OpenAI from 'openai';
import type { ResponseInput } from 'openai/resources/responses/responses';

import {
  InvalidChatbotResponseError,
  type ChatAdapter,
  type ChatAdapterRequest,
  type ChatAdapterResult
} from './types';

const defaultMaxContextChars = 500_000;
const defaultRequestTimeoutMs = 180_000;

/** Raised when the server has no usable OpenAI API key. */
export class OpenAIConfigurationError extends Error {
  constructor() {
    super('OpenAI is not configured on the server.');
    this.name = 'OpenAIConfigurationError';
  }
}

/** Raised before a request when serialized project context exceeds its configured limit. */
export class ChatContextOverflowError extends Error {
  constructor() {
    super('The complete project history is too large for the configured chat context.');
    this.name = 'ChatContextOverflowError';
  }
}

export function readApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) throw new OpenAIConfigurationError();

  return apiKey;
}

function readMaxContextChars() {
  const configured = Number.parseInt(process.env.CHATBOT_MAX_CONTEXT_CHARS ?? '', 10);

  return Number.isSafeInteger(configured) && configured > 0 ? configured : defaultMaxContextChars;
}

/** How fully the model summarizes its reasoning, or undefined where summaries are off. */
function readReasoningSummary(): 'auto' | 'concise' | 'detailed' | undefined {
  const configured = process.env.CHATBOT_REASONING_SUMMARIES?.trim() || 'detailed';
  return configured === 'concise' || configured === 'detailed' || configured === 'auto'
    ? configured
    : undefined;
}

/**
 * A JSON Schema in the subset OpenAI's strict structured outputs accept: oneOf as anyOf, which
 * matches the same values where the alternatives exclude each other, as decisions do by their
 * action; const as a one-value enum; and no $schema.
 */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(
    Object.entries(schema).flatMap(([key, value]): [string, unknown][] => {
      if (key === '$schema') return [];
      if (key === 'oneOf') return [['anyOf', strictSchema(value)]];
      if (key === 'const') return [['enum', [value]]];
      return [[key, strictSchema(value)]];
    })
  );
}

export function readRequestTimeoutMs(): number {
  const configured = Number.parseInt(process.env.CHATBOT_REQUEST_TIMEOUT_MS ?? '', 10);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : defaultRequestTimeoutMs;
}

function serializeContext(context: ChatAdapterRequest['context']) {
  const serialized = JSON.stringify(context);

  if (serialized.length > readMaxContextChars()) throw new ChatContextOverflowError();

  return serialized;
}

/** Parse and validate the structured text returned by the provider. */
export function parseResult(outputText: string, providerResponse?: unknown): ChatAdapterResult {
  try {
    return { output: JSON.parse(outputText) };
  } catch (error) {
    if (error instanceof InvalidChatbotResponseError) throw error;
    throw invalidResponse(providerResponse);
  }
}

function invalidResponse(providerResponse?: unknown) {
  const response = providerResponse as
    | {
        status?: unknown;
        incomplete_details?: { reason?: unknown } | null;
        output?: unknown;
      }
    | undefined;
  if (response?.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;
    return new InvalidChatbotResponseError(
      `The chatbot response was incomplete${typeof reason === 'string' ? ` (${reason})` : ''}.`,
      providerResponse
    );
  }
  if (containsRefusal(response?.output)) {
    return new InvalidChatbotResponseError(
      'The chatbot refused the request instead of returning structured output.',
      providerResponse
    );
  }
  return new InvalidChatbotResponseError(
    'The chatbot returned an invalid structured response.',
    providerResponse
  );
}

function containsRefusal(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRefusal);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.type === 'refusal' || Object.values(record).some(containsRefusal);
}

/**
 * The request's input, cached by its prompt: the configured prompt, the same for every call of a
 * bot, ends at an explicit cache breakpoint; the context and the conversation, which change every
 * call, follow it and are never written to the cache. On GPT-5.6, implicit caching writes the whole
 * prompt at 1.25× the input price at its latest message and reads only a prefix that matches to a
 * breakpoint, so a prompt whose context changes every call was written each time and never read
 * (measured 2026-11-05: 38,000 tokens written per call, none cached); with the breakpoint after the
 * prompt, later calls read it at 0.1× (https://developers.openai.com/api/docs/guides/prompt-caching).
 */
export function requestInput(request: ChatAdapterRequest, context: string): ResponseInput {
  return [
    {
      role: 'developer' as const,
      content: [
        {
          type: 'input_text' as const,
          text: request.initialPrompt,
          prompt_cache_breakpoint: { mode: 'explicit' as const }
        }
      ]
    },
    {
      role: 'developer' as const,
      content: `Context provided by this chat configuration:\n\n${context}`
    },
    ...request.messages
  ];
}

/**
 * Explicit caching for models that accept it (GPT-5.6 and later). The default 30-minute lifetime
 * writes at 1.25× input; a study session's calls come minutes apart, and the 12-hour lifetime would
 * write at 2.5× (same source).
 */
export function cacheOptions(model: string): {
  prompt_cache_options?: { mode: 'explicit'; ttl: '30m' };
} {
  return /^gpt-(5\.([6-9])|[6-9])/u.test(model)
    ? { prompt_cache_options: { mode: 'explicit' as const, ttl: '30m' as const } }
    : {};
}

/** A response's token use, with the cached, cache-written and reasoning tokens where reported. */
export function usageOf(usage: {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null;
  output_tokens_details?: { reasoning_tokens?: number } | null;
}): Record<string, number> {
  const details = usage.input_tokens_details;
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    ...(details?.cached_tokens !== undefined ? { cachedInputTokens: details.cached_tokens } : {}),
    ...(details?.cache_write_tokens !== undefined
      ? { cacheWriteTokens: details.cache_write_tokens }
      : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {})
  };
}

/** Generate one response through the OpenAI Responses API. */
export async function generateOpenAIReply(request: ChatAdapterRequest): Promise<ChatAdapterResult> {
  const client = new OpenAI({
    apiKey: readApiKey(),
    maxRetries: 0,
    timeout: readRequestTimeoutMs()
  });
  const context = serializeContext(request.context);
  const response = await client.responses.create(
    {
      model: request.parameters.model,
      // Keep the server's immutable project Timeline as the source of truth.
      store: false,
      input: requestInput(request, context),
      ...cacheOptions(request.parameters.model),
      max_output_tokens: request.parameters.maxOutputTokens,
      // A summary of the reasoning, unless turned off, comes back with the response for audit.
      reasoning: request.parameters.reasoningEffort
        ? {
            effort: request.parameters.reasoningEffort,
            ...(readReasoningSummary() ? { summary: readReasoningSummary() } : {})
          }
        : undefined,
      temperature: request.parameters.temperature,
      text: {
        format: {
          type: 'json_schema',
          name: request.responseFormat.name,
          strict: request.responseFormat.strict ?? true,
          schema: strictSchema(request.responseFormat.schema) as Record<string, unknown>
        }
      }
    },
    { signal: request.signal }
  );

  const usage = response.usage ? usageOf(response.usage) : undefined;
  let parsed: ChatAdapterResult;
  try {
    parsed = parseResult(response.output_text, response);
  } catch (error) {
    // A response that cannot be used was still paid for.
    if (error instanceof InvalidChatbotResponseError && usage) error.usage = usage;
    throw error;
  }
  return {
    ...parsed,
    providerResponse: response,
    generation: {
      model: response.model,
      responseId: response.id,
      ...(usage ? { usage } : {})
    }
  };
}

/** Configured OpenAI implementation of the shared chat adapter contract. */
export const openAIAdapter: ChatAdapter = {
  id: 'openai-responses',
  generateReply: generateOpenAIReply,
  requestTimeoutMs: readRequestTimeoutMs
};
