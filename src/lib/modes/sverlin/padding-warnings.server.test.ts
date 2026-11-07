/**
 * Padding nobody sees is told to the assistant, a look only (see padding-warnings.server.ts): on a
 * page's nodes written without a kind, which take the page's margin, on a node arranging others
 * with no box, and on a node that never shows a box; not where a pointer paints it, links end at
 * it, it is small, or it shows a box at some step.
 */

import { describe, expect, it } from 'vitest';

import type { SceneNode, SceneStep } from './library';
import { designOnlyWarning, paddingWarnings } from './padding-warnings.server';
import { drawnSteps } from './testing/scenes';
import type { BuildWarning } from './warnings';

const look = { color: 'black', font: 'Vis Sans', fontSize: 16, fontWeight: 400 };
const node = (id: string, kind: string, more: Partial<SceneNode> = {}): SceneNode => ({
  id,
  kind,
  box: { x: 0, y: 0, width: 60, height: 60 },
  look: { ...look, padding: [6, 6, 6, 6] },
  ...more
});
const steps = (...each: SceneNode[][]): SceneStep[] => each.map((nodes) => ({ nodes, links: [] }));
const padded = { 'Cell.padding': 0.375, 'Row.padding': 0.5, 'Main.padding': 1.5 };

describe('padding warnings', () => {
  it('tells a node that never shows a box, and a node arranging others with none', () => {
    const warnings = paddingWarnings(
      steps([node('1:1', 'Cell'), node('2:1', 'Row', { layout: 'row' })]),
      { Cell: 'value', Row: 'container' },
      padded,
      new Set()
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^Row \(padding 0\.5\) arranges other nodes with no box/u);
    expect(warnings[1]).toMatch(/^Cell \(padding 0\.375\) has padding but never shows/u);
    expect(warnings.every((warning) => warning.endsWith(designOnlyWarning))).toBe(true);
  });

  it('leaves a node that shows a box at some step, links end at, or is small', () => {
    const roles = { Cell: 'value', Vertex: 'vertex' } as const;
    const pages = new Set<string>();
    const boxedLater = steps(
      [node('1:1', 'Cell')],
      [node('1:1', 'Cell', { look: { ...look, fill: 'white', padding: [6, 6, 6, 6] } })]
    );
    expect(paddingWarnings(boxedLater, roles, padded, pages)).toEqual([]);
    const vertex = steps([node('1:1', 'Vertex')]);
    expect(paddingWarnings(vertex, roles, { 'Vertex.padding': 0.5 }, pages)).toEqual([]);
    const small = steps([node('1:1', 'Cell', { box: { x: 0, y: 0, width: 28, height: 36 } })]);
    expect(paddingWarnings(small, roles, padded, pages)).toEqual([]);
    expect(
      paddingWarnings(steps([node('1:1', 'Cell')]), roles, { 'Cell.padding': 0 }, pages)
    ).toEqual([]);
  });

  it("tells a page's nodes written without a kind, which take the page's margin as padding", () => {
    const warnings = paddingWarnings(
      steps([node('3:3', 'Main', { layout: 'row', parent: '2:1' })]),
      { Main: 'container' },
      padded,
      new Set(['Main'])
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Main \(padding 1\.5\): a page's padding is its margin/u);
  });

  it("tells nothing of the page's root itself, as a grid that is the page", () => {
    const warnings = paddingWarnings(
      steps([node('2:1', 'Main', { layout: 'grid' })]),
      { Main: 'container' },
      padded,
      new Set(['Main'])
    );
    expect(warnings).toEqual([]);
  });
});

const page = (inner: string) => `<script domain>
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
<View of="Values" name="Cells"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Position" name="PositionText"><Node value={this} /></View>
<Layout name="Main">
  <Node layout="column">
    ${inner}
  </Node>
</Layout>
<Storyboard>
  <Scene name="main" case="main" pause="@visit.look"><Main /></Scene>
</Storyboard>`;

describe('padding warnings of a build', () => {
  it("tells a row a page holds without a kind, which takes the page's margin", async () => {
    const { built } = await drawnSteps(
      page('<Node layout="row">{values}<Node>at {i}</Node></Node>')
    );
    expect(
      built.warnings
        ?.map(({ message }) => message)
        .some((warning) => warning.startsWith('Main (padding 1.5)'))
    ).toBe(true);
  });

  it('tells nothing where the page holds only nodes of kinds of their own', async () => {
    const { built } = await drawnSteps(
      page('<Node kind="Panel" layout="row">{values}<Node kind="Caption">at {i}</Node></Node>')
    );
    expect(
      built.warnings
        ?.map(({ message }) => message)
        .filter((warning) => warning.endsWith(designOnlyWarning)) ?? []
    ).toEqual([]);
  });

  it('tells nothing of a grid that is the page, and tells a cell in it without a kind', async () => {
    const grid = (cell: string) =>
      page('').replace(
        '<Node layout="column">\n    \n  </Node>',
        `<Node layout="grid">
    <Node kind="Title" row={0}>Values</Node>
    {#each values as v, k}${cell}{/each}
  </Node>`
      );
    const pageWarning = (warnings: BuildWarning[] | undefined) =>
      (warnings ?? [])
        .map(({ message }) => message)
        .filter((warning) => warning.startsWith('Main (padding'));
    const kinded = await drawnSteps(grid('<Node kind="Cell" row={1} col={k}>{v}</Node>'));
    expect(pageWarning(kinded.built.warnings)).toEqual([]);
    const bare = await drawnSteps(grid('<Node row={1} col={k} layout="row">{v}</Node>'));
    expect(pageWarning(bare.built.warnings)).toHaveLength(1);
  });

  it("pads a caption token's code inside its tint", async () => {
    const { steps: drawn } = await drawnSteps(
      page('<Node kind="Caption">Inspect :i[values[i]] at {i}.</Node>{values}')
    );
    const code = drawn.flatMap(({ nodes }) => nodes).find(({ kind }) => kind?.endsWith('.Code'));
    expect(code?.look.fill).toBeDefined();
    expect(code?.look.padding?.every((side) => side > 0)).toBe(true);
  });
});
