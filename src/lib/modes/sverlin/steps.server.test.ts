/** Steps as the server draws their scenes. */

import { expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { pausingEveryLabel } from './testing/every-pause';
import { ofKind, textOf } from './testing/scenes';

it('shows a step forward straight at the state after its code', { timeout: 60_000 }, async () => {
  // Each step is a write of 7; the loop moving i, which the view draws, leads up to it.
  const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[1, 1, 1]} />
<script algorithm>
  for (@first[let i = Index(0)]; @more[i < values.length]; @next[i++]) {
    @write[values[i] = 7;]
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Index" name="IndexText"><Node value={this} /></View>
<Layout name="Cells" of="values"><Node>{#each values as v}{v}{/each}</Node></Layout>
<Layout name="At" of="i"><Node>at {i}</Node></Layout>

<Layout name="Main" of="values, i">
  <Node>
    <Cells values={values} />
    <At i={i} />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main" pause="@write"><Main values={values} i={i} /></Scene>
</Storyboard>`;
  const prepared = prepareSvelteComponent(pausingEveryLabel(source));
  // Step 0 is the input as given, before any of the algorithm runs.
  expect(prepared.master[0].state.values).toEqual([1, 1, 1]);
  // The loop header is labelled part by part; the write is the step, the header leading up to it.
  const second = prepared.master.find(({ name }) => name === '@write#2')!;
  expect(second.before?.state).toMatchObject({ values: [7, 1, 1], i: 1 });
  expect(second.state.values).toEqual([7, 7, 1]);
  const { steps } = (await bundlePresentation(prepared, 1, {})).layout.scenes!;
  // Where i is, then the cells.
  const shown = (step: number) => [
    textOf(steps[step], ofKind(steps[step], 'IndexText')[0]),
    ...ofKind(steps[step], 'IntCell').map((cell) => textOf(steps[step], cell))
  ];
  expect(shown(0).slice(1)).toEqual(['1', '1', '1']);
  // Each step shows its after: i moved by the loop and the 7 its code writes, together.
  expect([1, 2].map((step) => shown(step).join(' '))).toEqual(['0 7 1 1', '1 7 7 1']);
});

it(
  'leaves out a value out of scope at every step with the node around it, as shown false does',
  { timeout: 60_000 },
  async () => {
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[3, 1]} />
<script algorithm>
  for (@first[let i = Index(0)]; @more[i < values.length]; @next[i++]) @pass{
    @pick[const key = values[i];]
    @put[values[i] = key;]
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<Layout name="Title"><Node>Pass</Node></Layout>
<Layout name="Key" of="key"><Node>key {key}</Node></Layout>
<Layout name="Cells" of="values"><Node layout="row">{#each values as x}{x}{/each}</Node></Layout>

<Layout name="Main" of="key, values">
  <Node>
    <Title />
    <Key key={key} />
    <Cells values={values} />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main" pause="@pass.pick, @pass.put"><Main key={key} values={values} /></Scene>
</Storyboard>`;
    // The pass as one label, which reads key and writes the row: its steps are its passes that
    // change the row, key out of scope before each and after it.
    const whole = source
      .replace(
        '@pick[const key = values[i];]\n    @put[values[i] = key;]',
        'const key = values[i];\n    values[i] = values[0];'
      )
      .replace('pause="@pass.pick, @pass.put"', 'pause="@pass"');
    const kinds = async (text: string, chosen: Record<string, string | boolean> = {}) => {
      const prepared = prepareSvelteComponent(pausingEveryLabel(text));
      // Over every step: a node kept hidden at one is not drawn there.
      const nodes = (
        await bundlePresentation(prepared, 1, { chosen })
      ).layout.scenes!.steps.flatMap((step) => step.nodes);
      return {
        kinds: nodes.map(({ kind }) => kind),
        text: nodes.flatMap(({ runs = [] }) => runs.map(({ text }) => text)).join(' ')
      };
    };
    // Stepping over each pass whole, key is out of scope at every step: no key node, no "key".
    const passes = await kinds(whole);
    expect(passes.kinds).not.toContain('Key');
    expect(passes.text).not.toContain('key');
    expect(passes.kinds).toContain('Title');
    // Stepping at the pick inside the pass, which declares key, key shows.
    const inside = await kinds(source);
    expect(inside.kinds).toContain('Key');
    // A kind not shown takes the nodes holding only its values with it: the row, and the key.
    const hidden = await kinds(source, { 'IntCell.shown': false });
    expect(hidden.kinds).not.toContain('Cells');
    expect(hidden.kinds).not.toContain('Key');
    expect(hidden.kinds).toContain('Title');
  }
);
