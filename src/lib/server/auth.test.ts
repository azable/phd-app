import { afterEach, describe, expect, it } from 'vitest';

import {
  authenticationRequired,
  registeredPasskeyOwner,
  safeReturnPath,
  validateAuthenticationConfiguration
} from './auth';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('Better Auth configuration', () => {
  it('requires the durable production configuration', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    expect(() => validateAuthenticationConfiguration()).toThrow('DATABASE_URL');

    process.env.DATABASE_URL = 'postgres://example.invalid/sverlin';
    process.env.BETTER_AUTH_URL = 'https://study.example';
    process.env.BETTER_AUTH_SECRET = 'a'.repeat(32);
    expect(() => validateAuthenticationConfiguration()).not.toThrow();
    expect(authenticationRequired()).toBe(true);

    delete process.env.BETTER_AUTH_URL;
    expect(() => validateAuthenticationConfiguration()).toThrow('BETTER_AUTH_URL');
  });

  it('lets only a signed-in administrator add a passkey', async () => {
    await expect(registeredPasskeyOwner({ role: 'admin' })).resolves.toEqual({
      name: 'Administrator passkey'
    });
    await expect(registeredPasskeyOwner({ role: 'user' })).rejects.toThrow(
      'Only an administrator can add a passkey.'
    );
  });

  it('allows only same-origin, non-auth return paths', () => {
    expect(safeReturnPath('/projects/example?step=2')).toBe('/projects/example?step=2');
    expect(safeReturnPath('//attacker.example')).toBe('/');
    expect(safeReturnPath('/login?next=/login')).toBe('/');
    expect(safeReturnPath('https://attacker.example')).toBe('/');
  });
});
