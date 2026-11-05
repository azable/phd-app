/**
 * A source's design space, generated from its markup and the library, and the variants built in it.
 * Every visual attribute is a variable: each kind of node's props, each type's view, and the page
 * frame's settings. A variant gives every one a value; the starter is the first, and the others
 * take the values the assistant gives, the rest drawn at random.
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
  placePaint,
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
  /** For a collection's node, the axis its items run along and whether its length never changes. */
  collection?: { axis: 'x' | 'y'; steady: boolean };
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
 * every link of its kind is a two-way line, as an undirected graph's edges. A collection's box,
 * where it varies, starts where its first item is, so the items already there stay as it grows; and
 * its items sit in the middle of its room where its length never changes, at its start where it
 * does, so none moves as one comes or goes.
 */
const starterLook = ({ role, free, lines, collection }: DesignKind, prop: string) =>
  prop === 'direction' && free
    ? free.structure === 'tree'
      ? 'down'
      : 'right'
    : prop === 'head' && lines
      ? 'none'
      : collection && prop === (collection.axis === 'x' ? 'xAnchor' : 'yAnchor')
        ? 'start'
        : collection && prop === 'justify'
          ? collection.steady
            ? 'center'
            : 'start'
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

/** Each page layout's frame, as Stacked.ratio, by the layout's name; the scenes say which shows. */
function layoutSpace(names: readonly string[]): DesignSpace {
  return {
    ...Object.fromEntries(
      names.flatMap((name) =>
        Object.entries(frameOptions).map(([prop, options]) => [`${name}.${prop}`, options])
      )
    )
  };
}

function layoutStarter(names: readonly string[]): Record<string, DesignValue> {
  return {
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
 * The variable choosing the view of a type, as views.Int; for a view typed by a label, the label as
 * written, as views.@insert.compare for the operator ℓinsertˑcompare (see withLabelOperators).
 */
export const viewKey = (type: string): string =>
  type.startsWith('ℓ') ? `views.@${type.slice(1).replaceAll('ˑ', '.')}` : `views.${type}`;

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
 * Every variable of a source: each type's views, each position type's pointer views where it is
 * rendered as a pointer, a listing's if the view places one (its languages the source's own listings
 * first, then the library's), each kind's props, each place's, and each
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
      Object.entries(views).map(([type, options]) => [viewKey(type), [...options, 'none']])
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
  // A pointer view's icon marks where it points, so it starts as an arrow up at the element.
  const pointerViews = new Set(
    kinds.flatMap(({ key }) => (key.endsWith('.Pointed') ? [key.slice(0, -'.Pointed'.length)] : []))
  );
  return {
    ...Object.fromEntries(
      Object.entries(views).map(([type, options]) => [viewKey(type), options[0]])
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
        propsOf(kind).map((prop) => [
          `${kind.key}.${prop}`,
          prop === 'icon' && pointerViews.has(kind.key.split('.')[0])
            ? 'arrow-up'
            : starterLook(kind, prop)
        ])
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
    // A size the view binds to its value has no variable of its own; its kind's anchor places it.
    if (/\.(width|height)$/u.test(key) && Object.hasOwn(space, `${key}@unit`)) {
      const kind = kindOf(key);
      const axis = key.endsWith('.width') ? 'width' : 'height';
      return `${kind}'s ${axis} is bound to its value in the view, ${axis}={…}, so it has no ${axis} variable; ${kind}.${axis === 'width' ? 'x' : 'y'}Anchor places it.`;
    }
    if (key.startsWith('pause@'))
      return `The design has no variable ${key}: the steps a scene shows are its pause, in the source, as <Scene name="…" pause="@${key.slice('pause@'.length)}">.`;
    // A view choice, a type's or a place's, is one variable, not a kind and a prop.
    if (key.startsWith('views.') || key.startsWith('pointers.')) {
      const choices = Object.keys(space).filter(
        (other) => other.startsWith('views.') || other.startsWith('pointers.')
      );
      // A position draws as a mark only in the root of a layout a scene shows (see Pointers).
      const type = /^pointers\.([^@]+)/u.exec(key)?.[1];
      const unmarked =
        type && !Object.hasOwn(space, `pointers.${type}`)
          ? ` No ${type} draws as a pointer: a position draws as a mark only where it is rendered in a page layout's root itself, outside other nodes; inside a node it draws as its number (views.${type}), and in a layout another layout draws by its tag it draws nothing.`
          : '';
      return `The design has no variable ${key}; its view choices are ${choices.join(', ') || 'none'}.${unmarked}`;
    }
    const kind = key.slice(0, key.lastIndexOf('.'));
    // A place sets only its paint and whether it is shown: every other prop holds for its kind.
    const at = kind.indexOf('@');
    const prop = key.slice(kind.length + 1);
    const ofKind = at < 0 ? undefined : `${kind.slice(0, at)}.${prop}`;
    if (ofKind && !placeProps.has(prop) && Object.hasOwn(space, ofKind))
      return `A place sets only its paint (${placePaint.join(', ')}) and whether it is shown, never how much room anything takes: ${prop} holds for every ${kind.slice(0, at)} at every step, as ${ofKind}.`;
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
 * values that still fit, then any randomising, then the chosen values. A chosen value outside its
 * variable's options is an error naming them; one for a variable the design has not is left out,
 * and `dropped` says why, for the build to warn of. A place's variable (`fallbacks`, by key, the variable it
 * falls back to) then takes the value of its own unless it is chosen, drawn by name, or set apart
 * in the base, so a place looks as its type and kinds do until a variant sets it.
 */
export function buildVariant(
  space: DesignSpace,
  starter: Readonly<Record<string, DesignValue>>,
  request: VariantRequest,
  seed: number,
  fallbacks: Readonly<Record<string, Fallback>> = {}
): {
  values: Record<string, DesignValue>;
  origins: Record<string, DesignOrigin>;
  dropped: string[];
} {
  const given = Object.entries(request.chosen ?? {});
  const chosen = given.filter(([key]) => Object.hasOwn(space, key));
  const problems = chosen
    .filter(([key, value]) => !fits(space, key, value))
    .map(([key, value]) => unfit(space, key, value));
  if (problems.length) throw new DesignValueError(problems.join(' '));
  const asked = request.randomise === true ? [] : (request.randomise ?? []);
  const named = asked.filter((key) => Object.hasOwn(space, key));
  const dropped = [
    ...given
      .filter(([key]) => !Object.hasOwn(space, key))
      .map(([key, value]) => unfit(space, key, value)),
    ...asked.filter((key) => !Object.hasOwn(space, key)).map((key) => unfit(space, key, undefined))
  ].map((why) => `${why} The value is left out.`);
  const values: Record<string, DesignValue> = { ...starter };
  const origins: Record<string, DesignOrigin> = Object.fromEntries(
    Object.keys(starter).map((key) => [key, 'starter' as const])
  );
  const base = request.base ?? {};
  for (const [key, value] of Object.entries(base)) {
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
  return { values, origins, dropped };
}

/**
 * The prop a variable sets, as fill for Compared.Pointed.fill or for a bound prop's Card.fill@true,
 * views for a choice of views (views.Int, pointers.Index).
 */
function propOf(key: string): string {
  if (key.startsWith('views.') || key.startsWith('pointers.')) return 'views';
  return key.slice(key.lastIndexOf('.') + 1).replace(/@.*/u, '');
}

/**
 * Props a random variant leaves as they were: what is shown, how things line up, the frame, a
 * listing's language, and a text's decoration, as a line through it can mean it
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
const lengthProps = new Set<string>(['strokeWidth', 'textSize', 'padding', 'radius', 'gap']);
/** How a box sits in its slot, and how a row spaces its children: drawn afresh for each kind. */
const slotProps = new Set<string>(['width', 'height', 'xAnchor', 'yAnchor', 'spacing']);

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
    const group =
      slotProps.has(propOf(key)) && !key.includes('@')
        ? key
        : `${propOf(key)}=${JSON.stringify(value)}`;
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
  if (kept.has(prop) || framedKinds(space).has(kindOf(key))) return value;
  // A bound prop's hue and the way its options run are drawn afresh; a length's unit stays near.
  if (['@hue', '@order'].some((end) => key.endsWith(end))) return pick(options);
  if (colourProps.has(prop)) {
    const parts = typeof value === 'string' ? colourParts(value) : undefined;
    if (!parts) return value;
    return pick(
      options.filter(
        (option) => typeof option === 'string' && colourParts(option)?.shade === parts.shade
      )
    );
  }
  if (key.endsWith('@unit') || lengthProps.has(prop)) {
    if (value === 0) return value;
    const at = options.indexOf(value);
    return pick(options.slice(Math.max(1, at - 2), at + 3).filter((option) => option !== 0));
  }
  return pick(options);
}

export type { DesignValues };
