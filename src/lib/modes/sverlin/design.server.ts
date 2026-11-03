/**
 * A source's design space, generated from its markup and the library, and the variants built in it.
 * Every visual attribute is a variable: each kind of node's props, each type's view, and the page
 * frame's settings. A variant gives every one a value; the starter is the first, and choosers make
 * the rest from it.
 */

import { keyedRandom } from './algorithm/random.server';
import type { LayoutStructure } from './structure.server';
import {
  colourParts,
  frameOptions,
  freeLayoutProps,
  listingOptions,
  listingPropOptions,
  listingRegionProps,
  optionsOf,
  placeProps,
  roleProps,
  starterFrame,
  starterFreeLayout,
  starterListing,
  starterLooks,
  type DesignValues,
  type KindRole
} from './library/node/design';

/** A value a variable can take. */
export type DesignValue = string | number | boolean;

/**
 * A kind of node: its key, the snippet it is in (as Compared.Pointed), what it is, giving its props,
 * and, where it arranges a free layout, whose look its props hold too, the structure its data makes
 * (see structure.server.ts) and the flow its node sets; and, for a link's kind, whether every link
 * of it is a two-way line, whose head starts as none.
 */
export type DesignKind = {
  key: string;
  role: KindRole;
  free?: { structure: LayoutStructure; flow?: 'x' | 'y' };
  lines?: true;
};

// A layout whose data makes no structure has no form to choose: the page lays it out freely, or in
// the natural form of a structure it finds that the trace could not show. One whose flow sets the
// way it runs has no direction.
const propsOf = ({ role, free }: DesignKind) =>
  free
    ? [
        ...roleProps[role],
        ...freeLayoutProps.filter((prop) =>
          prop === 'form'
            ? free.structure !== 'none'
            : prop === 'direction'
              ? free.structure !== 'none' && !free.flow
              : true
        )
      ]
    : roleProps[role];

/**
 * A kind's starting value for a prop: a free layout runs right, across the wide stage, unless its
 * structure is a tree, which branches down as trees are drawn; and a link's head is none where
 * every link of its kind is a two-way line, as an undirected graph's edges.
 */
const starterLook = ({ role, free, lines }: DesignKind, prop: string) =>
  prop === 'direction' && free
    ? free.structure === 'tree'
      ? 'down'
      : 'right'
    : prop === 'head' && lines
      ? 'none'
      : (starterLooks[role][prop] ?? starterFreeLayout[prop]);

/**
 * A source's places (see Place in library/node/design.ts): their kinds, whose props are those a
 * place sets, and their own choices of view, as views.Int@swap.held.
 */
export type DesignPlaces = {
  kinds: readonly DesignKind[];
  choices: readonly { key: string; options: readonly string[] }[];
};

const placePropsOf = ({ role }: DesignKind) =>
  roleProps[role].filter((prop) => placeProps.has(prop));

/**
 * The layout shown, never none, and each layout's frame, as Stacked.ratio, of the page's layouts by
 * name, the first shown where a variant names none.
 */
function layoutSpace(names: readonly string[]): DesignSpace {
  return {
    layout: [...names],
    ...Object.fromEntries(
      names.flatMap((name) =>
        Object.entries(frameOptions).map(([prop, options]) => [`${name}.${prop}`, options])
      )
    )
  };
}

function layoutStarter(names: readonly string[]): Record<string, DesignValue> {
  return {
    layout: names[0],
    ...Object.fromEntries(
      names.flatMap((name) =>
        Object.keys(frameOptions).map((prop) => [
          `${name}.${prop}`,
          starterFrame[prop as keyof typeof starterFrame]
        ])
      )
    )
  };
}

const kindOf = (key: string) => key.slice(0, Math.max(0, key.lastIndexOf('.')));

/** The layouts of a space: the kinds with a frame. */
const framedKinds = (space: DesignSpace) =>
  new Set(
    Object.keys(space)
      .filter((key) => key.endsWith('.ratio'))
      .map((key) => key.slice(0, -'.ratio'.length))
  );

/** Each variable's options, by key. */
export type DesignSpace = Readonly<Record<string, readonly DesignValue[]>>;

/** Where a value came from: chosen for the build, kept from the variant built on, drawn, or the starter's. */
export type DesignOrigin = 'chosen' | 'kept' | 'random' | 'starter';

/**
 * What a build starts from. Chosen values must each name a variable and be one of its options. A
 * base variant's values are kept where they still fit; the starter gives the rest. Randomise
 * draws afresh: every variable (true), keeping the base's equalities, or the variables named.
 */
export type VariantRequest = {
  chosen?: Readonly<Record<string, unknown>>;
  base?: Readonly<Record<string, unknown>>;
  randomise?: true | readonly string[];
};

/** A value the design space has no place for, or a variable it does not have. */
export class DesignValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignValueError';
  }
}

/**
 * Where and how the steps pause: each label of the algorithm, by its full name, as
 * pause@insert.swap.to, accumulating, on, or off, the first how it pauses where it is switched on;
 * one with no labels inside it, which has no pauses inside it, only on or off (see PauseMode in
 * algorithm/interpret.server.ts).
 */
export function pauseSpace(labels: readonly string[], leaves: ReadonlySet<string>): DesignSpace {
  return Object.fromEntries(
    labels.map((label) => [
      `pause@${label}`,
      leaves.has(label) ? ['on', 'off'] : ['accumulate', 'on', 'off']
    ])
  );
}

/**
 * The variable a place falls back to until a variant sets it apart: one variable, or, where it
 * hangs on a choice of view, the one for the view chosen (`by`, its value naming a key in `of`),
 * else `otherwise`.
 */
export type Fallback =
  | string
  | { by: string; of: Readonly<Record<string, string>>; otherwise: string };

/** The variable a fallback names, under the values given. */
function fallbackOf(fallback: Fallback, values: Readonly<Record<string, unknown>>): string {
  return typeof fallback === 'string'
    ? fallback
    : (fallback.of[String(values[fallback.by])] ?? fallback.otherwise);
}

/**
 * A listing's regions as places, by their labels' full names: each region's own paint, as
 * listing.lit@insert.compare.left.fill, with the listing's options.
 */
export function listingRegionSpace(labels: readonly string[]): DesignSpace {
  return Object.fromEntries(
    labels.flatMap((label) =>
      listingRegionProps.map((prop) => [
        `listing.lit@${label}.${prop}`,
        listingPropOptions(prop) ?? []
      ])
    )
  );
}

/**
 * The variable each region's paint falls back to: its label's mark where the root draws the label
 * as a pointer (`marks`, by label, the kind the place draws, or its views by the choice naming one),
 * so its code looks as its cell does; else the listing's own lit look.
 */
export function listingRegionFallbacks(
  labels: readonly string[],
  marks: ReadonlyMap<string, { kinds: Readonly<Record<string, string>>; by?: string }>
): Record<string, Fallback> {
  return Object.fromEntries(
    labels.flatMap((label) =>
      listingRegionProps.map((prop): [string, Fallback] => {
        const own = `listing.lit.${prop}`;
        const mark = marks.get(label);
        const kinds = Object.entries(mark?.kinds ?? {});
        const fallback: Fallback = !mark
          ? own
          : mark.by
            ? {
                by: mark.by,
                of: Object.fromEntries(kinds.map(([view, kind]) => [view, `${kind}.${prop}`])),
                otherwise: own
              }
            : kinds.length
              ? `${kinds[0][1]}.${prop}`
              : own;
        return [`listing.lit@${label}.${prop}`, fallback];
      })
    )
  );
}

/**
 * The pauses a source starts with: every label on, for the assistant and chooser to thin, except
 * those whose runs, paced at every label, all draw what the step before drew (runs from its
 * build). A label that never ran, or never names a step, adds no step and stays on, so it pauses
 * where another input runs it; where no label's runs draw anything, every label stays on, so the
 * steps still walk the code.
 */
export function starterPauses(
  labels: readonly string[],
  runs: Readonly<Record<string, { runs: number; drawn: number }>> = {}
): Record<string, DesignValue> {
  const silent = (label: string) => (runs[label]?.runs ?? 0) > 0 && runs[label].drawn === 0;
  const thinned = labels.some((label) => !silent(label));
  return Object.fromEntries(
    labels.map((label) => [`pause@${label}`, thinned && silent(label) ? 'off' : 'on'])
  );
}

/** A pause@ value, accumulating at a label with no labels inside it as on; any other as it is. */
function asPause(space: DesignSpace, key: string, value: unknown): unknown {
  if (!key.startsWith('pause@') || !Object.hasOwn(space, key)) return value;
  return value === 'accumulate' && !space[key].includes(value) ? 'on' : value;
}

/**
 * Every variable of a source: each type's views, each position type's pointer views where it is
 * rendered as a pointer, a listing's if the view places one (its languages the source's own listings
 * first, then the library's), each kind's props, each place's, and the layout shown and each
 * layout's frame, after the kinds, as a layout's kind holds the nodes its body writes too.
 */
export function designSpace(
  kinds: readonly DesignKind[],
  views: Readonly<Record<string, readonly string[]>>,
  listing = false,
  ownListings: readonly string[] = [],
  pointers: Readonly<Record<string, readonly string[]>> = {},
  places: DesignPlaces = { kinds: [], choices: [] },
  layouts: readonly string[]
): DesignSpace {
  return {
    ...Object.fromEntries(
      Object.entries(views).map(([type, options]) => [`views.${type}`, [...options, 'none']])
    ),
    ...Object.fromEntries(
      Object.entries(pointers).map(([type, options]) => [`pointers.${type}`, [...options, 'none']])
    ),
    ...(listing
      ? {
          ...listingOptions,
          'listing.language': [...ownListings, ...listingOptions['listing.language']]
        }
      : {}),
    ...Object.fromEntries(
      kinds.flatMap((kind) =>
        propsOf(kind).map((prop) => [`${kind.key}.${prop}`, optionsOf(kind.role, prop)])
      )
    ),
    ...Object.fromEntries(places.choices.map(({ key, options }) => [key, [...options, 'none']])),
    ...Object.fromEntries(
      places.kinds.flatMap((kind) =>
        placePropsOf(kind).map((prop) => [`${kind.key}.${prop}`, optionsOf(kind.role, prop)])
      )
    ),
    ...layoutSpace(layouts)
  };
}

/** The first variant of a source: each type in its first view, and each kind in its role's look. */
export function starterVariant(
  kinds: readonly DesignKind[],
  views: Readonly<Record<string, readonly string[]>>,
  listing = false,
  ownListings: readonly string[] = [],
  pointers: Readonly<Record<string, readonly string[]>> = {},
  places: DesignPlaces = { kinds: [], choices: [] },
  layouts: readonly string[]
): Record<string, DesignValue> {
  return {
    ...Object.fromEntries(
      Object.entries(views).map(([type, options]) => [`views.${type}`, options[0]])
    ),
    ...Object.fromEntries(
      Object.entries(pointers).map(([type, options]) => [`pointers.${type}`, options[0]])
    ),
    // The source's first listing is the one it starts with.
    ...(listing
      ? {
          ...starterListing,
          'listing.language': ownListings[0] ?? starterListing['listing.language']
        }
      : {}),
    ...Object.fromEntries(
      kinds.flatMap((kind) =>
        propsOf(kind).map((prop) => [`${kind.key}.${prop}`, starterLook(kind, prop)])
      )
    ),
    // A place starts as its type and kinds do.
    ...Object.fromEntries(places.choices.map(({ key, options }) => [key, options[0]])),
    ...Object.fromEntries(
      places.kinds.flatMap((kind) =>
        placePropsOf(kind).map((prop) => [`${kind.key}.${prop}`, starterLooks[kind.role][prop]])
      )
    ),
    ...layoutStarter(layouts)
  };
}

const fits = (space: DesignSpace, key: string, value: unknown) =>
  Object.hasOwn(space, key) && space[key].includes(value as DesignValue);

/** Explain a chosen value the space cannot take. */
function unfit(space: DesignSpace, key: string, value: unknown): string {
  if (!Object.hasOwn(space, key)) {
    if (key.startsWith('pause@')) {
      const pauses = Object.keys(space).filter((other) => other.startsWith('pause@'));
      return `The design has no variable ${key}; a pause names a label by its full name, and its pauses are ${pauses.join(', ') || 'none'}.`;
    }
    // A view choice, a type's or a place's, is one variable, not a kind and a prop.
    if (key.startsWith('views.') || key.startsWith('pointers.')) {
      const choices = Object.keys(space).filter(
        (other) => other.startsWith('views.') || other.startsWith('pointers.')
      );
      return `The design has no variable ${key}; its view choices are ${choices.join(', ') || 'none'}.`;
    }
    const kind = key.slice(0, key.lastIndexOf('.'));
    const near = Object.keys(space).filter((other) => other.startsWith(`${kind}.`));
    return near.length
      ? `${kind} has no prop ${key.slice(kind.length + 1)}; its variables are ${near.join(', ')}.`
      : `The design has no variable ${key}; its kinds of node are ${[
          ...new Set(
            Object.keys(space)
              .filter(
                (other) =>
                  !other.startsWith('views.') &&
                  !other.startsWith('pointers.') &&
                  other !== 'layout' &&
                  !other.startsWith('pause@') &&
                  !other.startsWith('listing.')
              )
              .map((other) => other.slice(0, other.lastIndexOf('.')))
          )
        ].join(', ')}.`;
  }
  const options = space[key];
  const shown =
    options.length > 12
      ? `${options
          .slice(0, 6)
          .map((option) => JSON.stringify(option))
          .join(', ')}, … (${options.length} in all)`
      : options.map((option) => JSON.stringify(option)).join(', ');
  return `${key} cannot be ${JSON.stringify(value)}; its options are ${shown}.`;
}

/**
 * The complete variant a build takes, and where each value came from: the starter, then the base's
 * values that still fit, then any randomising, then the chosen values. A chosen value the space
 * has no place for is an error naming it. A place's variable (`fallbacks`, by key, the variable it
 * falls back to) then takes the value of its own unless it is chosen, drawn by name, or set apart
 * in the base, so a place looks as its type and kinds do until a variant sets it.
 */
export function buildVariant(
  space: DesignSpace,
  starter: Readonly<Record<string, DesignValue>>,
  request: VariantRequest,
  seed: number,
  fallbacks: Readonly<Record<string, Fallback>> = {}
): { values: Record<string, DesignValue>; origins: Record<string, DesignOrigin> } {
  const chosen = Object.entries(request.chosen ?? {}).map(
    ([key, value]) => [key, asPause(space, key, value)] as const
  );
  const problems = chosen
    .filter(([key, value]) => !fits(space, key, value))
    .map(([key, value]) => unfit(space, key, value));
  const named = request.randomise === true ? [] : (request.randomise ?? []);
  problems.push(
    ...named.filter((key) => !Object.hasOwn(space, key)).map((key) => unfit(space, key, undefined))
  );
  if (problems.length) throw new DesignValueError(problems.join(' '));
  const values: Record<string, DesignValue> = { ...starter };
  const origins: Record<string, DesignOrigin> = Object.fromEntries(
    Object.keys(starter).map((key) => [key, 'starter' as const])
  );
  const base = request.base ?? {};
  for (const [key, saved] of Object.entries(base)) {
    const value = asPause(space, key, saved);
    if (fits(space, key, value)) {
      values[key] = value as DesignValue;
      origins[key] = 'kept';
    }
  }
  const drawn =
    request.randomise === true
      ? randomised(space, values, seed)
      : Object.fromEntries(named.map((key) => [key, drawOne(space, key, values[key], seed)]));
  for (const [key, value] of Object.entries(drawn)) {
    if (value === values[key]) continue;
    values[key] = value;
    origins[key] = 'random';
  }
  for (const [key, value] of chosen) {
    values[key] = value as DesignValue;
    origins[key] = 'chosen';
  }
  // In order, so a place falling back to another place, as a listing's region to its label's mark,
  // takes the value that one has come to.
  for (const [key, given] of Object.entries(fallbacks)) {
    const was = fallbackOf(given, { ...values, ...base });
    const apart =
      Object.hasOwn(base, key) && base[key] !== base[was] && fits(space, key, base[key]);
    if (apart || named.includes(key) || chosen.some(([name]) => name === key)) continue;
    const fallback = fallbackOf(given, values);
    if (!Object.hasOwn(values, fallback) || !fits(space, key, values[fallback])) continue;
    values[key] = values[fallback];
    origins[key] = origins[fallback];
  }
  return { values, origins };
}

/**
 * The prop a variable sets, as fill for Compared.Pointed.fill, views for a choice of views
 * (views.Int, pointers.Index) or of layouts, and the variable itself for the pauses.
 */
function propOf(key: string): string {
  if (key.startsWith('views.') || key.startsWith('pointers.') || key === 'layout') return 'views';
  if (key.startsWith('pause@')) return key;
  return key.slice(key.lastIndexOf('.') + 1);
}

/**
 * Props a random variant leaves as they were: what is shown, how things line up, the frame, where
 * the steps pause, a listing's language, and a text's decoration, as a line through it can mean it
 * is gone.
 */
const kept = new Set<string>([
  'language',
  'shown',
  'opacity',
  'align',
  'justify',
  'strokeStyle',
  'minSize',
  'overflow',
  'decoration'
]);
const colourProps = new Set<string>(['fill', 'stroke', 'color']);
const lengthProps = new Set<string>(['strokeWidth', 'size', 'padding', 'radius', 'gap']);

/**
 * A fresh value for every variable, keeping the variant's equalities: variables of one prop that
 * share a value draw one new value together, so every white fill becomes one colour. Colours keep
 * their shade, so text stays as readable against its fill; lengths stay within two steps; nothing
 * shown or left out changes, nor anything that is none or 0.
 */
function randomised(
  space: DesignSpace,
  values: Readonly<Record<string, DesignValue>>,
  seed: number
): Record<string, DesignValue> {
  const groups = new Map<string, string[]>();
  const frames = framedKinds(space);
  for (const [key, value] of Object.entries(values)) {
    if (frames.has(kindOf(key))) continue;
    const group = `${propOf(key)}=${JSON.stringify(value)}`;
    groups.set(group, [...(groups.get(group) ?? []), key]);
  }
  const drawn: Record<string, DesignValue> = {};
  for (const [group, keys] of groups) {
    const value = drawOne(space, keys[0], values[keys[0]], seed, group);
    for (const key of keys) drawn[key] = space[key].includes(value) ? value : values[key];
  }
  return drawn;
}

/** A fresh value for one variable (or one group of equal variables), by the rules of randomised. */
function drawOne(
  space: DesignSpace,
  key: string,
  value: DesignValue,
  seed: number,
  stream = key
): DesignValue {
  const prop = propOf(key);
  const options = space[key];
  const pick = (candidates: readonly DesignValue[]) =>
    candidates.length
      ? candidates[Math.floor(keyedRandom(seed, stream) * candidates.length)]
      : value;
  if (prop === 'views') return value === 'none' ? value : pick(options.filter((o) => o !== 'none'));
  if (prop.startsWith('pause@') || kept.has(prop) || framedKinds(space).has(kindOf(key)))
    return value;
  if (colourProps.has(prop)) {
    const parts = typeof value === 'string' ? colourParts(value) : undefined;
    if (!parts) return value;
    return pick(
      options.filter(
        (option) => typeof option === 'string' && colourParts(option)?.shade === parts.shade
      )
    );
  }
  if (lengthProps.has(prop)) {
    if (value === 0) return value;
    const at = options.indexOf(value);
    return pick(options.slice(Math.max(1, at - 2), at + 3).filter((option) => option !== 0));
  }
  return pick(options);
}

export type { DesignValues };
