import { isHttpError, json } from '@sveltejs/kit';
import * as v from 'valibot';

import { modeBuilders, UnavailableScenesError } from '$lib/modes/server';
import { requireProjectAccess } from '$lib/server/authorization';
import { presentedVersion } from '$lib/server/projects/service';
import { presentationIdSchema } from '$lib/shared/presentations';

import type { RequestHandler } from './$types';

// The page asks for the step it shows and those either side; an export asks for every step.
const querySchema = v.object({
  presentation: presentationIdSchema,
  steps: v.optional(
    v.pipe(
      v.string(),
      v.regex(/^\d{1,4}(,\d{1,4}){0,31}$/u),
      v.transform((list) => list.split(',').map(Number))
    )
  )
});

/**
 * Some steps of a version the project presented, as scene data drawn on the server (all, where no
 * steps are named), with its frame; 409 where the server has none for it, for the page to describe
 * its own steps instead, marked `stale` where an older app built it, which a rebuild then draws.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
  try {
    await requireProjectAccess(locals, params.projectId);
    const parsed = v.safeParse(querySchema, Object.fromEntries(url.searchParams));
    if (!parsed.success) return json({ error: v.summarize(parsed.issues) }, { status: 400 });
    const { presentation: presentationId, steps } = parsed.output;
    const presentation = await presentedVersion(params.projectId, presentationId);
    if (!presentation) return json({ error: 'No such version.' }, { status: 404 });
    const scenes =
      presentation.format === 'browser-bundle-v1' && modeBuilders[presentation.mode]?.scenes;
    if (!scenes) return json({ error: 'This version has no scenes.' }, { status: 409 });
    if (steps?.some((step) => step >= presentation.labels.length))
      return json({ error: 'No such step.' }, { status: 400 });
    return json(await scenes(presentation, steps));
  } catch (cause) {
    if (isHttpError(cause)) return json({ error: cause.body.message }, { status: cause.status });
    if (cause instanceof UnavailableScenesError)
      return json(
        { error: cause.message, ...(cause.stale ? { stale: true } : {}) },
        { status: 409 }
      );
    return json(
      { error: cause instanceof Error ? cause.message : 'The scenes could not be drawn.' },
      { status: 422 }
    );
  }
};
