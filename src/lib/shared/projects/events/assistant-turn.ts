/** Durable request and claim boundaries for background assistant turns. */

import * as v from 'valibot';

import { eventEnvelope, positiveSchema } from './values';

/** An interaction that should be considered by the next available assistant turn. */
export const assistantTurnRequestedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('assistant.turn-requested'),
  payload: v.object({
    interactionEventId: positiveSchema,
    presentationCount: v.picklist([1, 2]),
    deadlineAt: v.optional(v.pipe(v.string(), v.isoTimestamp()))
  })
});

/** The exact queued requests atomically claimed by one background assistant operation. */
export const assistantTurnStartedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('assistant.turn-started'),
  payload: v.object({
    requestEventIds: v.pipe(v.array(positiveSchema), v.minLength(1)),
    interactionEventIds: v.pipe(v.array(positiveSchema), v.minLength(1)),
    /** Whether the view helpers were on for this turn; absent before they existed, as off. */
    viewHelpers: v.optional(v.boolean()),
    /** How many helpers its view and layout rounds run, where they are on. */
    helperCounts: v.optional(
      v.object({
        views: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10)),
        layouts: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10))
      })
    )
  })
});
