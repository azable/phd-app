import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  presented: vi.fn(),
  scenes: vi.fn(),
  Unavailable: class UnavailableScenesError extends Error {}
}));

vi.mock('$lib/server/authorization', () => ({ requireProjectAccess: mocks.access }));
vi.mock('$lib/server/projects/service', () => ({ presentedVersion: mocks.presented }));
vi.mock('$lib/modes/server', () => ({
  modeBuilders: { sverlin: { scenes: mocks.scenes }, html: {} },
  UnavailableScenesError: mocks.Unavailable
}));

const presentationId = '12345678-1234-4123-8123-123456789abc';
const version = { format: 'browser-bundle-v1', mode: 'sverlin', labels: ['a', 'b', 'c'] };

beforeEach(() => {
  mocks.access.mockReset().mockResolvedValue({ kind: 'admin' });
  mocks.presented.mockReset().mockResolvedValue(version);
  mocks.scenes.mockReset().mockResolvedValue({ frame: {}, steps: [] });
});

describe('scenes API', () => {
  it('draws the steps asked for of a version the project presented', async () => {
    const { GET } = await import('./+server');
    const response = await GET(request('steps=2,1'));
    expect(response.status).toBe(200);
    expect(mocks.presented).toHaveBeenCalledWith('project-test', presentationId);
    expect(mocks.scenes).toHaveBeenCalledWith(version, [2, 1]);
  });

  it.each([
    ['a step past the last', 'steps=3', 400],
    ['steps that are not numbers', 'steps=1,x', 400]
  ])('refuses %s', async (_, query, status) => {
    const { GET } = await import('./+server');
    expect((await GET(request(query))).status).toBe(status);
    expect(mocks.scenes).not.toHaveBeenCalled();
  });

  it('answers 409 where the server has no scenes, for the page to describe its own', async () => {
    mocks.scenes.mockRejectedValueOnce(new mocks.Unavailable('Built by an earlier app.'));
    const { GET } = await import('./+server');
    expect((await GET(request())).status).toBe(409);
    mocks.presented.mockResolvedValueOnce({ ...version, format: 'html-frames-v1', mode: 'html' });
    expect((await GET(request())).status).toBe(409);
  });
});

function request(query = '') {
  const url = new URL(
    `http://localhost/api/projects/project-test/scenes?presentation=${presentationId}&${query}`
  );
  return { params: { projectId: 'project-test' }, locals: {}, url } as never;
}
