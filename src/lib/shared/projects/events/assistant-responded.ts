/** Assistant-response event contract. */

import * as v from 'valibot';

import { messageContentSchema } from './message-content';
import { participantIntakeStepSchema } from './assistant-intake';
import { eventEnvelope, positiveSchema } from './values';

/** Runtime schema for an assistant's user-facing response. */
export const assistantRespondedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('assistant.responded'),
  payload: v.object({
    content: messageContentSchema,
    inReplyTo: v.optional(v.array(positiveSchema)),
    intakeStep: v.optional(participantIntakeStepSchema)
  })
});
