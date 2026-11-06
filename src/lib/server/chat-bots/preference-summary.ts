/**
 * The preference model's advice to the assistant (see preference-model.ts): for each choice of the
 * design the answers have touched, its likeliest option, how sure the model is, and whether it is
 * settled; which open choices are most worth asking next; and which have never been compared, by
 * family, so the assistant knows what is unexplored; and the riskiest visual choice no alternative
 * has shown, to compare before asking more in words. Bounded, so it stays a small part of the
 * context whatever the design's size.
 */

import { isToken, tokenProps } from '$lib/modes/sverlin/library/node/design';
import { writtenKey } from '$lib/modes/sverlin/library/node/design-keys';
import type { ChoiceFamily } from '$lib/shared/projects/brief';
import type { ProjectEvent } from '$lib/shared/projects/events';
import {
  choiceStates,
  preferenceEvidence,
  type ChoiceState,
  type PreferenceEvidence
} from '$lib/server/projects/preference-model';

import type { BriefSteering } from '$lib/server/ai/context/brief-context';
import type { AiDesign } from '$lib/server/chat-bots/project-context';

type DesignValue = string | number | boolean;

/**
 * A choice's family and how much it changes the picture, from 0 to 1: views, pointers, what is
 * shown and the listing before forms and layouts, before shape, lettering and colour.
 */
export function choiceFamily(variable: string): { family: ChoiceFamily; impact: number } {
  if (variable.startsWith('views.') || variable.startsWith('pointers.'))
    return { family: 'views', impact: 1 };
  if (variable === 'listing.language') return { family: 'views', impact: 0.9 };
  if (variable.endsWith('.shown')) return { family: 'shown', impact: 0.9 };
  // A token is of the family of its prop, as $accent of colour.
  const prop = isToken(variable)
    ? tokenProps[variable]
    : variable.slice(variable.lastIndexOf('.') + 1);
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
    case 'textSize':
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
  /** A later answer preferred what an earlier one turned down. */
  reversed?: { earlier: DesignValue; later: DesignValue };
};

/** A question worth asking next: one choice, or a family's choices asked together (colours). */
export type AiAskNext = { variables: string[]; family: ChoiceFamily; worth: number };

/**
 * The riskiest visual choice no alternative has shown yet, to compare before asking in words: a free
 * layout (its form, direction and seed, a first automatic layout being a guess), or else the
 * never-compared choice of views or arrangement most worth asking.
 */
export type AiShowFirst = { variables: string[]; family: ChoiceFamily; layout?: true };

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
  showFirst?: AiShowFirst;
};

// Bounds on the summary: about 2,000 characters for a large design.
const listedChoices = 16;
const listedAskNext = 6;
const examplesPerFamily = 4;
const variablesPerGroup = 4;

const rounded = (value: number) => Math.round(value * 100) / 100;

/** A choice of the design worth asking about, and where the answers have left it. */
type Standing = {
  variable: string;
  options: readonly DesignValue[];
  family: ChoiceFamily;
  impact: number;
  state?: ChoiceState;
};

type Standings = {
  evidence: PreferenceEvidence;
  choices: Standing[];
  /** Every variable the evidence touched, the seeds left out of choices included. */
  touched: ReadonlySet<string>;
  eventCount: number;
};

/**
 * Standings by events and design, so the summary and openChoices fit the model once per context; an
 * events array appended to since is fitted again.
 */
const fitted = new WeakMap<readonly ProjectEvent[], WeakMap<AiDesign, Standings>>();

function standings(events: readonly ProjectEvent[], design: AiDesign): Standings {
  const known = fitted.get(events)?.get(design);
  if (known?.eventCount === events.length) return known;
  const evidence = preferenceEvidence(events);
  const states = choiceStates(evidence);
  const choices = design.variables.flatMap(({ variable, options }): Standing[] => {
    const listed = typeof options === 'string' ? (design.options[options] ?? []) : options;
    if (listed.length < 2 || unasked(variable)) return [];
    const state = states.get(variable);
    return [{ variable, options: listed, ...choiceFamily(variable), ...(state ? { state } : {}) }];
  });
  const result = { evidence, choices, touched: new Set(states.keys()), eventCount: events.length };
  fitted.set(events, (fitted.get(events) ?? new WeakMap()).set(design, result));
  return result;
}

/** A free layout's props a comparison of its arrangement varies (design.ts freeLayoutProps). */
const layoutProps = ['form', 'direction', 'layoutSeed'] as const;
/** Those, or its curve, compared or asked for: its arrangement has been seen in an alternative. */
const seenLayoutProps = [...layoutProps, 'curve'];

/** Families whose choices change the picture enough to show before asking about them in words. */
const shownFirst: ReadonlySet<ChoiceFamily> = new Set(['views', 'arrangement']);
/** Below this impact a choice is a detail (a route, an alignment), not a risk worth showing first. */
const showFirstImpact = 0.45;

/**
 * The riskiest choice no alternative has shown: a free layout never compared first (only a free
 * layout has a seed), the one whose form or direction is most worth asking, then the never-compared
 * choice of views or arrangement most worth asking, each by the brief's weights.
 */
function riskiest(
  { choices, touched }: Standings,
  design: AiDesign,
  steering: BriefSteering | undefined
): AiShowFirst | undefined {
  const kept = (variable: string) => !steering?.excluded(variable);
  const worth = (choice: Standing) =>
    (openWorth(choice) ?? 0) * (steering?.weight(choice.variable) ?? 1);
  const present = new Set(design.variables.map(({ variable }) => variable));
  const layoutKinds = design.variables
    .filter(({ variable }) => variable.endsWith('.layoutSeed'))
    .map(({ variable }) => variable.slice(0, -'.layoutSeed'.length));
  const ofLayout = new Set(
    layoutKinds.flatMap((kind) => seenLayoutProps.map((prop) => `${kind}.${prop}`))
  );
  const [layout] = layoutKinds
    .filter((kind) => !seenLayoutProps.some((prop) => touched.has(`${kind}.${prop}`)))
    .map((kind) => {
      const variables = layoutProps
        .map((prop) => `${kind}.${prop}`)
        .filter((variable) => present.has(variable) && kept(variable));
      const arranging = choices.filter(({ variable }) => variables.includes(variable));
      return { variables, worth: Math.max(0, ...arranging.map(worth)) };
    })
    .filter(({ variables }) => variables.length)
    .toSorted((a, b) => b.worth - a.worth);
  if (layout) return { variables: layout.variables, family: 'arrangement', layout: true };
  const [unseen] = choices
    .filter(
      (choice) =>
        !choice.state &&
        !ofLayout.has(choice.variable) &&
        shownFirst.has(choice.family) &&
        choice.impact >= showFirstImpact &&
        kept(choice.variable)
    )
    .toSorted((a, b) => worth(b) - worth(a));
  return unseen ? { variables: [unseen.variable], family: unseen.family } : undefined;
}

/** How much a choice still open is worth asking: uncertainty weighted by how much it changes. */
const openWorth = ({ options, impact, state }: Standing) =>
  !state
    ? impact * (1 - 1 / options.length)
    : state.state === 'open'
      ? impact * (1 - (state.probability ?? 0.5))
      : undefined;

/** The choices still open, each with how much asking it is worth, before the brief weighs them. */
export function openChoices(
  events: readonly ProjectEvent[],
  design: AiDesign
): { variable: string; family: ChoiceFamily; worth: number }[] {
  return standings(events, design).choices.flatMap((choice) => {
    const worth = openWorth(choice);
    return worth === undefined ? [] : [{ variable: choice.variable, family: choice.family, worth }];
  });
}

/**
 * The model's summary over a design's choices, or undefined where the design has none. The brief's
 * steering, where given, weights what is worth asking and leaves out what it keeps out of
 * comparisons.
 */
export function preferenceSummary(
  events: readonly ProjectEvent[],
  design: AiDesign,
  steering?: BriefSteering
): AiPreferences | undefined {
  const standing = standings(events, design);
  const { evidence, choices } = standing;
  if (!choices.length) return undefined;
  // The variables as the assistant writes them (see design-keys.ts), as {Int} for views.Int.
  const known = new Set(design.variables.map(({ variable }) => variable));
  const written = (variable: string) => writtenKey(variable, (key) => known.has(key));
  const showFirst = riskiest(standing, design, steering);
  const answered = new Set(
    evidence.duels.filter(({ weight }) => weight === 1).map(({ eventId }) => eventId)
  );
  const touched: (AiChoice & { impact: number })[] = [];
  const open: { variable: string; family: ChoiceFamily; worth: number }[] = [];
  const unexplored = new Map<ChoiceFamily, { variable: string; impact: number }[]>();
  for (const choice of choices) {
    const { variable, options, family, impact, state } = choice;
    const kept = !steering?.excluded(variable);
    const worth = openWorth(choice);
    if (kept && worth !== undefined)
      open.push({ variable, family, worth: worth * (steering?.weight(variable) ?? 1) });
    if (!state) {
      if (kept) unexplored.set(family, [...(unexplored.get(family) ?? []), { variable, impact }]);
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
      ...(state.reversed ? { reversed: state.reversed } : {}),
      impact
    });
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
  // A reversed choice first, so the bound never hides one the assistant should ask about.
  const listed = touched
    .toSorted((a, b) => Number(!!b.reversed) - Number(!!a.reversed) || b.impact - a.impact)
    .slice(0, listedChoices);
  return {
    answered: answered.size,
    later: evidence.skipped,
    choices: listed.map(({ impact: _impact, ...choice }) => ({
      ...choice,
      variable: written(choice.variable)
    })),
    ...(touched.length > listed.length ? { moreChoices: touched.length - listed.length } : {}),
    askNext: asked.map((entry) => ({ ...entry, variables: entry.variables.map(written) })),
    unexplored: [...unexplored.entries()]
      .map(([family, variables]) => ({
        family,
        count: variables.length,
        examples: variables
          .toSorted((a, b) => b.impact - a.impact)
          .slice(0, examplesPerFamily)
          .map(({ variable }) => written(variable)),
        impact: Math.max(...variables.map(({ impact }) => impact))
      }))
      .toSorted((a, b) => b.impact - a.impact)
      .map(({ impact: _impact, ...family }) => family),
    ...(showFirst
      ? { showFirst: { ...showFirst, variables: showFirst.variables.map(written) } }
      : {})
  };
}
