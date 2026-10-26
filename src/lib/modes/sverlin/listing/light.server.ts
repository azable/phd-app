/**
 * What each step lights in a listing: its code's own events, and the regions of the label it is a
 * run of, most strongly, and the code it keeps as having run before it more faintly: the events
 * logged in its trail (see MasterStep), those leading up to it and those earlier in each run
 * accumulating around it, or without a trail, those since the step before. A step whose events
 * light nothing keeps the lighting of the step before.
 */

import type { Span } from '../algorithm/block.server';
import type { TraceEvent } from '../algorithm/events.server';
import { spanKey } from '../algorithm/interpret.server';
import type { Listing, Mark } from './listing';

export type Range = readonly [start: number, end: number];

/** A step's lighting: its code's text, and the text of the code it keeps as run before it. */
export type Lit = { current: Range[]; earlier: Range[] };

type LitStep = {
  events?: readonly TraceEvent[];
  gap?: number;
  unit?: Span;
  seen?: number;
  trail?: readonly (readonly [number, number])[];
};

export function lightSteps(listing: Listing, steps: readonly LitStep[]): Lit[] {
  const marks = new Map<string, Mark[]>();
  for (const mark of listing.marks) marks.set(mark.key, [...(marks.get(mark.key) ?? []), mark]);
  const lit: Lit[] = [];
  const marksOf = (events: readonly TraceEvent[]) =>
    events.flatMap((event) => marks.get(spanKey(event.at)) ?? []);
  // The marks of the events a step's trail keeps, its own leading up to it and those of the steps
  // before it, each event numbered by how many were logged before it.
  const trailed = (index: number, trail: readonly (readonly [number, number])[]) => {
    const kept = (at: number) => trail.some(([from, to]) => from <= at && at < to);
    const first = Math.min(...trail.map(([from]) => from));
    const found: Mark[] = [];
    for (let back = index; back >= 0; back--) {
      const { events = [], gap = 0, seen } = steps[back];
      if (seen === undefined) break;
      const start = seen - events.length;
      events.forEach((event, at) => {
        if ((back < index || at < gap) && kept(start + at)) found.push(...marksOf([event]));
      });
      if (start <= first) break;
    }
    return found;
  };
  for (const [index, { events = [], gap = 0, unit, trail }] of steps.entries()) {
    const leading: Mark[] = [];
    const latest: Mark[] = [];
    events.forEach((event, at) =>
      (at < gap ? leading : latest).push(...(marks.get(spanKey(event.at)) ?? []))
    );
    const before = trail ? trailed(index, trail) : leading;
    // A label on a block or on statements in a row has no events of its own.
    if (unit) latest.push(...(marks.get(spanKey(unit)) ?? []));
    if (!latest.length && !leading.length && !before.length) {
      lit.push(lit.at(-1) ?? { current: [], earlier: [] });
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
      inside.push(...marksOf(steps[back].events ?? []));
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
      current: without(merged(latest)),
      earlier: without(
        merged(before).filter(
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

function merged(marks: readonly Mark[]): Range[] {
  const sorted = [...marks].sort((a, b) => a.start - b.start || b.end - a.end);
  const ranges: [number, number][] = [];
  for (const { start, end } of sorted) {
    const last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  return ranges;
}
