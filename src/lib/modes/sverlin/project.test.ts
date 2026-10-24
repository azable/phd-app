import { describe, expect, it } from 'vitest';

import { projectSnapshotAt } from '$lib/shared/projects/projection';
import { MemoryProjectRepository } from '$lib/server/projects/memory-repository.test-support';
import { alignPresentationFrames } from '$lib/shared/presentations';
import { appendProjectPreference } from '$lib/server/projects/presentations';
import { linearSearchSource } from './contract';
import {
  createProjectSkeleton,
  buildProjectPresentations,
  updateProjectArtifact,
  type ProjectServiceDependencies
} from '$lib/server/projects/service';

describe('Svelte-backed project lifecycle', () => {
  it('records a bundled presentation and step labels from one edited component', async () => {
    const repository = new MemoryProjectRepository();
    const dependencies: ProjectServiceDependencies = { repository };
    const { document: created } = await createProjectSkeleton({}, dependencies);
    const artifact = projectSnapshotAt(created).artifacts.main;
    expect(artifact.path).toBe('Main.svelte');
    const source =
      '<script lang="sverlin" domain>const Int = type("integer", { min: 0, max: 9 });</script><script lang="sverlin">@start[let n = Int(0);] @set[n = Int(1);] @set[n = Int(2);]</script><Node>{step}</Node>';
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
      labels: ['Step 1', 'Step 2', 'Step 3', 'Step 4']
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
    expect(left.masterSteps).toEqual(right.masterSteps);
    expect(left.masterSteps).toHaveLength(7);
    // The first is the starter; the second is randomised from it.
    expect(left.variant?.['views.Int']).toBe('IntCell');
    expect(left.origins?.['IntCell.fill']).toBe('starter');
    expect(right.variant).not.toEqual(left.variant);
    expect(right.views).toEqual({ Int: ['IntCell', 'IntTally'], Index: ['IndexText'] });
    const frames = alignPresentationFrames([left, right]);
    expect(frames).toHaveLength(7);
    const document = await appendProjectPreference(
      result.document,
      {
        presentations: [left.presentationId, right.presentationId],
        preferred: left.presentationId,
        step: frames.length - 2,
        operationId: crypto.randomUUID()
      },
      dependencies
    );
    expect(document.events.at(-1)?.type).toBe('visualization.preference-recorded');
  });
});
