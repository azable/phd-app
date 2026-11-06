import { describe, expect, it } from 'vitest';

import { listingMapsOf, prepareSvelteComponent } from '../compile.server';
import { bundlePresentation } from '../testing/scenes';
import { readRegions } from './mapped.server';

const blocks = (algorithm: string, listing: string) => `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Position = index(Values);
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[2, 1]} />
<script algorithm>
${algorithm}
</script>
<script listing="textbook">
${listing}
</script>
<Layout name="Cells" of="values"><Node>{#each values as v}<Node value={v} />{/each}</Node></Layout>
<Layout name="Main" of="values">
  <Node>
    <Listing />
    <Cells values={values} />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} /></Scene>
</Storyboard>`;

const insertion = blocks(
  `  for (@first[let i = Position(1)]; @more[i < values.length]; @next[i++]) {
    @key[const key = values[i];]
    @init[let j = i;]
    while (@test[@bound[Position(0) < j] && @cmp[values[j - 1] > key]]) {
      @shift[values[j] = values[j - 1];]
      @down[j--;]
    }
    @place[values[j] = key;]
  }`,
  `INSERTION-SORT(A, n)
1  for @first[i = 2] @more[to n] @next[step 1]
2      @key[key = A[i]]
3      // Insert A[i] into the sorted part.
4      @init[j = i - 1]
5      while @test[@bound[j > 0] and @cmp[A[j] > key]]
6          @shift[A[j + 1] = A[j]]
7          @down[j = j - 1]
8      @place[A[j + 1] = key]`
);

describe('listings of the source’s own', () => {
  it('refuse an HTML escape, which would show as written', () => {
    const { problems } = readRegions('while @test[j &gt; 0]');
    expect(problems.map(({ message }) => message)).toEqual([
      'The listing writes &gt;, which shows as it is written: write > itself; a listing needs no escaping.'
    ]);
  });

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

  it('show no blank line for a line of marks alone, its openings joining the next line', () => {
    const { text, regions } = readRegions(
      'if A[mid] < target\n    @right[@recurse[\n        return mid\n    ]]\nelse'
    );
    expect(text).toBe('if A[mid] < target\n    return mid\nelse');
    expect(regions.map(({ label, start, end }) => [label, text.slice(start, end)])).toEqual([
      ['right', 'return mid'],
      ['right.recurse', 'return mid']
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
    const pauses = new Set(['shift', 'place', 'test']);
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
      'a short name that more than one label has',
      '  for (@first[let i = Position(0)]; @more[i < values.length]; @next[i++]) @pass{\n    @look[const v = values[i];]\n  }\n  for (@again[let k = Position(0)]; @still[k < values.length]; @step[k++]) @back{\n    @look[const w = values[k];]\n  }',
      'for @first[i] @more[i] @next[i] @look[v] for @again[k] @still[k] @step[k] @back[w]',
      "The listing's region @look could be @pass.look or @back.look: write the full name of the one it marks, as @pass.look[…]."
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

  it.each([
    ['by its full name', '@first[i] @more[n] @next[i] @pass.look[v = A[i]]'],
    ['by its short name, the only label with it', '@first[i] @more[n] @next[i] @look[v = A[i]]'],
    [
      'nested in the regions of the labels around it',
      '@first[i] @more[n] @next[i] @pass[@look[v = A[i]]]'
    ],
    [
      "marked inside its body's label, a for header's parts",
      '@pass[for @first[i] @more[n] @next[i] @look[v = A[i]]]'
    ]
  ])('name a label %s', (_, listing) => {
    const algorithm =
      '  for (@first[let i = Position(0)]; @more[i < values.length]; @next[i++]) @pass{\n    @look[const v = values[i];]\n  }';
    const maps = listingMapsOf(blocks(algorithm, listing));
    expect(maps?.textbook.map(({ label }) => label)).toEqual(
      expect.arrayContaining(['first', 'more', 'next', 'pass.look'])
    );
  });

  it("tell a listing's problems with those of an earlier stage, as the algorithm failing to run", () => {
    let messages: string[] = [];
    try {
      prepareSvelteComponent(blocks('  @size[const n = missing;]', '@size[n] @spare[m]'));
    } catch (cause) {
      const error = cause as Error & { others: Error[] };
      messages = [error, ...error.others].map(({ message }) => message);
    }
    expect(messages).toEqual([
      expect.stringContaining('"missing" is not defined'),
      expect.stringContaining("The listing's region @spare is labelled on no code")
    ]);
  });

  it('warn of a label a scene pauses at with no region, which would light nothing, and of no other', async () => {
    const source = blocks('  @size[const n = Int(@more[1]);]', '@size[n]');
    const warned = await bundlePresentation(
      prepareSvelteComponent(source.replace('case="main">', 'case="main" pause="@size.more">')),
      1,
      {}
    );
    expect(warned.warnings).toContain(
      'The step @size.more lights nothing in the listing: mark the text its code shows as @more[…] inside @size, as A[@left[j - 1]] marks the j - 1 of A[j - 1].'
    );
    const unpaused = await bundlePresentation(prepareSvelteComponent(source), 1, {});
    expect(unpaused.warnings ?? []).not.toContainEqual(expect.stringContaining('lights nothing'));
  });

  it('tell the assistant what each region is mapped to, and whether a step lights it', () => {
    const maps = listingMapsOf(insertion);
    expect(maps?.textbook.find(({ label }) => label === 'test.cmp')).toEqual({
      label: 'test.cmp',
      text: 'A[j] > key',
      sources: [{ text: 'values[j - 1] > key', line: 13 }],
      lit: true
    });
    expect(maps?.textbook.find(({ label }) => label === 'place')?.sources).toEqual([
      { text: 'values[j] = key;', line: 17 }
    ]);
  });
});
