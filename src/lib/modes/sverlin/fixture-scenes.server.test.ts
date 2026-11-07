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
 * - bubble-arrow, bubble-layouts, dfa-loops, dfa-panels, linear-search, list-markers,
 *   stack-highlight: written with a node's when and a stack instead of <When> and <OneOf>, so
 *   their ids move with their lines; dfa-panels and linear-search draw the same boxes; the bubble
 *   pair gain an empty node round their swap note; dfa-loops' status and list-markers' start note
 *   keep a stack's room (the largest branch); stack-highlight's board sits 26 px higher, its cells
 *   4 px smaller, as its notes' stack keeps room for both. The replay fixtures still write the old
 *   forms, which still build, so theirs are as they were.
 * - 11 fixtures with listings (bfs-cards, bfs-visit-order, dfa-loops, dfa-panels, dijkstra-fields,
 *   insertion-decisions, linear-search, list-markers, listing-*, search-places): each mention in a
 *   listing of a variable the view draws is a token, as :i[i], so it lights with its place
 *   (listing.plain-variable); the words are as they were, so only the lights change. Captions stay
 *   words, as a token draws its words as inline code. bars and merge-sort-stack label each
 *   statement of a clumped label inside it (label.clumped), which leaves their scenes as they were.
 *   replay/* stay as the assistant wrote them.
 * - 12 fixtures (bfs-neighbours, bfs-references, dfa-loops, dfa-panels, linear-search,
 *   search-places, replay/bfs-reveal, replay/binary-search-bars, replay/binary-search-recursive,
 *   replay/linear-search, replay/merge-sort-overview, replay/ucs-ten): written with no of and bare
 *   layout tags, as both are refused, so their node ids move with their lines and columns; with ids
 *   masked, each draws the same scenes as before (checked against main, 7 November 2026).
 * - replay/bfs-reveal, binary-search-bars, binary-search-recursive, linear-search,
 *   merge-sort-overview, ucs-ten: written with a node's when and a stack instead of <When> and
 *   <OneOf>, which are now refused, so their ids move with their lines and each status stack keeps
 *   the room of its largest branch, as a stack does.
 * - bst: written without flow="y", which is refused; its tree starts running right, as every
 *   structure does, its kind's direction (down in a variant) turning every form. dfa-loops, without
 *   flow="x", draws as it did.
 * - call-frames, fib-calls: a view and a query of the function's label in place of a call type,
 *   which is refused; each source loses its declaration's line, so its ids move.
 * - bars, insertion-decisions, dfa-loops: the bar and vertex roles are gone, a role coming only
 *   from the props a node writes: a node sized by its value is a value (the starter's framed white
 *   box, no padding) rather than a grey bar, and dfa-loops' states, nodes holding a render, are text
 *   rather than circles.
 * - dijkstra: its current-edge mark is back, as a link from a variable reaches an element drawn as
 *   a link: an EdgeIndex view's <Link to={this} /> drawn at {e} runs to the edge's middle and its
 *   <To> paints the edge's line, as commit 65694791 had left it out (replay/dijkstra-demo stays as
 *   the assistant wrote it).
 * - bars: each bar is its value long, standing on its slot's bottom, as the page draws it; the
 *   layout model had kept the Bar component's box (its largest value, 9) on the bar itself, so
 *   every bar was drawn 9 long. A node keeps its size only along the axes it keeps a slot on, and
 *   the room round it along the others (data-sv-own). No other fixture's scenes changed.
 * - 13 fixtures: a node inside a typed component's box keeps the largest size its site reaches
 *   for the values the view is probed with and at any step, one size every copy shares, where it
 *   kept none. insertion-decisions: IntColumn's bars stand on one baseline in a slot as long as 9,
 *   their values in one line, the lit column painting the slot and its value. bst: each TreeCard's
 *   L and R fields keep their ∅ width as a child becomes a link, so its row no longer moves
 *   (bst left the moving-rows test's exceptions) and the tree is 2 px taller. bubble-arrow,
 *   bubble-layouts: a mark's caption keeps its widest place, so its link needs no room past it and
 *   the mark's box is 1.6 px narrower; captions and links move by 2 px. bfs-cards, bfs-neighbours,
 *   bfs-references, bfs-visit-order, dfa-loops, list-markers, replay/bfs-icons,
 *   replay/binary-search-compact, replay/merge-sort-fallback: only boxes that draw nothing (a
 *   caption's, an empty field's) widen round their centred text; no text, painted box or link
 *   moves.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';
import type { SceneNode, SceneStep } from './library';
import { drawnSteps, ofKind } from './testing/scenes';

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

test(
  'a row, column, grid or stack keeps its place in its scene',
  { timeout: 600_000 },
  async () => {
    const moved: Record<string, string[]> = {};
    for (const file of fixtures(root).sort()) {
      const name = relative(root, file);
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

test('a bar is its value long, on the bottom of a slot as long as the largest', async () => {
  const { steps } = await drawn(join(root, 'bars.sverlin'));
  const bars = ofKind(steps[0]!, 'Bar');
  // The case's values are [6, 2, 9, 4, 0, 7]; 0 draws only the bar's border.
  const unit = bars[2]!.box.height / 9;
  const lengths = bars.map(({ box }) => Math.round(box.height / unit));
  expect(lengths).toEqual([6, 2, 9, 4, 0, 7]);
  expect(new Set(bars.map(({ box }) => Math.round(box.y + box.height))).size).toBe(1);
});

test('a labelled bar in a typed view keeps a slot as long as its type allows, in every copy', async () => {
  const { steps } = await drawn(join(root, 'insertion-decisions.sverlin'));
  const bottom = ({ box }: SceneNode) => Math.round(box.y + box.height);
  let lit = 0;
  for (const step of steps) {
    // Each copy of IntColumn: a column holding a bar and its value, by the line it is drawn in.
    const lines = Map.groupBy(
      ofKind(step, 'IntColumn.ColumnLength').map((bar) => {
        const column = step.nodes.find(({ id }) => id === bar.parent)!;
        const label = step.nodes.find(({ parent, value }) => parent === column.id && value)!;
        return { bar, column, label, value: Number(label.value) };
      }),
      ({ column }) => Math.round(column.box.y)
    );
    for (const copies of lines.values()) {
      // The bars stand on one baseline, and their values sit in one line under it.
      expect(new Set(copies.map(({ bar }) => bottom(bar))).size).toBe(1);
      expect(new Set(copies.map(({ label }) => Math.round(label.box.y))).size).toBe(1);
      // A lit column paints its slot, as long as Int's largest value (9), and its value: no more.
      const longest = copies.reduce((a, b) => (b.value > a.value ? b : a));
      const unit = longest.bar.box.height / longest.value;
      for (const { bar, column, label } of copies) {
        if (!column.look.fill) continue;
        lit++;
        expect(Math.round(column.box.y)).toBe(Math.round(bottom(bar) - 9 * unit));
        expect(bottom(column)).toBe(bottom(label));
      }
    }
  }
  expect(lit).toBeGreaterThan(0);
});
