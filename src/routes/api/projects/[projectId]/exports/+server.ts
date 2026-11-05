import { isHttpError, json } from '@sveltejs/kit';
import * as v from 'valibot';

import { modeBuilders, UnavailableScenesError } from '$lib/modes/server';
import { requireProjectAccess } from '$lib/server/authorization';
import { presentedVersion } from '$lib/server/projects/service';
import { presentationIdSchema } from '$lib/shared/presentations';

import type { RequestHandler } from './$types';

const querySchema = v.object({
  presentation: presentationIdSchema,
  target: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,31}$/u))
});

/**
 * A version the project presented, exported as one of its mode's render targets, made on the
 * server from the scenes it draws; 409 where the server has no scenes for it, as the scenes
 * endpoint answers.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
  try {
    await requireProjectAccess(locals, params.projectId);
    const parsed = v.safeParse(querySchema, Object.fromEntries(url.searchParams));
    if (!parsed.success) return json({ error: v.summarize(parsed.issues) }, { status: 400 });
    const { presentation: presentationId, target } = parsed.output;
    const presentation = await presentedVersion(params.projectId, presentationId);
    if (!presentation) return json({ error: 'No such version.' }, { status: 404 });
    const exportFile =
      presentation.format === 'browser-bundle-v1' && modeBuilders[presentation.mode]?.exportFile;
    const file = exportFile ? await exportFile(presentation, target) : undefined;
    if (!file) return json({ error: `This version has no ${target} export.` }, { status: 404 });
    return new Response(file.body, {
      headers: {
        'content-type': file.contentType,
        'content-disposition': `attachment; filename="${file.name}"`
      }
    });
  } catch (cause) {
    if (isHttpError(cause)) return json({ error: cause.body.message }, { status: cause.status });
    if (cause instanceof UnavailableScenesError)
      return json({ error: cause.message }, { status: 409 });
    return json(
      { error: cause instanceof Error ? cause.message : 'The export could not be made.' },
      { status: 422 }
    );
  }
};
