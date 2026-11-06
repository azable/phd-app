/**
 * PDFs made on the server alone, from the scenes the layout model draws: a page per step, every
 * scene valid as the app checks a page's, its text in the embedded faces. Each is written to
 * test-results/server-pdf/ to be looked at.
 */

import { mkdirSync, writeFileSync } from 'node:fs';

import * as v from 'valibot';
import { expect, it } from 'vitest';

import { prepareSvelteComponent } from '../compile.server';
import { bundlePresentation } from '../testing/scenes';
import replay from '../fixtures/replay/replay.json';
import type { DesignValues } from '../library/node/design';
import { sceneMessageSchema } from '../scene';
import { serverPdf, serverScene } from './pdf.server';

const sources = import.meta.glob<string>(
  ['../fixtures/replay/*.sverlin', '../fixtures/dfa-loops.sverlin'],
  { query: '?raw', import: 'default', eager: true }
);
const variants = replay as Record<string, { variant: DesignValues }>;
const maths = `<script algorithm>
</script>
<Layout name="Main">
  <Node layout="column">
    <Node>Sorting takes $$O(n \\log n)$$ comparisons.</Node>
    <Node>There are $$\\frac{n(n+1)}{2}$$ pairs.</Node>
  </Node>
</Layout>
<Storyboard><Scene name="main"><Main /></Scene></Storyboard>`;

it.each(['dijkstra-demo', 'cards-drawings', 'merge-sort-overview', 'dfa-loops', 'maths'])(
  'makes %s as a PDF on the server alone',
  { timeout: 120_000 },
  async (name) => {
    const source =
      name === 'maths'
        ? maths
        : (sources[`../fixtures/replay/${name}.sverlin`] ?? sources[`../fixtures/${name}.sverlin`]);
    const built = await bundlePresentation(prepareSvelteComponent(source), 1, {
      ...(variants[name] ? { chosen: variants[name].variant } : {})
    });
    const scenes = built.layout.scenes;
    expect(scenes).toBeDefined();
    const checked = v.safeParse(sceneMessageSchema, {
      type: 'sverlin:scene',
      request: name,
      ...scenes
    });
    expect(checked.issues ?? []).toEqual([]);
    const scene = serverScene(scenes!, {
      presentationId: '00000000-server',
      seed: 1,
      labels: built.labels
    });
    const pdf = Buffer.from(await (await serverPdf(scene)).arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/gu)).toHaveLength(built.labels.length);
    mkdirSync('test-results/server-pdf', { recursive: true });
    writeFileSync(`test-results/server-pdf/${name}.pdf`, pdf);
  }
);
