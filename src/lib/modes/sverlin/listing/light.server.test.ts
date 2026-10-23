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
  const Matches = operation({ at: Index, target: Int }, ({ at, target }) => at.value === target);
`);
const input = interpretInput('const values = Values([3, 8, 5]); const target = Int(8);', domain);
const body = `
  for (let i = Index(0); i < values.length; i++) { // @loop
    const found = Flag(Matches({ at: i, target })); // @check
    yield;
    if (found) break; // @test; stop: break
  }
  yield;
`;
const text = `for [loop: i = 0 to n - 1]
    [check: found = [Matches: A[i] == x]]
    if [test: found then [stop: stop]]`;
const traced = traceAlgorithm(body, input, domain);
const { listing, problems } = mappedListing({ body: text }, { ...traced, body }, domain);
/** The text each range of a step's lighting covers. */
const shown = ({ text }: Listing, { current, earlier }: Lit) => ({
  current: current.map(([start, end]) => text.slice(start, end)),
  earlier: earlier.map(([start, end]) => text.slice(start, end))
});

describe('lighting', () => {
  it('lights what each step ran, the latest strongest, an operation’s body at its call', () => {
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

  it('never makes a loop’s exit the latest, as what left it is', () => {
    const lit = lightSteps(listing, traced.steps);
    expect(shown(listing, lit[2]).current).toEqual(['stop']);
    expect(shown(listing, lit[2]).earlier).toEqual(expect.arrayContaining(['i = 0 to n - 1']));
  });

  it('keeps the lighting of the step before where a step lights nothing', () => {
    const unlit: Listing = { text: 'x', marks: [] };
    expect(lightSteps(unlit, [{ events: [] }, { events: [] }])).toEqual([
      { current: [], earlier: [] },
      { current: [], earlier: [] }
    ]);
  });
});
