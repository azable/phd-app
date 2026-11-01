import { createHash, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, expect, it } from 'vitest';

import type { ProjectDocument } from '$lib/shared/projects/model';
import { mainStudy } from '$lib/studies/main';
import { closeDatabase, database } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { PostgresProjectRepository } from '$lib/server/projects/repository';

import { setParticipantGiftCardUrl } from './participants';
import {
  adminStudyPreviewState,
  continueParticipantStudy,
  createStudyPreview,
  enrollParticipant,
  forceStudyPreview,
  participantCompletionGiftCardUrl,
  studyTaskProjectId
} from './study';

const enabled = Boolean(process.env.DATABASE_URL) && process.env.SVERLIN_RUN_POSTGRES_TESTS === '1';
const users: string[] = [];
const projects: string[] = [];

afterAll(async () => {
  for (const projectId of projects) {
    await database().delete(schema.projects).where(eq(schema.projects.id, projectId));
  }
  for (const userId of users) {
    await database().delete(schema.user).where(eq(schema.user.id, userId));
  }
  await closeDatabase();
});

it.skipIf(!enabled)('makes concurrent enrollment idempotent for one participant', async () => {
  const userId = `enrollment-user-${randomUUID()}`;
  users.push(userId);
  await database()
    .insert(schema.user)
    .values({
      id: userId,
      name: userId,
      email: `${userId}@sverlin.invalid`,
      emailVerified: true,
      username: userId,
      role: 'user'
    });

  const ref = { id: mainStudy.id, version: mainStudy.version };
  const runIds = await Promise.all([
    enrollParticipant(userId, ref),
    enrollParticipant(userId, ref)
  ]);
  const enrollments = await database()
    .select()
    .from(schema.studyEnrollments)
    .where(eq(schema.studyEnrollments.userId, userId));

  expect(new Set(runIds).size).toBe(1);
  expect(enrollments).toHaveLength(1);
});

it.skipIf(!enabled)(
  'serializes repeated progression and reuses the deterministic ready task project',
  async () => {
    const userId = `study-user-${randomUUID()}`;
    users.push(userId);
    await database()
      .insert(schema.user)
      .values({
        id: userId,
        name: userId,
        email: `${userId}@sverlin.invalid`,
        emailVerified: true,
        username: userId,
        role: 'user'
      });
    const [run] = await database()
      .insert(schema.studyRuns)
      .values({
        kind: 'participant',
        ownerUserId: userId,
        studyId: mainStudy.id,
        studyVersion: mainStudy.version,
        armId: 'sverlin-first'
      })
      .returning({ id: schema.studyRuns.id });
    if (!run) throw new Error('Test study run was not created.');
    await database().insert(schema.studyEnrollments).values({ userId, runId: run.id });
    const projectId = studyTaskProjectId(run.id, 'task-one');
    projects.push(projectId);
    await new PostgresProjectRepository().create(readyComparison(projectId), userId);

    const [first, retry] = await Promise.all([
      continueParticipantStudy(userId),
      continueParticipantStudy(userId)
    ]);
    const runs = await database()
      .select()
      .from(schema.studyPhaseRuns)
      .where(eq(schema.studyPhaseRuns.runId, run.id));
    const [storedRun] = await database()
      .select()
      .from(schema.studyRuns)
      .where(eq(schema.studyRuns.id, run.id));

    expect(first.projectId).toBe(projectId);
    expect(retry.projectId).toBe(projectId);
    expect(first.deadlineAt).toBe(retry.deadlineAt);
    expect(storedRun?.currentPhaseIndex).toBe(1);
    expect(runs.filter(({ phaseId }) => phaseId === 'task-one')).toHaveLength(1);
    expect(runs).toHaveLength(2);
    await expect(continueParticipantStudy(userId, { early: true })).rejects.toThrow('read-only');
  },
  30_000
);

it.skipIf(!enabled)(
  'persists full and isolated previews while allowing forced advancement',
  async () => {
    const adminId = `preview-admin-${randomUUID()}`;
    users.push(adminId);
    await database()
      .insert(schema.user)
      .values({
        id: adminId,
        name: adminId,
        email: `${adminId}@sverlin.invalid`,
        emailVerified: true,
        role: 'admin'
      });

    const initial = await createStudyPreview({
      ownerUserId: adminId,
      ref: { id: mainStudy.id, version: mainStudy.version },
      armId: 'sverlin-first'
    });
    expect(initial).toMatchObject({ kind: 'preview', phase: { id: 'welcome' }, completed: false });
    const taskProjectId = studyTaskProjectId(initial.runId, 'task-one');
    projects.push(taskProjectId);
    await new PostgresProjectRepository().create(readyComparison(taskProjectId), adminId);

    const task = await forceStudyPreview(initial.runId, adminId);
    expect(task).toMatchObject({ phase: { id: 'task-one' }, projectId: taskProjectId });
    const between = await forceStudyPreview(initial.runId, adminId);
    expect(between).toMatchObject({ phase: { id: 'between-tasks' }, completed: false });
    expect(await adminStudyPreviewState(initial.runId, adminId)).toMatchObject({
      phase: { id: 'between-tasks' }
    });

    const isolated = await createStudyPreview({
      ownerUserId: adminId,
      ref: { id: mainStudy.id, version: mainStudy.version },
      armId: 'html-first',
      phaseId: 'between-tasks'
    });
    const completed = await forceStudyPreview(isolated.runId, adminId);
    expect(completed.completed).toBe(true);
    expect(completed.flow.phases.map(({ status }) => status)).toEqual([
      'out-of-scope',
      'out-of-scope',
      'completed',
      'out-of-scope',
      'out-of-scope'
    ]);
  }
);

it.skipIf(!enabled)(
  'advances only from the phase continued from, so a repeated request skips none',
  async () => {
    const userId = `study-user-${randomUUID()}`;
    users.push(userId);
    await database()
      .insert(schema.user)
      .values({
        id: userId,
        name: userId,
        email: `${userId}@sverlin.invalid`,
        emailVerified: true,
        username: userId,
        role: 'user'
      });
    const [run] = await database()
      .insert(schema.studyRuns)
      .values({
        kind: 'participant',
        ownerUserId: userId,
        studyId: mainStudy.id,
        studyVersion: mainStudy.version,
        armId: 'sverlin-first'
      })
      .returning({ id: schema.studyRuns.id });
    if (!run) throw new Error('Test study run was not created.');
    await database().insert(schema.studyEnrollments).values({ userId, runId: run.id });

    const stale = await continueParticipantStudy(userId, { phaseId: 'between-tasks' });
    const early = await continueParticipantStudy(userId, { early: true });

    expect(stale.phase.id).toBe('welcome');
    expect(early.phase.id).toBe('welcome');
  },
  30_000
);

it.skipIf(!enabled)('reveals a configured gift card only at completion', async () => {
  const userId = `gift-user-${randomUUID()}`;
  users.push(userId);
  await database()
    .insert(schema.user)
    .values({
      id: userId,
      name: userId,
      email: `${userId}@sverlin.invalid`,
      emailVerified: true,
      username: userId,
      role: 'user'
    });
  const [run] = await database()
    .insert(schema.studyRuns)
    .values({
      kind: 'participant',
      ownerUserId: userId,
      studyId: mainStudy.id,
      studyVersion: mainStudy.version,
      armId: 'sverlin-first'
    })
    .returning({ id: schema.studyRuns.id });
  if (!run) throw new Error('Test study run was not created.');
  await database().insert(schema.studyEnrollments).values({ userId, runId: run.id });

  await setParticipantGiftCardUrl(userId, 'https://gift.example/card/static');
  expect(await participantCompletionGiftCardUrl(userId)).toBeUndefined();

  await database()
    .update(schema.studyRuns)
    .set({
      currentPhaseIndex: mainStudy.flow.length - 1,
      completedAt: new Date()
    })
    .where(eq(schema.studyRuns.id, run.id));
  expect(await participantCompletionGiftCardUrl(userId)).toBe('https://gift.example/card/static');

  await setParticipantGiftCardUrl(userId, '');
  expect(await participantCompletionGiftCardUrl(userId)).toBeUndefined();
});

function readyComparison(projectId: string): ProjectDocument {
  const operationId = randomUUID();
  const source = recorded('<p>Prepared study visualization</p>', 'text/x-svelte');
  const render = recorded(JSON.stringify({ steps: [{ label: 'Only step' }] }), 'application/json');
  const displaySetId = randomUUID();
  return {
    schemaVersion: 1,
    projectId,
    events: [
      {
        id: 1,
        type: 'project.created',
        actor: { kind: 'user' },
        operationId,
        createdAt: '2026-08-30T00:00:00.000Z',
        payload: {
          title: 'Prepared study project',
          entryArtifactId: 'main',
          assistantId: 'sverlin-assistant',
          creation: { templateId: 'blank', mode: 'sverlin' }
        }
      },
      {
        id: 2,
        type: 'artifact.version-created',
        actor: { kind: 'system' },
        operationId,
        createdAt: '2026-08-30T00:00:01.000Z',
        payload: {
          origin: { kind: 'initial' },
          changes: [
            {
              operation: 'upsert',
              artifact: {
                artifactId: 'main',
                path: 'Main.svelte',
                language: 'svelte',
                content: source
              }
            }
          ]
        }
      },
      ...([0, 1] as const).map((slot) => ({
        id: slot + 3,
        type: 'visualization.presented' as const,
        actor: { kind: 'system' as const },
        operationId,
        createdAt: `2026-08-30T00:00:0${slot + 2}.000Z`,
        payload: {
          displaySetId,
          slot,
          presentation: {
            presentationId: randomUUID(),
            format: 'browser-bundle-v1' as const,
            mode: 'sverlin' as const,
            stepSignature: 'shared-step-signature',
            labels: ['Overview'],
            seed: slot + 1,
            source,
            html: recorded('', 'text/html'),
            javascript: render
          }
        }
      }))
    ]
  };
}

function recorded(text: string, mediaType: string) {
  return {
    text,
    mediaType,
    sha256: createHash('sha256').update(text).digest('hex')
  };
}
