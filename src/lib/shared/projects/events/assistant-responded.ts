/** Assistant-response event contract. */

import * as v from 'valibot';

import { presentationIdSchema } from '$lib/shared/presentations';

import { briefEntrySchema } from '../brief';
import { elementIdSchema, messageContentSchema } from './message-content';
import { participantIntakeStepSchema } from './assistant-intake';
import { eventEnvelope, positiveSchema } from './values';

/** Runtime schema for an assistant's user-facing response. */
export const assistantRespondedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('assistant.responded'),
  payload: v.object({
    content: messageContentSchema,
    inReplyTo: v.optional(v.array(positiveSchema)),
    intakeStep: v.optional(participantIntakeStepSchema),
    /**
     * A question for the participant to answer in the chat (see shared/projects/questions.ts): in
     * words, or about a presentation, one shown before or, as example, the first this operation
     * presents next, with elements in it to highlight.
     */
    question: v.optional(
      v.object({
        text: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
        presentationId: v.optional(presentationIdSchema),
        example: v.optional(v.literal(true)),
        elements: v.optional(v.pipe(v.array(elementIdSchema), v.maxLength(8)))
      })
    ),
    /** Attributes of the design brief its decision set (see shared/projects/brief.ts). */
    brief: v.optional(v.array(briefEntrySchema))
  })
});
