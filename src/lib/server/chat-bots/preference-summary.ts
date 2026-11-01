/**
 * The preference model's advice to the assistant (see preference-model.ts): for each choice of the
 * design the answers have touched, its likeliest option, how sure the model is, and whether it is
 * settled; which open choices are most worth asking next; and which have never been compared, by
 * family, so the assistant knows what is unexplored. Bounded, so it stays a small part of the
 * context whatever the design's size.
 */

import type { ProjectEvent } from '$lib/shared/projects/events';
import { choiceStates, preferenceEvidence } from '$lib/server/projects/preference-model';

import type { AiDesign } from './project-context';

type DesignValue = string | number | boolean;

/**
 * The families choices are explored by, the ones that change the picture most first: the views
 * drawn (views, pointers, the listing shown), what is shown, the arrangement (layouts, forms,
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
 * A choice's family and how much it changes the picture, from 0 to 1: views, pointers, what is
 * shown and the listing before forms and layouts, before shape, lettering and colour.
 */
export function choiceFamily(variable: string): { family: ChoiceFamily; impact: number } {
  if (variable.startsWith('views.') || variable.startsWith('pointers.'))
    return { family: 'views', impact: 1 };
  if (variable === 'listing.language') return { family: 'views', impact: 0.9 };
  if (variable.endsWith('.shown')) return { family: 'shown', impact: 0.9 };
  if (variable.startsWith('pause@')) return { family: 'pacing', impact: 0.6 };
  if (variable === 'layout') return { family: 'arrangement', impact: 0.8 };
  const prop = variable.slice(variable.lastIndexOf('.') + 1);
  switch (prop) {
    case 'form':
    case 'direction':
      return { family: 'arrangement', impact: 0.7 };
    case 'route':
    case 'curve':
    case 'ratio':
    case 'overflow':
      return { family: 'arrangement', impact: 0.45 };
    case 'justify':
    case 'align':
      return { family: 'arrangement', impact: 0.3 };
    case 'radius':
    case 'strokeWidth':
    case 'strokeStyle':
    case 'head':
    case 'headSize':
    case 'minSize':
      return { family: 'shape', impact: 0.25 };
    case 'font':
    case 'size':
    case 'weight':
      return { family: 'lettering', impact: 0.25 };
    case 'fill':
    case 'stroke':
    case 'color':
    case 'opacity':
      return { family: 'colour', impact: 0.15 };
    default:
      return { family: 'spacing', impact: 0.1 };
  }
}

/** Choices never worth asking on their own: a layout's seed only nudges its spacing. */
const unasked = (variable: string) => variable.endsWith('.layoutSeed');

/** One choice the answers touched. */
export type AiChoice = {
  variable: string;
  likeliest?: DesignValue;
  /** How likely the likeliest is the best of the options compared, from 0 to 1. */
  probability?: number;
  state: 'settled' | 'either' | 'open';
  /** The value it is settled at, where it is. */
  value?: DesignValue;
  answers: number;
  compared: number;
  /** Options it has that no answer compared. */
  unexplored: number;
};

/** A question worth asking next: one choice, or a family's choices asked together (colours). */
export type AiAskNext = { variables: string[]; family: ChoiceFamily; worth: number };

/** What the preference model believes, for the assistant. */
export type AiPreferences = {
  /** Comparisons answered by a side or either is fine, and those left for later. */
  answered: number;
  later: number;
  /** The choices the answers touched, those that change the picture most first. */
  choices: AiChoice[];
  moreChoices?: number;
  /** The open choices most worth asking next: uncertainty weighted by how much each changes. */
  askNext: AiAskNext[];
  /** Choices never compared, by family, with a few of each. */
  unexplored: { family: ChoiceFamily; count: number; examples: string[] }[];
};

// Bounds on the summary: about 2,000 characters for a large design.
const listedChoices = 16;
const listedAskNext = 6;
const examplesPerFamily = 4;
const variablesPerGroup = 4;

const rounded = (value: number) => Math.round(value * 100) / 100;

/** The model's summary over a design's choices, or undefined where the design has none. */
export function preferenceSummary(
  events: readonly ProjectEvent[],
  design: AiDesign
): AiPreferences | undefined {
  const choices = design.variables.flatMap(({ variable, options }) => {
    const listed = typeof options === 'string' ? (design.options[options] ?? []) : options;
    return listed.length > 1 && !unasked(variable) ? [{ variable, options: listed }] : [];
  });
  if (!choices.length) return undefined;
  const evidence = preferenceEvidence(events);
  const states = choiceStates(evidence);
  const answered = new Set(
    evidence.duels.filter(({ weight }) => weight === 1).map(({ eventId }) => eventId)
  );
  const touched: (AiChoice & { impact: number })[] = [];
  const open: { variable: string; family: ChoiceFamily; worth: number }[] = [];
  const unexplored = new Map<ChoiceFamily, { variable: string; impact: number }[]>();
  for (const { variable, options } of choices) {
    const { family, impact } = choiceFamily(variable);
    const state = states.get(variable);
    if (!state) {
      unexplored.set(family, [...(unexplored.get(family) ?? []), { variable, impact }]);
      open.push({ variable, family, worth: impact * (1 - 1 / options.length) });
      continue;
    }
    const compared = state.compared.filter((value) => options.includes(value)).length;
    touched.push({
      variable,
      ...(state.likeliest !== undefined ? { likeliest: state.likeliest } : {}),
      ...(state.probability !== undefined ? { probability: rounded(state.probability) } : {}),
      state: state.state,
      ...(state.value !== undefined && state.state !== 'open' ? { value: state.value } : {}),
      answers: state.answers,
      compared,
      unexplored: Math.max(0, options.length - compared),
      impact
    });
    if (state.state === 'open')
      open.push({ variable, family, worth: impact * (1 - (state.probability ?? 0.5)) });
  }
  // Colours are asked as a group (warm or cool highlights), not one variable at a time.
  const colours = open.filter(({ family }) => family === 'colour');
  const asked: AiAskNext[] = [
    ...open
      .filter(({ family }) => family !== 'colour')
      .map(({ variable, family, worth }) => ({ variables: [variable], family, worth })),
    ...(colours.length
      ? [
          {
            variables: colours
              .toSorted((a, b) => b.worth - a.worth)
              .slice(0, variablesPerGroup)
              .map(({ variable }) => variable),
            family: 'colour' as const,
            worth: Math.max(...colours.map(({ worth }) => worth))
          }
        ]
      : [])
  ]
    .toSorted((a, b) => b.worth - a.worth)
    .slice(0, listedAskNext)
    .map((entry) => ({ ...entry, worth: rounded(entry.worth) }));
  const listed = touched.toSorted((a, b) => b.impact - a.impact).slice(0, listedChoices);
  return {
    answered: answered.size,
    later: evidence.skipped,
    choices: listed.map(({ impact: _impact, ...choice }) => choice),
    ...(touched.length > listed.length ? { moreChoices: touched.length - listed.length } : {}),
    askNext: asked,
    unexplored: [...unexplored.entries()]
      .map(([family, variables]) => ({
        family,
        count: variables.length,
        examples: variables
          .toSorted((a, b) => b.impact - a.impact)
          .slice(0, examplesPerFamily)
          .map(({ variable }) => variable),
        impact: Math.max(...variables.map(({ impact }) => impact))
      }))
      .toSorted((a, b) => b.impact - a.impact)
      .map(({ impact: _impact, ...family }) => family)
  };
}
