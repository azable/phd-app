/**
 * A source's design space, generated from its markup and the library, and the variants built in it.
 * Every visual attribute is a variable: each kind of node's props, each type's view, and the page
 * frame's settings. A version's design is a file, a template's copy and the changes made to it
 * since; the build gives every variable its value from that file (see buildVariant).
 */

import { keyedRandom } from './algorithm/random.server';
import type { LayoutStructure } from './structure.server';
import {
  baseOptions,
  colourParts,
  exactColour,
  isBaseKey,
  paletteKey,
  roleOfStyle,
  roleStyle,
  scaleProps,
  scaleSteps,
  type ScaleName,
  frameOptions,
  colourProps as colourPropList,
  freeLayoutProps,
  gridProps,
  isToken,
  listingOptions,
  listingPropOptions,
  listingRegionProps,
  isPlaceLabel,
  placeLabelLength,
  placePaint,
  placeProps,
  endProps,
  isLinkEnd,
  kindPropOptions,
  kindProps,
  linkEnd,
  lookProps,
  neutralListing,
  neutralValue,
  oldBuiltIn,
  roleStyleOptions,
  inheritKey,
  propOptions,
  roleProps,
  starterFrame,
  styleOf,
  templateKey,
  tokenProps,
  type DesignProp,
  type DesignToken,
  type DesignValues,
  type KindRole
} from './library/node/design';
import {
  isPlacedOrValued,
  keptKey,
  keptValues,
  keyKind,
  keyProp,
  writtenText
} from './library/node/design-keys';
import { designOnlyWarning } from './padding-warnings.server';
import { templateNames, templateOf, templateValues } from './templates/templates';

/** A value a variable can take. */
export type DesignValue = string | number | boolean;

/**
 * A kind of node: its key, the snippet it is in (as Mark.<Link>), what it is, giving its props,
 * and, where it arranges a free layout, whose look its props hold too, the structure its data makes
 * (see structure.server.ts); and, for a link's kind, whether every link
 * of it is a two-way line, whose head starts as none.
 */
export type DesignKind = {
  key: string;
  role: KindRole;
  free?: { structure: LayoutStructure };
  /** For a kind arranging a grid: its basis is its own too (see gridProps). */
  grid?: true;
  lines?: true;
  /** For a collection's node, the axis its items run along and whether its length never changes. */
  collection?: { axis: 'x' | 'y'; steady: boolean };
};

// A layout whose data makes no structure has no form to choose: the page lays it out freely, or in
// the natural form of a structure it finds that the trace could not show.
const propsOf = ({ key, role, free, grid }: DesignKind) =>
  isLinkEnd(key)
    ? endProps
    : grid
      ? [...roleProps[role], ...gridProps]
      : free
        ? [
            ...roleProps[role],
            ...freeLayoutProps.filter((prop) =>
              prop === 'form'
                ? free.structure !== 'none'
                : prop === 'direction'
                  ? free.structure !== 'none'
                  : true
            )
          ]
        : roleProps[role];

/**
 * A kind's own starting value for a prop, from what its nodes do, where it has one: a link end's
 * head is none where every link of its kind is a two-way line, as an undirected graph's edges. A
 * collection's box, where it varies, starts where its first item is, so the items already there stay
 * as it grows; and its items sit in the middle of its room where its length never changes, at its
 * start where it does, so none moves as one comes or goes. It goes over the kind's base, and what
 * the kind inherits goes over it (see resolvedValue).
 */
const structuralLook = ({ lines, collection }: DesignKind, prop: string) =>
  prop === 'head' && lines
    ? 'none'
    : collection && prop === (collection.axis === 'x' ? 'xAnchor' : 'yAnchor')
      ? 'start'
      : collection && prop === 'justify'
        ? collection.steady
          ? 'center'
          : 'start'
        : undefined;

/**
 * The listing's starting look, its first language none: neutral, for a design's template to set
 * (see neutralListing), its places' look aside, a variable only where the listing has tokens.
 */
export const starterListing = (): Record<string, DesignValue> => ({
  '<Listing>.language': 'none',
  ...Object.fromEntries(
    Object.entries(neutralListing).filter(([key]) => key !== '<Listing>.places')
  )
});

/**
 * A source's places (see Place in library/node/design.ts): their kinds, whose props are those a
 * place sets, and their own choices of view, as views.Int:@swap.held.
 */
export type DesignPlaces = {
  kinds: readonly DesignKind[];
  choices: readonly { key: string; options: readonly string[] }[];
};

const placePropsOf = ({ key, role }: DesignKind) =>
  kindProps(role, key).filter((prop) => placeProps.has(prop));

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

const kindOf = keyKind;

const tokens = Object.keys(tokenProps) as DesignToken[];

/**
 * The design's levels above its kinds (see Shared values in the language guide): every token, and
 * every role's style, as `<Value>.fill`, which each kind of the role follows, and a link role's
 * end's, as `<Pointer>.<To>.fill`.
 */
function levelSpace(kinds: readonly DesignKind[]): DesignSpace {
  if (!kinds.length) return {};
  return {
    ...Object.fromEntries(tokens.map((token) => [token, propOptions[tokenProps[token]]])),
    // Every role's style, the source's roles or not, as a template holds every value.
    ...Object.fromEntries(
      (Object.keys(roleProps) as KindRole[]).flatMap((role) =>
        lookProps(role).map((prop) => [`${roleStyle(role)}.${prop}`, roleStyleOptions(prop)])
      )
    ),
    ...Object.fromEntries(
      (['link', 'pointer'] as const).flatMap((role) =>
        endProps.map((prop) => [
          `${roleStyle(role)}.${linkEnd}.${prop}`,
          roleStyleOptions(prop, true)
        ])
      )
    )
  };
}

/**
 * The space with the styles the variant names (see isStyle): each style's props, taking the options
 * every kind inheriting it has for the prop, or, where none inherits it yet, any kind's, or, where
 * no kind has the prop, the prop's own; and each kind's inherit taking the styles as options beside
 * the kinds. `bases` holds every kind, by key.
 */
function withStyles(
  space: DesignSpace,
  bases: Readonly<Record<string, string>>,
  values: Readonly<Record<string, unknown>>
): DesignSpace {
  // A role's style is in the space already, with its role's options (see levelSpace).
  const named = Object.keys(values).flatMap((key) => {
    const style = styleOf(key);
    return style && !roleOfStyle(style.style) ? [style] : [];
  });
  const styles = [...new Set(named.map(({ style }) => style))];
  if (!styles.length) return space;
  const extended: Record<string, readonly DesignValue[]> = { ...space };
  for (const { style, prop } of named) {
    const heirs = Object.keys(bases).filter(
      (kind) => values[inheritKey(kind)] === style && Object.hasOwn(space, `${kind}.${prop}`)
    );
    const holders = heirs.length
      ? heirs
      : Object.keys(bases).filter((kind) => Object.hasOwn(space, `${kind}.${prop}`));
    const [first = [], ...rest] = holders.map((kind) => space[`${kind}.${prop}`]);
    const options = heirs.length
      ? first.filter((option) => rest.every((options) => options.includes(option)))
      : holders.length
        ? [...new Set([first, ...rest].flat())]
        : // No kind has the prop, as a template's $second where the source draws no box: its own options.
          ((propOptions as Record<string, readonly DesignValue[]>)[prop] ?? []);
    // A style's prop may name a token of that prop whose every value it can take, as a group's.
    const fitting = tokens.filter(
      (token) =>
        tokenProps[token] === prop &&
        propOptions[tokenProps[token]].every((option) => options.includes(option as never))
    );
    extended[`${style}.${prop}`] = [...options.filter((option) => !isToken(option)), ...fitting];
  }
  for (const kind of Object.keys(bases)) {
    const key = inheritKey(kind);
    if (Object.hasOwn(space, key)) extended[key] = [...space[key], ...styles];
  }
  return extended;
}

/** A value and the variable it comes from: the kind's own, a style's, its base's, or a token. */
type Resolved = { value: DesignValue; from?: string };

/**
 * Each prop of a kind (but whether it is shown, which stays its own) as the design file gives it: the
 * kind's own value; else what it inherits, a style's value for the prop or another kind's, as
 * resolved; else the kind's own starting look, from what its nodes do (see structuralLook), where the
 * scales allow it; else its
 * base's value (`bases`, as `<Value>` for a value's kind); else the prop's neutral value. A value
 * naming a token takes the token's. A kind inheriting a kind that inherits it back is an error
 * naming the round.
 */
function resolvedValue(
  file: Readonly<Record<string, DesignValue>>,
  bases: Readonly<Record<string, string>>,
  starter: Readonly<Record<string, DesignValue>>,
  space: DesignSpace
): (key: string) => Resolved | undefined {
  const token = (value: DesignValue, from: string): Resolved =>
    isToken(value)
      ? { value: file[value] ?? neutralValue(tokenProps[value]), from: value }
      : { value, from };
  const resolve = (kind: string, prop: string, round: readonly string[]): Resolved => {
    const key = `${kind}.${prop}`;
    if (Object.hasOwn(file, key)) return token(file[key], key);
    const source = file[inheritKey(kind)];
    if (typeof source === 'string' && Object.hasOwn(bases, source)) {
      if (round.includes(source))
        throw new DesignValueError(
          `${[...round, kind, source].join(' inherits ')}: a kind cannot inherit what inherits it; leave "..." out of one of them, so it follows its base, or have it inherit a $ style.`
        );
      if (Object.hasOwn(space, `${source}.${prop}`)) return resolve(source, prop, [...round, kind]);
    } else if (typeof source === 'string' && Object.hasOwn(file, `${source}.${prop}`))
      return token(file[`${source}.${prop}`], `${source}.${prop}`);
    // A kind's own starting look a design's scales leave off gives way to its base.
    if (Object.hasOwn(starter, key) && space[key]?.includes(starter[key]))
      return { value: starter[key] };
    const base = `${bases[kind]}.${prop}`;
    if (Object.hasOwn(file, base)) return token(file[base], base);
    return { value: neutralValue(prop as DesignProp, isLinkEnd(kind)) };
  };
  return (key) => {
    const kind = kindOf(key);
    const prop = key.slice(kind.length + 1);
    if (!Object.hasOwn(bases, kind) || prop === 'shown' || !Object.hasOwn(propOptions, prop))
      return undefined;
    return resolve(kind, prop, []);
  };
}

/**
 * The space under the scales and palette the values set (see scaleKey, paletteKey in
 * library/node/design.ts): each a variable taking the value given where it is valid, and every prop on a scale taking that scale's steps, every colour
 * prop the palette's colours too. Also why a base's own value is not valid, by key.
 */
function withBase(
  space: DesignSpace,
  values: Readonly<Record<string, unknown>>
): { space: DesignSpace; problems: string[] } {
  const problems: string[] = [];
  const own: Record<string, readonly DesignValue[]> = {};
  for (const [key, value] of Object.entries(values)) {
    const scale = /^scale\.([a-z]+)$/u.exec(key)?.[1];
    if (scale !== undefined) {
      if (!Object.hasOwn(scaleProps, scale))
        problems.push(
          `The design has no scale ${scale}; its scales are ${Object.keys(scaleProps).join(', ')}.`
        );
      else if (scaleSteps(scale as ScaleName, value)) own[key] = [value as string];
      else
        problems.push(
          `${key} cannot be ${JSON.stringify(value)}: a scale is rising numbers, 0 or more, separated by spaces, as "0 0.25 0.5 1"${scale === 'opacity' ? ', each above 0 and at most 1' : ''}.`
        );
    } else if (paletteKey.test(key)) {
      if (typeof value === 'string' && exactColour.test(value)) own[key] = [value];
      else
        problems.push(
          `${key} cannot be ${JSON.stringify(value)}: a palette colour is exact, # and six hex digits, as "#E69F00".`
        );
    }
  }
  if (!Object.keys(own).length) return { space, problems };
  // A layout's frame keeps its own options: the page round a picture is no part of a base.
  const frames = framedKinds(space);
  const framing = (key: string) =>
    frames.has(kindOf(key)) && Object.hasOwn(frameOptions, key.slice(kindOf(key).length + 1));
  const governed = Object.fromEntries(
    Object.entries(space).map(([key, options]) => [
      key,
      key.startsWith('views.') || framing(key) ? options : baseOptions(propOf(key), options, values)
    ])
  );
  return { space: { ...governed, ...own }, problems };
}

/** The layouts of a space: the kinds with a frame. */
const framedKinds = (space: DesignSpace) =>
  new Set(
    Object.keys(space)
      .filter((key) => key.endsWith('.ratio'))
      .map((key) => key.slice(0, -'.ratio'.length))
  );

/** Each variable's options, by key. */
export type DesignSpace = Readonly<Record<string, readonly DesignValue[]>>;

/** Where a value came from: chosen for the build, kept from the design built on, drawn, or the starter's. */
export type DesignOrigin = 'chosen' | 'kept' | 'random' | 'starter';

/**
 * What a build starts from: `base`, the design file of the version built on; `chosen`, the values
 * this build changes, each naming a variable and one of its options, or naming a template, as
 * `"template": "$slide"`, whose file replaces the base; and `randomise`, the values drawn afresh:
 * every one the file writes (true), keeping its equalities, or the variables named.
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
 * <Listing>.lit@insert.compare.left.fill, with the listing's options.
 */
export function listingRegionSpace(labels: readonly string[]): DesignSpace {
  return Object.fromEntries(
    labels.flatMap((label) =>
      listingRegionProps.map((prop) => [
        `<Listing>.lit@${label}.${prop}`,
        listingPropOptions(prop) ?? []
      ])
    )
  );
}

/** The variable each region's paint falls back to: the listing's own lit look. */
export function listingRegionFallbacks(labels: readonly string[]): Record<string, Fallback> {
  return Object.fromEntries(
    labels.flatMap((label) =>
      listingRegionProps.map((prop): [string, Fallback] => [
        `<Listing>.lit@${label}.${prop}`,
        `<Listing>.lit.${prop}`
      ])
    )
  );
}

/**
 * Every variable of a source: each type's views, a listing's if the view places one (its languages the source's own listings
 * first, then the library's), each kind's props, each place's, and each
 * layout's frame, after the kinds, as a layout's kind holds the nodes its body writes too.
 */
export function designSpace(
  kinds: readonly DesignKind[],
  views: Readonly<Record<string, readonly string[]>>,
  listing = false,
  ownListings: readonly string[] = [],
  places: DesignPlaces = { kinds: [], choices: [] },
  layouts: readonly string[]
): DesignSpace {
  return {
    ...Object.fromEntries(
      Object.entries(views).map(([type, options]) => [viewKey(type), [...options, 'none']])
    ),
    ...(listing
      ? {
          ...listingOptions,
          '<Listing>.language': [...ownListings, ...listingOptions['<Listing>.language']]
        }
      : {}),
    ...levelSpace(kinds),
    ...Object.fromEntries(
      kinds.flatMap((kind) =>
        propsOf(kind).map((prop) => [`${kind.key}.${prop}`, kindOptions(kind, prop)])
      )
    ),
    // What a kind inherits over its role's look: a kind of its role; the styles a variant names
    // join these (see withStyles). The starter sets none, so a kind follows its role's look.
    ...Object.fromEntries(
      kinds
        .filter(({ key }) => !isLinkEnd(key))
        .map((kind) => [
          inheritKey(kind.key),
          kinds
            .filter(
              (other) => other.role === kind.role && other.key !== kind.key && !isLinkEnd(other.key)
            )
            .map(({ key }) => key)
        ])
    ),
    ...Object.fromEntries(places.choices.map(({ key, options }) => [key, [...options, 'none']])),
    ...Object.fromEntries(
      places.kinds.flatMap((kind) =>
        placePropsOf(kind).map((prop) => [
          `${kind.key}.${prop}`,
          kindPropOptions(prop, isLinkEnd(kind.key))
        ])
      )
    ),
    ...layoutSpace(layouts)
  };
}

/**
 * A kind's options for a prop: its role's, the layered form only where its links make layers, the
 * one structure dagre's layered engine lays out (library/node/layered-engine.ts).
 */
function kindOptions(kind: DesignKind, prop: DesignProp): readonly DesignValue[] {
  const options = kindPropOptions(prop, isLinkEnd(kind.key));
  return prop === 'form' && kind.free?.structure !== 'layers'
    ? options.filter((option) => option !== 'layered')
    : options;
}

/**
 * The values a source starts with before its design file: each type in its first view, the listing
 * neutral, each layout's frame, and, of a kind's props, only the starting looks its nodes give it
 * (see structuralLook); every other prop of a kind comes from the file (see resolvedValue), and a
 * place's from what it falls back to (see buildVariant).
 */
export function starterVariant(
  kinds: readonly DesignKind[],
  views: Readonly<Record<string, readonly string[]>>,
  listing = false,
  ownListings: readonly string[] = [],
  places: DesignPlaces = { kinds: [], choices: [] },
  layouts: readonly string[]
): Record<string, DesignValue> {
  return {
    ...Object.fromEntries(
      Object.entries(views).map(([type, options]) => [viewKey(type), options[0]])
    ),
    // The source's first listing is the one it starts with.
    ...(listing
      ? {
          ...starterListing(),
          '<Listing>.language': ownListings[0] ?? 'none'
        }
      : {}),
    ...Object.fromEntries(
      kinds.flatMap((kind) =>
        propsOf(kind).flatMap((prop) => {
          const look = structuralLook(kind, prop);
          return look === undefined ? [] : [[`${kind.key}.${prop}`, look]];
        })
      )
    ),
    ...Object.fromEntries(places.choices.map(({ key, options }) => [key, options[0]])),
    ...layoutStarter(layouts)
  };
}

// A place's label is any short text (see placeLabelKey), every other variable one of its options.
const fits = (space: DesignSpace, key: string, value: unknown) =>
  Object.hasOwn(space, key) &&
  (isPlaceLabel(key)
    ? typeof value === 'string' && value.trim().length > 0 && value.length <= placeLabelLength
    : space[key].includes(value as DesignValue));

/** Explain a chosen value the space cannot take. */
function unfit(space: DesignSpace, key: string, value: unknown): string {
  if (!Object.hasOwn(space, key)) {
    // A size the view binds to its value has no variable of its own; its kind's anchor places it.
    if (/\.(width|height)$/u.test(key) && Object.hasOwn(space, `${key}.unit`)) {
      const kind = kindOf(key);
      const axis = key.endsWith('.width') ? 'width' : 'height';
      return `${kind}'s ${axis} is bound to its value in the view, ${axis}={…}, so it has no ${axis} variable; ${kind}.${axis === 'width' ? 'x' : 'y'}Anchor places it.`;
    }
    // A node sized by its value is exactly its length, so it has no padding.
    const bound = ['width', 'height'].find((axis) =>
      Object.hasOwn(space, `${kindOf(key)}.${axis}.unit`)
    );
    if (key.endsWith('.padding') && bound)
      return `${kindOf(key)}'s ${bound} is bound to its value in the view, ${bound}={…}, so each node of it is exactly its length and has no padding variable.`;
    if (key.startsWith('pause@'))
      return `The design has no variable ${key}: the steps a scene shows are its pause, in the source, as <Scene name="…" pause="@$.end{key.slice('pause@'.length)}">.`;
    // A view choice, a type's or a place's, is one variable, not a kind and a prop.
    if (key.startsWith('views.') || key.startsWith('pointers.')) {
      const choices = Object.keys(space).filter((other) => other.startsWith('views.'));
      // A pointer is a view of its type drawing a link, chosen as any view is.
      const pointer = key.startsWith('pointers.')
        ? ` A pointer is drawn by a view of its type holding <Link to={this} />, chosen as views.${key.slice('pointers.'.length)}.`
        : '';
      return `The design has no variable ${key}; its view choices are ${choices.join(', ') || 'none'}.${pointer}`;
    }
    const kind = keyKind(key);
    // A place sets only its paint and whether it is shown: every other prop holds for its kind.
    const at = kind.indexOf(':');
    const prop = keyProp(key);
    const ofKind = at < 0 ? undefined : `${kind.slice(0, at)}.${prop}`;
    if (ofKind && !placeProps.has(prop) && Object.hasOwn(space, ofKind))
      return `A place sets only its paint (${placePaint.join(', ')}) and whether it is shown, never how much room anything takes: ${prop} holds for every ${kind.slice(0, at)} at every step, as ${ofKind}.`;
    const near = Object.keys(space).filter((other) => other.startsWith(`${kind}.`));
    if (near.length)
      return `${kind} has no prop ${key.slice(kind.length + 1)}; its variables are ${near.join(', ')}.`;
    // Tokens ($text) are no kinds; a kind is what comes before a variable's last dot.
    const kinds = [
      ...new Set(
        Object.keys(space)
          .filter(
            (other) =>
              /^[A-Z]/u.test(other) &&
              other.includes('.') &&
              !other.startsWith('views.') &&
              !other.startsWith('<Listing>.')
          )
          .map((other) => other.slice(0, other.lastIndexOf('.')))
      )
    ];
    // A kind named by its last part only, as Main.AtI for Main.Board.AtI inside Board.
    const last = kind.slice(kind.lastIndexOf('.') + 1);
    const meant = kinds.filter((other) => other === last || other.endsWith(`.${last}`));
    // The list stays last, after "; its", which stableMessage (attempt-ladder.ts) strips.
    const guess = meant.length
      ? ` (no kind ${kind}: did you mean ${meant.map((other) => `${other}${key.slice(kind.length)}`).join(' or ')}?)`
      : '';
    return `The design has no variable ${key}${guess}; its kinds of node are ${kinds.join(', ')}.`;
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
 * A version's design file and the complete variant built from it, with where each value came from.
 * The file is the template the chosen values name, copied in whole, or else the file of the version
 * built on (`base`), which a first version lacks, so it must name a template; then any values drawn
 * (randomise: every value the file writes, keeping its equalities, and the view choices; or the
 * variables named); then the chosen values. A chosen value outside its variable's options is an
 * error naming them; one for a variable the design has not is left out, and `dropped` says why, for
 * the build to warn of; a value of the file built on that no longer fits is left out too, and said.
 *
 * Every variable then takes its value from the file: a kind's props as resolvedValue gives them
 * (`bases`, by kind, the style each follows where nothing else sets a prop), every other variable
 * the file's value or the starter's. A place's variable (`fallbacks`, by key, the variable it falls
 * back to) takes the value of its own unless the file sets it, so a place looks as its type and
 * kinds do until a design sets it.
 */
export function buildVariant(
  offered: DesignSpace,
  starter: Readonly<Record<string, DesignValue>>,
  request: VariantRequest,
  seed: number,
  fallbacks: Readonly<Record<string, Fallback>> = {},
  bases: Readonly<Record<string, string>> = {}
): {
  values: Record<string, DesignValue>;
  design: Record<string, DesignValue>;
  origins: Record<string, DesignOrigin>;
  dropped: string[];
} {
  // Keys come written or as kept (see design-keys.ts): `{Int}` and <Listing>.syntax are views.Int
  // and <Listing>.syntax here; every other key is the same in both.
  const aliased = (entries: Readonly<Record<string, unknown>> | undefined) =>
    keptValues(entries ?? {});
  const base = aliased(request.base);
  const chosenValues = aliased(request.chosen);
  const both = { ...base, ...chosenValues };
  // A design is a copy of a template; it follows no base of its own.
  if (Object.hasOwn(both, 'base') || Object.hasOwn(both, '...'))
    throw new DesignValueError(
      `"..." at the top named a base the design followed, which is gone: a design is a copy of a template, named in the first version as {"${templateKey}": "$starter"}, and later versions change the copy.`
    );
  const optedOut = Object.entries(chosenValues)
    .filter(([key, value]) => key.endsWith('.inherit') && value === 'none')
    .map(([key]) => key.slice(0, -'.inherit'.length));
  if (optedOut.length)
    throw new DesignValueError(
      `${optedOut.join(', ')}: "...": "none" is gone, as every kind follows its base; leave "..." out, and set the props that differ on the kind itself.`
    );
  // A built-in name is written in angle brackets, `$` being only for tokens and styles.
  const renamed = [
    ...new Set(
      Object.entries(chosenValues).flatMap(([key, value]) => {
        const named =
          oldBuiltIn(key) ?? (typeof value === 'string' ? oldBuiltIn(value) : undefined);
        if (!named) return [];
        return named.old === '<Node>'
          ? [`${key}: the <Node> group is gone; set the role styles ${named.now}, or the kinds.`]
          : [`${named.old} is written ${named.now}, as every built-in name is.`];
      })
    )
  ];
  if (renamed.length) throw new DesignValueError(renamed.join(' '));
  // A link's kind is written with its tag, as Arrow.<Link>, never as an author's kind Link.
  const oldLinks = Object.keys(chosenValues).flatMap((key) => {
    const now = key.replace(/\.Link(?=[.:])/gu, '.<Link>');
    return now !== key && !Object.hasOwn(offered, key) && Object.hasOwn(offered, now)
      ? [`${key} is written ${now}, a link's kind named by its tag.`]
      : [];
  });
  if (oldLinks.length) throw new DesignValueError(oldLinks.join(' '));
  // A link from a variable paints what it reaches with its end, <To>.
  const targets = Object.keys(chosenValues).flatMap((key) => {
    const old = /^(.*?)(:[^.]*(?:\.[^.]+)*?)?\.target(Fill|Stroke|StrokeWidth|Color)$/u.exec(key);
    if (!old) return [];
    const [, kind, place = '', prop] = old;
    const end = `${kind}.${linkEnd}${place}.${prop[0].toLowerCase()}${prop.slice(1)}`;
    return [`${key} is written ${end}, the paint the link's end gives what it reaches.`];
  });
  if (targets.length) throw new DesignValueError(targets.join(' '));
  // The file the build starts from: a template's copy, or the version's built on.
  const named = chosenValues[templateKey];
  const template = named === undefined ? undefined : templateOf(named);
  if (named !== undefined && !template)
    throw new DesignValueError(
      `"${templateKey}" names ${JSON.stringify(named)}, which is no template; the templates are ${templateNames()}.`
    );
  if (!template && !Object.keys(base).length)
    throw new DesignValueError(
      `The design names no template: a first version copies one, as {"${templateKey}": "$starter"}, and later versions change the copy; the templates are ${templateNames()}.`
    );
  const startFile: Record<string, unknown> = template ? templateValues(template) : base;
  const startOrigin: DesignOrigin = template ? 'starter' : 'kept';
  const chosen = Object.entries(chosenValues).filter(([key]) => key !== templateKey);
  // The styles the file and the chosen values name join the space (see withStyles), and the scales
  // and palette set its options (see withBase).
  const written = { ...startFile, ...Object.fromEntries(chosen) };
  const { space, problems: baseProblems } = withBase(withStyles(offered, bases, written), written);
  const has = (key: string) => Object.hasOwn(space, key);
  if (baseProblems.length) throw new DesignValueError(writtenText(baseProblems.join(' ')));
  // A style's prop outside what its heirs share names them, as a group's names the kinds it reaches.
  const heirsOf = (style: string) =>
    Object.keys(bases).filter((kind) => written[inheritKey(kind)] === style);
  const styleUnfit = (key: string, value: unknown) => {
    const style = styleOf(key);
    const heirs = style ? heirsOf(style.style) : [];
    return heirs.length
      ? unfit(space, key, value).replace(
          /;/u,
          `: ${heirs.join(', ')} ${heirs.length === 1 ? 'inherits' : 'inherit'} ${style!.style}, and`
        )
      : undefined;
  };
  // A template named is chosen whole: a value of its copy the chosen scales leave off is refused.
  const copied = template
    ? Object.entries(startFile).filter(([key]) => !chosen.some(([other]) => other === key))
    : [];
  const problems = [...copied, ...chosen]
    .filter(([key, value]) => has(key) && !fits(space, key, value))
    .map(([key, value]) => styleUnfit(key, value) ?? unfit(space, key, value));
  if (problems.length) throw new DesignValueError(writtenText(problems.join(' ')));
  const asked =
    request.randomise === true ? [] : (request.randomise ?? []).map((key) => keptKey(key));
  const drawnNames = asked.filter(has);
  const dropped = [
    ...chosen
      // A template holds values the source may have no use for, as a listing's look (see isBaseKey).
      .filter(([key]) => !has(key) && !isBaseKey(key))
      .map(([key, value]) => unfit(space, key, value)),
    ...asked.filter((key) => !has(key)).map((key) => unfit(space, key, undefined))
  ].map((why) => writtenText(`${why} The value is left out.`));
  const file: Record<string, DesignValue> = {};
  const fileOrigins: Record<string, DesignOrigin> = {};
  for (const [key, value] of Object.entries(startFile)) {
    if (has(key) ? fits(space, key, value) : isBaseKey(key)) {
      file[key] = value as DesignValue;
      fileOrigins[key] = startOrigin;
    } else if (has(key))
      // A variable the design still offers but not with this value, as a minSize between two of
      // its steps, is said, not dropped unseen; a variable the source no longer has goes quietly,
      // as a file from before an edit holds many. A look only, never sending a version back.
      dropped.push(
        writtenText(
          `${unfit(space, key, value)} The value kept from the version built on is left out. ${designOnlyWarning}`
        )
      );
  }
  const current = (key: string): DesignValue =>
    file[key] ?? resolvedValue(file, bases, starter, space)(key)?.value ?? starter[key];
  // A random variant draws what the file writes and each type's view, never a place's own choice,
  // which follows its type's until a design sets it apart.
  const typeViews = Object.keys(starter).filter(
    (key) => key.startsWith('views.') && has(key) && !Object.hasOwn(fallbacks, key)
  );
  const drawn =
    request.randomise === true
      ? randomised(
          space,
          {
            ...Object.fromEntries(typeViews.map((key) => [key, starter[key]])),
            ...Object.fromEntries(Object.entries(file).filter(([key]) => has(key)))
          },
          seed
        )
      : Object.fromEntries(drawnNames.map((key) => [key, drawOne(space, key, current(key), seed)]));
  for (const [key, value] of Object.entries(drawn)) {
    if (value === current(key)) continue;
    file[key] = value;
    fileOrigins[key] = 'random';
  }
  for (const [key, value] of chosen) {
    if (!has(key) && !isBaseKey(key)) continue;
    file[key] = value as DesignValue;
    fileOrigins[key] = 'chosen';
  }
  // Every variable from the file: the file's own values, each kind's props resolved, the rest the
  // starter's.
  const resolve = resolvedValue(file, bases, starter, space);
  const values: Record<string, DesignValue> = {};
  const origins: Record<string, DesignOrigin> = {};
  const unfits: string[] = [];
  for (const key of Object.keys(space)) {
    const resolved = resolve(key);
    if (resolved) {
      if (!fits(space, key, resolved.value)) {
        unfits.push(
          `${resolved.from} is ${JSON.stringify(resolved.value)}, but ${unfit(space, key, resolved.value)}`
        );
        continue;
      }
      values[key] = resolved.value;
      origins[key] = (resolved.from ? fileOrigins[resolved.from] : undefined) ?? 'starter';
    } else if (Object.hasOwn(file, key)) {
      values[key] = file[key];
      origins[key] = fileOrigins[key];
    } else if (Object.hasOwn(starter, key)) {
      values[key] = starter[key];
      origins[key] = 'starter';
    } else if (Object.hasOwn(bases, kindOf(key)) && keyProp(key) === 'shown') {
      values[key] = true;
      origins[key] = 'starter';
    }
  }
  if (unfits.length) throw new DesignValueError(writtenText(unfits.join(' ')));
  // In order, so a place falling back to another place, as a listing's region to its label's mark,
  // takes the value that one has come to.
  for (const [key, given] of Object.entries(fallbacks)) {
    if (Object.hasOwn(file, key)) continue;
    const fallback = fallbackOf(given, values);
    if (!Object.hasOwn(values, fallback) || !fits(space, key, values[fallback])) continue;
    values[key] = values[fallback];
    origins[key] = origins[fallback];
  }
  return { values, design: file, origins, dropped };
}

/**
 * The prop a variable sets, as fill for IntCell.fill or for a bound prop's Card=true.fill, views
 * for a choice of views (views.Int).
 */
function propOf(key: string): string {
  if (key.startsWith('views.')) return 'views';
  // A token draws with the kinds of its prop that hold its value, so they stay alike.
  if (isToken(key)) return tokenProps[key];
  return keyProp(key);
}

/**
 * Props a random variant leaves as they were: what a kind inherits, what is shown, how things line
 * up, the frame, a listing's language, and a text's decoration, as a line through it can mean it
 * is gone, and a link end's layer, which says whose paint wins.
 */
const kept = new Set<string>([
  'inherit',
  'language',
  'shown',
  'opacity',
  'align',
  'justify',
  'strokeStyle',
  'minSize',
  'overflow',
  'decoration',
  'layer'
]);
const colourProps = new Set<string>(colourPropList);
const lengthProps = new Set<string>(['strokeWidth', 'textSize', 'padding', 'radius', 'gap']);
/** How a box sits in its slot, and how a row spaces its children: drawn afresh for each kind. */
const slotProps = new Set<string>(['width', 'height', 'xAnchor', 'yAnchor', 'spacing']);

/**
 * A fresh value for every variable, keeping the variant's equalities: variables of one prop that
 * share a value draw one new value together, so every white fill becomes one colour. Colours keep
 * their shade, so text stays as readable against its fill; lengths stay within two steps; nothing
 * shown or left out changes, nor anything that is none or 0, nor a grid's basis, whose numbers
 * drawn apart could lay every cell on one line.
 */
function randomised(
  space: DesignSpace,
  values: Readonly<Record<string, DesignValue>>,
  seed: number
): Record<string, DesignValue> {
  const groups = new Map<string, string[]>();
  const frames = framedKinds(space);
  for (const [key, value] of Object.entries(values)) {
    // A place's label is words the participant chose, never drawn; the scales and palette are
    // what the drawn values are chosen from.
    if (frames.has(kindOf(key)) || isPlaceLabel(key)) continue;
    if (key.startsWith('scale.') || paletteKey.test(key)) continue;
    if ((gridProps as readonly string[]).includes(propOf(key))) continue;
    const group =
      slotProps.has(propOf(key)) && !isPlacedOrValued(key)
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
  // A role level naming a token keeps naming it: the token is drawn instead.
  if (isToken(value) || isPlaceLabel(key)) return value;
  const options = space[key].filter((option) => !isToken(option));
  const pick = (candidates: readonly DesignValue[]) =>
    candidates.length
      ? candidates[Math.floor(keyedRandom(seed, stream) * candidates.length)]
      : value;
  if (prop === 'views') return value === 'none' ? value : pick(options.filter((o) => o !== 'none'));
  if (kept.has(prop) || framedKinds(space).has(kindOf(key))) return value;
  // A bound prop's hue and the way its options run are drawn afresh; a length's unit stays near.
  if (['.hue', '.order'].some((end) => key.endsWith(end))) return pick(options);
  if (colourProps.has(prop)) {
    // An exact colour draws another of the base's palette (see paletteKey).
    if (typeof value === 'string' && exactColour.test(value))
      return pick(
        options.filter((option) => typeof option === 'string' && exactColour.test(option))
      );
    const parts = typeof value === 'string' ? colourParts(value) : undefined;
    if (!parts) return value;
    return pick(
      options.filter(
        (option) => typeof option === 'string' && colourParts(option)?.shade === parts.shade
      )
    );
  }
  if (key.endsWith('.unit') || lengthProps.has(prop)) {
    if (value === 0) return value;
    const at = options.indexOf(value);
    return pick(options.slice(Math.max(1, at - 2), at + 3).filter((option) => option !== 0));
  }
  return pick(options);
}

export type { DesignValues };
