/** <When of="@label"> and <OneOf> in the scenes the server draws of each step. */

import { expect, it } from 'vitest';

import { pausingAt } from './testing/every-pause';
import { drawnSteps, isInside, ofKind } from './testing/scenes';

const insertion = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Position = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[5, 2, 4, 1]} />
<script algorithm>
  for (@first[let i = Position(1)]; @more[i < values.length]; @next[i++]) @insert{
    let j = i;
    while (@test[(Position(0) < j) && @compare[(values[@left[j - 1]]) > values[@right[j]]]]) @swap{
      const moved = values[@from[j - 1]];
      values[j - 1] = values[@to[j]];
      values[j] = moved;
      j--;
    }
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<Layout name="Caption"><Node>Swap</Node></Layout>
<Layout name="Board">
  <Node layout="column">
    <Node>{#each values as v}{v}{/each}</Node>
    <When of="@insert.swap"><Caption /></When>
  </Node>
</Layout>

<Layout name="Main">
  <Node>
    <Board />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main /></Scene>
</Storyboard>`;

/**
 * Each step's captions: whether "Swap" shows and where, whether the question does and where, and the
 * board's size and the row's cells' places, sorted.
 */
async function stepsOf(pause: string, count: number, source = insertion) {
  const { steps } = await drawnSteps(pausingAt(source, pause));
  return steps.slice(1, count + 1).map((step) => {
    const [caption] = ofKind(step, 'Caption');
    const [question] = ofKind(step, 'Ask');
    const [board] = ofKind(step, 'Board');
    const place = (node: { box: { y: number; height: number } } | undefined) =>
      node && `${Math.round(node.box.y + node.box.height / 2)}`;
    return {
      swap: !!caption,
      asked: !!question,
      at: { swap: place(caption), asked: place(question) },
      board: `${Math.round(board.box.width)}x${Math.round(board.box.height)}`,
      cells: ofKind(step, 'IntCell')
        .filter((cell) => !isInside(step, cell, question))
        .map(({ box }) => Math.round(box.x))
        .toSorted((a, b) => a - b)
    };
  });
}

it(
  'shows its contents at the steps inside a run of the label, keeping their room elsewhere',
  { timeout: 60_000 },
  async () => {
    // Coarse: each comparison, then each swap. "Swap" shows at the swaps alone. The first
    // comparison draws what the input as given drew, as the board draws no comparison, so it is
    // left out and the steps open on the first swap.
    const coarse = await stepsOf('@insert.test.compare, @insert.swap', 4);
    expect(coarse.map(({ swap }) => swap)).toEqual([true, false, true, false]);
    // The caption keeps its room where hidden, so the board and its cells stay put.
    expect(new Set(coarse.map(({ board }) => board)).size).toBe(1);
    expect(new Set(coarse.map(({ cells }) => cells.join())).size).toBe(1);
    // Fine, pausing at the swap's read of A[j] too: inside the swap's run, so "Swap" shows there.
    const fine = await stepsOf('@insert.test.compare, @insert.swap.to, @insert.swap', 4);
    expect(fine.map(({ swap }) => swap)).toEqual([true, true, false, true]);
  }
);

it(
  'draws a chain of branches in one place, each at its label’s steps',
  { timeout: 60_000 },
  async () => {
    const chained = insertion
      .replace(
        '<Layout name="Caption">',
        '<View of="Flag" name="FlagWord"><Node>{this ? \'yes\' : \'no\'}</Node></View>\n<View of="@insert.test.compare" name="Ask"><Node>Is {this.left} greater than {this.right}? {this.value}</Node></View>\n<Layout name="Caption">'
      )
      .replace(
        '<When of="@insert.swap"><Caption /></When>',
        '<OneOf><When of="@insert.test.compare">{@insert.test.compare}</When><When of="@insert.swap"><Caption /></When></OneOf>'
      )
      .replaceAll('of="values, @insert.swap"', 'of="values, @insert"');
    const steps = await stepsOf('@insert.test.compare, @insert.swap', 4, chained);
    // The question at each comparison, "Swap" at each swap, never both.
    expect(steps.map(({ asked, swap }) => [asked, swap])).toEqual([
      [true, false],
      [false, true],
      [true, false],
      [false, true]
    ]);
    // In one place: the question and "Swap" on one line, the board and its cells staying put.
    expect(steps[0].at.asked).toBe(steps[1].at.swap);
    expect(new Set(steps.map(({ board }) => board)).size).toBe(1);
    expect(new Set(steps.map(({ cells }) => cells.join())).size).toBe(1);
  }
);
