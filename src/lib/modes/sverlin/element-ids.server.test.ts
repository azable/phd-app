/**
 * Every node a step draws is named by its tag's line and column in the source as written, so a
 * participant's selection of it is found there (see element-ref.ts), whatever the compiler wrote
 * around the tag: <When> for a node's `when`, a caption token's code node, inline maths.
 */

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

import { locateElement } from './element-ref';
import { drawnSteps } from './testing/scenes';

/** Every id a source's steps draw, its render count dropped, that names no tag where written. */
async function unlocated(source: string): Promise<string[]> {
  const { steps } = await drawnSteps(source);
  const ids = new Set(
    steps.flatMap(({ nodes }) =>
      nodes.filter(({ kind }) => !kind?.startsWith('listing')).map(({ id }) => id)
    )
  );
  return [...ids].filter((id) => /^\d+:\d+/u.test(id) && !locateElement(source, id));
}

const shown = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 4 });
  const Position = index(Values);
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[3, 1, 2]} />
<script algorithm>
  for (@first[let i = Position(0)]; @more[i < values.length]; @next[i++]) @visit{
    @look[values[i] = values[i];]
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Position" name="PositionText"><Node value={this} /></View>
<Layout name="Main" of="values, i">
  <Node layout="column">
    <Node when="@visit.look">Inspect :i[values[i]], $$x^2$$, at {i}.</Node>
    <Node>Then <Node kind="Note" when="@visit.look">look again</Node> and <Node kind="Dot" when="@visit" /></Node>
    <Node>{#each values as v}{v}{/each}</Node>
  </Node>
</Layout>
<Storyboard>
  <Scene name="main" case="main" pause="@visit.look"><Main /></Scene>
</Storyboard>`;

it('names a node shown only at a label, at the start of a line and inline, where it is written', async () => {
  expect(await unlocated(shown)).toEqual([]);
  // The token's code node and the maths are drawn, and named where they are written too.
  const { steps } = await drawnSteps(shown);
  const kinds = new Set(steps.flatMap(({ nodes }) => nodes.map(({ kind }) => kind)));
  expect([kinds.has('Main.Code'), kinds.has('Main.Math')]).toEqual([true, true]);
});

it.each(['bfs-captions', 'ucs-compare', 'dijkstra-costs'])(
  'names every node of %s, which shows nodes only at labels, where it is written',
  async (fixture) => {
    const source = readFileSync(`src/lib/modes/sverlin/fixtures/${fixture}.sverlin`, 'utf8');
    expect(await unlocated(source)).toEqual([]);
  }
);
