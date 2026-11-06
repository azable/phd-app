/**
 * The design space's options, how a variant's values become CSS, and the key each kind of node
 * reads its values by. The server generates a source's space and variants from these (see
 * ../../design.server.ts); the page reads a variant's values through them.
 */

import { fontValues, iconNames } from '../fonts';
import { directions, forms } from './forms';
import { headShapes, headSizes } from './heads';

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

/** An exact colour, as a base's palette writes it (see paletteKey): six hex digits after #. */
export const exactColour = /^#[\da-f]{6}$/iu;

/** A colour's CSS, or undefined for none and anything neither in the range nor exact. */
export function colourCss(name: unknown): string | undefined {
  if (typeof name === 'string' && exactColour.test(name)) return name.toLowerCase();
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

/**
 * A box's shadow, which only paints: its offset and blur in pixels, and how much of black it is,
 * hard's being a solid block in the box's stroke colour, or its text's without one.
 */
export const shadows = {
  soft: { x: 0, y: 1, blur: 4, alpha: 0.2 },
  lifted: { x: 0, y: 4, blur: 12, alpha: 0.3 },
  hard: { x: 3, y: 3, blur: 0, alpha: 1 }
} as const;
export type Shadow = keyof typeof shadows;

/** A glow: a halo round the box in its stroke colour, or its fill's without one. */
export const glowHalo = { blur: 8, spread: 2, alpha: 0.6 } as const;

/** Lines over a hatched fill, over the fill's colour. */
export const fillPatterns = {
  hatch: { angle: 45, line: 1.5, spacing: 6, alpha: 0.15 }
} as const;

const shadowOf = (name: unknown): Shadow | undefined =>
  typeof name === 'string' && Object.hasOwn(shadows, name) ? (name as Shadow) : undefined;
const translucent = (css: string, alpha: number) =>
  `color-mix(in srgb, ${css} ${alpha * 100}%, transparent)`;

/**
 * The paint round a box, as the box drawn has: its shadow, if drawn, and its glow, if on. Neither
 * shows on a node that draws no box, nor takes room.
 */
export function boxEffects(
  shadow: unknown,
  glow: unknown,
  { stroke, fill, text }: { stroke?: string; fill?: string; text?: string }
): { shadow?: Shadow; glow?: string; css?: string } {
  if (stroke === undefined && fill === undefined) return {};
  const drawn = shadowOf(shadow);
  const halo = glow === 'on' ? (stroke ?? fill) : undefined;
  const layers: string[] = [];
  if (drawn) {
    const { x, y, blur, alpha } = shadows[drawn];
    const ink = drawn === 'hard' ? (stroke ?? text ?? '#000000') : `rgb(0 0 0 / ${alpha})`;
    layers.push(`${x}px ${y}px ${blur}px ${ink}`);
  }
  if (halo)
    layers.push(`0 0 ${glowHalo.blur}px ${glowHalo.spread}px ${translucent(halo, glowHalo.alpha)}`);
  return {
    ...(drawn ? { shadow: drawn } : {}),
    ...(halo ? { glow: halo } : {}),
    ...(layers.length ? { css: layers.join(', ') } : {})
  };
}

export type Reach = { top: number; right: number; bottom: number; left: number };

export const noReach: Reach = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * How far paint round a box reaches past it on each side, in pixels: a shadow its blur less its
 * offset toward that side, a glow its blur and spread, an expansion its spread. A shadow's blur
 * fades over its blur radius (CSS blurs by half of it as a standard deviation), so that much is
 * kept.
 */
export function paintReach(shadow: unknown, glow: unknown, spread = 0): Reach {
  const reach = { top: spread, right: spread, bottom: spread, left: spread };
  const drawn = shadowOf(shadow);
  if (drawn) {
    const { x, y, blur } = shadows[drawn];
    reach.top = Math.max(reach.top, blur - y);
    reach.right = Math.max(reach.right, blur + x);
    reach.bottom = Math.max(reach.bottom, blur + y);
    reach.left = Math.max(reach.left, blur - x);
  }
  if (glow === 'on') {
    const halo = glowHalo.blur + glowHalo.spread;
    for (const side of ['top', 'right', 'bottom', 'left'] as const)
      reach[side] = Math.max(reach[side], halo);
  }
  return reach;
}

/** The larger reach on each side. */
export const widerReach = (a: Reach, b: Reach): Reach => ({
  top: Math.max(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
  left: Math.max(a.left, b.left)
});

/** Two reaches one beyond the other, as paint round a box the box is then moved with. */
export const addedReach = (a: Reach, b: Reach): Reach => ({
  top: a.top + b.top,
  right: a.right + b.right,
  bottom: a.bottom + b.bottom,
  left: a.left + b.left
});

/**
 * A pointer's transforms of what it is at, all paint, taking no room: its whole drawing scaled
 * from its anchors and moved, the marks round the element with it, and the box spread.
 */
export const transformProps = ['scale', 'spread', 'offsetX', 'offsetY'] as const;

/** How far an offset moves a drawing past its room on each side, negative being up or left. */
export function offsetReach(offsetX: unknown, offsetY: unknown): Reach {
  const x = typeof offsetX === 'number' ? offsetX : 0;
  const y = typeof offsetY === 'number' ? offsetY : 0;
  return {
    top: Math.max(0, -y),
    right: Math.max(0, x),
    bottom: Math.max(0, y),
    left: Math.max(0, -x)
  };
}

/**
 * How far a drawing scaled from its anchors grows past its box of the size given on each side:
 * all of it away from an anchor at the start or end, half each way from the centre, rounded up to
 * whole pixels so the room holds it.
 */
export function scaleReach(
  scale: unknown,
  anchors: { x: string; y: string },
  size: { width: number; height: number }
): Reach {
  const factor = typeof scale === 'number' && scale > 1 ? scale - 1 : 0;
  const grown = (length: number, anchor: string): [number, number] => {
    const total = Math.ceil(factor * length);
    if (anchor === 'start' || anchor === 'flex-start') return [0, total];
    if (anchor === 'end' || anchor === 'flex-end') return [total, 0];
    return [Math.ceil(total / 2), Math.ceil(total / 2)];
  };
  const [left, right] = grown(size.width, anchors.x);
  const [top, bottom] = grown(size.height, anchors.y);
  return { top, right, bottom, left };
}

/** Where a drawing scaled from its anchors stays put, as a CSS transform-origin. */
export function anchorOrigin(anchors: { x: string; y: string }): string {
  const at = (anchor: string, start: string, end: string) =>
    anchor === 'start' || anchor === 'flex-start'
      ? start
      : anchor === 'end' || anchor === 'flex-end'
        ? end
        : 'center';
  return `${at(anchors.x, 'left', 'right')} ${at(anchors.y, 'top', 'bottom')}`;
}

/** A drawn fill's style, as the image over its colour, or undefined for solid. */
export function fillStyleCss(name: unknown): { style: 'hatched'; css: string } | undefined {
  if (name === 'hatched') {
    const { angle, line, spacing, alpha } = fillPatterns.hatch;
    return {
      style: name,
      css: `repeating-linear-gradient(${angle}deg, rgb(0 0 0 / ${alpha}) 0 ${line}px, transparent ${line}px ${spacing}px)`
    };
  }
  return undefined;
}

/** A text decoration's line, or undefined for none. */
export function decorationCss(name: unknown): 'underline' | 'line-through' | undefined {
  return name === 'underline' ? 'underline' : name === 'strike' ? 'line-through' : undefined;
}

/**
 * A case as CSS, set on every node with one, so a node's own case, normal included, holds over its
 * parent's; undefined where the variant gives none.
 */
export function caseCss(
  name: unknown
): { transform: 'none' | 'uppercase'; caps: 'normal' | 'small-caps' } | undefined {
  if (name === 'uppercase') return { transform: 'uppercase', caps: 'normal' };
  if (name === 'small-caps') return { transform: 'none', caps: 'small-caps' };
  return name === 'normal' ? { transform: 'none', caps: 'normal' } : undefined;
}

/** A link's dashes and gaps by its stroke style, in the units of a curve 1.5 wide, its dots round. */
export const linkDashes = { dashed: [6, 4], dotted: [0, 4] } as const;

/** A colour's shade and hue, to keep a colour's lightness as its hue changes. */
export function colourParts(name: string): { hue: string; shade: number } | undefined {
  const match = /^([a-z]+)-(\d+)$/u.exec(name);
  return match ? { hue: match[1], shade: Number(match[2]) } : undefined;
}

const spacing = [0, 0.0625, 0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2];

/**
 * A component of a grid's basis vector, in pitches: halves give the shapes the guide names, as a
 * diamond's [0.5, 0.5] and [−0.5, 0.5].
 */
const basisSteps = [-1, -0.5, 0, 0.5, 1];

/**
 * Each prop's options: lengths in em, except textSize, radius, strokeWidth and headSize in
 * pixels; whether a box takes its slot's width and height or its own, and where its own sits in
 * the slot; whether a row or column places its children in their slots or packs them; how a pointer
 * scales, spreads and moves what it is at; a box's shadow, glow and fill style and its text's decoration and case; a free layout's
 * form, the way it runs, its arrows' curve, and the seed its spacing and nudges are drawn from; and
 * how a link runs, as its layout's arrows or its own way, and the heads at its ends.
 */
export const propOptions = {
  shown: [true, false],
  fill: ['none', ...colours],
  stroke: ['none', ...colours],
  strokeWidth: [0, 0.5, 1, 1.5, 2, 3, 4],
  opacity: [0.25, 0.5, 0.75, 1],
  color: colours,
  font: fontValues,
  textSize: [12, 14, 16, 18, 20, 24, 30, 36, 48],
  weight: ['normal', 'bold'],
  padding: spacing,
  radius: [0, 2, 4, 6, 8, 12, 999],
  minSize: [0, 1, 1.5, 2, 2.5, 3, 4],
  width: ['uniform', 'varying'],
  height: ['uniform', 'varying'],
  xAnchor: ['start', 'center', 'end'],
  yAnchor: ['start', 'center', 'end'],
  gap: spacing,
  spacing: ['slots', 'packed'],
  expand: [0, 2, 4, 8],
  scale: [1, 1.1, 1.2, 1.3],
  spread: [0, 2, 4, 6],
  offsetX: [-12, -8, -4, 0, 4, 8, 12],
  offsetY: [-12, -8, -4, 0, 4, 8, 12],
  align: ['start', 'center', 'end'],
  justify: ['start', 'center', 'end', 'between', 'around', 'evenly'],
  strokeStyle: ['solid', 'dashed', 'dotted'],
  overflow: ['shown', 'hidden'],
  shadow: ['none', 'soft', 'lifted', 'hard'],
  glow: ['none', 'on'],
  fillStyle: ['solid', 'hatched'],
  decoration: ['none', 'underline', 'strike'],
  case: ['normal', 'uppercase', 'small-caps'],
  form: forms,
  direction: directions,
  curve: ['straight', 'curved'],
  route: ['layout', 'straight', 'curved', 'wire'],
  head: headShapes,
  headSize: headSizes,
  layoutSeed: Array.from({ length: 32 }, (_, index) => index + 1),
  icon: iconNames,
  colX: basisSteps,
  colY: basisSteps,
  rowX: basisSteps,
  rowY: basisSteps
} satisfies Record<string, readonly (string | number | boolean)[]>;

export type DesignProp = keyof typeof propOptions;

/**
 * A layout's frame, the page around its root: each a variable of the layout's kind, as
 * Stacked.ratio, so each layout keeps its own frame (see design.server.ts).
 */
export const frameOptions = {
  ratio: ['fit', '16:9', '4:3', '3:2', '1:1', '3:4', '9:16'],
  justify: propOptions.justify,
  align: propOptions.align,
  padding: spacing,
  gap: spacing
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

/**
 * The paint that tells one place apart, a render's or a listing region's: all of it paint (see
 * paintProps), so a place never changes how much room anything takes.
 */
export const placePaint = ['fill', 'stroke', 'color'] as const;

/** The props a region of a listing sets for itself, as `listing.lit@insert.compare.left.fill`. */
export const listingRegionProps = placePaint;

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
  // Keywords in bold, as textbooks print them, or every kind of word in its colour too.
  'listing.syntax': ['none', 'keywords', 'colour'],
  ...Object.fromEntries(
    Object.entries(listingLitOptions).map(([prop, options]) => [`listing.lit.${prop}`, options])
  )
};

export const starterListing: Record<string, string | number> & { 'listing.language': string } = {
  'listing.language': 'none',
  'listing.syntax': 'keywords',
  'listing.lit.fill': 'amber-200',
  'listing.lit.stroke': 'none',
  'listing.lit.strokeWidth': 0,
  'listing.lit.strokeStyle': 'solid',
  'listing.lit.radius': 2,
  'listing.lit.color': 'none',
  'listing.lit.weight': 'normal',
  'listing.lit.padding': 0
};

/**
 * How a listing's tokens and the places they name light together, where a listing has tokens: the
 * token filled, underlined, or outlined, and in the picture a 3px band round the node, a line under
 * it, or a ring; `none` lights neither, and hovering one highlights nothing. None takes room.
 */
export const listingPlacesOptions = ['none', 'fill', 'underline', 'outline'] as const;
export type ListingPlacesLook = (typeof listingPlacesOptions)[number];
export const starterListingPlaces: ListingPlacesLook = 'fill';

/** What a kind of node is, which says the props it has. */
export type KindRole =
  | 'container'
  | 'value'
  | 'bar'
  | 'vertex'
  | 'text'
  | 'code'
  | 'icon'
  | 'pointed'
  | 'link';

const nodeProps: readonly DesignProp[] = [
  'shown',
  'fill',
  'stroke',
  'strokeWidth',
  'strokeStyle',
  'opacity',
  'color',
  'font',
  'textSize',
  'weight',
  'padding',
  'radius',
  'minSize',
  'width',
  'height',
  'xAnchor',
  'yAnchor',
  'shadow',
  'glow',
  'fillStyle',
  'decoration',
  'case'
];

/** How a box sits in its slot, which a <Pointed> drawn round its element does not have. */
const slotProps: ReadonlySet<DesignProp> = new Set(['width', 'height', 'xAnchor', 'yAnchor']);

/** The starter's slot: every box as large as its slot, so equal boxes line up. */
const uniformSlot = {
  width: 'uniform',
  height: 'uniform',
  xAnchor: 'center',
  yAnchor: 'center'
} satisfies Partial<Record<DesignProp, string>>;

/** The props a kind of node has: a layout's own, nothing to hide a <Pointed> by, a link's line. */
export const roleProps: Record<KindRole, readonly DesignProp[]> = {
  container: [...nodeProps, 'gap', 'align', 'justify', 'spacing'],
  value: nodeProps,
  bar: nodeProps,
  vertex: nodeProps,
  text: nodeProps,
  code: nodeProps,
  icon: [...nodeProps, 'icon'],
  pointed: [
    ...nodeProps.filter((prop) => prop !== 'shown' && !slotProps.has(prop)),
    'overflow',
    'expand',
    ...transformProps
  ],
  link: ['shown', 'stroke', 'strokeWidth', 'opacity', 'strokeStyle', 'route', 'head', 'headSize']
};

/** The props a kind arranging a free layout has besides its role's: how the layout looks. */
export const freeLayoutProps: readonly DesignProp[] = ['form', 'direction', 'curve', 'layoutSeed'];

/**
 * The props a kind arranging a grid has besides its role's: its basis, the x and y of the vector
 * its columns run along and of the one its rows run along, starting square, as a table.
 */
export const gridProps: readonly DesignProp[] = ['colX', 'colY', 'rowX', 'rowY'];
export const starterGrid: Record<string, number> = { colX: 1, colY: 0, rowX: 0, rowY: 1 };

/** A free layout's starting look, but for its direction (see starterLook in design.server.ts). */
export const starterFreeLayout: Record<string, string | number> = {
  form: 'natural',
  curve: 'straight',
  layoutSeed: 1
};

/**
 * Paint: how a node looks in its room, never how much room it takes. Whatever changes a look from
 * step to step or render to render, a pointer at a node, a place, a listing's lit region, sets
 * only paint; every other prop is its kind's in every slot and at every step, so slots keep one
 * size. A pointer's paint shows only where it is, its other props in every slot it can point at.
 * `expand` is paint, taking room only in a packed row, which keeps room for it; a pointer's
 * transforms (transformProps) are paint, drawn over the room kept for their reach.
 */
export const paintProps: ReadonlySet<string> = new Set([
  'fill',
  'expand',
  ...transformProps,
  'stroke',
  'strokeStyle',
  'opacity',
  'color',
  'shadow',
  'glow',
  'fillStyle',
  'decoration'
]);

/**
 * The props a place sets for the kinds of the view it draws, those that tell one render apart: its
 * paint, and whether it is shown at all, which holds at every step, a render left out keeping no
 * room throughout.
 */
export const placeProps: ReadonlySet<string> = new Set(['shown', ...placePaint]);

/**
 * A render at a place: `:` and what is written there (`:left`, `:g.a`, or a label, `:@scan.next`),
 * the path of the view it is written in, as `Ask.` (empty outside views), and the view it draws,
 * the variant's choice. A render with no name, as {j - 1}, has an empty `at` and its expression as
 * `written`, for place().
 */
export type Place = { within: string; at: string; view?: string; written?: string };

/**
 * The design variable captioning a place, as `:lo.label` for `:lo` or `:@scan.next.label` for a
 * label's place, which place() in its view gives: any short text, the place's own short name to
 * start (see placeName).
 */
export const placeLabelKey = (at: string): string => `${at}.label`;

/** A place's caption key, `:lo.label` or `:@scan.next.label`, its place's name the first group. */
export const placeCaption = /^:(@?[\w$.]+?)\.label$/u;

/** Whether a variable is a place's label, which takes any short text rather than an option. */
export const isPlaceLabel = (key: string): boolean => placeCaption.test(key);

/**
 * A place's own name, as place() gives it with no caption in the design: a variable's or field's as
 * written (`lo`, `pair.left`), a label's last name, never its path (`next` for `:@scan.next`), as
 * a label marks a moment of the run and its path only says where in the code.
 */
export const placeName = (at: string): string =>
  at.startsWith(':@') ? at.slice(at.lastIndexOf('.') + 1).replace(/^:?@/u, '') : at.slice(1);

/**
 * A kind's own variables at a place, as `IntCell:swap.held` or `Highlight.Pointed:left`: for the
 * kinds of the view the place draws, its nested snippets' included; none for another kind.
 */

/** The longest label a place takes, a word or two under a mark. */
export const placeLabelLength = 24;

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

/** The starter's box and text styling, every kind of node's: today's look. */
const plainStyle = {
  shadow: 'none',
  glow: 'none',
  fillStyle: 'solid',
  decoration: 'none',
  case: 'normal'
} satisfies Partial<Record<DesignProp, string>>;

/** The starter's value for each prop of a kind: plain containers and text, framed values and pointers. */
export const starterLooks: Record<KindRole, Record<string, string | number | boolean>> = {
  container: {
    shown: true,
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    strokeStyle: 'solid',
    opacity: 1,
    color: 'black',
    font: fontValues[0],
    textSize: 16,
    weight: 'normal',
    padding: 0,
    radius: 0,
    minSize: 0,
    ...plainStyle,
    ...uniformSlot,
    gap: 0.5,
    align: 'center',
    justify: 'start',
    spacing: 'slots'
  },
  value: {
    shown: true,
    fill: 'white',
    stroke: 'neutral-300',
    strokeWidth: 1.5,
    strokeStyle: 'solid',
    opacity: 1,
    color: 'black',
    font: fontValues[0],
    textSize: 20,
    weight: 'bold',
    padding: 0.375,
    radius: 8,
    minSize: 2.5,
    ...plainStyle,
    ...uniformSlot
  },
  // A node sized by its value, as <Node height={this} />: a filled bar with square corners, so a
  // short one stays a bar rather than rounding into a pill, as wide as a value's frame beside it
  // (its least size holds across its length only, which is its value).
  bar: {
    shown: true,
    fill: 'neutral-300',
    stroke: 'neutral-500',
    strokeWidth: 1,
    strokeStyle: 'solid',
    opacity: 1,
    color: 'black',
    font: fontValues[0],
    textSize: 20,
    weight: 'normal',
    padding: 0,
    radius: 2,
    minSize: 2.5,
    ...plainStyle,
    ...uniformSlot
  },
  // A node a free layout's links join, as a graph's vertex or a machine's state: a circle, so
  // links meet an edge and do not run into its text.
  vertex: {
    shown: true,
    fill: 'white',
    stroke: 'neutral-400',
    strokeWidth: 1.5,
    strokeStyle: 'solid',
    opacity: 1,
    color: 'black',
    font: fontValues[0],
    textSize: 18,
    weight: 'bold',
    padding: 0.5,
    radius: 999,
    minSize: 2.5,
    ...plainStyle,
    ...uniformSlot
  },
  text: {
    shown: true,
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    strokeStyle: 'solid',
    opacity: 1,
    color: 'black',
    font: fontValues[0],
    textSize: 16,
    weight: 'normal',
    padding: 0,
    radius: 0,
    minSize: 0,
    ...plainStyle,
    ...uniformSlot
  },
  // A caption's token, text naming a place (see listing/places.ts), drawn as inline code.
  code: {
    shown: true,
    fill: 'neutral-100',
    stroke: 'none',
    strokeWidth: 0,
    strokeStyle: 'solid',
    opacity: 1,
    color: 'black',
    font: fontValues.includes('mono') ? 'mono' : fontValues[0],
    textSize: 16,
    weight: 'normal',
    // A little room inside its tint, so the code does not touch the tint's edge.
    padding: 0.125,
    radius: 4,
    minSize: 0,
    ...plainStyle,
    ...uniformSlot
  },
  // A node drawing one icon its kind chooses, as <Node icon />, beside other content as a word is.
  icon: {
    shown: true,
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    strokeStyle: 'solid',
    opacity: 1,
    color: 'black',
    font: fontValues[0],
    textSize: 20,
    weight: 'normal',
    padding: 0,
    radius: 0,
    minSize: 0,
    ...plainStyle,
    ...uniformSlot,
    icon: 'circle-dot'
  },
  pointed: {
    fill: 'amber-100',
    stroke: 'amber-500',
    strokeWidth: 1.5,
    strokeStyle: 'solid',
    opacity: 1,
    color: 'black',
    font: fontValues[0],
    textSize: 20,
    weight: 'bold',
    padding: 0.375,
    radius: 8,
    minSize: 2.5,
    ...plainStyle,
    overflow: 'shown',
    expand: 0,
    scale: 1,
    spread: 0,
    offsetX: 0,
    offsetY: 0
  },
  link: {
    shown: true,
    stroke: 'neutral-500',
    strokeWidth: 2,
    opacity: 1,
    strokeStyle: 'solid',
    route: 'layout',
    head: 'arrow',
    headSize: 9
  }
};

/**
 * The design's tokens, each written with `$` and holding one value of one prop, as `$accent` a
 * stroke: the values the starter looks share across roles, so one token changes all of them. A
 * role's value can name a token of a prop with no more options than its own (see tokenFits).
 */
export const tokenProps = {
  $text: 'color',
  $font: 'font',
  $surface: 'fill',
  $accent: 'stroke',
  $highlight: 'fill',
  $spacing: 'padding',
  $radius: 'radius',
  $lineWidth: 'strokeWidth'
} as const satisfies Record<`$${string}`, DesignProp>;

export type DesignToken = keyof typeof tokenProps;

/** Whether a key or a value names a token, as `$accent`. */
export const isToken = (name: unknown): name is DesignToken =>
  typeof name === 'string' && Object.hasOwn(tokenProps, name);

/**
 * Each token's starter value, today's look: text black in the first font on white values, pointers
 * amber, and the padding, corners and line width framed values and pointers share.
 */
export const starterTokens: Record<DesignToken, string | number> = {
  $text: 'black',
  $font: fontValues[0],
  $surface: 'white',
  $accent: 'amber-500',
  $highlight: 'amber-100',
  $spacing: 0.375,
  $radius: 8,
  $lineWidth: 1.5
};

/**
 * The tags whose kinds a group sets together, as `<Node>.padding` for every kind a <Node> makes
 * that has padding: <Node> for every node role, <Pointed> for pointer marks, <Link> for links.
 * The listing's own group, <Listing>, names its settings (see listingAlias).
 */
export type DesignTag = '<Node>' | '<Pointed>' | '<Link>';

/** The tag making each role's kinds. */
export const tagOf = (role: KindRole): DesignTag =>
  role === 'pointed' ? '<Pointed>' : role === 'link' ? '<Link>' : '<Node>';

/** The variable setting a prop for every kind of a tag, as `<Node>.padding`. */
export const groupKey = (tag: DesignTag, prop: string): string => `${tag}.${prop}`;

/** A group's tag and prop, as `<Node>` and padding for `<Node>.padding`. */
export function groupOf(key: string): { tag: DesignTag; prop: DesignProp } | undefined {
  const match = /^(<Node>|<Pointed>|<Link>)\.([A-Za-z]+)$/u.exec(key);
  return match ? { tag: match[1] as DesignTag, prop: match[2] as DesignProp } : undefined;
}

/** `<Listing>.syntax` is listing.syntax, as every listing setting: the listing's group is its own. */
export const listingAlias = (key: string): string =>
  key.startsWith('<Listing>.') ? `listing.${key.slice('<Listing>.'.length)}` : key;

/**
 * The props a role's kinds take from their group: their role's, but whether a kind is shown, which
 * stays each kind's own, so no one value hides every kind of a tag.
 */
export const groupProps = (role: KindRole): readonly DesignProp[] =>
  roleProps[role].filter((prop) => prop !== 'shown');

/** Whether a prop can name a token: every value the token can hold is one of the prop's. */
export function tokenFits(prop: DesignProp, token: DesignToken): boolean {
  const options = propOptions[prop];
  return propOptions[tokenProps[token]].every((option) => options.includes(option as never));
}

/**
 * A group's options for a prop, where a role of the kinds it reaches has it: the prop's, and each
 * token that fits it.
 */
export function groupOptions(
  roles: readonly KindRole[],
  prop: DesignProp
): readonly (string | number | boolean)[] {
  if (!roles.some((role) => groupProps(role).includes(prop))) return [];
  return [
    ...propOptions[prop],
    ...(Object.keys(tokenProps) as DesignToken[]).filter((token) => tokenFits(prop, token))
  ];
}

/**
 * A style, written with `$` as a token is but holding a group of props, as `$cell` with
 * `$cell.stroke` and `$cell.padding`, which kinds inherit (see levelFor). A token's name is never a
 * style's.
 */
export const isStyle = (name: unknown): name is `$${string}` =>
  typeof name === 'string' && /^\$[A-Za-z]\w*$/u.test(name) && !isToken(name);

/** A style's prop, as `$cell` and padding for `$cell.padding`. */
export function styleOf(key: string): { style: `$${string}`; prop: string } | undefined {
  const match = /^(\$[A-Za-z]\w*)\.([a-z]\w*)$/u.exec(key);
  return match && isStyle(match[1])
    ? { style: match[1] as `$${string}`, prop: match[2] }
    : undefined;
}

/**
 * The style holding a role's look in a design's base, as `$Value` for every value kind: each prop a
 * kind of the role follows below its group, so the base sets every role's look as data and the
 * engine has none of its own (see starter-base.ts and missingRoleLooks). Capitalised, as a role's look is no token
 * (`$text` is the text colour, `$Text` the text role's look).
 */
export const roleStyle = (role: KindRole): `$${string}` =>
  `$${role[0].toUpperCase()}${role.slice(1)}`;

/** The role a style holds the look of, as value for `$Value`, or undefined for any other style. */
export function roleOfStyle(style: string): KindRole | undefined {
  return (Object.keys(roleProps) as KindRole[]).find((role) => roleStyle(role) === style);
}

/**
 * The base a design starts from, written `"...": "$textbook"` at its top: the name of the template
 * the assistant wrote out in full into the design (see assistant/templates), or of a base the model
 * wrote itself, so the base's values are the design's own and the name records where they came from.
 */
export const baseKey = 'base';

/** A base's name: `$` and a short name, as `$textbook`, or `$mine` for a base the model wrote. */
export const baseName = /^\$[a-z][\w-]{0,31}$/u;

/**
 * A base's scales, each the steps its props take (see scaleKey): spacing for padding and gaps, in
 * em; radius, type (textSize) and line (strokeWidth) in pixels; opacity from 0 to 1. A kind, a
 * group or a token then takes only a step on its prop's scale, so two kinds cannot drift to 13 px
 * and 14 px, and a comparison or a random variant moves along the scale. A design without a scale
 * keeps the prop's full option set (propOptions), as every design did before bases.
 */
export const scaleProps = {
  spacing: ['padding', 'gap'],
  radius: ['radius'],
  type: ['textSize'],
  line: ['strokeWidth'],
  opacity: ['opacity']
} as const satisfies Record<string, readonly DesignProp[]>;

export type ScaleName = keyof typeof scaleProps;

/** The variable holding a scale, as `scale.spacing`, written nested as `"scale": {"spacing": …}`. */
export const scaleKey = (name: ScaleName): string => `scale.${name}`;

/**
 * A scale's steps from its value: numbers separated by spaces, as "0 0.25 0.5 1", since a design
 * value is one string, number or boolean. Undefined unless every step is in the prop's range (0 or
 * more; opacity above 0 and at most 1) and the steps rise.
 */
export function scaleSteps(name: ScaleName, value: unknown): number[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const steps = value.trim().split(/\s+/u).map(Number);
  const inRange = (step: number) =>
    Number.isFinite(step) && step >= 0 && (name !== 'opacity' || (step > 0 && step <= 1));
  const rising = steps.every((step, at) => at === 0 || step > steps[at - 1]);
  return steps.every(inRange) && rising ? steps : undefined;
}

/** The scale a prop takes its steps from, if any. */
export const scaleOf = (prop: string): ScaleName | undefined =>
  (Object.keys(scaleProps) as ScaleName[]).find((name) =>
    (scaleProps[name] as readonly string[]).includes(prop)
  );

/**
 * A base's palette: its exact colours, each under a name, as `palette.accent` "#E69F00", written
 * nested as `"palette": {"accent": …}`. Each joins the options of every colour prop beside the named
 * range, so a base can use colours from practice and sources, as the Okabe–Ito palette.
 */
export const paletteKey = /^palette\.[a-z]\w*$/u;

/**
 * Whether a variable belongs to a base, which holds every value whether the source uses it or not:
 * a token, a role's style, a scale, a colour of the palette, the base's name, and the listing's
 * look. A source with no use for one, as a listing's look where the view places no <Listing />,
 * leaves it out without a word.
 */
export function isBaseKey(key: string): boolean {
  const style = styleOf(key);
  return (
    isToken(key) ||
    key === baseKey ||
    paletteKey.test(key) ||
    /^scale\.[a-z]+$/u.test(key) ||
    (style !== undefined && roleOfStyle(style.style) !== undefined) ||
    (key.startsWith('listing.') && key !== 'listing.language')
  );
}

/**
 * A prop's options under a design's base: its scale's steps where the design sets that scale (a
 * line also takes 0, for no line), keeping the tokens and other names among `options`; and every
 * colour prop also the palette's colours. Without a scale or a palette, `options` as they are.
 */
export function baseOptions(
  prop: string,
  options: readonly (string | number | boolean)[],
  values: Readonly<Record<string, unknown>>
): readonly (string | number | boolean)[] {
  const scale = scaleOf(prop);
  const steps = scale ? scaleSteps(scale, values[scaleKey(scale)]) : undefined;
  const scaled = steps
    ? [
        ...(scale === 'line' && !steps.includes(0) ? [0] : []),
        ...steps,
        ...options.filter((option) => typeof option !== 'number')
      ]
    : options;
  if (!['fill', 'stroke', 'color'].includes(prop)) return scaled;
  const palette = Object.entries(values).flatMap(([key, value]) =>
    paletteKey.test(key) && typeof value === 'string' && exactColour.test(value) ? [value] : []
  );
  const added = [...new Set(palette)].filter((colour) => !scaled.includes(colour));
  return added.length ? [...scaled, ...added] : scaled;
}

/** The variable naming what a kind inherits: a style, a kind of its role, or none. */
export const inheritKey = (kind: string): string => `${kind}.inherit`;

/**
 * What a kind's prop follows, and the variable its value comes from: what the kind inherits where
 * that sets the prop (a style's prop, naming a token or a value, or a kind of its role's own value),
 * else its group's value where the variant sets it, else its role's style in the base (see
 * roleStyle), through tokens; no value where the base sets none, which the build refuses (see
 * missingRoleLooks). Undefined for a variable that is no kind's prop a group could set (a place's,
 * a frame's, a view choice).
 * Shared by the build and the assistant's design, so both tell what follows what alike.
 */
export function levelFor(
  values: Readonly<Record<string, string | number | boolean>>,
  roles: Readonly<Record<string, KindRole>>,
  key: string
): { value: string | number | boolean | undefined; from?: string } | undefined {
  const dot = key.lastIndexOf('.');
  const kind = key.slice(0, Math.max(0, dot));
  const role = Object.hasOwn(roles, kind) ? roles[kind] : undefined;
  const prop = key.slice(dot + 1) as DesignProp;
  if (!role || !groupProps(role).includes(prop)) return undefined;
  const source = values[inheritKey(kind)];
  if (typeof source === 'string' && source !== 'none') {
    const from = `${source}.${prop}`;
    if (Object.hasOwn(values, from)) {
      const value = values[from];
      return isToken(value) ? { value: values[value], from: value } : { value, from };
    }
  }
  const group = groupKey(tagOf(role), prop);
  const base = `${roleStyle(role)}.${prop}`;
  const from = Object.hasOwn(values, group)
    ? group
    : Object.hasOwn(values, base)
      ? base
      : undefined;
  if (!from) return { value: undefined };
  const level = values[from];
  return isToken(level) ? { value: values[level], from: level } : { value: level, from };
}

/**
 * The role styles a design's base leaves out, as `$Value.fill`, among the roles its kinds have: a
 * base sets every role's look its kinds follow, so no kind falls back to a look nobody chose.
 */
export function missingRoleLooks(
  values: Readonly<Record<string, unknown>>,
  roles: Readonly<Record<string, KindRole>>
): string[] {
  const used = new Set(Object.values(roles));
  return [...used].flatMap((role) =>
    groupProps(role)
      .map((prop) => `${roleStyle(role)}.${prop}`)
      .filter((key) => !Object.hasOwn(values, key))
  );
}

export const starterFrame: Record<keyof typeof frameOptions, string | number> = {
  ratio: 'fit',
  justify: 'center',
  align: 'center',
  padding: 1.5,
  gap: 1
};
