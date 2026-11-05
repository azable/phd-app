/**
 * Links in a comparison, two presentations in frames side by side and stepped together as the app
 * shows a pair, in a real browser: no link jumps between frames of a step's move, at any size or
 * pace. Project d20bd3f6's two arrangements of a uniform-cost search showed links leaving a vertex
 * jump away as a step began and back as it ended. Run with `pnpm run test:browser`.
 */

import type { Frame, Page } from 'playwright-core';
import { expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import source from './fixtures/ucs-compare.sverlin?raw';
import line from './fixtures/ucs-compare-line.json';
import natural from './fixtures/ucs-compare-natural.json';
import { browserTestsOn as enabled, openPage, settled } from './testing/browser';

type Sample = Record<string, [number, number, number, number]>;

/** Records every frame each shown link's ends, in the page's pixels, by link. */
function record(frame: Frame) {
  return frame.evaluate(() => {
    const page = window as unknown as { samples: Sample[]; recording: boolean };
    page.samples = [];
    page.recording = true;
    const sample = () => {
      if (!page.recording) return;
      const lines: Sample = {};
      for (const layer of document.querySelectorAll('.sv-layer:not(.pending)')) {
        const seen = new Map<string, number>();
        for (const path of layer.querySelectorAll<SVGPathElement>('path[data-sv-edge]')) {
          const link = path.dataset.svEdgeId || path.dataset.svEdge || '';
          const nth = seen.get(link) ?? 0;
          seen.set(link, nth + 1);
          if (getComputedStyle(path).visibility !== 'visible') continue;
          let opacity = 1;
          for (let at: Element | null = path; at && at !== document.body; at = at.parentElement)
            opacity *= Number(getComputedStyle(at).opacity);
          const matrix = path.getScreenCTM();
          if (opacity < 0.5 || !matrix) continue;
          const start = path.getPointAtLength(0).matrixTransform(matrix);
          const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
          lines[`${link}#${nth}`] = [start.x, start.y, end.x, end.y];
        }
      }
      page.samples.push(lines);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

/** The jumps recorded: a shown link whose end moved more than 12 px from one frame to the next. */
async function jumpsOf(frame: Frame): Promise<string[]> {
  const samples = await frame.evaluate(() => {
    const page = window as unknown as { samples: Sample[]; recording: boolean };
    page.recording = false;
    return page.samples;
  });
  const jumps: string[] = [];
  for (let index = 1; index < samples.length; index++)
    for (const [link, now] of Object.entries(samples[index])) {
      const was = samples[index - 1][link];
      if (!was) continue;
      const moved = Math.max(
        Math.hypot(now[0] - was[0], now[1] - was[1]),
        Math.hypot(now[2] - was[2], now[3] - was[3])
      );
      if (moved > 12) jumps.push(`${link} ${Math.round(moved)} px at frame ${index}`);
    }
  return jumps;
}

const showAll = (page: Page, step: number) =>
  page.evaluate((to) => {
    for (const frame of document.querySelectorAll('iframe'))
      frame.contentWindow!.postMessage({ type: 'sverlin:step', step: to }, '*');
  }, step);

it.skipIf(!enabled)(
  'keeps every link of a pair still between frames of a move, stepped one by one or quickly',
  { timeout: 300_000 },
  async () => {
    const prepared = prepareSvelteComponent(source);
    const sides = await Promise.all(
      [line, natural].map(
        async (chosen) => (await bundlePresentation(prepared, 1, { chosen })).javascript
      )
    );
    for (const size of [
      { width: 1180, height: 330 },
      { width: 700, height: 260 }
    ]) {
      const page = await openPage({
        viewport: { width: size.width, height: size.height * 2 }
      });
      const escaped = (javascript: string) =>
        sandboxDocument('', javascript, 0, 1).replace(/&/gu, '&amp;').replace(/"/gu, '&quot;');
      await page.setContent(
        `<body style="margin:0">${sides
          .map(
            (javascript) =>
              `<iframe sandbox="allow-scripts" style="display:block;border:0;width:${size.width}px;height:${size.height}px" srcdoc="${escaped(javascript)}"></iframe>`
          )
          .join('')}</body>`
      );
      const frames = page.frames().filter((frame) => frame !== page.mainFrame());
      for (const frame of frames) await settled(frame, 0);
      for (const frame of frames) await record(frame);
      for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 5, 6, 4, 6]) {
        await showAll(page, step);
        for (const frame of frames) await settled(frame, step);
      }
      // Quickly: each step asked for before the last has settled.
      for (const step of [7, 8, 9, 10, 11]) await showAll(page, step);
      for (const frame of frames) await settled(frame, 11);
      const jumps = await Promise.all(frames.map(jumpsOf));
      expect(jumps, `${size.width}×${size.height}`).toEqual([[], []]);
    }
  }
);
