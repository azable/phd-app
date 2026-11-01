import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  requireMutation: vi.fn(),
  trialCondition: vi.fn(),
  CapacityError: class ProjectOperationCapacityError extends Error {}
}));

vi.mock('$lib/server/projects/operations', () => ({
  projectOperationExecutor: { accept: mocks.accept },
  ProjectOperationCapacityError: mocks.CapacityError
}));
vi.mock('$lib/server/study', () => ({ projectTrialCondition: mocks.trialCondition }));
vi.mock('$lib/server/authorization', () => ({
  requireProjectMutationAccess: mocks.requireMutation
}));

const operationId = '12345678-1234-4123-8123-123456789abc';

beforeEach(() => {
  mocks.trialCondition.mockReset().mockResolvedValue(undefined);
  mocks.accept.mockReset().mockResolvedValue({
    projectId: 'project-test',
    operationId,
    acceptedEventId: 8
  });
  mocks.requireMutation.mockReset().mockResolvedValue({
    study: {
      presentationBufferTarget: 4,
      deadlineAt: '2026-08-30T12:15:00.000Z'
    }
  });
});

describe('presentation refill API', () => {
  it('derives the configured target on the server', async () => {
    const { POST } = await import('./+server');
    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(mocks.accept).toHaveBeenCalledWith({
      projectId: 'project-test',
      operationId,
      expectedHead: 7,
      command: { type: 'presentation-refill', target: 4 },
      actor: 'system',
      deadlineAt: '2026-08-30T12:15:00.000Z'
    });
  });

  it.each([
    ['a full executor', () => new mocks.CapacityError('Busy.'), 503],
    [
      'a moved project',
      () => Object.assign(new Error('Moved.'), { name: 'ProjectConflictError' }),
      409
    ],
    ['any other failure', () => new Error('Broken.'), 422]
  ])('reports %s with its own status', async (_, cause, status) => {
    mocks.accept.mockRejectedValueOnce(cause());
    const { POST } = await import('./+server');

    const response = await POST(request());

    expect(response.status).toBe(status);
  });

  it('does not enable buffering for unconfigured projects', async () => {
    mocks.requireMutation.mockResolvedValueOnce({});
    const { POST } = await import('./+server');

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
});

function request() {
  const url = new URL('http://localhost/api/projects/project-test/presentation-refill');
  return {
    params: { projectId: 'project-test' },
    locals: {},
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId, expectedHead: 7 })
    })
  } as never;
}
