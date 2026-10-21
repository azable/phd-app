/**
 * Shared validation fragments and values used by project events.
 *
 * @packageDocumentation
 */

import * as v from 'valibot';

/** Runtime schema for non-empty text stored in project events. */
export const textSchema = v.pipe(v.string(), v.nonEmpty());
/** Runtime schema for safe integer values. */
export const integerSchema = v.pipe(v.number(), v.safeInteger());
/** Runtime schema for non-negative safe integer values. */
export const naturalSchema = v.pipe(integerSchema, v.minValue(0));
/** Runtime schema for positive safe integer values. */
export const positiveSchema = v.pipe(integerSchema, v.minValue(1));
/** Runtime schema for lowercase SHA-256 digests. */
export const sha256Schema = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/));
/** Runtime schema for project operation UUIDs. */
export const operationIdSchema = v.pipe(v.string(), v.uuid());

/** Runtime schema for immutable text embedded directly in project history. */
export const recordedTextSchema = v.object({
  text: v.string(),
  sha256: sha256Schema,
  mediaType: textSchema
});

/** Runtime schema for the actor responsible for a project event. */
export const actorSchema = v.variant('kind', [
  v.object({ kind: v.literal('user') }),
  v.object({ kind: v.literal('assistant'), botId: textSchema }),
  v.object({ kind: v.literal('system') })
]);

/** Runtime schema for source-build diagnostics recorded in project history. */
export const diagnosticSchema = v.object({
  severity: v.picklist(['error', 'warning', 'unknown']),
  code: v.optional(v.string()),
  sourcePath: v.optional(v.string()),
  line: v.optional(positiveSchema),
  column: v.optional(positiveSchema),
  /** Where the code the diagnostic is about ends, both from 1; the end column is exclusive. */
  endLine: v.optional(positiveSchema),
  endColumn: v.optional(positiveSchema),
  message: v.string(),
  raw: v.string()
});

/** Runtime schema for source artifacts tracked by a project. */
export const projectArtifactSchema = v.object({
  artifactId: textSchema,
  path: textSchema,
  language: v.picklist(['svelte', 'json']),
  content: recordedTextSchema
});

/** Runtime schema for a version's one-line summary: what it shows, or what it changes. */
export const versionSummarySchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300));

/** Runtime schema for artifact-version provenance. */
export const artifactOriginSchema = v.variant('kind', [
  v.object({ kind: v.literal('initial') }),
  v.object({ kind: v.literal('manual-edit') }),
  v.object({ kind: v.literal('assistant-edit') }),
  v.object({ kind: v.literal('restore'), restoredFrom: positiveSchema }),
  // The source a candidate was built from, made the newest version so the next step builds on it.
  v.object({ kind: v.literal('candidate'), presentationId: v.pipe(v.string(), v.uuid()) })
]);

/** Runtime schema for an artifact upsert or deletion. */
export const artifactChangeSchema = v.variant('operation', [
  v.object({ operation: v.literal('upsert'), artifact: projectArtifactSchema }),
  v.object({ operation: v.literal('delete'), artifactId: textSchema })
]);

/** Runtime schema for the reason a presentation build was requested. */
export const buildPurposeSchema = v.picklist([
  'initial',
  'seed-change',
  'manual-edit',
  'assistant-edit',
  'restore'
]);

/** Validation fields shared by every immutable project event. */
export const eventEnvelope = {
  id: positiveSchema,
  operationId: operationIdSchema,
  actor: actorSchema,
  createdAt: v.pipe(v.string(), v.isoTimestamp())
};

/** Immutable text and its provenance embedded directly in a project event. */
export type RecordedText = v.InferOutput<typeof recordedTextSchema>;
/** Structured build diagnostic retained in project history. */
export type BuildDiagnostic = v.InferOutput<typeof diagnosticSchema>;
/** Metadata for one versioned project source artifact. */
export type ProjectArtifact = v.InferOutput<typeof projectArtifactSchema>;
/** Upsert or deletion applied by an artifact-version event. */
export type ArtifactChange = v.InferOutput<typeof artifactChangeSchema>;
/** Provenance of an artifact version. */
export type ArtifactVersionOrigin = v.InferOutput<typeof artifactOriginSchema>;
/** Reason a presentation build was requested. */
export type BuildPurpose = v.InferOutput<typeof buildPurposeSchema>;
