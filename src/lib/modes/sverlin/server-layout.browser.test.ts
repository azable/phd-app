/**
 * Every step's layout worked out on the server (see layout.server.ts), drawn in a real browser: every
 * fixture's every step drawn soundly with it, in the frame and at the fit the server gave, whatever
 * the page's fonts or device pixel ratio, and a page given none saying so. How near the layout model
 * is to the browser's own layout is layout-model.browser.test.ts's. Run with `pnpm run
 * test:browser`, which the devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { embeddedFontsHead } from './fonts';
import manifest from './fonts/faces.json';
import type { Geometry, SceneFrame, SceneStep } from './library';
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

type Drawn = { frame: SceneFrame; steps: SceneStep[] };

/** Every step of a presentation as the page draws it. */
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
  return scene;
}

/** The geometry a bundle gives its page (see compile.server.ts). */
function geometriesOf(javascript: string): Geometry[] {
  const prefix = 'window.__sverlinGeometry=';
  expect(javascript.startsWith(prefix)).toBe(true);
  return JSON.parse(javascript.slice(prefix.length, javascript.indexOf(';\n'))) as Geometry[];
}

/** A presentation drawn soundly with the server's layout, in the frame the server gave. */
async function drawsAsGiven(source: string, request: VariantRequest = {}): Promise<Drawn> {
  const built = await bundlePresentation(prepareSvelteComponent(source), 1, request);
  expect(built.layout.errors).toEqual([]);
  const given = await drawn(built.javascript);
  expect(given.steps).toHaveLength(built.labels.length);
  expect(given.frame.height).toBe(Math.round(geometriesOf(built.javascript)[0].frame!.height));
  expect(given.steps.flatMap((step) => unsound(given.frame, step))).toEqual([]);
  return given;
}

for (const [path, source] of Object.entries(fixtures)) {
  const name = path.replace(/^.*\/(.*)\.sverlin$/u, '$1');
  it.skipIf(!enabled)(`draws ${name} with the server's layout`, { timeout: 300_000 }, () =>
    drawsAsGiven(source)
  );
}

// Every text of a fixture in each embedded face, every other kind bold, its ∞ in the fallback where
// the face lacks it.
for (const { value: font, family } of manifest.fonts) {
  it.skipIf(!enabled)(
    `draws every text in the ${font} font with the server's layout`,
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
      const given = await drawsAsGiven(source, { chosen });
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
  "draws with the server's layout whatever the page's fonts and ratio, and says when it has none",
  { timeout: 300_000 },
  async () => {
    const { javascript } = await bundlePresentation(
      prepareSvelteComponent(fixtures['./fixtures/bfs-cards.sverlin']),
      1
    );
    const server = await drawn(javascript);
    // Without the embedded fonts, text is drawn in the machine's own, in the server's boxes; at
    // 1.25 device pixels a CSS pixel, with the geometry laid out at the nearest ratio.
    for (const options of [
      { fonts: false },
      { deviceScaleFactor: 1.25 },
      { deviceScaleFactor: 2 }
    ]) {
      const other = await drawn(javascript, options);
      expect(other.frame).toEqual(server.frame);
      expect(other.steps).toHaveLength(server.steps.length);
    }
    const page = await browser!.newPage();
    await page.setContent(
      sandboxDocument('', javascript.slice(javascript.indexOf(';\n') + 2), 0, 1)
    );
    await expect
      .poll(() => page.textContent('.sv-error').catch(() => null))
      .toContain('came without its layout');
    await page.close();
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
    const side = await drawsAsGiven(source, { chosen: { layout: 'Side', 'Side.ratio': '4:3' } });
    expect(side.frame.width / side.frame.height).toBeCloseTo(4 / 3, 2);
    expect(holds(side.steps)).toBe(true);
    const stacked = await drawsAsGiven(source, { chosen: { 'Side.ratio': '4:3' } });
    expect(stacked.frame.width / stacked.frame.height).toBeCloseTo(16 / 9, 2);
    expect(holds(stacked.steps)).toBe(false);
  }
);

// A node sized by its value draws its own length, the value times its kind's unit, in a room
// keeping the largest it reaches, also where a pointer draws it again; the room is never the node.
it.skipIf(!enabled)(
  'draws each node sized by its height its value long, standing or hanging by its kind’s anchor, a pointer on it or not',
  { timeout: 300_000 },
  async () => {
    const source = fixtures['./fixtures/bars.sverlin'];
    const bars = (step: SceneStep) =>
      step.nodes
        .filter((node) => node.kind === 'Bar' || node.kind === 'Here.Pointed')
        .toSorted((a, b) => a.box.x - b.box.x)
        .map(({ kind, box }) => ({ kind, box }));
    for (const [anchor, edge] of [
      ['end', (box: { y: number; height: number }) => box.y + box.height],
      ['start', (box: { y: number }) => box.y]
    ] as const) {
      const given = await drawsAsGiven(source, { chosen: { 'Bar.yAnchor': anchor } });
      // At step 1 the pointer j is on the first Bar, which it draws again.
      const drawnBars = bars(given.steps[1]);
      expect(drawnBars[0].kind).toBe('Here.Pointed');
      const scale = drawnBars[2].box.height / (9 * 16);
      const pixels = drawnBars.map(({ box }) => Math.round(box.height / scale));
      // The values 6, 2, 9, 4, 0, 7 at 16 pixels per unit; a Bar of 0 draws only its border.
      expect(pixels.slice(0, 4)).toEqual([96, 32, 144, 64]);
      expect(pixels[4]).toBeLessThan(4);
      expect(pixels[5]).toBe(112);
      expect(new Set(drawnBars.map(({ box }) => Math.round(edge(box))))).toHaveLength(1);
    }
  }
);

// Paint round a box takes no room of its own, so each box keeps room for its largest reach on each
// side in any state: a lifted shadow never lies over a neighbour or past the frame, and a pointer's
// glow passing changes nothing.
it.skipIf(!enabled)(
  'keeps room round each box for its shadow and a pointer’s glow, so neither overlaps nor moves anything',
  { timeout: 300_000 },
  async () => {
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = collection(Int, { max: 4 });
  const Index = index(Values);
</script>
<script input>
  const values = Values([7, 42, 3, 18]);
</script>
<script algorithm>
  @start[let i = Index(0);]
  while (@more[i < values.length]) @next[i++;]
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Here"><Pointed /></View>
<Layout name="Main"><Node>{values}{i}</Node></Layout>`;
    const given = await drawsAsGiven(source, {
      chosen: { 'Cell.shadow': 'lifted', 'Row.gap': 0, 'Here.Pointed.glow': 'on' }
    });
    const cells = (step: SceneStep) =>
      step.nodes
        .filter((node) => node.kind === 'Cell' || node.kind === 'Here.Pointed')
        .toSorted((a, b) => a.box.x - b.box.x)
        .map(({ box }) => box);
    const first = cells(given.steps[0]);
    expect(first).toHaveLength(4);
    for (const step of given.steps) {
      const boxes = cells(step);
      // Where they were at the first step, the pointer at one of them or past the end.
      expect(boxes.map(({ x }) => Math.round(x))).toEqual(first.map(({ x }) => Math.round(x)));
      // Lifted reaches 12 each side: between two boxes, room for both, and room at the edges.
      for (const [left, right] of boxes.slice(0, -1).map((box, k) => [box, boxes[k + 1]]))
        expect(right.x - (left.x + left.width)).toBeGreaterThanOrEqual(23.5);
      expect(boxes[0].x).toBeGreaterThanOrEqual(11.5);
      const last = boxes.at(-1)!;
      expect(given.frame.width - (last.x + last.width)).toBeGreaterThanOrEqual(11.5);
    }
  }
);

// A box varying in width takes its own size in a slot keeping the largest, so its slot, and every
// box beside it, stays put; its kind's anchor says which edge lines up.
it.skipIf(!enabled)(
  'draws a varying box its own size in an unchanged slot, placed by its anchor',
  { timeout: 300_000 },
  async () => {
    const source = `<script domain>
  const Name = type(['A', 'BBBBBB', 'CC']);
  const Names = collection(Name, { max: 3 });
</script>
<script input>
  const names = Names(['A', 'BBBBBB', 'CC']);
</script>
<script algorithm>
  @swap[const held = names[0]; names[0] = names[2]; names[2] = held;]
</script>
<View of="Name" name="Tag"><Node value={this} /></View>
<View of="Names" name="Row"><Node layout="row">{#each this as n}{n}{/each}</Node></View>
<Layout name="Main"><Node>{names}</Node></Layout>`;
    const tags = (step: SceneStep) =>
      step.nodes
        .filter((node) => node.kind === 'Tag')
        .toSorted((a, b) => a.box.x - b.box.x)
        .map(({ box }) => box);
    const uniform = tags((await drawsAsGiven(source)).steps[0]);
    expect(new Set(uniform.map(({ width }) => Math.round(width))).size).toBe(1);
    const left = (
      await drawsAsGiven(source, {
        chosen: { 'Tag.width': 'varying', 'Tag.xAnchor': 'start' }
      })
    ).steps;
    for (const step of left) {
      const boxes = tags(step);
      expect(new Set(boxes.map(({ width }) => Math.round(width))).size).toBeGreaterThan(1);
      // Left edges where the uniform boxes began: each slot unchanged.
      expect(boxes.map(({ x }) => Math.round(x))).toEqual(uniform.map(({ x }) => Math.round(x)));
    }
    const right = tags(
      (await drawsAsGiven(source, { chosen: { 'Tag.width': 'varying', 'Tag.xAnchor': 'end' } }))
        .steps[0]
    );
    expect(right.map(({ x, width }) => Math.round(x + width))).toEqual(
      uniform.map(({ x, width }) => Math.round(x + width))
    );
  }
);

// A row packing its children places each at its own size, a constant gap apart, so a growing child
// moves the next; the row keeps the room of each child's largest, so it never changes size.
it.skipIf(!enabled)(
  'packs a row’s children at their own sizes, the row itself keeping one size',
  { timeout: 300_000 },
  async () => {
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 999 });
</script>
<script algorithm>
  @start[let a = Int(1);
  let b = Int(5);]
  @grow[a = Int(100);]
</script>
<View of="Int" name="Num"><Node value={this} /></View>
<Layout name="Main"><Node><Node layout="row" kind="Pair">{a}{b}</Node></Node></Layout>`;
    const { steps } = await drawsAsGiven(source, {
      chosen: { 'Num.width': 'varying', 'Main.Pair.spacing': 'packed' }
    });
    const shown = steps.filter(
      (step) => step.nodes.filter(({ kind }) => kind === 'Num').length === 2
    );
    expect(shown.length).toBeGreaterThan(1);
    const pair = shown.map((step) => step.nodes.find(({ kind }) => kind === 'Main.Pair')!.box);
    expect(new Set(pair.map(({ width }) => Math.round(width))).size).toBe(1);
    const gaps = shown.map((step) => {
      const [first, second] = step.nodes
        .filter(({ kind }) => kind === 'Num')
        .toSorted((a, b) => a.box.x - b.box.x)
        .map(({ box }) => box);
      return { gap: Math.round(second.x - (first.x + first.width)), second: Math.round(second.x) };
    });
    // One gap throughout, so b moves when a grows.
    expect(new Set(gaps.map(({ gap }) => gap)).size).toBe(1);
    expect(new Set(gaps.map(({ second }) => second)).size).toBeGreaterThan(1);
  }
);

it.skipIf(!enabled)(
  'draws a pointer’s expansion as the server lays it out, painted in a row of slots and taking room in a packed one',
  { timeout: 300_000 },
  async () => {
    const source = `<script domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = collection(Int, { max: 6 });
  const Index = index(Values);
</script>
<script input>
  const values = Values([7, 42, 3, 18, 25]);
  const target = Int(18);
</script>
<script algorithm>
  @start[let i = Index(0);]
  while (@scan[values[i] !== target]) @next[i++;]
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Here"><Pointed /></View>
<Layout name="Main"><Node>{values}{i}</Node></Layout>`;
    for (const chosen of [
      { 'Here.Pointed.expand': 4 },
      { 'Here.Pointed.expand': 4, 'Row.spacing': 'packed' }
    ]) {
      const { steps } = await drawsAsGiven(source, { chosen });
      const rows = steps.flatMap((step) => step.nodes.filter(({ kind }) => kind === 'Row'));
      expect(new Set(rows.map(({ box }) => Math.round(box.width))).size).toBe(1);
    }
  }
);
