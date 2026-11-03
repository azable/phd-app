import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, expect, it } from 'vitest';

import type { NewProjectEvent } from '$lib/shared/projects/events';
import type { ProjectDocument } from '$lib/shared/projects/model';
import { closeDatabase, database } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';

import { PostgresProjectRepository } from './repository';

const postgresTestsEnabled =
  Boolean(process.env.DATABASE_URL) && process.env.SVERLIN_RUN_POSTGRES_TESTS === '1';

afterAll(closeDatabase);

it.skipIf(!postgresTestsEnabled)(
  'stores immutable events and rejects concurrent stale heads in PostgreSQL',
  async () => {
    const suffix = randomUUID();
    const ownerUserId = `resource-owner-${suffix}`;
    const projectId = `resource-project-${suffix}`;
    const operationId = randomUUID();
    const repository = new PostgresProjectRepository();

    await database()
      .insert(schema.user)
      .values({
        id: ownerUserId,
        name: 'Resource owner',
        email: `${ownerUserId}@sverlin.invalid`,
        emailVerified: true,
        role: 'user'
      });

    try {
      await repository.create(rootDocument(projectId, operationId), ownerUserId);
      await repository.append(projectId, 1, [renameEvent(operationId)]);

      const concurrent = await Promise.allSettled([
        repository.append(projectId, 2, [renameEvent(randomUUID(), 'Concurrent A')]),
        repository.append(projectId, 2, [renameEvent(randomUUID(), 'Concurrent B')])
      ]);
      expect(concurrent.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(concurrent.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      expect((await repository.load(projectId)).events).toHaveLength(3);
    } finally {
      await database().delete(schema.projects).where(eq(schema.projects.id, projectId));
      await database().delete(schema.user).where(eq(schema.user.id, ownerUserId));
    }
  },
  30_000
);

it.skipIf(!postgresTestsEnabled)(
  'stores text with half an emoji or a NUL, which jsonb refuses, made well-formed',
  async () => {
    const suffix = randomUUID();
    const ownerUserId = `resource-owner-${suffix}`;
    const projectId = `resource-project-${suffix}`;
    const operationId = randomUUID();
    const repository = new PostgresProjectRepository();
    await database()
      .insert(schema.user)
      .values({
        id: ownerUserId,
        name: 'Resource owner',
        email: `${ownerUserId}@sverlin.invalid`,
        emailVerified: true,
        role: 'user'
      });

    try {
      await repository.create(rootDocument(projectId, operationId), ownerUserId);
      // An element label cut after the first half of an emoji, as Frame.svelte once did.
      const title = `Legend ${'🍎'.slice(0, 1)}…\u0000`;
      await repository.append(projectId, 1, [renameEvent(randomUUID(), title)]);

      expect((await repository.load(projectId)).events[1]).toMatchObject({
        payload: { title: 'Legend \ufffd…' }
      });
    } finally {
      await database().delete(schema.projects).where(eq(schema.projects.id, projectId));
      await database().delete(schema.user).where(eq(schema.user.id, ownerUserId));
    }
  },
  30_000
);

function rootDocument(projectId: string, operationId: string): ProjectDocument {
  return {
    schemaVersion: 1,
    projectId,
    events: [
      {
        id: 1,
        type: 'project.created',
        actor: { kind: 'user' },
        operationId,
        createdAt: '2026-01-01T00:00:00.000Z',
        payload: {
          title: 'Repository test',
          entryArtifactId: 'main',
          assistantId: 'sverlin-assistant',
          creation: { templateId: 'blank' }
        }
      }
    ]
  };
}

function renameEvent(
  operationId: string,
  title = 'Stored in PostgreSQL'
): NewProjectEvent<'project.renamed'> {
  return {
    type: 'project.renamed',
    actor: { kind: 'user' },
    operationId,
    createdAt: '2026-01-01T00:00:01.000Z',
    payload: { previousTitle: 'Repository test', title }
  };
}

it.skipIf(!postgresTestsEnabled)(
  'keeps a project made in a removed mode stored but neither listed nor opened',
  async () => {
    const suffix = randomUUID();
    const ownerUserId = `resource-owner-${suffix}`;
    const projectId = `resource-project-${suffix}`;
    const repository = new PostgresProjectRepository();

    await database()
      .insert(schema.user)
      .values({
        id: ownerUserId,
        name: 'Resource owner',
        email: `${ownerUserId}@sverlin.invalid`,
        emailVerified: true,
        role: 'user'
      });

    try {
      await repository.create(rootDocument(projectId, randomUUID()), ownerUserId);
      await database()
        .update(schema.projects)
        .set({ mode: 'html-js' as never })
        .where(eq(schema.projects.id, projectId));

      expect(await repository.list(ownerUserId)).toEqual([]);
      await expect(repository.load(projectId)).rejects.toThrow(
        'was made in a visualization mode that has been removed (html-js)'
      );
    } finally {
      await database().delete(schema.projects).where(eq(schema.projects.id, projectId));
      await database().delete(schema.user).where(eq(schema.user.id, ownerUserId));
    }
  },
  30_000
);
