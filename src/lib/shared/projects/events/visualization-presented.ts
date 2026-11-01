/** Mode-neutral visualization presentation and preference event contracts. */

import * as v from 'valibot';

import { presentationIdSchema, renderablePresentationSchema } from '$lib/shared/presentations';

import { briefKeys } from '../brief';
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
    question: v.optional(v.string()),
    /** With a question, what the participant would call this side of the pair, as “tallies”. */
    label: v.optional(v.string()),
    /**
     * With a question, the brief attribute the pair asks by showing and the tag this side stands
     * for, as tone restrained: preferring this side sets it (see shared/projects/brief.ts).
     */
    brief: v.optional(v.object({ key: v.picklist(briefKeys), tag: v.string() }))
  })
});

const comparisonAnswer = {
  displaySetId: v.optional(v.pipe(v.string(), v.uuid())),
  presentations: v.tuple([presentationIdSchema, presentationIdSchema]),
  step: naturalSchema
};

/**
 * Runtime schema for an answer to a comparison of two compatible presentations: one preferred, or,
 * as its outcome, either is fine (a tie, evidence the two are close) or decide later (a skip, no
 * evidence, the question open to be asked again).
 */
export const visualizationPreferenceRecordedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('visualization.preference-recorded'),
  payload: v.union([
    v.object({ ...comparisonAnswer, preferred: presentationIdSchema }),
    v.object({ ...comparisonAnswer, outcome: v.picklist(['tie', 'skip']) })
  ])
});

type ComparisonAnswer = v.InferOutput<typeof visualizationPreferenceRecordedEventSchema>['payload'];

/** An answer to a comparison: one of the pair preferred, either is fine, or decide later. */
export type ComparisonOutcome = 'preferred' | 'tie' | 'skip';

/** The presentation an answer preferred, or none for either is fine and decide later. */
export function preferredPresentation(answer: ComparisonAnswer): string | undefined {
  return 'preferred' in answer ? answer.preferred : undefined;
}

/** How an answer to a comparison came out. */
export function comparisonOutcome(answer: ComparisonAnswer): ComparisonOutcome {
  return 'preferred' in answer ? 'preferred' : answer.outcome;
}
