/**
 * The design space's options, how a variant's values become CSS, and the key each kind of node
 * reads its values by. The server generates a source's space and variants from these (see
 * ../../design.server.ts); the page reads a variant's values through them.
 */

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

/** Each prop's options: lengths in em, except size in rem and radius and strokeWidth in pixels. */
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
  overflow: ['shown', 'hidden', 'included', 'excluded']
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
  link: ['shown', 'stroke', 'strokeWidth', 'opacity', 'strokeStyle', 'color']
};

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
  if (prop !== 'overflow') return propOptions[prop];
  return role === 'pointed' ? overflowOptions.pointer : overflowOptions.collection;
}

/**
 * Props a kind only some steps draw a node as, by a tag the state decides, can vary: not those that
 * move its children or its room, which its base kind gives (see conditionalProps).
 */
const layoutProps: ReadonlySet<DesignProp> = new Set([
  'shown',
  'gap',
  'align',
  'justify',
  'overflow'
]);

/** The props of a kind drawn only under a conditional tag: paint, text, and inset, not layout. */
export function conditionalProps(role: KindRole): readonly DesignProp[] {
  return roleProps[role].filter((prop) => !layoutProps.has(prop));
}

/** Paint shows only where a pointer is; its other props hold in every slot, so slots keep one size. */
export const paintProps: ReadonlySet<string> = new Set([
  'fill',
  'stroke',
  'strokeStyle',
  'opacity',
  'color'
]);

/**
 * The kinds a node is drawn with: the one it is at a step, its base kind (its view and literal
 * tags), whose layout every kind of its tag takes, and, where tags depend on the state, every kind
 * its tag can be.
 */
export type KindSite = { kind: string; base: string; site?: readonly string[] };

/** The kind a node is of: its view (root outside one) and the tags it has, as Arrow[current]. */
export function kindKey(view: string, tags: readonly string[]): string {
  return tags.length ? `${view}[${tags.join(',')}]` : view;
}

/**
 * The tags a node has, from its tags prop: a name, names separated by spaces, or a list. A
 * <Pointed> or <Link> with none is of the kind its own tag names, pointed or link, apart from the
 * untagged nodes of its view.
 */
export function activeTags(tags: unknown, untagged?: 'pointed' | 'link'): string[] {
  const active =
    typeof tags === 'string'
      ? tags.split(/\s+/u).filter(Boolean)
      : Array.isArray(tags)
        ? tags.filter((tag): tag is string => typeof tag === 'string' && tag !== '')
        : [];
  return active.length || !untagged ? active : [untagged];
}

/** A variant: each variable's value, by key, as Arrow[current].fill or views.Int. */
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
    color: 'neutral-600'
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
