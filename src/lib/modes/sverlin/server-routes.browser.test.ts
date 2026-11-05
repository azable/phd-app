/**
 * A free layout's links drawn as the server routed them, in a real browser: at every step, each
 * line the page draws is the route the server gave for that step (LayoutMemory.routes), whatever the
 * page's size or density, so no link depends on boxes the page reads. Run with
 * `pnpm run test:browser`.
 */

import type { Page } from 'playwright-core';
import { expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import bfsCaptions from './fixtures/bfs-captions.sverlin?raw';
import ucs from './fixtures/ucs-compare.sverlin?raw';
import natural from './fixtures/ucs-compare-natural.json';
import { browserTestsOn as enabled, openPresentation, showStep } from './testing/browser';

/** The step's lines that differ from the server's routes for it, by link. */
function offRoute(page: Page, step: number): Promise<{ off: string[]; drawn: number }> {
  return page.evaluate((step) => {
    type Edge = { id?: string; link: string; path: string };
    type Given = { devicePixelRatio: number; routes?: [string, [number[], Edge[]][]][] };
    const geometries = (window as unknown as { __sverlinGeometry: Given[] }).__sverlinGeometry;
    // The geometry the page draws with: the one laid out at its own device pixel ratio.
    const geometry = [
      geometries.find((given) => given.devicePixelRatio === window.devicePixelRatio) ??
        geometries[0]
    ];
    const state = 2 * step + 1;
    const routes = new Map<string, string>();
    for (const given of geometry)
      for (const [, sets] of given.routes ?? [])
        for (const [states, edges] of sets)
          if (states.includes(state))
            for (const edge of edges) routes.set(edge.id ?? edge.link, edge.path);
    const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)')!;
    const off: string[] = [];
    let drawn = 0;
    for (const path of layer.querySelectorAll<SVGPathElement>('.sv-arranged path[data-sv-edge]')) {
      drawn += 1;
      const link = path.dataset.svEdgeId || path.dataset.svEdge || '';
      if (routes.get(link) !== path.getAttribute('d')) off.push(link);
    }
    return { off, drawn };
  }, step);
}

it.skipIf(!enabled)(
  'draws every free layout link along the route the server gave for the step',
  { timeout: 300_000 },
  async () => {
    for (const [name, source, chosen] of [
      ['ucs', ucs, natural],
      ['bfs-captions', bfsCaptions, {}]
    ] as const) {
      const built = await bundlePresentation(prepareSvelteComponent(source), 1, { chosen });
      const last = built.labels.length - 1;
      for (const options of [
        { viewport: { width: 1200, height: 700 } },
        { viewport: { width: 700, height: 260 }, deviceScaleFactor: 2 }
      ]) {
        const page = await openPresentation(built.javascript, options);
        let drawn = 0;
        for (const step of [...Array(Math.min(last, 12)).keys()].map((n) => n + 1)) {
          await showStep(page, step);
          const at = await offRoute(page, step);
          drawn += at.drawn;
          expect(at.off, `${name} step ${step}`).toEqual([]);
        }
        expect(drawn, name).toBeGreaterThan(0);
      }
    }
  }
);
