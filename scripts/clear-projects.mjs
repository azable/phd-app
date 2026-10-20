/**
 * Delete every project from the local development database, with its events and interaction
 * sessions (cascaded); accounts and study runs stay, a study phase run losing only its project.
 */

import postgres from 'postgres';

const url = new URL(process.env.DATABASE_URL?.trim() || 'postgres://127.0.0.1:5432/sverlin');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
  throw new Error(
    `Refusing to clear projects on ${url.hostname}: only a local database is cleared.`
  );
}

const sql = postgres(url.toString(), { max: 1, prepare: false });
try {
  const [{ count }] =
    await sql`with deleted as (delete from project returning 1) select count(*)::int as count from deleted`;
  console.log(`Deleted ${count} projects from ${url.pathname.slice(1)} on ${url.hostname}.`);
} finally {
  await sql.end();
}
