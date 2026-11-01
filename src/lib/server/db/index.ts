/** Lazy process-local Postgres/Drizzle client owned by the SvelteKit service. */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

const databaseKey = Symbol.for('sverlin.postgres');
type DatabaseState = {
  client: ReturnType<typeof postgres>;
  db: PostgresJsDatabase<typeof schema>;
};
const shared = globalThis as typeof globalThis & { [databaseKey]?: DatabaseState };

function connect(): DatabaseState {
  const url =
    process.env.DATABASE_URL?.trim() || 'postgres://postgres:postgres@127.0.0.1:5432/sverlin';
  const client = postgres(url, {
    // Six running operations each hold a connection for their lock (operations.ts), and a
    // participant's feedback or answer holds one while it runs; the rest serve queries.
    max: readPositiveInteger(process.env.SVERLIN_DATABASE_POOL_SIZE, 12),
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: process.env.PGSSLMODE === 'require' ? 'require' : false
  });
  return { client, db: drizzle(client, { schema }) };
}

export function database(): PostgresJsDatabase<typeof schema> {
  return (shared[databaseKey] ??= connect()).db;
}

export function sqlClient(): ReturnType<typeof postgres> {
  return (shared[databaseKey] ??= connect()).client;
}

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function closeDatabase(): Promise<void> {
  const state = shared[databaseKey];
  if (!state) return;
  delete shared[databaseKey];
  await state.client.end({ timeout: 5 });
}

function readPositiveInteger(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
