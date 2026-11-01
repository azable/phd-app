import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, expect, it } from 'vitest';

import type { ParticipantPrincipal } from '$lib/server/auth';
import { closeDatabase, database } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { PostgresExportDataSource } from '$lib/server/data-export';
import { mainStudy } from '$lib/studies/main';

import { ingestStudyInteractions } from './study-interactions';

const enabled = Boolean(process.env.DATABASE_URL) && process.env.SVERLIN_RUN_POSTGRES_TESTS === '1';
const userIds: string[] = [];
const projectIds: string[] = [];

afterAll(async () => {
  for (const projectId of projectIds) {
    await database().delete(schema.projects).where(eq(schema.projects.id, projectId));
  }
  for (const userId of userIds) {
    await database().delete(schema.user).where(eq(schema.user.id, userId));
  }
  await closeDatabase();
});

it.skipIf(!enabled)(
  'ingests project-associated records idempotently and cascades them with the project',
  async () => {
    const userId = `interaction-user-${randomUUID()}`;
    const otherUserId = `interaction-other-${randomUUID()}`;
    const projectId = `interaction-project-${randomUUID()}`;
    const now = new Date();
    userIds.push(userId, otherUserId);
    projectIds.push(projectId);
    await database()
      .insert(schema.user)
      .values(
        [userId, otherUserId].map((id) => ({
          id,
          name: id,
          email: `${id}@sverlin.invalid`,
          emailVerified: true,
          username: id,
          role: 'user'
        }))
      );
    await database().insert(schema.projects).values({
      id: projectId,
      ownerUserId: userId,
      head: 1,
      title: 'Interaction ingestion fixture',
      templateId: 'blank',
      mode: 'sverlin'
    });
    const [run] = await database()
      .insert(schema.studyRuns)
      .values({
        kind: 'participant',
        ownerUserId: userId,
        studyId: mainStudy.id,
        studyVersion: mainStudy.version,
        armId: 'sverlin-first',
        currentPhaseIndex: 1,
        startedAt: now
      })
      .returning({ id: schema.studyRuns.id });
    if (!run) throw new Error('Test study run was not created.');
    await database()
      .insert(schema.studyPhaseRuns)
      .values({
        runId: run.id,
        phaseId: 'task-one',
        sequenceIndex: 1,
        kind: 'task',
        projectId,
        status: 'active',
        startedAt: now,
        deadlineAt: new Date(now.getTime() + 60_000)
      });
    const principal = participantPrincipal(userId);
    const batch = interactionBatch(projectId, now);

    await expect(ingestStudyInteractions(principal, batch, now)).resolves.toMatchObject({
      acceptedThrough: 1,
      terminalAccepted: true,
      deliveryComplete: true
    });
    await expect(ingestStudyInteractions(principal, batch, now)).resolves.toMatchObject({
      acceptedThrough: 1
    });
    await expect(
      ingestStudyInteractions(
        principal,
        {
          ...batch,
          terminal: { ...batch.terminal, recordedThrough: 2 }
        },
        now
      )
    ).rejects.toMatchObject({ status: 409, code: 'terminal-conflict' });
    await expect(
      ingestStudyInteractions(
        principal,
        { ...batch, session: { ...batch.session, applicationVersion: 'conflicting-version' } },
        now
      )
    ).rejects.toMatchObject({ status: 409, code: 'invalid-session' });
    const terminalOnlyBatch = interactionBatch(projectId, new Date(now.getTime() + 10));
    const { terminal, ...openBatch } = terminalOnlyBatch;
    await expect(ingestStudyInteractions(principal, openBatch, now)).resolves.toMatchObject({
      terminalAccepted: false,
      deliveryComplete: false
    });
    await expect(
      ingestStudyInteractions(principal, { ...openBatch, terminal, events: [] }, now)
    ).resolves.toMatchObject({
      acceptedThrough: 1,
      terminalAccepted: true,
      deliveryComplete: true
    });
    await expect(
      ingestStudyInteractions(
        participantPrincipal(otherUserId),
        { ...batch, events: [{ ...batch.events[0]!, sequence: 2 }] },
        now
      )
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      ingestStudyInteractions(
        principal,
        { ...batch, events: [{ ...batch.events[0]!, sequence: 3 }] },
        now
      )
    ).rejects.toMatchObject({ status: 409 });
    // A participant's clock running seconds behind the server's still records the task from its start
    // (a pilot participant's ran 7 s behind); one minutes adrift is refused.
    await expect(
      ingestStudyInteractions(
        principal,
        interactionBatch(projectId, new Date(now.getTime() - 7_000)),
        now
      )
    ).resolves.toMatchObject({ acceptedThrough: 1 });
    await expect(
      ingestStudyInteractions(
        principal,
        interactionBatch(projectId, new Date(now.getTime() - 180_000)),
        now
      )
    ).rejects.toMatchObject({ status: 410, code: 'session-outside-phase' });
    const endedAt = new Date(now.getTime() + 2_000);
    await database()
      .update(schema.studyPhaseRuns)
      .set({ status: 'completed', endedAt, endReason: 'continued' })
      .where(eq(schema.studyPhaseRuns.runId, run.id));
    await database()
      .update(schema.studyRuns)
      .set({ currentPhaseIndex: 2 })
      .where(eq(schema.studyRuns.id, run.id));
    const lateBatch = interactionBatch(projectId, now);

    await expect(
      ingestStudyInteractions(principal, lateBatch, new Date(endedAt.getTime() + 1_000))
    ).resolves.toMatchObject({ acceptedThrough: 1 });

    const exported = await new PostgresExportDataSource().collectInteractions({
      type: 'participant',
      userId
    });

    expect(exported.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: batch.session.id,
          projectId,
          studyRunId: run.id,
          studyPhaseId: 'task-one',
          acceptedThrough: 1,
          recordedThrough: 1
        }),
        expect.objectContaining({ id: lateBatch.session.id, projectId })
      ])
    );
    expect(exported.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: batch.session.id, sequence: 1, projectHead: 1 }),
        expect.objectContaining({ sessionId: lateBatch.session.id, sequence: 1, projectHead: 1 })
      ])
    );
    expect(exported.expectedProjects).toEqual([
      expect.objectContaining({ projectId, studyRunId: run.id, studyPhaseId: 'task-one' })
    ]);

    await database().delete(schema.projects).where(eq(schema.projects.id, projectId));

    expect(
      await database()
        .select()
        .from(schema.projectInteractionSessions)
        .where(eq(schema.projectInteractionSessions.id, batch.session.id))
    ).toHaveLength(0);
  }
);

function interactionBatch(projectId: string, now: Date) {
  return {
    session: {
      id: randomUUID(),
      projectId,
      schemaVersion: 1 as const,
      clientStartedAt: now.toISOString(),
      timeOrigin: now.getTime(),
      initialViewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      applicationVersion: '0.0.1',
      capture: mainStudy.interactionCapture!
    },
    terminal: {
      clientStoppedAt: new Date(now.getTime() + 2).toISOString(),
      recordedThrough: 1
    },
    events: [
      {
        sequence: 1,
        elapsedMs: 1,
        clientOccurredAt: new Date(now.getTime() + 1).toISOString(),
        projectHead: 1,
        kind: 'document.lifecycle' as const,
        payload: { state: 'focused' as const }
      }
    ]
  };
}

function participantPrincipal(userId: string): ParticipantPrincipal {
  return {
    kind: 'participant',
    user: { id: userId } as ParticipantPrincipal['user'],
    session: {} as ParticipantPrincipal['session'],
    participant: { participantId: userId }
  };
}
