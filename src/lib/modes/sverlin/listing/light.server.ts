/**
 * What each step lights in a listing: only the code of labels it pauses at. Its own run's code and
 * the regions of its label most strongly, and more faintly the code it keeps as having run before
 * it, those earlier in each run accumulating around it, each stretch of its trail (see MasterStep)
 * lighting only its run's labels' regions and the regions inside them, each only where its code is
 * done. Without a trail, a step lights all its events' code, or where they light nothing, keeps the
 * lighting of the step before.
 */

import type { Span } from '../algorithm/block.server';
import type { TraceEvent } from '../algorithm/events.server';
import { spanKey, type Stretch } from '../algorithm/interpret.server';
import type { Listing, Mark } from './listing';

export type Range = readonly [start: number, end: number];

/** A step's lighting: its code's text, and the text of the code it keeps as run before it. */
export type Lit = { current: Range[]; earlier: Range[] };

type LitStep = {
  events?: readonly TraceEvent[];
  gap?: number;
  unit?: Span;
  seen?: number;
  trail?: readonly Stretch[];
};

/** Whether a mark is in the region of one of the labels or of a label inside one. */
const inLabels = ({ label }: Mark, labels: readonly string[]) =>
  labels.some((each) => label === each || label.startsWith(`${each}.`));

export function lightSteps(listing: Listing, steps: readonly LitStep[]): Lit[] {
  const marks = new Map<string, Mark[]>();
  for (const mark of listing.marks) marks.set(mark.key, [...(marks.get(mark.key) ?? []), mark]);
  const lit: Lit[] = [];
  const marksOf = (event: TraceEvent) => marks.get(spanKey(event.at)) ?? [];
  // The marks an event lights, numbered by how many were logged before it: those of the labels of
  // the stretches holding it.
  const lighting = (trail: readonly Stretch[] | undefined, event: TraceEvent, number: number) =>
    marksOf(event).filter(
      (mark) =>
        !trail ||
        trail.some(([from, to, labels]) => from <= number && number < to && inLabels(mark, labels))
    );
  // The marks of the events a step's trail keeps, its own leading up to it and those of the steps
  // before it.
  const trailed = (index: number, trail: readonly Stretch[]) => {
    const first = Math.min(...trail.map(([from]) => from));
    const found: Mark[] = [];
    for (let back = index; back >= 0; back--) {
      const { events = [], gap = 0, seen } = steps[back];
      if (seen === undefined) break;
      const start = seen - events.length;
      events.forEach((event, at) => {
        if (back < index || at < gap) found.push(...lighting(trail, event, start + at));
      });
      if (start <= first) break;
    }
    return found;
  };
  for (const [index, { events = [], gap = 0, unit, seen, trail }] of steps.entries()) {
    const leading: Mark[] = [];
    const latest: Mark[] = [];
    const start = (seen ?? events.length) - events.length;
    events.forEach((event, at) =>
      (at < gap ? leading : latest).push(...lighting(trail, event, start + at))
    );
    // What ran before a step lights only where its code is done: the code the step stops in, at its
    // last event, is outside it, or it holds other statements and its own code ran. So a statement
    // half run, as the swap's second line paused at its read of A[j], stays dark, as does a
    // comparison whose operands are still being found, and a loop's line while its test is still
    // running, as paused at the comparison in while j > 0 and A[j - 1] > A[j].
    const last = events.at(-1)?.at;
    const outside = (code: { start: number; end: number }) =>
      !last || last.start < code.start || code.end < last.end;
    const done = ({ scope, compound, test }: Mark) =>
      !scope || outside(scope) || (!!compound && (!test || outside(test)));
    const before = (trail ? trailed(index, trail) : leading).filter(done);
    // A label on a block or on statements in a row has no events of its own; its regions are those
    // of the step's own run, its trail's first stretch.
    const own = trail?.[0]?.[2];
    if (unit)
      latest.push(
        ...(marks.get(spanKey(unit)) ?? []).filter((mark) => !own || inLabels(mark, own))
      );
    if (!latest.length && !leading.length && !before.length) {
      lit.push((!trail && lit.at(-1)) || { current: [], earlier: [] });
      continue;
    }
    const lighted = [leading, before, latest];
    // A region inside a lit one that ran nothing this step, nor anything inside it, is left out of
    // it, as the comparison in while @test[@bound[j > 0] and @cmp[A[j] > key]] once j > 0 fails;
    // what ran at the steps just before it inside its code counts, as operands paused at.
    const inside: Mark[] = [];
    for (let back = index - 1; unit && back > 0; back--) {
      const earlier = steps[back].unit;
      const within =
        earlier &&
        unit.start <= earlier.start &&
        earlier.end <= unit.end &&
        (earlier.start !== unit.start || earlier.end !== unit.end);
      if (!within) break;
      inside.push(...(steps[back].events ?? []).flatMap(marksOf));
    }
    const ran = [...lighted.flat(), ...inside];
    const quiet = (listing.regions ?? []).filter(
      (region) => !ran.some((mark) => region.start <= mark.start && mark.end <= region.end)
    );
    const without = (ranges: Range[], also: readonly { start: number; end: number }[] = []) =>
      ranges.flatMap((range) => holed(range, [...quiet, ...also], listing.text));
    // What ran before a step lights around its code, not over a region holding it where nothing
    // kept ran inside it: paused at the left operand, the insertion's code before it, but not the
    // rest of the comparison it is in, unless the comparison's code is kept too.
    const inRegion = (region: { start: number; end: number }) => (mark: Mark) =>
      region.start <= mark.start && mark.end <= region.end;
    const holding = (listing.regions ?? []).filter(
      (region) => latest.some(inRegion(region)) && !before.some(inRegion(region))
    );
    lit.push({
      current: without(merged(latest, listing.text)),
      earlier: without(
        merged(before, listing.text).filter(
          (range) => !latest.some((mark) => mark.start <= range[0] && range[1] <= mark.end)
        ),
        holding
      )
    });
  }
  return lit;
}

/** A range without the regions strictly inside it, its pieces trimmed of spaces at their ends. */
function holed(
  range: Range,
  holes: readonly { start: number; end: number }[],
  text: string
): Range[] {
  const inside = holes
    .filter(
      ({ start, end }) =>
        range[0] <= start && end <= range[1] && (start !== range[0] || end !== range[1])
    )
    .sort((a, b) => a.start - b.start);
  if (!inside.length) return [range];
  const pieces: Range[] = [];
  let from = range[0];
  for (const { start, end } of inside) {
    if (start > from) pieces.push([from, start]);
    from = Math.max(from, end);
  }
  if (from < range[1]) pieces.push([from, range[1]]);
  return pieces.flatMap(([start, end]) => {
    const piece = text.slice(start, end);
    const lead = piece.length - piece.trimStart().length;
    const trail = piece.length - piece.trimEnd().length;
    return end - trail > start + lead ? [[start + lead, end - trail] as Range] : [];
  });
}

/** The marks' text as ranges, those touching or with only spaces between them joined. */
function merged(marks: readonly Mark[], text: string): Range[] {
  const sorted = [...marks].sort((a, b) => a.start - b.start || b.end - a.end);
  const ranges: [number, number][] = [];
  for (const { start, end } of sorted) {
    const last = ranges.at(-1);
    if (last && (start <= last[1] || !text.slice(last[1], start).trim()))
      last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  return ranges;
}
