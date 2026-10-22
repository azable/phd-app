/**
 * The development demo project shown at /dev/demo: one project whose chat collects the examples an
 * agent drops into .demo/inbox, each saved as a version of its own, until a .demo/flush marker
 * replaces it with a fresh project. An example may begin with `<!-- summary: … -->`, saying what it
 * shows or changes, `<!-- parent: name -->`, naming the earlier example it changes (without a
 * parent it starts a tree of its own), and `<!-- variant: {"Here.shown": false} -->`, values to build
 * it with. Only the dev server serves it.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { eq } from 'drizzle-orm';

import { database } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { projectOperationExecutor } from '$lib/server/projects/operations';
import { projectRepository } from '$lib/server/projects/repository';
import { createProjectSkeleton } from '$lib/server/projects/service';
import type { DesignValues } from '$lib/shared/presentations';
import type { ProjectDocument } from '$lib/shared/projects/model';

const folder = path.resolve('.demo');
const inbox = path.join(folder, 'inbox');
const flushMarker = path.join(folder, 'flush');
const stateFile = path.join(folder, 'state.json');
// The source of each example saved to the demo project, by name, so a later one can name its parent.
const sourcesFile = path.join(folder, 'sources.json');

let syncing: Promise<string> | undefined;
let saving: Promise<void> | undefined;

/**
 * The demo project's id, flushing it first if asked. Waiting examples are saved in the background,
 * in order, so the page shows each candidate as it builds.
 */
export function syncDemo(ownerUserId: string): Promise<string> {
  syncing ??= sync(ownerUserId).finally(() => (syncing = undefined));
  return syncing;
}

async function sync(ownerUserId: string): Promise<string> {
  if (saving) return (await currentProject()) ?? '';
  await mkdir(inbox, { recursive: true });
  let projectId = await currentProject();
  if (projectId && (await exists(flushMarker))) {
    await database().delete(schema.projects).where(eq(schema.projects.id, projectId));
    await rm(sourcesFile, { force: true });
    projectId = undefined;
  }
  await rm(flushMarker, { force: true });
  if (!projectId) {
    const { document } = await createProjectSkeleton({
      creation: { templateId: 'blank', mode: 'sverlin' },
      title: 'Demo',
      ownerUserId
    });
    projectId = document.projectId;
    await writeFile(stateFile, JSON.stringify({ projectId }));
  }
  saving = saveWaiting(projectId)
    .catch((cause: unknown) => console.error('The demo examples could not be saved:', cause))
    .finally(() => (saving = undefined));
  return projectId;
}

/** Save each example waiting in the inbox as a candidate of its own, one after another. */
async function saveWaiting(projectId: string): Promise<void> {
  const examples = (await readdir(inbox)).filter((name) => name.endsWith('.svelte')).sort();
  for (const name of examples) {
    const file = path.join(inbox, name);
    const { source, summary, parent, variant } = withoutHeader(await readFile(file, 'utf8'));
    await rm(file);
    const document = await projectRepository.load(projectId);
    const operationId = randomUUID();
    const sources = await savedSources();
    const from = parent && sources[parent] ? presentationOf(document, sources[parent]) : undefined;
    await writeFile(
      sourcesFile,
      JSON.stringify({ ...sources, [name.replace(/\.svelte$/u, '')]: source })
    );
    await projectOperationExecutor.accept({
      projectId,
      operationId,
      expectedHead: document.events.length,
      command: {
        type: 'save',
        operationId,
        expectedHead: document.events.length,
        artifactId: 'main',
        source,
        presentationCount: 1,
        ...(summary ? { summary } : {}),
        ...(variant ? { variant: JSON.parse(variant) as DesignValues } : {}),
        ...(from ? { from } : { root: true })
      }
    });
    await finished(projectId, operationId, document.events.length);
  }
}

/** An example's source without its header lines, and what they say. */
function withoutHeader(text: string): {
  source: string;
  summary?: string;
  parent?: string;
  variant?: string;
} {
  const header: Record<string, string> = {};
  const source = text.replace(
    /^(?:\s*<!--\s*(summary|parent|variant):\s*(.*?)\s*-->\s*\n)+/u,
    (lines) => {
      for (const [, key, value] of lines.matchAll(
        /<!--\s*(summary|parent|variant):\s*(.*?)\s*-->/gu
      ))
        header[key] = value;
      return '';
    }
  );
  return { source, ...header };
}

async function savedSources(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(sourcesFile, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

/** The newest presentation built from a source, if any. */
function presentationOf(document: ProjectDocument, source: string): string | undefined {
  for (const event of document.events.toReversed())
    if (
      event.type === 'visualization.presented' &&
      event.payload.presentation.format === 'browser-bundle-v1' &&
      event.payload.presentation.source.text === source
    )
      return event.payload.presentation.presentationId;
  return undefined;
}

/** Wait until an operation records that it completed or failed, for at most five minutes. */
async function finished(projectId: string, operationId: string, after: number): Promise<void> {
  for (const deadline = Date.now() + 300_000; Date.now() < deadline; ) {
    const events = await projectRepository.eventsAfter(projectId, after);
    if (
      events.some(
        (event) =>
          event.operationId === operationId &&
          (event.type === 'operation.completed' || event.type === 'operation.failed')
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** The demo project recorded in .demo/state.json, if it still exists. */
async function currentProject(): Promise<string | undefined> {
  try {
    const { projectId } = JSON.parse(await readFile(stateFile, 'utf8')) as { projectId?: string };
    if (!projectId) return undefined;
    await projectRepository.load(projectId);
    return projectId;
  } catch {
    return undefined;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}
