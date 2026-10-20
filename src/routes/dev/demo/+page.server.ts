import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

import { requireAdmin } from '$lib/server/authorization';
import { syncDemo } from '$lib/server/dev-demo';
import { listProjectTemplates } from '$lib/server/projects/starter-catalog';

import type { PageServerLoad } from './$types';

/** The demo project, only on the dev server. */
export const load: PageServerLoad = async ({ locals }) => {
  if (!dev) error(404, 'Not found');
  const principal = requireAdmin(locals);
  return { projectId: await syncDemo(principal.user.id), templates: listProjectTemplates() };
};
