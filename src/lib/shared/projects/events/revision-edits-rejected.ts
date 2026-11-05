/** The record of an assistant's edits that could not be placed in the source they revise. */

import * as v from 'valibot';

import { eventEnvelope, positiveSchema } from './values';

/**
 * Edits a generation returned that were not applied, and why: each one whose find text did not
 * occur exactly once; or, as `rejected` says, a vary's comparisons that could not be built as given,
 * a built picture too large to read (see shared/readability.ts), a built picture with warnings, or one offering alternatives no comparison showed,
 * as a step drawing what the step before drew.
 * Nothing was built from them and the next attempt, if any, repairs them; or, where `kept` is
 * given, the source was built with only the comparisons it names, or alone where it names none.
 */
export const revisionEditsRejectedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('revision.edits-rejected'),
  payload: v.object({
    attempt: positiveSchema,
    /** The generation whose edits these were. */
    generationEventId: v.optional(positiveSchema),
    /**
     * What was rejected: the comparisons, the picture, its warnings, a picture offering alternatives
     * no comparison showed, or the edits where absent.
     */
    rejected: v.optional(
      v.picklist(['comparisons', 'picture', 'warnings', 'alternatives', 'helpers'])
    ),
    problems: v.pipe(v.array(v.string()), v.minLength(1)),
    /**
     * The comparisons, by number from 1, built without those rejected; none where the source was
     * shown alone.
     */
    kept: v.optional(v.array(positiveSchema))
  })
});
