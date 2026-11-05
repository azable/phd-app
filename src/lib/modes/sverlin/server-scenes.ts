/** A version's scenes, drawn on the server, fetched from the app for its page and exports. */

import type { SceneFrame, SceneStep } from './library';

export type ServedScenes = { frame: SceneFrame; steps: SceneStep[] };

/**
 * Some steps of a version (all, where none are named) from the project's scenes endpoint; throws
 * where the server has none, so the page describes its own.
 */
export async function fetchScenes(
  projectId: string,
  presentationId: string,
  steps?: readonly number[]
): Promise<ServedScenes> {
  const query = new URLSearchParams({ presentation: presentationId });
  if (steps) query.set('steps', steps.join(','));
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/scenes?${query.toString()}`
  );
  const body = (await response.json().catch(() => ({}))) as Partial<ServedScenes> & {
    error?: string;
  };
  if (!response.ok || !body.frame || !body.steps)
    throw new Error(body.error ?? `The server gave no scenes (${response.status}).`);
  return { frame: body.frame, steps: body.steps };
}
