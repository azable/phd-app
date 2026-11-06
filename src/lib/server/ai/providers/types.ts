/**
 * Provider-neutral interfaces implemented by chat API adapters.
 *
 * @packageDocumentation
 */

import type {
  ChatContext,
  ChatBotParameters,
  ConversationMessage,
  ChatResponseFormat
} from '$lib/server/ai/bots/types';

/** Fully prepared request accepted by a provider adapter. */
export type ChatAdapterRequest = {
  messages: ConversationMessage[];
  initialPrompt: string;
  context: ChatContext;
  parameters: ChatBotParameters;
  responseFormat: ChatResponseFormat;
  signal?: AbortSignal;
};

/** Provider-neutral result returned after structured response parsing. */
export type ChatAdapterResult = {
  output: unknown;
  providerResponse?: unknown;
  generation?: {
    model?: string;
    responseId?: string;
    usage?: Record<string, number>;
  };
};

/** Adapter capable of generating one structured chatbot response. */
export interface ChatAdapter {
  /** Stable adapter identifier recorded in project history. */
  readonly id: string;
  /** Submit a prepared request and normalize the provider response. */
  generateReply(request: ChatAdapterRequest): Promise<ChatAdapterResult>;
  /** Current request ceiling, used by study orchestration before another attempt starts. */
  requestTimeoutMs?(): number;
}

/** Raised when a provider response does not satisfy a bot's output contract. */
export class InvalidChatbotResponseError extends Error {
  readonly providerResponse?: unknown;
  /** The tokens the response spent, where the provider reported them. */
  usage?: Record<string, number>;

  constructor(
    message = 'The chatbot returned an invalid structured response.',
    providerResponse?: unknown
  ) {
    super(message);
    this.name = 'InvalidChatbotResponseError';
    this.providerResponse = providerResponse;
  }
}
