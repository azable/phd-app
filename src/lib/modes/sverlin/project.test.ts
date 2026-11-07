import { describe, expect, it } from 'vitest';

import { projectSnapshotAt } from '$lib/shared/projects/projection';
import { MemoryProjectRepository } from '$lib/server/projects/memory-repository.test-support';
import { alignPresentationFrames } from '$lib/shared/presentations';
import { appendProjectPreference } from '$lib/server/projects/presentations';
import { linearSearchSource } from './contract';
import {
  appendProjectEvents,
  createProjectSkeleton,
  buildProjectPresentations,
  draftEvent,
  updateProjectArtifact,
  type ProjectServiceDependencies
} from '$lib/server/projects/service';
import type { ProjectEvent } from '$lib/shared/projects/events';
import type { BrowserBundlePresentation } from '$lib/shared/presentations';
import { versionScenes } from './scenes.server';

const presented = (events: readonly ProjectEvent[]): BrowserBundlePresentation[] =>
  events.flatMap((event) =>
    event.type === 'visualization.presented' &&
    event.payload.presentation.format === 'browser-bundle-v1'
      ? [event.payload.presentation]
      : []
  );

describe('Svelte-backed project lifecycle', () => {
  it('records a bundled presentation and step labels from one edited component', async () => {
    const repository = new MemoryProjectRepository();
    const dependencies: ProjectServiceDependencies = { repository };
    const { document: created } = await createProjectSkeleton({}, dependencies);
    const artifact = projectSnapshotAt(created).artifacts.main;
    expect(artifact.path).toBe('Main.svelte');
    const source =
      '<script domain>const Int = type("integer", { min: 0, max: 9 });</script><script algorithm>@start[let n = Int(0);] @set[n = Int(1);] @set[n = Int(2);]</script><View of="Int" name="IntCell"><Node value={this} /></View>\n<Layout name="Shown"><Node>n</Node></Layout><Layout name="Main"><Node><Shown />{n}</Node></Layout>\n<Case name="main" />\n<Storyboard>\n  <Scene name="main" case="main" pause="@start.end, @set.end"><Main /></Scene>\n</Storyboard>';
    const result = await updateProjectArtifact(
      {
        projectId: created.projectId,
        expectedHead: created.events.length,
        artifactId: artifact.artifactId,
        source,
        presentationCount: 2,
        operationId: crypto.randomUUID()
      },
      dependencies
    );
    const presentations = result.appendedEvents.flatMap((event) =>
      event.type === 'visualization.presented' ? [event.payload.presentation] : []
    );
    expect(presentations).toHaveLength(2);
    expect(presentations.every((presentation) => presentation.format === 'browser-bundle-v1')).toBe(
      true
    );
    expect(presentations[0]).toMatchObject({
      mode: 'sverlin',
      labels: ['@case.start', '@start#1.end', '@set#1.end', '@set#2.end']
    });

    const rebuilt = await buildProjectPresentations(
      {
        projectId: created.projectId,
        expectedHead: result.document.events.length,
        seed: 42,
        purpose: 'seed-change',
        operationId: crypto.randomUUID()
      },
      dependencies
    );
    expect(rebuilt.appendedEvents.some((event) => event.type === 'visualization.presented')).toBe(
      true
    );
  });

  it("builds a developer's edit of the choices: changes chosen, removals back to their level", async () => {
    const repository = new MemoryProjectRepository();
    const dependencies: ProjectServiceDependencies = { repository };
    const { document: created } = await createProjectSkeleton({}, dependencies);
    const artifact = projectSnapshotAt(created).artifacts.main;
    const save = async (
      document: typeof created,
      edit: { from?: string; variant?: Record<string, string | number>; unset?: string[] }
    ) => {
      const result = await updateProjectArtifact(
        {
          projectId: created.projectId,
          expectedHead: document.events.length,
          artifactId: artifact.artifactId,
          source: linearSearchSource,
          presentationCount: 1,
          operationId: crypto.randomUUID(),
          ...edit
        },
        dependencies
      );
      const [presentation] = result.appendedEvents.flatMap((event) =>
        event.type === 'visualization.presented' ? [event.payload.presentation] : []
      );
      if (presentation?.format !== 'browser-bundle-v1') throw new Error('Nothing was built.');
      return { document: result.document, presentation };
    };
    const first = await save(created, { variant: { 'IntCell.fill': 'sky-100' } });
    expect(first.presentation.variant?.['IntCell.fill']).toBe('sky-100');
    const padding = first.presentation.variant?.['IntCell.padding'];
    expect(padding).toBe(first.presentation.variant?.$spacing);

    // Only the token changes, and the kind set apart is removed from the choices.
    const second = await save(first.document, {
      from: first.presentation.presentationId,
      variant: { $spacing: 0.125 },
      unset: ['IntCell.fill']
    });
    expect(second.presentation.variant?.$spacing).toBe(0.125);
    // The kind that followed the token still does, and the one removed is the starter's again.
    expect(second.presentation.variant?.['IntCell.padding']).toBe(0.125);
    expect(second.presentation.origins?.['IntCell.fill']).toBe('starter');
  });

  it('builds a version an older app built again, as it was, so its scenes draw', async () => {
    const repository = new MemoryProjectRepository();
    const dependencies: ProjectServiceDependencies = { repository };
    const { document: created } = await createProjectSkeleton({}, dependencies);
    const saved = await updateProjectArtifact(
      {
        projectId: created.projectId,
        expectedHead: created.events.length,
        artifactId: 'main',
        source: linearSearchSource,
        presentationCount: 1,
        operationId: crypto.randomUUID(),
        variant: { 'IntCell.fill': 'sky-100' }
      },
      dependencies
    );
    const [built] = presented(saved.appendedEvents);
    // As an older app built it: the page code it stored is not what the app builds today.
    const old = (source: string) => ({
      ...built,
      presentationId: crypto.randomUUID(),
      source: { ...built.source, text: source },
      javascript: { ...built.javascript, text: '' }
    });
    const stale = old(linearSearchSource);
    const broken = old('<script domain>const Int = type(');
    let document = await appendProjectEvents(
      saved.document,
      [stale, broken].map((presentation, slot) =>
        draftEvent({
          type: 'visualization.presented',
          actor: { kind: 'system' },
          operationId: crypto.randomUUID(),
          payload: { displaySetId: crypto.randomUUID(), slot: slot as 0 | 1, presentation }
        })
      ),
      dependencies
    );
    await expect(versionScenes(stale)).rejects.toMatchObject({ stale: true });

    const rebuild = (presentation: typeof stale, seed = presentation.seed) =>
      buildProjectPresentations(
        {
          projectId: created.projectId,
          expectedHead: document.events.length,
          seed,
          purpose: 'rebuild',
          from: presentation.presentationId,
          asBuilt: true,
          operationId: crypto.randomUUID()
        },
        dependencies
      );
    await expect(rebuild(stale, stale.seed + 1)).rejects.toThrow(/the seed it was built with/);
    const again = await rebuild(stale);
    const [rebuilt] = presented(again.appendedEvents);
    // A new presentation of the same version: its source, seed and values, none drawn anew.
    expect(rebuilt.presentationId).not.toBe(stale.presentationId);
    expect(rebuilt.source.sha256).toBe(stale.source.sha256);
    expect(rebuilt.seed).toBe(stale.seed);
    expect(rebuilt.variant).toEqual(stale.variant);
    expect(again.appendedEvents).toContainEqual(
      expect.objectContaining({
        type: 'build.requested',
        payload: expect.objectContaining({ purpose: 'rebuild' })
      })
    );
    const scenes = await versionScenes(rebuilt);
    expect(scenes.steps).toHaveLength(rebuilt.labels.length);

    // A source that no longer builds records the build's problems and presents nothing.
    document = again.document;
    const failed = await rebuild(broken);
    expect(presented(failed.appendedEvents)).toHaveLength(0);
    const failure = failed.appendedEvents.find((event) => event.type === 'build.failed');
    expect(failure?.type === 'build.failed' && failure.payload.diagnostics.length).toBeTruthy();
  });

  it('records two seeded designs of one master trace as an aligned display set', async () => {
    const repository = new MemoryProjectRepository();
    const dependencies: ProjectServiceDependencies = { repository };
    const { document: created } = await createProjectSkeleton({}, dependencies);
    const artifact = projectSnapshotAt(created).artifacts.main;
    const result = await updateProjectArtifact(
      {
        projectId: created.projectId,
        expectedHead: created.events.length,
        artifactId: artifact.artifactId,
        source: linearSearchSource,
        presentationCount: 2,
        operationId: crypto.randomUUID()
      },
      dependencies
    );
    const presentations = result.appendedEvents.flatMap((event) =>
      event.type === 'visualization.presented' ? [event.payload.presentation] : []
    );
    const [left, right] = presentations;
    expect(left.format === 'browser-bundle-v1' && right.format === 'browser-bundle-v1').toBe(true);
    if (left.format !== 'browser-bundle-v1' || right.format !== 'browser-bundle-v1') return;
    expect(left.stepSignature).toBe(right.stepSignature);
    expect(left.labels).toEqual(right.labels);
    expect(left.steps).toEqual(right.steps);
    expect(left.steps).toEqual(left.labels);
    // The first is the starter; the second is randomised from it.
    expect(left.variant?.['views.Int']).toBe('IntCell');
    expect(left.origins?.['IntCell.fill']).toBe('starter');
    expect(right.variant).not.toEqual(left.variant);
    expect(right.views).toEqual({
      ℓcheckˑequal: ['Ask'],
      Int: ['IntCell', 'IntTally'],
      Index: ['Highlight'],
      Values: ['Row']
    });
    const frames = alignPresentationFrames([left, right]);
    expect(frames).toHaveLength(11);
    const document = await appendProjectPreference(
      result.document,
      {
        presentations: [left.presentationId, right.presentationId],
        answer: { preferred: left.presentationId },
        step: frames.length - 2,
        operationId: crypto.randomUUID()
      },
      dependencies
    );
    expect(document.events.at(-1)?.type).toBe('visualization.preference-recorded');
  });
});
