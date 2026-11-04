/**
 * Props bound to a view's value, as `<Node stroke={this.visited} />`: the prop's options are the
 * range, the values the expression can take the domain, and the design says which option each
 * value takes. An unordered domain (booleans, words not of an enumeration) has a variable per
 * value, as `Card.stroke@true`; an ordered one (numbers, an enumeration in its declared order)
 * keeps its order, taking consecutive options from
 * `@from`, or for a colour the shades of `@hue`, lightest first, running `@order` up or down.
 */

import { hues, propOptions, shades, type DesignProp } from './design';

/** A value a bound prop maps from. */
export type BoundValue = string | number | boolean;

/** The values a bound prop's expression can take, in order, and whether that order is meaningful. */
export type BoundDomain = { values: readonly BoundValue[]; ordered: boolean };

/** Props a view may bind: every look of a node with options of its own, but whether it is shown. */
export const bindableProps: ReadonlySet<string> = new Set<DesignProp>([
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
  'shadow',
  'glow',
  'fillStyle',
  'decoration',
  'case',
  'gap',
  'align',
  'justify',
  'icon'
]);

/**
 * Props a view may bind but that no kind has unbound, each value of the binding taking its own
 * option, whatever order its type gives: an icon is drawn only for a value it stands for.
 */
export const valueOnlyProps: ReadonlySet<string> = new Set(['icon']);

/** Props whose options run in order, which an ordered domain maps onto in order. */
export const orderedProps: ReadonlySet<string> = new Set([
  'textSize',
  'strokeWidth',
  'opacity',
  'padding',
  'radius',
  'minSize',
  'weight',
  'gap'
]);

/** Colour props: hues for an unordered domain, one hue's shades for an ordered one. */
export const colourProps: ReadonlySet<string> = new Set(['fill', 'stroke', 'color']);

/** The variable a value of an unordered domain takes its option from, as Card.stroke@true. */
export const valueKey = (kind: string, prop: string, value: BoundValue): string =>
  `${kind}.${prop}@${String(value)}`;

/** The variables of an ordered domain: the first option, or a colour's hue, and which way it runs. */
export const orderKeys = (
  kind: string,
  prop: string
): { from: string; hue: string; order: string } => ({
  from: `${kind}.${prop}@from`,
  hue: `${kind}.${prop}@hue`,
  order: `${kind}.${prop}@order`
});

export const orders = ['up', 'down'] as const;

/** A prop's options, as a bound prop maps onto them. */
export const boundOptions = (prop: string): readonly BoundValue[] =>
  propOptions[prop as DesignProp] ?? [];

/**
 * How many values a prop can tell apart: its options, less none for a colour, as no colour is no
 * value's colour.
 */
export const boundCapacity = (prop: string, ordered: boolean): number =>
  ordered && colourProps.has(prop)
    ? shades.length
    : boundOptions(prop).filter((option) => !(colourProps.has(prop) && option === 'none')).length;

/** The shades `count` ordered values take, spread from light to dark, past the palest and darkest where they fit. */
export function shadesFor(count: number): number[] {
  if (count <= 1) return [shades[5]];
  const [first, last] =
    count <= shades.length - 2 ? [1, shades.length - 2] : [0, shades.length - 1];
  return Array.from(
    { length: count },
    (_, index) => shades[Math.round(first + (index * (last - first)) / (count - 1))]
  );
}

/** The hues an ordered colour domain can run through: every hue. */
export const boundHues: readonly string[] = hues;

/**
 * A bound prop's option for a value, by the design's variables of its kind; undefined where the
 * design gives none, so the kind's own look holds.
 */
export function boundLook(
  design: Readonly<Record<string, unknown>>,
  kind: string,
  prop: string,
  value: unknown,
  domain: BoundDomain
): unknown {
  if (!domain.ordered) return design[valueKey(kind, prop, value as BoundValue)];
  const at = domain.values.indexOf(value as BoundValue);
  if (at < 0) return undefined;
  const keys = orderKeys(kind, prop);
  const step = design[keys.order] === 'down' ? domain.values.length - 1 - at : at;
  if (colourProps.has(prop)) {
    const hue = design[keys.hue];
    return typeof hue === 'string' ? `${hue}-${shadesFor(domain.values.length)[step]}` : undefined;
  }
  const options = boundOptions(prop);
  const from = options.indexOf(design[keys.from] as BoundValue);
  return from < 0 ? undefined : options[from + step];
}

/**
 * Lengths a view binds, as `<Node width={this} />`: the value times a unit of the node's kind, from
 * zero, so the node's length is its value. Any number of values fits, so these are the one exception
 * to a domain fitting its prop's options.
 */
export const lengthProps: ReadonlySet<string> = new Set(['width', 'height']);

/** The pixels per unit a length's kind may take. */
export const lengthUnits: readonly number[] = [1, 2, 3, 4, 6, 8, 12, 16, 24];

/** The variable giving a length's pixels per unit, as Bar.width@unit. */
export const unitKey = (kind: string, prop: string): string => `${kind}.${prop}@unit`;

/** A bound length in pixels: the value times its kind's unit, or undefined where either is missing. */
export function boundLength(
  design: Readonly<Record<string, unknown>>,
  kind: string,
  prop: string,
  value: unknown
): number | undefined {
  const unit = design[unitKey(kind, prop)];
  return typeof value === 'number' && typeof unit === 'number'
    ? Math.max(0, value) * unit
    : undefined;
}

/**
 * Where a box smaller than its slot sits in it, along one axis: its start (top or left), centre,
 * or end.
 */
export const anchors = ['start', 'center', 'end'] as const;

/** The variable placing a kind's boxes along an axis, as Bar.yAnchor. */
export const anchorKey = (kind: string, axis: 'x' | 'y'): string => `${kind}.${axis}Anchor`;

/**
 * The anchor a binding starts its kind at: a box sized by its height stands on its slot's bottom,
 * one sized by its width starts at its left.
 */
export const boundAnchor = (prop: string): { axis: 'x' | 'y'; anchor: (typeof anchors)[number] } =>
  prop === 'height' ? { axis: 'y', anchor: 'end' } : { axis: 'x', anchor: 'start' };

/**
 * A box's anchor along an axis, its kind's variable as flexbox places it; before the design gives
 * one, where a binding starts it, or centred.
 */
export function slotAnchor(
  chosen: unknown,
  axis: 'x' | 'y',
  bound: { width?: unknown; height?: unknown } | undefined
): 'flex-start' | 'center' | 'flex-end' {
  const size = axis === 'x' ? 'width' : 'height';
  const placed = anchors.includes(chosen as (typeof anchors)[number])
    ? (chosen as (typeof anchors)[number])
    : bound?.[size]
      ? boundAnchor(size).anchor
      : 'center';
  return placed === 'center' ? 'center' : placed === 'end' ? 'flex-end' : 'flex-start';
}
