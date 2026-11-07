import { describe, expect, it } from 'vitest';
import type { SceneNode, SceneStep } from './library';
import { drawnSteps } from './testing/scenes';

/** A shifting insertion sort whose listing marks its regions, and a note with tokens in its text. */
const sort = (note: string, listing = 'while @front[j ≥ 0 and A[j] > key]') => `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 4 });
  const Position = index(Values);
</script>

<script input>
  const values = Values;
</script>

<script algorithm>
  for (@start[let i = Position(1)]; @more[i < values.length]; @next[i++]) @insert{
    @take[const key = values[i];
    let j = Position(i - 1);]
    while (@front[j >= 0 && values[j] > key]) @shift{
      @move[values[j + 1] = values[j];
      j--;]
    }
    @drop[values[j + 1] = key;]
  }
</script>

<script listing="textbook">
for i = 1 to n − 1
    @take[:key[key] = A[i]
    j = i − 1]
    ${listing}
        @move[A[j + 1] = A[j]
        j = j − 1]
    @drop[A[j + 1] = :key[key]]
</script>

<View of="Int" name="IntCell"><Node value={this} /></View>

<Layout name="Main">
  <Node layout="row">
    <Listing />
    <Node kind="Board" layout="column">
      <Node kind="Cells" layout="row">{#each values as v}<Node kind="Cell">{v}</Node>{/each}</Node>
      <Node kind="Key">{key}</Node>
      <Node kind="Note">${note}</Node>
    </Node>
  </Node>
</Layout>

<Case name="main" values={[3, 1, 2]} />
<Storyboard>
  <Scene name="sort" case="main" pause="@insert.take, @insert.front, @insert.shift.move, @insert.drop"><Main /></Scene>
</Storyboard>`;

const note = 'The loop stops when :@front[A[j] > key] is false, and :key[key] waits.';
const lit = { chosen: { 'listing.places': 'fill' } };

/** The steps at which a node with that text and kind shows its place's light. */
const litAt = (steps: SceneStep[], text: string) =>
  steps.flatMap((step, index) =>
    step.nodes.some(
      (node: SceneNode) => /Code$/u.test(node.kind ?? '') && node.text === text && node.look.light
    )
      ? [index]
      : []
  );

describe('a token naming a label', () => {
  // [3, 1, 2]: the loop's test runs at steps 2 and 4 for i = 1, and 7 and 9 for i = 2.
  const tests = [2, 4, 7, 9];

  it('in a text, lights where the label’s region lights as the step’s own code, though nothing draws it', async () => {
    const { steps } = await drawnSteps(sort(note), lit);
    expect(litAt(steps, 'A[j] > key')).toEqual(tests);
    const code = steps[0].nodes.find((node) => node.text === 'A[j] > key');
    // Written :@front, it is the label's full place, as the listing's region is.
    expect(code?.places).toEqual([':@insert.front']);
    const region = steps[0].nodes
      .flatMap((node) => node.runs ?? [])
      .filter((run) => run.places?.includes(':@insert.front'))
      .map((run) => run.text)
      .join(' ');
    expect(region).toBe('j ≥ 0 and A[j] > key');
  });

  it('in a listing too, by the regions around it', async () => {
    const { steps } = await drawnSteps(
      sort(note, 'while @front[j ≥ 0 and :@front[A[j] > key]]'),
      lit
    );
    expect(litAt(steps, 'A[j] > key')).toEqual(tests);
  });

  it('is refused where no label has its name, naming the nearest', async () => {
    await expect(drawnSteps(sort(note.replace(':@front[', ':@frnt[')), lit)).rejects.toThrow(
      /The token :@frnt\[…\] names a label, .* the nearest is @insert\.front/u
    );
  });

  it('leaves a place’s token as it was: lit where the listing’s tokens for it light', async () => {
    const { steps } = await drawnSteps(sort(note), lit);
    // :key is in the listing's take and drop: steps 1 and 6 take the key, 5 and 10 drop it.
    expect(litAt(steps, 'key')).toEqual([1, 5, 6, 10]);
  });
});
