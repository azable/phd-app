import { isHttpError, json } from '@sveltejs/kit';

import { InvalidProjectDocumentError } from '$lib/shared/projects/events';
import { parseProjectCommand } from '$lib/shared/projects/model';
import {
  projectListOwner,
  requireAdmin,
  requireProjectAccess,
  requireProjectMutationAccess
} from '$lib/server/authorization';
import { withDevChooser } from '$lib/server/projects/chooser-config';
import { projectOperationExecutor } from '$lib/server/projects/operations';
import { ProjectConflictError, ProjectNotFoundError } from '$lib/server/projects/repository';
import { loadProjectResource } from '$lib/server/projects/service';

import type { RequestHandler } from './$types';

/** Load the complete project resource; historical views are projected by consumers. */
export const GET: RequestHandler = async ({ params, locals }) => {
  try {
    const principal = requireAdmin(locals);
    await requireProjectAccess(locals, params.projectId);
    return json(await loadProjectResource(params.projectId, projectListOwner(principal)));
  } catch (cause) {
    return projectError(cause);
  }
};

/** Validate and execute one optimistic-concurrency project command. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
  try {
    const inspection = await requireProjectMutationAccess(locals, params.projectId);
    const command = withDevChooser(
      parseProjectCommand(await request.json()),
      inspection.principal.kind === 'admin'
    );
    const accepted = await projectOperationExecutor.accept({
      projectId: params.projectId,
      operationId: command.operationId,
      expectedHead: command.expectedHead,
      command,
      ...(inspection.study?.deadlineAt ? { deadlineAt: inspection.study.deadlineAt } : {})
    });
    return json(accepted, { status: 202 });
  } catch (cause) {
    return projectError(cause);
  }
};

function projectError(cause: unknown) {
  if (isHttpError(cause)) {
    return json({ error: cause.body.message }, { status: cause.status });
  }
  if (cause instanceof ProjectNotFoundError) return json({ error: cause.message }, { status: 404 });
  if (
    cause instanceof ProjectConflictError ||
    (cause instanceof Error && cause.name === 'ProjectConflictError')
  ) {
    return json({ error: cause.message }, { status: 409 });
  }
  if (cause instanceof InvalidProjectDocumentError || cause instanceof SyntaxError) {
    return json({ error: cause.message }, { status: 400 });
  }
  return json(
    { error: cause instanceof Error ? cause.message : 'Project operation failed.' },
    { status: 422 }
  );
}
