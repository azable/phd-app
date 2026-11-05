/** A version's scenes, drawn on the server, and its exports made from them, fetched from the app. */

import type { RenderedFile } from '../render-targets';
import type { SceneFrame, SceneStep } from './library';

export type ServedScenes = { frame: SceneFrame; steps: SceneStep[] };

/** The server has no scenes for a version an older app built, which building it again draws. */
export class StaleScenesError extends Error {
  override name = 'StaleScenesError';
}

/**
 * Some steps of a version (all, where none are named) from the project's scenes endpoint; throws
 * where the server has none, so the page describes its own, a StaleScenesError for an old build.
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
    stale?: boolean;
  };
  if (!response.ok || !body.frame || !body.steps) {
    const message = body.error ?? `The server gave no scenes (${response.status}).`;
    throw body.stale ? new StaleScenesError(message) : new Error(message);
  }
  return { frame: body.frame, steps: body.steps };
}

/** A version exported as a render target, made on the server (see targets/export.server.ts). */
export async function fetchExport(
  projectId: string,
  presentationId: string,
  target: string
): Promise<RenderedFile> {
  const query = new URLSearchParams({ presentation: presentationId, target });
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/exports?${query.toString()}`
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `The server made no ${target} export (${response.status}).`);
  }
  const name = /filename="([^"]+)"/u.exec(response.headers.get('content-disposition') ?? '')?.[1];
  return { name: name ?? `${presentationId.slice(0, 8)}.${target}`, blob: await response.blob() };
}
