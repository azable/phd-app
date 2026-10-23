import { describe, expect, it } from 'vitest';

import type { StepIdentities } from './identities.server';
import { interpretAlgorithm, interpretDomain } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Count = type('integer', { min: 0, max: 99 });
  const Counts = collection(Count);
  const Table = collection(Counts);
`);

const idsOf = (identities: StepIdentities | undefined, paths: string[]) => ({
  ids: paths.map((path) => identities?.ids[path]),
  copies: identities?.copies ?? {}
});

/** Each step's ids of the given paths after its code, and its copies there. */
function identities(body: string, paths: string[]) {
  return interpretAlgorithm(body, undefined, domain).map(({ identities }) =>
    idsOf(identities, paths)
  );
}

/** The ids of the given paths as they are shown: each step's before its code, then its after. */
function shown(body: string, paths: string[]) {
  return interpretAlgorithm(body, undefined, domain).flatMap(({ before, identities }) => [
    ...(before ? [idsOf(before.identities, paths)] : []),
    idsOf(identities, paths)
  ]);
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

    // The swap at the top level runs after the last labelled code, leading up to the end's step, so
    // its before shows it.
    const [, , inScope] = shown(`/* @step */ const values = Values([7, 3, 9]); ${swap}`, [
      'values[0]',
      'values[1]',
      'moved'
    ]);
    const copy = inScope.ids[2];
    expect(inScope).toEqual({ ids: [three, seven, copy], copies: { [copy!]: seven } });
  });

  it('make a copy where one value sits in two places, and keep the copy a variable holds', () => {
    // The first step's before is empty: its code declares the values.
    const [, start, picked, shifted, , inserted] = shown(
      `const values = Values([5, 2, 4]); // @step
       const key = values[1];
       values[1] = values[0]; // @step
       values[0] = key; // @step`,
      ['values[0]', 'values[1]', 'values[2]', 'key']
    );
    const [five, two, four] = start.ids;
    // The key is picked up leading up to the shift, so it shows as a copy before the shift's code.
    const key = picked.ids[3];
    expect(picked).toEqual({ ids: [five, two, four, key], copies: { [key!]: two } });
    // Every after is matched with the before shown just ahead of it.
    const copy = shifted.ids[1];
    expect(shifted).toEqual({ ids: [five, copy, four, key], copies: { [copy!]: five } });
    expect(copy).not.toBe(two);
    // Put back, the value is the collection's again, and the key a copy of it.
    const kept = inserted.ids[3];
    expect(inserted).toEqual({ ids: [key, copy, four, kept], copies: { [kept!]: key } });
  });

  it('never bring back a value once it is no longer shown', () => {
    const paths = ['values[0]', 'values[1]', 'values[2]', 'values[3]', 'key'];
    // Each pass of the shifting loop is a step, so the key picked up and the value put back lead
    // up to one.
    const snapshots = shown(
      `const values = Values([5, 2, 4, 1]);
       for (let i = Count(1); i < values.length; i++) {
         const key = values[i];
         let j = i;
         while (j > 0 && values[j - 1] > key) { // @shift
           values[j] = values[j - 1];
           j--;
         }
         values[j] = key;
       }`,
      paths
    );
    const gone = new Set<number>();
    let previous = new Set<number>();
    for (const { ids } of snapshots) {
      const now = new Set(ids.filter((id) => id !== undefined));
      for (const id of now) expect(gone.has(id)).toBe(false);
      for (const id of previous) if (!now.has(id)) gone.add(id);
      previous = now;
    }
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
