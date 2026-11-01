/**
 * Provider-independent chatbot configuration and execution contracts.
 *
 * @packageDocumentation
 */

import type { ParticipantIntakeStepId } from '$lib/shared/projects/events';
import type { BuildDiagnostic } from '$lib/shared/projects/events/values';
import * as v from 'valibot';

import { interfacePartIds } from '$lib/shared/interface-parts';
import { presentationIdSchema } from '$lib/shared/presentations';
import { textSchema } from '$lib/shared/projects/events/values';

import type { SourceDecision } from './source-decisions';
import type { BriefEntry } from '$lib/shared/projects/brief';

/** User or assistant message retained as conversational context. */
export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

/** Model-authored reply segment before generated candidate slots have stable IDs. */
export const generatedMessageSegmentSchema = v.variant('type', [
  v.strictObject({ type: v.literal('markdown'), text: textSchema }),
  v.strictObject({ type: v.literal('presentation-ref'), presentationId: presentationIdSchema }),
  v.strictObject({ type: v.literal('candidate-ref'), slot: v.picklist([0, 1]) }),
  // Any part's id; one the system's interface lacks is shown as the part's name.
  v.strictObject({ type: v.literal('interface-ref'), part: v.picklist(interfacePartIds) })
]);

export const generatedMessageContentSchema = v.pipe(
  v.array(generatedMessageSegmentSchema),
  v.minLength(1)
);

export type GeneratedMessageContent = v.InferOutput<typeof generatedMessageContentSchema>;

/** Plain-language account of a successful simplification fallback. */
export type RecoveryExplanation = {
  struggledWith: string;
  simplified: string;
};

const recoveryExplanationSchema = v.strictObject({
  struggledWith: textSchema,
  simplified: textSchema
});

/** Parse the nullable recovery field shared by strict chatbot responses. */
export function parseRecoveryExplanation(value: unknown): RecoveryExplanation | undefined {
  return value === null || value === undefined
    ? undefined
    : v.parse(recoveryExplanationSchema, value);
}

/** JSON Schema shared by agent outputs that can report graceful degradation. */
export const recoveryExplanationJsonSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        struggledWith: { type: 'string', minLength: 1, pattern: '\\S' },
        simplified: { type: 'string', minLength: 1, pattern: '\\S' }
      },
      required: ['struggledWith', 'simplified']
    },
    { type: 'null' }
  ]
} as const;

/** JSON Schema embedded in both assistant response contracts. */
export const generatedMessageContentJsonSchema = {
  type: 'array',
  minItems: 1,
  items: {
    anyOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['markdown'] },
          text: { type: 'string', minLength: 1 }
        },
        required: ['type', 'text']
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['presentation-ref'] },
          presentationId: { type: 'string', format: 'uuid' }
        },
        required: ['type', 'presentationId']
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['candidate-ref'] },
          slot: { type: 'integer', enum: [0, 1] }
        },
        required: ['type', 'slot']
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['interface-ref'] },
          part: { type: 'string', enum: [...interfacePartIds] }
        },
        required: ['type', 'part']
      }
    ]
  }
} as const;

/** Failed generated source and diagnostics supplied to one repair attempt. */
export type BuildFeedback = {
  attempt: number;
  buildEventId: number;
  failedSource: string;
  assistantReply: string;
  diagnostics: BuildDiagnostic[];
  priorFailureSummaries: string[];
};

/** Role of one bounded generation profile in an agent's attempt ladder. */
export type ChatAttemptPurpose = 'intake' | 'initial' | 'repair' | 'fallback' | 'choosing';

/** Recordable identity of the profile selected for one generation request. */
export type ChatAttempt = {
  number: number;
  purpose: ChatAttemptPurpose;
};

/** Inputs from which a bot definition builds provider context. */
export type ChatContextInput<Project> = {
  messages: ConversationMessage[];
  project: Project;
  attempt: ChatAttempt;
  buildFeedback?: BuildFeedback;
};

/** Provider-neutral context assembled by a chat bot definition. */
export type ChatContext = Record<string, unknown>;

/** Model and sampling parameters selected by a chatbot definition. */
export type ChatBotParameters = {
  model: string;
  maxOutputTokens?: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  temperature?: number;
};

/** One explicitly bounded model/reasoning stage owned by an agent definition. */
export type ChatBotAttemptProfile = {
  purpose: ChatAttemptPurpose;
  parameters: ChatBotParameters;
  /** What a feedback turn changes in the parameters (see ChatTurn). */
  feedbackParameters?: Partial<ChatBotParameters>;
};

/**
 * What a turn is known to ask before the model decides: a first source, or a fix of a view that
 * failed to draw, is authoring; feedback on a source already drawn is feedback, which mostly edits,
 * varies, compares, or replies, and so may take lighter parameters.
 */
export type ChatTurn = 'authoring' | 'feedback';

/** JSON Schema response contract requested from a provider. */
export type ChatResponseFormat = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

/**
 * What an assistant that authors a source returns: its reply, its decision (see source-decisions.ts),
 * and the attributes of the design brief it set.
 */
export type SourceArtifactChatOutput = {
  reply: GeneratedMessageContent;
  decision: SourceDecision;
  brief?: BriefEntry[];
  recovery?: RecoveryExplanation;
};

/** Candidate-based modes share one orchestration shape; each mode validates its own manifest. */
export type CandidateAssistantOutput = {
  reply: GeneratedMessageContent;
  candidates: Array<{ label: string; manifest: unknown }>;
  recovery?: RecoveryExplanation;
};

export type ChatBotConfig<Project, Output extends object = SourceArtifactChatOutput> = {
  id: string;
  participantIntake: readonly [
    { id: ParticipantIntakeStepId; question: string },
    ...Array<{ id: ParticipantIntakeStepId; question: string }>
  ];
  initialPrompt: string;
  buildContext: (input: ChatContextInput<Project>) => ChatContext | Promise<ChatContext>;
  attemptProfiles: readonly [ChatBotAttemptProfile, ...ChatBotAttemptProfile[]];
  responseFormat: ChatResponseFormat;
  parseOutput: (value: unknown) => Output;
};

/** Complete provider-neutral prompt prepared for an adapter. */
export type ChatbotPrompt = {
  initialPrompt: string;
  messages: ConversationMessage[];
  context: ChatContext;
  attempt: ChatAttempt;
  parameters: ChatBotParameters;
  responseFormat: ChatResponseFormat;
};

/** Project conversation inputs accepted by a configured chatbot. */
export type ChatbotRequest<Project> = {
  messages: ConversationMessage[];
  project: Project;
  attempt: number;
  turn?: ChatTurn;
  buildFeedback?: BuildFeedback;
};

/** Parsed chatbot output enriched with prompt and generation provenance. */
export type ChatbotResult<Output extends object = SourceArtifactChatOutput> = Output & {
  providerResponse?: unknown;
  prompt: ChatbotPrompt;
  generation: {
    botId: string;
    adapterId: string;
    model?: string;
    responseId?: string;
    usage?: Record<string, number>;
  };
};

/** Adapter contracts re-exported for chatbot consumers. */
export type { ChatAdapter, ChatAdapterResult } from '$lib/server/chat-adapters/types';

/** Executable chatbot assembled from a bot configuration and provider adapter. */
export interface Chatbot<Project, Output extends object = SourceArtifactChatOutput> {
  /** Stable bot identifier recorded in project events. */
  readonly id: string;
  /** Static configuration used by this bot. */
  readonly config: ChatBotConfig<Project, Output>;
  /** Assemble a provider-neutral prompt from project inputs. */
  preparePrompt(request: ChatbotRequest<Project>): Promise<ChatbotPrompt>;
  /** Generate a response from an already prepared, recordable prompt. */
  generatePrepared(
    prompt: ChatbotPrompt,
    options?: { signal?: AbortSignal }
  ): Promise<ChatbotResult<Output>>;
  /** Provider request ceiling used to decide whether another study attempt can start. */
  requestTimeoutMs(): number;
}
