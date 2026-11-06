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
import { typicalStage } from '../readability.server';

const whole = (value: number) => Math.round(value).toLocaleString('en');

/**
 * The shape layouts aim at: the stage a version shows on (readability.server.ts typicalStage),
 * 3:2. Until 6 November this was 16:9, a slide's shape, which ranked layouts wider than the stage
 * they show on (the helpers audit, design.md "Helpers: skeletons with holes").
 */
const targetAspect = typicalStage.width / typicalStage.height;

/**
 * How near a layout's content is to the stage's 3:2, from 1 there to 0 at a third or three times as
 * wide: a 2:1 page scores about 0.74, a square about 0.63, a 2:3 column 0.26, so tall layouts rank
 * below wide ones.
 */
export function stageCloseness({ content }: Readability): number {
  const aspect = content.width / content.height;
  return Math.max(0, 1 - Math.abs(Math.log(aspect / targetAspect)) / Math.log(3));
}

/**
 * Arrangements best first: text readable on the typical stage before anything, then a shape near
 * the stage's and a fuller frame with fewer crossings, each crossing costing a tenth of the frame; the
 * shown one first of equals.
 */
export function rankedArrangements(arrangements: readonly Arrangement[]): Arrangement[] {
  const score = ({ readability, crossings }: Arrangement) =>
    (readability.text >= smallestReadableText ? 2 : 0) +
    3 * stageCloseness(readability) +
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
