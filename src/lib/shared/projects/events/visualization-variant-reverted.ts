/**
 * A presentation that failed as it drew, where the same source draws with the values it was made
 * from: the failure was its variant's, so the presentations shown with it are taken out and shown
 * again with those values instead, and nothing asks the assistant to change the source.
 */

import * as v from 'valibot';

import { designValuesSchema, presentationIdSchema } from '$lib/shared/presentations';

import { eventEnvelope } from './values';

export const visualizationVariantRevertedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('visualization.variant-reverted'),
  payload: v.object({
    /** The presentation that failed. */
    presentationId: presentationIdSchema,
    /** Its values that the presentation shown instead does not have. */
    values: designValuesSchema,
    /** What those variables are in the presentation shown instead. */
    shown: designValuesSchema,
    /** The presentations taken out: the one that failed and any shown beside it. */
    presentations: v.pipe(v.array(presentationIdSchema), v.minLength(1), v.maxLength(2)),
    /** The presentations shown instead, in the same order. */
    replacements: v.pipe(v.array(presentationIdSchema), v.minLength(1), v.maxLength(2))
  })
});
