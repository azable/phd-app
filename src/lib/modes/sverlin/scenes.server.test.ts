/**
 * A version's scenes rebuilt from its source, seed and variant (see scenes.server.ts): the scenes
 * its build drew, of the steps asked for, and none for a version whose page code a rebuild does not
 * give.
 */

import { expect, it } from 'vitest';

import type { BrowserBundlePresentation } from '$lib/shared/presentations';
import { UnavailableScenesError } from '../server';
import { buildBatch } from './build.server';
import { prepareSvelteComponent } from './compile.server';
import { bundlePresentation } from './testing/scenes';
import bars from './fixtures/bars.sverlin?raw';
import { versionScenes } from './scenes.server';

const text = (value: string) => ({ text: value, sha256: '0'.repeat(64), mediaType: 'text/plain' });

it('gives a version the scenes its build drew, of the steps asked for', async () => {
  const [result] = await buildBatch(bars, [{ seed: 3, variant: { randomise: true } }]);
  if (!result.ok) throw new Error(result.error);
  const presentation = {
    presentationId: crypto.randomUUID(),
    format: 'browser-bundle-v1',
    mode: 'sverlin',
    stepSignature: result.bundle.stepSignature!,
    labels: result.bundle.labels,
    seed: 3,
    source: text(bars),
    html: text(''),
    javascript: text(result.bundle.javascript),
    variant: result.bundle.variant
  } satisfies BrowserBundlePresentation;
  const built = await bundlePresentation(prepareSvelteComponent(bars), 3, {
    base: result.bundle.variant
  });
  const all = await versionScenes(presentation);
  expect(all).toEqual(built.layout.scenes);
  expect(all.steps).toHaveLength(presentation.labels.length);
  const some = await versionScenes(presentation, [1, 0]);
  expect(some).toEqual({ frame: all.frame, steps: [all.steps[1], all.steps[0]] });

  const earlier = { ...presentation, presentationId: crypto.randomUUID(), javascript: text('') };
  await expect(versionScenes(earlier)).rejects.toThrow(UnavailableScenesError);
  await expect(versionScenes(earlier)).rejects.toMatchObject({ stale: true });
});
