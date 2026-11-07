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
 * offset toward that side, a glow its blur and spread. A shadow's blur
 * fades over its blur radius (CSS blurs by half of it as a standard deviation), so that much is
 * kept.
 */
export function paintReach(shadow: unknown, glow: unknown): Reach {
  const reach = { top: 0, right: 0, bottom: 0, left: 0 };
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
 * the slot; whether a row or column places its children in their slots or packs them; a box's shadow, glow and fill style and its text's decoration and case; a free layout's
 * form, the way it runs, its arrows' curve, and the seed its spacing and nudges are drawn from; and
 * how a link runs, as its layout's arrows or its own way, and the heads at its ends; and how a link
 * from a variable paints the element it reaches, none leaving it as it is.
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
  iconSize: [12, 14, 16, 18, 20, 24, 30, 36, 48],
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
  align: ['start', 'center', 'end'],
  justify: ['start', 'center', 'end', 'between', 'around', 'evenly'],
  strokeStyle: ['solid', 'dashed', 'dotted'],
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
  layer: [1, 2, 3],
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

/** The props whose values are colours, a palette's among them (see baseOptions). */
export const colourProps: readonly string[] = placePaint;

/**
 * A link's end, `<To>`, a kind of its own inside the link's kind, as `Arrow.<Link>.<To>`: the head
 * drawn there, and how a link from a variable (see Link.svelte) paints the element it reaches
 * while it is drawn, `none` leaving that paint as it is. Paint only, its line drawn inside the
 * element's box, so no box changes size, and never whether anything is shown. Where several links
 * paint one element, each setting is the one from the link on the highest `layer`, 1 to 3, and on
 * one layer the link written later (see linksFromVariables in ../model/scene-of.ts).
 */
export const endProps: readonly DesignProp[] = [
  'head',
  'fill',
  'stroke',
  'strokeWidth',
  'color',
  'layer'
];

/** A link's end kinds, as the design names them. */
export const linkEnd = '<To>';

/** Whether a kind is a link's end, as `Arrow.<Link>.<To>`, or a place's, as `Arrow.<Link>.<To>:i`. */
export const isLinkEnd = (kind: string): boolean => /\.<To>(?::|$)/u.test(kind);

/** The props a region of a listing sets for itself, as `<Listing>.lit@insert.compare.left.fill`. */
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
  '<Listing>.language': readonly string[];
} = {
  '<Listing>.language': ['none'],
  // Keywords in bold, as textbooks print them, or every kind of word in its colour too.
  '<Listing>.syntax': ['none', 'keywords', 'colour'],
  ...Object.fromEntries(
    Object.entries(listingLitOptions).map(([prop, options]) => [`<Listing>.lit.${prop}`, options])
  )
};

/**
 * How a listing's tokens and the places they name light together, where a listing has tokens: the
 * token filled, underlined, or outlined, and in the picture a 3px band round the node, a line under
 * it, or a ring; `none` lights neither, and hovering one highlights nothing. None takes room.
 */
export const listingPlacesOptions = ['none', 'fill', 'underline', 'outline'] as const;
export type ListingPlacesLook = (typeof listingPlacesOptions)[number];

/** A node's props, every kind of node's (see KindFunction for the others a kind has). */
export const nodeProps: readonly DesignProp[] = [
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

/** A link's props: its line, its route, its heads, and the paint it gives what it reaches. */
export const linkProps: readonly DesignProp[] = [
  'shown',
  'stroke',
  'strokeWidth',
  'opacity',
  'strokeStyle',
  'route',
  'headSize'
];

/** The props of a node arranging others, with a layout, links, or one {#each}: how it lays them out. */
export const layoutProps: readonly DesignProp[] = ['gap', 'align', 'justify', 'spacing'];

/** The props of a bare icon, `<Node icon />`: which icon it draws, and how large. */
export const iconProps: readonly DesignProp[] = ['icon', 'iconSize'];

/**
 * The bases, built-in styles each kind follows where neither it nor what it inherits sets a prop:
 * `<Node>` every node, `<Code>` the inline code a token in a node's text draws (kind `Code` under
 * its node), and `<Link>` every link, with its end, `<Link>.<To>`. The listing's look is
 * `<Listing>`. Each holds the props its kinds can have.
 */
export const baseProps = {
  '<Node>': [...nodeProps, ...layoutProps, ...iconProps].filter((prop) => prop !== 'shown'),
  '<Code>': nodeProps.filter((prop) => prop !== 'shown'),
  '<Link>': linkProps.filter((prop) => prop !== 'shown'),
  '<Link>.<To>': endProps
} as const satisfies Record<string, readonly DesignProp[]>;

export type DesignBase = keyof typeof baseProps;

/** A base's prop, as `<Node>` and fill for `<Node>.fill`, or `<Link>.<To>` and fill. */
export function baseOf(key: string): { base: DesignBase; prop: DesignProp } | undefined {
  const match = /^(<Node>|<Code>|<Link>(?:\.<To>)?)\.([a-z]\w*)$/u.exec(key);
  const base = match?.[1] as DesignBase | undefined;
  return base && (baseProps[base] as readonly string[]).includes(match![2])
    ? { base, prop: match![2] as DesignProp }
    : undefined;
}

/** The props a kind arranging a free layout has besides a node's: how the layout looks. */
export const freeLayoutProps: readonly DesignProp[] = ['form', 'direction', 'curve', 'layoutSeed'];

/**
 * The props a kind arranging a grid has besides a node's: its basis, the x and y of the vector
 * its columns run along and of the one its rows run along, starting square, as a table.
 */
export const gridProps: readonly DesignProp[] = ['colX', 'colY', 'rowX', 'rowY'];

/**
 * Paint: how a node looks in its room, never how much room it takes. Whatever changes a look from
 * step to step or render to render, a link from a variable reaching a node, a place, a listing's
 * lit region, sets only paint; every other prop is its kind's in every slot and at every step, so
 * slots keep one size. A link end's paint (endProps) is paint on the element it reaches, its width
 * drawn inside that box.
 */
export const paintProps: ReadonlySet<string> = new Set([
  'fill',
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
 * paint, a link end's paint among it, and whether it is shown at all, which holds at every step, a
 * render left out keeping no room throughout.
 */
export const placeProps: ReadonlySet<string> = new Set(['shown', ...placePaint, 'layer']);

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
 * A kind's own variables at a place, as `IntCell:swap.held` or `Mark.<Link>:left`: for the
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
 * `Row`), and for a <Link>, that part, as `Mark.<Link>`.
 */
export function kindKey(view: string, part?: 'Link'): string {
  return part ? `${view}.<${part}>` : view;
}

/** A variant: each variable's value, by key, as IntCell.fill or views.Int. */
export type DesignValues = Readonly<Record<string, string | number | boolean>>;

/**
 * The design's tokens, each written with `$` and holding one value of one prop, as `$accent` a
 * stroke: values a template's styles and bases share, so one token changes all of them. A value
 * can name a token of a prop with no more options than its own (see tokenFits).
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

/** Whether a prop can name a token: every value the token can hold is one of the prop's. */
export function tokenFits(prop: DesignProp, token: DesignToken): boolean {
  const options = propOptions[prop];
  return propOptions[tokenProps[token]].every((option) => options.includes(option as never));
}

/**
 * A prop's options for a kind: the prop's, but a link end's text colour, which also takes none,
 * leaving the reached element's colour as it is.
 */
export const kindPropOptions = (
  prop: DesignProp,
  end = false
): readonly (string | number | boolean)[] =>
  end && prop === 'color' ? ['none', ...colours] : propOptions[prop];

/** A base's options for a prop: the prop's, and each token that fits it (see baseOptions for scales). */
export function tokenedOptions(
  prop: DesignProp,
  end = false
): readonly (string | number | boolean)[] {
  return [
    ...kindPropOptions(prop, end),
    ...(Object.keys(tokenProps) as DesignToken[]).filter((token) => tokenFits(prop, token))
  ];
}

/**
 * A style, written with `$` as a token is but holding a group of props, as `$cell` with
 * `$cell.stroke` and `$cell.padding`, which kinds inherit (see resolvedValue in
 * ../../design.server.ts). A token's name is never a style's.
 */
export const isStyle = (name: unknown): name is `$${string}` =>
  typeof name === 'string' &&
  /^\$[A-Za-z]\w*$/u.test(name) &&
  !isToken(name) &&
  oldBuiltIn(name) === undefined;

/**
 * The built-in name a key's first part once was, with what is written now: a role's style, as
 * `<Value>` or `$Value`, is a template's style a kind links to, as `"IntCell": {"...": "$cell"}`;
 * `<Pointer>` is `<Link>`, whose end paints what a link from a variable reaches; and `listing` is
 * `<Listing>`. Undefined for any other.
 */
export function oldBuiltIn(key: string): { old: string; now: string } | undefined {
  const first = /^(\$[A-Za-z]\w*|<[A-Za-z]+>|listing)(?=\.|$)/u.exec(key)?.[1];
  if (first === 'listing') return { old: first, now: '<Listing>' };
  const name = first && /^(?:\$|<)([A-Z][a-z]+)>?$/u.exec(first)?.[1];
  if (name === 'Pointer') return { old: first!, now: '<Link>' };
  return name && ['Value', 'Container', 'Text', 'Icon', 'Bar', 'Vertex'].includes(name)
    ? { old: first!, now: 'a template\'s style a kind links to, as "IntCell": {"...": "$cell"}' }
    : undefined;
}

/** A style's prop, as `$cell` and padding for `$cell.padding`. */
export function styleOf(key: string): { style: `$${string}`; prop: string } | undefined {
  const match = /^(\$[A-Za-z]\w*)\.([a-z]\w*)$/u.exec(key);
  return match && isStyle(match[1])
    ? { style: match[1] as `$${string}`, prop: match[2] }
    : undefined;
}

/**
 * The key a request names a template by, as `"template": "$slide"`: the build copies that
 * template's file in as the design (see ../../templates), so the version holds every value it draws
 * with and keeps no link to the template; the stored design never names one.
 */
export const templateKey = 'template';

/**
 * A base's scales, each the steps its props take (see scaleKey): spacing for padding and gaps, in
 * em; radius, type (textSize, iconSize) and line (strokeWidth) in pixels; opacity from 0 to 1. A kind, a
 * group or a token then takes only a step on its prop's scale, so two kinds cannot drift to 13 px
 * and 14 px, and a comparison or a random variant moves along the scale. A design without a scale
 * keeps the prop's full option set (propOptions), as every design did before bases.
 */
export const scaleProps = {
  spacing: ['padding', 'gap'],
  radius: ['radius'],
  type: ['textSize', 'iconSize'],
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
 * Whether a variable belongs to a template's file, which holds every value whether the source uses
 * it or not: a token, a base's prop, a scale, a colour of the palette, and the listing's look. A source with no use for one, as a listing's look where the view places no <Listing />,
 * leaves it out without a word.
 */
export function isBaseKey(key: string): boolean {
  return (
    isToken(key) ||
    paletteKey.test(key) ||
    /^scale\.[a-z]+$/u.test(key) ||
    baseOf(key) !== undefined ||
    (key.startsWith('<Listing>.') && key !== '<Listing>.language')
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
  if (!colourProps.includes(prop)) return scaled;
  const palette = Object.entries(values).flatMap(([key, value]) =>
    paletteKey.test(key) && typeof value === 'string' && exactColour.test(value) ? [value] : []
  );
  const added = [...new Set(palette)].filter((colour) => !scaled.includes(colour));
  return added.length ? [...scaled, ...added] : scaled;
}

/** The variable naming what a kind inherits over its base: a style or another kind. */
export const inheritKey = (kind: string): string => `${kind}.inherit`;

/**
 * The value every prop takes where nothing writes it, the same for every kind: no paint, no room,
 * plain text, and a layout's first form. A design's template writes what it uses (see
 * ../../templates).
 */
export const neutralValues: Readonly<Record<DesignProp, string | number | boolean>> = {
  shown: true,
  fill: 'none',
  stroke: 'none',
  strokeWidth: 0,
  opacity: 1,
  color: 'black',
  font: 'sans',
  textSize: 16,
  iconSize: 16,
  weight: 'normal',
  padding: 0,
  radius: 0,
  minSize: 0,
  width: 'uniform',
  height: 'uniform',
  xAnchor: 'center',
  yAnchor: 'center',
  gap: 0,
  spacing: 'slots',
  align: 'center',
  justify: 'start',
  strokeStyle: 'solid',
  shadow: 'none',
  glow: 'none',
  fillStyle: 'solid',
  decoration: 'none',
  case: 'normal',
  form: 'natural',
  direction: 'right',
  curve: 'straight',
  route: 'layout',
  head: 'none',
  headSize: 9,
  layoutSeed: 1,
  layer: 1,
  icon: 'circle-dot',
  colX: 1,
  colY: 0,
  rowX: 0,
  rowY: 1
};

/** A prop's neutral value (see neutralValues); a link end's text colour is none, leaving it as it is. */
export const neutralValue = (prop: DesignProp, end = false): string | number | boolean =>
  end && prop === 'color' ? 'none' : neutralValues[prop];

/** The listing's neutral look: plain text, nothing lit, no places lit with its tokens. */
export const neutralListing: Readonly<Record<string, string | number>> = {
  '<Listing>.syntax': 'none',
  '<Listing>.places': 'none',
  '<Listing>.lit.fill': 'none',
  '<Listing>.lit.stroke': 'none',
  '<Listing>.lit.strokeWidth': 0,
  '<Listing>.lit.strokeStyle': 'solid',
  '<Listing>.lit.radius': 0,
  '<Listing>.lit.color': 'none',
  '<Listing>.lit.weight': 'normal',
  '<Listing>.lit.padding': 0
};

export const starterFrame: Record<keyof typeof frameOptions, string | number> = {
  ratio: 'fit',
  justify: 'center',
  align: 'center',
  padding: 1.5,
  gap: 1
};
