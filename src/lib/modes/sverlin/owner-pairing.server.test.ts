/**
 * Nodes that draw no value of their own, as a caption beside a value or the column holding both,
 * move with the value they are drawn with when it moves to another place, rather than staying
 * where their id was (see pairNodes in library/scene-render.ts).
 */

import { describe, expect, it } from 'vitest';

import { drawnScene, sceneBetween, type DrawnScene } from './library/scene-render';
import { drawnSteps } from './testing/scenes';

const items = (algorithm: string, caption = 'cost') => `<script domain>
  const Name = type(['A', 'B', 'C']);
  const Cost = type('integer', { min: 0, max: 9 });
  const Item = record({ name: Name, cost: Cost });
  const Items = array(Item, { max: 3 });
</script>
<script input>
  const items = Items;
</script>
<script algorithm>
  ${algorithm}
</script>
<View of="Name" name="NameText"><Node value={this} /></View>
<View of="Cost" name="CostCell"><Node value={this} /></View>
<Layout name="Main">
  <Node layout="row">
    {#each items as item, k}
      <Node layout="column"><Node kind="Caption">${caption}</Node>{item.cost}</Node>
    {/each}
  </Node>
</Layout>
<Case name="main" items={[{ name: 'A', cost: 1 }, { name: 'B', cost: 5 }, { name: 'C', cost: 9 }]} />
<Storyboard>
  <Scene name="main" case="main" pause="@move.end"><Main /></Scene>
</Storyboard>`;

/** Where each value's caption is, across from the value, halfway through the move to `to`. */
function captionsBeside(from: DrawnScene, to: DrawnScene): { value: number; caption: number }[] {
  const half = sceneBetween(from, to, 0.5);
  return half.nodes
    .filter(({ kind, leaving }) => kind === 'CostCell' && !leaving)
    .map((value) => {
      const caption = half.nodes.find(
        ({ kind, parent, leaving }) =>
          kind === 'Main.Caption' && parent === value.parent && !leaving
      )!;
      return { value: value.box.x, caption: caption.box.x };
    });
}

async function move(algorithm: string, caption?: string) {
  const { steps } = await drawnSteps(items(algorithm, caption));
  return [drawnScene(steps.at(-2)!), drawnScene(steps.at(-1)!)] as const;
}

describe('nodes drawn with a value', () => {
  it('move with it when it swaps places with another', async () => {
    const [from, to] = await move(
      '@move[const first = items[0]; items[0] = items[2]; items[2] = first;]'
    );
    const resting = captionsBeside(from, from)[0].caption - captionsBeside(from, from)[0].value;
    for (const { value, caption } of captionsBeside(from, to))
      expect(caption - value).toBeCloseTo(resting, 6);
  });

  it('move with it when the one before it leaves', async () => {
    const [from, to] = await move('@move[items.shift();]');
    const resting = captionsBeside(from, from)[0].caption - captionsBeside(from, from)[0].value;
    expect(captionsBeside(from, to)).toHaveLength(2);
    for (const { value, caption } of captionsBeside(from, to))
      expect(caption - value).toBeCloseTo(resting, 6);
  });

  it('stay with their place where what they show is the place, as its index', async () => {
    const [from, to] = await move(
      '@move[const first = items[0]; items[0] = items[2]; items[2] = first;]',
      '{k}'
    );
    const half = sceneBetween(from, to, 0.5);
    // In order of place, as a move draws what travels after the rest.
    const indices = (scene: DrawnScene) =>
      scene.nodes
        .filter(({ kind }) => kind === 'Main.Caption')
        .map(({ box, runs }) => [runs.map(({ text }) => text).join(''), box.x])
        .sort(([, a], [, b]) => (a as number) - (b as number));
    expect(indices(half)).toEqual(indices(from));
  });
});
