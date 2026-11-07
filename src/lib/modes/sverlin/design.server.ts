/**
 * A source's design space, generated from its markup and the library, and the variants built in it.
 * Every visual attribute is a variable: each kind of node's props, each type's view, and the page
 * frame's settings. A variant gives every one a value; the starter is the first, and the others
 * take the values the assistant gives, the rest drawn at random.
 */

import { keyedRandom } from './algorithm/random.server';
import type { LayoutStructure } from './structure.server';
import {
  baseKey,
  baseName,
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
  groupKey,
  groupOf,
  groupOptions,
  groupProps,
  inheritKey,
  levelFor,
  missingRoleLooks,
  propOptions,
  roleProps,
  starterFrame,
  starterFreeLayout,
  starterGrid,
  starterListing,
  styleOf,
  tagOf,
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
import { starterBase, starterBaseName } from './library/node/starter-base';
import { designOnlyWarning } from './padding-warnings.server';

/** A value a variable can take. */
export type DesignValue = string | number | boolean;

/**
 * A kind of node: its key, the snippet it is in (as Mark.Link), what it is, giving its props,
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
const propsOf = ({ role, free, grid }: DesignKind) =>
  grid
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
 * A kind's starting value for a prop: a free layout runs right, across the wide stage, a tree too,
 * so pages start near 16:9 unless the participant asks for them to run down; and a link's head is
 * none where
 * every link of its kind is a two-way line, as an undirected graph's edges. A collection's box,
 * where it varies, starts where its first item is, so the items already there stay as it grows; and
 * its items sit in the middle of its room where its length never changes, at its start where it
 * does, so none moves as one comes or goes.
 */
const starterLook = ({ role, free, lines, collection }: DesignKind, prop: string) =>
  prop === 'direction' && free
    ? 'right'
    : prop === 'head' && lines
      ? 'none'
      : collection && prop === (collection.axis === 'x' ? 'xAnchor' : 'yAnchor')
        ? 'start'
        : collection && prop === 'justify'
          ? collection.steady
            ? 'center'
            : 'start'
          : (starterRoleLook(role, prop) ?? starterFreeLayout[prop] ?? starterGrid[prop]);

/**
 * A role's look in the starter base, through its tokens: every kind is shown, and takes each other
 * prop from its role's style there, as `$Value.fill`, so the engine holds no look of its own.
 */
function starterRoleLook(role: KindRole, prop: string): DesignValue | undefined {
  if (prop === 'shown') return true;
  const value = starterBase[`${roleStyle(role)}.${prop}`];
  return isToken(value) ? starterBase[value] : value;
}

/** The starter base's tokens, as `$accent`, each with its value. */
const starterTokens = (): Record<string, DesignValue> =>
  Object.fromEntries(Object.keys(tokenProps).map((token) => [token, starterBase[token]]));

/**
 * A source's places (see Place in library/node/design.ts): their kinds, whose props are those a
 * place sets, and their own choices of view, as views.Int:@swap.held.
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

const kindOf = keyKind;

const tokens = Object.keys(tokenProps) as DesignToken[];

/** The roles of a source's kinds, each once, in the order roleProps lists them. */
const rolesOf = (kinds: readonly DesignKind[]) =>
  (Object.keys(roleProps) as KindRole[]).filter((role) => kinds.some((kind) => kind.role === role));

/**
 * The design's levels above its kinds (see Shared design values in the language guide): every
 * token, and a group for each prop of each tag the source's kinds are made by, as `<Node>.padding`,
 * taking the options of every kind it reaches, or a token that fits them all. A group is set only
 * where a variant sets it, so the starter has none: each kind starts at its role's look.
 */
function levelSpace(kinds: readonly DesignKind[]): DesignSpace {
  if (!kinds.length) return {};
  const roles = rolesOf(kinds);
  return {
    ...Object.fromEntries(tokens.map((token) => [token, propOptions[tokenProps[token]]])),
    // Every role's style in the base, the source's roles or not, as a base holds every value.
    ...Object.fromEntries(
      (Object.keys(roleProps) as KindRole[]).flatMap((role) =>
        groupProps(role).map((prop) => [`${roleStyle(role)}.${prop}`, groupOptions([role], prop)])
      )
    ),
    ...Object.fromEntries(
      (['<Node>', '<Link>'] as const).flatMap((tag) => {
        const reached = roles.filter((role) => tagOf(role) === tag);
        return [...new Set(reached.flatMap(groupProps))].map((prop) => [
          groupKey(tag, prop),
          groupOptions(reached, prop)
        ]);
      })
    )
  };
}

/** Whether a kind's variable follows a level: a prop of a kind with a role its group can set. */
function follows(roles: Readonly<Record<string, KindRole>>, key: string): boolean {
  const kind = kindOf(key);
  const role = Object.hasOwn(roles, kind) ? roles[kind] : undefined;
  return !!role && groupProps(role).includes(key.slice(kind.length + 1) as DesignProp);
}

/**
 * How many kinds each kind inherits through (see levelFor), so a kind's source settles before it:
 * 0 for one inheriting none or a style. A kind inheriting a kind that inherits it back is an error
 * naming the round.
 */
function inheritance(
  values: Readonly<Record<string, DesignValue>>,
  roles: Readonly<Record<string, KindRole>>
): Map<string, number> {
  const depth = new Map<string, number>();
  const sourceOf = (kind: string) => {
    const source = values[inheritKey(kind)];
    return typeof source === 'string' && Object.hasOwn(roles, source) ? source : undefined;
  };
  for (const kind of Object.keys(roles)) {
    const round = [kind];
    for (let source = sourceOf(kind); source; source = sourceOf(source)) {
      if (round.includes(source))
        throw new DesignValueError(
          `${[...round, source].join(' inherits ')}: a kind cannot inherit what inherits it; leave "..." out of one of them, so it follows its role's look, or have it inherit a $ style.`
        );
      round.push(source);
    }
    depth.set(kind, round.length - 1);
  }
  return depth;
}

/**
 * The space with the styles the variant names (see isStyle): each style's props, taking the options
 * every kind inheriting it has for the prop, or, where none inherits it yet, any kind's, or, where
 * no kind has the prop, the prop's own; and each
 * kind's inherit taking the styles as options beside its role's kinds.
 */
function withStyles(
  space: DesignSpace,
  roles: Readonly<Record<string, KindRole>>,
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
    const heirs = Object.keys(roles).filter(
      (kind) => values[inheritKey(kind)] === style && Object.hasOwn(space, `${kind}.${prop}`)
    );
    const holders = heirs.length
      ? heirs
      : Object.keys(roles).filter((kind) => Object.hasOwn(space, `${kind}.${prop}`));
    const [first = [], ...rest] = holders.map((kind) => space[`${kind}.${prop}`]);
    const options = heirs.length
      ? first.filter((option) => rest.every((options) => options.includes(option)))
      : holders.length
        ? [...new Set([first, ...rest].flat())]
        : // No kind has the prop, as a base's $second where the source draws no box: its own options.
          ((propOptions as Record<string, readonly DesignValue[]>)[prop] ?? []);
    // A style's prop may name a token of that prop whose every value it can take, as a group's.
    const fitting = tokens.filter(
      (token) =>
        tokenProps[token] === prop &&
        propOptions[tokenProps[token]].every((option) => options.includes(option as never))
    );
    extended[`${style}.${prop}`] = [...options.filter((option) => !isToken(option)), ...fitting];
  }
  for (const kind of Object.keys(roles)) {
    const key = inheritKey(kind);
    if (Object.hasOwn(space, key)) extended[key] = [...space[key], ...styles];
  }
  return extended;
}

/**
 * The space under the base the values set (see baseKey, scaleKey, paletteKey in
 * library/node/design.ts): the base's name, its scales and its palette, each a variable taking the
 * value given where it is valid, and every prop on a scale taking that scale's steps, every colour
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
    if (key === baseKey) {
      if (typeof value === 'string' && baseName.test(value)) own[key] = [value];
      else
        problems.push(
          `${key} names its base with $ and a short name, as "$textbook", not ${JSON.stringify(value)}.`
        );
    } else if (scale !== undefined) {
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
  const sets = Object.keys(own).some((key) => key !== baseKey);
  if (!sets) return { space: { ...space, ...own }, problems };
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

/**
 * Why a group cannot take a value that some kinds it reaches can: the kinds that cannot, by name.
 * Undefined where none of them can, for the group's options to say.
 */
function groupUnfit(
  space: DesignSpace,
  roles: Readonly<Record<string, KindRole>>,
  key: string,
  value: unknown
): string | undefined {
  const group = groupOf(key);
  if (!group) return undefined;
  const reached = Object.entries(roles)
    .filter(([, role]) => tagOf(role) === group.tag && groupProps(role).includes(group.prop))
    .map(([kind]) => kind)
    .filter((kind) => Object.hasOwn(space, `${kind}.${group.prop}`));
  const cannot = reached.filter(
    (kind) => !space[`${kind}.${group.prop}`]?.includes(value as never)
  );
  return cannot.length && cannot.length < reached.length
    ? `${key} cannot be ${JSON.stringify(value)}: it sets every kind of ${group.tag} with ${group.prop}, and ${cannot.join(', ')} cannot take it; set the others one by one, as ${reached.find((kind) => !cannot.includes(kind))}.${group.prop}.`
    : undefined;
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

/** Whether values name their base, flat (`base`) or as written at the top (`...`). */
const namesBase = (values: Readonly<Record<string, unknown>> | undefined) =>
  !!values && (Object.hasOwn(values, baseKey) || Object.hasOwn(values, '...'));

/**
 * A request as a design enters the app: one naming its base as it is; one naming none and building
 * on no variant, as a demo example's, a new project's or a test's, with the starter base written in
 * under its chosen values, so the variant built records `"...": "$starter"` and every base value. A
 * request building on a variant that names no base is left to be refused (see buildVariant).
 */
export function withStarterBase(request: VariantRequest): VariantRequest {
  if (namesBase(request.chosen) || namesBase(request.base)) return request;
  if (request.base && Object.keys(request.base).length) return request;
  return { ...request, chosen: { ...starterBase, ...request.chosen } };
}

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

/** The variable each region's paint falls back to: the listing's own lit look. */
export function listingRegionFallbacks(labels: readonly string[]): Record<string, Fallback> {
  return Object.fromEntries(
    labels.flatMap((label) =>
      listingRegionProps.map((prop): [string, Fallback] => [
        `listing.lit@${label}.${prop}`,
        `listing.lit.${prop}`
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
          'listing.language': [...ownListings, ...listingOptions['listing.language']]
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
      kinds.map((kind) => [
        inheritKey(kind.key),
        kinds
          .filter((other) => other.role === kind.role && other.key !== kind.key)
          .map(({ key }) => key)
      ])
    ),
    ...Object.fromEntries(places.choices.map(({ key, options }) => [key, [...options, 'none']])),
    ...Object.fromEntries(
      places.kinds.flatMap((kind) =>
        placePropsOf(kind).map((prop) => [`${kind.key}.${prop}`, propOptions[prop]])
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
  const options = propOptions[prop];
  return prop === 'form' && kind.free?.structure !== 'layers'
    ? options.filter((option) => option !== 'layered')
    : options;
}

/** The first variant of a source: each type in its first view, and each kind in its role's look. */
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
          ...starterListing,
          'listing.language': ownListings[0] ?? starterListing['listing.language']
        }
      : {}),
    ...(kinds.length ? starterTokens() : {}),
    ...Object.fromEntries(
      kinds.flatMap((kind) =>
        propsOf(kind).map((prop) => [`${kind.key}.${prop}`, starterLook(kind, prop)])
      )
    ),
    // A place starts as its type and kinds do.
    ...Object.fromEntries(places.choices.map(({ key, options }) => [key, options[0]])),
    ...Object.fromEntries(
      places.kinds.flatMap((kind) =>
        placePropsOf(kind).map((prop) => [`${kind.key}.${prop}`, starterRoleLook(kind.role, prop)])
      )
    ),
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
              !other.startsWith('listing.')
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
 * The complete variant a build takes, and where each value came from: the starter, then the base's
 * values that still fit, then any randomising, then the chosen values. A chosen value outside its
 * variable's options is an error naming them; one for a variable the design has not is left out,
 * and `dropped` says why, for the build to warn of. A place's variable (`fallbacks`, by key, the variable it
 * falls back to) then takes the value of its own unless it is chosen, drawn by name, or set apart
 * in the base, so a place looks as its type and kinds do until a variant sets it.
 *
 * A kind of a role (`roles`, by kind) takes its role level's value, or that level's token's, for
 * each prop it has not set apart: one whose value differs from its level's in the starter or the
 * base, or that is chosen or drawn by name. So a token or a role level chosen changes every kind
 * following it, and a kind's own value overrides both; a level whose value some kind following it
 * cannot take is an error naming that kind.
 */
export function buildVariant(
  offered: DesignSpace,
  starter: Readonly<Record<string, DesignValue>>,
  request: VariantRequest,
  seed: number,
  fallbacks: Readonly<Record<string, Fallback>> = {},
  roles: Readonly<Record<string, KindRole>> = {}
): {
  values: Record<string, DesignValue>;
  origins: Record<string, DesignOrigin>;
  dropped: string[];
} {
  // Keys come written or as kept (see design-keys.ts): `{Int}` and <Listing>.syntax are views.Int
  // and listing.syntax here; every other key is the same in both.
  const aliased = (entries: Record<string, unknown> | undefined) => keptValues(entries ?? {});
  const base = aliased(request.base);
  const chosenValues = aliased(request.chosen);
  // Every design names its base and holds every role's look (see withStarterBase).
  if (!namesBase({ ...base, ...chosenValues }))
    throw new DesignValueError(
      'The design names no base: write "...": "$starter", or another template, at its top.'
    );
  const optedOut = Object.entries(chosenValues)
    .filter(([key, value]) => key.endsWith('.inherit') && value === 'none')
    .map(([key]) => key.slice(0, -'.inherit'.length));
  if (optedOut.length)
    throw new DesignValueError(
      `${optedOut.join(', ')}: "...": "none" is gone, as every kind follows its role's look; leave "..." out, and set the props that differ on the kind itself.`
    );
  const missing = missingRoleLooks({ ...base, ...chosenValues }, roles);
  if (missing.length)
    throw new DesignValueError(
      `The design's base sets no ${missing.join(', ')}: a base sets every role's look its kinds follow; start from a template, as "...": "$starter", and change what differs.`
    );
  // The styles the base and the chosen values name join the space (see withStyles), and the base's
  // scales and palette set its options (see withBase).
  const { space, problems: baseProblems } = withBase(
    withStyles(offered, roles, { ...base, ...chosenValues }),
    { ...base, ...chosenValues }
  );
  const has = (key: string) => Object.hasOwn(space, key);
  if (baseProblems.length) throw new DesignValueError(writtenText(baseProblems.join(' ')));
  const asGiven = Object.entries(chosenValues);
  const chosen = asGiven.filter(([key]) => has(key));
  // A style's prop outside what its heirs share names them, as a group's names the kinds it reaches.
  const heirsOf = (style: string) =>
    Object.keys(roles).filter((kind) => ({ ...base, ...chosenValues })[inheritKey(kind)] === style);
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
  const problems = chosen
    .filter(([key, value]) => !fits(space, key, value))
    .map(
      ([key, value]) =>
        groupUnfit(space, roles, key, value) ?? styleUnfit(key, value) ?? unfit(space, key, value)
    );
  if (problems.length) throw new DesignValueError(writtenText(problems.join(' ')));
  const isLevel = (key: string) =>
    isToken(key) ||
    groupOf(key) !== undefined ||
    styleOf(key) !== undefined ||
    key.endsWith('.inherit');
  const following = Object.keys(starter).filter((key) => follows(roles, key));
  const asked =
    request.randomise === true ? [] : (request.randomise ?? []).map((key) => keptKey(key));
  const named = asked.filter((key) => Object.hasOwn(space, key));
  const dropped = [
    ...asGiven
      // A base holds values the source may have no use for, as a listing's look (see isBaseKey).
      .filter(([key]) => !Object.hasOwn(space, key) && !isBaseKey(key))
      .map(([key, value]) => unfit(space, key, value)),
    ...asked.filter((key) => !Object.hasOwn(space, key)).map((key) => unfit(space, key, undefined))
  ].map((why) => writtenText(`${why} The value is left out.`));
  const values: Record<string, DesignValue> = { ...starter };
  const origins: Record<string, DesignOrigin> = Object.fromEntries(
    Object.keys(starter).map((key) => [key, 'starter' as const])
  );
  for (const [key, value] of Object.entries(base)) {
    if (fits(space, key, value)) {
      values[key] = value as DesignValue;
      origins[key] = 'kept';
    } else if (Object.hasOwn(space, key) && value !== starter[key])
      // A variable the design still offers but not with this value, as a minSize between two of
      // its steps, is said, not dropped unseen; a variable the source no longer has goes quietly,
      // as a base from before an edit holds many, and so does a starter's value a new base's scale
      // has no step for, which was no one's choice. A look only, never sending a version back.
      dropped.push(
        writtenText(
          `${unfit(space, key, value)} The value kept from the version built on is left out, and the starter's is drawn. ${designOnlyWarning}`
        )
      );
  }
  // A kind's prop set apart from its level stays its own; every other follows its level. Before
  // the chosen values, a level the variant built on does not set is the starter base's, which the
  // starter's kinds start from, so a kind the starter sets apart (a two-way line's head) stays so.
  const starting = { ...starterBase, ...values };
  const own = new Set(
    following.filter((key) => values[key] !== levelFor(starting, roles, key)!.value)
  );
  // Each kind following a level takes the level's value; one that cannot is the level's error
  // where the level was chosen, and otherwise keeps its own value, as a base kept where it fits.
  // A kind inheriting a kind follows after it, so it takes the value its source has come to.
  const follow = (checked: ReadonlySet<string>) => {
    const unfits: string[] = [];
    const depth = inheritance(values, roles);
    const inOrder = following.toSorted(
      (a, b) => (depth.get(kindOf(a)) ?? 0) - (depth.get(kindOf(b)) ?? 0)
    );
    for (const key of inOrder) {
      if (own.has(key)) continue;
      const { value, from } = levelFor(values, roles, key)!;
      if (value === undefined || value === values[key]) continue;
      if (!fits(space, key, value)) {
        if (from && checked.has(from))
          unfits.push(`${from} is ${JSON.stringify(value)}, but ${unfit(space, key, value)}`);
        continue;
      }
      values[key] = value;
      origins[key] = (from ? origins[from] : undefined) ?? 'starter';
    }
    if (unfits.length) throw new DesignValueError(writtenText(unfits.join(' ')));
  };
  const drawn =
    request.randomise === true
      ? randomised(space, values, seed)
      : Object.fromEntries(named.map((key) => [key, drawOne(space, key, values[key], seed)]));
  for (const [key, value] of Object.entries(drawn)) {
    if (value === values[key]) continue;
    values[key] = value;
    origins[key] = 'random';
    if (request.randomise !== true && follows(roles, key)) own.add(key);
  }
  follow(new Set());
  // Every chosen value, then the kinds following the levels chosen; a kind chosen is its own, and
  // one inheriting it follows the value chosen.
  for (const [key, value] of chosen) {
    values[key] = value as DesignValue;
    // The starter base's own values, written in under a design naming `$starter` (see
    // withStarterBase), are the starter's, chosen by no one.
    origins[key] =
      chosenValues[baseKey] === starterBaseName && starterBase[key] === value
        ? 'starter'
        : 'chosen';
    if (follows(roles, key)) own.add(key);
  }
  // A kind chosen to inherit something follows it where only its starter look set it apart, as a
  // link's label starting unboxed: that look was no one's choice. Values chosen, kept or drawn stay.
  for (const [key] of chosen.filter(([key]) => key.endsWith('.inherit'))) {
    const kind = key.slice(0, -'.inherit'.length);
    for (const prop of following.filter((name) => kindOf(name) === kind))
      if (origins[prop] === 'starter') own.delete(prop);
  }
  follow(new Set(chosen.map(([key]) => key).filter(isLevel)));
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
 * is gone.
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
  'decoration'
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
    // A place's label is words the participant chose, never drawn; a base's name, scales and
    // palette are what the drawn values are chosen from.
    if (frames.has(kindOf(key)) || isPlaceLabel(key)) continue;
    if (key === baseKey || key.startsWith('scale.') || paletteKey.test(key)) continue;
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
