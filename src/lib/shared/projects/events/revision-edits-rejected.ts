/** The record of an assistant's edits that could not be placed in the source they revise. */

import * as v from 'valibot';

import { eventEnvelope, positiveSchema } from './values';

/**
 * Edits a generation returned that were not applied, and why: each one whose find text did not
 * occur exactly once; or, as `rejected` says, a vary's comparisons that could not be built as given.
 * Nothing was built from them; the next attempt, if any, repairs them.
 */
export const revisionEditsRejectedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('revision.edits-rejected'),
  payload: v.object({
    attempt: positiveSchema,
    /** The generation whose edits these were. */
    generationEventId: v.optional(positiveSchema),
    /** What was rejected: the comparisons, or the edits where absent. */
    rejected: v.optional(v.literal('comparisons')),
    problems: v.pipe(v.array(v.string()), v.minLength(1))
  })
});
