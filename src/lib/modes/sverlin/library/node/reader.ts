/**
 * Elements as the code laying out links and free layouts reads them: their attributes, their place
 * in the tree, and their boxes, whether they are mounted in the page or a step's markup laid out on
 * the layout model (see model/drawn.ts).
 */

import { screenScale, unscaledBox } from './unscaled';

export type Box = { x: number; y: number; width: number; height: number };

export type Reader<E> = {
  attribute(element: E, name: string): string | undefined;
  /** Its children that are boxes of the page, not drawings. */
  children(element: E): readonly E[];
  parent(element: E): E | undefined;
  /** Where one element's border box sits in another's, in layout pixels. */
  boxIn(inner: E, outer: E): Box;
  /** Its size in whole pixels, as offsetWidth and offsetHeight give it. */
  size(element: E): { width: number; height: number };
  fontSize(element: E): number;
};

export function* descendants<E>(read: Reader<E>, element: E): Generator<E> {
  for (const child of read.children(element)) {
    yield child;
    yield* descendants(read, child);
  }
}

/** The element itself or its nearest ancestor that passes a test. */
export function closest<E>(
  read: Reader<E>,
  from: E | undefined,
  test: (element: E) => boolean
): E | undefined {
  for (let at = from; at !== undefined; at = read.parent(at)) if (test(at)) return at;
  return undefined;
}

export const contains = <E>(read: Reader<E>, outer: E, inner: E): boolean =>
  closest(read, inner, (at) => at === outer) !== undefined;

export const hasClass = <E>(read: Reader<E>, element: E, name: string): boolean =>
  (read.attribute(element, 'class') ?? '').split(/\s+/u).includes(name);

/**
 * Mounted elements, their boxes read in layout pixels whatever the frame's scale (see unscaled.ts),
 * as at the scale `scaled` is drawn at.
 */
export function mountedReader(scaled: Element): Reader<HTMLElement> {
  let scale: number | undefined;
  const rects = new Map<Element, DOMRect>();
  const rectOf = (element: Element) => {
    let rect = rects.get(element);
    if (!rect) rects.set(element, (rect = element.getBoundingClientRect()));
    return rect;
  };
  return {
    attribute: (element, name) => element.getAttribute(name) ?? undefined,
    children: (element) =>
      [...element.children].filter((child): child is HTMLElement => child instanceof HTMLElement),
    parent: (element) => element.parentElement ?? undefined,
    boxIn: (inner, outer) => unscaledBox(inner, rectOf(outer), (scale ??= screenScale(scaled))),
    size: (element) => ({ width: element.offsetWidth, height: element.offsetHeight }),
    fontSize: (element) => parseFloat(getComputedStyle(element).fontSize)
  };
}
