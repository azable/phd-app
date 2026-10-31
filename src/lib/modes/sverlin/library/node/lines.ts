/**
 * Links drawn as lines. A <Link> is an arrow from its from to its to, unless the same <Link> joins
 * the same two ends the other way at exactly the same steps, as an undirected graph's neighbour
 * lists name each edge from both its ends: then the pair is one two-way line, its kind's head at
 * both ends, at every step, so a link never turns from an arrow into a line as the steps run.
 */

/** Ends in the order their places come, as vertices[2] before vertices[10]. */
export const byPlace: (a: string, b: string) => number = new Intl.Collator(undefined, {
  numeric: true
}).compare;

/** What a link's two ways share: its tag and its ends in order; none for a link to itself. */
export const pairOf = (ref: string, from: string, to: string): string | undefined =>
  from === to ? undefined : `${ref}|${[from, to].sort(byPlace).join('|')}`;

/**
 * The pairs drawn as lines, from the links shown at each step, as `pair|forward` or `pair|back`:
 * those shown both ways at some step, and both ways or neither at every step.
 */
export function linePairs(steps: readonly ReadonlySet<string>[]): Set<string> {
  const pairs = new Set(
    steps.flatMap((shown) => [...shown].map((link) => link.slice(0, link.lastIndexOf('|'))))
  );
  return new Set(
    [...pairs].filter(
      (pair) =>
        steps.some((shown) => shown.has(`${pair}|forward`)) &&
        steps.every((shown) => shown.has(`${pair}|forward`) === shown.has(`${pair}|back`))
    )
  );
}
