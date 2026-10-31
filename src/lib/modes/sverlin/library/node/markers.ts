/**
 * What a <Link> tells the node drawing it, read from its hidden marker (see Link.svelte): how it
 * runs, its head, and its look; and its label, the element holding its children, which that node
 * measures and places on the link's middle.
 */

import { strokeStyleCss } from './design';
import { headSizes } from './heads';
import type { LineStyle } from './LinkLines.svelte';
import { closest, descendants, hasClass, type Reader } from './reader';
import { screenScale, unscaled } from './unscaled';

const routes = ['straight', 'curved', 'wire'] as const;

/** How a marker's link runs, its head, and its look. */
export function markerLook(attribute: (name: string) => string | undefined): {
  route?: (typeof routes)[number];
  head?: { shape: string; size: number };
  style: LineStyle;
} {
  const route = routes.find((each) => each === attribute('data-route'));
  const size = Number(attribute('data-head-size'));
  const head = attribute('data-head');
  return {
    ...(route ? { route } : {}),
    ...(head
      ? {
          head: {
            shape: head,
            size: Number.isFinite(size) && size > 0 ? size : headSizes[1]
          }
        }
      : {}),
    style: {
      strokeStyle: strokeStyleCss(attribute('data-stroke-style')),
      stroke: attribute('data-stroke'),
      strokeWidth: attribute('data-stroke-width'),
      opacity: attribute('data-opacity'),
      shown: attribute('data-shown') !== 'false'
    }
  };
}

/** What places labels: a free layout's host, and a row or column with links (see LinkOverlay). */
const placesLabels = <E>(read: Reader<E>, element: E) =>
  hasClass(read, element, 'placed') || read.attribute(element, 'data-sv-overlaid') !== undefined;

/** The labels drawn inside a host for its links, by link id: those it places, not a nested node's. */
export function labelsIn<E>(read: Reader<E>, host: E): Map<string, E> {
  const labels = new Map<string, E>();
  for (const label of descendants(read, host)) {
    const link = read.attribute(label, 'data-sv-link-label');
    if (link === undefined) continue;
    if (closest(read, read.parent(label), (at) => placesLabels(read, at)) === host)
      labels.set(link, label);
  }
  return labels;
}

/** A label and the point its middle goes to. */
export type PlacedLabel = { label: HTMLElement; middle: { x: number; y: number } };

/**
 * Put each label with its middle at a point given in the host's own units, wherever in the host it
 * sits: a label inside a child, as a node's next field's, is placed by its offset from that child.
 * Every label is measured before any moves, so the page is laid out once, not once per label.
 */
export function placeLabels(host: HTMLElement, placed: readonly PlacedLabel[]): void {
  if (!placed.length) return;
  const outer = host.getBoundingClientRect();
  const scale = screenScale(host);
  const corners = placed.map(({ label, middle }) => {
    const parent = (label.offsetParent as HTMLElement | null) ?? host;
    const inner = parent.getBoundingClientRect();
    const offset =
      parent === host
        ? { x: 0, y: 0 }
        : {
            x: unscaled(inner.left - outer.left, scale),
            y: unscaled(inner.top - outer.top, scale)
          };
    return {
      left: middle.x - offset.x - label.offsetWidth / 2,
      top: middle.y - offset.y - label.offsetHeight / 2
    };
  });
  placed.forEach(({ label }, index) => {
    label.style.left = `${corners[index].left}px`;
    label.style.top = `${corners[index].top}px`;
    label.dataset.svPlaced = '';
  });
}
