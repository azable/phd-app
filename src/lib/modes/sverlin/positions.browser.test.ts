/**
 * Elements read through positions, at(p), in a real browser. Run with `pnpm run test:browser`,
 * which the devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import bfs from './fixtures/bfs-queue-names.sverlin?raw';
import dequeue from './fixtures/bfs-dequeue.sverlin?raw';
import search from './fixtures/search-at.sverlin?raw';

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

/** The page of a source built with chosen values, and the text of a kind's node at a step. */
async function open(source: string, chosen: Record<string, string>) {
  const { javascript, labels } = await bundlePresentation(prepareSvelteComponent(source), 1, {
    chosen
  });
  const page = await browser!.newPage({ viewport: { width: 1200, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(sandboxDocument('', javascript, 0, 1));
  await page.waitForFunction(() =>
    document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
  );
  const show = async (step: number) => {
    await page.evaluate((step) => window.postMessage({ type: 'sverlin:step', step }, '*'), step);
    await page.waitForTimeout(800);
  };
  const text = (kind: string) =>
    page.evaluate(
      (kind) =>
        (
          document.querySelector<HTMLElement>(
            `.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind="${kind}"]`
          )?.innerText ?? ''
        )
          .replace(/\s+/g, ' ')
          .trim(),
      kind
    );
  return { page, errors, labels, show, text };
}

it.skipIf(!enabled)(
  'draws the queued vertices as the view of their positions chooses: numbers, names, or cards',
  { timeout: 120_000 },
  async () => {
    const added = (labels: readonly string[]) => labels.indexOf('@visit.look.add#2');
    const queued = async (view: string) => {
      const { page, errors, labels, show, text } = await open(bfs, { 'views.VertexRef': view });
      await show(added(labels));
      const shown = await text('QueueItems');
      // The names drawn are the vertices' own: their slots, not the queue's.
      const slots = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind="QueueItems"] [data-sv-slot]'
          )
        ].map((node) => node.dataset.svSlot)
      );
      expect(errors).toEqual([]);
      await page.close();
      return { shown, slots };
    };
    expect(await queued('VertexNumber')).toEqual({ shown: '1 2', slots: ['queue[0]', 'queue[1]'] });
    expect(await queued('VertexName')).toEqual({
      shown: 'B C',
      slots: ['vertices[1].name', 'vertices[2].name']
    });
    expect((await queued('VertexMini')).slots).toContain('vertices[2]');
  }
);

it.skipIf(!enabled)(
  'draws the value a position points at, and nothing past either end',
  { timeout: 120_000 },
  async () => {
    // lo and hi are declared by the algorithm, so they are drawn from its first step on.
    const values = await open(search, { 'views.Index': 'IndexValue' });
    await values.show(1);
    expect(await values.text('Bounds')).toBe('lo 3 hi 71');
    expect(values.errors).toEqual([]);
    await values.page.close();
    const numbers = await open(search, { 'views.Index': 'IndexNumber' });
    await numbers.show(1);
    expect(await numbers.text('Bounds')).toBe('lo 0 hi 6');
    await numbers.page.close();
    // Searching past the largest value, lo ends past the end: its value draws nothing there.
    const past = await open(search.replace('Int(42)', 'Int(99)'), { 'views.Index': 'IndexValue' });
    await past.show(past.labels.length - 1);
    expect(await past.text('Bounds')).toBe('lo hi 71');
    expect(past.errors).toEqual([]);
    await past.page.close();
  }
);

/**
 * The page of the BFS with its vertices drawn by name, or as `chosen` says, from the step before
 * `label`, and the animations each step after it starts: where the node is, what it draws, and
 * whether it moves, fades in, or fades out.
 */
async function animated(source: string, label: string, chosen: Record<string, string> = {}) {
  const opened = await open(source, { 'views.VertexRef': 'VertexName', ...chosen });
  const { page, labels, show } = opened;
  await page.evaluate(() => {
    const started: unknown[] = [];
    Object.assign(window, { started });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const frames = keyframes as Keyframe[];
      const node = this as HTMLElement;
      started.push({
        place:
          node.closest<HTMLElement>('[data-sv-kind="QueueItems"], [data-sv-kind="Taken"]')?.dataset
            .svKind ?? 'Graph',
        text: node.innerText.trim(),
        change: frames[0].translate ? 'moves' : frames[0].opacity === 0 ? 'appears' : 'goes'
      });
      return animate.call(this, keyframes, options);
    };
  });
  await show(labels.indexOf(label) - 1);
  const stepped = async (label: string) => {
    await page.evaluate(() => ((window as unknown as { started: unknown[] }).started.length = 0));
    await show(labels.indexOf(label));
    return page.evaluate(() => (window as unknown as { started: unknown[] }).started);
  };
  return { ...opened, stepped };
}

it.skipIf(!enabled)(
  "moves a vertex drawn through a position as that position, and the graph's vertex not at all",
  { timeout: 120_000 },
  async () => {
    const { page, errors, stepped } = await animated(dequeue, '@visit#1');
    // A's visit ends, the queue B C: current goes, as it is out of scope.
    expect(await stepped('@visit#1')).toContainEqual({ place: 'Taken', text: 'A', change: 'goes' });
    await stepped('@more#2');
    // B is taken: current's B is a copy of the queue's first entry, so it starts there.
    expect(await stepped('@visit.take#2')).toEqual([
      { place: 'Taken', text: 'B', change: 'moves' }
    ]);
    // B leaves the queue: the queue's B fades out, C slides into its place, and the graph's B and
    // current's B stay where they are.
    expect(await stepped('@visit.remove#2')).toEqual([
      { place: 'QueueItems', text: 'C', change: 'moves' },
      { place: 'QueueItems', text: 'B', change: 'goes' }
    ]);
    expect(errors).toEqual([]);
    await page.close();
    // Taken and removed in one step, A moves from the queue to current.
    const once = await animated(
      dequeue.replace(
        '@take[const current = queue[0];]\n    @remove[',
        '@take[const current = queue[0];\n    '
      ),
      '@visit.take#1'
    );
    expect(await once.stepped('@visit.take#1')).toEqual([
      { place: 'Taken', text: 'A', change: 'moves' }
    ]);
    expect(once.errors).toEqual([]);
    await once.page.close();
  }
);

it.skipIf(!enabled)(
  'fades a value drawn twice where one of its nodes goes and the other stays',
  { timeout: 120_000 },
  async () => {
    // current's name read from the vertex itself is the graph's name drawn again.
    const twice = dequeue.replace(
      '{@render VertexRef(current)}',
      '{@render Name(vertices[current].name)}'
    );
    const { page, errors, stepped } = await animated(twice, '@visit#1');
    expect(await stepped('@visit#1')).toContainEqual({ place: 'Taken', text: 'A', change: 'goes' });
    expect(errors).toEqual([]);
    await page.close();
  }
);

it.skipIf(!enabled)(
  'slides each vertex taken from the queue into current whole, though its neighbours list it too',
  { timeout: 120_000 },
  async () => {
    // Taken and removed in one step, the queue drawn by name and current as the vertex's card.
    const once = dequeue.replace(
      '@take[const current = queue[0];]\n    @remove[',
      '@take[const current = queue[0];\n    '
    );
    const { page, errors, labels, stepped } = await animated(once, '@visit.take#1', {
      'views.VertexRef@current': 'VertexMini',
      'views.QueueItems.VertexRef@item': 'VertexName'
    });
    for (const [take, name] of ['A', 'B', 'C', 'D', 'E'].entries()) {
      const label = `@visit.take#${take + 1}`;
      if (take) await stepped(labels[labels.indexOf(label) - 1]);
      const started = (
        (await stepped(label)) as { place: string; text: string; change: string }[]
      ).map((each) => ({ ...each, text: each.text.replace(/\s+/gu, ' ') }));
      // The card slides from the queue's front, nothing in it fading in, and nothing else goes.
      expect(started.filter(({ place }) => place === 'Taken')).toEqual([
        { place: 'Taken', text: `${name} seen`, change: 'moves' }
      ]);
      expect(started.filter(({ change }) => change !== 'moves')).toEqual([]);
    }
    expect(errors).toEqual([]);
    await page.close();
  }
);
