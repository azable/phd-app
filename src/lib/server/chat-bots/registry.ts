/** Provider assembly for mode-owned assistants and the shared intake classifier. */

import { openAIAdapter } from '$lib/server/chat-adapters/openai';
import { InvalidChatbotResponseError, type ChatAdapter } from '$lib/server/chat-adapters/types';
import { assistantMode, type AssistantId } from '$lib/shared/assistants';
import type { ParticipantIntakeStepId } from '$lib/shared/projects/events';
import { modeCatalog } from '$lib/modes/catalog';
import sverlinChooser, {
  type ChooserOutput,
  type ChooserProject
} from '$lib/modes/sverlin/chooser.server';

import {
  participantIntakeClassifier,
  type ParticipantIntakeClassifierOutput
} from './participant-intake';
import type { AiProjectContext } from './project-context';
import type {
  CandidateAssistantOutput,
  ChatBotConfig,
  Chatbot,
  ChatbotRequest,
  SourceArtifactChatOutput
} from './types';

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
    return {
      messages: request.messages,
      initialPrompt: config.initialPrompt,
      context: await config.buildContext({ ...request, attempt }),
      attempt,
      parameters: profile.parameters,
      responseFormat: config.responseFormat
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
const modules = import.meta.glob<{ default: ChatBotConfig<AiProjectContext, ModeOutput> }>(
  '../../modes/*/bot.server.ts',
  { eager: true }
);
const modeChatbots = Object.fromEntries(
  Object.keys(modeCatalog).map((mode) => {
    const config = modules[`../../modes/${mode}/bot.server.ts`]?.default;
    if (!config || config.id !== modeCatalog[mode as keyof typeof modeCatalog].assistantId)
      throw new Error(`Visualization mode ${mode} needs its own matching assistant.`);
    return [mode, createChatbot(config, openAIAdapter)];
  })
) as Record<keyof typeof modeCatalog, Chatbot<AiProjectContext, ModeOutput>>;

const intakeClassifier = createChatbot(participantIntakeClassifier, openAIAdapter);
const chooser = createChatbot(sverlinChooser, openAIAdapter);

/** Return the bot that chooses the variants a Sverlin source's presentations are built with. */
export function getSverlinChooser(): Chatbot<ChooserProject, ChooserOutput> {
  return chooser;
}

/** Return the source-authoring bot recorded by a Sverlin project. */
export function getChatbot(
  assistantId: AssistantId
): Chatbot<AiProjectContext, SourceArtifactChatOutput> {
  const mode = assistantMode(assistantId);
  if (modeCatalog[mode].authoring !== 'source')
    throw new Error(`Unknown Sverlin assistant: ${assistantId}`);
  return modeChatbots[mode] as Chatbot<AiProjectContext, SourceArtifactChatOutput>;
}

/** Return the candidate-authoring bot recorded by a direct-artifact mode. */
export function getCandidateChatbot(
  assistantId: AssistantId
): Chatbot<AiProjectContext, CandidateAssistantOutput> {
  const mode = assistantMode(assistantId);
  if (modeCatalog[mode].authoring !== 'candidates')
    throw new Error(`Unknown candidate assistant: ${assistantId}`);
  return modeChatbots[mode] as Chatbot<AiProjectContext, CandidateAssistantOutput>;
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
  const bot = modeChatbots[assistantMode(assistantId)];
  const first = bot.config.participantIntake[0];
  return { botId: bot.id, text: first.question, step: first.id };
}
