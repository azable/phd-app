import { describe, expect, it } from 'vitest';

import { interpretAlgorithm, interpretDomain } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Count = type('integer', { min: 0, max: 99 });
  const Counts = collection(Count);
  const Table = collection(Counts);
`);

/** Each step's ids of the given paths, and its copies. */
function identities(body: string, paths: string[]) {
  return interpretAlgorithm(body, undefined, domain).map(({ identities }) => ({
    ids: paths.map((path) => identities?.ids[path]),
    copies: identities?.copies
  }));
}

describe('identities', () => {
  it('move with a swapped value', () => {
    const [before, after] = identities(
      `const values = Values([7, 3, 9]);
       yield;
       const moved = values[0]; values[0] = values[1]; values[1] = moved;
       yield;`,
      ['values[0]', 'values[1]', 'values[2]']
    );
    const [seven, three, nine] = before.ids;
    expect(after).toEqual({ ids: [three, seven, nine], copies: {} });
  });

  it('make a copy where one value sits in two places, and keep the value a variable held', () => {
    const [start, shifted, inserted] = identities(
      `const values = Values([5, 2, 4]);
       yield;
       const key = values[1];
       values[1] = values[0];
       yield;
       values[0] = key;
       yield;`,
      ['values[0]', 'values[1]', 'values[2]']
    );
    const [five, two, four] = start.ids;
    const copy = shifted.ids[1];
    expect(shifted).toEqual({ ids: [five, copy, four], copies: { [copy!]: five } });
    expect(copy).not.toBe(two);
    expect(inserted.ids).toEqual([two, copy, four]);
  });

  it('copy a value pushed from one collection into another', () => {
    const [start, merged] = identities(
      `const left = Values([1, 4]);
       let merged = Values([]);
       yield;
       merged.push(left[0]);
       yield;`,
      ['left[0]', 'merged[0]']
    );
    const one = start.ids[0];
    const copy = merged.ids[1];
    expect(merged).toEqual({ ids: [one, copy], copies: { [copy!]: one } });
  });

  it('give a value written anew a new identity', () => {
    const [before, after] = identities(
      `const values = Values([7, 3]);
       yield;
       values[0] = 0;
       yield;`,
      ['values[0]', 'values[1]']
    );
    expect(after.ids[0]).not.toBe(before.ids[0]);
    expect(after.ids[1]).toBe(before.ids[1]);
    expect(after.copies).toEqual({});
  });

  it('keep the rest when the front leaves', () => {
    const [before, after] = identities(
      `const queue = Values([1, 2, 3]);
       yield;
       queue.shift();
       yield;`,
      ['queue[0]', 'queue[1]', 'queue[2]']
    );
    expect(after.ids).toEqual([before.ids[1], before.ids[2], undefined]);
  });

  it('are one for a collection wherever it is held', () => {
    const [step] = identities(
      `const grid = Table([[0, 0], [0, 0]]);
       let row = grid[1];
       yield;`,
      ['row', 'grid[1]', 'grid[0]']
    );
    expect(step.ids[0]).toBe(step.ids[1]);
    expect(step.ids[2]).not.toBe(step.ids[1]);
  });

  it('are left out of variables holding a single value', () => {
    const [step] = identities(`const values = Values([1]); let n = values[0]; yield;`, ['n']);
    expect(step.ids).toEqual([undefined]);
  });
});
