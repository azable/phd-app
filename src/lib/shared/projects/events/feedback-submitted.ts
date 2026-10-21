/** User-feedback event contract. */

import * as v from 'valibot';

import { presentationIdSchema } from '$lib/shared/presentations';

import { messageContentSchema } from './message-content';
import { eventEnvelope, positiveSchema } from './values';

/** Runtime schema for user feedback and its optional visual focus. */
export const feedbackSubmittedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('feedback.submitted'),
  payload: v.object({
    content: messageContentSchema,
    focus: v.array(positiveSchema),
    presentationCount: v.optional(v.picklist([1, 2])),
    /** The presentation the participant was viewing, whose variant the turn builds on. */
    viewing: v.optional(presentationIdSchema)
  })
});
