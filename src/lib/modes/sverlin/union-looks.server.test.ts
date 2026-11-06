import { describe, expect, it } from 'vitest';
import { drawnSteps } from './testing/scenes';

/** A cost each vertex holds, a number or not yet known, drawn by a view of each union member. */
const costs = `<script domain>
  const Cost = type('integer', { min: 0, max: 30 });
  const Unknown = type(['unknown']);
  const Distance = union(Cost, Unknown);
  const Costs = array(Distance, { max: 3 });
  const Spot = index(Costs);
</script>

<script input>
  const costs = Costs;
</script>

<script algorithm>
  for (@start[let k = Spot(costs, 0)]; @more[k < costs.length]; @next[k++]) @fill{
    @set[costs[k] = Distance(Cost(12));]
  }
</script>

<View of="Cost" name="CostText"><Node value={this} /></View>
<View of="Unknown" name="Infinity"><Node>∞</Node></View>
<View of="Costs" name="CostRow"><Node layout="row">{#each this as c}{c}{/each}</Node></View>

<Layout name="Main" of="costs">
  <Node layout="column">
    {costs}
  </Node>
</Layout>

<Case name="main" costs={['unknown', 'unknown', 'unknown']} />
<Storyboard>
  <Scene name="s" case="main" pause="@fill.set"><Main /></Scene>
</Storyboard>`;

type Box = { x: number; y: number; width: number; height: number };
const centre = ({ x, y, width, height }: Box) => [x + width / 2, y + height / 2];

describe("a union's members", () => {
  it('centre words in the slot they share with a larger value, as a value is centred', async () => {
    const { steps } = await drawnSteps(costs);
    const infinity = steps[0].nodes.find((node) => node.kind === 'Infinity');
    const run = (infinity as { runs?: { box: Box }[] } | undefined)?.runs?.[0];
    expect(infinity && run).toBeTruthy();
    const [boxX, boxY] = centre(infinity!.box);
    const [runX, runY] = centre(run!.box);
    expect(Math.abs(boxX - runX)).toBeLessThan(0.5);
    expect(Math.abs(boxY - runY)).toBeLessThan(0.5);
  });
});
