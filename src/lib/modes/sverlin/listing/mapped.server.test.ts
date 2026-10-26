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
{#snippet Cells()}<Node>{#each values as v}<Node value={v} />{/each}</Node>{/snippet}
<Listing />
{@render Cells()}`;

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
    const { text } = prepared.listings!.textbook;
    const lit = prepared.paced(new Set(['shift', 'place'])).lit.textbook;
    expect(text.split('\n')[5]).toBe('5      while j > 0 and A[j] > key');
    // Pausing at the shift and the placing.
    const shown = lit.map(({ current, earlier }) => ({
      current: current.map(([start, end]) => text.slice(start, end)),
      earlier: earlier.map(([start, end]) => text.slice(start, end))
    }));
    // [2, 1]: the 2 shifts once, then j reaches 0 and the comparison never runs.
    // Step 0, the input as given, lights nothing.
    expect(shown[0]).toEqual({ current: [], earlier: [] });
    // Only the shift lights, not the code leading up to it, as no step pauses there.
    expect(shown[1]).toEqual({ current: ['A[j + 1] = A[j]'], earlier: [] });
    expect(shown[2].current).toEqual(['A[j + 1] = key']);
  });

  it('light the bound alone where the comparison never runs', () => {
    // Paused at the test too: after the shift, j moves to 0, and the test fails on its bound, its
    // comparison never run.
    const prepared = prepareSvelteComponent(insertion);
    const { text } = prepared.listings!.textbook;
    const pauses = new Map(['shift', 'place', 'test'].map((label) => [label, 'on'] as const));
    const tests = prepared
      .paced(pauses)
      .lit.textbook.map(({ current }) => current.map(([start, end]) => text.slice(start, end)))
      .filter((current) => current.some((piece) => piece.startsWith('j > 0')));
    expect(tests.at(-1)).toEqual(['j > 0 and']);
  });

  it.each([
    [
      'a region labelled on no code',
      '  @size[const n = Int(1);]',
      '@size[n] @spare[m]',
      "The listing's region @spare is labelled on no code"
    ],
    [
      'a region with a dotted name',
      '  @size[const n = Int(1);]',
      '@size[n] @size.inner[m]',
      'The region @size.inner[ has a dotted name: a region takes one name and nests inside the one around it, as @size[… @inner[…]].'
    ],
    [
      'a label with no region, where a pause there would light nothing',
      '  @size[const n = Int(@more[1]);]',
      '@size[n]',
      'The label @size.more has no region in the listing, where the page lights it when it pauses there; mark the text its code shows as @more[…] inside @size, as A[@left[j - 1]] marks the j - 1 of A[j - 1].'
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
