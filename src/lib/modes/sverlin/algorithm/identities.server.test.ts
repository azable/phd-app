import { describe, expect, it } from 'vitest';

import { interpretAlgorithm, interpretDomain } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Count = type('integer', { min: 0, max: 99 });
  const Counts = collection(Count);
  const Table = collection(Counts);
`);

/**
 * Each step's ids of the given paths after its code, and its copies there, each after matched with
 * the after before it (a step's before is placed without being kept).
 */
function identities(body: string, paths: string[]) {
  return interpretAlgorithm(body, undefined, domain).map(({ identities }) => ({
    ids: paths.map((path) => identities?.ids[path]),
    copies: identities?.copies ?? {}
  }));
}

describe('identities', () => {
  it('move with a swapped value, a temporary still in scope being a copy', () => {
    const swap = 'const moved = values[0]; values[0] = values[1]; values[1] = moved;';
    // The whole swap is one step's code.
    const [before, after] = identities(
      `/* @step */ const values = Values([7, 3, 9]); /* @step */ if (values.length > 0) { ${swap} }`,
      ['values[0]', 'values[1]', 'values[2]']
    );
    const [seven, three, nine] = before.ids;
    expect(after).toEqual({ ids: [three, seven, nine], copies: {} });

    // The swap at the top level runs after the last labelled code, so it is the end's step.
    const [, inScope] = identities(`/* @step */ const values = Values([7, 3, 9]); ${swap}`, [
      'values[0]',
      'values[1]',
      'moved'
    ]);
    const copy = inScope.ids[2];
    expect(inScope).toEqual({ ids: [three, seven, copy], copies: { [copy!]: seven } });
  });

  it('make a copy where one value sits in two places, and keep the value a variable held', () => {
    const [start, shifted, inserted] = identities(
      `const values = Values([5, 2, 4]); // @step
       const key = values[1];
       values[1] = values[0]; // @step
       values[0] = key; // @step`,
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
       let merged = Values([]); // @step
       merged.push(left[0]); // @step`,
      ['left[0]', 'merged[0]']
    );
    const one = start.ids[0];
    const copy = merged.ids[1];
    expect(merged).toEqual({ ids: [one, copy], copies: { [copy!]: one } });
  });

  it('give a value written anew a new identity', () => {
    const [before, after] = identities(
      `const values = Values([7, 3]); // @step
       values[0] = 0; // @step`,
      ['values[0]', 'values[1]']
    );
    expect(after.ids[0]).not.toBe(before.ids[0]);
    expect(after.ids[1]).toBe(before.ids[1]);
    expect(after.copies).toEqual({});
  });

  it('keep the rest when the front leaves', () => {
    const [before, after] = identities(
      `const queue = Values([1, 2, 3]); // @step
       queue.shift(); // @step`,
      ['queue[0]', 'queue[1]', 'queue[2]']
    );
    expect(after.ids).toEqual([before.ids[1], before.ids[2], undefined]);
  });

  it('are one for a collection wherever it is held', () => {
    const [step] = identities(
      `const grid = Table([[0, 0], [0, 0]]);
       let row = grid[1];`,
      ['row', 'grid[1]', 'grid[0]']
    );
    expect(step.ids[0]).toBe(step.ids[1]);
    expect(step.ids[2]).not.toBe(step.ids[1]);
  });

  it('go to a variable only while no collection holds its value', () => {
    const [, aside, back] = identities(
      `const values = Values([5, 2, 4]); // @step
       const key = values[1];
       values[1] = values[0]; // @step
       values[0] = key; // @step`,
      ['values[0]', 'key']
    );
    const two = aside.ids[1];
    // The key alone holds the 2, so it moves there; back in the row, the key shows a copy.
    expect(aside.copies).not.toHaveProperty(String(two));
    expect(back.ids[0]).toBe(two);
    expect(back.copies).toEqual({ [back.ids[1]!]: two });
  });
});
