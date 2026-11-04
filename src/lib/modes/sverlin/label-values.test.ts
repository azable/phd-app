import { describe, expect, it } from 'vitest';

import { traceAlgorithm, interpretDomain, interpretInput } from './algorithm/interpret.server';
import { compileSvelteComponent, prepareSvelteComponent } from './compile.server';
import { markLabels, viewTags, whenTags } from './label-values';

const domain = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int, { max: 8 });
  const Index = index(Values);
</script>
<script input>
  const values = Values([5, 2, 8, 1]);
  const target = Int(8);
</script>`;

const insertion = `
<script algorithm>
  for (@setup[let i = Index(1)]; @guard[i < values.length]; @onward[i++]) @insert{
    const key = @key[values[i]];
    let j = i;
    while (@guard[(Index(0) < j) && ((values[j - 1]) > key)]) {
      values[j] = values[j - 1];
      j--;
    }
    values[j] = key;
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
{#snippet Cells()}<Node>{#each values as v}{v}{/each}</Node>{/snippet}`;

/** A source of the algorithm and its parts, its one layout holding `view`. */
const prepare = (view: string, algorithm = insertion, parts = '') =>
  prepareSvelteComponent(
    `${domain}${algorithm}\n${parts}\n<Layout name="Main"><Node>${view}</Node></Layout>`
  );

describe('labels read in the view', () => {
  it('are rewritten as identifiers of the same length, outside tags and strings', () => {
    const markup =
      '<Node>a@b {@swap.a} {"@x"} {#each runs(@check.at) as p}{/each} {#each applied(Equal, @in) as e}{/each}</Node>';
    const { source, references } = markLabels(markup);
    expect(source).toHaveLength(markup.length);
    expect(source).toContain('{ℓswapˑa}');
    expect(source).toContain('{"@x"}');
    expect(source).toContain('a@b');
    expect(references.map(({ kind, key }) => [kind, key])).toEqual([
      ['value', 'ℓswapˑa'],
      ['runs', 'ϟcheckˑat'],
      ['applied', 'ǂEqualˑˑin']
    ]);
  });

  it('are an attribute’s value only inside a tag, so text before {@render …} may end in =', async () => {
    const text = '<Node>current key = {v}</Node>';
    expect(markLabels(text)).toEqual({ source: text, references: [], heaps: [] });
    const link = '<Link title="a > b" from={@swap.a} to = { @swap.b } />';
    expect(markLabels(link).references.map(({ key }) => key)).toEqual(['ℓswapˑa', 'ℓswapˑb']);
    await expect(
      compileSvelteComponent(
        `${domain}${insertion}\n{#snippet Inserting()}<Node>current key = {@insert.key}</Node>{/snippet}\n<Layout name="Main"><Node>{@render Inserting()}</Node></Layout>`
      )
    ).resolves.toBeDefined();
  });

  it('give the value the labelled expression gave in a step’s own code, in a part of the page', () => {
    const prepared = prepare(
      '{@render Inserting()}',
      insertion,
      '{#snippet Inserting()}<Node>inserting {@insert.key}</Node>{/snippet}'
    );
    expect(prepared.labelled).toEqual({
      ℓinsertˑkey: {
        label: 'insert.key',
        sample: { state: { value: 2 }, types: { value: 'Int' }, targets: {} }
      }
    });
    // Pausing at the insertion, each run of it gives the key once in its own code.
    expect(
      prepared
        .paced(new Set(['insert']))
        .steps.map((step) => step.labelled?.['insert.key']?.map((run) => run.state.value))
    ).toEqual([undefined, [2], [8], [1]]);
  });

  it('name a label by its full name only, refusing a shorter ending even where unique', () => {
    expect(() => prepare('{@insert.key}')).not.toThrow();
    expect(() => prepare('{@key}')).toThrow(
      '@key is not a full name; write its full name, @insert.key.'
    );
    expect(() => prepare('{@nothing}')).toThrow(
      '@nothing names no label of the algorithm; its labels are @setup, @guard, @onward, @insert, @insert.key, @insert.guard.'
    );
    const twice = `
<script algorithm>
  @a[const x = @v[values[0]];]
  @b[const y = @v[values[1]];]
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>`;
    expect(() => prepare('{@v}', twice)).toThrow(
      '@v is not a full name; write its full name, @a.v or @b.v.'
    );
    expect(() => prepare('{@a.v}{@b.v}', twice)).not.toThrow();
  });

  it('take a label on an expression, and are read only in the root and its parts', () => {
    const statement = `
<script algorithm>
  for (@setup[let i = Index(1)]; @guard[i < values.length]; @onward[i++]) @insert{
    @key[const key = values[i];]
    @put[values[i] = key;]
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>`;
    expect(() => prepare('{@insert.key}', statement)).toThrow(
      '@insert.key labels a statement, which gives no value; label its expression, as const key = @key[values[i]].'
    );
    expect(() =>
      prepare(
        '{@render Cells()}',
        insertion,
        '<View of="Values" name="Shown"><Node>{@insert.key}</Node></View>'
      )
    ).toThrow('@insert.key is read in a view, which sees only its value');
  });

  it('list what a label has given so far, and refuse applied(…), naming the label view in its place', () => {
    const search = `
<script algorithm>
  for (@setup[let i = Index(0)]; @guard[i < values.length]; @onward[i++]) @check{
    const seen = values[@at[i]];
    if (@cond[seen === target]) break;
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Index" name="Checked"><Pointed /></View>
`;
    const prepared = prepare(`{#each runs(@check.at) as p}{p}{/each}`, search);
    expect(Object.keys(prepared.labelled ?? {})).toEqual(['ϟcheckˑat']);
    expect(() =>
      prepare(
        '{@render Asked()}',
        `${search}\n{#snippet Asked()}<Node>{#each applied(Equal, @check) as e}{e}{/each}</Node>{/snippet}`
      )
    ).toThrow('applied(Equal, @check) is not written: label the expression whose results it lists');
  });
});

describe('a for … of variable', () => {
  it('refers to the element it is at, as a reference does', () => {
    const counting = interpretDomain(`
      const Digit = type('integer', { min: 0, max: 9 });
      const Digits = collection(Digit, { max: 8 });
    `);
    const input = interpretInput('const digits = Digits([3, 1, 4]);', counting);
    const steps = traceAlgorithm(
      'for (const v of digits) @read{ const seen = @seen[v]; }',
      input,
      counting,
      { pauses: new Map([['read', 'on']]) }
    ).steps;
    const { identities } = steps[1];
    expect(identities?.refs.v).toBe(identities?.ids['digits[1]']);
  });
});

describe('<When> and <OneOf>', () => {
  it('become {#if when(…)} chains no longer than written, every line in place', () => {
    const one = '<When of="@swap"><Node>x</Node></When>';
    expect(whenTags(one).source.trimEnd()).toBe('{#if when(@swap)}<Node>x</Node>{/if}');
    const two =
      '<OneOf>\n  <When of="@a"><Node>a</Node></When>\n  <When of="end"><Node>b</Node></When>\n</OneOf>';
    const { source, problems } = whenTags(two);
    expect(problems).toEqual([]);
    expect(source).toHaveLength(two.length);
    expect(source.split('\n')).toHaveLength(two.split('\n').length);
    expect(source.replace(/\s+/gu, ' ').trim()).toBe(
      '{#if when(@a)}<Node>a</Node>{:else if when(end)} <Node>b</Node>{/if}'
    );
  });

  it('refuse when(), anything between branches, and unpaired tags', () => {
    const problem = (text: string) => whenTags(text).problems.map(({ message }) => message);
    expect(problem('{#if when(@a)}x{/if}')[0]).toContain('when() is not written in a view');
    expect(
      problem('<OneOf><When of="@a">a</When><Node>x</Node><When of="@b">b</When></OneOf>')[0]
    ).toContain('A <OneOf> holds only its <When> branches');
    expect(problem('<When of="@a">x')[0]).toBe(
      'The <When> is never closed: close it with </When>.'
    );
    expect(problem('<When of="a">x</When>')[0]).toContain('<When of="a"> is no <When>');
  });
});

describe('<View>', () => {
  it('becomes the snippet it stands for, every line and every position outside a closing in place', () => {
    const written =
      '<View of="Int" name="Bar"><Node value={this} /></View>\n{x}\n<View of="@a.b" name="Ask">\n  {this.left}\n</View>';
    const { source, problems, views } = viewTags(written);
    expect(problems).toEqual([]);
    expect(source).toBe(
      '{#snippet Bar(this: Int)} <Node value={this} />{/snippet}\n{x}\n{#snippet Ask(this: @a.b)} \n  {this.left}\n{/snippet}'
    );
    expect(views).toEqual([0, source.indexOf('{#snippet Ask')]);
    const lineAndColumn = (text: string, at: number) => {
      const before = text.slice(0, at);
      return [before.split('\n').length, at - before.lastIndexOf('\n')];
    };
    for (const text of ['{this}', '{x}', '{this.left}'])
      expect(lineAndColumn(source, source.indexOf(text))).toEqual(
        lineAndColumn(written, written.indexOf(text))
      );
  });

  it('ends its line', () => {
    const written = '<View of="Int" name="Bar"><Node value={this} /></View>  {x}\n';
    expect(viewTags(written).problems).toEqual([
      {
        message: '</View> ends its line: put what follows on the next line.',
        start: written.indexOf('{x}')
      }
    ]);
    expect(
      viewTags('<View of="Int" name="Bar"><Node value={this} /></View>  \n{x}').problems
    ).toEqual([]);
    expect(
      viewTags('<View of="Int" name="Bar"><Node value={this} /></View><!-- note -->').problems
    ).toEqual([]);
  });

  it('is refused as a snippet taking a value, unclosed, or with other props', () => {
    const problem = (text: string) => viewTags(text).problems.map(({ message }) => message);
    expect(problem('{#snippet Bar(this: Int)}<Node />{/snippet}')).toEqual([
      expect.stringContaining('write it as a view, <View of="Int" name="Bar">…</View>')
    ]);
    expect(problem('<View of="Int" name="Bar">')).toEqual([
      'The <View> is never closed: close it with </View>.'
    ]);
    expect(problem('<View of="Int" name="Bar" as="v"></View>')).toEqual([
      expect.stringContaining('as is no prop of a view')
    ]);
    expect(problem('</View>')).toEqual([expect.stringContaining('This </View> closes no view')]);
  });

  it('keeps positions after a view, in problems', () => {
    const view =
      '<script domain>const Int = type([1, 3]);</script><script input>const n = Int(1);</script><script algorithm>@run[let i = Int(1);]</script>\n<View of="Int" name="IntCell"><Node value={this} /></View>\n<Layout name="Main"><Node>{nope}</Node></Layout>';
    let error: { code?: string; line?: number; column?: number; others: unknown[] } | undefined;
    try {
      prepareSvelteComponent(view);
    } catch (cause) {
      error = cause as typeof error;
    }
    const unknown = [error, ...(error?.others ?? [])].find(
      (problem) => (problem as typeof error)?.code === 'view_name'
    );
    expect(unknown).toMatchObject({ line: 3, column: view.split('\n')[2].indexOf('nope') + 1 });
  });
});
