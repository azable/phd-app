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
    viewHelpers: v.optional(v.boolean())
  })
});
