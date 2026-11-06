import { describe, expect, it } from 'vitest';

import bfsVisitOrder from './fixtures/bfs-visit-order.sverlin?raw';
import linearSearch from './fixtures/linear-search.sverlin?raw';
import listReverse from './fixtures/list-markers.sverlin?raw';
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
          for (const node of nodes) expect(overlap(label.box, node.box)).toBe(false);
      }
  });

  it('puts a follower below all its element’s child draws, so its arrow crosses none of it', async () => {
    const { steps } = await drawnSteps(bfsVisitOrder);
    let followed = 0;
    for (const step of steps) {
      const captions = step.nodes.filter(({ kind }) => kind === 'Graph.IndexLabel');
      for (const link of fromVariables(step)) {
        const start = link.curve?.[0] as { x: number; y: number };
        const end = link.curve?.[3] as { x: number; y: number };
        // Straight up, its head ending just under a vertex's index number, crossing none.
        const caption = captions
          .filter(({ box }) => Math.abs(end.x - (box.x + box.width / 2)) < 40 && end.y >= box.y)
          .toSorted((a, b) => b.box.y - a.box.y)[0];
        const under = caption ? end.y - (caption.box.y + caption.box.height) : NaN;
        expect(under).toBeGreaterThanOrEqual(0);
        expect(under).toBeLessThan(20);
        expect(start.y).toBeGreaterThan(end.y);
        for (const { box } of captions)
          expect(overlap(box, { x: start.x, y: end.y, width: 0.1, height: start.y - end.y })).toBe(
            false
          );
        followed++;
      }
      // Two followers under one vertex sit side by side.
      const vars = step.nodes.filter(({ follows }) => follows);
      for (const a of vars)
        for (const b of vars) if (a !== b) expect(overlap(a.box, b.box)).toBe(false);
    }
    expect(followed).toBeGreaterThan(0);
  });

  it('draws a follower in its own look, not as a graph’s vertex', async () => {
    const { steps } = await drawnSteps(bfsVisitOrder);
    const vertex = steps[1].nodes.find(({ kind }) => kind === 'VertexCard');
    const followers = steps.flatMap((step) => step.nodes.filter(({ follows }) => follows));
    expect(followers.length).toBeGreaterThan(0);
    for (const { look } of followers) {
      expect(look.radius ?? 0).toBeLessThan(vertex?.look.radius ?? Infinity);
      expect(look.fill).toBeUndefined();
    }
  });

  it('waits in a row under the layout while its variable reaches nothing, moving no node', async () => {
    const { steps } = await drawnSteps(listReverse);
    const nodes = steps.flatMap((step) => step.nodes.filter(({ kind }) => kind === 'NodeBox'));
    const below = Math.max(...nodes.map(({ box }) => box.y + box.height));
    // prev holds the end from the start until the first advance, and cur once the loop is done.
    const waiting = steps.map((step) =>
      step.nodes.filter(
        ({ kind, follows, box }) => kind === 'Nodes.Var' && !follows && box.y > below
      )
    );
    expect(waiting[1]).toHaveLength(1);
    expect(waiting.at(-1)).toHaveLength(1);
    // One row, starting at one place; labels waiting together sit side by side in it.
    const tops = new Set(waiting.flat().map(({ box }) => Math.round(box.y)));
    const starts = new Set(
      waiting.flatMap((step) =>
        step.length ? [Math.round(Math.min(...step.map(({ box }) => box.x)))] : []
      )
    );
    expect(tops.size).toBe(1);
    expect(starts.size).toBe(1);
    for (const step of waiting)
      for (const a of step)
        for (const b of step) if (a !== b) expect(overlap(a.box, b.box)).toBe(false);
  });

  it('names the place a union is drawn at with place(), in its member’s view', async () => {
    const { steps } = await drawnSteps(listReverse);
    const captions = new Set(
      steps.flatMap((step) =>
        step.nodes
          .filter(({ kind }) => kind === 'RefArrow.Caption')
          .flatMap(({ runs }) => runs?.map(({ text }) => text) ?? [])
      )
    );
    expect([...captions].toSorted()).toEqual(['cur', 'next', 'prev']);
  });
});

function overlap(a: SceneBox, b: SceneBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
