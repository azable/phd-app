import { describe, expect, it } from 'vitest';

import { interpretDomain, interpretInput, traceAlgorithm } from '../algorithm/interpret.server';
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
// Drawing found: each step leads up to the check, then makes it.
const drawingFound = { drawn: new Set(['found']) };
const traced = traceAlgorithm(body, input, domain, drawingFound);
const { listing, problems } = mappedListing({ body: text }, traced);
/** The text each range of a step's lighting covers. */
const shown = ({ text }: Listing, { current, earlier }: Lit) => ({
  current: current.map(([start, end]) => text.slice(start, end)),
  earlier: earlier.map(([start, end]) => text.slice(start, end))
});

describe('lighting', () => {
  it('lights a step’s code strongly, and what led up to it faintly', () => {
    expect(problems).toEqual([]);
    const lit = lightSteps(listing, traced.steps);
    expect(shown(listing, lit[0]).current).toEqual(['found = A[i] == x']);
    expect(shown(listing, lit[0]).earlier).toEqual(expect.arrayContaining(['i = 0 to n - 1']));
    // The second step tests found and goes round the loop; the stop inside the test ran nothing,
    // so it stays dark.
    expect(shown(listing, lit[1]).earlier).toEqual(
      expect.arrayContaining(['i = 0 to n - 1', 'found then'])
    );
  });

  it('lights the last step, after the last step’s code, only faintly: it has no code of its own', () => {
    // The loop's exit only drops found and i, so it is no step: the page rests on the check that
    // found 8.
    expect(lightSteps(listing, traced.steps)).toHaveLength(2);
    // A declaration after the loop makes the end a step, holding the test that held, the stop,
    // and the exit.
    const ending = traceAlgorithm(
      `${body}\n  @done[const done = Flag(true);]`,
      input,
      domain,
      drawingFound
    );
    const lit = lightSteps(mappedListing({ body: text }, ending).listing, ending.steps);
    expect(lit).toHaveLength(3);
    expect(shown(listing, lit[2]).current).toEqual([]);
    expect(shown(listing, lit[2]).earlier).toEqual(['found then stop']);
  });

  it('keeps the lighting of the step before where a step lights nothing', () => {
    const unlit: Listing = { text: 'x', marks: [] };
    expect(lightSteps(unlit, [{ events: [] }, { events: [] }])).toEqual([
      { current: [], earlier: [] },
      { current: [], earlier: [] }
    ]);
  });
});
