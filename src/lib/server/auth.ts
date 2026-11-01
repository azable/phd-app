/** Better Auth configuration and SvelteKit principal resolution. */

import { getRequestEvent } from '$app/server';
import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, username } from 'better-auth/plugins';
import { betterAuth } from 'better-auth/minimal';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { eq } from 'drizzle-orm';

import { database } from '$lib/server/db';
import * as authSchema from '$lib/server/db/schema';

const sessionSeconds = 30 * 24 * 60 * 60;
const bootstrapAdminId = 'sverlin-admin';
const bootstrapAdminName = 'Administrator';
const bootstrapAdminEmail = 'admin@study.invalid';

function configuredBaseUrl(): string {
  return (
    process.env.BETTER_AUTH_URL?.trim() || process.env.ORIGIN?.trim() || 'http://localhost:5173'
  );
}

function trustedOrigins(): string[] {
  const configured = process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([configuredBaseUrl(), ...(configured ?? [])])];
}

async function adminExists(): Promise<boolean> {
  const result = await database()
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.role, 'admin'))
    .limit(1);
  return result.length > 0;
}

/** Whether the passkey-first bootstrap endpoint may create the first administrator. */
export async function adminSetupAvailable(): Promise<boolean> {
  return !(await adminExists());
}

async function ensureBootstrapAdmin(): Promise<string> {
  if (await adminExists()) {
    throw new Error('Admin setup is unavailable.');
  }
  const inserted = await database()
    .insert(authSchema.user)
    .values({
      id: bootstrapAdminId,
      name: bootstrapAdminName,
      email: bootstrapAdminEmail,
      emailVerified: true,
      role: 'admin'
    })
    .onConflictDoNothing({ target: authSchema.user.id })
    .returning({ id: authSchema.user.id });
  if (!inserted[0]) throw new Error('Administrator setup has already been completed.');
  return bootstrapAdminId;
}

export const auth = betterAuth({
  // The passkey plugin's relying-party name, which the passkey dialog shows.
  appName: 'Visualization study',
  baseURL: configuredBaseUrl(),
  secret: process.env.BETTER_AUTH_SECRET || 'development-only-better-auth-secret-change-me',
  trustedOrigins: trustedOrigins(),
  disabledPaths: ['/is-username-available'],
  database: drizzleAdapter(database(), {
    provider: 'pg',
    schema: authSchema
  }),
  advanced: {
    database: { joins: true },
    cookiePrefix: 'sverlin'
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12
  },
  session: {
    expiresIn: sessionSeconds,
    updateAge: 24 * 60 * 60
  },
  rateLimit: {
    enabled: process.env.NODE_ENV === 'production',
    storage: 'database',
    modelName: 'rateLimit',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/passkey': { window: 60, max: 10 },
      '/sign-in/username': { window: 60, max: 10 },
      '/passkey/generate-register-options': { window: 60, max: 5 },
      '/passkey/verify-registration': { window: 60, max: 5 }
    }
  },
  plugins: [
    admin(),
    username({
      displayUsername: false,
      immutableUsername: true,
      minUsernameLength: 1,
      maxUsernameLength: 128,
      usernameValidator: (value) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
    }),
    passkey({
      rpID: new URL(configuredBaseUrl()).hostname,
      registration: {
        requireSession: false,
        resolveUser: async () => {
          if (await adminExists()) throw new Error('Admin setup is unavailable.');
          return {
            id: bootstrapAdminId,
            name: bootstrapAdminEmail,
            displayName: bootstrapAdminName
          };
        },
        afterVerification: async () => ({
          userId: await ensureBootstrapAdmin(),
          name: 'Primary administrator passkey'
        })
      }
    }),
    sveltekitCookies(getRequestEvent)
  ]
});

export type AuthSession = typeof auth.$Infer.Session.session;
export type AuthUser = typeof auth.$Infer.Session.user;

export type AdminPrincipal = {
  kind: 'admin';
  user: AuthUser;
  session: AuthSession;
};

export type ParticipantPrincipal = {
  kind: 'participant';
  user: AuthUser;
  session: AuthSession;
  participant: { participantId: string };
};

export type Principal = AdminPrincipal | ParticipantPrincipal;

/** Resolve a Better Auth administrator or enabled participant session. */
export async function resolvePrincipal(
  value: { user: AuthUser; session: AuthSession } | null
): Promise<Principal | null> {
  if (!value) return null;
  if (value.user.role === 'admin') {
    return { kind: 'admin', user: value.user, session: value.session };
  }
  if (value.user.role !== 'user' || value.user.banned || !value.user.username) return null;
  return {
    kind: 'participant',
    user: value.user,
    session: value.session,
    participant: { participantId: value.user.name || value.user.username }
  };
}

/** Constrain redirects to a same-origin, non-auth path. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || value.includes('\\')) return '/';
  try {
    const base = new URL(configuredBaseUrl());
    const resolved = new URL(value, base);
    if (resolved.origin !== base.origin || !resolved.pathname.startsWith('/')) return '/';
    if (resolved.pathname.startsWith('/login') || resolved.pathname.startsWith('/api/auth')) {
      return '/';
    }
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return '/';
  }
}

export function validateAuthenticationConfiguration(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required.');
  if (!process.env.BETTER_AUTH_URL?.trim()) throw new Error('BETTER_AUTH_URL is required.');
  if (Buffer.byteLength(process.env.BETTER_AUTH_SECRET ?? '') < 32) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 bytes.');
  }
}

export function authenticationRequired(): boolean {
  return true;
}
