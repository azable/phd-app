/** Participant-intake event contracts. */

import * as v from 'valibot';

import { eventEnvelope, positiveSchema } from './values';

/** Stable identifiers for the participant-intake questions. */
export const participantIntakeStepSchema = v.picklist(['algorithm']);

export type ParticipantIntakeStepId = v.InferOutput<typeof participantIntakeStepSchema>;

/** Runtime schema recording that a blank project's intake gate has ended. */
export const assistantIntakeCompletedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('assistant.intake-completed'),
  payload: v.object({
    interactionEventId: positiveSchema,
    outcome: v.picklist(['answered', 'waived'])
  })
});
