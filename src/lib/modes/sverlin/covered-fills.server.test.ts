/**
 * A fill the opaque fills inside its node cover at every step it shows is told to the assistant, a
 * look only (see covered-fills.server.ts): its kind's or a link end's; not where it shows at some
 * step, past a child's round corners, or through a translucent child.
 */

import { describe, expect, it } from 'vitest';

import { coveredFillWarnings } from './covered-fills.server';
import type { SceneLook, SceneNode, SceneStep } from './library';
import { designOnlyWarning } from './padding-warnings.server';
import { drawnSteps } from './testing/scenes';

const text = { color: 'black', font: 'Vis Sans', fontSize: 16, fontWeight: 400 };
const square = { x: 0, y: 0, width: 80, height: 80 };
const node = (
  id: string,
  kind: string,
  look: Partial<SceneLook> = {},
  more: Partial<SceneNode> = {}
): SceneNode => ({ id, kind, box: square, look: { ...text, ...look }, ...more });
const amber = { fill: 'oklch(0.928 0.07 70)' };
const white = { fill: '#ffffff' };
const at = node('1:1', 'Main.Board.AtI', amber, { colours: { fill: 'amber-200' } });
const cell = (look: Partial<SceneLook> = white, box = square) =>
  node('2:1', 'IntCell', look, { parent: '1:1', box, colours: { fill: 'white' } });
const steps = (...each: SceneNode[][]): SceneStep[] => each.map((nodes) => ({ nodes, links: [] }));

describe('covered fill warnings', () => {
  it("tells a fill a child's opaque fill covers, its round corners counted as covered", () => {
    const warnings = coveredFillWarnings(steps([at, cell({ ...white, radius: 12.8 })]));
    expect(warnings).toEqual([
      `\`Main.Board.AtI.fill\` (amber-200) is never seen: \`IntCell\` fills the whole box over it, in white. Give \`IntCell\` no fill, or put the colour on \`IntCell\`. ${designOnlyWarning}`
    ]);
  });

  it('leaves a fill that shows round a round child or its padding, or at some step', () => {
    expect(coveredFillWarnings(steps([at, cell({ ...white, radius: 40 })]))).toEqual([]);
    const inset = { x: 5, y: 5, width: 70, height: 70 };
    expect(coveredFillWarnings(steps([at, cell(white, inset)]))).toEqual([]);
    expect(coveredFillWarnings(steps([at, cell()], [at]))).toEqual([]);
  });

  it('leaves a fill under a child that lets it show: no fill, transparency, or opacity', () => {
    expect(coveredFillWarnings(steps([at, cell({})]))).toEqual([]);
    expect(coveredFillWarnings(steps([at, cell({ fill: 'rgb(255 255 255 / 0.5)' })]))).toEqual([]);
    expect(coveredFillWarnings(steps([at, cell({ ...white, opacity: 0.5 })]))).toEqual([]);
    const faint = node('0:1', 'Main.Board', { opacity: 0.5 });
    expect(coveredFillWarnings(steps([faint, { ...at, parent: '0:1' }, cell()]))).toEqual([]);
  });

  it('leaves a fill whose glow shows its colour round the box', () => {
    const glowing = { ...at, look: { ...at.look, glow: amber.fill } };
    expect(coveredFillWarnings(steps([glowing, cell()]))).toEqual([]);
  });

  it("names a link end's paint, and tells the keys one kind covers in one warning", () => {
    const painted = { ...at, paintedBy: 'Arrow.<Link>.<To>', colours: { fill: 'amber-100' } };
    const other = node('1:2', 'Main.Board.Cell', amber, { colours: { fill: 'neutral-100' } });
    const inOther = { ...cell(), id: '2:2', parent: '1:2' };
    const warnings = coveredFillWarnings(steps([painted, cell(), other, inOther]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^`Arrow\.<Link>\.<To>\.fill` \(amber-100\), `Main\.Board\.Cell\.fill` \(neutral-100\) are never seen: `IntCell` fills the whole box over each, in white\. Give `IntCell` no fill, or put the colours on `IntCell`\./u
    );
  });
});

const page = (cellView: string, pointer: boolean) => `<script domain>
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
${cellView}
<View of="Position" name="Arrow"><Node layout="column"><Link to={this} /><Node kind="Name">{place()}</Node></Node></View>
<Layout name="Main">
  <Node layout="column">
    <Node kind="Board" layout="grid">
      {#each values as v, k}<Node kind={k === i ? 'AtI' : 'Cell'} row={0} col={k}>{v}</Node>{/each}
      ${pointer ? `<Node kind="Lane" row={1} col={i}>{i}</Node>` : ''}
    </Node>
  </Node>
</Layout>
<Storyboard>
  <Scene name="main" case="main" pause="@visit.look.end"><Main /></Scene>
</Storyboard>`;

const covered = async (cellView: string, pointer = false, chosen: Record<string, string> = {}) => {
  const { built } = await drawnSteps(page(cellView, pointer), { chosen });
  return (built.warnings ?? []).filter(({ code }) => code === 'look.fill-covered');
};

describe('covered fill warnings of a build', () => {
  const intCell = '<View of="Int" name="IntCell"><Node value={this} /></View>';

  it("tells a grid cell's fill its value's white box covers, and not with the value's fill none", async () => {
    const warnings = await covered(intCell, false, { 'Main.Board.AtI.fill': 'amber-200' });
    expect(warnings.map(({ message }) => message)).toEqual([
      `\`Main.Board.AtI.fill\` (amber-200) is never seen: \`IntCell\` fills the whole box over it, in white. Give \`IntCell\` no fill, or put the colour on \`IntCell\`. ${designOnlyWarning}`
    ]);
    expect(
      await covered(intCell, false, { 'Main.Board.AtI.fill': 'amber-200', 'IntCell.fill': 'none' })
    ).toEqual([]);
  });

  it("tells a pointer's end painting a node its value's white box covers", async () => {
    const warnings = await covered(
      '<View of="Int" name="IntBox"><Node><Node kind="Inner" value={this} /></Node></View>',
      true
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(
      /^`Arrow\.<Link>\.<To>(:i)?\.fill` \([\w-]+\) is never seen: `IntBox\.Inner` fills the whole box over it/u
    );
    expect(await covered(intCell, true)).toEqual([]);
  });

  it("names a pointer's end as the cover where it paints the value over the fill", async () => {
    const warnings = await covered(intCell, true, { 'Main.Board.AtI.fill': 'amber-200' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(
      /^`Main\.Board\.AtI\.fill` \(amber-200\) is never seen: `Arrow\.<Link>\.<To>(:i)?` fills the whole box over it/u
    );
  });
});
