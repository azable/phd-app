/** Mode-neutral visualization presentation and preference event contracts. */

import * as v from 'valibot';

import { presentationIdSchema, renderablePresentationSchema } from '$lib/shared/presentations';

import { eventEnvelope, naturalSchema } from './values';

/** Runtime schema for one visualization becoming visible in a display set. */
export const visualizationPresentedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('visualization.presented'),
  payload: v.object({
    displaySetId: v.pipe(v.string(), v.uuid()),
    slot: v.picklist([0, 1]),
    presentation: renderablePresentationSchema,
    /**
     * The question the assistant's comparison asks of this display set's pair, which a preference
     * between them answers (it names the display set).
     */
    question: v.optional(v.string())
  })
});

/** Runtime schema for a preference between two compatible presentations. */
export const visualizationPreferenceRecordedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('visualization.preference-recorded'),
  payload: v.object({
    displaySetId: v.optional(v.pipe(v.string(), v.uuid())),
    presentations: v.tuple([presentationIdSchema, presentationIdSchema]),
    preferred: presentationIdSchema,
    step: naturalSchema
  })
});
