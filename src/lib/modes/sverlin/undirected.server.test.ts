/**
 * Links whose direction follows from the data, in the scenes the server draws: one <Link> joining
 * two elements both ways at the same steps is one line, whose head starts as none.
 */

import { expect, it } from 'vitest';

import undirected from './fixtures/bfs-undirected.sverlin?raw';
import { pausingEveryLabel } from './testing/every-pause';
import { drawnSteps, edgeOf } from './testing/scenes';

/** The links each step of a source draws, each as written, with a head or not; hidden ones are not drawn. */
async function linksAtEachStep(source: string) {
  const { steps } = await drawnSteps(pausingEveryLabel(source));
  return {
    steps: steps.map((step) =>
      step.links
        .map((link) => ({ edge: edgeOf(link), head: !!link.heads?.end, shown: true }))
        .sort((a, b) => a.edge.localeCompare(b.edge))
    ),
    errors: [] as string[]
  };
}

it(
  'draws an edge listed from both its ends as one line, and one listed from its source as an arrow',
  { timeout: 60_000 },
  async () => {
    const both = await linksAtEachStep(undirected);
    const lines = [
      'vertices[0] - vertices[1]',
      'vertices[0] - vertices[2]',
      'vertices[1] - vertices[3]',
      'vertices[2] - vertices[3]',
      'vertices[3] - vertices[4]'
    ];
    for (const step of both.steps)
      expect(step).toEqual(lines.map((edge) => ({ edge, head: false, shown: true })));
    expect(both.errors).toEqual([]);

    const directed = await linksAtEachStep(
      undirected.replace('[[1, 2], [0, 3], [0, 3], [1, 2, 4], [3]]', '[[1, 2], [3], [3], [4], []]')
    );
    for (const step of directed.steps)
      expect(step).toEqual(
        [
          'vertices[0] -> vertices[1]',
          'vertices[0] -> vertices[2]',
          'vertices[1] -> vertices[3]',
          'vertices[2] -> vertices[3]',
          'vertices[3] -> vertices[4]'
        ].map((edge) => ({ edge, head: true, shown: true }))
      );
    expect(directed.errors).toEqual([]);
  }
);

it(
  'keeps both ways arrows at every step where they are not shown at the same steps',
  { timeout: 60_000 },
  async () => {
    // Each vertex draws its links once it is seen, so A–B shows from A at once, from B later.
    const { steps, errors } = await linksAtEachStep(
      undirected.replace(
        '{#each neighbours[k] as w}\n        <Link from={k} to={w} />\n      {/each}',
        '{#if vertex.seen}{#each neighbours[k] as w}<Link from={k} to={w} />{/each}{/if}'
      )
    );
    const drawn = steps.flat();
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every(({ head }) => head)).toBe(true);
    // At the first step only A's links show; by the last, every vertex draws each of its own.
    expect(steps[0].filter(({ shown }) => shown).map(({ edge }) => edge)).toEqual([
      'vertices[0] -> vertices[1]',
      'vertices[0] -> vertices[2]'
    ]);
    expect(steps.at(-1)?.filter(({ shown }) => shown)).toHaveLength(10);
    expect(errors).toEqual([]);
  }
);

it(
  'draws partners naming each other in a row as one line over the cells',
  { timeout: 60_000 },
  async () => {
    const pairs = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Position = index(Values);
  const Partners = array(Position, { max: 8 });
</script>
<script input>
  const values = Values;
  const partner = Partners;
</script><Case name="main" values={[3, 1, 4, 1]} partner={[1, 0, 3, 2]} />
<script algorithm>
  @start[let i = Position(0);]
  @next[i = Position(1);]
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<Layout name="Cells">
  <Node layout="row">
    {#each values as v, k}{v}<Link from={k} to={partner[k]} />{/each}
  </Node>
</Layout>

<Layout name="Main">
  <Node>
    <Cells />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main /></Scene>
</Storyboard>`;
    const { steps, errors } = await linksAtEachStep(pairs);
    for (const step of steps)
      expect(step).toEqual([
        { edge: 'values[0] - values[1]', head: false, shown: true },
        { edge: 'values[2] - values[3]', head: false, shown: true }
      ]);
    expect(errors).toEqual([]);
  }
);
