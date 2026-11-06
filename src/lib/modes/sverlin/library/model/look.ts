/**
 * Each element's look as layout needs it, worked out from the cascade (see css.ts) as the browser
 * computes style: shorthands as their longhands, inherited properties from the parent, lengths in
 * pixels, and the browser's own defaults for the few elements a view draws. Lengths are kept as
 * computed; layout rounds them as the browser lays out (see layout.ts).
 */

import { attributesRead, cascade, type Rule } from './css';
import { classesOf, type ModelElement } from './tree';

/** A length, or a share of the containing block's size, as 100%. */
export type Length = { px: number; percent: number };
export type Sides = [top: number, right: number, bottom: number, left: number];

export type Look = {
  display: string;
  position: 'static' | 'relative' | 'absolute' | 'fixed';
  borderBox: boolean;
  width: Length | 'auto' | 'max-content';
  height: Length | 'auto';
  minWidth: Length;
  minHeight: Length;
  padding: Sides;
  border: Sides;
  margin: (number | 'auto')[];
  inset: (Length | 'auto')[];
  fontStyle: string;
  fontWeight: string;
  fontSize: number;
  fontFamily: string;
  /** How text is cased before it is shaped (see text-case.ts): none or uppercase. */
  textTransform: string;
  /** Normal, or small-caps, drawn as the browser synthesizes them (see text-case.ts). */
  fontVariantCaps: string;
  /** Pixels, or 'normal', from the font. */
  lineHeight: number | 'normal';
  whiteSpace: string;
  verticalAlign: string;
  flexDirection: string;
  flexShrink: number;
  alignItems: string;
  alignSelf: string;
  justifyItems: string;
  justifySelf: string;
  justifyContent: string;
  rowGap: number;
  columnGap: number;
  gridAutoFlow: string;
  gridAutoColumns: string;
  gridAutoRows: string;
  /** Explicit tracks, in pixels, as grid-template-columns: 40px 32px gives them; none, implicit. */
  gridTemplateColumns: number[];
  gridTemplateRows: number[];
  /**
   * Whether a grid takes its parent grid's tracks along an axis, as grid-template-columns: subgrid
   * gives (see subgrid in layout.ts).
   */
  subgridColumns: boolean;
  subgridRows: boolean;
  /** The line a grid item starts at, from 1, as grid-row-start: 2 places it; none, auto-placed. */
  gridRowStart?: number;
  gridColumnStart?: number;
  /** How many tracks a grid item covers from its start line, as grid-row-end: span 2 gives 2. */
  gridRowSpan?: number;
  gridColumnSpan?: number;
  tabSize: number;
};

/** Inherited properties, as computed: a line height given as a number stays one. */
type Inherited = {
  fontStyle: string;
  fontWeight: string;
  fontSize: number;
  fontFamily: string;
  textTransform: string;
  fontVariantCaps: string;
  lineHeight: { number: number } | { px: number } | 'normal';
  whiteSpace: string;
  tabSize: number;
  /** Custom properties, by name, as written: they pass down, and var() reads them where used. */
  custom: Readonly<Record<string, string>>;
  /** The text's colour, as written, its var() references replaced. */
  color: string;
};

const rootFontSize = 16;

const initial: Inherited = {
  fontStyle: 'normal',
  fontWeight: '400',
  fontSize: rootFontSize,
  fontFamily: 'sans-serif',
  textTransform: 'none',
  fontVariantCaps: 'normal',
  lineHeight: 'normal',
  whiteSpace: 'normal',
  tabSize: 8,
  custom: {},
  color: '#000000'
};

/** A value with its var() references replaced by the custom properties they name, or fallbacks. */
function substituted(value: string, custom: Readonly<Record<string, string>>): string {
  if (!value.includes('var(')) return value;
  return value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/gu,
    (whole, name: string, fallback?: string) => {
      const found = custom[name] ?? fallback;
      if (found === undefined) throw new Error(`Layout model: ${name} is not set (${whole})`);
      return substituted(found.trim(), custom);
    }
  );
}

/** The browser's own display of each element a view draws. */
const displays: Record<string, string> = {
  div: 'block',
  p: 'block',
  span: 'inline',
  svg: 'inline'
};

const sides = (values: string[]): string[] => {
  const [top, right = top, bottom = top, left = right] = values;
  return [top, right, bottom, left];
};

/** A shorthand's longhands, or the declaration itself. */
function longhands(property: string, value: string): [string, string][] {
  const words = value.split(/\s+(?![^(]*\))/u);
  const box = (prefix: string, suffix = '') =>
    sides(words).map((each, index): [string, string] => [
      `${prefix}-${['top', 'right', 'bottom', 'left'][index]}${suffix}`,
      each
    ]);
  switch (property) {
    case 'padding':
    case 'margin':
      return box(property);
    case 'inset':
      return sides(words).map((each, index) => [['top', 'right', 'bottom', 'left'][index], each]);
    case 'border-width':
      return box('border', '-width');
    case 'border-style':
      return box('border', '-style');
    case 'gap':
      return [
        ['row-gap', words[0]],
        ['column-gap', words[1] ?? words[0]]
      ];
    case 'place-items':
      return [
        ['align-items', words[0]],
        ['justify-items', words[1] ?? words[0]]
      ];
    case 'place-self':
      return [
        ['align-self', words[0]],
        ['justify-self', words[1] ?? words[0]]
      ];
    case 'flex':
      return [['flex-shrink', value === 'none' ? '0' : (words[1] ?? '1')]];
    // Text runs left to right, top to bottom.
    case 'margin-inline-start':
    case 'padding-inline-start':
      return [[property.replace('inline-start', 'left'), value]];
    case 'margin-inline-end':
    case 'padding-inline-end':
      return [[property.replace('inline-end', 'right'), value]];
    case 'margin-block-start':
    case 'padding-block-start':
      return [[property.replace('block-start', 'top'), value]];
    case 'margin-block-end':
    case 'padding-block-end':
      return [[property.replace('block-end', 'bottom'), value]];
    case 'margin-inline':
    case 'padding-inline': {
      const side = property.split('-')[0];
      return [
        [`${side}-left`, words[0]],
        [`${side}-right`, words[1] ?? words[0]]
      ];
    }
    case 'border':
    case 'font':
    case 'grid-template':
    case 'grid':
      throw new Error(`Layout model: the ${property} shorthand is not modelled`);
    default:
      return [[property, value]];
  }
}

/** Properties that lay nothing out, which the model leaves alone. */
const unlaid =
  /^(color|background(-color|-image)?|box-shadow|text-decoration(-\w+)?|border-(top-|right-|bottom-|left-)?color|border(-\w+)?-radius|opacity|visibility|outline(-\w+)?|cursor|pointer-events|user-select|-webkit-user-select|touch-action|z-index|transform-origin|fill|stroke(-\w+)?|transition.*|animation.*|--.*|overflow(-[xy])?)$/u;

type Units = { em: number; percent?: never };

/** A length expression's value: numbers with px, em or rem, %, and calc(), min(), max(). */
function evaluate(text: string, units: Units): Length {
  let at = 0;
  const source = text.trim();
  const space = () => {
    while (source[at] === ' ') at++;
  };
  const add = (a: Length, b: Length, sign: number): Length => ({
    px: a.px + sign * b.px,
    percent: a.percent + sign * b.percent
  });
  const scale = (a: Length, by: number): Length => ({ px: a.px * by, percent: a.percent * by });
  const primary = (): Length => {
    space();
    const call = /^(calc|max|min|clamp)\(/u.exec(source.slice(at));
    if (call) {
      at += call[0].length;
      const args: Length[] = [];
      for (;;) {
        args.push(sum());
        space();
        if (source[at] === ',') at++;
        else break;
      }
      if (source[at++] !== ')') throw new Error(`Layout model: cannot read "${text}"`);
      if (call[1] === 'calc') return args[0];
      if (args.some((arg) => arg.percent))
        throw new Error(`Layout model: ${call[1]}() of a percentage is not modelled ("${text}")`);
      const values = args.map((arg) => arg.px);
      const px =
        call[1] === 'max'
          ? Math.max(...values)
          : call[1] === 'min'
            ? Math.min(...values)
            : Math.min(Math.max(values[0], values[1]), values[2]);
      return { px, percent: 0 };
    }
    if (source[at] === '(') {
      at++;
      const inner = sum();
      space();
      at++;
      return inner;
    }
    const number = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?(px|rem|em|%)?/iu.exec(source.slice(at));
    if (!number) throw new Error(`Layout model: cannot read "${text}"`);
    at += number[0].length;
    const value = parseFloat(number[0]);
    switch (number[3]?.toLowerCase()) {
      case 'px':
        return { px: value, percent: 0 };
      case 'em':
        return { px: value * units.em, percent: 0 };
      case 'rem':
        return { px: value * rootFontSize, percent: 0 };
      case '%':
        return { px: 0, percent: value };
      default:
        // A bare number is a length only as 0, or a factor in calc().
        return { px: value, percent: 0 };
    }
  };
  const product = (): Length => {
    let value = primary();
    for (;;) {
      space();
      const operator = source[at];
      if (operator !== '*' && operator !== '/') return value;
      at++;
      const by = primary();
      value = operator === '*' ? scale(value, by.px) : scale(value, 1 / by.px);
    }
  };
  const sum = (): Length => {
    let value = product();
    for (;;) {
      space();
      const operator = source[at];
      if ((operator !== '+' && operator !== '-') || source[at + 1] !== ' ') return value;
      at++;
      value = add(value, product(), operator === '+' ? 1 : -1);
    }
  };
  const result = sum();
  space();
  if (at !== source.length) throw new Error(`Layout model: cannot read "${text}"`);
  return result;
}

const px = (text: string, em: number): number => {
  const { px: value, percent } = evaluate(text, { em });
  if (percent) throw new Error(`Layout model: a percentage is not modelled here ("${text}")`);
  return value;
};

const borderKeywords: Record<string, number> = { thin: 1, medium: 3, thick: 5 };

/**
 * Border widths are snapped to device pixels, as the browser does: a width under one device pixel
 * draws one, and others round down to whole ones.
 */
export function snappedBorder(width: number, devicePixelRatio: number): number {
  const device = width * devicePixelRatio;
  if (device > 0 && device < 1) return 1 / devicePixelRatio;
  return Math.floor(device) / devicePixelRatio;
}

/** Inline-level displays become block-level ones in a flex or grid container, and out of flow. */
function blockified(display: string): string {
  switch (display) {
    case 'inline':
    case 'inline-block':
      return 'block';
    case 'inline-flex':
      return 'flex';
    case 'inline-grid':
      return 'grid';
    default:
      return display;
  }
}

/**
 * What an element paints, which lays nothing out, for drawing it again from the model (see
 * sceneOf in reserve.ts): CSS colours as written, var() references replaced and currentColor the
 * text's colour.
 */
export type Paint = {
  color: string;
  background?: string;
  /** The top border's colour and style, which the page's scene reads for the whole border. */
  borderColor: string;
  borderStyle: string;
  /** The top left corner's radius, in pixels. */
  radius: number;
  opacity: number;
  outline?: { width: number; style: string; color: string };
};

export type Styled = { look: Look; inherited: Inherited; paint: Paint };

/** A value with its var() references replaced, or undefined where one names nothing. */
export function substitutedOrNone(
  value: string,
  custom: Readonly<Record<string, string>>
): string | undefined {
  try {
    return substituted(value, custom).trim();
  } catch {
    return undefined;
  }
}

function paintOf(
  applying: ReadonlyMap<string, string>,
  custom: Readonly<Record<string, string>>,
  color: string,
  fontSize: number
): Paint {
  const get = (property: string) => {
    const written = applying.get(property);
    const value = written === undefined ? undefined : substitutedOrNone(written, custom);
    return value !== undefined && /^currentcolor$/iu.test(value) ? color : value;
  };
  const length = (text: string | undefined) => {
    try {
      return text === undefined ? 0 : px(text, fontSize);
    } catch {
      return 0;
    }
  };
  const words = (text: string | undefined) => text?.split(/\s+(?![^(]*\))/u) ?? [];
  // background as the library writes it, a colour alone; border-color and border-radius, their
  // first value, the top and the top left.
  const background =
    get('background-color') ?? words(get('background')).find((word) => !/^url\(/u.test(word));
  const outline = words(get('outline'));
  const outlineStyle =
    get('outline-style') ??
    outline.find((word) => /^(none|solid|dashed|dotted|double)$/u.test(word)) ??
    'none';
  const outlineWidth = get('outline-width') ?? outline.find((word) => /^[\d.]/u.test(word));
  const outlineColor =
    get('outline-color') ??
    outline.find((word) => word !== outlineStyle && word !== outlineWidth) ??
    color;
  return {
    color,
    ...(background ? { background } : {}),
    borderColor: get('border-top-color') ?? words(get('border-color'))[0] ?? color,
    borderStyle: get('border-top-style') ?? words(get('border-style'))[0] ?? 'none',
    radius: length(get('border-top-left-radius') ?? words(get('border-radius'))[0]),
    opacity: Number(get('opacity') ?? 1),
    ...(outlineStyle === 'none'
      ? {}
      : {
          outline: {
            width: length(outlineWidth ?? 'medium'),
            style: outlineStyle,
            color: outlineColor
          }
        })
  };
}

/** The look of an element, from the rules, its parent's look and its ancestors (nearest last). */
export function lookOf(
  element: ModelElement,
  ancestors: readonly ModelElement[],
  parent: Styled | undefined,
  rules: readonly Rule[],
  devicePixelRatio: number,
  /** Every border width as written, before snapping, for laying out at another ratio. */
  borders?: Set<number>
): Styled {
  const from = parent?.inherited ?? initial;
  const applying = cascade(rules, element, ancestors);
  let custom = from.custom;
  for (const [property, value] of applying)
    if (property.startsWith('--')) custom = { ...custom, [property]: value };
  const declared = new Map<string, string>();
  for (const [property, value] of applying)
    if (!property.startsWith('--'))
      for (const [longhand, each] of longhands(property, value))
        if (!unlaid.test(longhand)) declared.set(longhand, substituted(each, custom));
  const get = (property: string) => {
    const value = declared.get(property);
    return value === 'inherit' || value === 'unset' ? undefined : value;
  };
  const parentSize = from.fontSize;
  const fontSizeText = get('font-size');
  const fontSize = fontSizeText === undefined ? parentSize : px(fontSizeText, parentSize);
  const lineHeightText = get('line-height');
  const lineHeight: Inherited['lineHeight'] =
    lineHeightText === undefined
      ? from.lineHeight
      : lineHeightText === 'normal'
        ? 'normal'
        : /^[\d.]+$/u.test(lineHeightText)
          ? { number: parseFloat(lineHeightText) }
          : { px: px(lineHeightText, fontSize) };
  const weightText = get('font-weight');
  const colorText = applying.get('color');
  const colorValue =
    colorText === undefined || colorText === 'inherit'
      ? undefined
      : substitutedOrNone(colorText, custom);
  const color =
    colorValue === undefined || /^currentcolor$/iu.test(colorValue) ? from.color : colorValue;
  const inherited: Inherited = {
    fontStyle: get('font-style') ?? from.fontStyle,
    fontWeight:
      weightText === undefined
        ? from.fontWeight
        : weightText === 'normal'
          ? '400'
          : weightText === 'bold'
            ? '700'
            : weightText,
    fontSize,
    fontFamily: get('font-family') ?? from.fontFamily,
    textTransform: get('text-transform') ?? from.textTransform,
    fontVariantCaps: get('font-variant-caps') ?? from.fontVariantCaps,
    lineHeight,
    whiteSpace: get('white-space') ?? from.whiteSpace,
    tabSize: get('tab-size') === undefined ? from.tabSize : parseFloat(get('tab-size') as string),
    custom,
    color
  };
  const length = (property: string, fallback = '0px'): Length =>
    evaluate(get(property) ?? fallback, { em: fontSize });
  const lengthOrAuto = (property: string): Length | 'auto' => {
    const value = get(property);
    return value === undefined || value === 'auto' ? 'auto' : evaluate(value, { em: fontSize });
  };
  // Tracks given in pixels, as a solved grid has them; any other track sizing is not modelled.
  const tracksOf = (property: string): number[] => {
    const value = get(property);
    if (value === undefined || value === 'none' || value === 'subgrid') return [];
    return value
      .trim()
      .split(/\s+/u)
      .map((track) => px(track, fontSize));
  };
  const lineOf = (key: 'gridRowStart' | 'gridColumnStart', property: string) => {
    const value = get(property);
    if (value === undefined || value === 'auto') return {};
    if (!/^\d+$/u.test(value))
      throw new Error(`Layout model: ${property}: ${value} is not modelled`);
    return { [key]: Number(value) };
  };
  const spanOf = (key: 'gridRowSpan' | 'gridColumnSpan', property: string) => {
    const value = get(property);
    if (value === undefined || value === 'auto') return {};
    const [, count] = /^span (\d+)$/u.exec(value) ?? [];
    if (!count) throw new Error(`Layout model: ${property}: ${value} is not modelled`);
    return { [key]: Number(count) };
  };
  const position = (get('position') ?? 'static') as Look['position'];
  let display =
    'hidden' in element.attributes ? 'none' : (get('display') ?? displays[element.tag] ?? 'inline');
  const parentDisplay = parent?.look.display ?? 'block';
  if (position === 'absolute' || position === 'fixed' || /(^|-)(flex|grid)$/u.test(parentDisplay))
    display = blockified(display);
  const border = (['top', 'right', 'bottom', 'left'] as const).map((side) => {
    const style = get(`border-${side}-style`) ?? 'none';
    if (style === 'none' || style === 'hidden') return 0;
    const width = get(`border-${side}-width`) ?? 'medium';
    const written = width in borderKeywords ? borderKeywords[width] : px(width, fontSize);
    borders?.add(written);
    return snappedBorder(written, devicePixelRatio);
  }) as Sides;
  const widthText = get('width');
  const look: Look = {
    display,
    position,
    borderBox: get('box-sizing') === 'border-box',
    width:
      widthText === undefined || widthText === 'auto'
        ? 'auto'
        : widthText === 'max-content'
          ? 'max-content'
          : evaluate(widthText, { em: fontSize }),
    height: lengthOrAuto('height'),
    minWidth: get('min-width') === 'auto' ? { px: 0, percent: 0 } : length('min-width'),
    minHeight: get('min-height') === 'auto' ? { px: 0, percent: 0 } : length('min-height'),
    padding: (['top', 'right', 'bottom', 'left'] as const).map((side) =>
      px(get(`padding-${side}`) ?? '0px', fontSize)
    ) as Sides,
    border,
    margin: (['top', 'right', 'bottom', 'left'] as const).map((side) => {
      const value = get(`margin-${side}`) ?? '0px';
      return value === 'auto' ? 'auto' : px(value, fontSize);
    }),
    inset: (['top', 'right', 'bottom', 'left'] as const).map(lengthOrAuto),
    fontStyle: inherited.fontStyle,
    fontWeight: inherited.fontWeight,
    fontSize,
    fontFamily: inherited.fontFamily,
    textTransform: inherited.textTransform,
    fontVariantCaps: inherited.fontVariantCaps,
    lineHeight:
      lineHeight === 'normal'
        ? 'normal'
        : 'number' in lineHeight
          ? lineHeight.number * fontSize
          : lineHeight.px,
    whiteSpace: inherited.whiteSpace,
    verticalAlign: get('vertical-align') ?? 'baseline',
    flexDirection: get('flex-direction') ?? 'row',
    flexShrink: parseFloat(get('flex-shrink') ?? '1'),
    alignItems: get('align-items') ?? 'normal',
    alignSelf: get('align-self') ?? 'auto',
    justifyItems: get('justify-items') ?? 'normal',
    justifySelf: get('justify-self') ?? 'auto',
    justifyContent: get('justify-content') ?? 'normal',
    rowGap: get('row-gap') === 'normal' ? 0 : px(get('row-gap') ?? '0px', fontSize),
    columnGap: get('column-gap') === 'normal' ? 0 : px(get('column-gap') ?? '0px', fontSize),
    gridAutoFlow: get('grid-auto-flow') ?? 'row',
    gridAutoColumns: get('grid-auto-columns') ?? 'auto',
    gridAutoRows: get('grid-auto-rows') ?? 'auto',
    gridTemplateColumns: tracksOf('grid-template-columns'),
    gridTemplateRows: tracksOf('grid-template-rows'),
    subgridColumns: get('grid-template-columns') === 'subgrid',
    subgridRows: get('grid-template-rows') === 'subgrid',
    ...lineOf('gridRowStart', 'grid-row-start'),
    ...lineOf('gridColumnStart', 'grid-column-start'),
    ...spanOf('gridRowSpan', 'grid-row-end'),
    ...spanOf('gridColumnSpan', 'grid-column-end'),
    tabSize: inherited.tabSize
  };
  for (const property of ['float', 'flex-wrap'])
    if (get(property) !== undefined && !['none', 'nowrap'].includes(get(property) as string))
      throw new Error(
        `Layout model: ${property} is not modelled (${classesOf(element).join('.')})`
      );
  return { look, inherited, paint: paintOf(applying, custom, color, fontSize) };
}

/** An element's look given its ancestors, the nearest last, and its parent's look. */
export type Styler = (
  element: ModelElement,
  ancestors: readonly ModelElement[],
  parent: Styled | undefined
) => Styled;

/**
 * Looks worked out once for elements alike. An element's look follows from its tag, the attributes
 * the rules read, its inline style and its parent's look, so elements alike under parents alike,
 * in one step's markup or in many, share one.
 */
export function styler(
  rules: readonly Rule[],
  devicePixelRatio: number,
  borders?: Set<number>
): Styler {
  const read = [...attributesRead(rules), 'class', 'hidden'];
  const alike = new Map<string, Styled>();
  const keys = new WeakMap<Styled, number>();
  return (element, ancestors, parent) => {
    let key = `${parent ? keys.get(parent) : -1}\u0001${element.tag}`;
    for (const name of read) key += `\u0001${element.attributes[name] ?? '\u0002'}`;
    for (const property in element.style) key += `\u0001${property}:${element.style[property]}`;
    let styled = alike.get(key);
    if (!styled) {
      styled = lookOf(element, ancestors, parent, rules, devicePixelRatio, borders);
      alike.set(key, styled);
      keys.set(styled, alike.size);
    }
    return styled;
  };
}
