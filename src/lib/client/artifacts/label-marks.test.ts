import { describe, expect, it } from 'vitest';

import { labelAt, labelHighlights, labelMarks, labelOpenings, labelRegions } from './label-marks';

const marked = (source: string) => labelMarks(source).map(([from, to]) => source.slice(from, to));

describe('label marks', () => {
  it('find a span’s name and closing ], and a block’s name, in the algorithm', () => {
    const source = `<script algorithm>
  for (let i = 0; i < 3; i++) @pass{
    @set[values[i] = '@x[';] // @y[
  }
</script>`;
    expect(marked(source)).toEqual(['@pass', '@set[', ']']);
  });

  it('find them in a listing, its text read as text, and nowhere else', () => {
    const source = `<script listing="textbook">
  if @check[A[i] == "it's"]
</script>
<Node>{@render Int(v)} @a[</Node>`;
    expect(marked(source)).toEqual(['@check[', ']']);
  });

  it('names each label of the algorithm in full where it opens, a label inside another after it', () => {
    const source = `<script algorithm>
  for (let i = 0; i < 3; i++) @insert{
    if (x[0]) { @shift[values[i] = x[@left[i]];] }
    @place[values[i] = key;] // @not[
  }
  @done[n = 1;]
</script>
<script listing="textbook">@insert[A[i]]</script>`;
    expect(
      labelOpenings(source).map(({ from, to, full }) => [source.slice(from, to), full])
    ).toEqual([
      ['@insert', 'insert'],
      ['@shift', 'insert.shift'],
      ['@left', 'insert.shift.left'],
      ['@place', 'insert.place'],
      ['@done', 'done']
    ]);
  });

  const hovered = `<script algorithm>
  function sort(a, lo, hi) @sort{
    @merge[
      @copy[from = a;]
      for (let k = 0; k < 2; k++) @take{ a[k] = from[k]; }
    ]
  }
</script>
<script listing="c">@merge[merge(a);]</script>
<When of="@sort.merge"><Node>{@render Int(@sort.merge.take)}</Node></When>`;
  const regions = labelRegions(hovered);
  const slices = (ranges: { from: number; to: number }[]) =>
    ranges.map(({ from, to }) => hovered.slice(from, to));

  it('find each label’s region, to its ] or its block’s }, in the algorithm and a listing', () => {
    expect(regions.map(({ full, from, end }) => [full, hovered.slice(from, end)])).toEqual([
      ['sort', hovered.slice(hovered.indexOf('@sort{'), hovered.indexOf('\n</script>'))],
      ['sort.merge', hovered.slice(hovered.indexOf('@merge['), hovered.indexOf(']\n  }') + 1)],
      ['sort.merge.copy', '@copy[from = a;]'],
      ['sort.merge.take', '@take{ a[k] = from[k]; }'],
      ['merge', '@merge[merge(a);]']
    ]);
  });

  it('name the label under a position, where it opens or where it is read by its full name', () => {
    expect(labelAt(hovered, regions, hovered.indexOf('@take') + 2)).toBe('sort.merge.take');
    expect(labelAt(hovered, regions, hovered.indexOf('@sort.merge"') + 3)).toBe('sort.merge');
    expect(labelAt(hovered, regions, hovered.indexOf('@render') + 2)).toBeUndefined();
    expect(labelAt(hovered, regions, hovered.indexOf('from = a'))).toBeUndefined();
  });

  it('highlight every place a full name is written and the code its openings mark, not longer names', () => {
    const found = labelHighlights(hovered, regions, 'sort.merge');
    expect(slices(found.names)).toEqual(['@merge', '@sort.merge']);
    expect(slices(found.regions)).toEqual([
      hovered.slice(hovered.indexOf('@merge['), hovered.indexOf(']\n  }') + 1)
    ]);
  });
});
