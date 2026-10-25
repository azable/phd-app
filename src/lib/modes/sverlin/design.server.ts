/**
 * A source's design space, generated from its markup and the library, and the variants built in it.
 * Every visual attribute is a variable: each kind of node's props, each type's view, and the page
 * frame's settings. A variant gives every one a value; the starter is the first, and choosers make
 * the rest from it.
 */

import { keyedRandom } from './algorithm/random.server';
import {
  colourParts,
  frameOptions,
  listingOptions,
  optionsOf,
  roleProps,
  starterFrame,
  starterListing,
  starterLooks,
  type DesignValues,
  type KindRole
} from './library/node/design';

/** A value a variable can take. */
export type DesignValue = string | number | boolean;

/** A kind of node: its key, the snippet it is in (as Compared.Pointed), and what it is, giving its props. */
export type DesignKind = { key: string; role: KindRole };

const propsOf = ({ role }: DesignKind) => roleProps[role];

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
 * Every variable of a source: each type's views, each position type's pointer views where it is
 * rendered as a pointer, the frame's settings, a listing's if the view
 * places one (its languages the source's own listings first, then the library's), which events are
 * steps if it can step by more than one (frames, its options the source's frame rules, the first
 * where it starts), and each kind's props.
 */
export function designSpace(
  kinds: readonly DesignKind[],
  views: Readonly<Record<string, readonly string[]>>,
  listing = false,
  frames: readonly string[] = [],
  ownListings: readonly string[] = [],
  pointers: Readonly<Record<string, readonly string[]>> = {}
): DesignSpace {
  return {
    ...(frames.length > 1 ? { frames: [...frames] } : {}),
    ...Object.fromEntries(
      Object.entries(views).map(([type, options]) => [`views.${type}`, [...options, 'none']])
    ),
    ...Object.fromEntries(
      Object.entries(pointers).map(([type, options]) => [`pointers.${type}`, [...options, 'none']])
    ),
    ...frameOptions,
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
    )
  };
}

/** The first variant of a source: each type in its first view, and each kind in its role's look. */
export function starterVariant(
  kinds: readonly DesignKind[],
  views: Readonly<Record<string, readonly string[]>>,
  listing = false,
  frames: readonly string[] = [],
  ownListings: readonly string[] = [],
  pointers: Readonly<Record<string, readonly string[]>> = {}
): Record<string, DesignValue> {
  return {
    ...(frames.length > 1 ? { frames: frames[0] } : {}),
    ...Object.fromEntries(
      Object.entries(views).map(([type, options]) => [`views.${type}`, options[0]])
    ),
    ...Object.fromEntries(
      Object.entries(pointers).map(([type, options]) => [`pointers.${type}`, options[0]])
    ),
    ...starterFrame,
    // The source's first listing is the one it starts with.
    ...(listing
      ? {
          ...starterListing,
          'listing.language': ownListings[0] ?? starterListing['listing.language']
        }
      : {}),
    ...Object.fromEntries(
      kinds.flatMap((kind) =>
        propsOf(kind).map((prop) => [`${kind.key}.${prop}`, starterLooks[kind.role][prop]])
      )
    )
  };
}

const fits = (space: DesignSpace, key: string, value: unknown) =>
  Object.hasOwn(space, key) && space[key].includes(value as DesignValue);

/** Explain a chosen value the space cannot take. */
function unfit(space: DesignSpace, key: string, value: unknown): string {
  if (!Object.hasOwn(space, key)) {
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
                  !other.startsWith('frame.') &&
                  !other.startsWith('listing.') &&
                  other !== 'frames'
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
 * has no place for is an error naming it.
 */
export function buildVariant(
  space: DesignSpace,
  starter: Readonly<Record<string, DesignValue>>,
  request: VariantRequest,
  seed: number
): { values: Record<string, DesignValue>; origins: Record<string, DesignOrigin> } {
  const chosen = Object.entries(request.chosen ?? {});
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
  for (const [key, value] of Object.entries(request.base ?? {}))
    if (fits(space, key, value)) {
      values[key] = value as DesignValue;
      origins[key] = 'kept';
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
  return { values, origins };
}

/**
 * The prop a variable sets, as fill for Compared.Pointed.fill, views for a choice of views
 * (views.Int, pointers.Index), and frame for the frame's.
 */
function propOf(key: string): string {
  if (key.startsWith('views.') || key.startsWith('pointers.')) return 'views';
  if (key.startsWith('frame.')) return key;
  return key.slice(key.lastIndexOf('.') + 1);
}

/**
 * Props a random variant leaves as they were: what is shown, how things line up, the frame, and a
 * listing's language.
 */
const kept = new Set<string>([
  'frames',
  'language',
  'shown',
  'opacity',
  'align',
  'justify',
  'strokeStyle',
  'minSize',
  'overflow'
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
  for (const [key, value] of Object.entries(values)) {
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
  if (prop.startsWith('frame.') || kept.has(prop)) return value;
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
