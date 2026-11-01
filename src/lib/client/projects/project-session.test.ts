import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ProjectEvent,
  ProjectEventOf,
  ProjectOperationKind
} from '$lib/shared/projects/events';
import type {
  ProjectDocument,
  ProjectResource,
  WorkspaceResource
} from '$lib/shared/projects/model';

import { ProjectSession } from './project-session.svelte';

const navigation = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => navigation);

const operationId = '12345678-1234-4123-8123-123456789abc';
const externalOperationId = '22345678-1234-4234-8234-123456789abc';
const sessions: ProjectSession[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { randomUUID: () => operationId });
  navigation.goto.mockReset();
});

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ProjectSession', () => {
  it('waits for the Timeline operation terminal without navigating', async () => {
    const initial = projectResource([createdEvent()], 'Initial');
    const accepted = operationAcceptedEvent(2, 'rename');
    const acceptedResource = projectResource([...initial.document.events, accepted], 'Initial');
    const renamed = renamedEvent(3, operationId, 'Initial', 'Renamed');
    const completed = operationCompletedEvent(4, 'rename');
    fetchMock
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ projectId: 'project-test', operationId, acceptedEventId: 2 }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' }
          }
        )
      )
      .mockResolvedValueOnce(response(acceptedResource))
      .mockResolvedValueOnce(eventResponse([renamed, completed]));

    const session = createSession();
    await session.open();

    await expect(session.runCommand({ type: 'rename', title: 'Renamed' })).resolves.toBe(true);

    expect(session.snapshot.title).toBe('Renamed');
    expect(session.head).toBe(4);
    expect(session.atHead).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(navigation.goto).not.toHaveBeenCalled();
  });

  it('follows polled events at the head while keeping local history pinned', async () => {
    const initial = projectResource([createdEvent()], 'Initial');
    const responseEvent = assistantEvent(2);
    fetchMock
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce(eventResponse([responseEvent]));

    const session = createSession();
    await session.open();
    const previousResource = session.resource;
    await pollEvents(session);

    expect(session.resource).not.toBe(previousResource);
    expect(session.events).toHaveLength(2);
    expect(session.snapshot.at).toBe(2);
    expect(session.atHead).toBe(true);

    session.select(1);
    expect(session.atHead).toBe(false);
    fetchMock.mockResolvedValueOnce(
      eventResponse([renamedEvent(3, externalOperationId, 'Initial', 'External')])
    );
    await pollEvents(session);

    expect(session.events).toHaveLength(3);
    expect(session.snapshot.at).toBe(1);
    expect(session.snapshot.title).toBe('Initial');
    expect(session.atHead).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('projects external state-changing events without hydration fetches', async () => {
    const initial = projectResource([createdEvent()], 'Initial');
    const renamed = renamedEvent(2, externalOperationId, 'Initial', 'External');
    fetchMock
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce(eventResponse([renamed]));

    const session = createSession();
    await session.open();
    await pollEvents(session);

    expect(session.snapshot.title).toBe('External');
    expect(session.atHead).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loads a participant workspace once and then polls authorized Timeline deltas', async () => {
    const initial = projectResource([createdEvent()], 'Initial');
    fetchMock
      .mockResolvedValueOnce(response(workspaceResource(initial)))
      .mockResolvedValueOnce(eventResponse([assistantEvent(2)]));

    const session = new ProjectSession('project-test', false, 'comparison');
    sessions.push(session);
    await session.open();
    await pollEvents(session);

    expect(session.events).toHaveLength(2);
    expect(session.readOnly).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/projects/project-test/workspace?layout=comparison'
    );
    expect(fetchMock.mock.calls[1][0]).toBe('/api/projects/project-test/events?after=1');
  });

  it('requests the configured buffer deficit without sending a client-owned target', async () => {
    const initial = bufferedProjectResource();
    const accepted = operationAcceptedEvent(5, 'presentation-refill');
    const acceptedResource = projectResource([...initial.document.events, accepted], 'Buffered');
    fetchMock
      .mockResolvedValueOnce(response(workspaceResource(initial)))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ projectId: 'project-test', operationId, acceptedEventId: 5 }),
          { status: 202, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(response(workspaceResource(acceptedResource)));

    const session = new ProjectSession('project-test', false, 'comparison', 4);
    sessions.push(session);
    await session.open();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const refillRequest = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(refillRequest[0]).toBe('/api/projects/project-test/presentation-refill');
    expect(JSON.parse(String(refillRequest[1].body))).toEqual({ operationId, expectedHead: 4 });
    expect(session.refillPending).toBe(true);
  });

  it.each([
    [409, 'The project changed.'],
    [503, 'The server is busy.']
  ])('retries a refill refused with %i without showing an error', async (status, error) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const initial = bufferedProjectResource();
    fetchMock
      .mockResolvedValueOnce(response(workspaceResource(initial)))
      .mockResolvedValueOnce(errorResponse(status, error))
      .mockResolvedValueOnce(errorResponse(status, error));

    const session = new ProjectSession('project-test', false, 'comparison', 4);
    sessions.push(session);
    await session.open();
    await vi.waitFor(() => expect(session.refillPending).toBe(false));

    expect(session.refillError).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe('/api/projects/project-test/presentation-refill');
  });

  it('shows a refill refused for another reason and stops refilling', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const initial = bufferedProjectResource();
    fetchMock
      .mockResolvedValueOnce(response(workspaceResource(initial)))
      .mockResolvedValueOnce(errorResponse(422, 'Presentation generation failed.'));

    const session = new ProjectSession('project-test', false, 'comparison', 4);
    sessions.push(session);
    await session.open();
    await vi.waitFor(() => expect(session.refillError).toBe('Presentation generation failed.'));

    vi.advanceTimersByTime(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not request a buffer refill before the current source has a presentation', async () => {
    const initial = projectResource([createdEvent()], 'Untouched');
    fetchMock.mockResolvedValueOnce(response(workspaceResource(initial)));

    const session = new ProjectSession('project-test', false, 'comparison', 4);
    sessions.push(session);
    await session.open();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(session.refillPending).toBe(false);
  });

  it('does not restart a refill between its cancellation and the foreground operation that replaced it', async () => {
    const initial = bufferedProjectResource();
    const refillAccepted = operationAcceptedEvent(5, 'presentation-refill');
    const active = projectResource([...initial.document.events, refillAccepted], 'Buffered');
    const cancelled: ProjectEventOf<'operation.failed'> = {
      id: 6,
      type: 'operation.failed',
      actor: { kind: 'system' },
      operationId,
      createdAt: '2026-01-01T00:00:06.000Z',
      payload: {
        kind: 'presentation-refill',
        failureKind: 'cancelled',
        message: 'Superseded by participant activity.'
      }
    };
    const feedbackAccepted = {
      ...operationAcceptedEvent(7, 'feedback'),
      operationId: externalOperationId
    };
    fetchMock
      .mockResolvedValueOnce(response(workspaceResource(active)))
      .mockResolvedValueOnce(eventResponse([cancelled, feedbackAccepted]));

    const session = new ProjectSession('project-test', false, 'comparison', 4);
    sessions.push(session);
    await session.open();
    await pollEvents(session);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(session.refillError).toBeNull();
  });

  it('keeps background assistant work out of the foreground command lock', async () => {
    const interactionId = '12345678-1234-4123-8123-123456789abe';
    const assistantId = '12345678-1234-4123-8123-123456789abf';
    const initial = projectResource(
      [
        createdEvent(),
        {
          id: 2,
          type: 'feedback.submitted',
          actor: { kind: 'user' },
          operationId: interactionId,
          createdAt: '2026-01-01T00:00:02.000Z',
          payload: {
            content: [{ type: 'markdown', text: 'Move the label.' }],
            focus: [],
            presentationCount: 2
          }
        },
        {
          id: 3,
          type: 'assistant.turn-requested',
          actor: { kind: 'system' },
          operationId: interactionId,
          createdAt: '2026-01-01T00:00:03.000Z',
          payload: { interactionEventId: 2, presentationCount: 2 }
        },
        {
          id: 4,
          type: 'operation.accepted',
          actor: { kind: 'system' },
          operationId: assistantId,
          createdAt: '2026-01-01T00:00:04.000Z',
          payload: { kind: 'assistant-turn' }
        },
        {
          id: 5,
          type: 'assistant.turn-started',
          actor: { kind: 'system' },
          operationId: assistantId,
          createdAt: '2026-01-01T00:00:05.000Z',
          payload: { requestEventIds: [3], interactionEventIds: [2] }
        }
      ],
      'Background assistant'
    );
    fetchMock.mockResolvedValueOnce(response(initial));

    const session = createSession();
    await session.open();

    expect(session.pending).toBeNull();
    expect(session.assistantResponding).toBe(true);
  });

  it('creates a project from an explicit template and preserves Dev detail', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ projectId: 'dev-project', operationId }), {
        status: 202,
        headers: { 'content-type': 'application/json' }
      })
    );
    const session = createSession();

    await session.createProject({ templateId: 'linear-search' }, true);

    const request = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request[0]).toBe('/api/projects');
    expect(JSON.parse(String(request[1].body))).toEqual({
      templateId: 'linear-search'
    });
    expect(navigation.goto).toHaveBeenCalledWith('/projects/dev-project?dev=1');
    expect(session.creating).toBe(false);
  });

  it('releases project creation state after a server failure', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Project creation unavailable.' }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      })
    );
    const session = createSession();

    await expect(session.createProject({ templateId: 'blank' })).resolves.toBe(false);

    expect(session.creating).toBe(false);
    expect(session.error).toBe('Project creation unavailable.');
    expect(navigation.goto).not.toHaveBeenCalled();
  });
});

function createSession(): ProjectSession {
  const session = new ProjectSession('project-test');
  sessions.push(session);
  return session;
}

function response(resource: unknown): Response {
  return new Response(JSON.stringify(resource), {
    headers: { 'content-type': 'application/json' }
  });
}

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function workspaceResource(resource: ProjectResource): WorkspaceResource {
  return {
    schemaVersion: 1,
    userAuthorLabel: 'You',
    projectId: resource.document.projectId,
    document: resource.document,
    projects: resource.projects,
    view: 'participant',
    layout: 'comparison',
    readOnly: false
  };
}

function eventResponse(events: ProjectEvent[]): Response {
  return new Response(JSON.stringify({ events }), {
    headers: { 'content-type': 'application/json' }
  });
}

function pollEvents(session: ProjectSession): Promise<void> {
  return (
    session as unknown as {
      pollEvents(): Promise<void>;
    }
  ).pollEvents();
}

function projectResource(events: ProjectEvent[], title: string): ProjectResource {
  const document: ProjectDocument = {
    schemaVersion: 1,
    projectId: 'project-test',
    events
  };
  return {
    document,
    projects: [
      {
        projectId: document.projectId,
        title,
        updatedAt: events.at(-1)!.createdAt,
        eventCount: events.length,
        templateId: 'blank',
        mode: 'sverlin'
      }
    ]
  };
}

function bufferedProjectResource(): ProjectResource {
  return projectResource(
    [
      createdEvent(),
      {
        id: 2,
        type: 'artifact.version-created',
        actor: { kind: 'user' },
        operationId,
        createdAt: '2026-01-01T00:00:02.000Z',
        payload: {
          origin: { kind: 'initial' },
          changes: [
            {
              operation: 'upsert',
              artifact: {
                artifactId: 'main',
                path: 'Main.svelte',
                language: 'svelte',
                content: {
                  text: 'source',
                  sha256: 'a'.repeat(64),
                  mediaType: 'text/x-svelte'
                }
              }
            }
          ]
        }
      },
      presentedEvent(3, 0),
      presentedEvent(4, 1)
    ],
    'Buffered'
  );
}

function presentedEvent(id: number, slot: 0 | 1): ProjectEventOf<'visualization.presented'> {
  return {
    id,
    type: 'visualization.presented',
    actor: { kind: 'system' },
    operationId,
    createdAt: `2026-01-01T00:00:0${id}.000Z`,
    payload: {
      displaySetId: '12345678-1234-4123-8123-123456789abd',
      slot,
      presentation: {
        presentationId: `12345678-1234-4123-8123-123456789ac${slot + 1}`,
        format: 'browser-bundle-v1',
        mode: 'sverlin',
        stepSignature: 'shared',
        labels: ['Overview'],
        seed: slot + 1,
        source: { text: 'source', sha256: 'a'.repeat(64), mediaType: 'text/x-svelte' },
        html: { text: '', sha256: '0'.repeat(64), mediaType: 'text/html' },
        javascript: {
          text: 'document.body.textContent="Overview";',
          sha256: String(slot + 1).repeat(64),
          mediaType: 'text/javascript'
        }
      }
    }
  };
}

function createdEvent(): ProjectEventOf<'project.created'> {
  return {
    id: 1,
    type: 'project.created',
    actor: { kind: 'user' },
    operationId,
    createdAt: '2026-01-01T00:00:01.000Z',
    payload: {
      title: 'Initial',
      entryArtifactId: 'main',
      assistantId: 'sverlin-assistant',
      creation: { templateId: 'blank' }
    }
  };
}

function renamedEvent(
  id: number,
  eventOperationId: string,
  previousTitle: string,
  title: string
): ProjectEventOf<'project.renamed'> {
  return {
    id,
    type: 'project.renamed',
    actor: { kind: 'user' },
    operationId: eventOperationId,
    createdAt: `2026-01-01T00:00:0${id}.000Z`,
    payload: { previousTitle, title }
  };
}

function assistantEvent(id: number): ProjectEventOf<'assistant.responded'> {
  return {
    id,
    type: 'assistant.responded',
    actor: { kind: 'assistant', botId: 'sverlin-assistant' },
    operationId,
    createdAt: `2026-01-01T00:00:0${id}.000Z`,
    payload: { content: [{ type: 'markdown', text: 'Done' }] }
  };
}

function operationAcceptedEvent(
  id: number,
  kind: ProjectOperationKind
): ProjectEventOf<'operation.accepted'> {
  return {
    id,
    type: 'operation.accepted',
    actor: { kind: kind === 'presentation-refill' ? 'system' : 'user' },
    operationId,
    createdAt: `2026-01-01T00:00:0${id}.000Z`,
    payload: { kind }
  };
}

function operationCompletedEvent(
  id: number,
  kind: 'rename'
): ProjectEventOf<'operation.completed'> {
  return {
    id,
    type: 'operation.completed',
    actor: { kind: 'system' },
    operationId,
    createdAt: `2026-01-01T00:00:0${id}.000Z`,
    payload: { kind }
  };
}
