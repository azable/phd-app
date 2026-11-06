/** User-visible lifecycle boundaries for asynchronous project operations. */

import * as v from 'valibot';

import { eventEnvelope, positiveSchema, textSchema } from './values';

/** Stable project operation kinds understood outside the execution mechanism. */
export const projectOperationKindSchema = v.picklist([
  'initial-build',
  'rename',
  'feedback',
  'assistant-turn',
  'advance-presentations',
  'report-runtime-error',
  'rebuild',
  'resample',
  'presentation-refill',
  'prepare-answers',
  'prefer',
  'save',
  'restore',
  'view-helpers'
]);

/**
 * Kinds the system runs in the background, which participant work cancels and rebases over: a
 * refill of presentations ahead of time, and the helper rounds prepared for a question's answers.
 */
export const backgroundOperationKinds: ReadonlySet<string> = new Set([
  'presentation-refill',
  'prepare-answers'
]);

const operationPayloadSchema = v.object({ kind: projectOperationKindSchema });

/**
 * How many milliseconds after its study phase's deadline an operation ended, where it was still
 * running at the deadline and finished in the grace that lets it (see studyPhaseGraceMs), so an
 * analysis can keep each phase to its exact length.
 */
const pastDeadlineSchema = v.optional(positiveSchema);

/** Runtime schema for a command accepted for asynchronous execution. */
export const operationAcceptedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('operation.accepted'),
  payload: operationPayloadSchema
});

/** Runtime schema for an operation that reached its successful domain outcome. */
export const operationCompletedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('operation.completed'),
  payload: v.object({ kind: projectOperationKindSchema, pastDeadlineMs: pastDeadlineSchema })
});

/** Runtime schema for an operation that reached an unsuccessful terminal outcome. */
export const operationFailedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('operation.failed'),
  payload: v.object({
    kind: projectOperationKindSchema,
    failureKind: v.picklist(['domain', 'infrastructure', 'cancelled']),
    message: textSchema,
    pastDeadlineMs: pastDeadlineSchema
  })
});

/** A stable operation category represented in project history. */
export type ProjectOperationKind = v.InferOutput<typeof projectOperationKindSchema>;
