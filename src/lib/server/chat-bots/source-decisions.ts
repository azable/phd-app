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
    'One short sentence in the participant’s terms: what a first visualization shows, or what this change does, with any code it names, as a snippet, label or variable, in backticks, as `@left`.'
  )
);

/** The most presentations one vary or resample makes: four pairs. */
export const maximumVariants = 8;

/**
 * How many presentations to make, filled by the project's chooser; the first pair shows and the rest
 * wait for New pair. Optional (null in the strict response) for one pair as before.
 */
const count = v.optional(
  v.nullable(
    v.pipe(
      v.number(),
      v.integer(),
      v.minValue(2),
      v.maxValue(maximumVariants),
      v.description(
        'How many presentations to make, one per option compared (four views of a type, 4; a yes or no, 2), or null for one pair as before. The first pair shows; the rest wait for New pair.'
      )
    )
  )
);

/** One variable set to one of its options. */
const designValue = v.strictObject({
  variable: v.pipe(
    v.string(),
    v.minLength(1),
    v.description(
      'A variable from project.design, by its key, as Compared.Pointed.fill, views.Int, or pointers.Index.'
    )
  ),
  value: v.pipe(
    v.union([v.string(), v.number(), v.boolean()]),
    v.description('One of the variable’s options.')
  )
});

/** The most comparisons one decision asks, each a pair. */
export const maximumComparisons = 8;

/**
 * Pairs the assistant designs, each asking one question: both sides take the viewed variant (with a
 * vary's values) and differ only in the values each side sets. Optional (null in the strict
 * response); not with a count. With a change to the source, its first pair shows in place of the
 * chooser's.
 */
const comparisons = v.optional(
  v.nullable(
    v.pipe(
      v.array(
        v.strictObject({
          question: v.pipe(
            v.string(),
            v.trim(),
            v.minLength(1),
            v.maxLength(120),
            v.description(
              'What the pair asks, in the participant’s terms, shown above it, as “Cells or tallies for the numbers?”.'
            )
          ),
          left: v.pipe(
            v.array(designValue),
            v.minLength(1),
            v.description('The values the first of the pair sets.')
          ),
          right: v.pipe(
            v.array(designValue),
            v.minLength(1),
            v.description('The values the second of the pair sets.')
          )
        })
      ),
      v.minLength(1),
      v.maxLength(maximumComparisons),
      v.description(
        'Pairs to compare, one per question, most useful first, or null. The first pair shows as soon as it is built; the rest wait, each shown once the one before is answered.'
      )
    )
  )
);

/** Every decision, by its action. */
export const sourceDecisions = {
  /** A reply alone: the source and its presentations stay as they are. */
  respond: v.strictObject({ action: v.literal('respond') }),

  /**
   * New presentations of the source as it is: the next pair, every value randomised, or with a
   * count, that many the chooser fills.
   */
  resample: v.strictObject({ action: v.literal('resample'), count }),

  /**
   * New presentations of the source as it is, with values for some of its variables: the rest keep
   * the viewed variant's values in the first presentation, except those to randomise; with a count,
   * every presentation takes the values and the chooser fills the rest; with comparisons, each is a
   * pair differing only in what its sides set.
   */
  vary: v.pipe(
    v.strictObject({
      action: v.literal('vary'),
      values: v.array(designValue),
      randomise: v.pipe(
        v.array(v.string()),
        v.description('Variables, by key, to give fresh random values.')
      ),
      count,
      comparisons,
      summary
    }),
    v.check(
      ({ count, comparisons }) => !count || !comparisons,
      'A vary gives a count or comparisons, not both.'
    )
  ),

  /**
   * Edits to the source being revised, applied in order: each replaces text that occurs in it
   * exactly once; with comparisons, pairs of the edited source to compare.
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
    comparisons,
    summary
  }),

  /** The complete replacement source; with comparisons, pairs of it to compare. */
  revise: v.strictObject({
    action: v.literal('revise'),
    source: v.pipe(v.string(), v.regex(/\S/u, 'The source is empty.')),
    comparisons,
    summary
  })
};

/** Any one decision. */
export const sourceDecisionSchema = v.variant('action', Object.values(sourceDecisions));

export type SourceDecision = v.InferOutput<typeof sourceDecisionSchema>;
/** The pairs a decision asks to compare, each with its question. */
export type Comparisons = NonNullable<SourceDecisionOf<'vary'>['comparisons']>;
export type SourceDecisionOf<Action extends SourceDecision['action']> = Extract<
  SourceDecision,
  { action: Action }
>;

/**
 * The decisions as JSON Schema, for the response format sent to the model. Checks JSON Schema
 * cannot state, such as trimming, are left to the parser.
 */
export const sourceDecisionJsonSchema = everyPropertyRequired(
  toJsonSchema(sourceDecisionSchema, { errorMode: 'ignore', target: 'draft-07' })
) as Record<string, unknown>;

/** Strict structured outputs require every property, so an optional one is sent as null. */
function everyPropertyRequired(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(everyPropertyRequired);
  if (!schema || typeof schema !== 'object') return schema;
  const object: Record<string, unknown> = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, everyPropertyRequired(value)])
  );
  const properties = object.properties;
  return object.type === 'object' && properties && typeof properties === 'object'
    ? { ...object, required: Object.keys(properties) }
    : object;
}
