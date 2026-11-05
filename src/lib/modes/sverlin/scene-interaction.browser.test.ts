/**
 * Using a presentation drawn from the server's scenes (library/SceneView.svelte) as the mounted
 * page is used, in a real browser, each hosted in a frame as the app hosts it: the same clicks,
 * Shift-clicks, drags, Escape, references from the app, wheel zooms, middle-button pans and double
 * clicks must report the same selections (ids, labels and layouts) and views, and outline the same
 * boxes; hovering a place's reference must outline as many references. Each check's agreement is
 * written to test-results/scene-interaction.json. Run with `pnpm run test:browser`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';

import type { Frame } from 'playwright-core';
import { afterAll, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import dijkstra from './fixtures/dijkstra.sverlin?raw';
import search from './fixtures/search-places.sverlin?raw';
import { browserTestsOn as enabled, openHosted, settled } from './testing/browser';
import { pausingAt, pausingEveryLabel } from './testing/every-pause';

type Hosted = Awaited<ReturnType<typeof openHosted>>;
type Box = { x: number; y: number; width: number; height: number };
const tolerance = 2;

const rows: { check: string; mounted: string; scenes: string; alike: boolean }[] = [];
afterAll(() => {
  if (!rows.length) return;
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/scene-interaction.json', `${JSON.stringify(rows, null, 2)}\n`);
  console.table(rows);
});

/** Both pages, built and hosted alike, settled at a step. */
async function bothAt(source: string, step: number, chosen = {}): Promise<[Hosted, Hosted]> {
  const built = await bundlePresentation(prepareSvelteComponent(source), 1, { chosen });
  const pages = await Promise.all([
    openHosted(built.javascript),
    openHosted(built.javascript, { served: built.layout.scenes! })
  ]);
  for (const page of pages) {
    await page.send({ type: 'sverlin:step', step, selection: [] });
    await settled(page.frame, step);
  }
  return pages;
}

const lastOf = async (page: Hosted, type: string) => (await page.messages(type)).at(-1);

/** Compare what both pages last reported of a type, noting it in the table. */
async function agree(check: string, pages: [Hosted, Hosted], type: string) {
  const [mounted, scenes] = await Promise.all(pages.map((page) => lastOf(page, type)));
  const shown = (message: unknown) => JSON.stringify(message ?? null).slice(0, 300);
  rows.push({
    check,
    mounted: shown(mounted),
    scenes: shown(scenes),
    alike: shown(mounted) === shown(scenes)
  });
  return [mounted, scenes];
}

/** The box on screen of what a page draws for a node, or of its outline. */
function boxOf(frame: Frame, selector: string): Promise<Box | undefined> {
  return frame.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) return undefined;
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }, selector);
}

const near = (a: Box | undefined, b: Box | undefined) =>
  !!a &&
  !!b &&
  [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height].every(
    (difference) => Math.abs(difference) <= tolerance
  );

it.skipIf(!enabled)(
  'selects, references, zooms and pans as the mounted page does',
  { timeout: 300_000 },
  async () => {
    const pages = await bothAt(pausingEveryLabel(dijkstra), 3);
    const [mounted, scenes] = pages;
    // Three leaf nodes of the step, their centres on screen as the scene draws them.
    const leaves = await scenes.frame.evaluate(() => {
      const groups = [
        ...document.querySelectorAll<SVGGElement>('svg[data-sv-scene] g[data-sv-node]')
      ];
      const parents = new Set(groups.map((group) => group.parentElement?.closest('g')));
      return groups
        .filter((group) => !parents.has(group) && group.getBBox().width > 12)
        .map((group) => {
          const { x, y, width, height } = group.getBoundingClientRect();
          return { id: group.dataset.svNode!, x: x + width / 2, y: y + height / 2 };
        });
    });
    expect(leaves.length).toBeGreaterThan(2);
    const chosen = [leaves[0], leaves[Math.floor(leaves.length / 2)], leaves.at(-1)!];
    const click = async (x: number, y: number, modifiers: 'Shift'[] = []) => {
      for (const { page } of pages) {
        for (const key of modifiers) await page.keyboard.down(key);
        await page.mouse.click(x, y);
        for (const key of modifiers) await page.keyboard.up(key);
      }
    };

    await click(chosen[0].x, chosen[0].y);
    const [one, other] = await agree('click a node', pages, 'sverlin:selection');
    expect(other).toEqual(one);
    await click(chosen[1].x, chosen[1].y, ['Shift']);
    await click(chosen[2].x, chosen[2].y, ['Shift']);
    const [both, again] = await agree('shift-click two more', pages, 'sverlin:selection');
    expect((again as { elements: { id: string }[] }).elements.map(({ id }) => id)).toEqual(
      (both as { elements: { id: string }[] }).elements.map(({ id }) => id)
    );
    // The frame's empty space selects the page: a corner just inside the frame's edge.
    const frameBox = await boxOf(scenes.frame, 'svg[data-sv-scene]');
    await click(frameBox!.x + 4, frameBox!.y + 4);
    const [page, pageAgain] = await agree('click the page', pages, 'sverlin:selection');
    expect(pageAgain).toEqual(page);
    await Promise.all(pages.map(({ page }) => page.keyboard.press('Escape')));
    const [none, noneAgain] = await agree('Escape', pages, 'sverlin:selection');
    expect(noneAgain).toEqual(none);
    // A box dragged round the middle of the frame.
    const drag = async (from: [number, number], to: [number, number], button?: 'middle') => {
      for (const { page } of pages) {
        await page.mouse.move(...from);
        await page.mouse.down(button ? { button } : {});
        await page.mouse.move(...to, { steps: 4 });
        await page.mouse.up(button ? { button } : {});
      }
    };
    const { x, y, width, height } = frameBox!;
    await drag([x + width * 0.3, y + height * 0.2], [x + width * 0.7, y + height * 0.8]);
    const [boxed, boxedAgain] = await agree('drag a box', pages, 'sverlin:selection');
    const ids = (message: unknown) =>
      (message as { elements: { id: string }[] }).elements.map(({ id }) => id).sort();
    expect(ids(boxedAgain)).toEqual(ids(boxed));

    // A reference the app opens is outlined round the same box.
    await Promise.all(
      pages.map((page) => page.send({ type: 'sverlin:select', ids: [chosen[0].id] }))
    );
    const outline = async () => [
      await mounted.frame
        .waitForSelector('.sv-selected')
        .then(() => boxOf(mounted.frame, '.sv-selected')),
      await scenes.frame
        .waitForSelector('.sv-scene-selected')
        .then(() => boxOf(scenes.frame, '.sv-scene-selected'))
    ];
    const [shownBox, drawnBox] = await outline();
    rows.push({
      check: 'reference outline',
      mounted: JSON.stringify(shownBox),
      scenes: JSON.stringify(drawnBox),
      alike: near(shownBox, drawnBox)
    });
    expect(near(shownBox, drawnBox)).toBe(true);

    // Zooming about a point, then panning, report the same view, and draw the node in the same place.
    for (const { page } of pages) {
      await page.mouse.move(x + width * 0.4, y + height * 0.4);
      await page.mouse.wheel(0, -300);
    }
    await expect
      .poll(async () =>
        (await Promise.all(pages.map((page) => page.messages('sverlin:view')))).map(
          (views) => views.length
        )
      )
      .toEqual([1, 1]);
    const [zoomed, zoomedAgain] = await agree('wheel zoom', pages, 'sverlin:view');
    for (const key of ['zoom', 'panX', 'panY'] as const)
      expect(Number((zoomedAgain as Record<string, number>)[key])).toBeCloseTo(
        Number((zoomed as Record<string, number>)[key]),
        1
      );
    await drag([x + 100, y + 100], [x + 160, y + 130], 'middle');
    const [panned, pannedAgain] = await agree('middle-button pan', pages, 'sverlin:view');
    expect(Number((pannedAgain as Record<string, number>).panX)).toBeCloseTo(
      Number((panned as Record<string, number>).panX),
      0
    );
    const [movedShown, movedDrawn] = await outline();
    rows.push({
      check: 'outline after zoom and pan',
      mounted: JSON.stringify(movedShown),
      scenes: JSON.stringify(movedDrawn),
      alike: near(movedShown, movedDrawn)
    });
    expect(near(movedShown, movedDrawn)).toBe(true);
    // A double click outside the frame resets the view.
    for (const { page } of pages) await page.mouse.dblclick(3, 3);
    const [reset, resetAgain] = await agree('double-click reset', pages, 'sverlin:view');
    expect(resetAgain).toEqual(reset);
  }
);

it.skipIf(!enabled)(
  'outlines every reference to a place hovered, as the mounted page does',
  { timeout: 300_000 },
  async () => {
    const pages = await bothAt(pausingAt(search, '@probe.low'), 1, {
      'IntCell@target.stroke': 'violet-500',
      'listing.places': 'fill'
    });
    const [mounted, scenes] = pages;
    const token = await boxOf(
      mounted.frame,
      '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind="listing-token"][data-sv-place="@target"]'
    );
    expect(token).toBeDefined();
    for (const { page } of pages)
      await page.mouse.move(token!.x + token!.width / 2, token!.y + token!.height / 2);
    const counted = await Promise.all([
      mounted.frame.evaluate(() => document.querySelectorAll('[data-sv-hovered]').length),
      scenes.frame.evaluate(() => document.querySelectorAll('.sv-scene-hovered').length)
    ]);
    rows.push({
      check: 'hover a listing token',
      mounted: `${counted[0]} outlined`,
      scenes: `${counted[1]} outlined`,
      alike: counted[0] === counted[1]
    });
    expect(counted[0]).toBeGreaterThan(1);
    expect(counted[1]).toBe(counted[0]);
  }
);
