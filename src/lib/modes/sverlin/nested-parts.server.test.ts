/**
 * What a moving pointer mark holds moves with it, and no other mark's: where two pointers meet,
 * their marks nest, and the parts of the inner one are not the outer one's.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { drawnSteps } from './testing/scenes';
import { drawnScene, pairNodes, sceneBetween } from './library/scene-render';

const source = readFileSync(
  new URL('./fixtures/insertion-decisions.sverlin', import.meta.url),
  'utf8'
);

describe('pointer marks that meet', () => {
  it("moves a pointer's arrow and caption with its own mark as it leaves a cell another pointer marks", async () => {
    const { steps, built } = await drawnSteps(source, {
      chosen: { 'Cells.Sorted.fill': 'neutral-100', 'Cells.Sorted.radius': 4 }
    });
    const labels = (built as unknown as { steps: string[] }).steps;
    const at = labels.indexOf('@insert.scan.swap#3');
    expect(labels[at - 1]).toBe('@insert.scan.cmp#4');
    const from = drawnScene(steps[at - 1]);
    const to = drawnScene(steps[at]);
    const pairs = pairNodes(from, to);
    const pointerOf = (id: string) => /@pointer(\d+)/u.exec(id)?.[1];
    const parts = to.nodes.filter(({ kind }) => kind === 'Mark.Tip' || kind === 'Mark.Caption');
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      const was = pairs.get(part.key);
      expect(was, `${part.id} pairs with a part of the step before`).toBeDefined();
      expect(pointerOf(was!.id)).toBe(pointerOf(part.id));
    }
  });

  it("draws a swapped cell over the next slot's shading as it passes, not under it", async () => {
    const { steps, built } = await drawnSteps(source, {
      chosen: { 'Cells.Sorted.fill': 'neutral-100', 'Cells.Sorted.radius': 4 }
    });
    const labels = (built as unknown as { steps: string[] }).steps;
    const at = labels.indexOf('@insert.scan.swap#7');
    const from = drawnScene(steps[at - 1]);
    const to = drawnScene(steps[at]);
    const half = sceneBetween(from, to, 0.5);
    const order = half.nodes.map(({ key }) => key);
    const shades = half.nodes.filter(({ kind }) => kind === 'Cells.Sorted');
    const pairs = pairNodes(from, to);
    const moved = to.nodes.filter(({ kind, key, box }) => {
      const was = pairs.get(key);
      return kind === 'IntColumn' && was && Math.abs(was.box.x - box.x) > 1;
    });
    expect(moved.length).toBeGreaterThan(0);
    for (const cell of moved)
      for (const shade of shades)
        expect(order.indexOf(cell.key)).toBeGreaterThan(order.indexOf(shade.key));
  });
});
