/**
 * The design space's options, how a variant's values become CSS, and the key each kind of node
 * reads its values by. The server generates a source's space and variants from these (see
 * ../../design.server.ts); the page reads a variant's values through them.
 */

import { forms } from './forms';

/** Hues of the colour range, each in every shade; neutral has no hue. */
export const hues = [
  'neutral',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose'
] as const;

/** Shades from lightest to darkest. */
export const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

const hueAngles: Record<(typeof hues)[number], number> = {
  neutral: 0,
  red: 25,
  orange: 47,
  amber: 70,
  yellow: 90,
  lime: 125,
  green: 150,
  emerald: 163,
  teal: 182,
  cyan: 205,
  sky: 230,
  blue: 260,
  indigo: 277,
  violet: 293,
  purple: 304,
  fuchsia: 322,
  pink: 354,
  rose: 12
};
const lightness = [0.985, 0.967, 0.928, 0.869, 0.776, 0.68, 0.6, 0.52, 0.45, 0.38, 0.27];
const chroma = [0.015, 0.035, 0.07, 0.12, 0.16, 0.19, 0.2, 0.18, 0.15, 0.12, 0.09];

/** Every colour: white, black, and each hue in each shade, as blue-600. */
export const colours: readonly string[] = [
  'white',
  'black',
  ...hues.flatMap((hue) => shades.map((shade) => `${hue}-${shade}`))
];

/** A colour's CSS, or undefined for none and anything not in the range. */
export function colourCss(name: unknown): string | undefined {
  if (name === 'white') return '#ffffff';
  if (name === 'black') return '#000000';
  const match = typeof name === 'string' ? /^([a-z]+)-(\d+)$/u.exec(name) : null;
  const hue = match?.[1] as (typeof hues)[number] | undefined;
  const shade = shades.indexOf(Number(match?.[2]) as (typeof shades)[number]);
  if (!hue || !Object.hasOwn(hueAngles, hue) || shade < 0) return undefined;
  const c = hue === 'neutral' ? 0 : chroma[shade];
  return `oklch(${lightness[shade]} ${c} ${hueAngles[hue]})`;
}

/** A stroke's style when it is broken, dashed or dotted, or undefined for solid and anything else. */
export function strokeStyleCss(name: unknown): 'dashed' | 'dotted' | undefined {
  return name === 'dashed' || name === 'dotted' ? name : undefined;
}

/** A link's dashes and gaps by its stroke style, in the units of a curve 1.5 wide, its dots round. */
export const linkDashes = { dashed: [6, 4], dotted: [0, 4] } as const;

/** A colour's shade and hue, for a chooser keeping a colour's lightness as it changes its hue. */
export function colourParts(name: string): { hue: string; shade: number } | undefined {
  const match = /^([a-z]+)-(\d+)$/u.exec(name);
  return match ? { hue: match[1], shade: Number(match[2]) } : undefined;
}

const spacing = [0, 0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2];

/**
 * Each prop's options: lengths in em, except size in rem and radius and strokeWidth in pixels; a
 * free layout's form, its arrows' curve, and the seed its spacing and nudges are drawn from; and a
 * link's own bend, as a fraction of its length to one side, or none.
 */
export const propOptions = {
  shown: [true, false],
  fill: ['none', ...colours],
  stroke: ['none', ...colours],
  strokeWidth: [0, 0.5, 1, 1.5, 2, 3, 4],
  opacity: [0.25, 0.5, 0.75, 1],
  color: colours,
  font: ['sans', 'serif', 'mono'],
  size: [0.75, 0.875, 1, 1.125, 1.25, 1.5, 2],
  weight: ['normal', 'bold'],
  padding: spacing,
  radius: [0, 2, 4, 6, 8, 12, 999],
  minSize: [0, 1, 1.5, 2, 2.5, 3, 4],
  gap: spacing,
  align: ['start', 'center', 'end'],
  justify: ['start', 'center', 'end', 'between', 'around', 'evenly'],
  strokeStyle: ['solid', 'dashed', 'dotted'],
  overflow: ['shown', 'hidden', 'included', 'excluded'],
  form: forms,
  curve: ['straight', 'curved'],
  layoutSeed: Array.from({ length: 32 }, (_, index) => index + 1),
  bend: ['none', -0.5, -0.3, -0.15, 0, 0.15, 0.3, 0.5]
} satisfies Record<string, readonly (string | number | boolean)[]>;

export type DesignProp = keyof typeof propOptions;

/** The page frame's settings, each one variable of the whole presentation. */
export const frameOptions = {
  'frame.ratio': ['16:9', '4:3', '3:2', '1:1', '3:4', '9:16'],
  'frame.justify': propOptions.justify,
  'frame.align': propOptions.align,
  'frame.padding': spacing,
  'frame.gap': spacing,
  'frame.layout': ['column', 'row']
} satisfies Record<string, readonly (string | number)[]>;

/**
 * The props of a listing's lit text, as a kind's: its fill, a stroke drawn inside it, its corners,
 * and its text; `color` none keeps the listing's ink. Code a step finished, code it keeps as run,
 * and code leading up to it all light alike. A region of the listing sets its own paint
 * (`listingRegionProps`), the rest holding for every region.
 */
const listingLitOptions = {
  fill: propOptions.fill,
  stroke: propOptions.stroke,
  strokeWidth: propOptions.strokeWidth,
  strokeStyle: propOptions.strokeStyle,
  radius: propOptions.radius,
  color: ['none', ...colours],
  weight: propOptions.weight,
  padding: propOptions.padding
} satisfies Record<string, readonly (string | number)[]>;

/** The props a region of a listing sets for itself, as `listing.lit@insert.compare.left.fill`. */
export const listingRegionProps = ['fill', 'stroke', 'color'] as const;

/** The lit text's options for a prop, for its own variable or a region's. */
export function listingPropOptions(prop: string): readonly (string | number)[] | undefined {
  return Object.hasOwn(listingLitOptions, prop)
    ? listingLitOptions[prop as keyof typeof listingLitOptions]
    : undefined;
}

/**
 * A listing's settings, variables of the whole presentation when the view places a <Listing />:
 * which of the source's listings it shows (they come first; see design.server.ts), and how its lit
 * text looks.
 */
export const listingOptions: Record<string, readonly (string | number)[]> & {
  'listing.language': readonly string[];
} = {
  'listing.language': ['none'],
  ...Object.fromEntries(
    Object.entries(listingLitOptions).map(([prop, options]) => [`listing.lit.${prop}`, options])
  )
};

export const starterListing: Record<string, string | number> & { 'listing.language': string } = {
  'listing.language': 'none',
  'listing.lit.fill': 'amber-200',
  'listing.lit.stroke': 'none',
  'listing.lit.strokeWidth': 0,
  'listing.lit.strokeStyle': 'solid',
  'listing.lit.radius': 2,
  'listing.lit.color': 'none',
  'listing.lit.weight': 'normal',
  'listing.lit.padding': 0
};

/** What a kind of node is, which says the props it has. */
export type KindRole = 'container' | 'value' | 'text' | 'pointed' | 'link';

const nodeProps: readonly DesignProp[] = [
  'shown',
  'fill',
  'stroke',
  'strokeWidth',
  'strokeStyle',
  'opacity',
  'color',
  'font',
  'size',
  'weight',
  'padding',
  'radius',
  'minSize'
];

/** The props a kind of node has: a layout's own, nothing to hide a <Pointed> by, a link's line. */
export const roleProps: Record<KindRole, readonly DesignProp[]> = {
  container: [...nodeProps, 'gap', 'align', 'justify', 'overflow'],
  value: nodeProps,
  text: nodeProps,
  pointed: [...nodeProps.filter((prop) => prop !== 'shown'), 'overflow'],
  link: ['shown', 'stroke', 'strokeWidth', 'opacity', 'strokeStyle', 'color', 'curve', 'bend']
};

/** The props a kind arranging a free layout has besides its role's: how the layout looks. */
export const freeLayoutProps: readonly DesignProp[] = ['form', 'curve', 'layoutSeed'];

/** A free layout's starting look, besides its form, which its structure gives (see forms.ts). */
export const starterFreeLayout: Record<string, string | number> = {
  curve: 'straight',
  layoutSeed: 1
};

/** A link's curve: as its layout's arrows run, or its own. */
export const linkCurveOptions = ['layout', 'straight', 'curved'] as const;

/**
 * A prop's options for a role: overflow says, for a pointer, whether it is drawn past its
 * collection's ends, and for a collection's node, whether its end slots are inside its box or hang
 * outside it.
 */
export const overflowOptions = {
  pointer: ['shown', 'hidden'],
  collection: ['included', 'excluded']
} as const;

export function optionsOf(
  role: KindRole,
  prop: DesignProp
): readonly (string | number | boolean)[] {
  if (role === 'link' && prop === 'curve') return linkCurveOptions;
  if (prop !== 'overflow') return propOptions[prop];
  return role === 'pointed' ? overflowOptions.pointer : overflowOptions.collection;
}

/** Paint shows only where a pointer is; its other props hold in every slot, so slots keep one size. */
export const paintProps: ReadonlySet<string> = new Set([
  'fill',
  'stroke',
  'strokeStyle',
  'opacity',
  'color'
]);

/** The props a place sets for the kinds of the view it draws, those that tell one render apart. */
export const placeProps: ReadonlySet<string> = new Set(['shown', 'fill', 'stroke', 'color']);

/**
 * A render at a place: what is written there after `@` (`@left`, `@g.a`), the path of the view it
 * is written in, as `Ask.` (empty outside views), and the view it draws, the variant's choice.
 */
export type Place = { within: string; at: string; view?: string };

/**
 * A kind's own variables at a place, as `IntCell@swap.held` or `Highlight.Pointed@left`: for the
 * kinds of the view the place draws, its nested snippets' included; none for another kind.
 */
export function placedKind(place: Place | undefined, kind: string): string | undefined {
  return place?.view && (kind === place.view || kind.startsWith(`${place.view}.`))
    ? `${place.within}${kind}${place.at}`
    : undefined;
}

/** A prop's value for a kind, its place's own where the place sets the prop, else the kind's. */
export function lookUp(
  design: Readonly<Record<string, unknown>>,
  kind: string,
  placed: string | undefined,
  prop: string
): unknown {
  return (
    (placed && placeProps.has(prop) ? design[`${placed}.${prop}`] : undefined) ??
    design[`${kind}.${prop}`]
  );
}

/**
 * The kind a node is of: the snippet it is in, by its path (`Row.Under` for a snippet inside
 * `Row`), and for a pointer view's <Pointed> or a <Link>, that part, as `Compared.Pointed`.
 */
export function kindKey(view: string, part?: 'Pointed' | 'Link'): string {
  return part ? `${view}.${part}` : view;
}

/** A variant: each variable's value, by key, as Compared.Pointed.fill or views.Int. */
export type DesignValues = Readonly<Record<string, string | number | boolean>>;

/** The starter's value for each prop of a kind: plain containers and text, framed values and pointers. */
export const starterLooks: Record<KindRole, Record<string, string | number | boolean>> = {
  container: {
    shown: true,
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    strokeStyle: 'solid',
    opacity: 1,
    color: 'neutral-900',
    font: 'sans',
    size: 1,
    weight: 'normal',
    padding: 0,
    radius: 0,
    minSize: 0,
    gap: 0.5,
    align: 'center',
    justify: 'start',
    overflow: 'included'
  },
  value: {
    shown: true,
    fill: 'white',
    stroke: 'neutral-300',
    strokeWidth: 1.5,
    strokeStyle: 'solid',
    opacity: 1,
    color: 'neutral-900',
    font: 'sans',
    size: 1.25,
    weight: 'bold',
    padding: 0.375,
    radius: 8,
    minSize: 2.5
  },
  text: {
    shown: true,
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    strokeStyle: 'solid',
    opacity: 1,
    color: 'neutral-600',
    font: 'sans',
    size: 1,
    weight: 'normal',
    padding: 0,
    radius: 0,
    minSize: 0
  },
  pointed: {
    fill: 'amber-100',
    stroke: 'amber-500',
    strokeWidth: 1.5,
    strokeStyle: 'solid',
    opacity: 1,
    color: 'neutral-900',
    font: 'sans',
    size: 1.25,
    weight: 'bold',
    padding: 0.375,
    radius: 8,
    minSize: 2.5,
    overflow: 'shown'
  },
  link: {
    shown: true,
    stroke: 'neutral-500',
    strokeWidth: 2,
    opacity: 1,
    strokeStyle: 'solid',
    color: 'neutral-600',
    curve: 'layout',
    bend: 'none'
  }
};

export const starterFrame: Record<keyof typeof frameOptions, string | number> = {
  'frame.ratio': '16:9',
  'frame.justify': 'center',
  'frame.align': 'center',
  'frame.padding': 1.5,
  'frame.gap': 1,
  'frame.layout': 'column'
};
