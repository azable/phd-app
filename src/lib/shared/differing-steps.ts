/**
 * The steps at which the two sides of a comparison draw differently, from what each step draws as
 * the server lays it out (a key per step, alike where the picture is alike), and how they are
 * named: steps counted from 0 here, from 1 wherever a person reads them.
 */

/** The steps whose keys differ; unknown where either side has none or they keep different steps. */
export function differingSteps(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): number[] | undefined {
  if (!left || !right || left.length !== right.length) return undefined;
  return left.flatMap((key, step) => (key === right[step] ? [] : [step]));
}

/** Runs of consecutive steps, as first and last: [2, 3, 4, 8] → [[2, 4], [8, 8]]. */
export function stepRuns(steps: readonly number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const step of [...steps].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && step === last[1] + 1) last[1] = step;
    else if (!last || step > last[1]) runs.push([step, step]);
  }
  return runs;
}

/** Steps as a person reads them, counted from 1: [2, 3, 4, 8] → "3–5 and 9". */
export function stepRanges(steps: readonly number[]): string {
  const ranges = stepRuns(steps).map(([first, last]) =>
    first === last ? `${first + 1}` : `${first + 1}–${last + 1}`
  );
  return new Intl.ListFormat('en', { type: 'conjunction' }).format(ranges);
}

/** The nearest differing step before or after one, if any. */
export function nearestDifference(
  steps: readonly number[],
  from: number,
  direction: -1 | 1
): number | undefined {
  const sorted = [...steps].sort((a, b) => a - b);
  return direction > 0
    ? sorted.find((step) => step > from)
    : sorted.findLast((step) => step < from);
}
