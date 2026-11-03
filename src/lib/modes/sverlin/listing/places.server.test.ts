import { describe, expect, it } from 'vitest';

import { prepareSvelteComponent, shownListing } from '../compile.server';
import { readRegions } from './mapped.server';
import { placePaint, touchedPlaces } from './places.server';

const binarySearch = (listing: string) => `<script domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values([3, 8, 15, 23, 42, 57, 71]);
  const target = Int(42);
</script>
<script algorithm>
  @run[let lo = Index(0);
  let hi = values.length - 1;]
  while (@open[lo < hi]) @probe{
    const mid = @mid[Index(Math.floor((lo + hi) / 2))];
    if (@low[values[mid] < target]) @right[lo = mid + 1;]
    else @left[hi = mid - 1;]
  }
</script>
<script listing="pseudocode">
${listing}
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Index" name="Arrow"><Pointed /></View>
{#snippet Cells()}<Node>{#each values as v}{v}{/each}</Node>{/snippet}
{#snippet Goal()}<Node>target {target}</Node>{/snippet}
<Layout name="Main">
  <Node layout="row">
    <Listing />
    <Node>{@render Goal()}{@render Cells()}</Node>
    {lo}
    {hi}
    {mid}
  </Node>
</Layout>`;

const tokened = `  @run[start:] lo = 0, hi = n - 1
  while @open[$lo[lo] <= $hi[hi]]
    @probe[@mid[$mid[mid] = (lo + hi) / 2]
    if @low[$mid[A[mid]] < $target[target]]
      @right[$lo[lo] = mid + 1]
    else
      @left[$hi[hi] = mid - 1]]`;

const linearSearch = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values([4, 7, 2]);
  const target = Int(7);
</script>
<script algorithm>
  for (@setup[let i = Index(0)]; @guard[i < values.length]; @onward[i++]) @scan{
    @check[if (@cond[values[i] === target]) break;]
  }
</script>
<script listing="pseudocode">
  for @setup[i = 0] @guard[to n - 1] @onward[step 1]
    @scan[@check[if @cond[$i[A[i]] = $target[target]] then return $i[i]]]
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Index" name="Mark"><Pointed /></View>
{#snippet Goal()}<Node>target {target}</Node>{/snippet}
{#snippet Cells()}<Node>{#each values as v}{v}{/each}</Node>{/snippet}
<Layout name="Main">
  <Node layout="row">
    <Listing />
    <Node>{@render Goal()}{@render Cells()}</Node>
    {i}
  </Node>
</Layout>`;

/** Each step's touched places, as the starter shows them, pausing at the labels given. */
function touched(source: string, pauses: readonly string[]) {
  const prepared = prepareSvelteComponent(source);
  const listing = shownListing(
    prepared,
    prepared.design.starter,
    prepared.paced(new Set(pauses)).lit
  );
  return listing?.places?.touched ?? [];
}

describe('tokens naming places in a listing', () => {
  it('are read as regions of their own, nesting with regions either way', () => {
    const { text, regions, tokens, problems } = readRegions(
      '  @cmp[$x[A[@left[j - 1]]] > $key[key]]'
    );
    expect(problems).toEqual([]);
    expect(text).toBe('A[j - 1] > key');
    expect(tokens.map(({ place, start, end }) => [place, text.slice(start, end)])).toEqual([
      ['@x', 'A[j - 1]'],
      ['@key', 'key']
    ]);
    // A region inside a token keeps the prefix of the region around the token.
    expect(regions.map(({ label }) => label)).toEqual(['cmp', 'cmp.left']);
    const around = readRegions('  $j[@left[j - 1]] and $pair.left[l]');
    expect(around.tokens.map(({ place }) => place)).toEqual(['@j', '@pair.left']);
    expect(around.regions.map(({ label }) => label)).toEqual(['left']);
  });

  it.each([
    ['a token inside a token', '$lo[$hi[hi]]', 'The token $hi[ is inside the token $lo[…]'],
    ['an unclosed token', '$lo[lo', 'The token $lo[ is never closed with ].'],
    [
      'a token naming a place nothing renders',
      '$k[k]',
      'names @k, which the view renders nowhere at its root or in a part: a token names a place a render is written with, as $mid[…] for {mid}, and the places it renders are @hi, @lo, @mid, @target, @v.'
    ]
  ])('refuse %s', (_, token, message) => {
    const listing = tokened.replace('lo = 0', `${token} = 0`);
    expect(() => prepareSvelteComponent(binarySearch(listing))).toThrow(message);
  });

  it('give the design listing.places only where a listing has tokens', () => {
    const { design } = prepareSvelteComponent(binarySearch(tokened));
    expect(design.space['listing.places']).toEqual(['none', 'fill', 'underline', 'outline']);
    expect(design.starter['listing.places']).toBe('fill');
    const plain = prepareSvelteComponent(
      binarySearch(tokened.replace(/\$\w+\[([^\]]*\]?)\]/gu, '$1'))
    );
    expect(plain.listings?.pseudocode.tokens).toBeUndefined();
    expect(plain.design.space['listing.places']).toBeUndefined();
    expect(plain.design.starter['listing.places']).toBeUndefined();
  });

  it('leave a source without tokens as it was', () => {
    const source = binarySearch(tokened.replace(/\$\w+\[([^\]]*\]?)\]/gu, '$1'));
    const prepared = prepareSvelteComponent(source);
    expect(prepared.listings?.pseudocode.text).toBe(
      prepareSvelteComponent(binarySearch(tokened)).listings?.pseudocode.text
    );
    const listing = shownListing(prepared, prepared.design.starter, prepared.paced(new Set()).lit);
    expect(listing && Object.keys(listing)).toEqual(['text', 'regions', 'lit']);
  });

  it('touch a place where a token overlaps the code the step itself ran', () => {
    // Binary search: lo, hi at the test; mid where it is found and where its element is compared
    // with the target.
    const steps = touched(binarySearch(tokened), ['open', 'probe.mid', 'probe.low']);
    expect(steps[0]).toEqual([]);
    expect(steps[1]).toEqual(['@lo', '@hi']);
    expect(steps[2]).toEqual(['@mid']);
    expect(steps[3]).toEqual(['@mid', '@target']);
    // Pausing at the move right, only lo, as the code kept from earlier touches nothing.
    expect(touched(binarySearch(tokened), ['probe.right']).flat()).toEqual(['@lo']);
    // Linear search: the loop variable and its element, and the target.
    expect(touched(linearSearch, ['scan.check'])[1]).toEqual(['@i', '@target']);
  });

  it('light each place in its mark’s fill, or its stroke where the fill is none or white', () => {
    const prepared = prepareSvelteComponent(binarySearch(tokened));
    const values = {
      ...prepared.design.starter,
      'Arrow.Pointed@mid.fill': 'sky-200',
      'IntCell@target.fill': 'white',
      'IntCell@target.stroke': 'violet-500'
    };
    const listing = shownListing(prepared, values, prepared.paced(new Set()).lit);
    expect(listing?.places?.paints).toMatchObject({
      '@mid': 'sky-200',
      '@target': 'violet-500',
      '@lo': prepared.design.starter['Arrow.Pointed.fill']
    });
    expect(listing?.places?.look).toBe('fill');
    // A place's own fill falls back to its kind's.
    expect(
      placePaint(
        '@x',
        { type: 'Int', pointer: false },
        { 'views.Int': 'IntCell', 'IntCell.fill': 'red-200' }
      )
    ).toBe('red-200');
    // listing.places none lights nothing.
    const none = shownListing(
      prepared,
      { ...values, 'listing.places': 'none' },
      prepared.paced(new Set()).lit
    );
    expect(none?.places).toBeUndefined();
  });

  it('touch the loop variables and the key of insertion sort', () => {
    const insertion = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values([5, 2, 4, 1]);
</script>
<script algorithm>
  for (@setup[let i = Position(1)]; @guard[i < values.length]; @onward[i++]) @insert{
    @key[const key = values[i];]
    @init[let j = i;]
    while (@test[@bound[Position(0) < j] && @cmp[(values[j - 1]) > key]]) @shift{
      @copy[values[j] = values[j - 1];]
      @down[j--;]
    }
    @place[values[j] = key;]
  }
</script>
<script listing="textbook">
  for @setup[i = 2] @guard[to n] @onward[step 1]
      @insert[@key[$key[key] = $i[A[i]]]
      @init[j = i - 1]
      while @test[@bound[j > 0] and @cmp[A[j] > $key[key]]]
          @shift[@copy[$j[A[j + 1]] = A[j]]
          @down[j = j - 1]]
      @place[$j[A[j + 1]] = $key[key]]]
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Position" name="Mark"><Pointed /></View>
{#snippet Key()}<Node>key {key}</Node>{/snippet}
{#snippet Cells()}<Node>{#each values as v}{v}{/each}</Node>{/snippet}
<Layout name="Stacked">
  <Node layout="row">
    <Listing />
    <Node layout="column">{@render Key()}{@render Cells()}</Node>
    {i}
    {j}
  </Node>
</Layout>`;
    const steps = touched(insertion, ['insert.key', 'insert.shift.copy', 'insert.place']);
    expect(steps[1]).toEqual(['@key', '@i']);
    expect(steps[2]).toEqual(['@j']);
    expect(steps.at(-1)).toEqual(['@j', '@key']);
  });

  it('touch nothing without lit code', () => {
    expect(
      touchedPlaces([{ place: '@i', start: 0, end: 1 }], [{ current: [], earlier: [[0, 1]] }])
    ).toEqual([[]]);
  });
});
