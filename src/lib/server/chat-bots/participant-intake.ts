/** Shared blank-project intake and its narrow exceptional-exit classifier. */

import * as v from 'valibot';

import { briefAttribute, intakeKeys } from '$lib/shared/projects/brief';
import type { ParticipantIntakeStepId } from '$lib/shared/projects/events';

import type { ChatBotConfig } from './types';

export type ParticipantIntakeStep = {
  id: ParticipantIntakeStepId;
  question: string;
};

/**
 * The participant-facing intake shared by visualization modes: the brief's first attributes, whose
 * answers the brief records as confirmed (see shared/projects/brief.ts).
 */
export const visualizationParticipantIntake = intakeKeys.map((key) => ({
  id: key,
  question: briefAttribute(key).question
})) as [ParticipantIntakeStep, ...ParticipantIntakeStep[]];

export type ParticipantIntakeClassifierOutput = { decision: 'continue' | 'exit' };

/** Low-cost classification used only to recognize an explicit request to leave intake early. */
export const participantIntakeClassifier = {
  id: 'participant-intake-classifier',
  participantIntake: visualizationParticipantIntake,
  initialPrompt:
    'Classify whether the participant explicitly wants to stop the visualization intake and proceed now. Return exit only for an explicit refusal, an explicit request to skip the remaining questions, a direct demand to start authoring immediately, or a substantial redirection away from answering the intake. Return continue for an answer, a partial answer, uncertainty, ordinary extra context, or an unrelated aside. Do not infer a desire to skip.',
  buildContext: ({ attempt }) => ({ attemptContext: attempt }),
  attemptProfiles: [
    {
      purpose: 'intake',
      // 200 tokens comfortably covers the two-value schema while bounding intake latency and cost.
      parameters: { model: 'gpt-5.6-luna', reasoningEffort: 'low', maxOutputTokens: 200 }
    }
  ],
  responseFormat: {
    name: 'participant_intake_decision',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { decision: { type: 'string', enum: ['continue', 'exit'] } },
      required: ['decision']
    }
  },
  parseOutput: (value) =>
    v.parse(v.strictObject({ decision: v.picklist(['continue', 'exit']) }), value)
} satisfies ChatBotConfig<Record<string, never>, ParticipantIntakeClassifierOutput>;

export function participantIntakeStep(id: ParticipantIntakeStepId): ParticipantIntakeStep {
  const step = visualizationParticipantIntake.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`Unknown participant intake step: ${id}`);
  return step;
}

export function nextParticipantIntakeStep(
  id: ParticipantIntakeStepId
): ParticipantIntakeStep | undefined {
  const index = visualizationParticipantIntake.findIndex((candidate) => candidate.id === id);
  return visualizationParticipantIntake[index + 1];
}
