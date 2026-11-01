import { fail, redirect } from '@sveltejs/kit';

import { requirePrincipal } from '$lib/server/authorization';
import {
  continueParticipantStudy,
  participantCompletionGiftCardUrl,
  participantStudyState
} from '$lib/server/study';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const principal = requirePrincipal(locals);
  if (principal.kind === 'admin') redirect(303, '/');
  const state = await participantStudyState(principal.user.id);
  if (state.phase.kind === 'task' && state.projectId && !state.expired) {
    redirect(303, `/projects/${state.projectId}`);
  }
  return {
    state,
    interactionParticipantId: principal.user.id,
    giftCardUrl:
      state.phase.kind === 'completion'
        ? await participantCompletionGiftCardUrl(principal.user.id)
        : undefined
  };
};

export const actions: Actions = {
  continue: async ({ locals, request }) => {
    const principal = requirePrincipal(locals);
    if (principal.kind === 'admin') redirect(303, '/');
    const phaseId = (await request.formData()).get('phaseId');
    let state;
    try {
      state = await continueParticipantStudy(principal.user.id, {
        ...(typeof phaseId === 'string' ? { phaseId } : {})
      });
    } catch (cause) {
      return fail(409, {
        error: cause instanceof Error ? cause.message : 'The study could not continue.'
      });
    }
    // A redirect, so reloading the page shows the phase rather than sending the form again.
    redirect(
      303,
      state.phase.kind === 'task' && state.projectId ? `/projects/${state.projectId}` : '/study'
    );
  },
  early: async ({ locals, request }) => {
    const principal = requirePrincipal(locals);
    if (principal.kind === 'admin') redirect(303, '/');
    const phaseId = (await request.formData()).get('phaseId');
    let destination: string;
    try {
      const state = await continueParticipantStudy(principal.user.id, {
        early: true,
        ...(typeof phaseId === 'string' ? { phaseId } : {})
      });
      destination =
        state.phase.kind === 'task' && state.projectId ? `/projects/${state.projectId}` : '/study';
    } catch (cause) {
      return fail(409, {
        error: cause instanceof Error ? cause.message : 'The task could not finish early.'
      });
    }
    redirect(303, destination);
  }
};
