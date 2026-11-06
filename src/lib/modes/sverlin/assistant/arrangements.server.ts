/**
 * How Sverlin's assistant ranks the arrangements of a version's free layouts, and the helpers'
 * candidates (see view-helpers.server.ts): the shape it aims at, how near a layout is to it, and the
 * best arrangements told in a line each. The measurement itself is the engine's
 * ($lib/shared/readability.ts).
 */

import {
  layoutShape,
  smallestReadableText,
  type Arrangement,
  type Readability
} from '$lib/shared/readability';

const whole = (value: number) => Math.round(value).toLocaleString('en');

/** The shape layouts aim at: wide, as a slide or a laptop's stage, unless asked otherwise. */
const targetAspect = 16 / 9;

/**
 * How near a layout's content is to 16:9, from 1 there to 0 at a third or three times as wide: a
 * square scores about 0.5, a 9:16 column nothing, so tall layouts rank below wide ones.
 */
export function wideCloseness({ content }: Readability): number {
  const aspect = content.width / content.height;
  return Math.max(0, 1 - Math.abs(Math.log(aspect / targetAspect)) / Math.log(3));
}

/**
 * Arrangements best first: text readable on the typical stage before anything, then a shape near
 * 16:9 and a fuller frame with fewer crossings, each crossing costing a tenth of the frame; the
 * shown one first of equals.
 */
export function rankedArrangements(arrangements: readonly Arrangement[]): Arrangement[] {
  const score = ({ readability, crossings }: Arrangement) =>
    (readability.text >= smallestReadableText ? 2 : 0) +
    3 * wideCloseness(readability) +
    (readability.fill ?? 0) -
    crossings / 10;
  return arrangements.toSorted(
    (a, b) => score(b) - score(a) || Number(b.shown ?? false) - Number(a.shown ?? false)
  );
}

/** How many arrangements the assistant is told of, best first. */
const toldArrangements = 5;

/**
 * The best arrangements in a line each, for the assistant: the values each sets, its shape, its
 * crossings and its text size, as "Graph.layoutSeed 3: 1.2:1 near square, filling 74% of its
 * frame, 1 part, 0 crossings, text 14 px". One measuring as one above it does is left out, as
 * nothing here tells them apart.
 */
export function arrangementsText(arrangements: readonly Arrangement[]): string[] {
  const told = new Set<string>();
  return rankedArrangements(arrangements)
    .flatMap(({ values, readability, crossings, shown }) => {
      const facts = `${layoutShape(readability)}, ${crossings} crossing${crossings === 1 ? '' : 's'}, text ${whole(readability.text)} px`;
      if (told.has(facts)) return [];
      told.add(facts);
      const set = Object.entries(values)
        .map(([variable, value]) => `${variable} ${value}`)
        .join(', ');
      return [`${set}: ${facts}${shown ? ' (shown)' : ''}`];
    })
    .slice(0, toldArrangements);
}
