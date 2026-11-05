/**
 * Scenes drawn on the server (see library/model/scene-of.ts) against those the page describes from
 * a real browser (see library/scene.ts), for the real projects replayed and the graph fixtures:
 * every node and link in both, boxes and link ends within two pixels, the same text and looks. What
 * the server cannot draw as the page does is accepted by kind (see `accepted`); each fixture's
 * differences are written to test-results/scene-server-parity/ as a table. Run with `pnpm run
 * test:browser`, which the devenv gives a browser (SVERLIN_TEST_BROWSER).
 */

import { mkdirSync, writeFileSync } from 'node:fs';

import { expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { embeddedFontsHead } from './fonts';
import replay from './fixtures/replay/replay.json';
import type { DesignValues } from './library/node/design';
import { browserTestsOn as enabled, describedScene } from './testing/browser';
import { pausingEveryLabel } from './testing/every-pause';
import { differenceTable, sceneDifferences, type SceneDifference } from './testing/scene-parity';

const replayed = import.meta.glob<string>('./fixtures/replay/*.sverlin', {
  query: '?raw',
  import: 'default',
  eager: true
});
const fixtures = import.meta.glob<string>('./fixtures/*.sverlin', {
  query: '?raw',
  import: 'default',
  eager: true
});
// The fixtures drawing graphs, whose links the server routes.
const graphs = /^(bfs-|dfa-|dijkstra|bst|heap-tree|ucs-compare)/u;
const mathsSource = `<script algorithm>
</script>
<Layout name="Main">
  <Node layout="column">
    <Node>Sorting takes $$O(n \\log n)$$ comparisons.</Node>
    <Node>There are $$\\frac{n(n+1)}{2}$$ pairs.</Node>
  </Node>
</Layout>
<Storyboard><Scene name="main"><Main /></Scene></Storyboard>`;

/**
 * Differences the server's scene is allowed, by kind: maths is drawn as its shapes where the page
 * gives its text, and text measured by the server's fonts, rather than the browser's shaping,
 * may break into runs and sit a little differently.
 */
const accepted = new Set(['maths as shapes', 'run count']);

const cases = [
  ...Object.entries(replay as Record<string, { variant: DesignValues }>).map(
    ([name, { variant }]) => ({
      name,
      source: replayed[`./fixtures/replay/${name}.sverlin`],
      request: { chosen: variant },
      paused: false
    })
  ),
  ...Object.entries(fixtures)
    .map(([path, source]) => ({ name: path.replace(/^.*\/(.*)\.sverlin$/u, '$1'), source }))
    .filter(({ name }) => graphs.test(name))
    .map(({ name, source }) => ({ name, source, request: {}, paused: true })),
  { name: 'inline-maths', source: mathsSource, request: {}, paused: false }
];

for (const { name, source, request, paused } of cases)
  it.skipIf(!enabled)(
    `draws ${name}'s scenes on the server as the page does`,
    { timeout: 600_000 },
    async () => {
      const built = await bundlePresentation(
        prepareSvelteComponent(paused ? pausingEveryLabel(source) : source),
        1,
        request
      );
      const server = built.layout.scenes;
      expect(server).toBeDefined();
      const page = await describedScene(built.javascript, { head: embeddedFontsHead });
      expect(server!.frame.width).toBe(page.frame.width);
      expect(Math.abs(server!.frame.height - page.frame.height)).toBeLessThanOrEqual(1);
      const differences = sceneDifferences(page.steps, server!.steps);
      mkdirSync('test-results/scene-server-parity', { recursive: true });
      writeFileSync(
        `test-results/scene-server-parity/${name}.json`,
        JSON.stringify(
          { table: differenceTable(differences), differences: differences.slice(0, 400) },
          null,
          1
        )
      );
      const unaccepted = differences.filter(({ kind }) => !accepted.has(kind));
      expect(differenceTable(unaccepted)).toEqual([] as SceneDifference[]);
    }
  );
