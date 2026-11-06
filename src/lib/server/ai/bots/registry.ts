/** Provider assembly for mode-owned assistants and the shared intake classifier. */

import { openAIAdapter } from '$lib/server/ai/providers/openai';
import { InvalidChatbotResponseError, type ChatAdapter } from '$lib/server/ai/providers/types';
import { assistantMode, type AssistantId } from '$lib/shared/assistants';
import type { ParticipantIntakeStepId } from '$lib/shared/projects/events';
import { modeAssistants } from '$lib/modes/assistants.server';
import { modeCatalog } from '$lib/modes/catalog';

import {
  participantIntakeClassifier,
  type ParticipantIntakeClassifierOutput
} from '$lib/server/ai/bots/participant-intake';
import type { AiProjectContext } from '$lib/server/ai/context/project-context';
import { steppedUpParameters } from '$lib/server/ai/bots/attempt-profiles';
import { helperPipeline } from '$lib/server/ai/bots/helper-pipeline';
import { currentEscalation } from '$lib/server/ai/turns/struggle';
import type {
  CandidateAssistantOutput,
  ChatBotConfig,
  Chatbot,
  ChatbotRequest,
  SourceArtifactChatOutput
} from '$lib/server/ai/bots/types';

/** Combine a bot definition with a provider adapter into an executable chatbot. */
export function createChatbot<Project, Output extends object>(
  config: ChatBotConfig<Project, Output>,
  adapter: ChatAdapter
): Chatbot<Project, Output> {
  const preparePrompt = async (request: ChatbotRequest<Project>) => {
    const profile = config.attemptProfiles[request.attempt - 1];
    if (!Number.isSafeInteger(request.attempt) || request.attempt < 1 || !profile)
      throw new Error(`Chatbot attempt ${request.attempt} is outside the configured ladder.`);
    const attempt = { number: request.attempt, purpose: profile.purpose };
    const parameters =
      request.turn === 'feedback' && profile.feedbackParameters
        ? { ...profile.parameters, ...profile.feedbackParameters }
        : profile.parameters;
    // A visualization turn's first call steps up where the participant seems to be struggling
    // (ai/turns/struggle.ts); the intake classifier and the repairs never do.
    const escalation =
      request.attempt === 1 && profile.purpose === 'initial' ? currentEscalation() : undefined;
    return {
      messages: request.messages,
      initialPrompt: config.initialPrompt,
      context: await config.buildContext({ ...request, attempt }),
      attempt,
      parameters: escalation
        ? {
            ...parameters,
            ...(escalation === 'designing' ? helperPipeline.designing : steppedUpParameters)
          }
        : parameters,
      responseFormat: config.responseFormatFor?.(request) ?? config.responseFormat,
      ...(escalation ? { escalation } : {})
    };
  };
  const generatePrepared = async (
    prompt: Awaited<ReturnType<typeof preparePrompt>>,
    options?: { signal?: AbortSignal }
  ) => {
    const result = await adapter.generateReply({ ...prompt, signal: options?.signal });
    let output: Output;
    try {
      output = config.parseOutput(result.output);
    } catch (cause) {
      throw new InvalidChatbotResponseError(
        cause instanceof Error ? cause.message : 'The chatbot returned an invalid response.',
        result.providerResponse
      );
    }
    return {
      ...output,
      providerResponse: result.providerResponse,
      prompt,
      generation: { botId: config.id, adapterId: adapter.id, ...result.generation }
    };
  };
  return {
    id: config.id,
    config,
    preparePrompt,
    generatePrepared,
    requestTimeoutMs: () => adapter.requestTimeoutMs?.() ?? 0
  } satisfies Chatbot<Project, Output>;
}

type ModeOutput = SourceArtifactChatOutput | CandidateAssistantOutput;
// Made on first use: the modes' assistant modules import the turns, which import this module, so
// the assistants registry is not yet loaded when this one is.
let chatbots: Record<keyof typeof modeCatalog, Chatbot<AiProjectContext, ModeOutput>> | undefined;
const modeChatbots = () =>
  (chatbots ??= Object.fromEntries(
    Object.entries(modeAssistants).map(([mode, { default: config }]) => [
      mode,
      createChatbot(config, openAIAdapter)
    ])
  ) as Record<keyof typeof modeCatalog, Chatbot<AiProjectContext, ModeOutput>>);

const intakeClassifier = createChatbot(participantIntakeClassifier, openAIAdapter);
/** Return the source-authoring bot recorded by a Sverlin project. */
export function getChatbot(
  assistantId: AssistantId
): Chatbot<AiProjectContext, SourceArtifactChatOutput> {
  const mode = assistantMode(assistantId);
  if (modeCatalog[mode].authoring !== 'source')
    throw new Error(`Unknown source-authoring assistant: ${assistantId}`);
  return modeChatbots()[mode] as Chatbot<AiProjectContext, SourceArtifactChatOutput>;
}

/** Return the candidate-authoring bot recorded by a direct-artifact mode. */
export function getCandidateChatbot(
  assistantId: AssistantId
): Chatbot<AiProjectContext, CandidateAssistantOutput> {
  const mode = assistantMode(assistantId);
  if (modeCatalog[mode].authoring !== 'candidates')
    throw new Error(`Unknown candidate assistant: ${assistantId}`);
  return modeChatbots()[mode] as Chatbot<AiProjectContext, CandidateAssistantOutput>;
}

export function getParticipantIntakeClassifier(): Chatbot<
  Record<string, never>,
  ParticipantIntakeClassifierOutput
> {
  return intakeClassifier;
}

export function assistantIntroduction(assistantId: AssistantId): {
  botId: string;
  text: string;
  step: ParticipantIntakeStepId;
} {
  const bot = modeChatbots()[assistantMode(assistantId)];
  const first = bot.config.participantIntake[0];
  return { botId: bot.id, text: first.question, step: first.id };
}
