/**
 * The design brief (shared/projects/brief.ts) for the assistant: every attribute with where it
 * stands, which are worth asking or confirming now, and how the brief steers the preference
 * summary's ranking and keeps choices out of comparisons.
 */

import {
  briefAttribute,
  type BriefItem,
  type BriefKey,
  type BriefSteer,
  type ChoiceFamily
} from '$lib/shared/projects/brief';

import { choiceFamily } from './preference-summary';

/** How the brief weighs a choice's worth asking, and why it keeps one out of comparisons. */
export type BriefSteering = {
  weight(variable: string): number;
  /** Why the brief keeps a choice out of comparisons, if it does. */
  excluded(variable: string): string | undefined;
};

/** One attribute for the assistant, with what makes it worth asking or confirming now. */
export type AiBriefItem = {
  key: BriefKey;
  question: string;
  status: BriefItem['status'];
  value?: string;
  /** The participant's words it came from. */
  source?: string;
  tags?: string[];
  /** The values brief tags may name for it, each steering what is worth asking or compared. */
  offeredTags?: string[];
  /**
   * ask: unknown, and asked first or bearing on choices still open, to ask in words before
   * comparing them;
   * confirm: inferred, and it steers choices still open.
   */
  prompt?: 'ask' | 'confirm';
  /** Unknown and asked first (brief.ts askFirst): as soon as there is a version, before comparing. */
  first?: true;
  /** The families of open choices it bears on or steers. */
  decides?: ChoiceFamily[];
};

/** The brief for the assistant. */
export type AiBrief = {
  attributes: AiBriefItem[];
  /** The attributes most worth asking or confirming, most first: those asked first lead. */
  askFirst: BriefKey[];
  /** What the brief keeps out of comparisons, and why, as “colours: it must print in grey”. */
  avoid: string[];
};

/**
 * What is asked before what: the subject; unknowns asked first; other unknowns; inferences to
 * confirm.
 */
const ranks = ['subject', 'first', 'unknown', 'confirm'] as const;
type Rank = (typeof ranks)[number];

/** At most this many attributes are suggested to ask at a time; they are asked one at a time. */
const listedAskFirst = 3;

/** The steers an attribute's tags name. */
function steers(item: BriefItem): BriefSteer[] {
  if (item.status === 'unknown') return [];
  const tags = (briefAttribute(item.key).tags ?? {}) as Record<string, BriefSteer>;
  return (item.tags ?? []).flatMap((tag) => (tags[tag] ? [tags[tag]] : []));
}

function steering(all: readonly BriefSteer[]): BriefSteering {
  return {
    weight(variable) {
      const { family } = choiceFamily(variable);
      return all.reduce(
        (weight, steer) =>
          (steer.matching ?? []).reduce(
            (matched, { pattern, weight: factor }) =>
              pattern.test(variable) ? matched * factor : matched,
            weight * (steer.families?.[family] ?? 1)
          ),
        1
      );
    },
    excluded(variable) {
      const { family } = choiceFamily(variable);
      return all.find(
        ({ excludes }) =>
          excludes && (excludes.families?.includes(family) || excludes.pattern?.test(variable))
      )?.excludes?.reason;
    }
  };
}

/** How the whole brief steers: the product of every named value's weights, and its exclusions. */
export function briefSteering(brief: readonly BriefItem[]): BriefSteering {
  return steering(brief.flatMap(steers));
}

/**
 * The brief for the assistant, given the choices still open (preference-summary.ts openChoices):
 * the subject while unknown, then unknown attributes asked first (brief.ts askFirst) whatever they
 * bear on, then other unknowns bearing on open choices, the one bearing on the most worth first,
 * are worth asking; an inferred one whose values steer or exclude open choices, worth confirming.
 */
export function briefContext(
  brief: readonly BriefItem[],
  open: readonly { variable: string; family: ChoiceFamily; worth: number }[]
): AiBrief {
  const whole = briefSteering(brief);
  const kept = open.filter(({ variable }) => !whole.excluded(variable));
  const ranked: { key: BriefKey; rank: Rank; worth: number }[] = [];
  const attributes = brief.map((item): AiBriefItem => {
    const attribute = briefAttribute(item.key);
    const known =
      item.status === 'unknown'
        ? {}
        : {
            value: item.value,
            ...(item.source ? { source: item.source } : {}),
            ...(item.tags ? { tags: item.tags } : {})
          };
    const offered = Object.keys(attribute.tags ?? {});
    const base = {
      key: item.key,
      question: attribute.question,
      status: item.status,
      ...known,
      ...(offered.length ? { offeredTags: offered } : {})
    };
    if (item.status === 'unknown') {
      if (attribute.bearsOn === 'subject') {
        ranked.push({ key: item.key, rank: 'subject', worth: Infinity });
        return { ...base, prompt: 'ask' };
      }
      if (attribute.bearsOn === 'inputs') return base;
      const families = attribute.bearsOn;
      const bearing = kept.filter(({ family }) => families.includes(family));
      if (!bearing.length && !attribute.askFirst) return base;
      ranked.push({
        key: item.key,
        rank: attribute.askFirst ? 'first' : 'unknown',
        worth: Math.max(0, ...bearing.map(({ worth }) => worth))
      });
      const decides = families.filter((f) => bearing.some(({ family }) => family === f));
      return {
        ...base,
        prompt: 'ask',
        ...(attribute.askFirst ? { first: true } : {}),
        ...(decides.length ? { decides } : {})
      };
    }
    if (item.status !== 'inferred') return base;
    const own = steering(steers(item));
    const steered = open.filter(
      ({ variable }) => own.excluded(variable) || own.weight(variable) !== 1
    );
    if (!steered.length) return base;
    ranked.push({
      key: item.key,
      rank: 'confirm',
      worth: Math.max(...steered.map(({ worth }) => worth))
    });
    return {
      ...base,
      prompt: 'confirm',
      decides: [...new Set(steered.map(({ family }) => family))]
    };
  });
  const avoid = brief
    .flatMap(steers)
    .flatMap(({ excludes }) => (excludes ? [`${excludes.what}: ${excludes.reason}`] : []));
  return {
    attributes,
    // By rank, then by the most worth each bears on.
    askFirst: ranked
      .toSorted((a, b) => ranks.indexOf(a.rank) - ranks.indexOf(b.rank) || b.worth - a.worth)
      .slice(0, listedAskFirst)
      .map(({ key }) => key),
    avoid
  };
}
