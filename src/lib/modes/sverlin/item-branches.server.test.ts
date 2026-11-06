import { describe, expect, it } from 'vitest';

import insertion from './fixtures/insertion-decisions.sverlin?raw';
import { drawnSteps } from './testing/scenes';

// The demo's insertion sort with a third pointer, j - 1, as the assistant added it on 6 November:
// a state variable that goes to -1 when j reaches the front, drawn only while j > 0. Each cell is
// an item drawn by one node in each branch of an {#if} (Sorted or Unsorted).
const withPrevious = insertion
  .replace('@init[let j = i;]', '@init[let j = i;\n    let previous = Position(j - 1);]')
  .replace('@down[j--;]', '@down[j--;\n        previous = j - 1;]')
  .replace(
    '<Layout name="Main" of="values, i, j">',
    '<Layout name="Main" of="values, i, j, previous">'
  )
  .replace('{j}\n', '{j}\n    {#if j > 0}{previous}{/if}\n');

describe('an item drawn by one node in each branch of an {#if}', () => {
  it('keeps its end slots beside the items, so each cell keeps one size and its marks one lane', async () => {
    expect(withPrevious).toContain('{previous}');
    const { steps, frame } = await drawnSteps(withPrevious, {
      chosen: { Cells: { Sorted: { fill: 'neutral-100', radius: 4 } } }
    });
    // Before, the first cell's node held the end slot's copy of every mark above its own, so each
    // cell was 1011 px tall and the frame 1367.
    expect(frame.height).toBeLessThan(1000);
    const lanes = new Map<string, Set<number>>();
    for (const step of steps) {
      const cells = step.nodes.filter((node) => /^Cells\.(Sorted|Unsorted)$/.test(node.kind ?? ''));
      if (!cells.length) continue;
      expect(new Set(cells.map((cell) => Math.round(cell.box.height))).size).toBe(1);
      expect(new Set(cells.map((cell) => Math.round(cell.box.y))).size).toBe(1);
      // The marked cell sits at the top of its node in every cell, the first included.
      for (const pointed of step.nodes.filter((node) => node.kind === 'Mark.Pointed'))
        expect(Math.round(pointed.box.y)).toBe(Math.round(cells[0].box.y));
      for (const caption of step.nodes.filter((node) => node.kind === 'Mark.Caption')) {
        const name = (caption.runs ?? []).map(({ text }) => text).join('');
        lanes.set(name, (lanes.get(name) ?? new Set()).add(Math.round(caption.box.y)));
      }
    }
    // Each pointer's caption keeps one lane, whether its cell is sorted or not.
    expect([...lanes.keys()].sort()).toEqual(['i', 'j', 'previous']);
    for (const ys of lanes.values()) expect(ys.size).toBe(1);
  });
});
