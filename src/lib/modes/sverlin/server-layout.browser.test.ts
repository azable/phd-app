/**
 * Every step's layout worked out on the server (see layout.server.ts) against the page's own (see
 * library/record.ts), drawn in a real browser: every fixture's every step drawn with the server's
 * layout as with the page's, and the page laying out itself wherever the server's does not hold.
 * Run with `pnpm run test:browser`, which the devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { embeddedFontsHead } from './fonts';
import manifest from './fonts/faces.json';
import type { SceneFrame, SceneStep } from './library';
import { unsound } from './library/soundness';
import type { VariantRequest } from './design.server';

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

type Drawn = { layout: string; frame: SceneFrame; steps: SceneStep[] };

/** Every step of a presentation as the page draws it, and where its layout came from. */
async function drawn(
  javascript: string,
  { fonts = true, deviceScaleFactor = 1 } = {}
): Promise<Drawn> {
  const page = await browser!.newPage({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor
  });
  await page.setContent(`<iframe style="border: 0; width: 1200px; height: 800px"></iframe>
<script>
  addEventListener('message', ({ data }) => {
    if (data?.type === 'sverlin:ready') window.ready = true;
    if (data?.type === 'sverlin:scene') window.scene = data;
  });
</script>`);
  await page.evaluate(
    (document) => {
      window.document.querySelector('iframe')!.srcdoc = document;
    },
    sandboxDocument('', javascript, 0, 1, undefined, undefined, fonts ? embeddedFontsHead : '')
  );
  await page.waitForFunction(() => (window as { ready?: boolean }).ready, null, {
    timeout: 60_000
  });
  const layout = await page.evaluate(
    () =>
      (document.querySelector('iframe')!.contentWindow as Window & { __sverlinLayout?: string })
        .__sverlinLayout ?? ''
  );
  await page.evaluate(() =>
    document
      .querySelector('iframe')
      ?.contentWindow?.postMessage({ type: 'sverlin:describe', request: 'server' }, '*')
  );
  await page.waitForFunction(() => (window as { scene?: unknown }).scene, null, {
    timeout: 120_000
  });
  const scene = await page.evaluate(
    () => (window as unknown as { scene: { frame: SceneFrame; steps: SceneStep[] } }).scene
  );
  await page.close();
  return { layout, ...scene };
}

/** The furthest any node's box is from where the other drawing put it. */
function furthest(a: SceneStep[], b: SceneStep[]): number {
  let most = 0;
  a.forEach((step, k) => {
    const other = new Map(b[k].nodes.map((node) => [node.id, node.box]));
    for (const { id, box } of step.nodes) {
      const at = other.get(id);
      if (!at) {
        most = Infinity;
        continue;
      }
      most = Math.max(
        most,
        Math.abs(box.x - at.x),
        Math.abs(box.y - at.y),
        Math.abs(box.width - at.width),
        Math.abs(box.height - at.height)
      );
    }
  });
  return most;
}

/** A presentation drawn with the server's layout as with the page's own, step by step. */
async function drawsAlike(source: string, request: VariantRequest = {}): Promise<Drawn> {
  const prepared = prepareSvelteComponent(source);
  const own = await drawn((await bundlePresentation(prepared, 1, request)).javascript);
  const server = await bundlePresentation(prepared, 1, request, { serverLayout: true });
  expect(server.layout).toMatchObject({ server: true, errors: [] });
  const given = await drawn(server.javascript);
  expect([own.layout, given.layout]).toEqual(['page', 'server']);
  expect(given.steps).toHaveLength(own.steps.length);
  // The same sizes and places: a scene's numbers come from the page's own layout of each.
  expect(furthest(given.steps, own.steps)).toBeLessThan(0.01);
  expect(given.steps.flatMap((step) => unsound(given.frame, step))).toEqual([]);
  return given;
}

for (const [path, source] of Object.entries(fixtures)) {
  const name = path.replace(/^.*\/(.*)\.sverlin$/u, '$1');
  it.skipIf(!enabled)(
    `draws ${name} with the server's layout as with its own`,
    { timeout: 300_000 },
    () => drawsAlike(source)
  );
}

// Every text of a fixture in each embedded face, every other kind bold, its ∞ in the fallback where
// the face lacks it.
for (const { value: font, family } of manifest.fonts) {
  it.skipIf(!enabled)(
    `draws every text in the ${font} font with the server's layout as with its own`,
    { timeout: 300_000 },
    async () => {
      const source = fixtures['./fixtures/dijkstra-fields.sverlin'];
      const keys = Object.keys(prepareSvelteComponent(source).design.space);
      const fonts = keys.filter((key) => key.endsWith('.font'));
      const weights = keys.filter((key) => key.endsWith('.weight'));
      expect(fonts.length).toBeGreaterThan(0);
      const chosen = Object.fromEntries([
        ...fonts.map((key) => [key, font]),
        ...weights.map((key, k) => [key, k % 2 ? 'normal' : 'bold'])
      ]);
      const given = await drawsAlike(source, { chosen });
      const faces = new Set(
        given.steps.flatMap((step) =>
          step.nodes.flatMap((node) =>
            (node.runs ?? []).map(
              (run) => `${run.font.split(',')[0].replace(/['"]/gu, '')} ${run.fontWeight}`
            )
          )
        )
      );
      expect(faces).toContain(`${family} 400`);
      expect(faces).toContain(`${family} 700`);
    }
  );
}

it.skipIf(!enabled)(
  "lays out itself where the server's layout does not hold",
  { timeout: 300_000 },
  async () => {
    const source = fixtures['./fixtures/bfs-cards.sverlin'];
    const { javascript } = await bundlePresentation(
      prepareSvelteComponent(source),
      1,
      {},
      {
        serverLayout: true
      }
    );
    // Without the embedded fonts, text is drawn in the machine's own.
    expect((await drawn(javascript, { fonts: false })).layout).toBe('page');
    // At 1.25 device pixels a CSS pixel, a border of one pixel draws 0.8 wide.
    expect((await drawn(javascript, { deviceScaleFactor: 1.25 })).layout).toBe('page');
    // At 2, borders of half a pixel keep their width: the server laid that out too.
    expect((await drawn(javascript, { deviceScaleFactor: 2 })).layout).toBe('server');
  }
);

it.skipIf(!enabled)(
  'draws only the layout a variant shows, in its own frame',
  { timeout: 300_000 },
  async () => {
    const source = fixtures['./fixtures/bubble-layouts.sverlin'];
    // The node the Side layout writes beside its parts, by its tag's line.
    const line = source.split('\n').findIndex((text) => text.includes('<Node>{@render Title()}'));
    const holds = (steps: SceneStep[]) =>
      steps.some((step) => step.nodes.some((node) => node.id.startsWith(`${line + 1}:`)));
    const side = await drawsAlike(source, { chosen: { layout: 'Side', 'Side.ratio': '4:3' } });
    expect(side.frame.width / side.frame.height).toBeCloseTo(4 / 3, 2);
    expect(holds(side.steps)).toBe(true);
    const stacked = await drawsAlike(source, { chosen: { 'Side.ratio': '4:3' } });
    expect(stacked.frame.width / stacked.frame.height).toBeCloseTo(16 / 9, 2);
    expect(holds(stacked.steps)).toBe(false);
  }
);
