import { describe, expect, it } from 'vitest';

import {
  interpretDomain,
  interpretInput,
  spanKey,
  traceAlgorithm
} from '../algorithm/interpret.server';
import { lightSteps, type Lit } from './light.server';
import type { Listing } from './listing';
import { mappedListing } from './mapped.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 99 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');
  const Length = unop((v: Values) => Index(v.length));
  const Before = binop((a: Index, b: Index) => Flag(a < b));
  const Next = unop((p: Index) => Index(p + 1));
  const Equal = binop((a: Int, b: Int) => Flag(a === b));
`);
const input = interpretInput('const values = Values([3, 8, 5]); const target = Int(8);', domain);
const body = `
  for (let i = Index(0); @loop[Before(i, Length(values))]; i = Next(i)) {
    @check[const found = @matches[Equal(values[i], target)];]
    @test[if (found) {
      @stop[break;]
    }]
  }
`;
const text = `for @loop[i = 0 to n - 1]
    @check[found = @matches[A[i] == x]]
    if @test[found then @stop[stop]]`;
// Pausing at the check: each step leads up to it, then makes it.
const atCheck = { pauses: new Map([['check', 'on' as const]]) };
const traced = traceAlgorithm(body, input, domain, atCheck);
const { listing, problems } = mappedListing({ body: text }, traced);
/** The text each range of a step's lighting covers. */
const shown = ({ text }: Listing, { current, earlier }: Lit) => ({
  current: current.map(([start, end]) => text.slice(start, end)),
  earlier: earlier.map(([start, end]) => text.slice(start, end))
});

describe('lighting', () => {
  it('lights only the code of the label each step is a run of, not what led up to it', () => {
    expect(problems).toEqual([]);
    const lit = lightSteps(listing, traced.steps);
    expect(shown(listing, lit[0])).toEqual({ current: ['found = A[i] == x'], earlier: [] });
    expect(shown(listing, lit[1])).toEqual({ current: ['found = A[i] == x'], earlier: [] });
  });

  it('lights nothing at the last step, after the last step’s code: it is no run of a label', () => {
    // The loop's exit only drops found and i, so it is no step: the page rests on the check that
    // found 8.
    expect(lightSteps(listing, traced.steps)).toHaveLength(2);
    // A declaration after the loop makes the end a step, holding the test that held, the stop,
    // and the exit.
    const ending = traceAlgorithm(
      `${body}\n  @done[const done = Flag(true);]`,
      input,
      domain,
      atCheck
    );
    const lit = lightSteps(mappedListing({ body: text }, ending).listing, ending.steps);
    expect(lit).toHaveLength(3);
    expect(shown(listing, lit[2])).toEqual({ current: [], earlier: [] });
  });

  it('lights faintly only code done: the code the step stops in is outside it, or it holds others', () => {
    // Two lines, each a statement; the step leads up through the first into the second.
    const text = 'a = 1\nb = f(a)';
    const first = { start: 0, end: 5 };
    const second = { start: 6, end: 14 };
    const call = { start: 10, end: 14 };
    const lines: Listing = {
      text,
      marks: [
        { key: spanKey(first), label: 'a', start: 0, end: 5, scope: first },
        { key: spanKey(second), label: 'a', start: 6, end: 14, scope: second },
        { key: spanKey(call), label: 'a', start: 6, end: 14, scope: second }
      ]
    };
    const event = (at: { start: number; end: number }) => ({ kind: 'read' as const, at });
    const lit = (events: { kind: 'read'; at: { start: number; end: number } }[]) =>
      shown(lines, lightSteps(lines, [{ events, gap: events.length - 1 }])[0]);
    // Stopped in the second line, the first is done.
    expect(lit([event(first), event(call)]).earlier).toEqual(['a = 1']);
    // Stopped inside the second line, its part already run is not done.
    expect(lit([event(call), event(call)]).earlier).toEqual([]);
    // The first line's code taken as holding the second: not done while the step stops inside it,
    // unless it is a statement holding others, done once its own code ran.
    const around = { start: 0, end: 14 };
    const holding = (compound: boolean): Listing => ({
      text,
      marks: [
        { key: spanKey(first), label: 'a', start: 0, end: 5, scope: around, compound },
        { key: spanKey(call), label: 'a', start: 10, end: 14, scope: call }
      ]
    });
    const kept = (listing: Listing) =>
      shown(listing, lightSteps(listing, [{ events: [event(first), event(call)], gap: 1 }])[0])
        .earlier;
    expect(kept(holding(false))).toEqual([]);
    expect(kept(holding(true))).toEqual(['a = 1']);
    // Not while the step stops inside its test, as a loop's line paused at its comparison.
    const testing: Listing = {
      ...holding(true),
      marks: holding(true).marks.map((mark, at) => (at ? mark : { ...mark, test: call }))
    };
    expect(kept(testing)).toEqual([]);
  });

  it('pairs a region’s own lines with its statements, so a node lights only its own line', () => {
    const swap = traceAlgorithm(
      `
  let a = Index(0);
  @swap{
    const kept = values[@from[a]];
    a = Next(a);
  }
`.replace('@swap{', 'if (Before(a, Length(values))) @swap{'),
      input,
      domain,
      { pauses: new Map([['swap', 'accumulate']]) }
    );
    const { listing: paired, problems } = mappedListing(
      { body: 'if a < n\n  @swap[kept = A[@from[a]]\n  a = a + 1]' },
      swap
    );
    expect(problems).toEqual([]);
    const second = paired.marks.filter(({ start }) => paired.text.slice(start).startsWith('a = a'));
    // The second statement's nodes light its line only.
    expect(second.length).toBeGreaterThan(0);
    for (const { start, end } of second) expect(paired.text.slice(start, end)).toBe('a = a + 1');
  });

  it('keeps the lighting of the step before where a step lights nothing', () => {
    const unlit: Listing = { text: 'x', marks: [] };
    expect(lightSteps(unlit, [{ events: [] }, { events: [] }])).toEqual([
      { current: [], earlier: [] },
      { current: [], earlier: [] }
    ]);
  });
});
