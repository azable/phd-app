import { describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';

/** Merge sort, its calls drawn by a view of the function's label, and a layout. */
export const mergeSort = (
  views: string,
  layout: string,
  storyboard: string
): string => `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
  const from = Values;
</script>
<script algorithm>
  function sort(a, b, lo, hi) @sort{
    if (@base[hi - lo < 2]) @single[return;]
    @split[const mid = Index(a, Math.floor((lo + hi) / 2));]
    @halves[sort(a, b, lo, mid); sort(a, b, mid, hi);]
    @merge[
      for (@copyStart[let c = lo]; @copyMore[c < hi]; @copyNext[c++]) @copy{
        b[c] = a[c];
      }
      @ends[let i = Index(b, lo); let j = Index(b, mid);]
      for (@start[let k = lo]; @more[k < hi]; @next[k++]) @take{
        if (@left[i < mid && (j >= hi || b[i] <= b[j])]) {
          a[k] = b[i];
          i++;
        } else {
          a[k] = b[j];
          j++;
        }
      }
    ]
  }
  @run[sort(values, from, Index(values, 0), values.length);]
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Mark"><Pointed /></View>
<View of="Index" name="IndexText"><Node value={this} /></View>
${views}
${layout}
<Case name="eight" values={[7, 3, 8, 2, 6, 1, 5, 4]} from={[0, 0, 0, 0, 0, 0, 0, 0]} />
<Storyboard>
${storyboard}
</Storyboard>`;

const problemOf = (source: string) => {
  try {
    prepareSvelteComponent(source);
  } catch (cause) {
    const error = cause as Error & { others?: Error[] };
    return [error, ...(error.others ?? [])].map(({ message }) => message).join('\n');
  }
  return '';
};

describe('records of spans', () => {
  it("draws a block label's span with a view of the label, the variables in scope as it ends", async () => {
    const { labels } = await bundlePresentation(
      prepareSvelteComponent(
        mergeSort(
          '<View of="@sort" name="CallFrame"><Node layout="row">sort {this.lo} to {this.hi}</Node></View>',
          '<Layout name="Arrays" of="values, @sort"><Node layout="column">{values}{@sort}</Node></Layout>',
          '<Scene name="sort" case="eight" pause="@sort"><Arrays values={values} /></Scene>'
        )
      ),
      1
    );
    expect(labels.slice(0, 3)).toEqual([':before', '@sort#4', '@sort#5']);
  });

  it('refuses a field that is never in scope at the label', () => {
    expect(
      problemOf(
        mergeSort(
          '<View of="@sort" name="CallFrame"><Node>{this.missing}</Node></View>',
          '<Layout name="Arrays" of="values, @sort"><Node layout="column">{values}{@sort}</Node></Layout>',
          '<Scene name="sort" case="eight" pause="@sort"><Arrays values={values} /></Scene>'
        )
      )
    ).toMatch(/missing/u);
  });
});
