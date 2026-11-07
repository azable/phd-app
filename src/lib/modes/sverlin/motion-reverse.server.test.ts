/**
 * A step back plays the move on from that step backwards (see planMove in
 * library/scene-render.ts): a copy made going on, as values[1] = values[0], slides back to its
 * source rather than fading, as a pairing from the later step would show it.
 */

import { describe, expect, it } from 'vitest';

import { drawnScene, planMove, sceneBetween, sceneDuring } from './library/scene-render';
import { drawnSteps } from './testing/scenes';

const copying = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 3 });
</script>
<script input>
  const values = Values;
</script>
<script algorithm>
  @copy[values[1] = values[0];]
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<Layout name="Main">
  <Node layout="row">{#each values as v}{v}{/each}</Node>
</Layout>
<Case name="main" values={[3, 8, 5]} />
<Storyboard>
  <Scene name="main" case="main" pause="@copy"><Main /></Scene>
</Storyboard>`;

describe('a step back', () => {
  it('slides a copy back to its source, as the step on slid it there', async () => {
    const { steps } = await drawnSteps(copying);
    const copied = steps.findIndex((step) => step.copies && Object.keys(step.copies).length);
    expect(copied).toBeGreaterThan(0);
    const earlier = drawnScene(steps[copied - 1]);
    const later = drawnScene(steps[copied]);
    // The cell at 1 holds the copy at the later step.
    const copy = later.nodes.find(
      ({ identity }) => identity && later.copies?.[identity] !== undefined
    )!;
    const source = earlier.nodes.find(
      ({ identity }) => identity === String(later.copies![copy.identity!])
    )!;
    const at = (scene: typeof later) =>
      scene.nodes.find(({ key, leaving }) => key === copy.key && !leaving);

    // Going on, the copy starts at its source and slides to its own place.
    const on = sceneBetween(earlier, later, 0.5);
    expect(at(on)?.box.x).toBeCloseTo((source.box.x + copy.box.x) / 2);

    // Paired from the later step, as a step back was, the cell does not slide back: it stays in
    // its place and only changes its value.
    const fromLater = sceneBetween(later, { ...earlier, copies: undefined }, 0.5);
    expect(at(fromLater)?.box.x).toBeCloseTo(copy.box.x);

    // Played backwards, it slides back from its place to its source.
    const back = planMove({ step: copied, scene: later }, { step: copied - 1, scene: earlier });
    expect(back?.reversed).toBe(true);
    const half = sceneDuring(back!, 0.5);
    expect(at(half)?.box.x).toBeCloseTo((source.box.x + copy.box.x) / 2);
    expect(at(sceneDuring(back!, 0.25))?.box.x).toBeCloseTo(
      at(sceneDuring({ ...back!, reversed: false }, 0.75))!.box.x
    );
  });
});
