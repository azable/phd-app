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
    : 'it draws nothing at a place, as {mid} at @mid';
  return tokens
    .filter(({ place }) => !known.has(place))
    .map(({ place, at }) => ({
      message: `The token $${place.slice(1)}[…] names ${place}, which the view renders nowhere at its root or in a part: a token names a place a render is written with, as $mid[…] for {mid}, and ${listed}.`,
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
 * (Mark.Pointed@i.fill) or the view a value there is drawn with (IntCell@key.fill), or its stroke
 * where the fill is none or white, else the listing's lit fill.
 */
export function placePaint(
  place: string,
  rendered: RenderedPlace | undefined,
  values: Readonly<Record<string, unknown>>
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
  const fill = prop('fill');
  if (!unseen.has(fill)) return fill as string;
  const stroke = prop('stroke');
  if (!unseen.has(stroke)) return stroke as string;
  const lit = values['listing.lit.fill'] as string | undefined;
  return unseen.has(lit) ? 'amber-300' : (lit as string);
}
