import { describe, expect, it } from 'vitest';

import { leftOutOf, phasesOf, prepareSvelteComponent } from './compile.server';
import { hiddenAt, siteOf } from './left-out';

const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
</script><Run name="main" values={[3, 1]} />
<script algorithm>
  for (@setup[let i = Index(0)]; @guard[i < values.length]; @onward[i++]) @pass{
    @pick[const v = values[i];]
    @put[values[i] = v;]
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<Layout name="Title"><Node>Pass</Node></Layout>
<Layout name="Picked" of="v"><Node>picked {v}</Node></Layout>
<Layout name="Both" of="v, values"><Node>{v} and {values[0]}</Node></Layout>
<Layout name="Cells" of="values"><Node layout="row">{#each values as x}{x}{/each}</Node></Layout>

<Layout name="Main" of="v, values">
  <Node>
    <Title />
    <Picked v={v} />
    <Both v={v} values={values} />
    <Cells values={values} />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" run="main"><Main v={v} values={values} /></Scene>
</Storyboard>`;

const prepared = prepareSvelteComponent(source);
const siteIn = (text: string) => (written: string) => siteOf(text, text.indexOf(written));
/** The site of a layout's first node, right after its opening. */
const nodeIn = (text: string) => (layout: string) => {
  const opening = new RegExp(`<Layout name="${layout}"[^>]*>`, 'u').exec(text)!;
  return siteOf(text, opening.index + opening[0].length);
};
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
      // v is in scope at no step, so it has no type to draw it by: its reads are left out as text.
      renders: [
        site('<Picked v={v} />'),
        site('<Both v={v} values={values} />'),
        `read ${site('v}</Node>')}`,
        `read ${site('v} and')}`
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
        site('{v}</Node>'),
        site('{v} and'),
        site('{values[0]}'),
        site('{x}'),
        site('<Picked v={v} />'),
        site('<Both v={v} values={values} />'),
        site('<Cells values={values} />')
      ]
    };
    expect(left(prepared, { 'views.Int': 'none' })).toEqual(expected);
    const notShown = left(prepared, { 'IntCell.shown': false });
    expect(notShown.renders).toEqual(expected.renders);
    // The view's own node is left out by its kind, and the title, holding no render, stays.
    expect(notShown.nodes).toEqual(
      expect.arrayContaining([...expected.nodes, site('<Node value={this} />')])
    );
    expect(notShown.nodes).not.toContain(node('Title'));
  });

  it('leaves out a layout whose kind is not shown, and keeps the others', () => {
    const { nodes } = left(prepared, { 'Title.shown': false });
    expect(nodes).toEqual([node('Title')]);
  });

  it('hide at a step a node one of whose own renders is hidden, and a row only with all its parts', () => {
    const nested = source
      .replace(
        '<Layout name="Picked" of="v"><Node>picked {v}</Node></Layout>',
        '<Layout name="Outer" of="v"><Node><Node>picked {v}</Node></Node></Layout>' +
          '<Layout name="Parts" of="v, values"><Node><Node>v {v}</Node><Node>first {values[0]}</Node></Node></Layout>'
      )
      .replace('<Picked v={v} />', '<Outer v={v} /><Parts v={v} values={values} />');
    const at = siteIn(nested);
    const first = nodeIn(nested);
    const hidden = (absent: string[]) => hiddenIn(prepareSvelteComponent(nested), absent);
    // v out of scope here: its node hides, and the node around it, all of whose parts are gone; "v
    // and values[0]" is one statement and hides whole; in the row only the part drawing v hides.
    expect([...hidden(['v'])].sort()).toEqual(
      [first('Outer'), at('<Node>picked'), at('<Node>v {v}'), first('Both')].sort()
    );
    expect(hidden(['v'])).not.toContain(first('Parts'));
    expect(hidden(['v'])).not.toContain(at('<Node>first'));
    expect(hidden([])).toEqual([]);
  });

  it('hide a node reading a variable itself until it is declared, as at step 0', () => {
    // A layout reads found itself: allowed, as found is out of scope only before its declaration,
    // and its node hides where found is absent, as at step 0, the input as given.
    const reading = source
      .replace('for (@setup[let i', '@start[let found = Flag(false);]\n  for (@setup[let i')
      .replace(
        '<Layout name="Title"><Node>Pass</Node></Layout>',
        '<Layout name="Status" of="found"><Node>{#if found}found{:else}looking{/if}</Node></Layout>'
      )
      .replace('<Layout name="Main" of="v, values">', '<Layout name="Main" of="v, values, found">')
      .replace('<Title />', '<Status found={found} />')
      .replace('<Main v={v} values={values} />', '<Main v={v} values={values} found={found} />');
    const built = prepareSvelteComponent(reading);
    const status = nodeIn(reading)('Status');
    expect(hiddenIn(built, ['found'])).toContain(status);
    expect(hiddenIn(built, [])).not.toContain(status);
  });

  it('take each render in a node holding nodes as a part, a column losing only its caption', () => {
    const shaped = source
      .replace(
        '<Layout name="Picked" of="v"><Node>picked {v}</Node></Layout>',
        '<Layout name="Column" of="values, v"><Node layout="column"><Node>{#each values as x}{x}{/each}</Node>{v}</Node></Layout>' +
          // Accepted: a sentence with a node in it is parts too, so only its loose render goes.
          '<Layout name="Mixed" of="v, values"><Node>picked {v} <Node>first {values[0]}</Node></Node></Layout>'
      )
      .replace(
        '<Picked v={v} />',
        '<Column values={values} v={v} /><Mixed v={v} values={values} />'
      );
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
    expect(left.renders).toContain(`read ${siteIn(shaped)('v}</Node>')}`);
  });

  it('takes a layout drawn in another layout’s node as one of that node’s parts', () => {
    const inside = source
      .replace(
        '<Layout name="Cells"',
        '<Layout name="Board" of="values, v"><Node layout="column"><Cells values={values} /><Picked v={v} /></Node></Layout><Layout name="Cells"'
      )
      .replace('    <Picked v={v} />\n', '')
      .replace('<Cells values={values} />\n', '<Board values={values} v={v} />\n');
    const built = prepareSvelteComponent(inside);
    // Picked goes with v, but the board keeps the cells.
    expect(hiddenIn(built, ['v'])).not.toContain(nodeIn(inside)('Board'));
    expect(hiddenIn(built, ['v'])).toContain(nodeIn(inside)('Picked'));
  });
});
