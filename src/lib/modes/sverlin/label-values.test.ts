import { describe, expect, it } from 'vitest';

import { traceAlgorithm, interpretDomain, interpretInput } from './algorithm/interpret.server';
import { compileSvelteComponent, prepareSvelteComponent } from './compile.server';
import { markLabels } from './label-values';

const domain = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = collection(Int);
  const Index = index(Values);
  const Length = unop((v: Values) => Index(v.length));
  const Before = binop((a: Index, b: Index) => Flag(a < b));
  const Next = unop((p: Index) => Index(p + 1));
  const Prev = unop((p: Index) => Index(p - 1));
  const Greater = binop((a: Int, b: Int) => Flag(a > b));
  const Equal = binop((a: Int, b: Int) => Flag(a === b));
</script>
<script lang="sverlin" input>
  const values = Values([5, 2, 8, 1]);
  const target = Int(8);
</script>`;

const insertion = `
<script lang="sverlin">
  for (let i = Index(1); Before(i, Length(values)); i = Next(i)) @insert{
    const key = @key[values[i]];
    let j = i;
    while (Before(Index(0), j) && Greater(values[Prev(j)], key)) {
      values[j] = values[Prev(j)];
      j = Prev(j);
    }
    values[j] = key;
  }
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Cells()}<Node>{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}`;

/** A source of the algorithm and its parts, its one layout holding `view`. */
const prepare = (view: string, algorithm = insertion, parts = '') =>
  prepareSvelteComponent(
    `${domain}${algorithm}\n${parts}\n{#layout Main}<Node>${view}</Node>{/layout}`
  );

describe('labels read in the view', () => {
  it('are rewritten as identifiers of the same length, outside tags and strings', () => {
    const markup =
      '<Node>a@b {@render Int(@swap.a)} {"@x"} {#each runs(@check.at) as p}{/each} {#each applied(Equal, @in) as e}{/each}</Node>';
    const { source, references } = markLabels(markup);
    expect(source).toHaveLength(markup.length);
    expect(source).toContain('{@render Int(ℓswapˑa)}');
    expect(source).toContain('{"@x"}');
    expect(source).toContain('a@b');
    expect(references.map(({ kind, key }) => [kind, key])).toEqual([
      ['value', 'ℓswapˑa'],
      ['runs', 'ϟcheckˑat'],
      ['applied', 'ǂEqualˑˑin']
    ]);
  });

  it('are an attribute’s value only inside a tag, so text before {@render …} may end in =', async () => {
    const text = '<Node>current key = {@render Int(v)}</Node>';
    expect(markLabels(text)).toEqual({ source: text, references: [], heaps: [] });
    const link = '<Link title="a > b" from={@swap.a} to = { @swap.b } />';
    expect(markLabels(link).references.map(({ key }) => key)).toEqual(['ℓswapˑa', 'ℓswapˑb']);
    await expect(
      compileSvelteComponent(
        `${domain}${insertion}\n{#snippet Inserting()}<Node>current key = {@render Int(@insert.key)}</Node>{/snippet}\n{#layout Main}<Node>{@render Inserting()}</Node>{/layout}`
      )
    ).resolves.toBeDefined();
  });

  it('give the value the labelled expression gave in a step’s own code, in a part of the page', () => {
    const prepared = prepare(
      '{@render Inserting()}',
      insertion,
      '{#snippet Inserting()}<Node>inserting {@render Int(@insert.key)}</Node>{/snippet}'
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
    expect(() => prepare('{@render Int(@insert.key)}')).not.toThrow();
    expect(() => prepare('{@render Int(@key)}')).toThrow(
      '@key is not a full name; write its full name, @insert.key.'
    );
    expect(() => prepare('{@render Int(@nothing)}')).toThrow(
      '@nothing names no label of the algorithm; its labels are @insert, @insert.key.'
    );
    const twice = `
<script lang="sverlin">
  @a[const x = @v[values[0]];]
  @b[const y = @v[values[1]];]
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}`;
    expect(() => prepare('{@render Int(@v)}', twice)).toThrow(
      '@v is not a full name; write its full name, @a.v or @b.v.'
    );
    expect(() => prepare('{@render Int(@a.v)}{@render Int(@b.v)}', twice)).not.toThrow();
  });

  it('take a label on an expression, and are read only in the root and its parts', () => {
    const statement = `
<script lang="sverlin">
  for (let i = Index(1); Before(i, Length(values)); i = Next(i)) @insert{
    @key[const key = values[i];]
    @put[values[i] = key;]
  }
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}`;
    expect(() => prepare('{@render Int(@insert.key)}', statement)).toThrow(
      '@insert.key labels a statement, which gives no value; label its expression, as const key = @key[values[i]].'
    );
    expect(() =>
      prepare(
        '{@render Cells()}',
        insertion,
        '{#snippet Shown(v: Values)}<Node>{@render Int(@insert.key)}</Node>{/snippet}'
      )
    ).toThrow('@insert.key is read in a view, which sees only its value');
  });

  it('narrow an operator’s render to a label, and give the lists of what has happened', () => {
    const search = `
<script lang="sverlin">
  for (let i = Index(0); Before(i, Length(values)); i = Next(i)) @check{
    if (Equal(values[@at[i]], target)) break;
  }
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Asking(e: Equal)}<Node>{@render Int(e.a)}</Node>{/snippet}
{#snippet Checked(p: Index)}<Pointed />{/snippet}
{#snippet Asked()}<Node>{#each applied(Equal, @check) as e}{@render Equal(e)}{/each}</Node>{/snippet}`;
    const prepared = prepare(
      `{@render Equal(@check)}
{#each runs(@check.at) as p}{@render Index(p)}{/each}
{@render Asked()}`,
      search
    );
    expect(prepared.appliedIn?.['Equal_ℓcheck']?.operator).toBe('Equal');
    expect(Object.keys(prepared.labelled ?? {})).toEqual(['ϟcheckˑat']);
    // Both inside the code labelled @check.
    expect(prepared.histories).toEqual({ ǂEqualˑˑcheck: prepared.appliedIn?.['Equal_ℓcheck'] });
    expect(() => prepare('{#each applied(Values) as e}{/each}', search)).toThrow(
      'applied(Values) takes an operator the domain declares, as applied(Equal).'
    );
    // What has happened is a label's too: with none, it names the label to write.
    expect(() => prepare('{#each applied(Equal) as e}{/each}', search)).toThrow(
      "applied(Equal) draws no label's applications: write applied(Equal, @check), a label around an application of Equal."
    );
  });
});

describe('a for … of variable', () => {
  it('refers to the element it is at, as a reference does', () => {
    const counting = interpretDomain(`
      const Digit = type('integer', { min: 0, max: 9 });
      const Digits = collection(Digit);
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
