import { describe, expect, it } from 'vitest';

import linearSearch from './fixtures/links/linear-search.sverlin?raw';
import listReverse from './fixtures/links/list-reverse.sverlin?raw';
import type { SceneBox, SceneNode, SceneStep } from './library';
import { drawnSteps } from './testing/scenes';

/** The links each step draws from a variable's own node: those whose start names no element. */
const fromVariables = (step: SceneStep) => step.links.filter(({ from }) => !from.includes('['));
const painted = (step: SceneStep) =>
  step.nodes.filter(({ colours }) => colours?.fill === 'amber-100');
const centre = ({ x, y, width, height }: SceneBox) => ({ x: x + width / 2, y: y + height / 2 });
const boxesBy = (steps: SceneStep[], keep: (node: SceneNode) => boolean) => {
  const boxes = new Map<string, SceneBox[]>();
  for (const step of steps)
    for (const node of step.nodes.filter(keep)) {
      const key = `${node.id}|${node.identity ?? ''}`;
      boxes.set(key, [...(boxes.get(key) ?? []), node.box]);
    }
  return boxes;
};

describe('a link from a variable', () => {
  it('runs from the node drawing the variable to the element it points at, at every step', async () => {
    const { steps } = await drawnSteps(linearSearch);
    // :before draws no i; then i = 0, 1, … 5, and past the end, at the step reporting not found.
    expect(steps.map((step) => fromVariables(step).map(({ from, to }) => `${from}>${to}`))).toEqual(
      [
        [],
        ['i>values[0]'],
        ['i>values[1]'],
        ['i>values[2]'],
        ['i>values[3]'],
        ['i>values[4]'],
        ['i>values[5]'],
        ['i>values[6]'],
        ['i>values[6]']
      ]
    );
  });

  it('paints the element it reaches while it is drawn, and nothing else', async () => {
    const { steps } = await drawnSteps(linearSearch);
    for (const step of steps) {
      const links = fromVariables(step).filter(({ to }) => to !== 'values[6]');
      expect(painted(step)).toHaveLength(links.length);
      for (const node of painted(step)) {
        const end = links[0].curve?.[3];
        expect(end && Math.abs(end.x - centre(node.box).x)).toBeLessThan(1);
      }
    }
  });

  it('reaches a dashed ghost one step past the last element', async () => {
    const { steps } = await drawnSteps(linearSearch);
    const last = steps.at(-1) as SceneStep;
    const ghost = last.nodes.find(({ id }) => id.endsWith(':ghost'));
    const cells = last.nodes
      .filter(({ kind }) => kind === 'IntCell')
      .filter(({ box }) => Math.abs(box.y - (ghost?.box.y ?? NaN)) < 1)
      .map(({ box }) => box)
      .toSorted((a, b) => a.x - b.x);
    expect(ghost?.look.strokeStyle).toBe('dashed');
    expect(ghost?.look.fill).toBeUndefined();
    const pitch = cells[1].x - cells[0].x;
    expect(
      Math.abs((ghost as SceneNode).box.x - (cells.at(-1) as SceneBox).x - pitch)
    ).toBeLessThan(1);
    expect(
      steps.slice(0, -2).some((step) => step.nodes.some(({ id }) => id.endsWith(':ghost')))
    ).toBe(false);
  });

  it('moves no element as it comes and goes, in a grid and in a free layout', async () => {
    for (const source of [linearSearch, listReverse]) {
      const { steps } = await drawnSteps(source);
      const kept = boxesBy(steps, ({ kind }) => kind === 'IntCell' || kind === 'NodeBox');
      expect(kept.size).toBeGreaterThan(0);
      for (const boxes of kept.values())
        for (const box of boxes) {
          expect(box.x).toBeCloseTo(boxes[0].x, 1);
          expect(box.y).toBeCloseTo(boxes[0].y, 1);
        }
    }
  });

  it('in a free layout, puts the variable under the element it reaches, in room kept there', async () => {
    const { steps } = await drawnSteps(listReverse);
    for (const step of steps)
      for (const link of fromVariables(step)) {
        const start = link.curve?.[0];
        const end = link.curve?.[3];
        // A short arrow straight up from under the node.
        expect(start && end && start.y > end.y).toBe(true);
        expect(start && end && Math.abs(start.x - end.x)).toBeLessThan(2);
        const vars = step.nodes.filter(({ kind }) => kind === 'Main.Var' || kind?.endsWith('.Var'));
        const nodes = step.nodes.filter(({ kind }) => kind === 'NodeBox');
        for (const label of vars)
          for (const node of nodes) {
            const a = label.box;
            const b = node.box;
            const overlaps =
              a.x < b.x + b.width &&
              b.x < a.x + a.width &&
              a.y < b.y + b.height &&
              b.y < a.y + a.height;
            expect(overlaps).toBe(false);
          }
      }
  });
});
