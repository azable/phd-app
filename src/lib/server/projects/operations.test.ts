import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ProjectDocument } from '$lib/shared/projects/model';
import { pendingAssistantTurnRequests, projectOperation } from '$lib/shared/projects/operations';

import { MemoryProjectRepository } from './memory-repository.test-support';
import { currentProjectOperationDeadline } from './operation-context';
import { ProjectOperationExecutor } from './operations';

describe('ProjectOperationExecutor', () => {
  it('records accepted and completed boundaries around an injected command', async () => {
    const repository = new MemoryProjectRepository();
    const projectId = randomUUID();
    const operationId = randomUUID();
    await repository.create(rootDocument(projectId, randomUUID()), 'owner');
    const executor = new ProjectOperationExecutor(
      repository,
      { acquire: async () => ({ release: async () => undefined }) },
      async ({ projectId: id, expectedHead, operationId: correlation }) => {
        const appended = await repository.append(id, expectedHead, [
          {
            type: 'project.renamed',
            actor: { kind: 'user' },
            operationId: correlation,
            createdAt: new Date().toISOString(),
            payload: { previousTitle: 'Initial', title: 'Renamed' }
          }
        ]);
        return { document: appended.document, appendedEvents: appended.events };
      }
    );

    const accepted = await executor.accept({
      projectId,
      operationId,
      expectedHead: 1,
      command: { type: 'initial-build', seed: 1 }
    });
    expect(accepted.acceptedEventId).toBe(2);
    await terminal(repository, projectId, operationId);

    const operation = projectOperation(await repository.load(projectId), operationId);
    expect(operation).toMatchObject({ kind: 'initial-build', status: 'completed' });
  });

  it('accepts a command on a head that only a load report has moved since', async () => {
    const repository = new MemoryProjectRepository();
    const projectId = randomUUID();
    await repository.create(rootDocument(projectId, randomUUID()), 'owner');
    const executor = new ProjectOperationExecutor(
      repository,
      { acquire: async () => ({ release: async () => undefined }) },
      async ({ projectId: id }) => ({ document: await repository.load(id), appendedEvents: [] })
    );
    const append = (event: Parameters<MemoryProjectRepository['append']>[2][number]) =>
      repository
        .load(projectId)
        .then((document) => repository.append(projectId, document.events.length, [event]));
    const envelope = {
      actor: { kind: 'system' },
      operationId: randomUUID(),
      createdAt: new Date().toISOString()
    } as const;
    await append({
      ...envelope,
      type: 'visualization.loaded',
      payload: {
        presentationId: randomUUID(),
        outcome: 'ready',
        sinceLoadMs: 84,
        measuringMs: 0,
        recordingMs: 3,
        showingMs: 20,
        passes: 1,
        mostChanges: 0,
        visibility: 'visible'
      }
    });

    const operationId = randomUUID();
    const accepted = await executor.accept({
      projectId,
      operationId,
      expectedHead: 1,
      command: { type: 'initial-build', seed: 1 }
    });
    expect(accepted.acceptedEventId).toBe(3);
    await terminal(repository, projectId, operationId);

    // Any other event since is still a conflict.
    await append({
      ...envelope,
      type: 'project.renamed',
      payload: { previousTitle: 'Initial', title: 'Elsewhere' }
    });
    const head = (await repository.load(projectId)).events.length;
    await expect(
      executor.accept({
        projectId,
        operationId: randomUUID(),
        expectedHead: head - 1,
        command: { type: 'initial-build', seed: 1 }
      })
    ).rejects.toMatchObject({ name: 'ProjectConflictError' });
  });

  it('does not rebase an assistant acceptance past a concurrent foreground acceptance', async () => {
    const projectId = randomUUID();
    const foregroundId = randomUUID();
    const assistantId = randomUUID();
    let loads = 0;
    const repository = new (class extends MemoryProjectRepository {
      override async load(id: string) {
        const document = await super.load(id);
        loads += 1;
        if (loads === 2) {
          await super.append(id, document.events.length, [
            {
              type: 'operation.accepted',
              actor: { kind: 'user' },
              operationId: foregroundId,
              createdAt: new Date().toISOString(),
              payload: { kind: 'initial-build' }
            }
          ]);
        }
        return document;
      }
    })();
    await repository.create(rootDocument(projectId, randomUUID()), 'owner');
    const executor = new ProjectOperationExecutor(
      repository,
      { acquire: async () => ({ release: async () => undefined }) },
      async () => {
        throw new Error('The assistant command should not start.');
      }
    );

    await expect(
      executor.accept({
        projectId,
        operationId: assistantId,
        expectedHead: 1,
        command: { type: 'assistant-turn', requestEventIds: [1] },
        actor: 'system'
      })
    ).rejects.toMatchObject({ name: 'ProjectConflictError' });

    const document = await repository.load(projectId);
    expect(projectOperation(document, foregroundId)?.status).toBe('accepted');
    expect(projectOperation(document, assistantId)).toBeUndefined();
  });

  it('converts command-domain failures into a terminal operation failure', async () => {
    const repository = new MemoryProjectRepository();
    const projectId = randomUUID();
    const operationId = randomUUID();
    await repository.create(rootDocument(projectId, randomUUID()), 'owner');
    const executor = new ProjectOperationExecutor(
      repository,
      { acquire: async () => ({ release: async () => undefined }) },
      async ({ projectId: id, expectedHead, operationId: correlation }) => {
        const appended = await repository.append(id, expectedHead, [
          {
            type: 'system.notified',
            actor: { kind: 'system' },
            operationId: correlation,
            createdAt: new Date().toISOString(),
            payload: { severity: 'error', message: 'Candidate rejected.' }
          }
        ]);
        return { document: appended.document, appendedEvents: appended.events };
      }
    );

    await executor.accept({
      projectId,
      operationId,
      expectedHead: 1,
      command: { type: 'assistant-turn', requestEventIds: [1] }
    });
    await terminal(repository, projectId, operationId);

    expect(
      projectOperation(await repository.load(projectId), operationId)?.terminalEvent
    ).toMatchObject({
      type: 'operation.failed',
      payload: { failureKind: 'domain', message: 'Candidate rejected.' }
    });
  });

  it('classifies AI and build failures by their retained failure kind', async () => {
    const cases = [
      {
        command: 'assistant-turn' as const,
        event: aiFailure('provider'),
        expected: 'infrastructure'
      },
      { command: 'assistant-turn' as const, event: aiFailure('cancelled'), expected: 'cancelled' },
      {
        command: 'assistant-turn' as const,
        event: aiFailure('provider'),
        expected: 'infrastructure'
      },
      {
        command: 'initial-build' as const,
        event: buildFailure('source'),
        expected: 'domain'
      },
      {
        command: 'initial-build' as const,
        event: buildFailure('infrastructure'),
        expected: 'infrastructure'
      }
    ] as const;

    for (const value of cases) {
      const repository = new MemoryProjectRepository();
      const projectId = randomUUID();
      const operationId = randomUUID();
      await repository.create(rootDocument(projectId, randomUUID()), 'owner');
      const executor = new ProjectOperationExecutor(
        repository,
        { acquire: async () => ({ release: async () => undefined }) },
        async ({ projectId: id, expectedHead, operationId: correlation }) => {
          const appended = await repository.append(id, expectedHead, [
            { ...value.event, operationId: correlation },
            ...(value.event.type === 'ai.generation-failed'
              ? [
                  {
                    type: 'system.notified' as const,
                    actor: { kind: 'system' as const },
                    operationId: correlation,
                    createdAt: '2026-08-30T00:00:02.000Z',
                    payload: { severity: 'error' as const, message: value.event.payload.message }
                  }
                ]
              : [])
          ]);
          return { document: appended.document, appendedEvents: appended.events };
        }
      );
      await executor.accept({
        projectId,
        operationId,
        expectedHead: 1,
        command: commandForFailureCase(value.command, operationId)
      });
      await terminal(repository, projectId, operationId);
      expect(
        projectOperation(await repository.load(projectId), operationId)?.terminalEvent
      ).toMatchObject({ type: 'operation.failed', payload: { failureKind: value.expected } });
    }
  });

  it('uses the sanitized system notice for a recorded build failure', async () => {
    const repository = new MemoryProjectRepository();
    const projectId = randomUUID();
    const operationId = randomUUID();
    await repository.create(rootDocument(projectId, randomUUID()), 'owner');
    const executor = new ProjectOperationExecutor(
      repository,
      { acquire: async () => ({ release: async () => undefined }) },
      async ({ projectId: id, expectedHead, operationId: correlation }) => {
        const appended = await repository.append(id, expectedHead, [
          { ...buildFailure('source'), operationId: correlation },
          {
            type: 'system.notified',
            actor: { kind: 'system' },
            operationId: correlation,
            createdAt: new Date().toISOString(),
            payload: {
              severity: 'error',
              message: 'I kept the last working visualization after simplifying it.'
            }
          }
        ]);
        return { document: appended.document, appendedEvents: appended.events };
      }
    );

    await executor.accept({
      projectId,
      operationId,
      expectedHead: 1,
      command: { type: 'assistant-turn', requestEventIds: [1] }
    });
    await terminal(repository, projectId, operationId);

    expect(
      projectOperation(await repository.load(projectId), operationId)?.terminalEvent
    ).toMatchObject({
      payload: {
        failureKind: 'domain',
        message: 'I kept the last working visualization after simplifying it.'
      }
    });
  });

  it('cancels and safely rebases over a background refill before accepting participant work', async () => {
    const repository = new MemoryProjectRepository();
    const projectId = randomUUID();
    const refillId = randomUUID();
    const participantId = randomUUID();
    await repository.create(rootDocument(projectId, randomUUID()), 'owner');
    const executor = new ProjectOperationExecutor(
      repository,
      { acquire: async () => ({ release: async () => undefined }) },
      async ({ projectId: id, expectedHead, operationId, command, signal }) => {
        if (command.type === 'presentation-refill') {
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }
        const appended = await repository.append(id, expectedHead, [
          {
            type: 'project.renamed',
            actor: { kind: 'user' },
            operationId,
            createdAt: new Date().toISOString(),
            payload: { previousTitle: 'Initial', title: 'Participant change' }
          }
        ]);
        return { document: appended.document, appendedEvents: appended.events };
      }
    );

    const refill = await executor.accept({
      projectId,
      operationId: refillId,
      expectedHead: 1,
      command: { type: 'presentation-refill', target: 4 },
      actor: 'system'
    });
    expect(refill.acceptedEventId).toBe(2);
    const participant = await executor.accept({
      projectId,
      operationId: participantId,
      expectedHead: 2,
      command: { type: 'initial-build', seed: 1 }
    });
    await terminal(repository, projectId, participantId);

    const document = await repository.load(projectId);
    expect(projectOperation(document, refillId)?.terminalEvent).toMatchObject({
      type: 'operation.failed',
      payload: { failureKind: 'cancelled' }
    });
    expect(document.events[1].actor).toEqual({ kind: 'system' });
    expect(participant.acceptedEventId).toBe(4);
    expect(projectOperation(document, participantId)?.status).toBe('completed');
  });

  it('gives capacity held by another project refill to participant work', async () => {
    const repository = new MemoryProjectRepository();
    const refillProjectId = randomUUID();
    const participantProjectId = randomUUID();
    const refillId = randomUUID();
    const participantId = randomUUID();
    await repository.create(rootDocument(refillProjectId, randomUUID()), 'owner');
    await repository.create(rootDocument(participantProjectId, randomUUID()), 'owner');
    const executor = new ProjectOperationExecutor(
      repository,
      { acquire: async () => ({ release: async () => undefined }) },
      async ({ projectId, expectedHead, operationId, command, signal }) => {
        if (command.type === 'presentation-refill') {
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }
        const appended = await repository.append(projectId, expectedHead, [
          {
            type: 'project.renamed',
            actor: { kind: 'user' },
            operationId,
            createdAt: new Date().toISOString(),
            payload: { previousTitle: 'Initial', title: 'Participant change' }
          }
        ]);
        return { document: appended.document, appendedEvents: appended.events };
      },
      1
    );

    await executor.accept({
      projectId: refillProjectId,
      operationId: refillId,
      expectedHead: 1,
      command: { type: 'presentation-refill', target: 4 }
    });
    await executor.accept({
      projectId: participantProjectId,
      operationId: participantId,
      expectedHead: 1,
      command: { type: 'initial-build', seed: 1 }
    });
    await terminal(repository, participantProjectId, participantId);

    expect(projectOperation(await repository.load(refillProjectId), refillId)).toMatchObject({
      status: 'failed',
      terminalEvent: {
        payload: { failureKind: 'cancelled', message: 'Superseded by participant activity.' }
      }
    });
    expect(
      projectOperation(await repository.load(participantProjectId), participantId)?.status
    ).toBe('completed');
  });

  it('propagates and enforces a study deadline for accepted asynchronous work', async () => {
    const repository = new MemoryProjectRepository();
    const projectId = randomUUID();
    const operationId = randomUUID();
    await repository.create(rootDocument(projectId, randomUUID()), 'owner');
    let observedDeadline: number | undefined;
    const executor = new ProjectOperationExecutor(
      repository,
      { acquire: async () => ({ release: async () => undefined }) },
      async ({ signal }) => {
        observedDeadline = currentProjectOperationDeadline();
        if (signal.aborted) throw signal.reason;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        throw new Error('unreachable');
      }
    );
    const deadlineAt = new Date(Date.now() + 20).toISOString();

    await executor.accept({
      projectId,
      operationId,
      expectedHead: 1,
      command: { type: 'initial-build', seed: 1 },
      deadlineAt
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await terminal(repository, projectId, operationId);

    expect(observedDeadline).toBe(Date.parse(deadlineAt));
    expect(projectOperation(await repository.load(projectId), operationId)).toMatchObject({
      status: 'failed',
      terminalEvent: {
        payload: {
          failureKind: 'cancelled',
          message: expect.stringContaining('study phase ended')
        }
      }
    });
  });

  it('records feedback during generation and combines it into the next assistant turn', async () => {
    const repository = new MemoryProjectRepository();
    const projectId = randomUUID();
    await repository.create(rootDocument(projectId, randomUUID()), 'owner');
    const assistantReleases: Array<() => void> = [];
    let assistantStarts = 0;
    const executor = new ProjectOperationExecutor(
      repository,
      { acquire: async () => ({ release: async () => undefined }) },
      async ({ projectId: id, operationId, command }) => {
        const document = await repository.load(id);
        if (command.type === 'feedback') {
          const interactionEventId = document.events.length + 1;
          const appended = await repository.append(id, document.events.length, [
            {
              type: 'feedback.submitted',
              actor: { kind: 'user' },
              operationId,
              createdAt: new Date().toISOString(),
              payload: {
                content: command.content,
                focus: command.focus,
                presentationCount: command.presentationCount
              }
            },
            {
              type: 'assistant.turn-requested',
              actor: { kind: 'system' },
              operationId,
              createdAt: new Date().toISOString(),
              payload: { interactionEventId, presentationCount: command.presentationCount }
            }
          ]);
          return { document: appended.document, appendedEvents: appended.events };
        }
        if (command.type !== 'assistant-turn') {
          return { document, appendedEvents: [] };
        }
        const requests = command.requestEventIds.map((eventId) => document.events[eventId - 1]);
        const started = await repository.append(id, document.events.length, [
          {
            type: 'assistant.turn-started',
            actor: { kind: 'system' },
            operationId,
            createdAt: new Date().toISOString(),
            payload: {
              requestEventIds: command.requestEventIds,
              interactionEventIds: requests.map((event) =>
                event?.type === 'assistant.turn-requested' ? event.payload.interactionEventId : 0
              )
            }
          }
        ]);
        assistantStarts += 1;
        await new Promise<void>((resolve) => assistantReleases.push(resolve));
        const current = await repository.load(id);
        const responded = await repository.append(id, current.events.length, [
          {
            type: 'assistant.responded',
            actor: { kind: 'assistant', botId: 'sverlin-assistant' },
            operationId,
            createdAt: new Date().toISOString(),
            payload: {
              content: [{ type: 'markdown', text: 'Noted.' }],
              inReplyTo:
                started.events[0]?.type === 'assistant.turn-started'
                  ? started.events[0].payload.interactionEventIds
                  : []
            }
          }
        ]);
        return { document: responded.document, appendedEvents: responded.events };
      }
    );

    const submit = (text: string) => {
      const operationId = randomUUID();
      return executor.accept({
        projectId,
        operationId,
        expectedHead: 1,
        command: {
          type: 'feedback',
          operationId,
          expectedHead: 1,
          content: [{ type: 'markdown', text }],
          focus: [],
          presentationCount: 2
        }
      });
    };

    await submit('First');
    await eventually(() => assistantStarts === 1);
    await submit('Second');
    await submit('Third');
    expect(pendingAssistantTurnRequests(await repository.load(projectId))).toHaveLength(2);

    assistantReleases.shift()?.();
    await eventually(() => assistantStarts === 2);
    const claims = (await repository.load(projectId)).events.filter(
      (event) => event.type === 'assistant.turn-started'
    );
    expect(claims.at(-1)?.payload.interactionEventIds).toHaveLength(2);
    assistantReleases.shift()?.();
    await eventually(() =>
      repository
        .load(projectId)
        .then((document) => pendingAssistantTurnRequests(document).length === 0)
    );
    await executor.shutdown(1_000);
  });
});

async function eventually(condition: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('The expected asynchronous state was not reached.');
}

function commandForFailureCase(kind: 'assistant-turn' | 'initial-build', _operationId: string) {
  if (kind === 'assistant-turn') return { type: 'assistant-turn' as const, requestEventIds: [1] };
  return { type: 'initial-build' as const, seed: 1 };
}

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
        createdAt: '2026-08-30T00:00:00.000Z',
        payload: {
          title: 'Initial',
          entryArtifactId: 'main',
          assistantId: 'sverlin-assistant',
          creation: { templateId: 'blank' }
        }
      }
    ]
  };
}

function aiFailure(failureKind: 'provider' | 'cancelled') {
  return {
    type: 'ai.generation-failed' as const,
    actor: { kind: 'system' as const },
    operationId: '',
    createdAt: '2026-08-30T00:00:01.000Z',
    payload: {
      attempt: 1 as const,
      failureKind,
      durationMs: 1,
      message: `AI ${failureKind}`,
      details: recorded('details', 'text/plain')
    }
  };
}

function buildFailure(failureKind: 'source' | 'infrastructure') {
  return {
    type: 'build.failed' as const,
    actor: { kind: 'system' as const },
    operationId: '',
    createdAt: '2026-08-30T00:00:01.000Z',
    payload: {
      durationMs: 1,
      failureKind,
      diagnostics: [],
      repairEligible: failureKind === 'source',
      error: `Build ${failureKind}`
    }
  };
}

function recorded(text: string, mediaType: string) {
  return { text, mediaType, sha256: 'a'.repeat(64) };
}

async function terminal(
  repository: MemoryProjectRepository,
  projectId: string,
  operationId: string
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const operation = projectOperation(await repository.load(projectId), operationId);
    if (operation?.status === 'completed' || operation?.status === 'failed') return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Operation did not become terminal.');
}
