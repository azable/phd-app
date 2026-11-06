import { describe, expect, it } from 'vitest';
import { drawnSteps } from './testing/scenes';

/** An insertion sort whose page is one grid: values on row 0, marks on rows below. */
const sort = (cells: string, extraViews = '') => `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 5 });
  const Position = index(Values);
</script>

<script input>
  const values = Values;
</script>

<script algorithm>
  for (@start[let i = Position(1)]; @more[i < values.length]; @next[i++]) @insert{
    @init[let j = i;]
    while (@front[j > 0]) @scan{
      if (@cmp[values[j - 1] > values[j]]) @swap{
        @exchange[const held = values[j - 1]; values[j - 1] = values[j]; values[j] = held;]
        @down[j--;]
      } else @stop{ break; }
    }
  }
</script>

<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Position" name="Arrow">
  <Node layout="column"><Node kind="Tip" icon /><Node kind="Caption">mark</Node></Node>
</View>
${extraViews}
<Layout name="Main" of="values, i, j">
  <Node layout="grid">
${cells}
  </Node>
</Layout>

<Case name="main" values={[5, 2, 4, 1, 3]} />
<Storyboard>
  <Scene name="sort" case="main" pause="@insert.init, @insert.scan.cmp, @insert.scan.swap"><Main /></Scene>
</Storyboard>`;

const valuesRow = `    {#each values as v, k}<Node row={0} col={k}>{v}</Node>{/each}`;

/** The boxes of a step's nodes of one kind, left to right. */
const boxes = (step: { nodes: { kind?: string; box: { x: number; y: number } }[] }, kind: string) =>
  step.nodes
    .filter((node) => node.kind === kind)
    .map(({ box }) => box)
    .sort((a, b) => a.x - b.x);

describe('the grid', () => {
  it('can be a page layout’s root, its cells keeping their rows and columns', async () => {
    const { steps } = await drawnSteps(
      sort(`${valuesRow}
    <Node row={1} col={i}>{i}</Node>
    <Node row={2} col={j}>{j}</Node>`)
    );
    const step = steps[1];
    const cells = boxes(step, 'IntCell');
    expect(cells).toHaveLength(5);
    expect(new Set(cells.map(({ y }) => Math.round(y))).size).toBe(1);
    const tips = step.nodes.filter((node) => node.kind === 'Arrow.Tip').map(({ box }) => box);
    expect(tips.length).toBe(2);
    expect(tips.every(({ y }) => y > cells[0].y)).toBe(true);
  });

  it('refuses props on a grid root other than its layout', async () => {
    await expect(
      drawnSteps(
        sort(valuesRow).replace('<Node layout="grid">', '<Node layout="grid" kind="Board">')
      )
    ).rejects.toThrow(/page's grid: its only prop is layout="grid"/u);
  });
});

describe('typed grid coordinates', () => {
  it('places cells by a position, an expression over one, a loop index and a literal, with no warning', async () => {
    const { built } = await drawnSteps(
      sort(`${valuesRow}
    <Node row={1} col={i}>{i}</Node>
    <Node row={2} col={j + 1}>{j}</Node>
    <Node row={3} col={2}>key</Node>`)
    );
    expect(built.warnings ?? []).not.toContainEqual(expect.stringMatching(/cannot work out/u));
  });

  it('warns of a coordinate whose values the build cannot work out, and still places it', async () => {
    const { steps, built } = await drawnSteps(
      sort(`${valuesRow}
    <Node row={1} col={values.length - 1}>last</Node>`)
    );
    expect(built.warnings).toContainEqual(
      expect.stringMatching(/^col=\{values\.length - 1\} takes values the build cannot work out/u)
    );
    expect(steps[1].nodes.some((node) => node.runs?.some((run) => run.text === 'last'))).toBe(true);
  });
});
