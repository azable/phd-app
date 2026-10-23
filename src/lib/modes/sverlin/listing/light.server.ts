/**
 * What each step lights in a listing: the text of the events since the step before, the latest
 * strongest. A loop's entry and exit light its head but are never the latest, which is what led
 * to them, as a break; a yield lights nothing. A step whose events light nothing keeps the
 * lighting of the step before.
 */

import type { TraceEvent } from '../algorithm/events.server';
import { spanKey } from '../algorithm/interpret.server';
import type { Listing, Mark } from './listing';

export type Range = readonly [start: number, end: number];

/** A step's lighting: the latest event's text, and the text of the step's other events. */
export type Lit = { current: Range[]; earlier: Range[] };

export function lightSteps(
  listing: Listing,
  steps: readonly { events?: readonly TraceEvent[] }[]
): Lit[] {
  const marks = new Map<string, Mark[]>();
  for (const mark of listing.marks) marks.set(mark.key, [...(marks.get(mark.key) ?? []), mark]);
  const lit: Lit[] = [];
  for (const { events = [] } of steps) {
    // The operations open around each event, so an operation's body written at its call lights
    // there, or the call itself where its body is not written.
    const open: string[] = [];
    const lighted: Mark[][] = [];
    let latest: Mark[] | undefined;
    for (const event of events) {
      const key = spanKey(event.block ?? 'algorithm', event.at);
      if (event.kind === 'close') open.pop();
      const found =
        event.kind === 'yield' ? [] : textOf(key, event.block === 'domain' ? open : [], marks);
      if (found.length) {
        lighted.push(found);
        if (event.kind !== 'enter' && event.kind !== 'exit') latest = found;
      }
      if (event.kind === 'open') open.push(key);
    }
    if (!latest) {
      lit.push(lit.at(-1) ?? { current: [], earlier: [] });
      continue;
    }
    // A region inside a lit one that ran nothing this step is left out of it, as the comparison
    // in while [test: [bound: j > 0] and [cmp: A[j] > key]] once j > 0 fails.
    const ran = lighted.flat();
    const quiet = (listing.regions ?? []).filter(
      (region) => !ran.some((mark) => mark.start === region.start && mark.end === region.end)
    );
    const without = (ranges: Range[]) =>
      ranges.flatMap((range) => holed(range, quiet, listing.text));
    lit.push({
      current: without(merged(latest)),
      earlier: without(
        merged(lighted.filter((marks) => marks !== latest).flat()).filter(
          (range) => !latest.some((mark) => mark.start <= range[0] && range[1] <= mark.end)
        )
      )
    });
  }
  return lit;
}

/**
 * The text an event's node became: within the calls open around it, innermost first, then on its
 * own, as a body defined above the algorithm is written once; else the outermost call's.
 */
function textOf(key: string, open: readonly string[], marks: ReadonlyMap<string, Mark[]>): Mark[] {
  for (let from = 0; from <= open.length; from++) {
    const within = open
      .slice(from)
      .map((call) => `${call}>`)
      .join('');
    const found = marks.get(`${within}${key}`);
    if (found) return found;
  }
  return open.length ? (marks.get(open[0]) ?? []) : [];
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
