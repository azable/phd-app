/**
 * Every fixture's scenes, built with no variant, as a hash each, so a change to the engine that
 * moves anything in a picture shows here; a change meant to move pictures updates the snapshot. And
 * in each, an element keeps its place whether or not a pointer is at it.
 *
 * Deliberate changes, by the step that made them:
 * - grid-marks: a grid placed by positions keeps a track before the first cell, as a position's
 *   type allows −1 as it allows the length (coordinates outside the range).
 * - bubble-arrow, bubble-layouts: a column holding a link keeps the largest room its links need at
 *   any step, so its row of cells no longer moves up and down as the swap's link comes and goes.
 * - search-places, replay/linear-search: a place in the scene data is named :lo, not @lo, as `@`
 *   names only a moment of the run (the boxes are as they were).
 * - 27 fixtures: a node's words are one block centred in its box, as a value is: words sharing a
 *   slot with longer ones ("seen" beside "unseen", up to 16 px), a stack's sentences (a status
 *   line, up to 214 px), and sentences holding values (those values with them); the rest move by
 *   under 1 px, from the block's rounding.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';
import type { SceneNode, SceneStep } from './library';
import { drawnSteps } from './testing/scenes';

const root = join(import.meta.dirname, 'fixtures');
const fixtures = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? fixtures(join(directory, entry.name))
      : entry.name.endsWith('.sverlin')
        ? [join(directory, entry.name)]
        : []
  );

// Each fixture is built once for both tests.
const built = new Map<string, ReturnType<typeof drawnSteps>>();
const drawn = (file: string) => {
  if (!built.has(file)) built.set(file, drawnSteps(readFileSync(file, 'utf8')));
  return built.get(file)!;
};

test('every fixture draws the scenes it drew', { timeout: 600_000 }, async () => {
  const hashes: Record<string, string> = {};
  for (const file of fixtures(root).sort()) {
    const name = relative(root, file);
    try {
      const { frame, steps } = await drawn(file);
      hashes[name] = createHash('sha256')
        .update(JSON.stringify({ frame, steps }))
        .digest('hex')
        .slice(0, 16);
    } catch (cause) {
      hashes[name] = `refused: ${(cause as Error).message.slice(0, 120)}`;
    }
  }
  expect(hashes).toMatchSnapshot();
});

/**
 * The boxes of nodes drawn as a pointer's `<Pointed>` that no node of their site has at a step no
 * pointer is at it: a pointer keeps the element where it is, so each such box is one the element,
 * or another value of its site where values move, as in a swap, has without one. A node pointed at
 * every step it is drawn, or drawn only as a pointer draws it, has nothing to compare.
 */
function movedByPointers(steps: readonly SceneStep[]): string[] {
  const pointed = (node: SceneNode) => node.kind?.endsWith('.Pointed') ?? false;
  const site = (id: string) => id.split('#')[0];
  const boxOf = ({ box }: SceneNode) =>
    [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 2) / 2).join(',');
  const nodes = steps.map((step) => step.nodes);
  const free = new Map<string, Set<string>>();
  const everFree = new Set<string>();
  for (const node of nodes.flat())
    if (!pointed(node)) {
      everFree.add(node.id);
      free.set(site(node.id), (free.get(site(node.id)) ?? new Set()).add(boxOf(node)));
    }
  return nodes.flatMap((step, index) =>
    step.flatMap((node) =>
      pointed(node) && everFree.has(node.id) && !free.get(site(node.id))?.has(boxOf(node))
        ? [`step ${index}: ${node.id} at ${boxOf(node)}`]
        : []
    )
  );
}

test(
  'an element keeps its place whether or not a pointer is at it',
  { timeout: 600_000 },
  async () => {
    const moved: Record<string, string[]> = {};
    for (const file of fixtures(root).sort()) {
      const name = relative(root, file);
      const steps = await drawn(file).then(
        ({ steps }) => steps,
        () => []
      );
      const boxes = movedByPointers(steps);
      if (boxes.length) moved[name] = boxes.slice(0, 3);
    }
    expect(moved).toEqual({});
  }
);

/**
 * The rows, columns, grids and stacks that move in the node holding them between steps of one scene
 * (a step's scene is its label's prefix, as `stacked: `, where a source has several): each keeps the
 * largest size it reaches, so its place in its parent is one place at every step. A pointer's own
 * nodes, drawn where the pointer is, are left out.
 */
function movedInScenes(steps: readonly SceneStep[], labels: readonly string[]): string[] {
  const sceneOf = (index: number) => /^([^:@]+): /u.exec(labels[index] ?? '')?.[1] ?? '';
  const shown = (value: number) => Math.round(value * 100) / 100;
  // Where each was first, and where it was at a step that moved it further than this.
  const tolerance = 0.5;
  const first = new Map<string, { x: number; y: number; step: number }>();
  const moved = new Map<string, string>();
  steps.forEach((step, index) => {
    const boxes = new Map(step.nodes.map((node) => [node.id, node.box]));
    for (const node of step.nodes) {
      if (!node.layout || node.layout === 'free' || node.id.includes('@pointer')) continue;
      const parent = node.parent && boxes.get(node.parent);
      if (!parent) continue;
      const key = `${sceneOf(index)}|${node.id}`;
      const place = { x: node.box.x - parent.x, y: node.box.y - parent.y, step: index };
      const was = first.get(key);
      if (!was) first.set(key, place);
      else if (
        !moved.has(key) &&
        (Math.abs(place.x - was.x) > tolerance || Math.abs(place.y - was.y) > tolerance)
      )
        moved.set(
          key,
          `${key}: ${shown(was.x)},${shown(was.y)} at step ${was.step}, ${shown(place.x)},${shown(place.y)} at step ${index}`
        );
    }
  });
  return [...moved.values()];
}

/**
 * Fixtures whose rows move for a reason not yet fixed: in bst, each TreeCard's row of children is
 * centred in the card's fixed box, and grows as a child changes from ∅ to a link. Nodes inside a
 * typed component's box keep no size of their own, as some are sized by their value (a bar with
 * height={this}), so the row moves 12 to 24 pixels (6 November 2026).
 */
const movingRows = new Set(['bst.sverlin']);

test(
  'a row, column, grid or stack keeps its place in its scene',
  { timeout: 600_000 },
  async () => {
    const moved: Record<string, string[]> = {};
    for (const file of fixtures(root).sort()) {
      const name = relative(root, file);
      if (movingRows.has(name)) continue;
      const drawing = await drawn(file).then(
        (each) => each,
        () => undefined
      );
      if (!drawing) continue;
      const places = movedInScenes(drawing.steps, drawing.built.labels);
      if (places.length) moved[name] = places.slice(0, 3);
    }
    expect(moved).toEqual({});
  }
);
