import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadProjectResource: vi.fn(),
  accept: vi.fn(),
  requireMutation: vi.fn()
}));

vi.mock('$lib/server/projects/service', () => ({
  loadProjectResource: mocks.loadProjectResource
}));
vi.mock('$lib/server/projects/operations', () => ({
  projectOperationExecutor: { accept: mocks.accept }
}));
vi.mock('$lib/server/authorization', () => ({
  requireProjectAccess: vi.fn(async (locals) => locals.principal),
  requireProjectMutationAccess: mocks.requireMutation,
  projectListOwner: vi.fn(() => 'user-test')
}));

const operationId = '12345678-1234-4123-8123-123456789abc';

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset().mockResolvedValue(undefined));
  mocks.accept.mockResolvedValue({
    projectId: 'project-test',
    operationId,
    acceptedEventId: 5
  });
  mocks.requireMutation.mockResolvedValue({ principal: { kind: 'participant' } });
  mocks.loadProjectResource.mockResolvedValue({
    document: { schemaVersion: 1, projectId: 'project-test', events: [] },
    projects: []
  });
});

describe('project JSON API', () => {
  it('accepts a validated command and returns its Timeline operation', async () => {
    const { POST } = await import('./+server');
    const response = await POST(
      request('POST', {
        type: 'rename',
        operationId,
        expectedHead: 4,
        title: 'Renamed'
      })
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      projectId: 'project-test',
      operationId,
      acceptedEventId: 5
    });
    expect(mocks.accept).toHaveBeenCalledWith({
      projectId: 'project-test',
      operationId,
      expectedHead: 4,
      command: {
        type: 'rename',
        operationId,
        expectedHead: 4,
        title: 'Renamed'
      }
    });
  });

  it('returns structured client and conflict errors', async () => {
    const { POST } = await import('./+server');
    const invalid = await POST(request('POST', { type: 'rebuild', seed: 1 }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toHaveProperty('error');

    const conflict = new Error('stale');
    conflict.name = 'ProjectConflictError';
    mocks.accept.mockRejectedValueOnce(conflict);
    const stale = await POST(
      request('POST', { type: 'rebuild', operationId, expectedHead: 2, seed: 1 })
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({ error: 'stale' });
  });

  it('passes the server-authoritative study deadline into asynchronous work', async () => {
    mocks.requireMutation.mockResolvedValueOnce({
      principal: { kind: 'participant' },
      study: { deadlineAt: '2026-08-30T12:15:00.000Z' }
    });
    const { POST } = await import('./+server');

    const response = await POST(
      request('POST', {
        type: 'rename',
        operationId,
        expectedHead: 4,
        title: 'Renamed'
      })
    );

    expect(response.status).toBe(202);
    expect(mocks.accept).toHaveBeenCalledWith(
      expect.objectContaining({ deadlineAt: '2026-08-30T12:15:00.000Z' })
    );
  });

  it('rejects unknown message content at the request boundary', async () => {
    const { POST } = await import('./+server');
    const response = await POST(
      request('POST', {
        type: 'feedback',
        operationId,
        expectedHead: 4,
        focus: [],
        content: [{ type: 'markdown', text: 'Make this clearer' }, { type: 'unsupported-content' }],
        presentationCount: 1
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it('honours a resample’s chooser only from an administrator', async () => {
    const { POST } = await import('./+server');
    const resample = {
      type: 'resample',
      operationId,
      expectedHead: 4,
      presentationCount: 2,
      chooser: 'random'
    };

    await POST(request('POST', resample));
    expect(mocks.accept.mock.calls[0][0].command).not.toHaveProperty('chooser');

    mocks.requireMutation.mockResolvedValueOnce({ principal: { kind: 'admin' } });
    await POST(request('POST', resample));
    expect(mocks.accept.mock.calls[1][0].command).toMatchObject({ chooser: 'random' });

    mocks.requireMutation.mockResolvedValueOnce({ principal: { kind: 'admin' } });
    const unknown = await POST(request('POST', { ...resample, chooser: 'oracle' }));
    expect(unknown.status).toBe(400);
  });

  it('accepts a request for fresh variants of the unchanged Sverlin source', async () => {
    const { POST } = await import('./+server');
    const response = await POST(
      request('POST', {
        type: 'resample',
        operationId,
        expectedHead: 4,
        presentationCount: 2
      })
    );

    expect(response.status).toBe(202);
    expect(mocks.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({ type: 'resample', presentationCount: 2 })
      })
    );
  });

  it('accepts a preference between two presentations at a specific step', async () => {
    const { POST } = await import('./+server');
    const presentations = [
      '12345678-1234-4123-8123-123456789ac1',
      '12345678-1234-4123-8123-123456789ac2'
    ] as const;
    const response = await POST(
      request('POST', {
        type: 'prefer',
        operationId,
        expectedHead: 4,
        presentations,
        preferred: presentations[0],
        step: 0
      })
    );

    expect(response.status).toBe(202);
    expect(mocks.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({ type: 'prefer', presentations, step: 0 })
      })
    );
  });

  it('rejects unknown command fields', async () => {
    const { POST } = await import('./+server');
    const response = await POST(
      request('POST', {
        type: 'feedback',
        operationId,
        expectedHead: 4,
        focus: [],
        unexpected: true,
        content: [{ type: 'markdown', text: 'Feedback' }],
        presentationCount: 2
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
});

function request(method: string, body: unknown) {
  const url = new URL('http://localhost/api/projects/project-test');
  return {
    locals: testLocals(),
    params: { projectId: 'project-test' },
    url,
    request: new Request(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as never;
}

function testLocals() {
  return {
    principal: {
      kind: 'participant',
      user: { id: 'user-test' },
      session: {},
      participant: {
        participantId: 'P001'
      }
    }
  };
}
