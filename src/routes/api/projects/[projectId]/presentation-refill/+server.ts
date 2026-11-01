import { isHttpError, json } from '@sveltejs/kit';
import * as v from 'valibot';

import { requireProjectMutationAccess } from '$lib/server/authorization';
import { projectTrialCondition } from '$lib/server/study';
import { projectOperationExecutor } from '$lib/server/projects/operations';
import { ProjectConflictError, ProjectNotFoundError } from '$lib/server/projects/repository';
import { operationIdSchema, positiveSchema } from '$lib/shared/projects/events/values';

import type { RequestHandler } from './$types';

const requestSchema = v.object({ operationId: operationIdSchema, expectedHead: positiveSchema });

/** Reconcile the server-configured current-source presentation buffer. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
  try {
    const inspection = await requireProjectMutationAccess(locals, params.projectId);
    const target =
      inspection.study?.presentationBufferTarget ??
      (await projectTrialCondition(params.projectId, inspection.study))?.presentationBufferTarget;
    if (!target)
      return json({ error: 'This project has no presentation buffer.' }, { status: 400 });
    const parsed = v.safeParse(requestSchema, await request.json());
    if (!parsed.success) return json({ error: v.summarize(parsed.issues) }, { status: 400 });
    const accepted = await projectOperationExecutor.accept({
      projectId: params.projectId,
      operationId: parsed.output.operationId,
      expectedHead: parsed.output.expectedHead,
      command: { type: 'presentation-refill', target },
      actor: 'system',
      ...(inspection.study?.deadlineAt ? { deadlineAt: inspection.study.deadlineAt } : {})
    });
    return json(accepted, { status: 202 });
  } catch (cause) {
    if (isHttpError(cause)) return json({ error: cause.body.message }, { status: cause.status });
    if (cause instanceof ProjectNotFoundError) {
      return json({ error: cause.message }, { status: 404 });
    }
    if (
      cause instanceof ProjectConflictError ||
      (cause instanceof Error && cause.name === 'ProjectConflictError')
    ) {
      return json({ error: cause.message }, { status: 409 });
    }
    return json(
      { error: cause instanceof Error ? cause.message : 'Presentation generation failed.' },
      { status: 422 }
    );
  }
};
