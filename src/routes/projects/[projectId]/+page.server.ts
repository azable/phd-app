import { error, fail, redirect } from '@sveltejs/kit';

import { projectInspectionContext, requireAdmin } from '$lib/server/authorization';
import { buildSha } from '$lib/server/runtime-config';
import { listProjectTemplates } from '$lib/server/projects/starter-catalog';
import { forceStudyPreview, projectTrialCondition, studyRunState } from '$lib/server/study';

import type { Actions, PageServerLoad } from './$types';

/** Supply authorized study context and immutable project-template metadata. */
export const load: PageServerLoad = async ({ locals, params }) => {
  const inspection = await projectInspectionContext(locals, params.projectId);
  const { principal } = inspection;
  let study;
  if (inspection.study) {
    const state = await studyRunState(inspection.study.runId);
    const flowPhase = state.flow.phases.find(({ phase }) => phase.id === inspection.study?.phaseId);
    if (flowPhase?.phase.kind === 'task') {
      const task = {
        runId: state.runId,
        phaseId: flowPhase.phase.id,
        title: flowPhase.phase.instructions.title,
        prompt: flowPhase.phase.instructions.prompt,
        expired: flowPhase.status === 'ready-to-continue' || flowPhase.status === 'completed',
        layout: flowPhase.phase.condition.workspace.layout,
        presentationBufferTarget: flowPhase.phase.condition.presentationBufferTarget
      };
      study =
        state.kind === 'preview'
          ? {
              ...task,
              context: 'admin-preview' as const,
              deadlineAt: flowPhase.deadlineAt!,
              allowEarlyCompletion: false as const
            }
          : {
              ...task,
              context: 'participant' as const,
              participantId: inspection.ownerUserId,
              deadlineAt: flowPhase.deadlineAt,
              allowEarlyCompletion: !!flowPhase.phase.allowEarlyCompletion,
              ...(inspection.study.interactionCapture && !inspection.readOnly
                ? {
                    interactionCapture: inspection.study.interactionCapture,
                    applicationVersion: process.env.npm_package_version ?? '0.0.1',
                    buildSha: buildSha()
                  }
                : {})
            };
    }
  }
  const trial = await projectTrialCondition(params.projectId, inspection.study);
  return {
    authEnabled: true,
    isAdmin: principal.kind === 'admin',
    readOnly: inspection.readOnly,
    templates: principal.kind === 'admin' && !inspection.readOnly ? listProjectTemplates() : [],
    study,
    ...(trial
      ? {
          trial: {
            layout: trial.workspace.layout,
            ...(trial.presentationBufferTarget
              ? { presentationBufferTarget: trial.presentationBufferTarget }
              : {})
          }
        }
      : {})
  };
};

export const actions: Actions = {
  forcePreview: async ({ locals, params }) => {
    const principal = requireAdmin(locals);
    const inspection = await projectInspectionContext(locals, params.projectId);
    if (inspection.study?.kind !== 'preview') error(404, 'Preview run not found.');
    let destination: string;
    try {
      const state = await forceStudyPreview(inspection.study.runId, principal.user.id);
      destination =
        !state.completed && state.phase.kind === 'task' && state.projectId
          ? `/projects/${encodeURIComponent(state.projectId)}`
          : `/admin/previews/${state.runId}`;
    } catch (cause) {
      return fail(409, {
        error: cause instanceof Error ? cause.message : 'The preview could not advance.'
      });
    }
    redirect(303, destination);
  }
};
