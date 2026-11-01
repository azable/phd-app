import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildSha } from './runtime-config';

describe('buildSha', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('falls back to the commit Render gives when the deployment sets none', () => {
    vi.stubEnv('SVERLIN_BUILD_SHA', '');
    vi.stubEnv('RENDER_GIT_COMMIT', 'abc123');
    expect(buildSha()).toBe('abc123');
    vi.stubEnv('SVERLIN_BUILD_SHA', 'def456');
    expect(buildSha()).toBe('def456');
    vi.stubEnv('SVERLIN_BUILD_SHA', '');
    vi.stubEnv('RENDER_GIT_COMMIT', ' ');
    expect(buildSha()).toBeUndefined();
  });
});
