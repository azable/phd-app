/**
 * Moves between steps, in a real browser: two presentations stacked in sandboxed frames, as the
 * comparison view shows them, stepped together. The second of two frames is drawn less often, so
 * a step there can settle before the frame has fitted it, and its moves then start from the wrong
 * place; only a browser shows that. Run with `pnpm run test:browser`, which the devenv gives a
 * browser (SVERLIN_TEST_BROWSER).
 */

import { chromium, type Browser, type Frame } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sandboxDocument } from '../sandbox';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';

const enabled = process.env.SVERLIN_RUN_BROWSER_TESTS === '1';

const merge = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
</script>
<script lang="sverlin" input>
  const left = Values([1, 4, 7]);
  const right = Values([2, 3, 9]);
</script>
<script lang="sverlin">
  let merged = Values([]);
  let i = Position(left, 0);
  let j = Position(right, 0);
  yield;
  while (i < left.length || j < right.length) {
    if (j === right.length || (i < left.length && left[i] < right[j])) {
      merged.push(left[i]);
      i++;
    } else {
      merged.push(right[j]);
      j++;
    }
    const k = Position(merged, merged.length - 1);
    yield;
  }
</script>
{#snippet IntText(value: Int)}<Node {value} />{/snippet}
{#snippet IntCard(value: Int)}<Node layout="row"><Node {value} /></Node>{/snippet}
{#snippet Row(list: Values)}<Node layout="row">{#each list as v}{@render Int(v)}{/each}</Node>{/snippet}
{#snippet Arrow(p: Position)}<Node layout="column"><Pointed /><Node tags="label">↑</Node></Node>{/snippet}
{#snippet Placed(p: Position)}<Pointed tags="placed" />{/snippet}
<Node layout="column">{@render Row(left)}{@render Row(right)}{@render Row(merged)}</Node>
{@render Arrow(i)}
{@render Arrow(j)}
{@render Placed(k)}`;

let browser: Browser | undefined;
beforeAll(async () => {
  if (!enabled) return;
  // The session's library path can hold libraries of another package set than the browser's.
  const env = { ...process.env } as Record<string, string>;
  delete env.LD_LIBRARY_PATH;
  browser = await chromium.launch({ executablePath: process.env.SVERLIN_TEST_BROWSER, env });
});
afterAll(() => browser?.close());

/** Where each visible node with an identity is, by identity, on the layer shown. */
function placed(frame: Frame): Promise<Record<string, [number, number]>> {
  return frame.evaluate(() => {
    const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)');
    return Object.fromEntries(
      [...(layer?.querySelectorAll<HTMLElement>('[data-sv-identity]') ?? [])].map((node) => {
        const box = node.getBoundingClientRect();
        return [node.dataset.svIdentity, [Math.round(box.left), Math.round(box.top)]];
      })
    );
  });
}

/** Where each moving node starts, held at the start of its move, with the value it was copied from. */
function starts(
  frame: Frame
): Promise<{ identity: string; at: [number, number]; copiedFrom?: string }[]> {
  return frame.evaluate(() => {
    const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)');
    const moves = (layer?.getAnimations({ subtree: true }) ?? []).filter(
      (animation) => (animation.effect as KeyframeEffect).getKeyframes()[0].translate !== undefined
    );
    for (const move of moves) {
      move.pause();
      move.currentTime = 0;
    }
    return moves.map((move) => {
      const node = (move.effect as KeyframeEffect).target as HTMLElement;
      const box = node.getBoundingClientRect();
      return {
        identity: node.dataset.svIdentity ?? '',
        at: [Math.round(box.left), Math.round(box.top)] as [number, number]
      };
    });
  });
}

it.skipIf(!enabled)(
  'starts every move between steps where the node was, in both of two stacked frames',
  { timeout: 180_000 },
  async () => {
    const prepared = prepareSvelteComponent(merge);
    // Copies start where the value they were copied from was (identities.server.ts).
    const copies = prepared.master.map(({ identities }) => identities?.copies ?? {});
    const frames = await Promise.all(
      [1, 2].map(async (seed) => {
        const { javascript } = await bundlePresentation(prepared, seed);
        return sandboxDocument('', javascript, 0, seed);
      })
    );
    const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    for (const [width, height] of [
      [1300, 300],
      [700, 380]
    ]) {
      const page = await browser!.newPage({ viewport: { width, height: 2 * height + 8 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(
        `<body style="margin:0;display:flex;flex-direction:column;gap:8px">${frames
          .map(
            (document) =>
              `<iframe sandbox="allow-scripts" style="width:${width}px;height:${height}px;border:0" srcdoc="${escape(document)}"></iframe>`
          )
          .join('')}</body>`
      );
      const step = (index: number) =>
        page.evaluate((index) => {
          for (const frame of document.querySelectorAll('iframe'))
            frame.contentWindow?.postMessage(
              { type: 'sverlin:step', step: index, selection: [] },
              '*'
            );
        }, index);
      const panes = page.frames().slice(1);
      await step(0);
      for (const pane of panes)
        await pane.waitForFunction(() => document.querySelector('.sv-layer:not(.pending)'), null, {
          timeout: 60_000
        });

      for (let index = 1; index < prepared.master.length; index++) {
        const before = await Promise.all(panes.map(placed));
        await step(index);
        for (const [pane, frame] of panes.entries()) {
          await frame.waitForFunction(
            () =>
              document
                .querySelector('.sv-layer:not(.pending):not(.sv-leaving)')
                ?.getAnimations({ subtree: true }).length,
            null,
            { timeout: 20_000 }
          );
          for (const { identity, at } of await starts(frame)) {
            const from = before[pane][identity] ?? before[pane][copies[index][Number(identity)]];
            expect(at, `step ${index + 1}, frame ${pane + 1}, identity ${identity}`).toEqual(from);
          }
          await frame.evaluate(() => {
            for (const animation of document.getAnimations()) animation.finish();
          });
        }
      }
      expect(errors).toEqual([]);
      await page.close();
    }
  }
);

const walk = `<script lang="sverlin" domain>
  const Name = type(['A', 'B', 'C']);
  const Names = collection(Name);
  const Vertex = index(Names);
  const Edge = record({ from: Vertex, to: Vertex });
  const Edges = collection(Edge);
  const EdgeIndex = index(Edges);
</script>
<script lang="sverlin" input>
  const vertices = Names(['A', 'B', 'C']);
  const edges = Edges([{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 0, to: 2 }]);
</script>
<script lang="sverlin">
  yield;
  for (let e = EdgeIndex(0); e < edges.length; e++) yield;
</script>
{#snippet NameText(name: Name)}<Node value={name} />{/snippet}
{#snippet Arrow(edge: Edge)}<Link from={edge.from} to={edge.to} />{/snippet}
{#snippet Current(c: EdgeIndex)}<Pointed tags="current" />{/snippet}
<Node layout="free">
  {#each vertices as name}{@render Name(name)}{/each}
  {#each edges as edge}{@render Arrow(edge)}{/each}
</Node>
{@render Current(e)}`;

it.skipIf(!enabled)(
  'draws each arrow with its own step’s arrowhead while two steps are in the page',
  { timeout: 120_000 },
  async () => {
    const prepared = prepareSvelteComponent(walk);
    const { javascript } = await bundlePresentation(prepared, 1);
    const page = await browser!.newPage({ viewport: { width: 1000, height: 600 } });
    await page.setContent(
      `<body style="margin:0"><iframe sandbox="allow-scripts" style="width:1000px;height:600px;border:0" srcdoc="${sandboxDocument('', javascript, 0, 1).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe></body>`
    );
    const frame = page.frames()[1];
    // The page takes steps only from the page around it, as from the app.
    const step = (index: number) =>
      page.evaluate((index) => {
        document
          .querySelector('iframe')
          ?.contentWindow?.postMessage({ type: 'sverlin:step', step: index }, '*');
      }, index);
    await step(0);
    await frame.waitForFunction(() => document.querySelector('.sv-layer:not(.pending)'), null, {
      timeout: 60_000
    });
    for (let index = 1; index < prepared.master.length; index++) {
      await step(index);
      // A fragment reference finds the first element with its id in the page. Checked once both
      // steps are in the page, waited for as an object, as a count of 0 would read as not yet.
      const check = await frame.waitForFunction(
        () => {
          if (document.querySelectorAll('.sv-layer').length < 2) return false;
          const foreign = [...document.querySelectorAll('path[marker-end]')].filter((path) => {
            const id = path.getAttribute('marker-end')!.slice('url(#'.length, -1);
            return document.getElementById(id)?.closest('.sv-layer') !== path.closest('.sv-layer');
          }).length;
          return { foreign };
        },
        null,
        { timeout: 20_000, polling: 5 }
      );
      expect(await check.jsonValue(), `step ${index + 1}`).toEqual({ foreign: 0 });
      await page.waitForTimeout(600);
    }
    await page.close();
  }
);
