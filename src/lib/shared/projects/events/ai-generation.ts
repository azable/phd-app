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

/** Runtime schema for an AI generation request. */
export const aiGenerationRequestedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('ai.generation-requested'),
  payload: v.object({
    attempt: positiveSchema,
    purpose: v.picklist(['intake', 'initial', 'repair', 'fallback', 'choosing']),
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
    details: v.optional(recordedTextSchema)
  })
});
