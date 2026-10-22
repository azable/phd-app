import { describe, expect, it } from 'vitest';

import { interpretDomain, interpretInput, traceAlgorithm } from '../algorithm/interpret.server';
import { lightSteps, writtenListing, type Lit } from './light.server';
import { python } from './python';
import { renderListing, type Listing } from './render.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 99 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');
  const Matches = operation({ at: Index, target: Int }, ({ at, target }) => at.value === target);
`);
const input = interpretInput('const values = Values([3, 8, 5]); const target = Int(8);', domain);
const body = `
  for (let i = Index(0); i < values.length; i++) {
    const found = Flag(Matches({ at: i, target }));
    yield;
    if (found) break;
  }
  yield;
`;
const { steps, root, hints } = traceAlgorithm(body, input, domain);
/** The text each range of a step's lighting covers. */
const shown = ({ text }: Listing, { current, earlier }: Lit) => ({
  current: current.map(([start, end]) => text.slice(start, end)),
  earlier: earlier.map(([start, end]) => text.slice(start, end))
});

describe('lighting', () => {
  it('lights what each step ran, the latest strongest, an inlined operation at its call', () => {
    const listing = renderListing(root, domain, hints, python);
    const lit = lightSteps(listing, steps);
    expect(shown(listing, lit[0]).current).toEqual(['found = values[i] == target']);
    expect(shown(listing, lit[0]).earlier).toEqual(
      expect.arrayContaining(['for i in range(len(values)):'])
    );
    // The second step tests found, goes round the loop, and calls Matches again.
    expect(shown(listing, lit[1]).earlier).toEqual(
      expect.arrayContaining(['found', 'for i in range(len(values)):'])
    );
    expect(shown(listing, lit[2])).toEqual({
      current: ['break'],
      earlier: ['for i in range(len(values)):', 'found']
    });
  });

  it('lights the algorithm as written, without its shared indentation', () => {
    const listing = writtenListing(body, root);
    expect(listing.text.split('\n')[0]).toBe('for (let i = Index(0); i < values.length; i++) {');
    const lit = lightSteps(listing, steps);
    expect(shown(listing, lit[0]).current).toEqual(['found = Flag(Matches({ at: i, target }))']);
    expect(shown(listing, lit[2]).current).toEqual(['break;']);
  });

  it('keeps the lighting of the step before where a step lights nothing', () => {
    const listing: Listing = { text: 'x', marks: [] };
    expect(lightSteps(listing, [{ events: [] }, { events: [] }])).toEqual([
      { current: [], earlier: [] },
      { current: [], earlier: [] }
    ]);
  });
});
