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
const boxes = (
  step: {
    nodes: { kind?: string; box: { x: number; y: number; width: number; height: number } }[];
  },
  kind: string
) =>
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
    expect(step.nodes.filter(({ id, parent }) => id === parent)).toEqual([]);
  });

  it('refuses props on a grid root other than its layout', async () => {
    await expect(
      drawnSteps(
        sort(valuesRow).replace('<Node layout="grid">', '<Node layout="grid" kind="Board">')
      )
    ).rejects.toThrow(/page's grid: its only prop is layout="grid"/u);
  });
});

describe('coordinates outside the range', () => {
  const marks = sort(`${valuesRow}
    <Node row={1} col={j}>{j}</Node>
    <Node row={2} col={j - 1}>{j - 1}</Node>`);

  it('extends the grid by a track before the first cell, so j - 1 at −1 has a place', async () => {
    const { steps, built } = await drawnSteps(marks);
    const labels = (built as { steps: string[] }).steps;
    const front = steps.findIndex((_, k) => labels[k].startsWith('@insert.scan.swap'));
    expect(front).toBeGreaterThan(0);
    // After the first swap j is 0, so j - 1 is −1: a position, drawn as a mark through its view,
    // left of every value cell.
    const step = steps[front];
    const cells = boxes(step, 'IntCell');
    const [before] = boxes(step, 'Arrow.Tip');
    expect(before.x + before.width).toBeLessThanOrEqual(cells[0].x);
  });

  it('keeps every value cell where it is at every step', async () => {
    const { steps } = await drawnSteps(marks);
    const placed = steps
      .slice(1, -1)
      .map((step) => JSON.stringify(boxes(step, 'IntCell').map(({ x, y }) => [x, y])));
    expect(new Set(placed).size).toBe(1);
  });
});

describe('marks as grid cells', () => {
  it('draws a position in a cell placed by it through its view, with no position-in-node warning', async () => {
    const { steps, built } = await drawnSteps(
      sort(`${valuesRow}
    <Node row={1} col={i}>{i}</Node>`)
    );
    expect(built.warnings ?? []).not.toContainEqual(expect.stringMatching(/draws as its number/u));
    expect(steps[1].nodes.some((node) => node.kind === 'Arrow.Tip')).toBe(true);
  });
});

describe('spans', () => {
  const valuesBelow = `    {#each values as v, k}<Node row={1} col={k}>{v}</Node>{/each}`;
  const lefts = (step: Parameters<typeof boxes>[0]) =>
    boxes(step, 'IntCell').map(({ x }) => Math.round(x));

  it('spans every column where col is left out, as a title over the values, widening none', async () => {
    const plain = await drawnSteps(sort(valuesBelow));
    const titled = await drawnSteps(sort(`${valuesBelow}\n    <Node row={0}>ab</Node>`));
    expect(titled.built.warnings ?? []).not.toContainEqual(expect.stringMatching(/grid/u));
    expect(lefts(titled.steps[1])).toEqual(lefts(plain.steps[1]));
  });

  it('shares a spanning cell’s size equally over its tracks', async () => {
    const { steps } = await drawnSteps(
      sort(
        `${valuesBelow}\n    <Node row={0} col={1} colSpan={2}>a title wider than two cells</Node>`
      )
    );
    const [first, second, third, fourth] = lefts(steps[1]);
    // Each value sits centred in its column: columns 1 and 2 growing alike by e puts value 1 e/2
    // further from value 0, value 2 e further from value 1, and value 3 e/2 further from value 2.
    expect(Math.abs(second - first - (fourth - third))).toBeLessThanOrEqual(1);
    expect(third - second).toBeGreaterThan(second - first);
  });

  it('places a node with neither row nor col at (0, 0), and warns of two cells covering one', async () => {
    const { steps, built } = await drawnSteps(
      sort(`${valuesBelow}\n    <Node>one</Node>\n    <Node>two</Node>`)
    );
    expect(built.warnings).toContainEqual(
      expect.stringMatching(/^Two cells of a grid cover row 0, col 0 at one step/u)
    );
    const texts = steps[1].nodes.filter((node) =>
      node.runs?.some((run) => run.text === 'one' || run.text === 'two')
    );
    expect(texts).toHaveLength(2);
  });

  it('keeps a column as wide as its widest cell at any step, so it does not shrink for a shorter one', async () => {
    const { steps } = await drawnSteps(
      sort(
        `${valuesBelow}\n    {#each values as v, k}<Node row={0} col={k}>{k === j ? 'scanning' : '.'}</Node>{/each}`
      )
    );
    const placed = steps.slice(1, -1).map((step) => JSON.stringify(lefts(step)));
    expect(new Set(placed).size).toBe(1);
  });
});

describe('place() in a view drawn in a cell', () => {
  const named = (cells: string) =>
    sort(`${valuesRow}\n${cells}`).replace(
      '<Node kind="Caption">mark</Node>',
      '<Node kind="Caption">{place()}</Node>'
    );
  const captions = (step: { nodes: { kind?: string; runs?: { text: string }[] }[] }) =>
    step.nodes
      .filter((node) => node.kind === 'Arrow.Caption')
      .map((node) => (node.runs ?? []).map((run) => run.text).join(''))
      .sort();

  it('names a variable’s place, or gives the design’s label for it, with no <Pointed>', async () => {
    const source = named(
      `    <Node row={1} col={i}>{i}</Node>\n    <Node row={2} col={j}>{j}</Node>`
    );
    const { steps, built } = await drawnSteps(source);
    expect(built.warnings ?? []).not.toContainEqual(expect.stringMatching(/place\(\)/u));
    expect(captions(steps[1])).toEqual(['i', 'j']);
    const labelled = await drawnSteps(source, { chosen: { ':j.label': 'scan' } });
    expect(captions(labelled.steps[1])).toEqual(['i', 'scan']);
  });

  it('names a {@const} by its name, and an expression as it is written', async () => {
    const { steps } = await drawnSteps(
      named(`    {@const before = j - 1}
    <Node row={1} col={before}>{before}</Node>
    <Node row={2} col={j + 1}>{j + 1}</Node>`)
    );
    expect(captions(steps[1])).toEqual(['before', 'j + 1']);
  });

  it('hides a node reading a {@const} where a variable its value reads is absent, as a direct read does', async () => {
    const { steps } = await drawnSteps(
      named(`    {@const next = j + 1}
    {@const after = next + 1}
    <Node row={1} col={next}>{next}</Node>
    <Node row={2} col={after}>{after}</Node>
    <Node row={3} col={i}>{i}</Node>`)
    );
    // At :before, j and i do not exist yet: no mark draws, and the values still do.
    expect(captions(steps[0])).toEqual([]);
    expect(steps[0].nodes.filter((node) => node.kind === 'IntCell')).toHaveLength(5);
    expect(captions(steps[1])).toEqual(['after', 'i', 'next']);
  });
});

describe('kinds from expressions', () => {
  const kinded = sort(`    {#each values as v, k}
      <Node kind={k === j ? 'AtJ' : k < i ? 'Sorted' : undefined} row={0} col={k}>{v}</Node>
    {/each}
    <Node row={1} col={j}>{j}</Node>`);

  it('gives each cell the kind its expression names at that step, or the layout’s own', async () => {
    const { steps, built } = await drawnSteps(kinded, {
      chosen: { 'Main.AtJ.fill': 'amber-100', 'Main.Sorted.fill': 'neutral-100' }
    });
    expect(built.warnings ?? []).not.toContainEqual(expect.stringMatching(/no variable/u));
    // At @insert.init#1, i = j = 1: cell 0 is sorted, cell 1 is at j, the rest the layout's.
    const kinds = steps[1].nodes
      .filter((node) => node.parent && /^Main(\.|$)/u.test(node.kind ?? '') && node.box.y < 200)
      .map((node) => node.kind);
    expect(kinds).toContain('Main.AtJ');
    expect(kinds).toContain('Main.Sorted');
    const atJ = steps[1].nodes.find((node) => node.kind === 'Main.AtJ');
    expect(atJ?.colours?.fill).toBe('amber-100');
  });

  it('chooses a kind with each variable that is absent as undefined, still drawing the node', async () => {
    const { steps } = await drawnSteps(kinded.replace(': undefined}', ": 'Cell'}"));
    // At :before, i and j do not exist yet: k === j and k < i are false, so every cell is a Cell.
    const before = steps[0].nodes;
    expect(before.filter((node) => node.kind === 'IntCell')).toHaveLength(5);
    expect(before.filter((node) => node.kind === 'Main.Cell')).toHaveLength(5);
    expect(steps[1].nodes.some((node) => node.kind === 'Main.AtJ')).toBe(true);
  });

  it('reads a {@const} whose value reads an absent variable as undefined in a kind', async () => {
    const source = sort(`    {@const next = j + 1}
    {#each values as v, k}
      <Node kind={k === next ? 'AtNext' : 'Cell'} row={0} col={k}>{v}</Node>
    {/each}`);
    const { steps } = await drawnSteps(source);
    expect(steps[0].nodes.filter((node) => node.kind === 'Main.Cell')).toHaveLength(5);
    expect(steps[1].nodes.filter((node) => node.kind === 'Main.AtNext')).toHaveLength(1);
  });

  it('refuses a kind built from text at run time', async () => {
    await expect(
      drawnSteps(
        kinded.replace("kind={k === j ? 'AtJ' : k < i ? 'Sorted' : undefined}", "kind={'At' + k}")
      )
    ).rejects.toThrow(/every result is a name written in the source/u);
  });

  it('refuses a name that is no kind', async () => {
    await expect(drawnSteps(kinded.replace("'AtJ'", "'at j'"))).rejects.toThrow(
      /gives "at j", which is no kind/u
    );
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

describe('subgrids', () => {
  const centres = (step: Parameters<typeof boxes>[0], kind: string) =>
    boxes(step, kind).map(({ x, width }) => Math.round(x + width / 2));
  const cellsView = `<View of="Values" name="Cells"><Node layout="row">{#each this as v}{v}{/each}</Node></View>`;

  it('places {values} drawn by its view on the grid’s columns, values[k] in column k', async () => {
    const { steps, built } = await drawnSteps(
      sort(
        `    <Node row={0}>{values}</Node>
    <Node row={1} col={i}>{i}</Node>`,
        cellsView
      )
    );
    expect(built.warnings ?? []).not.toContainEqual(expect.stringMatching(/grid/u));
    const step = steps[1];
    const cells = centres(step, 'IntCell');
    expect(cells).toHaveLength(5);
    // i is 1 at @insert.init#1: its arrow is centred under values[1].
    const [tip] = centres(step, 'Arrow.Tip');
    expect(Math.abs(tip - cells[1])).toBeLessThanOrEqual(1);
  });

  it('numbers a key’s words down the rows, beside the cells they name', async () => {
    const { steps } = await drawnSteps(
      sort(`${valuesRow.replace('row={0}', 'row={1}')}
    <Node row={2} col={i}>{i}</Node>
    <Node col={-1}><Node>head</Node><Node>values</Node><Node>i</Node></Node>`)
    );
    const step = steps[1];
    const word = (text: string) =>
      step.nodes.find((node) => node.runs?.some((run) => run.text === text))?.box;
    const [cell] = boxes(step, 'IntCell');
    const middle = (box?: { y: number; height: number }) => (box ? box.y + box.height / 2 : NaN);
    const values = word('values');
    expect(
      Math.abs(middle(values) - middle({ ...cell, height: values ? cell.width : 0 }))
    ).toBeLessThan(cell.width);
    expect(word('i')!.y).toBeGreaterThanOrEqual(values!.y + values!.height);
    expect(word('head')!.y + word('head')!.height).toBeLessThanOrEqual(values!.y);
    expect(values!.x + values!.width).toBeLessThanOrEqual(cell.x);
  });

  it('warns that justify cannot spread a subgrid’s tracks', async () => {
    const { built } = await drawnSteps(
      sort(`    <Node kind="Band" row={0}>{#each values as v}<Node>{v}</Node>{/each}</Node>`),
      { chosen: { 'Main.Band.justify': 'between' } }
    );
    expect(built.warnings).toContainEqual(
      expect.stringMatching(/^A subgrid takes its grid's tracks/u)
    );
  });
});

describe('the basis', () => {
  const diagonal = sort(`    {#each values as v, k}<Node row={k} col={k}>{v}</Node>{/each}`);

  it('is square at the start, drawing a table', async () => {
    const { steps } = await drawnSteps(diagonal);
    const cells = boxes(steps[1], 'IntCell');
    expect(cells[1].x).toBeGreaterThanOrEqual(cells[0].x + cells[0].width);
    expect(cells[1].y).toBeGreaterThan(cells[0].y);
  });

  it('places each cell at col times its col vector plus row times its row vector', async () => {
    // A diamond: col runs right and down, row left and down, so cells on the diagonal fall in one
    // column, a pitch apart.
    const { steps, built } = await drawnSteps(diagonal, {
      chosen: { 'Main.colX': 0.5, 'Main.colY': 0.5, 'Main.rowX': -0.5, 'Main.rowY': 0.5 }
    });
    expect(built.warnings ?? []).not.toContainEqual(expect.stringMatching(/layout model/iu));
    const cells = boxes(steps[1], 'IntCell').sort((a, b) => a.y - b.y);
    expect(new Set(cells.map(({ x }) => Math.round(x))).size).toBe(1);
    const pitches = cells.slice(1).map((cell, k) => Math.round(cell.y - cells[k].y));
    expect(new Set(pitches).size).toBe(1);
    expect(pitches[0]).toBeGreaterThanOrEqual(Math.round(cells[0].height));
  });

  it('refuses a col and a row that are parallel', async () => {
    await expect(
      drawnSteps(diagonal, { chosen: { 'Main.rowX': 1, 'Main.rowY': 0 } })
    ).rejects.toThrow(/not parallel/u);
  });
});
