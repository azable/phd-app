/** View-helper event contracts: the dev-mode switch and the candidates the helpers proposed. */

import * as v from 'valibot';

import { eventEnvelope, positiveSchema } from './values';

/**
 * An administrator in dev mode turning the view helpers on or off for one project, over its study
 * condition's setting.
 */
export const projectViewHelpersSetEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('project.view-helpers-set'),
  payload: v.object({ enabled: v.boolean() })
});

/**
 * Alternative views of one type the helpers proposed for a source, each built with it and readable,
 * for the assistant to choose from; those that did not build or read are left out.
 */
export const visualizationViewCandidatesEventSchema = v.object({
  ...eventEnvelope,
  type: v.literal('visualization.view-candidates'),
  payload: v.object({
    /** The source the views were written for, by its content hash. */
    sourceSha256: v.pipe(v.string(), v.minLength(1)),
    /** The type they are views of, or the layout they are arrangements of. */
    type: v.optional(v.string()),
    layout: v.optional(v.string()),
    /** What the assistant asked the views to show; none for the main type after a first version. */
    task: v.optional(v.string()),
    /** The generations that proposed them. */
    generationEventIds: v.array(positiveSchema),
    candidates: v.array(
      v.object({
        name: v.string(),
        description: v.string(),
        markup: v.string(),
        readability: v.optional(v.string()),
        /** What its helper tried, as "the main structure beside the other parts": arrangements of
         * one layout share its name, so this tells them apart. */
        label: v.optional(v.pipe(v.string(), v.maxLength(200)))
      })
    ),
    /** How many were proposed and left out, and why. */
    dropped: v.array(v.object({ name: v.string(), reason: v.string() }))
  })
});
