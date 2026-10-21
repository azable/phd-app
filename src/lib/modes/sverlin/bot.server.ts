/** Primary single-component Svelte visualization assistant. */

import {
  generatedMessageContentSchema,
  parseRecoveryExplanation,
  recoveryExplanationJsonSchema,
  retainedMessageContentJsonSchema,
  type ChatBotConfig
} from '$lib/server/chat-bots/types';
import { visualizationAttemptProfiles } from '$lib/server/chat-bots/attempt-profiles';
import {
  sourceDecisionJsonSchema,
  sourceDecisionSchema
} from '$lib/server/chat-bots/source-decisions';
import { visualizationParticipantIntake } from '$lib/server/chat-bots/participant-intake';
import * as v from 'valibot';
import type { AiProjectContext } from '$lib/server/chat-bots/project-context';

import assistant from './assistant.md?raw';
import guide from './README.md?raw';
import { recordedTrace } from './compile.server';

/** Prompt text from a Markdown file: its HTML comments are notes for maintainers. */
const promptText = (markdown: string) => markdown.replace(/<!--[\s\S]*?-->\s*/gu, '').trim();
const instructions = promptText(assistant);
export const languageGuide = promptText(guide);

/**
 * At most this much of the recorded steps, as JSON, goes into the assistant's context: about 5,000
 * tokens, a fraction of the guide it is sent with, and enough for the small inputs examples use.
 */
const maximumTraceCharacters = 20_000;

/**
 * The steps a source's algorithm records, for the assistant to check what its algorithm does and
 * to name what a step shows: each step's variables in scope, as many steps as fit, or why there
 * are none.
 */
export function recordedSteps(source: string): Record<string, unknown> {
  let trace;
  try {
    trace = recordedTrace(source);
  } catch (cause) {
    return { problem: cause instanceof Error ? cause.message : String(cause) };
  }
  const steps: { step: number; state: unknown }[] = [];
  let length = 0;
  for (const [index, { state }] of trace.entries()) {
    const entry = { step: index + 1, state };
    length += JSON.stringify(entry).length;
    if (length > maximumTraceCharacters) break;
    steps.push(entry);
  }
  return {
    steps,
    ...(steps.length < trace.length ? { omittedSteps: trace.length - steps.length } : {})
  };
}

/** Primary visualization-authoring chatbot definition. */
export default {
  id: 'sverlin-assistant',
  participantIntake: visualizationParticipantIntake,
  initialPrompt: [instructions, languageGuide].join('\n\n'),
  buildContext: ({ project, attempt, buildFeedback }) => {
    // A repair reads the steps of the candidate that failed; otherwise those of the current source.
    const { entryArtifactId, artifacts } = project.base;
    const source =
      buildFeedback?.failedSource ??
      artifacts.find(({ artifactId }) => artifactId === entryArtifactId)?.source;
    return {
      project,
      attemptContext: attempt,
      ...(buildFeedback ? { buildFeedback } : {}),
      ...(source ? { recordedSteps: recordedSteps(source) } : {})
    };
  },
  attemptProfiles: visualizationAttemptProfiles(12000),
  responseFormat: {
    name: 'chat_result',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reply: retainedMessageContentJsonSchema,
        decision: sourceDecisionJsonSchema,
        recovery: recoveryExplanationJsonSchema
      },
      required: ['reply', 'decision', 'recovery']
    }
  },
  parseOutput(value) {
    const output = value as { reply?: unknown; decision?: unknown; recovery?: unknown };
    const decision = v.safeParse(sourceDecisionSchema, output?.decision);
    if (!decision.success) throw new Error('The chatbot returned an invalid structured response.');
    const recovery = parseRecoveryExplanation(output.recovery);
    return {
      reply: v.parse(generatedMessageContentSchema, output.reply),
      decision: decision.output,
      ...(recovery ? { recovery } : {})
    };
  }
} satisfies ChatBotConfig<AiProjectContext>;
