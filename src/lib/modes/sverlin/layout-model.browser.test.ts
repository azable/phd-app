/**
 * The layout model (see library/model/layout.ts) against a real browser's layout, and the pictures'
 * soundness (see library/soundness.ts), over every fixture's every step. Run with
 * `pnpm run test:browser`, which the devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import type { LayoutCheck, SceneFrame, SceneStep } from './library';
import { unsound } from './library/soundness';

const enabled = process.env.SVERLIN_RUN_BROWSER_TESTS === '1';
const fixtures = import.meta.glob<string>('./fixtures/*.sverlin', {
  query: '?raw',
  import: 'default',
  eager: true
});

let browser: Browser | undefined;
beforeAll(async () => {
  if (!enabled) return;
  // The session's library path can hold libraries of another package set than the browser's.
  const env = { ...process.env } as Record<string, string>;
  delete env.LD_LIBRARY_PATH;
  browser = await chromium.launch({ executablePath: process.env.SVERLIN_TEST_BROWSER, env });
});
afterAll(() => browser?.close());

async function sceneOf(source: string) {
  const { javascript } = await bundlePresentation(prepareSvelteComponent(source), 1, {});
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const page = await browser!.newPage({ viewport: { width: 1200, height: 800 } });
  await page.route('https://sverlin.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<body style="margin:0"><iframe sandbox="allow-scripts" style="width:1200px;height:800px;border:0" srcdoc="${escape(sandboxDocument('', javascript, 0, 1))}"></iframe></body>`
    })
  );
  await page.goto('https://sverlin.test/');
  const scene = await page.evaluate(
    () =>
      new Promise<{ frame: SceneFrame; steps: SceneStep[]; checks: LayoutCheck[] }>((resolve) => {
        addEventListener('message', ({ data }) => {
          if (data?.type === 'sverlin:scene') resolve(data);
        });
        document
          .querySelector('iframe')
          ?.contentWindow?.postMessage(
            { type: 'sverlin:describe', request: 'model', check: true },
            '*'
          );
      })
  );
  await page.close();
  return scene;
}

for (const [path, source] of Object.entries(fixtures)) {
  const name = path.replace(/^.*\/(.*)\.sverlin$/u, '$1');
  it.skipIf(!enabled)(
    `lays out ${name} as the browser does, every step sound`,
    { timeout: 300_000 },
    async () => {
      const { frame, steps, checks } = await sceneOf(source);
      expect(checks).toHaveLength(steps.length);
      const elements = checks.reduce((sum, check) => sum + check.elements, 0);
      const exact = checks.reduce((sum, check) => sum + check.exact, 0);
      // Every box to the browser's 64th of a pixel, where the browser keeps its own rules for
      // rounding; a browser release changing one moves boxes by a fraction of a pixel.
      expect(checks.flatMap((check) => check.problems)).toEqual([]);
      expect(exact / elements).toBeGreaterThan(0.99);
      expect(Math.max(...checks.map((check) => check.largest))).toBeLessThan(0.5);
      expect(steps.flatMap((step) => unsound(frame, step))).toEqual([]);
    }
  );
}
