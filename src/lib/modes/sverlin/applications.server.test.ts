/** A step's application of an operator, drawn by {@sweep.pair.test}, in the server's scenes. */

import { expect, it } from 'vitest';

import { prepareSvelteComponent } from './compile.server';
import { pausingAt } from './testing/every-pause';
import { drawnSteps, textOf } from './testing/scenes';

const source = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Flag = type('boolean');
  const Values = array(Int, { max: 8 });
  const Index = index(Values);

  // walking the collection

  // what the algorithm does
</script>

<script input>
  const values = Values;
</script><Case name="main" values={[5, 1, 4, 2, 3]} />

<script algorithm>
  for (@last[let end = values.length]; @more[Index(1) < end]; @shrink[end--]) @sweep{
    for (@first[let i = Index(1)]; @inside[i < end]; @step[i++]) @pair{
      if (@test[(values[i - 1]) > values[i]]) @swap{
        const moved = values[i - 1];
        values[i - 1] = values[i];
        values[i] = moved;
      }
    }
  }
</script>

<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Flag" name="FlagWord"><Node>{this ? 'yes' : 'no'}</Node></View>
<View of="@sweep.pair.test" name="Ask">
  <Node>is {this.left} > {this.right}? {this.value}</Node>
</View>
<Layout name="Title"><Node>Bubble sort</Node></Layout>
<Layout name="Board">
  <Node layout="column">
    <Node>{#each values as v}{v}{/each}</Node>
    {@sweep.pair.test}
  </Node>
</Layout>

<Layout name="Main">
  <Node>
    <Title />
    <Board />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main /></Scene>
</Storyboard>`;

/** The caption Ask draws at a step; none where it is hidden or not drawn at all. */
async function captionAt(step: number, chosen: Record<string, unknown> = {}) {
  // The loop headers move no value the view draws, so the steps are the comparisons and swaps.
  const headers = ['last', 'more', 'shrink', 'sweep.first', 'sweep.inside', 'sweep.step'];
  const pause = prepareSvelteComponent(source)
    .pauses.labels.filter((label) => !headers.includes(label))
    .map((label) => `@${label}.end`)
    .join(', ');
  const { steps } = await drawnSteps(pausingAt(source, pause), { chosen });
  const node = steps[step].nodes.find(({ kind }) => kind?.startsWith('Ask'));
  return node ? { text: textOf(steps[step], node) } : null;
}

it(
  "draw a step's one application of an operator, and nothing where it made none or several",
  { timeout: 60_000 },
  async () => {
    // Step 0 is the input as given, step 1 the first comparison, step 2 its swap.
    expect(await captionAt(0)).toBeNull();
    const first = await captionAt(1);
    // A comparison gives a plain boolean, drawn as text (see the guide's Views of what a step computed).
    expect(first?.text).toMatch(/^is 5 > 1 ?\? true$/u);
    expect(await captionAt(2)).toBeNull();
    // With the comparison's view hidden, nothing draws it.
    expect(await captionAt(1, { 'views.@sweep.pair.test': 'none' })).toBeNull();
  }
);
