/**
 * Other arrangements of a version's free layouts, laid out by the server with no model call, so the
 * assistant compares the best ones rather than guessing: each form and direction its design offers,
 * then a few layout seeds of the arrangement shown, each measured as the version itself is (see
 * readability.server.ts) with the links that cross counted.
 */

import type { Arrangement } from '$lib/shared/readability';

import type { DesignValue } from './design.server';
import {
  arrangementSignature,
  arrangementsOnServer,
  crossingsOf,
  type DrawnSize
} from './layout.server';
import type { Geometry } from './library/geometry';
import type { FrameRatio } from './library/node/props';
import { readabilityOf } from './readability.server';

// Laying every step out again takes about 60–650 ms a time on a laptop (bfs-undirected's twelve
// arrangements 0.9 s in all, Dijkstra's 97 steps 650 ms each, on 2026-11-05): twelve arrangements
// cover every form and direction of a free layout with a few seeds, and three seconds bounds the
// time the version's build waits on them to about what a first build itself takes.
const mostArrangements = 12;
const budgetMs = 3_000;
// Seeds tried beyond the one shown: enough to see whether the arrangement is tangled by chance.
const seedsTried = 3;

const arrangementVariable = /^(.+)\.(form|direction|layoutSeed)$/u;

/** The values of each other arrangement to try: every form and direction, then a few seeds. */
export function arrangementDesigns(
  space: Readonly<Record<string, readonly DesignValue[]>>,
  values: Readonly<Record<string, DesignValue>>
): Record<string, DesignValue>[] {
  const kinds = [
    ...new Set(Object.keys(space).flatMap((key) => arrangementVariable.exec(key)?.[1] ?? []))
  ];
  const designs: Record<string, DesignValue>[] = [];
  for (const kind of kinds) {
    const options = (prop: string) => space[`${kind}.${prop}`];
    const forms = options('form') ?? [undefined];
    const directions = options('direction') ?? [undefined];
    for (const form of forms)
      for (const direction of directions) {
        const design: Record<string, DesignValue> = {};
        if (form !== undefined) design[`${kind}.form`] = form;
        if (direction !== undefined) design[`${kind}.direction`] = direction;
        const shown = Object.entries(design).every(([key, value]) => values[key] === value);
        if (!shown && Object.keys(design).length) designs.push(design);
      }
    const seeds = (options('layoutSeed') ?? []).filter(
      (seed) => seed !== values[`${kind}.layoutSeed`]
    );
    for (const seed of seeds.slice(0, seedsTried)) designs.push({ [`${kind}.layoutSeed`]: seed });
  }
  return designs.slice(0, mostArrangements);
}

/**
 * The version's own arrangement and the others the design offers, measured; none where its design
 * has no free layout to arrange.
 */
export async function measuredArrangements(
  code: string,
  space: Readonly<Record<string, readonly DesignValue[]>>,
  values: Readonly<Record<string, DesignValue>>,
  shown: { size: DrawnSize; geometry: Geometry },
  ratio: FrameRatio
): Promise<Arrangement[] | undefined> {
  const designs = arrangementDesigns(space, values);
  if (!designs.length) return undefined;
  const own = Object.fromEntries(
    Object.entries(values).filter(([key]) => arrangementVariable.test(key) && key in space)
  );
  const seen = new Set([arrangementSignature(shown.geometry)]);
  // A layout one seed leaves where it was draws alike at every seed, so its other seeds are not tried.
  const seedOnly = (design: Record<string, DesignValue>) => {
    const keys = Object.keys(design);
    return keys.length === 1 && keys[0].endsWith('.layoutSeed') ? keys[0] : undefined;
  };
  const measured = await arrangementsOnServer(code, designs, budgetMs, seen, seedOnly);
  if (!measured.length) return undefined;
  return [
    {
      values: own,
      readability: readabilityOf(shown.size, ratio),
      crossings: crossingsOf(shown.geometry),
      shown: true
    },
    ...measured.map(({ values: set, size, crossings }) => ({
      values: { ...own, ...set },
      readability: readabilityOf(size, ratio),
      crossings
    }))
  ];
}
