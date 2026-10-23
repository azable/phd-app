import { describe, expect, it } from 'vitest';

import { listingMapsOf, prepareSvelteComponent } from '../compile.server';
import { readRegions } from './mapped.server';

const blocks = (algorithm: string, listing: string) => `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Swap = operation({ a: Position, b: Position }, ({ a, b }) => {
    const moved = a.value;
    a.value = b.value;
    b.value = moved;
  });
</script>
<script lang="sverlin" input>
  const values = Values([2, 1]);
</script>
<script lang="sverlin">
${algorithm}
</script>
<script lang="sverlin" listing="textbook">
${listing}
</script>
<Node layout="row"><Listing /><Node>{#each values as v}<Node value={v} />{/each}</Node></Node>`;

const insertion = blocks(
  `  for (let i = Position(1); i < values.length; i++) { // @outer
    const key = values[i]; // @key
    let j = i; // @init
    while (j > 0 && values[j - 1] > key) { // @test; bound: j > 0; cmp: values[j - 1] > key
      values[j] = values[j - 1]; // @shift
      j--; // @down
    }
    // @place
    values[j] = key;
    yield;
  }`,
  `INSERTION-SORT(A, n)
1  for [outer: i = 2 to n]
2      [key: key = A[i]]
3      // Insert A[i] into the sorted part.
4      [init: j = i - 1]
5      while [test: [bound: j > 0] and [cmp: A[j] > key]]
6          [shift: A[j + 1] = A[j]]
7          [down: j = j - 1]
8      [place: A[j + 1] = key]`
);

describe('listings of the source’s own', () => {
  it('show their text without region marks, a [ that opens none staying text', () => {
    const { text, regions } = readRegions('  x = [first: A[i]] + [second: [inner: B]]');
    expect(text).toBe('x = A[i] + B');
    expect(regions.map(({ label, start, end }) => [label, text.slice(start, end)])).toEqual([
      ['first', 'A[i]'],
      ['second', 'B'],
      ['inner', 'B']
    ]);
  });

  it('light each region where the algorithm runs the code with its label, parts of a line apart', () => {
    const prepared = prepareSvelteComponent(insertion);
    expect(prepared.design.starter['listing.language']).toBe('textbook');
    expect(prepared.design.space['listing.language']).toEqual([
      'textbook',
      'python',
      'pseudocode',
      'javascript',
      'none'
    ]);
    const { text, lit } = prepared.listings!.textbook;
    expect(text.split('\n')[5]).toBe('5      while j > 0 and A[j] > key');
    const shown = lit.yield.map(({ current, earlier }) => ({
      current: current.map(([start, end]) => text.slice(start, end)),
      earlier: earlier.map(([start, end]) => text.slice(start, end))
    }));
    // [2, 1]: the 1 shifts once, then j reaches 0 and the comparison never runs.
    expect(shown[0].current).toEqual(['A[j + 1] = key']);
    expect(shown[0].earlier).toEqual(
      expect.arrayContaining(['j > 0 and A[j] > key', 'A[j + 1] = A[j]', 'j = j - 1'])
    );
  });

  it('light the bound alone where the comparison never runs', () => {
    // A step inside the loop, so the next holds only the test that fails at j = 0.
    const prepared = prepareSvelteComponent(
      insertion
        .replace('      j--; // @down', '      j--; // @down\n      yield;')
        .replace('    // @place', '    yield;\n    // @place')
    );
    const { text, lit } = prepared.listings!.textbook;
    const leaving = lit.yield[1];
    expect(leaving.current.map(([start, end]) => text.slice(start, end))).toEqual(['j > 0 and']);
    expect(leaving.earlier.map(([start, end]) => text.slice(start, end))).not.toContain(
      'A[j] > key'
    );
  });

  it('label calls of an operation by its name', () => {
    const source = blocks(
      `  if (values[1] < values[0]) Swap({ a: Position(0), b: Position(1) }); // @check
  yield;`,
      `[check: if A[2] < A[1]] then [Swap: exchange A[1] with A[2]]`
    );
    const { text, lit } = prepareSvelteComponent(source).listings!.textbook;
    expect(lit.yield[0].current.map(([start, end]) => text.slice(start, end))).toEqual([
      'exchange A[1] with A[2]'
    ]);
  });

  it.each([
    [
      'a label with no region',
      '  const n = Int(1); // @count\n  yield;',
      '[size: n]',
      'The algorithm labels code count, but the listing has no region [count: …].'
    ],
    [
      'a region labelled on no code',
      '  const n = Int(1); // @size\n  yield;',
      '[size: n] [spare: m]',
      'The listing’s region [spare: …] is labelled on no code'.replace('’', "'")
    ],
    [
      'a part that matches nothing',
      '  const n = Int(1 + 1); // @size; sum: 2 + 2\n  yield;',
      '[size: n] [sum: 1 + 1]',
      'sum: 2 + 2 matches no part of its line, which reads const n = Int(1 + 1);'
    ],
    [
      'a part that matches twice',
      '  const n = Int(1 + 1); // @size; one: 1\n  yield;',
      '[size: n] [one: 1]',
      'one: 1 matches 2 parts of its line; name one, as one: 1#2.'
    ],
    [
      'a listing named as the library’s',
      '  const n = Int(1); // @size\n  yield;',
      '[size: n]',
      'A listing cannot be named python'
    ]
  ])('reject %s', (name, algorithm, listing, message) => {
    let source = blocks(algorithm, listing);
    if (name.includes('library')) source = source.replace('listing="textbook"', 'listing="python"');
    expect(() => prepareSvelteComponent(source)).toThrow(message);
  });

  it('tell the assistant what each region is mapped to, and whether a step lights it', () => {
    const maps = listingMapsOf(insertion);
    expect(maps?.textbook.find(({ label }) => label === 'cmp')).toEqual({
      label: 'cmp',
      text: 'A[j] > key',
      sources: [{ text: 'values[j - 1] > key', line: 18 }],
      lit: true
    });
    expect(maps?.textbook.find(({ label }) => label === 'place')?.sources).toEqual([
      { text: 'values[j] = key;', line: 23 }
    ]);
  });
});
