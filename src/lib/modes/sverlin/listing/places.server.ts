/**
 * A listing's tokens as references to the places the view renders (see Token): which places each
 * step touches, and the colour each place lights in, from the variant. A place is the name a render
 * at the root or in a part is written with, as @mid or @pair.left; its references are its tokens,
 * the element a pointer at it points at, or the node a render of a value there draws.
 */

import type { PlaceToken } from './listing';
import type { Lit } from './light.server';
import type { MappingProblem, Token } from './mapped.server';

/** What the root renders at a place: the type rendered, and whether it is drawn as a pointer. */
export type RenderedPlace = { type: string; pointer: boolean };

/** The tokens naming a place the root renders nowhere, each refused with the places it does. */
export function tokenProblems(
  tokens: readonly Token[],
  rendered: readonly string[]
): MappingProblem[] {
  const known = new Set(rendered);
  const listed = rendered.length
    ? `the places it renders are ${[...known].sort().join(', ')}`
    : 'it draws nothing at a place, as {mid} at :mid';
  return tokens
    .filter(({ place }) => !known.has(place))
    .map(({ place, at }) => ({
      message: `The token ${place}[…] names ${place}, which the view renders nowhere at its root or in a part: a token names a place a render is written with, as :mid[…] for {mid}, and ${listed}.`,
      block: 'listing' as const,
      at
    }));
}

/**
 * The places each step touches: those with a token overlapping the code the step itself ran, not
 * the code it keeps lit from earlier.
 */
export function touchedPlaces(tokens: readonly PlaceToken[], lit: readonly Lit[]): string[][] {
  return lit.map(({ current }) => [
    ...new Set(
      tokens
        .filter(({ start, end }) => current.some(([from, to]) => from < end && start < to))
        .map(({ place }) => place)
    )
  ]);
}

/** Colours that would not show as a place's light on the page's white. */
const unseen = new Set(['none', 'white', undefined]);

/**
 * The colour a place lights in: the fill of its mark, the <Pointed> of the pointer view drawn there
 * (Mark.Pointed:i.fill) or the view a value there is drawn with (IntCell:key.fill), or its stroke
 * where the fill is none or white, else the listing's lit fill. Its line, which outlines its
 * references on hover, takes the stroke first, as a pale fill would not show as a line (the page
 * then darkens it as far as it needs, see lineColour in ../library/listing/places.ts).
 */
export function placePaint(
  place: string,
  rendered: RenderedPlace | undefined,
  values: Readonly<Record<string, unknown>>,
  part: 'light' | 'line' = 'light'
): string {
  const prefix = rendered?.pointer ? 'pointers' : 'views';
  const view =
    rendered &&
    (values[`${prefix}.${rendered.type}${place}`] ?? values[`${prefix}.${rendered.type}`]);
  const kind =
    typeof view === 'string' && view !== 'none'
      ? rendered?.pointer
        ? `${view}.Pointed`
        : view
      : undefined;
  const prop = (name: string) =>
    kind === undefined
      ? undefined
      : ((values[`${kind}${place}.${name}`] ?? values[`${kind}.${name}`]) as string | undefined);
  const seen = (part === 'line' ? ['stroke', 'fill'] : ['fill', 'stroke'])
    .map(prop)
    .find((paint) => !unseen.has(paint));
  if (seen) return seen;
  const lit = values['listing.lit.fill'] as string | undefined;
  return unseen.has(lit) ? 'amber-300' : (lit as string);
}

const lightLooks = {
  fill: 'a 3px band round it',
  underline: 'a line under it',
  outline: 'a ring off it'
} as const;

/**
 * What the place lights draw, for the assistant's drawing: at a step whose code touches a place,
 * the node drawing it lights in the place's colour, which no prop of the node's kind removes, so
 * the variable that does is named; a participant sees the light as part of the node.
 */
export function placeLightsText(
  places: { look: keyof typeof lightLooks; paints: Readonly<Record<string, string>> } | undefined
): string | undefined {
  const lit = Object.entries(places?.paints ?? {}).map(([place, paint]) => `${place} in ${paint}`);
  if (!places || !lit.length) return undefined;
  return `Place lights (listing.places ${places.look}): at a step whose code touches a place, the node drawing it shows ${lightLooks[places.look]}, as its tokens light: ${lit.join(', ')}; listing.places none removes them.`;
}
