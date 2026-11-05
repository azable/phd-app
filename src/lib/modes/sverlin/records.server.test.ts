import { describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import levelsFixture from './fixtures/merge-sort-levels.sverlin?raw';
import stackFixture from './fixtures/merge-sort-stack.sverlin?raw';

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
          '<View of="@sort" name="CallFrame"><Node>sort {this.lo} to {this.hi}</Node></View>',
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

describe('queries', () => {
  const frame = '<View of="@sort" name="CallFrame"><Node>sort {this.lo} to {this.hi}</Node></View>';

  it('gives the open calls, the call stack, as a list at every step', async () => {
    const source = mergeSort(
      frame,
      '<Select name="stack" from="@sort" where="started <= now and now < ended" order="depth" max="4" />\n<Layout name="Stack" of="stack"><Node layout="column">{#each stack as call}{call}{/each}</Node></Layout>',
      '<Scene name="calls" case="eight" pause="@sort.split"><Stack stack={stack} /></Scene>'
    );
    const prepared = prepareSvelteComponent(source);
    const { labels } = await bundlePresentation(prepared, 1);
    expect(labels.slice(0, 4)).toEqual([
      ':before',
      '@sort.split#1',
      '@sort.split#2',
      '@sort.split#3'
    ]);
    // At the third split, the calls on 0–8, 0–4 and 0–2 are open, outermost first.
    const third = prepared.master.find(({ name }) => name === '@sort.split#3')!;
    const stack = third.state.stack as { lo: number; hi: number }[];
    expect(stack.map(({ lo, hi }) => `${lo}-${hi}`)).toEqual(['0-8', '0-4', '0-2']);
  });

  it("names each listed call's caller as parent, its position in the list, for a tree of calls", () => {
    const source = mergeSort(
      frame,
      '<Select name="calls" from="@sort" where="started <= now" order="started" max="15" />\n<Layout name="Tree" of="calls"><Node><Node kind="Calls" layout="free">{#each calls as call, k}{call}<Link from={call.parent} to={k} />{/each}</Node></Node></Layout>',
      '<Scene name="calls" case="eight" pause="@sort:before, @sort"><Tree calls={calls} /></Scene>'
    );
    const prepared = prepareSvelteComponent(source);
    const calls = prepared.master.at(-1)!.state.calls as { lo: number; parent?: number }[];
    expect(calls).toHaveLength(15);
    // The whole has no caller; each half's caller is the whole; a quarter's, its half.
    expect(calls.map(({ parent }) => parent ?? '-').slice(0, 4)).toEqual(['-', 0, 1, 2]);
    expect(calls.filter(({ parent }) => parent === 0).map(({ lo }) => lo)).toEqual([0, 4]);
  });

  it('builds the merge sort call stack fixture, the stack growing and shrinking', async () => {
    const prepared = prepareSvelteComponent(stackFixture);
    const { labels } = await bundlePresentation(prepared, 1);
    expect(labels.length).toBeGreaterThan(10);
    const depths = prepared.master
      .filter(({ name }) => name?.startsWith('@sort.merge#'))
      .map(({ state }) => (state.stack as unknown[]).length);
    expect(Math.max(...depths)).toBe(3);
  });

  it('steps over the levels of merge sort, one group of calls by depth a step', async () => {
    const prepared = prepareSvelteComponent(levelsFixture);
    const { labels, leftOut, layout } = await bundlePresentation(prepared, 1);
    expect(labels).toEqual(['level#1', 'level#2', 'level#3', 'level#4']);
    // A view of a span reads its fields through this, never the algorithm's variables of those
    // names, out of scope as the case ends: nothing is left out, and each level draws its own.
    expect(leftOut).toEqual([]);
    expect(new Set(layout.drawn).size).toBe(4);
    // Each level's calls, by where they start: the whole, the halves, the quarters, the pairs.
    const { steps } = prepared.paced(new Set(), undefined, 'eight', {
      list: 'levels',
      item: 'level'
    });
    expect(
      steps.map(({ state }) => (state.level as { lo: number }[]).map(({ lo }) => lo).join(' '))
    ).toEqual(['0', '0 4', '0 2 4 6', '0 1 2 3 4 5 6 7']);
  });

  it('refuses a scene over a list that also pauses, or passes a live variable', () => {
    expect(
      problemOf(
        levelsFixture.replace('over={levels} as="level"', 'over={levels} as="level" pause="@sort"')
      )
    ).toContain('steps through the case');
    expect(
      problemOf(
        levelsFixture
          .replace('<Layout name="Level" of="level">', '<Layout name="Level" of="level, values">')
          .replace(
            '{#each level as call}{call}{/each}',
            '{#each level as call}{call}{/each}{values}'
          )
          .replace('<Level level={level} />', '<Level level={level} values={values} />')
      )
    ).toContain('reads only levels and level');
  });

  it.each([
    ['JavaScript operators', 'where="started <= now && now < ended"', "SQL's words"],
    ['a missing bound', '', 'needs a bound on its rows'],
    ['an unknown attribute', 'limit="3"', 'takes name, from, where, order, group and max']
  ])('refuses %s', (_, attributes, message) => {
    const tag = `<Select name="stack" from="@sort" ${attributes} ${attributes.startsWith('where') ? 'max="4"' : ''} />`;
    expect(problemOf(stackFixture.replace(/<Select[\s\S]*?\/>/u, tag))).toContain(message);
  });
});
