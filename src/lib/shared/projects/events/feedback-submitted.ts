/** User-feedback event contract. */

import * as v from 'valibot';

import { presentationIdSchema, stepNameSchema } from '$lib/shared/presentations';

import { messageContentSchema } from './message-content';
import { eventEnvelope, naturalSchema, positiveSchema } from './values';

/** A presentation on screen, at the step it showed, from 0, named as the presentation names it. */
export const viewedPresentationSchema = v.strictObject({
  presentationId: presentationIdSchema,
  step: v.optional(v.pipe(naturalSchema, v.maxValue(100_000))),
  stepName: v.optional(stepNameSchema)
});

/**
 * What was on screen when a message was sent, recorded beside it rather than said in it: the
 * presentation viewed or the pair compared, or a source chosen on its own, by its hash's start.
 */
export const feedbackViewingSchema = v.union([
  v.strictObject({
    presentations: v.pipe(v.array(viewedPresentationSchema), v.minLength(1), v.maxLength(2))
  }),
  v.strictObject({ source: v.pipe(v.string(), v.regex(/^[0-9a-f]{6,64}$/u)) })
]);

export type ViewedPresentation = v.InferOutput<typeof viewedPresentationSchema>;
export type FeedbackViewing = v.InferOutput<typeof feedbackViewingSchema>;

/** Runtime schema for user feedback and its optional visual focus. */
export const feedbackSubmittedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('feedback.submitted'),
  payload: v.object({
    content: messageContentSchema,
    focus: v.array(positiveSchema),
    presentationCount: v.optional(v.picklist([1, 2])),
    /** The presentation whose variant the turn builds on. */
    from: v.optional(presentationIdSchema),
    viewing: v.optional(feedbackViewingSchema),
    /** The assistant's response whose question this message answers, the one open when sent. */
    answers: v.optional(positiveSchema)
  })
});
