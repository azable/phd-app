/**
 * Using a presentation as the app hosts it, in a real browser: clicks, Shift-clicks, drags, Escape,
 * references from the app, wheel zooms, middle-button pans, double clicks and hovering must report
 * the selections (ids, labels and layouts) and views, and outline the boxes, that the page mounting
 * the view reported for the same gestures, recorded at `legacy-renderer` (c41a661d), the last
 * commit with it. Run with `pnpm run test:browser`.
 */

import type { Frame } from 'playwright-core';
import { expect, it } from 'vitest';

import { prepareSvelteComponent } from './compile.server';
import { bundlePresentation } from './testing/scenes';
import dijkstra from './fixtures/dijkstra.sverlin?raw';
import search from './fixtures/search-places.sverlin?raw';
import { colourCss } from './library/node/design';
import { browserTestsOn as enabled, openHosted, settled } from './testing/browser';
import { pausingAt, pausingEveryLabel } from './testing/every-pause';

type Hosted = Awaited<ReturnType<typeof openHosted>>;
type Box = { x: number; y: number; width: number; height: number };
type Selected = { id: string; label: string; layouts: unknown[] };
const graphLayout = {
  node: '74:3',
  kind: 'Graph',
  seed: 1,
  form: 'natural',
  direction: 'right',
  curve: 'straight'
};

/** A page built and hosted as the app hosts it, settled at a step. */
async function hostedAt(source: string, step: number, chosen = {}): Promise<Hosted> {
  const built = await bundlePresentation(prepareSvelteComponent(source), 1, { chosen });
  const hosted = await openHosted(built);
  await hosted.send({ type: 'sverlin:step', step, selection: [] });
  await settled(hosted.frame, step);
  return hosted;
}

const lastOf = async (page: Hosted, type: string) => (await page.messages(type)).at(-1);
const selected = async (page: Hosted) =>
  ((await lastOf(page, 'sverlin:selection')) as { elements: Selected[] }).elements;

function boxOf(frame: Frame, selector: string): Promise<Box | undefined> {
  return frame.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) return undefined;
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }, selector);
}

const near = (a: Box | undefined, b: Box) =>
  !!a &&
  [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height].every(
    (difference) => Math.abs(difference) <= 2
  );

it.skipIf(!enabled)(
  'selects, references, zooms and pans as the mounted page did',
  { timeout: 300_000 },
  async () => {
    const hosted = await hostedAt(pausingEveryLabel(dijkstra), 3);
    const { page, frame } = hosted;
    // Three leaf nodes of the step, their centres on screen.
    const leaves = await frame.evaluate(() => {
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
    const chosen = [leaves[0], leaves[Math.floor(leaves.length / 2)], leaves.at(-1)!];
    const click = async (x: number, y: number, shift = false) => {
      if (shift) await page.keyboard.down('Shift');
      await page.mouse.click(x, y);
      if (shift) await page.keyboard.up('Shift');
    };

    await click(chosen[0].x, chosen[0].y);
    expect(await selected(hosted)).toEqual([
      { id: '84:22', label: "Dijkstra's shortest paths", layouts: [] }
    ]);
    await click(chosen[1].x, chosen[1].y, true);
    await click(chosen[2].x, chosen[2].y, true);
    const three = await selected(hosted);
    expect(three.slice(0, 2)).toEqual([
      { id: '84:22', label: "Dijkstra's shortest paths", layouts: [] },
      { id: '60:5#4', label: 'distance 99', layouts: [graphLayout] }
    ]);
    expect(three[2]).toMatchObject({ id: '49:33#2', label: 'B' });
    // The frame's empty space selects the page: a corner just inside the frame's edge.
    const { x, y, width, height } = (await boxOf(frame, 'svg[data-sv-scene]'))!;
    await click(x + 4, y + 4);
    expect(await selected(hosted)).toEqual([
      { id: '93:3', label: 'the page, as Main', layouts: [] }
    ]);
    await page.keyboard.press('Escape');
    expect(await selected(hosted)).toEqual([]);
    const drag = async (from: [number, number], to: [number, number], button?: 'middle') => {
      await page.mouse.move(...from);
      await page.mouse.down(button ? { button } : {});
      await page.mouse.move(...to, { steps: 4 });
      await page.mouse.up(button ? { button } : {});
    };
    await drag([x + width * 0.3, y + height * 0.2], [x + width * 0.7, y + height * 0.8]);
    expect((await selected(hosted)).slice(0, 2)).toEqual([
      { id: '58:3#2', label: 'B distance 99 open', layouts: [graphLayout] },
      { id: '50:31#3', label: '99', layouts: [graphLayout] }
    ]);

    // A reference the app opens is outlined round its box, before and after zooming and panning.
    await hosted.send({ type: 'sverlin:select', ids: [chosen[0].id] });
    const outline = () =>
      frame.waitForSelector('.sv-scene-selected').then(() => boxOf(frame, '.sv-scene-selected'));
    expect(near(await outline(), { x: 504.2, y: 124.2, width: 191.6, height: 25.1 })).toBe(true);
    await page.mouse.move(x + width * 0.4, y + height * 0.4);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await hosted.messages('sverlin:view')).length).toBe(1);
    const view = async () => (await lastOf(hosted, 'sverlin:view')) as Record<string, number>;
    const zoomed = await view();
    expect([zoomed.zoom, zoomed.panX, zoomed.panY].map((n) => Math.round(n * 100) / 100)).toEqual([
      1.33, 38.73, 21.85
    ]);
    await drag([x + 100, y + 100], [x + 160, y + 130], 'middle');
    const panned = await view();
    expect([panned.panX, panned.panY].map(Math.round)).toEqual([99, 52]);
    expect(near(await outline(), { x: 571.2, y: 101.3, width: 255, height: 33.4 })).toBe(true);
    // A double click outside the frame resets the view.
    await page.mouse.dblclick(3, 3);
    expect(await lastOf(hosted, 'sverlin:view')).toEqual({
      type: 'sverlin:view',
      zoom: 1,
      panX: 0,
      panY: 0
    });
  }
);

it.skipIf(!enabled)(
  'outlines every reference to a place hovered, as the mounted page did',
  { timeout: 300_000 },
  async () => {
    const { page, frame } = await hostedAt(pausingAt(search, '@probe.low.end'), 1, {
      'IntCell@target.stroke': 'violet-500',
      'listing.places': 'fill',
      'Arrow.Pointed.fill': 'amber-100',
      'Arrow.Pointed.stroke': 'amber-500'
    });
    const tokenOf = (place: string) =>
      frame.evaluate((place) => {
        const text = [...document.querySelectorAll('svg[data-sv-scene] text[data-sv-place]')].find(
          (element) => element.getAttribute('data-sv-place') === place
        );
        const box = text?.getBoundingClientRect();
        return box && { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }, place);
    const token = await tokenOf('@target');
    expect(token).toBeDefined();
    await page.mouse.move(token!.x, token!.y);
    // The token and the target's cell, as the mounted page outlined.
    expect(await frame.evaluate(() => document.querySelectorAll('.sv-scene-hovered').length)).toBe(
      2
    );
    // A pointer's pale fill outlines in its stroke, darkened until it shows on the page.
    const lo = await tokenOf('@lo');
    await page.mouse.move(lo!.x, lo!.y);
    const colours = await frame.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.sv-scene-hovered')].map((outline) =>
        outline.style.getPropertyValue('--sv-hover')
      )
    );
    expect(colours.length).toBeGreaterThan(0);
    expect(new Set(colours)).toEqual(new Set([colourCss('amber-600')]));
  }
);

it.skipIf(!enabled)(
  "outlines a pointer's place when its label is hovered, drawn beside the pointer view's node",
  { timeout: 300_000 },
  async () => {
    const labelled = search.replace(
      '<View of="Index" name="Arrow"><Pointed /></View>',
      '<View of="Index" name="Arrow"><Node layout="column"><Pointed /><Node kind="Caption">at</Node></Node></View>'
    );
    expect(labelled).not.toBe(search);
    const { page, frame } = await hostedAt(pausingAt(labelled, '@probe.low.end'), 1, {
      'listing.places': 'fill'
    });
    const label = await frame.evaluate(() => {
      const box = document
        .querySelector('svg[data-sv-scene] g[data-sv-kind="Arrow.Caption"] text')
        ?.getBoundingClientRect();
      return box && { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    expect(label).toBeDefined();
    await page.mouse.move(label!.x, label!.y);
    expect(
      await frame.evaluate(() => document.querySelectorAll('.sv-scene-hovered').length)
    ).toBeGreaterThan(0);
  }
);
