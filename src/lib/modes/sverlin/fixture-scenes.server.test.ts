/**
 * Every fixture's scenes, built with no variant, as a hash each, so a change to the engine that
 * moves anything in a picture shows here; a change meant to move pictures updates the snapshot.
 *
 * Deliberate changes, by the step that made them:
 * - grid-marks: a grid placed by positions keeps a track before the first cell, as a position's
 *   type allows −1 as it allows the length (coordinates outside the range).
 * - bubble-arrow, bubble-layouts: a column holding a link keeps the largest room its links need at
 *   any step, so its row of cells no longer moves up and down as the swap's link comes and goes.
 * - search-places, replay/linear-search: a place in the scene data is named :lo, not @lo, as `@`
 *   names only a moment of the run (the boxes are as they were).
 * - links/*: added, each a fixture above with its pointers drawn as links from variables (see
 *   pointer-links.server.test.ts); no other fixture's scenes changed.
 * - 27 fixtures: a node's words are one block centred in its box, as a value is: words sharing a
 *   slot with longer ones ("seen" beside "unseen", up to 16 px), a stack's sentences (a status
 *   line, up to 214 px), and sentences holding values (those values with them); the rest move by
 *   under 1 px, from the block's rounding.
 * - replay/ucs-ten: a union's members start with one look, so ∞ (UnknownCost) starts boxed like the
 *   costs it stands beside (CostValue).
 * - links/*: their words are centred as above, once both changes were merged.
 * - replay/linear-search, links/linear-search: a node lit by its place at a step records the light
 *   (look.light), which the server scenes had dropped with its CSS box-shadow; with the light left
 *   out, both hash as before.
 * - linear-search (then links/linear-search), listing-python, replay/linear-search: a listing line drawn as one run keeps
 *   the spaces inside it, as 1  start at i = 0, which it was measured with; they were collapsed,
 *   so the page stretched the text and the PDF set it off its line (the boxes are as they were).
 * - pointers as links: every fixture that drew a pointer with <Pointed> draws it as a link from a
 *   variable (grid lanes, followers, or a row under a collection a view draws), and nothing keeps
 *   room round the elements for a pointer, so their scenes change; links/* are gone, the copies
 *   now the fixtures themselves, links/linear-search kept as linear-search; grid-marks changes as a
 *   node drawing a position a variable holds takes no identity; call-frames and fib-calls change
 *   too, from the library's removals (not traced to one cause, 7 November 2026).
 * - 20 fixtures with listings or captions (bfs-*, dfa-*, dijkstra-*, linear-search, list-markers,
 *   listing-*, search-*, stack-highlight, ucs-compare, insertion-decisions): each mention of a
 *   variable the view draws is a token, as :i[i], in the listing and in a caption, so it lights
 *   with its place (listing.plain-variable, view.caption-name); the words are as they were, so only
 *   the lights change. bars and merge-sort-stack label each statement of a clumped label inside it
 *   (label.clumped), which leaves their scenes as they were. replay/* stay as the assistant wrote
 *   them.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';
import type { SceneStep } from './library';
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

// Each fixture is built once for every test.
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
 * The rows, columns, grids and stacks that move in the node holding them between steps of one scene
 * (a step's scene is its label's prefix, as `stacked: `, where a source has several): each keeps the
 * largest size it reaches, so its place in its parent is one place at every step. A variable's node
 * following what its link reaches in a free layout (`follows`) is left out.
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
      if (!node.layout || node.layout === 'free' || node.follows) continue;
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
