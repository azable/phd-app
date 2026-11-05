/**
 * What a presentation draws, in a few words, for the assistant, which cannot see the picture: each
 * kind of node seen, by the shape its paint gives it and the size it is drawn at, and its links,
 * how many are loops on their own node, from the server's layout of one step (see record.ts).
 */

import { elementsUnder, hiddenHere, seenBox, type SeenBox } from './model/reserve';
import type { ModelElement } from './model/tree';

export type DrawnShape =
  | 'circle'
  | 'box'
  | 'unboxed text'
  | 'white circle with no outline, unseen on the white page'
  | 'white box with no outline, unseen on the white page';

export type DrawnSummary = {
  kinds: { kind: string; shape: DrawnShape; count: number; width?: number; height?: number }[];
  links: { drawn: number; loops: number };
};

/**
 * The longest description given, in characters: about 150 tokens, a few lines for each of the
 * handful of presentations a turn shows, beside a guide of some 27,000 tokens.
 */
export const drawingBudget = 600;

const painted = (value: string | undefined) =>
  value !== undefined && !['', 'none', 'transparent', 'rgba(0, 0, 0, 0)'].includes(value.trim());

function shapeOf(element: ModelElement, size?: { width: number; height: number }): DrawnShape {
  const { style } = element;
  const stroked = parseFloat(style['border-width'] ?? '') > 0 && style['border-style'] !== 'none';
  if (!stroked && !painted(style['background-color'])) return 'unboxed text';
  const radius = parseFloat(style['border-radius'] ?? '') || 0;
  const circle = size ? radius * 2 >= Math.min(size.width, size.height) - 1 : radius >= 999;
  // The page is white, so a white fill with no outline draws nothing that can be seen.
  if (!stroked && white(style['background-color']))
    return circle
      ? 'white circle with no outline, unseen on the white page'
      : 'white box with no outline, unseen on the white page';
  return circle ? 'circle' : 'box';
}

const white = (value: string | undefined) =>
  ['#fff', '#ffffff', 'white', 'rgb(255, 255, 255)', 'oklch(1 0 0)'].includes(
    (value ?? '').trim().toLowerCase()
  );

const median = (values: number[]) =>
  Math.round(values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0);

const ownText = (element: ModelElement) =>
  element.children.filter((child) => typeof child === 'string').join('');

/**
 * What a step's markup draws: each element showing a box or text, by the kind of the nearest node
 * (a value's text is its view's), as the page shows it; sizes from the elements laid out (seen),
 * which a free layout's nodes, arranged on their own, may lack.
 */
export function drawingOf(markup: ModelElement, seen: readonly SeenBox[]): DrawnSummary {
  const sizes = new Map(seen.map(({ element, width, height }) => [element, { width, height }]));
  const groups = new Map<
    string,
    { kind: string; shape: DrawnShape; count: number; sizes: { width: number; height: number }[] }
  >();
  // A node nested in one of its own kind and shape, as a view's cell inside its root, is one.
  const visit = (
    element: ModelElement,
    inheritedKind?: string,
    hiddenAbove = false,
    countedAbove?: string
  ) => {
    let counted = countedAbove;
    if (element.style.display === 'none') return;
    const hiddenAs = element.attributes['data-sv-hidden'] ?? element.style.visibility;
    // A free layout is hidden until the page arranges it, which it always does.
    const arranged = (element.attributes.class ?? '').split(/\s+/u).includes('sv-arranged');
    const hidden =
      (hiddenHere(element) && !arranged) ||
      (hiddenAbove && hiddenAs !== 'false' && hiddenAs !== 'visible');
    const kind = element.attributes['data-sv-kind'] ?? inheritedKind;
    if (
      !hidden &&
      kind &&
      element.attributes['data-sv-link'] === undefined &&
      seenBox(element, ownText(element))
    ) {
      const size = sizes.get(element);
      const shape = shapeOf(element, size);
      const key = `${kind}\n${shape}`;
      if (key !== countedAbove) {
        const group = groups.get(key) ?? { kind, shape, count: 0, sizes: [] };
        group.count += 1;
        if (size) group.sizes.push(size);
        groups.set(key, group);
      }
      counted = key;
    }
    for (const child of element.children)
      if (typeof child !== 'string') visit(child, kind, hidden, counted);
  };
  visit(markup);
  const links = [...elementsUnder(markup)].filter(
    ({ attributes }) =>
      attributes['data-sv-link'] !== undefined && attributes['data-shown'] !== 'false'
  );
  const toSelf = links.filter(
    ({ attributes }) =>
      attributes['data-from'] !== undefined && attributes['data-from'] === attributes['data-to']
  ).length;
  // The text inside a kind's box is that box's, not another unboxed part.
  const boxed = new Set(
    [...groups.values()].flatMap(({ kind, shape }) => (shape === 'unboxed text' ? [] : [kind]))
  );
  return {
    kinds: [...groups.values()]
      .filter(({ kind, shape }) => shape !== 'unboxed text' || !boxed.has(kind))
      .map(({ kind, shape, count, sizes }) => ({
        kind,
        shape,
        count,
        ...(sizes.length
          ? {
              width: median(sizes.map(({ width }) => width)),
              height: median(sizes.map(({ height }) => height))
            }
          : {})
      }))
      .toSorted((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    links: { drawn: links.length, loops: toSelf }
  };
}

/** The drawing in words, within the budget, the most common kinds first. */
export function drawingText(drawing: DrawnSummary): string {
  const { drawn, loops } = drawing.links;
  const linkText = drawn
    ? `links: ${drawn} drawn${loops ? `, ${loops} of them a loop on its own node` : ''}.`
    : '';
  const parts: string[] = [];
  let length = linkText.length;
  for (const [index, { kind, shape, count, width, height }] of drawing.kinds.entries()) {
    const part = `${kind}: ${count} ${shape}${width !== undefined ? `, about ${width}×${height} px` : ''}`;
    const rest = drawing.kinds.length - index;
    if (length + part.length + 2 > drawingBudget - 30) {
      parts.push(`and ${rest} more kind${rest === 1 ? '' : 's'}`);
      break;
    }
    parts.push(part);
    length += part.length + 2;
  }
  return [parts.join('; ') + (parts.length ? '.' : ''), linkText].filter(Boolean).join(' ');
}
