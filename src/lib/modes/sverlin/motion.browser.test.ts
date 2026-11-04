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
import { pausingAt, pausingEveryLabel } from './testing/every-pause';
import { motionDuration } from './library/motion';

const enabled = process.env.SVERLIN_RUN_BROWSER_TESTS === '1';

const merge = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Position = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const left = Values;
  const right = Values;
</script><Case name="main" left={[1, 4, 7]} right={[2, 3, 9]} />
<script algorithm>
  @start[let merged = Values([]);
  let i = Position(left, 0);
  let j = Position(right, 0);]
  while (@more[(i < left.length) || (j < right.length)]) {
    @take[if (@fromLeft[(j === right.length) || ((i < left.length) && (left[i] < right[j]))]) {
      merged.push(left[i]);
      i++;
    } else {
      merged.push(right[j]);
      j++;
    }]
    @step[const k = merged.length - 1;]
  }
</script>
<View of="Int" name="IntText"><Node value={this} /></View>
<View of="Int" name="IntCard"><Node layout="row"><Node value={this} /></Node></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Position" name="Arrow"><Node layout="column"><Pointed /><Node>↑</Node></Node></View>
<View of="Position" name="Placed"><Pointed /></View>
<Layout name="Rows" of="left, right, merged"><Node layout="column">{left}{right}{merged}</Node></Layout>

<Layout name="Main" of="i, j, k, left, right, merged">
  <Node>
    <Rows left={left} right={right} merged={merged} />
    {i}
    {j}
    {k}
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main i={i} j={j} k={k} left={left} right={right} merged={merged} /></Scene>
</Storyboard>`;

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

/**
 * Where each moving node starts, held at the start of its move, with the value it was copied from,
 * on the layer shown, or the first matching the selector given.
 */
function starts(
  frame: Frame,
  selector = '.sv-layer:not(.pending):not(.sv-leaving)'
): Promise<{ identity: string; at: [number, number]; copiedFrom?: string }[]> {
  return frame.evaluate((selector) => {
    const layer = document.querySelector(selector);
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
  }, selector);
}

it.skipIf(!enabled)(
  'starts every move where the node was, or a copy where its value was, in both of two stacked frames',
  { timeout: 180_000 },
  async () => {
    // Every label pauses, so each step of the trace is a step of the page.
    const prepared = prepareSvelteComponent(pausingEveryLabel(merge));
    let stepCount = 0;
    const frames = await Promise.all(
      [1, 2].map(async (seed) => {
        const { javascript, labels } = await bundlePresentation(prepared, seed, {
          chosen: { 'pointers.Position@k': 'Placed' }
        });
        stepCount = labels.length;
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

      // The layer shown is marked once checked, so the next one to show is told apart.
      const seen = (frame: Frame) =>
        frame.evaluate(() =>
          document
            .querySelector('.sv-layer:not(.pending):not(.sv-leaving)')
            ?.setAttribute('data-checked', '')
        );
      for (let index = 1; index < stepCount; index++) {
        const from = await Promise.all(panes.map(placed));
        await Promise.all(panes.map(seen));
        await step(index);
        // Each step shows one layer, its after, its moves starting from the step before.
        for (const [pane, frame] of panes.entries()) {
          {
            await frame.waitForFunction(
              () =>
                document.querySelector(
                  '.sv-layer:not(.pending):not(.sv-leaving):not([data-checked])'
                ),
              null,
              { timeout: 20_000 }
            );
            // Claimed as it is read, so a layer the page replaces at once is not marked unseen, and its
            // moves read from it, though the page has gone on to the next.
            await frame.evaluate(() => {
              const layer = document.querySelector(
                '.sv-layer:not(.pending):not(.sv-leaving):not([data-checked])'
              ) as HTMLElement;
              layer.setAttribute('data-checked', '');
              document.querySelector('[data-claimed]')?.removeAttribute('data-claimed');
              layer.setAttribute('data-claimed', '');
            });
            // A value copied since the step before starts where some value it was copied from was.
            const places = Object.values(from[pane]).map((at) => at.join());
            for (const { identity, at } of await starts(frame, '.sv-layer[data-claimed]')) {
              const where = `step ${index + 1}, frame ${pane + 1}, identity ${identity}`;
              const was = from[pane][identity];
              if (was) expect(at, where).toEqual(was);
              else expect(places, where).toContain(at.join());
            }
            await frame.evaluate(() => {
              for (const animation of document.getAnimations()) animation.finish();
            });
            from[pane] = await placed(frame);
          }
        }
      }
      expect(errors).toEqual([]);
      await page.close();
    }
  }
);

const walk = `<script domain>
  const Name = type(['A', 'B', 'C']);
  const Names = array(Name, { max: 8 });
  const Vertex = index(Names);
  const Edge = record({ from: Vertex, to: Vertex });
  const Edges = array(Edge, { max: 8 });
  const EdgeIndex = index(Edges);
  const Flag = type('boolean');
</script>
<script input>
  const vertices = Names;
  const edges = Edges;
</script><Case name="main" vertices={['A', 'B', 'C']} edges={[{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 0, to: 2 }]} />
<script algorithm>
  @step[for (@first[let e = EdgeIndex(0)]; @more[e < edges.length]; @next[e++]) {}]
</script>
<View of="Name" name="NameText"><Node value={this} /></View>
<View of="Edge" name="Arrow"><Link from={this.from} to={this.to} /></View>
<View of="EdgeIndex" name="Current"><Pointed /></View>
<Layout name="Graph" of="vertices, edges">
  <Node layout="free">
    {#each vertices as name}{name}{/each}
    {#each edges as edge}{edge}{/each}
  </Node>
</Layout>

<Layout name="Main" of="e, vertices, edges">
  <Node>
    <Graph vertices={vertices} edges={edges} />
    {e}
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main e={e} vertices={vertices} edges={edges} /></Scene>
</Storyboard>`;

it.skipIf(!enabled)(
  'draws each arrow with its own step’s arrowhead while two steps are in the page',
  { timeout: 120_000 },
  async () => {
    const prepared = prepareSvelteComponent(pausingEveryLabel(walk));
    const { javascript, labels } = await bundlePresentation(prepared, 1);
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
    for (let index = 1; index < labels.length; index++) {
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
      // A step forward plays its before, then its after.
      await page.waitForTimeout(1200);
    }
    await page.close();
  }
);

const taken = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
  const Take = record({ from: Index });
  const Flag = type('boolean');
</script>
<script input>
  const left = Values;
  const right = Values;
</script><Case name="main" left={[1, 4, 6]} right={[2, 3, 5]} />
<script algorithm>
  @start[let i = Index(left, 0);
  let j = Index(right, 0);
  let take = Take({ from: j });]
  @step[while (@more[(i < left.length) && (j < right.length)]) {
    if (@less[left[i] < right[j]]) {
      take = Take({ from: i });
      i++;
    } else {
      take = Take({ from: j });
      j++;
    }
  }]
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Taken">
  <Node layout="column"><Pointed /><Node>taken</Node></Node>
</View>

<Layout name="Main" of="left, right, take">
  <Node>
    {left}
    {right}
    {take.from}
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main left={left} right={right} take={take} /></Scene>
</Storyboard>`;

it.skipIf(!enabled)(
  'keeps every element in place as a pointer moves between collections',
  { timeout: 120_000 },
  async () => {
    const prepared = prepareSvelteComponent(pausingEveryLabel(taken));
    const { javascript } = await bundlePresentation(prepared, 1);
    const page = await browser!.newPage({ viewport: { width: 800, height: 500 } });
    await page.setContent(
      `<body style="margin:0"><iframe sandbox="allow-scripts" style="width:800px;height:500px;border:0" srcdoc="${sandboxDocument('', javascript, 0, 1).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe></body>`
    );
    const frame = page.frames()[1];
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
    const first = await placed(frame);
    // No row keeps an end slot: j goes one past the end of right, but nothing draws j.
    const slots = await frame.evaluate(() =>
      [...document.querySelectorAll('.sv-layer:not(.pending) [data-sv-kind="Row"] > .items')].map(
        (items) => items.children.length
      )
    );
    expect(slots).toEqual([3, 3]);
    for (let index = 1; index < prepared.master.length; index++) {
      await step(index);
      // A step forward plays its before, then its after.
      await page.waitForTimeout(1500);
      await frame.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
      const now = await placed(frame);
      // The pointer moves; the elements, and their values, stay where they are.
      for (const [identity, at] of Object.entries(first))
        if (now[identity] && !identity.startsWith('pointer'))
          expect(now[identity], `step ${index + 1}, identity ${identity}`).toEqual(at);
    }
    await page.close();
  }
);

const apart = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[1, 4, 6, 2]} />
<script algorithm>
  @start[let i = Index(0);
  let j = Index(2);]
  @once[i = (i + 1) % 4;
  j = (j + 1) % 4;]
  @twice[i = (i + 1) % 4;
  j = (j + 1) % 4;]
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Short"><Node layout="column"><Pointed /><Node>i</Node></Node></View>
<View of="Index" name="Long"><Node layout="column"><Pointed /><Node>the other one</Node></Node></View>

<Layout name="Main" of="values, i, j">
  <Node>
    {values}
    {i}
    {j}
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} i={i} j={j} /></Scene>
</Storyboard>`;

it.skipIf(!enabled)(
  'keeps every element in place as pointers never at one element share a slot for their labels',
  { timeout: 120_000 },
  async () => {
    const prepared = prepareSvelteComponent(pausingEveryLabel(apart));
    const { javascript } = await bundlePresentation(prepared, 1, {
      chosen: { 'pointers.Index@i': 'Short', 'pointers.Index@j': 'Long' }
    });
    const page = await browser!.newPage({ viewport: { width: 800, height: 500 } });
    await page.setContent(
      `<body style="margin:0"><iframe sandbox="allow-scripts" style="width:800px;height:500px;border:0" srcdoc="${sandboxDocument('', javascript, 0, 1).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe></body>`
    );
    const frame = page.frames()[1];
    const step = (index: number) =>
      page.evaluate((index) => {
        document
          .querySelector('iframe')
          ?.contentWindow?.postMessage({ type: 'sverlin:step', step: index }, '*');
      }, index);
    await step(1);
    await frame.waitForFunction(() => document.querySelector('.sv-layer:not(.pending)'), null, {
      timeout: 60_000
    });
    const first = await placed(frame);
    for (let index = 2; index < prepared.master.length; index++) {
      await step(index);
      await page.waitForTimeout(1500);
      await frame.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
      const now = await placed(frame);
      for (const [identity, at] of Object.entries(first))
        if (now[identity] && !identity.startsWith('pointer'))
          expect(now[identity], `step ${index + 1}, identity ${identity}`).toEqual(at);
      // Each label sits right under its element, in the one slot the two share.
      const tops = await frame.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.sv-layer:not(.pending):not(.sv-leaving) .sv-node'
          )
        ]
          .filter(
            (node) =>
              ['i', 'the other one'].includes(node.innerText.trim()) &&
              !node.closest('[data-sv-hidden="true"]') &&
              !node.querySelector('.sv-node')
          )
          .map((node) => Math.round(node.getBoundingClientRect().top))
      );
      expect(tops, `step ${index + 1}`).toHaveLength(2);
      expect(new Set(tops).size, `step ${index + 1}`).toBe(1);
    }
    await page.close();
  }
);

const far = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[3, 8]} />
<script algorithm>
  @start[let i = Index(0);]
  @far[i = 7;]
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Here"><Pointed /></View>

<Layout name="Main" of="values, i">
  <Node>
    {values}
    {i}
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} i={i} /></Scene>
</Storyboard>`;

it.skipIf(!enabled)(
  'keeps room at most 4 past an end, a pointer further out drawing nothing',
  { timeout: 120_000 },
  async () => {
    const prepared = prepareSvelteComponent(pausingEveryLabel(far));
    const { javascript } = await bundlePresentation(prepared, 1);
    const page = await browser!.newPage({ viewport: { width: 800, height: 500 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(
      `<body style="margin:0"><iframe sandbox="allow-scripts" style="width:800px;height:500px;border:0" srcdoc="${sandboxDocument('', javascript, 0, 1).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe></body>`
    );
    const frame = page.frames()[1];
    const step = (index: number) =>
      page.evaluate((index) => {
        document
          .querySelector('iframe')
          ?.contentWindow?.postMessage({ type: 'sverlin:step', step: index }, '*');
      }, index);
    const drawn = () =>
      frame.evaluate(() => {
        const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)');
        const items = layer?.querySelector('[data-sv-kind="Row"] > .items');
        return {
          slots: items?.children.length,
          // The element the pointer is at is drawn in its kind.
          pointers: [
            ...(layer?.querySelectorAll<HTMLElement>('[data-sv-kind="Here.Pointed"]') ?? [])
          ].filter((node) => getComputedStyle(node).visibility !== 'hidden').length
        };
      });
    await step(0);
    await frame.waitForFunction(() => document.querySelector('.sv-layer:not(.pending)'), null, {
      timeout: 60_000
    });
    // Step 0 is the input as given, the pointer not yet declared; step 1 sets it.
    expect(await drawn()).toEqual({ slots: 6, pointers: 0 });
    await step(1);
    // A step forward plays its before, then its after.
    await page.waitForTimeout(1500);
    expect(await drawn()).toEqual({ slots: 6, pointers: 1 });
    await step(2);
    await page.waitForTimeout(1500);
    expect(await drawn()).toEqual({ slots: 6, pointers: 0 });
    expect(errors).toEqual([]);
    await page.close();
  }
);

const cursors = taken
  .replace(
    '<Layout name="Main" of="left, right, take">',
    `<View of="Index" name="ICursor"><Node layout="column"><Node kind="IName">i</Node><Pointed /></Node></View>
<View of="Index" name="JCursor"><Node layout="column"><Node kind="JName">j</Node><Pointed /></Node></View>
<Layout name="Main" of="left, right, take, i, j">`
  )
  .replace(
    '<Main left={left} right={right} take={take} />',
    '<Main left={left} right={right} take={take} i={i} j={j} />'
  )
  .replace(
    '{take.from}',
    `{i}
    {j}
    {take.from}`
  );
/** The cursors' places, each drawn by its own pointer view (Taken draws every Index otherwise). */
const cursorViews = { 'pointers.Index@i': 'ICursor', 'pointers.Index@j': 'JCursor' };

it.skipIf(!enabled)(
  'leaves out a pointer whose view a variant hides, drawing the elements as without it',
  { timeout: 120_000 },
  async () => {
    const prepared = prepareSvelteComponent(pausingEveryLabel(cursors));
    const { javascript } = await bundlePresentation(prepared, 1, {
      chosen: { ...cursorViews, 'ICursor.shown': false, 'JCursor.shown': false }
    });
    const page = await browser!.newPage({ viewport: { width: 800, height: 500 } });
    await page.setContent(
      `<body style="margin:0"><iframe sandbox="allow-scripts" style="width:800px;height:500px;border:0" srcdoc="${sandboxDocument('', javascript, 0, 1).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe></body>`
    );
    const frame = page.frames()[1];
    await page.evaluate(() =>
      document
        .querySelector('iframe')
        ?.contentWindow?.postMessage({ type: 'sverlin:step', step: 0 }, '*')
    );
    await frame.waitForFunction(() => document.querySelector('.sv-layer:not(.pending)'), null, {
      timeout: 60_000
    });
    // Every value is drawn, and right keeps no end slot for j, which is not drawn.
    const rows = await frame.evaluate(() =>
      [
        ...document.querySelectorAll(
          '.sv-layer:not(.pending):not(.sv-leaving) [data-sv-kind="Row"] > .items'
        )
      ].map((items) => ({
        slots: items.children.length,
        values: (items as HTMLElement).innerText.match(/\d/gu)
      }))
    );
    expect(rows).toEqual([
      { slots: 3, values: ['1', '4', '6'] },
      { slots: 3, values: ['2', '3', '5'] }
    ]);
    await page.close();
  }
);

/** The cursors merge drawn with a variant, stepped to each step: its rows' boxes and the j label. */
async function cursorRows(chosen: Record<string, string>) {
  const prepared = prepareSvelteComponent(pausingEveryLabel(cursors));
  const { javascript } = await bundlePresentation(prepared, 1, {
    chosen: { ...cursorViews, ...chosen }
  });
  const page = await browser!.newPage({ viewport: { width: 800, height: 500 } });
  await page.setContent(
    `<body style="margin:0"><iframe sandbox="allow-scripts" style="width:800px;height:500px;border:0" srcdoc="${sandboxDocument('', javascript, 0, 1).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe></body>`
  );
  const frame = page.frames()[1];
  const steps = [];
  for (let index = 0; index < prepared.master.length; index++) {
    await page.evaluate((index) => {
      document
        .querySelector('iframe')
        ?.contentWindow?.postMessage({ type: 'sverlin:step', step: index }, '*');
    }, index);
    if (index === 0)
      await frame.waitForFunction(() => document.querySelector('.sv-layer:not(.pending)'), null, {
        timeout: 60_000
      });
    // A step forward plays its before, then its after.
    await page.waitForTimeout(1500);
    steps.push(
      await frame.evaluate(() => {
        const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)')!;
        const box = (node: Element) => {
          const { left, right } = node.getBoundingClientRect();
          return [Math.round(left), Math.round(right)];
        };
        const j = [...layer.querySelectorAll<HTMLElement>('[data-sv-kind="JCursor.JName"]')].find(
          (node) => getComputedStyle(node).visibility !== 'hidden'
        );
        return {
          rows: [...layer.querySelectorAll('[data-sv-kind="Row"] > .items')].map(box),
          j: j ? box(j) : undefined
        };
      })
    );
  }
  await page.close();
  return steps;
}

it.skipIf(!enabled)(
  'hangs the end slots of a collection whose overflow is excluded outside its box',
  { timeout: 120_000 },
  async () => {
    const steps = await cursorRows({ 'Row.overflow': 'excluded' });
    const [first] = steps;
    // Both rows are their cells alone, the same box at every step; j, one past the end of right
    // at the last step, is drawn beyond that box.
    expect(first.rows[0]).toEqual(first.rows[1]);
    for (const step of steps) expect(step.rows).toEqual(first.rows);
    expect(steps.at(-1)!.j![0]).toBeGreaterThan(first.rows[1][1]);
  }
);

it.skipIf(!enabled)(
  'leaves a pointer whose overflow is hidden undrawn past the ends, keeping no room there',
  { timeout: 120_000 },
  async () => {
    const steps = await cursorRows({ 'JCursor.Pointed.overflow': 'hidden' });
    // Step 0 is the input as given; the first step sets j.
    const [, first] = steps;
    expect(first.rows[0]).toEqual(first.rows[1]);
    expect(first.j).toBeDefined();
    expect(steps.at(-1)!.j).toBeUndefined();
  }
);

it.skipIf(!enabled)(
  'draws broken strokes on nodes and links, and keeps them in the scene',
  { timeout: 120_000 },
  async () => {
    const prepared = prepareSvelteComponent(
      pausingEveryLabel(
        `<script domain>const Int = type([1, 2]); const Values = array(Int, { max: 8 }); const Position = index(Values);</script><script input>const values = Values; const i = Position; const j = Position;</script><Case name="main" values={[1, 2]} i={0} j={1} /><script algorithm></script><View of="Int" name="IntCell"><Node value={this} /></View>\n<Layout name="Pair" of="values, i, j"><Node layout="free">{#each values as v}{v}{/each}<Link from={i} to={j} /></Node></Layout><Layout name="Main" of="values, i, j"><Node><Pair values={values} i={i} j={j} /></Node></Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} i={i} j={j} /></Scene>
</Storyboard>`
      )
    );
    const { javascript } = await bundlePresentation(prepared, 1, {
      chosen: {
        'Pair.stroke': 'neutral-500',
        'Pair.strokeWidth': 1.5,
        'Pair.strokeStyle': 'dashed',
        'Pair.Link.strokeStyle': 'dotted'
      }
    });
    const page = await browser!.newPage({ viewport: { width: 800, height: 500 } });
    await page.setContent(
      `<body style="margin:0"><iframe sandbox="allow-scripts" style="width:800px;height:500px;border:0" srcdoc="${sandboxDocument('', javascript, 0, 1).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe></body>`
    );
    const frame = page.frames()[1];
    const scene = await page.evaluate(
      () =>
        new Promise<{ steps: { nodes: { look: object }[]; links: object[] }[] }>((resolve) => {
          addEventListener('message', ({ data }) => {
            if (data?.type === 'sverlin:scene') resolve(data);
          });
          const target = document.querySelector('iframe')?.contentWindow;
          target?.postMessage({ type: 'sverlin:step', step: 0 }, '*');
          target?.postMessage({ type: 'sverlin:describe', request: 'strokes' }, '*');
        })
    );
    const drawn = await frame.evaluate(() => {
      const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)')!;
      const path = layer.querySelector('path.link')!;
      return {
        border: getComputedStyle(layer.querySelector('[data-sv-kind="Pair"]')!).borderTopStyle,
        dashes: path.getAttribute('stroke-dasharray'),
        cap: path.getAttribute('stroke-linecap')
      };
    });
    expect(drawn).toEqual({ border: 'dashed', dashes: '0 4', cap: 'round' });
    const [step] = scene.steps;
    expect(step.nodes.filter(({ look }) => 'strokeStyle' in look).length).toBeGreaterThan(0);
    expect(step.links).toEqual([expect.objectContaining({ strokeStyle: 'dotted' })]);
    await page.close();
  }
);

const compared = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
  const Flag = type('boolean');
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[5, 1, 4]} />
<script algorithm>
  for (@first[let i = Index(1)]; @more[i < values.length]; @next[i++]) @compare{
    if (@greater[values[i - 1] > values[i]]) @swap{
      const moved = values[i - 1];
      values[i - 1] = values[i];
      values[i] = moved;
    }
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="@compare.greater" name="Ask"><Node>{this.left} vs {this.right}</Node></View>
<Layout name="Board" of="values, @compare.greater">
  <Node layout="column"><Node>{#each values as v}{v}{/each}</Node>{@compare.greater}</Node>
</Layout>

<Layout name="Main" of="values, @compare.greater">
  <Node>
    <Board values={values} />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} /></Scene>
</Storyboard>`;

it.skipIf(!enabled)(
  'starts an operator’s operands, drawn by its view, at the cells they were read from',
  { timeout: 120_000 },
  async () => {
    // Pausing at the comparison alone, so its first run is the step after the first.
    const prepared = prepareSvelteComponent(pausingAt(compared, '@compare.greater'));
    const { javascript, labels } = await bundlePresentation(prepared, 1);
    // The first step drawing the comparison, by its name in the steps the page has.
    const at = labels.findIndex((name) => name.startsWith('@compare.greater#'));
    const first = prepared.master.find(({ name }) => name === labels[at])!;
    const operands = first.applied!['ℓcompareˑgreater'][0].identities!;
    const copies = first.identities!.copies;
    const page = await browser!.newPage({ viewport: { width: 900, height: 500 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(
      `<iframe sandbox="allow-scripts" style="width:900px;height:500px;border:0" srcdoc="${sandboxDocument(
        '',
        javascript,
        0,
        1
      )
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')}"></iframe>`
    );
    const [frame] = page.frames().slice(1);
    await frame.waitForFunction(() => document.querySelector('.sv-layer:not(.pending)'), null, {
      timeout: 60_000
    });
    const from = await placed(frame);
    await frame.evaluate(() =>
      document.querySelector('.sv-layer:not(.pending)')?.setAttribute('data-checked', '')
    );
    await page.evaluate(
      (at) =>
        document
          .querySelector('iframe')
          ?.contentWindow?.postMessage({ type: 'sverlin:step', step: at, selection: [] }, '*'),
      at
    );
    // Step 1, where its comparison is drawn: 5 and 1 lift out of their cells.
    await frame.waitForFunction(
      () => document.querySelector('.sv-layer:not(.pending):not(.sv-leaving):not([data-checked])'),
      null,
      { timeout: 20_000 }
    );
    const moving = Object.fromEntries(
      (await starts(frame)).map(({ identity, at }) => [identity, at])
    );
    for (const operand of [operands.left, operands.right]) {
      expect(copies[operand], `operand ${operand} is a copy`).toBeDefined();
      expect(moving[String(operand)], `operand ${operand} starts at its cell`).toEqual(
        from[String(copies[operand])]
      );
    }
    expect(errors).toEqual([]);
    await page.close();
  }
);

const scan = `<script domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = array(Int, { max: 6 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
  const target = Int;
</script><Case name="main" values={[7, 42, 3, 18, 25]} target={18} />
<script algorithm>
  @start[let i = Index(0);]
  while (@scan[values[i] !== target]) @next[i++;]
</script>
<View of="Int" name="Cell"><Node value={this} /></View>
<View of="Values" name="Row"><Node layout="row">{#each this as v}{v}{/each}</Node></View>
<View of="Index" name="Here"><Pointed /></View>
<Layout name="Main" of="values, i"><Node>{values}{i}</Node></Layout>

<Storyboard>
  <Scene name="main" case="main"><Main values={values} i={i} /></Scene>
</Storyboard>`;

/** A value's box on screen, and its fill as red, green and blue. */
type Cell = { left: number; right: number; fill: number[] };

/**
 * The scan drawn with the variant given at each step listed, or halfway through the move into it
 * from the step before where it is negative: each value's box, left to right, with its fill. Step 0
 * is the input as given, before the pointer is declared; step n has the pointer at value n - 1.
 */
async function scanCells(
  chosen: Record<string, string | number>,
  steps: readonly number[]
): Promise<Cell[][]> {
  const prepared = prepareSvelteComponent(pausingEveryLabel(scan));
  const { javascript } = await bundlePresentation(prepared, 1, { chosen });
  const page = await browser!.newPage({ viewport: { width: 900, height: 400 } });
  await page.setContent(sandboxDocument('', javascript, 0, 1));
  await page.waitForFunction(() =>
    document.querySelector('.sv-layer:not(.pending) [data-sv-kind]')
  );
  const go = (to: number) =>
    page.evaluate((to) => window.postMessage({ type: 'sverlin:step', step: to }, '*'), to);
  const drawn: Cell[][] = [];
  for (const step of steps) {
    const halfway = step < 0;
    await go(halfway ? -step - 1 : step);
    await page.waitForTimeout(1500);
    if (halfway) {
      await go(-step);
      await page.waitForFunction(() =>
        document
          .querySelector('.sv-layer:not(.pending):not(.sv-leaving)')
          ?.getAnimations({ subtree: true })
          .some((animation) => animation.playState === 'running')
      );
      await page.evaluate((at) => {
        for (const animation of document.getAnimations()) {
          animation.pause();
          animation.currentTime = at;
        }
      }, motionDuration / 2);
    }
    drawn.push(
      await page.evaluate(() => {
        const canvas = document.createElement('canvas').getContext('2d')!;
        const rgb = (colour: string) => {
          canvas.clearRect(0, 0, 1, 1);
          canvas.fillStyle = colour;
          canvas.fillRect(0, 0, 1, 1);
          return [...canvas.getImageData(0, 0, 1, 1).data.slice(0, 3)];
        };
        const layer = document.querySelector('.sv-layer:not(.pending):not(.sv-leaving)')!;
        return [...layer.querySelectorAll<HTMLElement>('[data-sv-kind]')]
          .filter((node) => node.querySelector('.value') && !node.querySelector('[data-sv-kind]'))
          .map((node) => {
            const box = node.getBoundingClientRect();
            return {
              left: box.left,
              right: box.right,
              fill: rgb(getComputedStyle(node).backgroundColor)
            };
          })
          .sort((a, b) => a.left - b.left);
      })
    );
    if (halfway) await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  }
  await page.close();
  return drawn;
}

const centre = (cell: Cell) => (cell.left + cell.right) / 2;
const gaps = (cells: Cell[]) => cells.slice(1).map((cell, index) => cell.left - cells[index].right);

it.skipIf(!enabled)(
  'expands a packed row about the pointed cell, its neighbours moving apart equally',
  { timeout: 180_000 },
  async () => {
    const [given, pointed, moving] = await scanCells(
      { 'Row.spacing': 'packed', 'Here.Pointed.expand': 8 },
      [0, 2, -3]
    );
    expect(pointed).toHaveLength(5);
    // At step 2 the pointer is at the second value: it grows about its own centre, as it was
    // unexpanded at step 0, and the values on either side move apart by as much.
    expect(pointed[1].right - pointed[1].left).toBeGreaterThan(given[1].right - given[1].left + 4);
    expect(centre(pointed[1])).toBeCloseTo(centre(given[1]), 0);
    const shifts = pointed.map((cell, index) => centre(cell) - centre(given[index]));
    expect(shifts[0]).toBeLessThan(-1);
    for (const shift of shifts.slice(2)) expect(shift).toBeGreaterThan(1);
    expect(-shifts[0]).toBeCloseTo(shifts[2], 0);
    // Halfway through the pointer moving on, no two values overlap and the gaps stay equal.
    expect(moving).toHaveLength(5);
    const between = gaps(moving);
    expect(Math.min(...between)).toBeGreaterThan(0);
    expect(Math.max(...between) - Math.min(...between)).toBeLessThan(1);
  }
);

it.skipIf(!enabled)(
  'fades a highlight from one value to the next as the pointer moves on',
  { timeout: 120_000 },
  async () => {
    const [before, halfway, after] = await scanCells({ 'Here.Pointed.expand': 4 }, [2, -3, 3]);
    // The third value takes the highlight at step 3: halfway there, its fill lies between.
    const [from, mid, to] = [before[2].fill, halfway[2].fill, after[2].fill];
    expect(from).not.toEqual(to);
    for (const [index, value] of mid.entries()) {
      expect(value).toBeGreaterThanOrEqual(Math.min(from[index], to[index]) - 1);
      expect(value).toBeLessThanOrEqual(Math.max(from[index], to[index]) + 1);
    }
    expect(mid.some((value, index) => value !== from[index] && value !== to[index])).toBe(true);
  }
);
