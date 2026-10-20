import { dev } from '$app/environment';
import { error, json } from '@sveltejs/kit';

import { requireAdmin } from '$lib/server/authorization';
import { syncDemo } from '$lib/server/dev-demo';

import type { RequestHandler } from './$types';

/** Bring the demo project up to date and name it, so the open page follows a flush. */
export const GET: RequestHandler = async ({ locals }) => {
  if (!dev) error(404, 'Not found');
  const principal = requireAdmin(locals);
  return json({ projectId: await syncDemo(principal.user.id) });
};
