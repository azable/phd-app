import { describe, expect, it } from 'vitest';

import { labelMarks, labelOpenings } from './label-marks';

const marked = (source: string) => labelMarks(source).map(([from, to]) => source.slice(from, to));

describe('label marks', () => {
  it('find a span’s name and closing ], and a block’s name, in the algorithm', () => {
    const source = `<script lang="sverlin">
  for (let i = 0; i < 3; i++) @pass{
    @set[values[i] = '@x[';] // @y[
  }
</script>`;
    expect(marked(source)).toEqual(['@pass', '@set[', ']']);
  });

  it('find them in a listing, its text read as text, and nowhere else', () => {
    const source = `<script lang="sverlin" listing="textbook">
  if @check[A[i] == "it's"]
</script>
<Node>{@render Int(v)} @a[</Node>`;
    expect(marked(source)).toEqual(['@check[', ']']);
  });

  it('names each label of the algorithm in full where it opens, a label inside another after it', () => {
    const source = `<script lang="sverlin">
  for (let i = 0; i < 3; i++) @insert{
    if (x[0]) { @shift[values[i] = x[@left[i]];] }
    @place[values[i] = key;] // @not[
  }
  @done[n = 1;]
</script>
<script lang="sverlin" listing="textbook">@insert[A[i]]</script>`;
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
});
