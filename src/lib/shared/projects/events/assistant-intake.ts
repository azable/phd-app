/** Participant-intake event contracts. */

import * as v from 'valibot';

import { intakeKeys } from '../brief';
import { eventEnvelope, positiveSchema } from './values';

/** Intake's questions: the brief's first attributes (see shared/projects/brief.ts). */
export const participantIntakeStepSchema = v.picklist(intakeKeys);

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
