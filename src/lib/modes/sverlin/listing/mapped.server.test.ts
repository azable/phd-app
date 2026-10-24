import { describe, expect, it } from 'vitest';

import { listingMapsOf, prepareSvelteComponent } from '../compile.server';
import { readRegions } from './mapped.server';

const blocks = (algorithm: string, listing: string) => `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Flag = type('boolean');
  const Length = unop((v: Values) => Position(v.length));
  const Before = binop((a: Position, b: Position) => Flag(a < b));
  const Next = unop((p: Position) => Position(p + 1));
  const Prev = unop((p: Position) => Position(p - 1));
  const Greater = binop((a: Int, b: Int) => Flag(a > b));
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
  `  for (let i = Position(1); Before(i, Length(values)); i = Next(i)) {
    @key[const key = values[i];]
    @init[let j = i;]
    while (@test[@bound[Before(Position(0), j)] && @cmp[Greater(values[Prev(j)], key)]]) {
      @shift[values[j] = values[Prev(j)];]
      @down[j = Prev(j);]
    }
    @place[values[j] = key;]
  }`,
  `INSERTION-SORT(A, n)
1  for i = 2 to n
2      @key[key = A[i]]
3      // Insert A[i] into the sorted part.
4      @init[j = i - 1]
5      while @test[@bound[j > 0] and @cmp[A[j] > key]]
6          @shift[A[j + 1] = A[j]]
7          @down[j = j - 1]
8      @place[A[j + 1] = key]`
);

describe('listings of the source’s own', () => {
  it('show their text without region marks, a [ that opens none staying text', () => {
    const { text, regions } = readRegions('  x = @first[A[i]] + @second[@inner[B]]');
    expect(text).toBe('x = A[i] + B');
    // A region inside another takes its name as a prefix.
    expect(regions.map(({ label, start, end }) => [label, text.slice(start, end)])).toEqual([
      ['first', 'A[i]'],
      ['second', 'B'],
      ['second.inner', 'B']
    ]);
  });

  it('light each region where the algorithm runs the code with its label, parts of a line apart', () => {
    const prepared = prepareSvelteComponent(insertion);
    expect(prepared.design.starter['listing.language']).toBe('textbook');
    expect(prepared.design.space['listing.language']).toEqual(['textbook', 'none']);
    const { text, lit } = prepared.listings!.textbook;
    expect(text.split('\n')[5]).toBe('5      while j > 0 and A[j] > key');
    // Stepping by place, each step leads up to placing the key and then places it.
    const shown = lit.place.map(({ current, earlier }) => ({
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
    // Stepping by down, the last step leads up from it: the test that fails at j = 0, its
    // comparison never run, then placing the key.
    const { text, lit } = prepareSvelteComponent(insertion).listings!.textbook;
    const leaving = lit.down.at(-1)!;
    const earlier = leaving.earlier.map(([start, end]) => text.slice(start, end));
    expect(earlier).toContain('j > 0 and');
    expect(earlier).not.toContain('A[j] > key');
  });

  it.each([
    [
      'a region labelled on no code',
      '  @size[const n = Int(1);]',
      '@size[n] @spare[m]',
      "The listing's region @spare is labelled on no code"
    ],
    [
      'a listing named none',
      '  @size[const n = Int(1);]',
      '@size[n]',
      'A listing cannot be named none'
    ]
  ])('reject %s', (name, algorithm, listing, message) => {
    let source = blocks(algorithm, listing);
    if (name.includes('named none'))
      source = source.replace('listing="textbook"', 'listing="none"');
    expect(() => prepareSvelteComponent(source)).toThrow(message);
  });

  it('tell the assistant what each region is mapped to, and whether a step lights it', () => {
    const maps = listingMapsOf(insertion);
    expect(maps?.textbook.find(({ label }) => label === 'test.cmp')).toEqual({
      label: 'test.cmp',
      text: 'A[j] > key',
      sources: [{ text: 'Greater(values[Prev(j)], key)', line: 19 }],
      lit: true
    });
    expect(maps?.textbook.find(({ label }) => label === 'place')?.sources).toEqual([
      { text: 'values[j] = key;', line: 23 }
    ]);
  });
});
