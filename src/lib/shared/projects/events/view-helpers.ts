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
        label: v.optional(v.pipe(v.string(), v.maxLength(200))),
        /** Its fill of each hole, by the hole's name, where the round filled a skeleton. */
        fills: v.optional(v.record(v.string(), v.string())),
        /** The group of holes it fills, or the groups a combination joins. */
        group: v.optional(v.string()),
        /** What the app measured of it, in a line (candidate-facts.server.ts). */
        facts: v.optional(v.string()),
        /** The decision model's score, 0 to 1, and each question's probability of yes. */
        score: v.optional(v.number()),
        answers: v.optional(v.record(v.string(), v.number())),
        /** Why the designing model put these fills together, for a combination. */
        why: v.optional(v.pipe(v.string(), v.maxLength(500)))
      })
    ),
    /** How many were proposed and left out, and why. */
    dropped: v.array(v.object({ name: v.string(), reason: v.string() })),
    /** The skeleton the main agent wrote, where it wrote one rather than naming a type or layout. */
    skeleton: v.optional(v.string()),
    /**
     * The answer, by the reply asking its question and its label, that this round prepared
     * candidates for in the background, kept until that answer is given (helper-pipeline.ts
     * firstTurns.caching).
     */
    option: v.optional(v.object({ question: positiveSchema, label: v.string() })),
    /**
     * Which stages ran and how long each took (ai/bots/helper-pipeline.ts): scoring and choosing
     * on, off by the configuration, or skipped (no pictures, a failed call, or past the wait).
     */
    stages: v.optional(
      v.object({
        scoring: v.picklist(['on', 'off', 'skipped']),
        choosing: v.picklist(['on', 'off', 'skipped']),
        /** Why a stage was skipped, where one was. */
        skipped: v.optional(v.string()),
        /** Whether the round finished after the reply's wait, joining as a further comparison. */
        late: v.boolean(),
        ms: v.object({
          calls: v.number(),
          builds: v.number(),
          scoring: v.number(),
          choosing: v.number()
        })
      })
    )
  })
});
