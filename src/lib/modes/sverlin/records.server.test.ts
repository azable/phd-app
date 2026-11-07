import { describe, expect, it } from 'vitest';

import { prepareSvelteComponent } from './compile.server';
import { bundlePresentation, drawnSteps } from './testing/scenes';
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
<View of="Index" name="IndexText"><Node value={this} /></View>
${views}
${layout}
<Case name="eight" values={[7, 3, 8, 2, 6, 1, 5, 4]} from={[0, 0, 0, 0, 0, 0, 0, 0]} />
<Storyboard>
${storyboard}
</Storyboard>`;

const linkWarnings = (warnings: readonly { message: string }[] = []) =>
  warnings.map(({ message }) => message).filter((message) => message.startsWith('The Link at'));

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
          '<Layout name="Arrays"><Node layout="column">{values}{@sort}</Node></Layout>',
          '<Scene name="sort" case="eight" pause="@sort.end"><Arrays /></Scene>'
        )
      ),
      1
    );
    expect(labels.slice(0, 3)).toEqual(['@case.start', '@sort#4.end', '@sort#5.end']);
  });

  it('refuses a field that is never in scope at the label', () => {
    expect(
      problemOf(
        mergeSort(
          '<View of="@sort" name="CallFrame"><Node>{this.missing}</Node></View>',
          '<Layout name="Arrays"><Node layout="column">{values}{@sort}</Node></Layout>',
          '<Scene name="sort" case="eight" pause="@sort.end"><Arrays /></Scene>'
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
      '<Select name="stack" from="@sort" where="start <= now and now < end" order="depth" max="4" />\n<Layout name="Stack"><Node layout="column">{#each stack as call}{call}{/each}</Node></Layout>',
      '<Scene name="calls" case="eight" pause="@sort.split.end"><Stack /></Scene>'
    );
    const prepared = prepareSvelteComponent(source);
    const { labels } = await bundlePresentation(prepared, 1);
    expect(labels.slice(0, 4)).toEqual([
      '@case.start',
      '@sort.split#1.end',
      '@sort.split#2.end',
      '@sort.split#3.end'
    ]);
    // At the third split, the calls on 0–8, 0–4 and 0–2 are open, outermost first.
    const third = prepared.master.find(({ name }) => name === '@sort.split#3.end')!;
    const stack = third.state.stack as { lo: number; hi: number }[];
    expect(stack.map(({ lo, hi }) => `${lo}-${hi}`)).toEqual(['0-8', '0-4', '0-2']);
  });

  it("names each listed call's caller as parent, its position in the list, for a tree of calls", () => {
    const source = mergeSort(
      frame,
      '<Select name="calls" from="@sort" where="start <= now" order="start" max="15" />\n<Layout name="Tree"><Node><Node kind="Calls" layout="free">{#each calls as call, k}{call}<Link from={call.parent} to={k} />{/each}</Node></Node></Layout>',
      '<Scene name="calls" case="eight" pause="@sort.start, @sort.end"><Tree /></Scene>'
    );
    const prepared = prepareSvelteComponent(source);
    const calls = prepared.master.at(-1)!.state.calls as { lo: number; parent?: number }[];
    expect(calls).toHaveLength(15);
    // The whole has no caller; each half's caller is the whole; a quarter's, its half.
    expect(calls.map(({ parent }) => parent ?? '-').slice(0, 4)).toEqual(['-', 0, 1, 2]);
    expect(calls.filter(({ parent }) => parent === 0).map(({ lo }) => lo)).toEqual([0, 4]);
  });

  it("links a row's position to the element it points at, through a recursive call's parameter", async () => {
    const source = mergeSort(
      '<View of="@sort" name="CallFrame"><Node>sort {this.lo} to {this.hi}<Link to={this.lo} /></Node></View>',
      '<Select name="stack" from="@sort" where="start <= now and now < end" order="depth" max="4" />\n<Layout name="Stack"><Node><Node kind="Calls" layout="free">{#each values as v}{v}{/each}{#each stack as call}{call}{/each}</Node></Node></Layout>',
      '<Scene name="calls" case="eight" pause="@sort.split.end"><Stack /></Scene>'
    );
    const { steps, built } = await drawnSteps(source);
    const prepared = prepareSvelteComponent(source);
    // Each open call, its a the caller's values or a parameter passed down, reaches values[lo].
    const reached = steps.map(({ links }) => links.map(({ to }) => to).toSorted());
    const expected = built.labels.map((name) => {
      const step = prepared.master.find((each) => each.name === name)!;
      const stack = (step.state.stack ?? []) as { lo: number }[];
      return stack.map(({ lo }) => `values[${lo}]`).toSorted();
    });
    expect(expected.slice(0, 4)).toEqual([
      [],
      ['values[0]'],
      ['values[0]', 'values[0]'],
      ['values[0]', 'values[0]', 'values[0]']
    ]);
    expect(reached).toEqual(expected);
    expect(expected.flat()).toContain('values[4]');
    expect(linkWarnings(built.warnings)).toEqual([]);
  });

  it('warns of a link drawn nowhere: from no free layout, or to a number pointing nowhere', async () => {
    const calls = (link: string, layout: string) =>
      mergeSort(
        `<View of="@sort" name="CallFrame"><Node>sort {this.lo} to {this.hi}${link}</Node></View>`,
        `<Select name="stack" from="@sort" where="start <= now and now < end" order="depth" max="4" />\n<Layout name="Stack">${layout}</Layout>`,
        '<Scene name="calls" case="eight" pause="@sort.split.end"><Stack /></Scene>'
      );
    const column = '<Node layout="column">{values}{#each stack as call}{call}{/each}</Node>';
    const free =
      '<Node><Node kind="Calls" layout="free">{#each values as v}{v}{/each}{#each stack as call}{call}{/each}</Node></Node>';
    // The rows in a column, values beside them: no layout lays out a link from a row.
    const outside = await drawnSteps(calls('<Link to={this.lo} />', column));
    expect(outside.steps.flatMap(({ links }) => links)).toEqual([]);
    expect(linkWarnings(outside.built.warnings)).toEqual([
      'The Link at 36:68 in CallFrame has no from, so it starts at the element its view draws, and only a free layout holding that element and what it reaches lays such a link out: it is in none, so it is drawn nowhere. Put both in a node with layout free.'
    ]);
    // A from written, as a call's parent, is none only where the value is none, as the first call's.
    const tree = await drawnSteps(
      mergeSort(
        frame,
        '<Select name="calls" from="@sort" where="start <= now" order="start" max="15" />\n<Layout name="Tree"><Node><Node kind="Calls" layout="column">{#each calls as call, k}{call}<Link from={call.parent} to={k} />{/each}</Node></Node></Layout>',
        '<Scene name="calls" case="eight" pause="@sort.start, @sort.end"><Tree /></Scene>'
      )
    );
    expect(tree.steps.flatMap(({ links }) => links).length).toBeGreaterThan(0);
    expect(linkWarnings(tree.built.warnings)).toEqual([]);
    // A value of the array is no position.
    const value = await drawnSteps(calls('<Link to={this.a[0]} />', free));
    expect(value.steps.flatMap(({ links }) => links)).toEqual([]);
    expect(linkWarnings(value.built.warnings)).toEqual([
      "The Link at 36:68 in CallFrame has to = Int, a number pointing into no collection, so it names no element and is drawn nowhere: a link's end is a position, as Index(values, i), or a reference."
    ]);
  });

  it("points a call's result where the call's variables point, as the caller's values for a", () => {
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
</script>
<script algorithm>
  function half(a, lo, hi) @half{
    if (@base[hi - lo < 2]) @single[return Index(a, lo);]
    @rest[return half(a, lo, Index(a, Math.floor((lo + hi) / 2)));]
  }
  @run[const found = half(values, Index(values, 0), values.length);]
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="@half" name="Call"><Node>half<Link to={this.lo} /></Node></View>
<Select name="calls" from="@half" where="end <= now" order="start" max="4" />
<Layout name="Main"><Node><Node kind="Calls" layout="free">{#each values as v}{v}{/each}{#each calls as call}{call}{/each}</Node></Node></Layout>
<Case name="main" values={[4, 8, 2, 6]} />
<Storyboard>
  <Scene name="calls" case="main" pause="@half.end"><Main /></Scene>
</Storyboard>`;
    const last = prepareSvelteComponent(source).master.at(-1)!;
    const results = Object.entries(last.targets ?? {}).filter(([path]) => path.endsWith('.result'));
    expect(results).toEqual([
      ['calls[0].result', 'values'],
      ['calls[1].result', 'values'],
      ['calls[2].result', 'values']
    ]);
  });

  it("links a row's position to the element it points at, in a loop outside any call", async () => {
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 5 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
</script>
<script algorithm>
  for (@start[let i = Index(values, 0)]; @more[i < values.length]; @next[i++]) @visit{
    values[i] = values[i] + 1;
  }
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="@visit" name="Visit"><Node>visit<Link to={this.i} /></Node></View>
<Select name="visited" from="@visit" where="end <= now" order="start" max="5" />
<Layout name="Main"><Node><Node kind="Visits" layout="free">{#each values as v}{v}{/each}{#each visited as each}{each}{/each}</Node></Node></Layout>
<Case name="main" values={[4, 8, 2]} />
<Storyboard>
  <Scene name="scan" case="main" pause="@visit.end"><Main /></Scene>
</Storyboard>`;
    const { steps } = await drawnSteps(source);
    expect(steps.map(({ links }) => links.map(({ to }) => to))).toEqual([
      [],
      ['values[0]'],
      ['values[0]', 'values[1]'],
      ['values[0]', 'values[1]', 'values[2]']
    ]);
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
        levelsFixture.replace(
          'over={levels} as="level"',
          'over={levels} as="level" pause="@sort.end"'
        )
      )
    ).toContain('steps through the case');
    expect(
      problemOf(
        levelsFixture
          .replace('<Layout name="Level">', '<Layout name="Level">')
          .replace(
            '{#each level as call}{call}{/each}',
            '{#each level as call}{call}{/each}{values}'
          )
          .replace('<Level />', '<Level />')
      )
    ).toContain('reads only levels and level');
  });

  it.each([
    ['JavaScript operators', 'where="start <= now && now < end"', "SQL's words"],
    ['a missing bound', '', 'needs a bound on its rows'],
    ['an unknown attribute', 'limit="3"', 'takes name, from, where, order, group and max']
  ])('refuses %s', (_, attributes, message) => {
    const tag = `<Select name="stack" from="@sort" ${attributes} ${attributes.startsWith('where') ? 'max="4"' : ''} />`;
    expect(problemOf(stackFixture.replace(/<Select[\s\S]*?\/>/u, tag))).toContain(message);
  });
});
