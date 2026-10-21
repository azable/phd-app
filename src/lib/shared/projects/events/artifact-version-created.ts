/** Artifact-version event contract. */

import * as v from 'valibot';

import {
  artifactChangeSchema,
  artifactOriginSchema,
  eventEnvelope,
  positiveSchema,
  versionSummarySchema
} from './values';

/** Runtime schema for one or more committed artifact changes. */
export const artifactVersionCreatedEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('artifact.version-created'),
  payload: v.object({
    origin: artifactOriginSchema,
    changes: v.pipe(v.array(artifactChangeSchema), v.minLength(1)),
    /** The version this one was made from: the newest when it was made, which is the base its
     * maker was viewing. Absent for the first. */
    parent: v.optional(positiveSchema),
    /** What this version shows, for the first, or what it changes from its parent. */
    summary: v.optional(versionSummarySchema)
  })
});
