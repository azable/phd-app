/**
 * OpenAI Responses API implementation of the provider-neutral chat adapter.
 *
 * @packageDocumentation
 */

import OpenAI from 'openai';

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

function readApiKey() {
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

function readRequestTimeoutMs(): number {
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
      input: [
        {
          role: 'developer',
          content: `${request.initialPrompt}\n\nContext provided by this chat configuration:\n\n${context}`
        },
        ...request.messages
      ],
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

  return {
    ...parseResult(response.output_text, response),
    providerResponse: response,
    generation: {
      model: response.model,
      responseId: response.id,
      ...(response.usage
        ? {
            usage: {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
              totalTokens: response.usage.total_tokens
            }
          }
        : {})
    }
  };
}

/** Configured OpenAI implementation of the shared chat adapter contract. */
export const openAIAdapter: ChatAdapter = {
  id: 'openai-responses',
  generateReply: generateOpenAIReply,
  requestTimeoutMs: readRequestTimeoutMs
};
