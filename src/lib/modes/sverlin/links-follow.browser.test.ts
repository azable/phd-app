/**
 * Links follow their ends between steps in a real browser: a link both steps draw stays shown all
 * through the move, its line eased from the old route to the new in step with the nodes, as when a
 * pointer's caption under a vertex comes or goes and the arrow leaving it starts lower or higher.
 * Run with `pnpm run test:browser`.
 */

import type { Page } from 'playwright-core';
import { expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import bfsCaptions from './fixtures/bfs-captions.sverlin?raw';
import {
  browserTestsOn as enabled,
  finishMotion,
  holdMotion,
  openPresentation
} from './testing/browser';

type Line = { start: [number, number]; end: [number, number]; shown: boolean };

/** The shown step's link lines, by link, with where each starts and ends and whether it is seen. */
function linesOf(page: Page): Promise<Record<string, Line>> {
  return page.evaluate(() => {
    const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)')!;
    const lines: Record<string, Line> = {};
    const seen = new Map<string, number>();
    for (const path of layer.querySelectorAll<SVGPathElement>('path[data-sv-edge]')) {
      const link = path.dataset.svEdgeId || path.dataset.svEdge || '';
      const nth = seen.get(link) ?? 0;
      seen.set(link, nth + 1);
      const length = path.getTotalLength();
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(length);
      let opacity = 1;
      let visible = true;
      for (let node: Element | null = path; node && node !== document.body; ) {
        const style = getComputedStyle(node);
        if (style.visibility === 'hidden' || style.display === 'none') visible = false;
        opacity *= Number(style.opacity);
        node = node.parentElement;
      }
      lines[`${link}#${nth}`] = {
        start: [start.x, start.y],
        end: [end.x, end.y],
        shown: visible && opacity > 0.5
      };
    }
    return lines;
  });
}

/** Two frames, so a line following its ends has redrawn for the held point of the move. */
const drawn = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  );

it.skipIf(!enabled)(
  'keeps every link both steps draw shown through the move, halfway between its routes halfway',
  { timeout: 180_000 },
  async () => {
    // As the participant had it (project dde836b1): the graph down the page, each pointer's mark
    // with its caption under the vertex, so an arrow leaving a vertex starts below its caption.
    const chosen = {
      'Graph.form': 'natural',
      'Graph.direction': 'down',
      'Graph.curve': 'straight',
      'Graph.layoutSeed': 1,
      'pointers.VertexRef': 'CurrentMark',
      'pointers.VertexRef@current': 'CurrentMark',
      'pointers.VertexRef@w': 'NeighbourMark',
      'CurrentMark.CurrentLabel.shown': true,
      'NeighbourMark.NeighbourLabel.shown': true
    };
    const { javascript, labels } = await bundlePresentation(
      prepareSvelteComponent(bfsCaptions),
      1,
      { chosen }
    );
    const page = await openPresentation(javascript);
    let before = await linesOf(page);
    let followed = 0;
    for (let step = 1; step < labels.length; step++) {
      await holdMotion(page, step, 0.5);
      await drawn(page);
      const halfway = await linesOf(page);
      await finishMotion(page, step);
      const after = await linesOf(page);
      for (const [link, end] of Object.entries(after)) {
        const start = before[link];
        if (!start) continue;
        const mid = halfway[link];
        expect(mid?.shown, `${link} at step ${step}`).toBe(true);
        // The ease is even about its middle, so halfway through the move the line is halfway.
        const between = (a: [number, number], b: [number, number]) => [
          (a[0] + b[0]) / 2,
          (a[1] + b[1]) / 2
        ];
        const [x, y] = between(start.start, end.start);
        expect(
          Math.hypot(mid.start[0] - x, mid.start[1] - y),
          `${link} at step ${step}`
        ).toBeLessThan(3);
        if (Math.hypot(start.start[0] - end.start[0], start.start[1] - end.start[1]) > 3)
          followed += 1;
      }
      before = after;
    }
    // The fixture moves arrows' starts as captions come and go, so some lines did follow.
    expect(followed).toBeGreaterThan(0);
  }
);
