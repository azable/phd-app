import { isHttpError, json } from '@sveltejs/kit';
import * as v from 'valibot';

import { requireProjectAccess, requireProjectMutationAccess } from '$lib/server/authorization';
import { recordPresentationLoad } from '$lib/server/projects/service';
import { presentationLoadTimingSchema } from '$lib/shared/presentation-load-timing';

import type { RequestHandler } from './$types';

// A report is about 2 KB, most of it the font widths (24 of them); this bounds the body well above.
const maximumBodyBytes = 16 * 1024;

/**
 * Record how a presentation loaded in the project Timeline (see recordPresentationLoad) and write
 * it to the server log, one JSON line per load. A viewer who may not change the project, such as an
 * administrator viewing a participant's, is only logged. While an operation runs, the report is
 * refused with 409 before anything is logged, and the browser sends it again later.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
  try {
    const principal = await requireProjectAccess(locals, params.projectId);
    const text = await request.text();
    if (text.length > maximumBodyBytes)
      return json({ error: 'The timing report is too large.' }, { status: 413 });
    const parsed = v.safeParse(presentationLoadTimingSchema, JSON.parse(text));
    if (!parsed.success) return json({ error: v.summarize(parsed.issues) }, { status: 400 });
    const writable = await requireProjectMutationAccess(locals, params.projectId).then(
      () => true,
      (cause: unknown) => {
        if (isHttpError(cause) && cause.status === 403) return false;
        throw cause;
      }
    );
    if (writable)
      await recordPresentationLoad({ projectId: params.projectId, report: parsed.output });
    console.info(
      JSON.stringify({
        type: 'sverlin.presentation-load',
        at: new Date().toISOString(),
        projectId: params.projectId,
        viewer: principal.kind,
        ...parsed.output
      })
    );
    return new Response(null, { status: 204 });
  } catch (cause) {
    if (isHttpError(cause)) return json({ error: cause.body.message }, { status: cause.status });
    if (cause instanceof SyntaxError)
      return json({ error: 'The timing report is not JSON.' }, { status: 400 });
    if (cause instanceof Error && cause.name === 'ProjectConflictError')
      return json({ error: cause.message }, { status: 409 });
    if (cause instanceof Error) return json({ error: cause.message }, { status: 422 });
    throw cause;
  }
};
