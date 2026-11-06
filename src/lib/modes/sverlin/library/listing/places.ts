/**
 * A place's references on the page, its listing tokens and the nodes it draws in the picture, as
 * the listing's tokens name them (see listing/places.server.ts): each is marked data-sv-place with
 * the places it refers to, lights in its place's colour at a step touching the place, and hovering
 * one outlines every reference to the same place. No light takes room.
 */

import { contrast, cssColour } from '../colour';
import { colourCss, shades } from '../node/design';
import type { ShownListing } from '../type-context';

/**
 * The least contrast a place's line keeps with the page: 3:1, WCAG 2.2's for graphics a reader
 * must see (SC 1.4.11 Non-text Contrast,
 * https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
 */
export const lineContrast = 3;

/**
 * A place's line as CSS, which outlines its references on hover: its design colour where that
 * keeps 3:1 with the page's background, else the nearest shade of its hue that does, darker on a
 * light page and lighter on a dark one, else black or white.
 */
export function lineColour(paint: string, background: string): string | undefined {
  if (colourCss(paint) === undefined) return undefined;
  const page = cssColour(background)[3] === 0 ? '#ffffff' : background;
  const darker = contrast('#000000', page) >= contrast('#ffffff', page);
  const [, hue, shade] = /^([a-z]+)-(\d+)$/u.exec(paint) ?? [];
  const at = shades.indexOf(Number(shade) as (typeof shades)[number]);
  const along = at < 0 ? [] : darker ? shades.slice(at) : shades.slice(0, at + 1).reverse();
  return [...(at < 0 ? [paint] : along.map((each) => `${hue}-${each}`)), darker ? 'black' : 'white']
    .map((each) => colourCss(each) as string)
    .find((css) => contrast(css, page) >= lineContrast);
}

/**
 * The places among those given that a token names, where the variant lights places, each by its
 * full name, so a text's :@front is the listing's :@insert.front.
 */
export function namedPlaces(
  listing: ShownListing | undefined,
  places: readonly (string | undefined)[]
): string[] {
  const paints = listing?.places?.paints;
  if (!paints) return [];
  const aliases = listing?.places?.aliases ?? {};
  return [
    ...new Set(
      places
        .map((place) => (place && aliases[place]) || place)
        .filter((place): place is string => !!place && place in paints)
    )
  ];
}

/** The colour a reference to these places lights in at the step: the first touched place's. */
export function lightOf(
  listing: ShownListing | undefined,
  places: readonly string[]
): string | undefined {
  const touched = places.find((place) => listing?.touched?.includes(place));
  return touched === undefined ? undefined : colourCss(listing?.places?.paints[touched]);
}

/**
 * A picture node's light: fill a 3px band round it, underline a line under it, outline a ring
 * off it; each a shadow or an outline, which take no room.
 */
export function nodeLight(
  look: string | undefined,
  colour: string
): { shadow?: string; outline?: string; outlineOffset?: string } {
  return look === 'underline'
    ? { shadow: `0 4px 0 -1px ${colour}` }
    : look === 'outline'
      ? { outline: `2px solid ${colour}`, outlineOffset: '3px' }
      : { shadow: `0 0 0 3px ${colour}` };
}

/** A token's light: its background, an underline, or an outline drawn inside it. */
export function tokenLightCss(look: string | undefined, colour: string): string {
  return look === 'underline'
    ? `text-decoration:underline 2px ${colour};text-underline-offset:3px`
    : look === 'outline'
      ? `outline:1.5px solid ${colour};outline-offset:-1.5px;border-radius:2px`
      : `background-color:${colour};border-radius:2px`;
}

/**
 * Outline every reference to the places of the reference under the pointer, dashed in its
 * place's colour; none where it is over none.
 */
export function hoverPlaces(
  root: ParentNode,
  target: EventTarget | null,
  paints: Readonly<Record<string, string>> | undefined
): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-sv-hovered]')) {
    element.removeAttribute('data-sv-hovered');
    element.style.removeProperty('--sv-hover');
  }
  const over = paints && target instanceof Element ? target.closest('[data-sv-place]') : undefined;
  const places = over?.getAttribute('data-sv-place')?.split(' ') ?? [];
  if (!paints || !places.length) return;
  for (const element of root.querySelectorAll<HTMLElement>('[data-sv-place]')) {
    const shared = element
      .getAttribute('data-sv-place')
      ?.split(' ')
      .find((place) => places.includes(place));
    if (!shared) continue;
    element.setAttribute('data-sv-hovered', '');
    element.style.setProperty('--sv-hover', colourCss(paints[shared]) ?? 'currentColor');
  }
}
