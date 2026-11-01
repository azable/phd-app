import { fail, redirect } from '@sveltejs/kit';
import { and, inArray, isNull } from 'drizzle-orm';

import { requireAdmin } from '$lib/server/authorization';
import { database } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import {
  createParticipant,
  listParticipants,
  resetParticipantPassword,
  setParticipantGiftCardUrl,
  setParticipantEnabled
} from '$lib/server/participants';
import { projectRepository } from '$lib/server/projects/repository';
import {
  purgeAllProjects,
  purgeParticipantResearchData,
  purgeStudyResearchData
} from '$lib/server/research-data-lifecycle';
import { createStudyPreview, listStudyPreviews } from '$lib/server/study';
import { registeredStudies } from '$lib/shared/study/registry';
import { projectStudyFlow } from '$lib/shared/study/projection';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const principal = requireAdmin(locals);
  const [participants, allProjects, previews] = await Promise.all([
    listParticipants(),
    projectRepository.list(),
    listStudyPreviews(principal.user.id)
  ]);
  const participantProjectRows = participants.length
    ? await database()
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(
          and(
            inArray(
              schema.projects.ownerUserId,
              participants.map(({ id }) => id)
            ),
            isNull(schema.projects.deletedAt)
          )
        )
    : [];
  const participantProjectIds = new Set(participantProjectRows.map(({ id }) => id));
  return {
    studies: registeredStudies().map(({ definition, enrollment }) => {
      const enrolled = participants.filter(
        ({ studyId, studyVersion }) =>
          studyId === definition.id && studyVersion === definition.version
      );
      return {
        definition,
        enrollment,
        flow: projectStudyFlow(
          definition,
          {
            id: `configured:${definition.id}:${definition.version}`,
            kind: 'participant',
            studyId: definition.id,
            studyVersion: definition.version,
            armId: definition.assignment.tieBreakOrder[0]!,
            currentPhaseIndex: 0,
            startPhaseIndex: 0
          },
          []
        ),
        participantCount: enrolled.length,
        armCounts: Object.fromEntries(
          Object.keys(definition.arms).map((armId) => [
            armId,
            enrolled.filter((participant) => participant.armId === armId).length
          ])
        ),
        previews: previews.filter(
          ({ studyId, studyVersion }) =>
            studyId === definition.id && studyVersion === definition.version
        )
      };
    }),
    allProjects: allProjects
      .filter(({ projectId }) => !participantProjectIds.has(projectId))
      .map((project) => ({
        ...project,
        ownerLabel: principal.user.name ?? 'Administrator'
      })),
    participants
  };
};

export const actions: Actions = {
  createPreview: async ({ locals, request }) => {
    const principal = requireAdmin(locals);
    let destination: string;
    try {
      const form = await request.formData();
      const studyId = String(form.get('studyId') ?? '');
      const studyVersion = Number(form.get('studyVersion'));
      const phaseId = String(form.get('phaseId') ?? '').trim() || undefined;
      const state = await createStudyPreview({
        ownerUserId: principal.user.id,
        ref: { id: studyId, version: studyVersion },
        armId: String(form.get('armId') ?? ''),
        ...(phaseId ? { phaseId } : {})
      });
      destination =
        state.phase.kind === 'task' && state.projectId
          ? `/projects/${encodeURIComponent(state.projectId)}`
          : `/admin/previews/${state.runId}`;
    } catch (cause) {
      return fail(400, {
        error: cause instanceof Error ? cause.message : 'Study preview creation failed.'
      });
    }
    redirect(303, destination);
  },
  create: async ({ locals, request }) => {
    requireAdmin(locals);
    try {
      const form = await request.formData();
      const credentials = await createParticipant(
        String(form.get('participantId') ?? ''),
        {
          id: String(form.get('studyId') ?? ''),
          version: Number(form.get('studyVersion'))
        },
        request.headers
      );
      return {
        participantId: credentials.participantId,
        participantPassword: credentials.password
      };
    } catch (cause) {
      return fail(400, {
        error: cause instanceof Error ? cause.message : 'Participant creation failed.'
      });
    }
  },
  password: async ({ locals, request }) => {
    requireAdmin(locals);
    try {
      const form = await request.formData();
      const credentials = await resetParticipantPassword(
        String(form.get('id') ?? ''),
        request.headers
      );
      return {
        participantId: credentials.participantId,
        participantPassword: credentials.password
      };
    } catch (cause) {
      return fail(400, {
        error: cause instanceof Error ? cause.message : 'Password reset failed.'
      });
    }
  },
  access: async ({ locals, request }) => {
    requireAdmin(locals);
    try {
      const form = await request.formData();
      await setParticipantEnabled(
        String(form.get('id') ?? ''),
        String(form.get('enabled')) === 'true',
        request.headers
      );
      return { accessUpdated: true };
    } catch (cause) {
      return fail(400, { error: cause instanceof Error ? cause.message : 'Access update failed.' });
    }
  },
  giftCard: async ({ locals, request }) => {
    requireAdmin(locals);
    try {
      const form = await request.formData();
      const userId = String(form.get('id') ?? '');
      const giftCardUrl =
        form.get('clearGiftCard') === 'true' ? '' : String(form.get('giftCardUrl') ?? '');
      await setParticipantGiftCardUrl(userId, giftCardUrl);
      return { giftCardUpdated: userId };
    } catch (cause) {
      return fail(400, {
        error: cause instanceof Error ? cause.message : 'Gift-card update failed.'
      });
    }
  },
  purgeParticipant: async ({ locals, request }) => {
    requireAdmin(locals);
    try {
      const form = await request.formData();
      const userId = String(form.get('id') ?? '');
      const participantId = await purgeParticipantResearchData(
        userId,
        String(form.get('confirmation') ?? ''),
        request.headers
      );
      return { participantPurged: participantId };
    } catch (cause) {
      return fail(409, {
        error: cause instanceof Error ? cause.message : 'Participant deletion failed.'
      });
    }
  },
  purgeStudy: async ({ locals, request }) => {
    requireAdmin(locals);
    try {
      const form = await request.formData();
      if (form.get('confirmation') !== 'DELETE STUDY DATA') {
        return fail(400, { error: 'Enter DELETE STUDY DATA to confirm the purge.' });
      }
      const participantsPurged = await purgeStudyResearchData(request.headers);
      return { studyPurged: true, participantsPurged };
    } catch (cause) {
      return fail(409, { error: cause instanceof Error ? cause.message : 'Study purge failed.' });
    }
  },
  purgeProjects: async ({ locals, request }) => {
    requireAdmin(locals);
    try {
      const form = await request.formData();
      const projectsPurged = await purgeAllProjects(String(form.get('confirmation') ?? ''));
      return { projectsPurged };
    } catch (cause) {
      return fail(409, {
        error: cause instanceof Error ? cause.message : 'Deleting the projects failed.'
      });
    }
  }
};
