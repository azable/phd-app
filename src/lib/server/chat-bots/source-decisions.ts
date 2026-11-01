/**
 * The decisions an assistant that authors a source can return, one schema each, saying what it
 * carries. The response format sent to the model, the parser, and the types all derive from these
 * schemas. To add a decision, add its schema to `sourceDecisions` and handle it where decisions are
 * acted on (runSverlinAssistantTurn), whose switch over them the type checker keeps complete.
 */

import { toJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';

import {
  briefKeys,
  briefStatusSchema,
  briefTags,
  knownTags,
  maximumBriefText,
  type BriefEntry
} from '$lib/shared/projects/brief';

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
 * How many presentations to make, filled by the project's chooser; the first set shows and the rest
 * wait for Next pair. Optional (null in the strict response): a vary then shows one version, a
 * resample the next set.
 */
const count = v.optional(
  v.nullable(
    v.pipe(
      v.number(),
      v.integer(),
      v.minValue(2),
      v.maxValue(maximumVariants),
      v.description(
        'How many presentations to make, one per option compared (four views of a type, 4; a yes or no, 2), or null for one version (a resample: the next pair). The first pair shows with your reply; Next pair shows the rest.'
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

/** The most characters of a side's label: a word or two, shown after its question as the answer. */
export const maximumSideLabel = 40;

/** One side of a pair: what the participant would call it, and the values it sets. */
function comparisonSide(side: string) {
  return v.strictObject({
    label: v.pipe(
      v.string(),
      v.trim(),
      v.minLength(1),
      v.maxLength(maximumSideLabel),
      v.description(
        `${side}, named in a word or two in the participant’s terms, different from the other side’s, as “cells” and “tallies” or “with the listing” and “without”; shown as their answer when they prefer it.`
      )
    ),
    values: v.pipe(
      v.array(designValue),
      v.minLength(1),
      v.description(`The values ${side.toLowerCase()} sets.`)
    )
  });
}

/**
 * A brief attribute a comparison asks by showing, and the tag each side stands for: the side
 * preferred sets it, inferred from the pick. Optional (null in the strict response).
 */
const comparisonBrief = v.optional(
  v.nullable(
    v.pipe(
      v.strictObject({
        attribute: v.pipe(
          v.picklist(briefKeys),
          v.description('The attribute, from project.brief.')
        ),
        left: v.pipe(
          v.picklist(briefTags),
          v.description('The tag of the attribute’s offeredTags the first side stands for.')
        ),
        right: v.pipe(
          v.picklist(briefTags),
          v.description('The tag of the attribute’s offeredTags the second side stands for.')
        )
      }),
      v.description(
        'The brief attribute this pair asks by showing (one marked prompt show in project.brief), as tone, left restrained and right bold, the side picked setting it; or null for a pair about the design alone.'
      )
    )
  )
);

/** The most comparisons one decision asks, each a pair. */
export const maximumComparisons = 8;

/**
 * Pairs the assistant designs, each asking one question: both sides take the viewed variant (with a
 * vary's values) and differ only in the values each side sets. Optional (null in the strict
 * response); not with a count. Its first pair shows in place of the decision's one version.
 */
const comparisons = v.optional(
  v.nullable(
    v.pipe(
      v.array(
        v.pipe(
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
            left: comparisonSide('The first of the pair'),
            right: comparisonSide('The second of the pair'),
            brief: comparisonBrief
          }),
          v.check(
            ({ left, right }) => left.label.toLowerCase() !== right.label.toLowerCase(),
            'A comparison’s two sides need different labels.'
          )
        )
      ),
      v.minLength(1),
      v.maxLength(maximumComparisons),
      v.description(
        'Pairs to compare, one per question, most useful first, or null. The first pair shows with your reply; each answer shows the next.'
      )
    )
  )
);

/** The most elements a question about a presentation names. */
export const maximumQuestionElements = 8;

/**
 * A question for the participant to answer in the chat, in words or about a presentation: one
 * already shown, or the first this decision makes, as an example illustrating the question, with
 * elements in it to highlight. Optional (null in the strict response); a pair is asked with
 * comparisons instead.
 */
const question = v.optional(
  v.nullable(
    v.strictObject({
      text: v.pipe(
        v.string(),
        v.trim(),
        v.minLength(1),
        v.maxLength(200),
        v.description(
          'The question, in the participant’s terms, shown under your reply (so not repeated in it) until they answer it in a message, saying briefly why it is asked, as “To help me refine it further, who is it for?”.'
        )
      ),
      presentation: v.pipe(
        v.nullable(v.string()),
        v.description(
          'null for a question in words; "new" for the first presentation this decision makes, as an example illustrating the question; or the id of a presentation already shown.'
        )
      ),
      elements: v.pipe(
        v.nullable(v.pipe(v.array(v.string()), v.maxLength(maximumQuestionElements))),
        v.description(
          'Element ids in that presentation the question is about, highlighted when the participant opens it: each the line:column of its <Node> or <Link> tag in that presentation’s source, as 12:5, as selected.elements name them; or null.'
        )
      )
    })
  )
);

/** Every decision, by its action. */
export const sourceDecisions = {
  /** A reply alone: the source and its presentations stay as they are. */
  respond: v.strictObject({ action: v.literal('respond'), question }),

  /**
   * New presentations of the source as it is: the next pair, every value randomised, or with a
   * count, that many the chooser fills.
   */
  resample: v.strictObject({ action: v.literal('resample'), count }),

  /**
   * A new presentation of the source as it is, with values for some of its variables: the rest keep
   * the viewed variant's values, except those to randomise; with a count, that many presentations,
   * each taking the values, the chooser filling the rest; with comparisons, each a pair differing
   * only in what its sides set.
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
      question,
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
    question,
    summary
  }),

  /** The complete replacement source; with comparisons, pairs of it to compare. */
  revise: v.strictObject({
    action: v.literal('revise'),
    source: v.pipe(v.string(), v.regex(/\S/u, 'The source is empty.')),
    comparisons,
    question,
    summary
  })
};

/** Any one decision. */
export const sourceDecisionSchema = v.variant('action', Object.values(sourceDecisions));

export type SourceDecision = v.InferOutput<typeof sourceDecisionSchema>;
/** The pairs a decision asks to compare, each with its question. */
export type Comparisons = NonNullable<SourceDecisionOf<'vary'>['comparisons']>;
/** A question a decision asks the participant to answer in the chat. */
export type DecisionQuestion = NonNullable<SourceDecisionOf<'respond'>['question']>;
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

/** The most attributes one decision sets: every attribute of the brief. */
const maximumBriefEntries = briefKeys.length;

/**
 * Attributes of the design brief (shared/projects/brief.ts) this turn learned or the participant
 * confirmed or corrected, returned beside the decision; only those that changed, or null.
 */
export const briefUpdateSchema = v.nullable(
  v.pipe(
    v.array(
      v.strictObject({
        key: v.pipe(v.picklist(briefKeys), v.description('The attribute, from project.brief.')),
        value: v.pipe(
          v.string(),
          v.trim(),
          v.maxLength(maximumBriefText),
          v.description(
            'What it is, briefly, in the participant’s terms, as “first-year students, new to sorting”; empty for unknown.'
          )
        ),
        status: v.pipe(
          briefStatusSchema,
          v.description(
            'inferred, from what the participant wrote or the request; confirmed, the participant said so or agreed; unknown, to forget it.'
          )
        ),
        source: v.pipe(
          v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(maximumBriefText))),
          v.description('The participant’s words it came from, quoted, or null.')
        ),
        tags: v.pipe(
          v.array(v.picklist(briefTags)),
          v.description(
            'The values from this attribute’s offeredTags in project.brief that apply, as ["greyscale"] for constraints; others are ignored.'
          )
        )
      })
    ),
    v.maxLength(maximumBriefEntries)
  )
);

/** The brief entries a decision sets, as recorded: each with only the tags its attribute names. */
export function recordedBrief(
  update: v.InferOutput<typeof briefUpdateSchema> | undefined
): BriefEntry[] {
  return (update ?? []).map(({ key, value, status, source, tags }) => {
    const named = knownTags(key, tags);
    return {
      key,
      value,
      status,
      ...(source ? { source } : {}),
      ...(named.length ? { tags: named } : {})
    };
  });
}

/** The brief update as JSON Schema, for the response format sent to the model. */
export const briefUpdateJsonSchema = everyPropertyRequired(
  toJsonSchema(briefUpdateSchema, { errorMode: 'ignore', target: 'draft-07' })
) as Record<string, unknown>;
