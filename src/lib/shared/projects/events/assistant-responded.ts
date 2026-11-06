/** Assistant-response event contract. */

import * as v from 'valibot';

import { presentationIdSchema } from '$lib/shared/presentations';

import { briefEntrySchema } from '../brief';
import { elementIdSchema, messageContentSchema } from './message-content';
import { participantIntakeStepSchema } from './assistant-intake';
import { eventEnvelope, positiveSchema } from './values';

/** The most characters of a question the assistant asks: the decision allows as many (ai/decisions/source-decisions.ts), so a long question is never refused once decided. */
export const maximumQuestionText = 400;

const questionSchema = v.object({
  text: v.pipe(v.string(), v.minLength(1), v.maxLength(maximumQuestionText)),
  presentationId: v.optional(presentationIdSchema),
  elements: v.optional(v.pipe(v.array(elementIdSchema), v.maxLength(8)))
});

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
     * words, or about a presentation, one shown before or the first its decision presented, with
     * elements in it to highlight.
     */
    question: v.optional(questionSchema),
    /**
     * A question asked with comparisons, held back so it is read after them: a reply of its own
     * asks it (releases) once the last of them is answered, or the participant writes first.
     */
    heldQuestion: v.optional(questionSchema),
    /** The reply whose held question this one asks, made with no model call. */
    releases: v.optional(positiveSchema),
    /** Attributes of the design brief its decision set (see shared/projects/brief.ts). */
    brief: v.optional(v.array(briefEntrySchema))
  })
});
