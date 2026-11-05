import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  presented: vi.fn(),
  exportFile: vi.fn(),
  Unavailable: class UnavailableScenesError extends Error {}
}));

vi.mock('$lib/server/authorization', () => ({ requireProjectAccess: mocks.access }));
vi.mock('$lib/server/projects/service', () => ({ presentedVersion: mocks.presented }));
vi.mock('$lib/modes/server', () => ({
  modeBuilders: { sverlin: { exportFile: mocks.exportFile }, html: {} },
  UnavailableScenesError: mocks.Unavailable
}));

const presentationId = '12345678-1234-4123-8123-123456789abc';
const version = { format: 'browser-bundle-v1', mode: 'sverlin', labels: ['a'] };
const file = {
  name: 'presentation-12345678-seed-1.pdf',
  contentType: 'application/pdf',
  body: new TextEncoder().encode('%PDF-1.3')
};

beforeEach(() => {
  mocks.access.mockReset().mockResolvedValue({ kind: 'admin' });
  mocks.presented.mockReset().mockResolvedValue(version);
  mocks.exportFile.mockReset().mockResolvedValue(file);
});

describe('exports API', () => {
  it('sends the file the mode made on the server, to be saved under its name', async () => {
    const { GET } = await import('./+server');
    const response = await GET(request('target=pdf'));
    expect(response.status).toBe(200);
    expect(mocks.exportFile).toHaveBeenCalledWith(version, 'pdf');
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${file.name}"`);
    expect(await response.text()).toBe('%PDF-1.3');
  });

  it('answers 404 for a target the mode has none of, and 400 for no target', async () => {
    mocks.exportFile.mockResolvedValueOnce(undefined);
    const { GET } = await import('./+server');
    expect((await GET(request('target=gif'))).status).toBe(404);
    expect((await GET(request())).status).toBe(400);
  });

  it('answers 409 where the server has no scenes, as for an older build', async () => {
    mocks.exportFile.mockRejectedValueOnce(new mocks.Unavailable('Built by an earlier app.'));
    const { GET } = await import('./+server');
    expect((await GET(request('target=pdf'))).status).toBe(409);
  });
});

function request(query = '') {
  const url = new URL(
    `http://localhost/api/projects/project-test/exports?presentation=${presentationId}&${query}`
  );
  return { params: { projectId: 'project-test' }, locals: {}, url } as never;
}
