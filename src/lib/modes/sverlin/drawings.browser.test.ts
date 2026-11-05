/**
 * Drawings written <Svg>, drawn in a real browser with the server's layout: each SVG is as large
 * as the server measured it, inside the box the server gave its node, and draws the shapes its
 * value chose. Run with `pnpm run test:browser`, which the devenv gives a browser
 * (SVERLIN_TEST_BROWSER).
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

const source = `<script domain>
  const Rank = type('integer', { min: 1, max: 13 });
  const Suit = type(['hearts', 'spades']);
  const Card = record({ rank: Rank, suit: Suit });
  const Hand = array(Card, { max: 3 });
</script>
<script input>
  const hand = Hand;
</script>
<script algorithm>
  @first[const card = hand[0];]
</script>
<View of="Rank" name="RankText"><Node value={this} /></View>
<View of="Suit" name="SuitMark">
  <Node>
    <Svg viewBox="0 0 30 20" height="2" label={this}>
      {#if this === 'hearts'}
        <path d="M15 19 C8 13 5 10 5 7 C5 4 8 2 10 2 C12 2 14 3 15 5 C16 3 18 2 20 2 C22 2 25 4 25 7 C25 10 22 13 15 19 Z" />
      {:else}
        <circle cx="15" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="2" />
      {/if}
    </Svg>
  </Node>
</View>
<View of="Card" name="CardFace"><Node layout="column">{this.rank}{this.suit}</Node></View>
<View of="Hand" name="Row"><Node layout="row">{#each this as card}{card}{/each}</Node></View>
<Layout name="Main" of="hand"><Node layout="column">{hand}</Node></Layout>
<Case name="main" hand={[{ rank: 3, suit: 'hearts' }, { rank: 10, suit: 'spades' }, { rank: 4, suit: 'hearts' }]} />
<Storyboard><Scene name="main" case="main"><Main hand={hand} /></Scene></Storyboard>`;

it.skipIf(!enabled)(
  'draws each drawing at the size the server laid out, with the shapes its value chose',
  { timeout: 300_000 },
  async () => {
    const built = await bundlePresentation(prepareSvelteComponent(source), 1, {});
    expect(built.layout.errors).toEqual([]);
    const page = await browser!.newPage({ viewport: { width: 900, height: 400 } });
    await page.setContent(
      sandboxDocument('', built.javascript, 0, 1, undefined, undefined, embeddedFontsHead)
    );
    await page.waitForFunction(() =>
      document.querySelector('.sv-layer:not(.pending) svg[data-sv-drawing]')
    );
    await page.waitForTimeout(500);
    const drawn = await page.evaluate(() =>
      [
        ...document.querySelectorAll<SVGSVGElement>('.sv-layer:not(.pending) svg[data-sv-drawing]')
      ].map((svg) => {
        const node = svg.closest<HTMLElement>('.sv-node')!;
        const own = svg.getBoundingClientRect();
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const sides = (a: string, b: string) =>
          [a, b].reduce(
            (total, side) =>
              total +
              parseFloat(style.getPropertyValue(`padding-${side}`)) +
              parseFloat(style.getPropertyValue(`border-${side}-width`)),
            0
          );
        const half = (value: number) => Math.round(value * 2) / 2;
        return {
          label: svg.getAttribute('aria-label'),
          shapes: [...svg.querySelectorAll('path, circle')].map(({ tagName }) => tagName),
          // The node's content box, which the server sized to the SVG, against the SVG's own.
          content: [
            half(box.width - sides('left', 'right')),
            half(box.height - sides('top', 'bottom'))
          ],
          own: [half(own.width), half(own.height)],
          inside:
            own.left >= box.left - 0.5 &&
            own.right <= box.right + 0.5 &&
            own.top >= box.top - 0.5 &&
            own.bottom <= box.bottom + 0.5
        };
      })
    );
    await page.screenshot({ path: 'test-results/drawings.png' });
    await page.close();
    expect(drawn.map(({ label, shapes }) => [label, shapes])).toEqual([
      ['hearts', ['path']],
      ['spades', ['circle']],
      ['hearts', ['path']]
    ]);
    // The same room for every value: 3em by 2em, as the viewBox's proportions and height give.
    expect(new Set(drawn.map(({ own }) => own.join('×'))).size).toBe(1);
    for (const { own, content, inside } of drawn) {
      expect(own[0] / own[1]).toBeCloseTo(1.5, 1);
      expect(Math.abs(content[0] - own[0])).toBeLessThanOrEqual(0.5);
      expect(inside).toBe(true);
    }
  }
);
