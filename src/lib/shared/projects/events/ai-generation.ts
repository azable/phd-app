/** AI generation request and outcome event contracts. */

import * as v from 'valibot';

import {
  eventEnvelope,
  naturalSchema,
  positiveSchema,
  recordedTextSchema,
  sha256Schema,
  textSchema
} from './values';

/**
 * Why a turn's first call stepped up from the fast model to a higher-reasoning one
 * (ai/turns/struggle.ts): the participant restored an earlier version, reversed an answer to a
 * comparison, asked the same thing again, answered a question that another question followed, or
 * judged a version vaguely and negatively; or the model itself flagged the request as unclear.
 */
export const escalationReasons = [
  'restored-version',
  'comparison-rejected',
  'repeat-request',
  'question-unsettled',
  'vague-negative',
  'model-flag'
] as const;
export type EscalationReason = (typeof escalationReasons)[number];

/** A step up in words, for the developer's views of a turn's calls. */
export function escalationText(reason: EscalationReason): string {
  return {
    'restored-version': 'stepped up: an earlier version was restored',
    'comparison-rejected': 'stepped up: an answer to a comparison was reversed',
    'repeat-request': 'stepped up: the same request again',
    'question-unsettled': 'stepped up: a question followed by another',
    'vague-negative': 'stepped up: a short negative judgement',
    'model-flag': 'stepped up: the fast call flagged the request as unclear'
  }[reason];
}

/** Runtime schema for an AI generation request. */
export const aiGenerationRequestedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('ai.generation-requested'),
  payload: v.object({
    attempt: positiveSchema,
    purpose: v.picklist(['intake', 'initial', 'repair', 'fallback', 'choosing', 'helper']),
    /** Why this first call stepped up from the fast model, where it did; absent before 2026-11-06. */
    escalation: v.optional(v.picklist(escalationReasons)),
    prompt: recordedTextSchema,
    promptTemplateSha256: sha256Schema,
    requestedModel: textSchema,
    parameters: v.record(v.string(), v.unknown())
  })
});

/** Runtime schema for a successful AI generation. */
export const aiGenerationSucceededEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('ai.generation-succeeded'),
  payload: v.object({
    attempt: positiveSchema,
    adapterId: textSchema,
    requestedModel: textSchema,
    model: v.optional(textSchema),
    responseId: v.optional(textSchema),
    durationMs: naturalSchema,
    usage: v.optional(v.record(v.string(), v.number())),
    response: recordedTextSchema
  })
});

/** Runtime schema for a failed AI generation. */
export const aiGenerationFailedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('ai.generation-failed'),
  payload: v.object({
    attempt: positiveSchema,
    failureKind: v.picklist([
      'configuration',
      'provider',
      'timeout',
      'cancelled',
      'invalid-response'
    ]),
    durationMs: naturalSchema,
    message: v.string(),
    details: v.optional(recordedTextSchema),
    /** The tokens a response that came back but could not be used still spent. */
    usage: v.optional(v.record(v.string(), v.number()))
  })
});
