/**
 * A version's scenes, drawn on the server from its source, seed and variant (see
 * library/model/scene-of.ts), for the page to draw with SceneView and for exports, so neither lays
 * steps out in the browser to describe them.
 */

import type { BrowserBundlePresentation } from '$lib/shared/presentations';
import { buildLimit } from '../build-limit.server';
import { UnavailableScenesError } from '../server';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import type { ServerScenes } from './layout.server';

// Every step of each version recently asked for, by presentation, the newest kept: a version's
// steps are asked for a few at a time as the participant steps, so each is built once. A scene is
// a few kilobytes a step; 16 versions of 200 steps stay within some tens of megabytes.
const kept = new Map<string, Promise<ServerScenes>>();
const keptMost = 16;

/**
 * Some steps of a version (all, where none are named), with its frame. Rebuilding must give the
 * version's own page code, or the scenes could differ from what it was built as: a version an older
 * app built has none, and must be built again.
 */
export async function versionScenes(
  presentation: BrowserBundlePresentation,
  steps?: readonly number[]
): Promise<ServerScenes> {
  const { presentationId } = presentation;
  let scenes = kept.get(presentationId);
  if (scenes) kept.delete(presentationId);
  else {
    scenes = rebuilt(presentation);
    scenes.catch(() => kept.delete(presentationId));
  }
  kept.set(presentationId, scenes);
  if (kept.size > keptMost) kept.delete(kept.keys().next().value as string);
  const all = await scenes;
  return steps ? { frame: all.frame, steps: steps.map((step) => all.steps[step]) } : all;
}

async function rebuilt(presentation: BrowserBundlePresentation): Promise<ServerScenes> {
  const { source, seed, design, javascript, labels } = presentation;
  // A rebuild waits its turn with the builds, as it takes as long as one.
  const bundle = await buildLimit.run(() =>
    bundlePresentation(prepareSvelteComponent(source.text), seed, { base: design ?? {} })
  );
  if (bundle.javascript !== javascript.text)
    throw new UnavailableScenesError(
      'This version was built by an older version of the app, which draws it differently; rebuild it to show it.',
      true
    );
  const scenes = bundle.layout.scenes;
  if (!scenes || scenes.steps.length !== labels.length)
    throw new UnavailableScenesError('The server could not draw this version’s steps.');
  return scenes;
}
