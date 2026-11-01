/** Assistant-response event contract. */

import * as v from 'valibot';

import { messageContentSchema } from './message-content';
import { participantIntakeStepSchema } from './assistant-intake';
import { eventEnvelope, positiveSchema } from './values';

/** The most suggestions one reply carries: one per open question, so a dozen is already plenty. */
export const maximumSuggestions = 12;

/** One comparison worth making, as a short phrase the participant can send as their message. */
export const suggestionSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120));

/** Runtime schema for an assistant's user-facing response. */
export const assistantRespondedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('assistant.responded'),
  payload: v.object({
    content: messageContentSchema,
    inReplyTo: v.optional(v.array(positiveSchema)),
    intakeStep: v.optional(participantIntakeStepSchema),
    /** Comparisons worth making next, most useful first. */
    suggestions: v.optional(
      v.pipe(v.array(suggestionSchema), v.minLength(1), v.maxLength(maximumSuggestions))
    )
  })
});
