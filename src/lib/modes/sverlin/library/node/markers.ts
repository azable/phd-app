/**
 * What a <Link> tells the node drawing it, read from its hidden marker (see Link.svelte): how it
 * runs, its head, and its look; and its label, the element holding its children, which that node
 * measures and places on the link's middle.
 */

import { strokeStyleCss } from './design';
import { headSizes } from './heads';
import type { LineStyle } from './LinkLines.svelte';

const routes = ['straight', 'curved', 'wire'] as const;

/** How a marker's link runs, its head, and its look. */
export function markerLook(marker: HTMLElement): {
  route?: (typeof routes)[number];
  head?: { shape: string; size: number };
  style: LineStyle;
} {
  const { dataset } = marker;
  const route = routes.find((each) => each === dataset.route);
  const size = Number(dataset.headSize);
  return {
    ...(route ? { route } : {}),
    ...(dataset.head
      ? {
          head: {
            shape: dataset.head,
            size: Number.isFinite(size) && size > 0 ? size : headSizes[1]
          }
        }
      : {}),
    style: {
      strokeStyle: strokeStyleCss(dataset.strokeStyle),
      stroke: dataset.stroke,
      strokeWidth: dataset.strokeWidth,
      opacity: dataset.opacity,
      shown: dataset.shown !== 'false'
    }
  };
}

/** What places labels: a free layout's host, and a row or column with links (see LinkOverlay). */
const placers = '.placed, [data-sv-overlaid]';

/** The labels drawn inside a host for its links, by link id: those it places, not a nested node's. */
export function labelsIn(host: HTMLElement): Map<string, HTMLElement> {
  return new Map(
    [...host.querySelectorAll<HTMLElement>('[data-sv-link-label]')]
      .filter((label) => label.parentElement?.closest(placers) === host)
      .map((label) => [label.dataset.svLinkLabel ?? '', label])
  );
}

/**
 * Put a label with its middle at a point given in the host's own units, wherever in the host it
 * sits: a label inside a child, as a node's next field's, is placed by its offset from that child.
 */
export function placeLabel(
  host: HTMLElement,
  label: HTMLElement,
  middle: { x: number; y: number }
): void {
  const parent = (label.offsetParent as HTMLElement | null) ?? host;
  const outer = host.getBoundingClientRect();
  const inner = parent.getBoundingClientRect();
  const ratio = outer.width ? host.offsetWidth / outer.width : 1;
  const offset =
    parent === host
      ? { x: 0, y: 0 }
      : { x: (inner.left - outer.left) * ratio, y: (inner.top - outer.top) * ratio };
  label.style.left = `${middle.x - offset.x - label.offsetWidth / 2}px`;
  label.style.top = `${middle.y - offset.y - label.offsetHeight / 2}px`;
  label.dataset.svPlaced = '';
}
