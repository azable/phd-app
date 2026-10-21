/**
 * The decisions an assistant that authors a source can return, one schema each, saying what it
 * carries. The response format sent to the model, the parser, and the types all derive from these
 * schemas. To add a decision, add its schema to `sourceDecisions` and handle it where decisions are
 * acted on (runSverlinAssistantTurn), whose switch over them the type checker keeps complete.
 */

import { toJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';

/** What a first source shows, or what a change does: one short sentence. */
const summary = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1),
  v.maxLength(300),
  v.description(
    'One short sentence in the participant’s terms: what a first visualization shows, or what this change does.'
  )
);

/** Every decision, by its action. */
export const sourceDecisions = {
  /** A reply alone: the source and its presentations stay as they are. */
  respond: v.strictObject({ action: v.literal('respond') }),

  /** New presentations of the source as it is, every value randomised. */
  resample: v.strictObject({ action: v.literal('resample') }),

  /**
   * New presentations of the source as it is, with values for some of its variables: the rest keep
   * the viewed variant's values in the first presentation, except those to randomise.
   */
  vary: v.strictObject({
    action: v.literal('vary'),
    values: v.array(
      v.strictObject({
        variable: v.pipe(
          v.string(),
          v.minLength(1),
          v.description(
            'A variable from project.design, by its key, as Here[current].fill or views.Int.'
          )
        ),
        value: v.pipe(
          v.union([v.string(), v.number(), v.boolean()]),
          v.description('One of the variable’s options.')
        )
      })
    ),
    randomise: v.pipe(
      v.array(v.string()),
      v.description('Variables, by key, to give fresh random values.')
    ),
    summary
  }),

  /**
   * Edits to the source being revised, applied in order: each replaces text that occurs in it
   * exactly once.
   */
  edit: v.strictObject({
    action: v.literal('edit'),
    edits: v.pipe(
      v.array(
        v.strictObject({
          find: v.pipe(
            v.string(),
            v.minLength(1),
            v.description('Text copied exactly from the source, occurring in it once.')
          ),
          replace: v.string()
        })
      ),
      v.minLength(1)
    ),
    summary
  }),

  /** The complete replacement source. */
  revise: v.strictObject({
    action: v.literal('revise'),
    source: v.pipe(v.string(), v.regex(/\S/u, 'The source is empty.')),
    summary
  })
};

/** Any one decision. */
export const sourceDecisionSchema = v.variant('action', Object.values(sourceDecisions));

export type SourceDecision = v.InferOutput<typeof sourceDecisionSchema>;
export type SourceDecisionOf<Action extends SourceDecision['action']> = Extract<
  SourceDecision,
  { action: Action }
>;

/**
 * The decisions as JSON Schema, for the response format sent to the model. Checks JSON Schema
 * cannot state, such as trimming, are left to the parser.
 */
export const sourceDecisionJsonSchema = toJsonSchema(sourceDecisionSchema, {
  errorMode: 'ignore',
  target: 'draft-07'
}) as Record<string, unknown>;
