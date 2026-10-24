import { describe, expect, it } from 'vitest';

import { leftOutOf, phasesOf, prepareSvelteComponent } from './compile.server';
import { siteOf } from './left-out';

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
<Node tags="title">Pass</Node>
<Node tags="picked">picked {@render Int(v)}</Node>
<Node tags="both">{@render Int(v)} and {@render Int(values[0])}</Node>
<Node layout="row">{#each values as x}{@render Int(x)}{/each}</Node>`;

const prepared = prepareSvelteComponent(source);
const site = (text: string) => siteOf(source, source.indexOf(text));
const left = (frames: string, values: Record<string, unknown> = {}) => {
  const design = { ...prepared.design.starter, ...values };
  const views = Object.fromEntries(
    Object.keys(prepared.design.views).map((type) => [type, design[`views.${type}`]])
  );
  return leftOutOf(prepared, design, views, phasesOf(prepared.masters[frames]));
};

describe('left out', () => {
  it('leaves out a render of a value out of scope at every step, and a node holding only it', () => {
    // Stepping over the whole pass, v is out of scope before it and after it.
    expect(left('*')).toEqual({
      nodes: [site('<Node tags="picked">')],
      renders: [site('{@render Int(v)}</Node>'), site('{@render Int(v)} and')]
    });
  });

  it('keeps a node with any render still drawn, and a node holding no render', () => {
    const { nodes } = left('*');
    expect(nodes).not.toContain(site('<Node tags="both">'));
    expect(nodes).not.toContain(site('<Node tags="title">'));
  });

  it('hides, rather than leaves out, a value out of scope at only some steps', () => {
    expect(left('pass.*')).toEqual({ nodes: [], renders: [] });
  });

  it('leaves out what a view of none or a kind not shown takes with it, up to its nodes', () => {
    const expected = {
      nodes: [
        site('<Node tags="picked">'),
        site('<Node tags="both">'),
        site('<Node layout="row">')
      ],
      renders: [
        site('{@render Int(v)}</Node>'),
        site('{@render Int(v)} and'),
        site('{@render Int(values[0])}'),
        site('{@render Int(x)}')
      ]
    };
    expect(left('pass.*', { 'views.Int': 'none' })).toEqual(expected);
    const notShown = left('pass.*', { 'IntCell.shown': false });
    expect(notShown.renders).toEqual(expected.renders);
    // The view's own node is left out by its kind, and the title, holding no render, stays.
    expect(notShown.nodes).toEqual(
      expect.arrayContaining([...expected.nodes, site('<Node {value} />')])
    );
    expect(notShown.nodes).not.toContain(site('<Node tags="title">'));
  });
});
