/**
 * Inline maths, MathJax's SVG, drawn in a real browser with the server's layout: each SVG sits
 * inside the box the server gave its node, as large as the server measured it. Run with
 * `pnpm run test:browser`, which the devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { embeddedFontsHead } from './fonts';

const enabled = process.env.SVERLIN_RUN_BROWSER_TESTS === '1';

let browser: Browser | undefined;
beforeAll(async () => {
  if (!enabled) return;
  // The session's library path can hold libraries of another package set than the browser's.
  const env = { ...process.env } as Record<string, string>;
  delete env.LD_LIBRARY_PATH;
  browser = await chromium.launch({ executablePath: process.env.SVERLIN_TEST_BROWSER, env });
});
afterAll(() => browser?.close());

const source = `<script algorithm>
</script>
<Layout name="Main">
  <Node layout="column">
    <Node>Sorting takes $$O(n \\log n)$$ comparisons.</Node>
    <Node>There are $$\\frac{n(n+1)}{2}$$ pairs.</Node>
    <Node>The sum $$\\sum_{i=1}^{n} i$$ grows as $$n^2$$.</Node>
  </Node>
</Layout>
<Storyboard><Scene name="main"><Main /></Scene></Storyboard>`;

it.skipIf(!enabled)(
  'draws each SVG of inline maths in the box the server laid out for it',
  { timeout: 300_000 },
  async () => {
    const built = await bundlePresentation(prepareSvelteComponent(source), 1, {});
    expect(built.layout.errors).toEqual([]);
    const page = await browser!.newPage({ viewport: { width: 900, height: 400 } });
    await page.setContent(
      sandboxDocument('', built.javascript, 0, 1, undefined, undefined, embeddedFontsHead)
    );
    await page.waitForFunction(() => document.querySelector('.sv-layer:not(.pending) svg'));
    await page.waitForTimeout(500);
    // Each SVG, and the node holding it, as the page drew them with the server's boxes.
    const drawn = await page.evaluate(() =>
      [...document.querySelectorAll<SVGSVGElement>('.sv-layer:not(.pending) .math svg')].map(
        (svg) => {
          const node = svg.closest<HTMLElement>('.sv-node')!;
          const own = svg.getBoundingClientRect();
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const sides = ['Left', 'Right'].reduce(
            (total, side) =>
              total +
              parseFloat(style.getPropertyValue(`padding-${side.toLowerCase()}`)) +
              parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)),
            0
          );
          return {
            latex: svg.querySelector('[data-latex]')?.getAttribute('data-latex'),
            // The node's content width, which the server sized to the SVG, against the SVG's own.
            widths: [Math.round((box.width - sides) * 2) / 2, Math.round(own.width * 2) / 2],
            svg: { left: own.left, top: own.top, right: own.right, bottom: own.bottom },
            node: { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
          };
        }
      )
    );
    await page.screenshot({ path: 'test-results/maths.png' });
    await page.close();
    expect(drawn).toHaveLength(4);
    for (const { latex, svg, node, widths } of drawn) {
      expect([latex, Math.abs(widths[0] - widths[1]) <= 0.5]).toEqual([latex, true]);
      // Within half a pixel: the server measured the SVG as the page draws it.
      expect([latex, svg.left >= node.left - 0.5, svg.right <= node.right + 0.5]).toEqual([
        latex,
        true,
        true
      ]);
      expect([latex, svg.top >= node.top - 0.5, svg.bottom <= node.bottom + 0.5]).toEqual([
        latex,
        true,
        true
      ]);
    }
  }
);
