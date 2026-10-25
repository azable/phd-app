import { describe, expect, it } from 'vitest';

import type { StepIdentities } from './identities.server';
import { interpretDomain, traceAlgorithm, type Pacing } from './interpret.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Count = type('integer', { min: 0, max: 99 });
  const Counts = collection(Count);
  const Table = collection(Counts);
  const Flag = type('boolean');
  const Filled = unop((v: Values) => Flag(v.length > 0));
  const Before = binop((a: Count, b: Count) => Flag(a < b));
  const Size = unop((v: Values) => Count(v.length));
  const Up = unop((n: Count) => Count(n + 1));
  const Down = unop((n: Count) => Count(n - 1));
  const Greater = binop((a: Int, b: Int) => Flag(a > b));
  const Append = binop((c: Values, x: Int) => Values([...c, x]));
  const Rest = unop((c: Values) => Values(c.slice(1)));
`);

const idsOf = (identities: StepIdentities | undefined, paths: string[]) => ({
  ids: paths.map((path) => identities?.ids[path]),
  copies: identities?.copies ?? {}
});

/** Each step's ids of the given paths after its code, and its copies there. */
function identities(body: string, paths: string[]) {
  return traceAlgorithm(body, undefined, domain).steps.map(({ identities }) =>
    idsOf(identities, paths)
  );
}

/**
 * The ids of the given paths as they are shown, paced as given: each step's before its code, then
 * its after.
 */
function shown(body: string, paths: string[], pacing?: Pacing) {
  return traceAlgorithm(body, undefined, domain, pacing).steps.flatMap(({ before, identities }) => [
    ...(before ? [idsOf(before.identities, paths)] : []),
    idsOf(identities, paths)
  ]);
}

describe('identities', () => {
  it('move with a swapped value, a temporary still in scope being a copy', () => {
    const swap = 'const moved = values[0]; values[0] = values[1]; values[1] = moved;';
    // The whole swap is one step's code.
    const [before, after] = identities(
      `@start[const values = Values([7, 3, 9]);] @swap[if (Filled(values)) { ${swap} }]`,
      ['values[0]', 'values[1]', 'values[2]']
    );
    const [seven, three, nine] = before.ids;
    expect(after).toEqual({ ids: [three, seven, nine], copies: {} });

    // The swap's statements at the top level, one step, leave its temporary in scope.
    const [, , , inScope] = shown(`@start[const values = Values([7, 3, 9]);] @swap[${swap}]`, [
      'values[0]',
      'values[1]',
      'moved'
    ]);
    const copy = inScope.ids[2];
    expect(inScope).toEqual({ ids: [three, seven, copy], copies: { [copy!]: seven } });
  });

  it('make a copy where one value sits in two places, and keep the copy a variable holds', () => {
    // The first step's before is empty: its code declares the values.
    const [, start, , picked, , shifted, , inserted] = shown(
      `@start[const values = Values([5, 2, 4]);]
       @pick[const key = values[1];]
       @shift[values[1] = values[0];]
       @put[values[0] = key;]`,
      ['values[0]', 'values[1]', 'values[2]', 'key']
    );
    const [five, two, four] = start.ids;
    // The key picked up is a copy of the value it was picked from.
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
    // Drawing only the row, the key picked up leads up to the shifts and the placing.
    const snapshots = shown(
      `@start[const values = Values([5, 2, 4, 1]);]
       for (let i = Count(1); Before(i, Size(values)); i = Up(i)) {
         @pick[const key = values[i];
         let j = i;]
         @shift[while (Before(Count(0), j) && Greater(values[Down(j)], key)) {
           values[j] = values[Down(j)];
           j = Down(j);
         }]
         @place[values[j] = key;]
       }`,
      paths,
      { drawn: new Set(['values']) }
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
      `@start[const left = Values([1, 4]);
       let merged = Values([]);]
       @push[merged = Append(merged, left[0]);]`,
      ['left[0]', 'merged[0]']
    );
    const one = start.ids[0];
    const copy = merged.ids[1];
    expect(merged.ids).toEqual([one, copy]);
    expect(merged.copies[copy!]).toBe(one);
  });

  it('give a value written anew a new identity', () => {
    const [before, after] = identities(
      `@start[const values = Values([7, 3]);]
       @write[values[0] = 0;]`,
      ['values[0]', 'values[1]']
    );
    expect(after.ids[0]).not.toBe(before.ids[0]);
    expect(after.ids[1]).toBe(before.ids[1]);
    expect(after.copies).toEqual({});
  });

  it('keep the rest when the front leaves', () => {
    const [before, after] = identities(
      `@start[let queue = Values([1, 2, 3]);]
       @leave[queue = Rest(queue);]`,
      ['queue[0]', 'queue[1]', 'queue[2]']
    );
    expect(after.ids).toEqual([before.ids[1], before.ids[2], undefined]);
  });

  it('follow elements through a queue: one arriving at the back, the front leaving', () => {
    const [start, joined, left] = identities(
      `@start[let queue = Values([1, 2]);]
       @join[queue = Append(queue, 3);]
       @leave[const front = queue[0];
       queue = Rest(queue);]`,
      ['queue[0]', 'queue[1]', 'queue[2]']
    );
    const [one, two] = start.ids;
    const three = joined.ids[2];
    expect(joined.ids).toEqual([one, two, three]);
    expect(three).not.toBe(one);
    // The front leaves; the rest move up, and the front itself stays with front, a copy no more.
    expect(left.ids).toEqual([two, three, undefined]);
  });

  it('follow values rearranged by writes in one step, as a re-insert', () => {
    const [before, after] = identities(
      `@start[const values = Values([1, 2, 3]);]
       @rotate[const last = values[2];
       values[2] = values[1];
       values[1] = values[0];
       values[0] = last;]`,
      ['values[0]', 'values[1]', 'values[2]']
    );
    const [one, two, three] = before.ids;
    expect(after.ids).toEqual([three, one, two]);
    // The temporary, still in scope, is the copy; the rearranged values are the originals.
    expect(Object.values(after.copies)).toEqual([three]);
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
    const [, , aside, back] = identities(
      `@start[const values = Values([5, 2, 4]);]
       @pick[const key = values[1];]
       @shift[values[1] = values[0];]
       @put[values[0] = key;]`,
      ['values[0]', 'key']
    );
    const two = aside.ids[1];
    // The key alone holds the 2, so it moves there; back in the row, the key shows a copy.
    expect(aside.copies).not.toHaveProperty(String(two));
    expect(back.ids[0]).toBe(two);
    expect(back.copies).toEqual({ [back.ids[1]!]: two });
  });
});
