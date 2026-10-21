/** Source-build request and outcome event contracts. */

import * as v from 'valibot';

import {
  diagnosticSchema,
  eventEnvelope,
  integerSchema,
  naturalSchema,
  positiveSchema,
  recordedTextSchema,
  buildPurposeSchema,
  textSchema
} from './values';
import { variantRequestSchema } from '$lib/shared/presentations';

/** Runtime schema for a source-build request. */
export const buildRequestedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('build.requested'),
  payload: v.object({
    purpose: buildPurposeSchema,
    input: v.picklist(['committed-artifact', 'assistant-candidate']),
    source: recordedTextSchema,
    sourceLabel: textSchema,
    seed: v.pipe(integerSchema, v.minValue(1)),
    /** The values the build starts from; absent, every declaration is randomised. */
    variant: v.optional(variantRequestSchema),
    attempt: v.optional(positiveSchema),
    buildId: v.optional(v.pipe(v.string(), v.uuid())),
    batchIndex: v.optional(naturalSchema),
    batchSize: v.optional(positiveSchema)
  })
});

/** Runtime schema for a successful source build. */
export const buildSucceededEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('build.succeeded'),
  payload: v.object({
    durationMs: naturalSchema,
    buildId: v.optional(v.pipe(v.string(), v.uuid())),
    seed: v.optional(positiveSchema),
    batchIndex: v.optional(naturalSchema),
    batchSize: v.optional(positiveSchema),
    bundle: recordedTextSchema
  })
});

/** Runtime schema for a failed source build. */
export const buildFailedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('build.failed'),
  payload: v.object({
    durationMs: naturalSchema,
    buildId: v.optional(v.pipe(v.string(), v.uuid())),
    seed: v.optional(positiveSchema),
    batchIndex: v.optional(naturalSchema),
    batchSize: v.optional(positiveSchema),
    failureKind: v.picklist(['source', 'infrastructure', 'cancelled']),
    diagnostics: v.array(diagnosticSchema),
    repairEligible: v.boolean(),
    error: v.optional(v.string())
  })
});
