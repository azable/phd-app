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
  it('leaves out a render of a value out of scope at every step, and a node whose own render it is', () => {
    // Stepping over the whole pass, v is out of scope before it and after it. A node's own renders
    // and text are one statement, so "v and values[0]" goes too.
    expect(left('pass')).toEqual({
      nodes: [site('<Node tags="picked">'), site('<Node tags="both">')],
      renders: [site('{@render Int(v)}</Node>'), site('{@render Int(v)} and')]
    });
  });

  it('keeps a node holding no render', () => {
    expect(left('pass').nodes).not.toContain(site('<Node tags="title">'));
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

  it('hide at a step a node one of whose own renders is hidden, and a row only with all its parts', () => {
    const nested = `${source.replace(
      '<Node tags="picked">picked {@render Int(v)}</Node>',
      '<Node tags="outer"><Node tags="picked">picked {@render Int(v)}</Node></Node>' +
        '<Node tags="row"><Node tags="part">v {@render Int(v)}</Node><Node tags="first">first {@render Int(values[0])}</Node></Node>'
    )}`;
    const model = prepareSvelteComponent(nested).leftOut!.model;
    const at = (text: string) => siteOf(nested, nested.indexOf(text));
    const hidden = (absent: string[]) =>
      hiddenAt(
        model,
        prepared.design.starter,
        { Int: 'IntCell' },
        new Set(['IntCell']),
        new Set(absent),
        []
      );
    // v out of scope here: its node hides, and the node around it, all of whose parts are gone; "v
    // and values[0]" is one statement and hides whole; in the row only the part drawing v hides.
    expect([...hidden(['v'])].sort()).toEqual(
      [
        at('<Node tags="outer">'),
        at('<Node tags="picked">'),
        at('<Node tags="part">'),
        at('<Node tags="both">')
      ].sort()
    );
    expect(hidden(['v'])).not.toContain(at('<Node tags="row">'));
    expect(hidden(['v'])).not.toContain(at('<Node tags="first">'));
    expect(hidden([])).toEqual([]);
  });

  it('hide a node reading a variable itself until it is declared, as at step 0', () => {
    // The root reads found itself: allowed, as found is out of scope only before its declaration,
    // and its node hides where found is absent, as at step 0, the input as given.
    const reading = source
      .replace('for (let i', '@start[let found = Flag(false);]\n  for (let i')
      .replace(
        '<Node tags="title">Pass</Node>',
        '<Node tags="status">{#if found}found{:else}looking{/if}</Node>'
      );
    const readingPrepared = prepareSvelteComponent(reading);
    const at = (text: string) => siteOf(reading, reading.indexOf(text));
    const hidden = (absent: string[]) =>
      hiddenAt(
        readingPrepared.leftOut!.model,
        readingPrepared.design.starter,
        { Int: 'IntCell' },
        new Set(['IntCell']),
        new Set(absent),
        []
      );
    expect(hidden(['found'])).toContain(at('<Node tags="status">'));
    expect(hidden([])).not.toContain(at('<Node tags="status">'));
  });

  it('take each render in a node holding nodes as a part, a column losing only its caption', () => {
    const shaped = source.replace(
      '<Node tags="picked">picked {@render Int(v)}</Node>',
      '<Node tags="column"><Node tags="array">{#each values as x}{@render Int(x)}{/each}</Node>{@render Int(v)}</Node>' +
        // Accepted: a sentence with a node in it is parts too, so only its loose render goes.
        '<Node tags="mixed">picked {@render Int(v)} <Node tags="inner">first {@render Int(values[0])}</Node></Node>'
    );
    const shapedPrepared = prepareSvelteComponent(shaped);
    const at = (text: string) => siteOf(shaped, shaped.indexOf(text));
    const hidden = hiddenAt(
      shapedPrepared.leftOut!.model,
      shapedPrepared.design.starter,
      { Int: 'IntCell' },
      new Set(['IntCell']),
      new Set(['v']),
      []
    );
    expect(hidden).not.toContain(at('<Node tags="column">'));
    expect(hidden).not.toContain(at('<Node tags="mixed">'));
    // Per presentation, stepping over the whole pass, the same: neither is left out.
    const design = shapedPrepared.design.starter;
    const left = leftOutOf(
      shapedPrepared,
      design,
      { Int: design['views.Int'] },
      phasesOf(shapedPrepared.masters.pass)
    );
    expect(left.nodes).not.toContain(at('<Node tags="column">'));
    expect(left.nodes).not.toContain(at('<Node tags="mixed">'));
    expect(left.renders).toContain(at('{@render Int(v)}</Node>'));
  });
});
