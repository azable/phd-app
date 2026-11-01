/**
 * The design brief: what the participant is trying to achieve, as attributes (who it is for, where
 * it is used, what a learner should notice, ...), each unknown, inferred from what they wrote, or
 * confirmed by them. The attributes are defined here, in one place, each with the question asked
 * in the participant's words, why it matters, and the design choices it bears on; each value it
 * names (a tag) says how it steers which choices are worth asking and which are kept out of
 * comparisons (see brief-context.ts), and each says how it is best asked, in words or by showing.
 * Read from the events: intake's answers, the brief each assistant decision sets
 * (assistant.responded `brief`), and the side picked of a comparison asking one by showing
 * (visualization.presented `brief`).
 */

import * as v from 'valibot';

import type { ProjectEvent } from './events';
import { plainMessageText } from './events/message-content';

/**
 * The families design choices are explored by, the ones that change the picture most first: the
 * views drawn (views, pointers, the listing shown), what is shown, the arrangement (layouts, forms,
 * directions), pacing, shape, lettering, and colour.
 */
export type ChoiceFamily =
  | 'views'
  | 'shown'
  | 'arrangement'
  | 'pacing'
  | 'shape'
  | 'lettering'
  | 'colour'
  | 'spacing';

/**
 * How one value of an attribute steers: multipliers on the worth of asking each family's choices,
 * and on choices whose variable matches a pattern; and choices it keeps out of comparisons.
 */
export type BriefSteer = {
  families?: Partial<Record<ChoiceFamily, number>>;
  matching?: { pattern: RegExp; weight: number }[];
  excludes?: { what: string; families?: ChoiceFamily[]; pattern?: RegExp; reason: string };
};

export type BriefAttribute = {
  key: string;
  /** The question, in the participant's words. */
  question: string;
  why: string;
  /**
   * The design choices it bears on, the inputs a source is run on (Stage 4), the subject, or the
   * conversation: how the participant likes to work, which steers what the assistant asks and
   * offers rather than any choice.
   */
  bearsOn: readonly ChoiceFamily[] | 'inputs' | 'subject' | 'conversation';
  /**
   * How it is best asked: in words; by showing, a comparison whose sides stand for its tags, the
   * pick setting it (see projectBrief); or both, what a picture shows by a comparison (a label's
   * wording) and the rest in words (terms the picture does not show yet).
   */
  asked: 'words' | 'showing' | 'both';
  /** Asked by intake, before the first version. */
  intake?: true;
  /** Intake's message asking it, when it also invites more than the question does. */
  opening?: string;
  /**
   * Asked as soon as there is a version, before any comparison, while unknown: what the first
   * reply asks, unless the request already said it.
   */
  askFirst?: true;
  /** Asked once, late: once the first version and the most important questions are settled. */
  later?: true;
  /** Asked with the first alternatives offered, after a version is shown, so it is concrete. */
  withAlternatives?: true;
  /** The tag that holds while it is unknown, steering as if inferred: its default. */
  assumed?: string;
  /** Values the assistant can name it by, each with how it steers. */
  tags?: Record<string, BriefSteer>;
};

/** Variables for how a step's comparison is marked: pointers, and kinds or labels naming one. */
const comparisonMarks = /^pointers\.|\.Pointed\.|compar/i;
/** Variables for how a position is labelled: its pointer views, as `i`, `A[i]` or a word. */
const positionLabels = /^pointers\./;

/**
 * The attributes, in the order they are asked. Intake's questions come first. Stage 3s's first
 * guess, revised against what Study 1's participants asked for and cared about (plan, Stage 5).
 */
export const briefAttributes = [
  {
    key: 'algorithm',
    question: 'What algorithm would you like to visualise?',
    opening:
      'What algorithm would you like to visualise? If you like, tell me who it’s for, and whether you’d like me to ask a few questions first or start with a first version.',
    why: 'Everything drawn follows from the algorithm and its steps.',
    bearsOn: 'subject',
    asked: 'words',
    intake: true
  },
  {
    key: 'audience',
    question: 'Who is it for, and what do they already know?',
    why: 'Newcomers need more shown and slower steps; those who know the basics, less.',
    bearsOn: ['shown', 'pacing', 'views'],
    asked: 'words',
    askFirst: true,
    tags: {
      novice: { families: { shown: 1.3, pacing: 1.2 } },
      experienced: { families: { pacing: 0.8 } }
    }
  },
  {
    key: 'focus',
    question:
      'What should a learner take away, even if they only half follow it, and is there a misconception it should tackle?',
    why: 'What is marked, and where it pauses, follows the key takeaway and what learners get wrong.',
    bearsOn: ['views', 'shown', 'arrangement', 'colour'],
    asked: 'both',
    askFirst: true,
    tags: {
      comparisons: {
        matching: [{ pattern: comparisonMarks, weight: 2.5 }],
        families: { lettering: 0.8 }
      },
      pattern: { families: { arrangement: 1.4, views: 1.2, pacing: 0.8 } },
      result: { families: { shown: 1.3 } },
      // The step where learners go wrong has to show, and pause.
      misconception: { families: { shown: 1.2, pacing: 1.3 } }
    }
  },
  {
    key: 'vocabulary',
    question:
      'Are there words or notation your course uses for this, or avoids, such as `i` or `A[i]` for a position?',
    why: 'Labels, captions and the listing should speak as the course does.',
    bearsOn: ['views'],
    asked: 'both',
    tags: {
      notation: { matching: [{ pattern: positionLabels, weight: 1.3 }] },
      words: { matching: [{ pattern: positionLabels, weight: 1.3 }] }
    }
  },
  {
    key: 'setting',
    question:
      'Will it be explained in a lecture, stepped through by students alone, revised from, or explored by students with inputs of their own?',
    why: 'A lecture needs it legible from afar; alone, it must explain itself; revising, it should be quick to scan; exploring, it must take other inputs.',
    bearsOn: ['lettering', 'shown', 'pacing'],
    asked: 'words',
    tags: {
      lecture: { families: { lettering: 1.4, shape: 1.1 } },
      alone: { families: { shown: 1.3, pacing: 1.3 } },
      revision: { families: { shown: 1.2, pacing: 0.7 } },
      explore: { families: { shown: 1.2 } }
    }
  },
  {
    key: 'use',
    question:
      'Where will it be shown: live on slides, in lecture notes, as TikZ in your notes, or as a page students open?',
    why: 'Where it is shown decides the export it needs and how large it must read.',
    bearsOn: ['lettering'],
    asked: 'words',
    tags: {
      slides: { families: { lettering: 1.3 } },
      notes: {},
      tikz: {},
      page: {}
    }
  },
  {
    key: 'detail',
    question: 'Should it show every step, or only the steps that matter?',
    why: 'It decides where the steps pause.',
    bearsOn: ['pacing'],
    asked: 'words',
    tags: {
      'every-step': { families: { pacing: 1.2 } },
      'key-steps': { families: { pacing: 1.6 } }
    }
  },
  {
    key: 'constraints',
    question:
      'Will anyone need to read it with low vision, or will it be printed in grey? Anything else to keep or avoid, such as the code listing?',
    why: 'A constraint rules options out before any are compared. Colours are colour-blind safe whatever it says.',
    bearsOn: ['colour', 'views'],
    asked: 'words',
    later: true,
    tags: {
      greyscale: {
        excludes: { what: 'colours', families: ['colour'], reason: 'it must print in grey' }
      },
      'low-vision': { families: { lettering: 1.4 } },
      'no-listing': {
        excludes: { what: 'the listing', pattern: /^listing\./, reason: 'it has no code listing' }
      }
    }
  },
  {
    key: 'tone',
    question: 'Should it look academic and restrained, or bolder?',
    why: 'Tone shows in fonts, colours and shapes; a generic, flashy look reads as made by AI.',
    bearsOn: ['lettering', 'colour', 'shape'],
    asked: 'showing',
    assumed: 'restrained',
    tags: {
      restrained: { families: { lettering: 0.8, shape: 0.8 } },
      bold: { families: { lettering: 1.4, colour: 1.4, shape: 1.4 } }
    }
  },
  {
    key: 'cases',
    question:
      'Only the usual case, or edge cases too, such as a target that is absent or duplicates?',
    why: 'Edge cases are inputs of their own, worth seeing only where the algorithm has them.',
    bearsOn: 'inputs',
    asked: 'words',
    tags: { usual: {}, edge: {} }
  },
  // How the participant likes to work, in two parts (plan, Stage 5): each a starting point they can
  // change at any time, with a default.
  {
    key: 'questions',
    question: 'Would you like me to ask a few questions first, or start with a first version?',
    why: 'Some want to be asked what they want, as by an illustrator; others want a draft at once.',
    bearsOn: 'conversation',
    asked: 'words',
    assumed: 'draft-first',
    tags: { 'questions-first': {}, 'draft-first': {}, 'fewer-questions': {} }
  },
  {
    key: 'lead',
    question:
      'From here, would you like me to suggest alternatives for you to choose from, or would you rather tell me what you want and I’ll make it? You can switch any time.',
    why: 'Some would rather judge alternatives than describe what they want; others know exactly what they want.',
    bearsOn: 'conversation',
    asked: 'words',
    withAlternatives: true,
    assumed: 'mix',
    tags: { suggest: {}, direct: {}, mix: {} }
  }
] as const satisfies readonly BriefAttribute[];

export type BriefKey = (typeof briefAttributes)[number]['key'];

export const briefKeys = briefAttributes.map(({ key }) => key) as [BriefKey, ...BriefKey[]];

/** The attributes intake asks, in order. */
export const intakeKeys = briefAttributes
  .filter((attribute: BriefAttribute) => attribute.intake)
  .map(({ key }) => key) as [BriefKey, ...BriefKey[]];

export function briefAttribute(key: BriefKey): BriefAttribute {
  return briefAttributes.find((attribute) => attribute.key === key)!;
}

/** Every tag any attribute names. */
export const briefTags = [
  ...new Set(
    briefAttributes.flatMap((attribute: BriefAttribute) => Object.keys(attribute.tags ?? {}))
  )
] as [string, ...string[]];

/** Where a value came from: the participant's words, inferred or confirmed, or set back to unknown. */
export const briefStatusSchema = v.picklist(['inferred', 'confirmed', 'unknown']);

/** The most characters of a value or the words it came from. */
export const maximumBriefText = 200;

/** One attribute as the assistant's decision sets it. */
export const briefEntrySchema = v.object({
  key: v.picklist(briefKeys),
  value: v.pipe(v.string(), v.maxLength(maximumBriefText)),
  status: briefStatusSchema,
  /** The participant's words it came from. */
  source: v.optional(v.pipe(v.string(), v.maxLength(maximumBriefText))),
  /** Values from the attribute's tags it names. */
  tags: v.optional(v.array(v.string()))
});

export type BriefEntry = v.InferOutput<typeof briefEntrySchema>;

/** One attribute as the brief has it now. */
export type BriefItem =
  | { key: BriefKey; status: 'unknown' }
  | {
      key: BriefKey;
      status: 'inferred' | 'confirmed';
      value: string;
      source?: string;
      tags?: string[];
      /** The event that set it; none for an entry of the turn not yet recorded. */
      eventId?: number;
    };

/** An entry's tags, keeping only those its attribute names. */
export function knownTags(key: BriefKey, tags: readonly string[] = []): string[] {
  const named = (briefAttribute(key).tags ?? {}) as Record<string, BriefSteer>;
  return [...new Set(tags)].filter((tag) => Object.hasOwn(named, tag));
}

const clipped = (text: string) =>
  text.length > maximumBriefText ? `${text.slice(0, maximumBriefText - 1)}…` : text;

/**
 * The brief, every attribute in order: intake's answers confirmed in the participant's words, then
 * each entry an assistant decision set or a comparison's pick inferred (a side of a pair asking an
 * attribute by showing), the latest for each attribute standing, then `pending`: entries of the
 * turn not yet recorded, as the decision being checked sets them.
 */
export function projectBrief(
  events: readonly ProjectEvent[],
  pending: readonly BriefEntry[] = []
): BriefItem[] {
  const items = new Map<BriefKey, BriefItem>(
    briefKeys.map((key) => [key, { key, status: 'unknown' }])
  );
  const set = (entries: readonly BriefEntry[], eventId?: number) => {
    for (const { key, value, status, source, tags } of entries) {
      const named = knownTags(key, tags);
      items.set(
        key,
        status === 'unknown'
          ? { key, status }
          : {
              key,
              status,
              value,
              ...(source ? { source } : {}),
              ...(named.length ? { tags: named } : {}),
              ...(eventId === undefined ? {} : { eventId })
            }
      );
    }
  };
  // Intake's answer is the participant's next message after its question, unless they left intake.
  let asking: BriefKey | undefined;
  const intakeAnswers = new Map<number, BriefKey>();
  // The sides of comparisons asking an attribute by showing, by presentation.
  const sides = new Map<string, { question: string; label: string; key: BriefKey; tag: string }>();
  for (const event of events) {
    if (event.type === 'visualization.presented') {
      const { presentation, question, label, brief } = event.payload;
      if (question && label && brief)
        sides.set(presentation.presentationId, { question, label, ...brief });
    } else if (event.type === 'visualization.preference-recorded') {
      // A side preferred sets what it stands for, as inferred from the pick; either is fine and
      // decide later set nothing.
      const side = 'preferred' in event.payload ? sides.get(event.payload.preferred) : undefined;
      if (side)
        set(
          [
            {
              key: side.key,
              value: clipped(side.label),
              status: 'inferred',
              source: clipped(`${side.question} → ${side.label}`),
              tags: [side.tag]
            }
          ],
          event.id
        );
    } else if (event.type === 'assistant.responded') {
      asking = event.payload.intakeStep;
      set(event.payload.brief ?? [], event.id);
    } else if (event.type === 'feedback.submitted' && asking) {
      const text = plainMessageText(event.payload.content).trim();
      if (text) {
        items.set(asking, {
          key: asking,
          status: 'confirmed',
          value: clipped(text),
          source: clipped(text),
          eventId: event.id
        });
        intakeAnswers.set(event.id, asking);
      }
      asking = undefined;
    } else if (event.type === 'assistant.intake-completed' && event.payload.outcome === 'waived') {
      const key = intakeAnswers.get(event.payload.interactionEventId);
      const item = key && items.get(key);
      if (key && item?.status !== 'unknown' && item?.eventId === event.payload.interactionEventId)
        items.set(key, { key, status: 'unknown' });
    }
  }
  set(pending);
  return [...items.values()];
}
