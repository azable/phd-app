import { describe, expect, it } from 'vitest';

import { leftOutOf, phasesOf, prepareSvelteComponent } from './compile.server';
import { hiddenAt, siteOf } from './left-out';

const source = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = collection(Int);
  const Index = index(Values);
  const Length = unop((v: Values) => Index(v.length));
  const Before = binop((a: Index, b: Index) => Flag(a < b));
  const Next = unop((p: Index) => Index(p + 1));
</script>
<script lang="sverlin" input>
  const values = Values([3, 1]);
</script>
<script lang="sverlin">
  for (let i = Index(0); Before(i, Length(values)); i = Next(i)) @pass{
    @pick[const v = values[i];]
    @put[values[i] = v;]
  }
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Title()}<Node>Pass</Node>{/snippet}
{#snippet Picked()}<Node>picked {@render Int(v)}</Node>{/snippet}
{#snippet Both()}<Node>{@render Int(v)} and {@render Int(values[0])}</Node>{/snippet}
{#snippet Cells()}<Node layout="row">{#each values as x}{@render Int(x)}{/each}</Node>{/snippet}
{@render Title()}
{@render Picked()}
{@render Both()}
{@render Cells()}`;

const prepared = prepareSvelteComponent(source);
const siteIn = (text: string) => (written: string) => siteOf(text, text.indexOf(written));
/** The site of a part's first node, right after its opening. */
const nodeIn = (text: string) => (part: string) =>
  siteOf(text, text.indexOf(`{#snippet ${part}()}`) + `{#snippet ${part}()}`.length);
const site = siteIn(source);
const node = nodeIn(source);
// The pass as one label, which reads v and writes the row, as the same lines: its steps are its
// passes that change the row, v out of scope before each and after it.
const wholePass = (text: string) =>
  text.replace(
    '@pick[const v = values[i];]\n    @put[values[i] = v;]',
    'const v = values[i];\n    values[i] = values[0];'
  );
const whole = prepareSvelteComponent(wholePass(source));
const left = (built: typeof prepared, values: Record<string, unknown> = {}) => {
  const design = { ...built.design.starter, ...values };
  const views = Object.fromEntries(
    Object.keys(built.design.views).map((type) => [type, design[`views.${type}`]])
  );
  return leftOutOf(built, design, views, phasesOf(built.master));
};
const hiddenIn = (built: ReturnType<typeof prepareSvelteComponent>, absent: string[]) =>
  hiddenAt(
    built.leftOut!.model,
    built.design.starter,
    { Int: 'IntCell' },
    new Set(built.leftOut!.components),
    new Set(absent),
    []
  );

describe('left out', () => {
  it('leaves out a render of a value out of scope at every step, and a node whose own render it is', () => {
    // Stepping over whole passes, v is out of scope before each and after it. A node's own renders
    // and text are one statement, so "v and values[0]" goes too, and the parts drawing nothing else.
    expect(left(whole)).toEqual({
      nodes: [node('Picked'), node('Both')],
      renders: [
        site('{@render Int(v)}</Node>'),
        site('{@render Int(v)} and'),
        site('{@render Picked()}'),
        site('{@render Both()}')
      ]
    });
  });

  it('keeps a node holding no render', () => {
    expect(left(whole).nodes).not.toContain(node('Title'));
  });

  it('hides, rather than leaves out, a value out of scope at only some steps', () => {
    expect(left(prepared)).toEqual({ nodes: [], renders: [] });
  });

  it('leaves out what a view of none or a kind not shown takes with it, up to its nodes', () => {
    const expected = {
      nodes: [node('Picked'), node('Both'), node('Cells')],
      renders: [
        site('{@render Int(v)}</Node>'),
        site('{@render Int(v)} and'),
        site('{@render Int(values[0])}'),
        site('{@render Int(x)}'),
        site('{@render Picked()}'),
        site('{@render Both()}'),
        site('{@render Cells()}')
      ]
    };
    expect(left(prepared, { 'views.Int': 'none' })).toEqual(expected);
    const notShown = left(prepared, { 'IntCell.shown': false });
    expect(notShown.renders).toEqual(expected.renders);
    // The view's own node is left out by its kind, and the title, holding no render, stays.
    expect(notShown.nodes).toEqual(
      expect.arrayContaining([...expected.nodes, site('<Node {value} />')])
    );
    expect(notShown.nodes).not.toContain(node('Title'));
  });

  it('leaves out a part of the page whose kind is not shown, and keeps the others', () => {
    const { nodes } = left(prepared, { 'Title.shown': false });
    expect(nodes).toEqual([node('Title')]);
  });

  it('hide at a step a node one of whose own renders is hidden, and a row only with all its parts', () => {
    const nested = source
      .replace(
        '{#snippet Picked()}<Node>picked {@render Int(v)}</Node>{/snippet}',
        '{#snippet Outer()}<Node><Node>picked {@render Int(v)}</Node></Node>{/snippet}' +
          '{#snippet Parts()}<Node><Node>v {@render Int(v)}</Node><Node>first {@render Int(values[0])}</Node></Node>{/snippet}'
      )
      .replace('{@render Picked()}', '{@render Outer()}{@render Parts()}');
    const at = siteIn(nested);
    const first = nodeIn(nested);
    const hidden = (absent: string[]) => hiddenIn(prepareSvelteComponent(nested), absent);
    // v out of scope here: its node hides, and the node around it, all of whose parts are gone; "v
    // and values[0]" is one statement and hides whole; in the row only the part drawing v hides.
    expect([...hidden(['v'])].sort()).toEqual(
      [first('Outer'), at('<Node>picked'), at('<Node>v {@render'), first('Both')].sort()
    );
    expect(hidden(['v'])).not.toContain(first('Parts'));
    expect(hidden(['v'])).not.toContain(at('<Node>first'));
    expect(hidden([])).toEqual([]);
  });

  it('hide a node reading a variable itself until it is declared, as at step 0', () => {
    // A part reads found itself: allowed, as found is out of scope only before its declaration,
    // and its node hides where found is absent, as at step 0, the input as given.
    const reading = source
      .replace('for (let i', '@start[let found = Flag(false);]\n  for (let i')
      .replace(
        '{#snippet Title()}<Node>Pass</Node>{/snippet}',
        '{#snippet Status()}<Node>{#if found}found{:else}looking{/if}</Node>{/snippet}'
      )
      .replace('{@render Title()}', '{@render Status()}');
    const built = prepareSvelteComponent(reading);
    const status = nodeIn(reading)('Status');
    expect(hiddenIn(built, ['found'])).toContain(status);
    expect(hiddenIn(built, [])).not.toContain(status);
  });

  it('take each render in a node holding nodes as a part, a column losing only its caption', () => {
    const shaped = source
      .replace(
        '{#snippet Picked()}<Node>picked {@render Int(v)}</Node>{/snippet}',
        '{#snippet Column()}<Node layout="column"><Node>{#each values as x}{@render Int(x)}{/each}</Node>{@render Int(v)}</Node>{/snippet}' +
          // Accepted: a sentence with a node in it is parts too, so only its loose render goes.
          '{#snippet Mixed()}<Node>picked {@render Int(v)} <Node>first {@render Int(values[0])}</Node></Node>{/snippet}'
      )
      .replace('{@render Picked()}', '{@render Column()}{@render Mixed()}');
    const built = prepareSvelteComponent(shaped);
    const first = nodeIn(shaped);
    const hidden = hiddenIn(built, ['v']);
    const passes = prepareSvelteComponent(wholePass(shaped));
    expect(hidden).not.toContain(first('Column'));
    expect(hidden).not.toContain(first('Mixed'));
    // Per presentation, stepping over whole passes, the same: neither is left out.
    const design = passes.design.starter;
    const left = leftOutOf(passes, design, { Int: design['views.Int'] }, phasesOf(passes.master));
    expect(left.nodes).not.toContain(first('Column'));
    expect(left.nodes).not.toContain(first('Mixed'));
    expect(left.renders).toContain(siteIn(shaped)('{@render Int(v)}</Node>'));
  });

  it('takes a part rendered in another part’s node as one of that node’s parts', () => {
    const inside = source
      .replace(
        '{#snippet Cells()}',
        '{#snippet Board()}<Node layout="column">{@render Cells()}{@render Picked()}</Node>{/snippet}{#snippet Cells()}'
      )
      .replace('{@render Picked()}\n', '')
      .replace('{@render Cells()}', '{@render Board()}');
    const built = prepareSvelteComponent(inside);
    // Picked goes with v, but the board keeps the cells.
    expect(hiddenIn(built, ['v'])).not.toContain(nodeIn(inside)('Board'));
    expect(hiddenIn(built, ['v'])).toContain(nodeIn(inside)('Picked'));
  });
});
