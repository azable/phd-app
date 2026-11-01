/** Explicitly confirmed participant-data lifecycle operations, separate from read-only exports. */

import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { auth } from '$lib/server/auth';
import { database } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { assertNoActiveProjectOperations } from '$lib/server/projects/repository';
import { setParticipantEnabled } from '$lib/server/participants';

export async function purgeParticipantResearchData(
  userId: string,
  confirmation: string,
  headers: Headers
): Promise<string> {
  const participant = await participantIdentity(userId);
  const expected = participantPurgeConfirmation(participant.participantId);
  if (confirmation !== expected) {
    throw new Error(`Enter ${expected} to confirm participant deletion.`);
  }
  await purgeParticipant(participant, headers);
  return participant.participantId;
}

export async function purgeStudyResearchData(headers: Headers): Promise<number> {
  await assertNoActiveProjectOperations();
  const participants = await database()
    .select({ id: schema.user.id, name: schema.user.name, username: schema.user.username })
    .from(schema.user)
    .where(and(eq(schema.user.role, 'user'), isNotNull(schema.user.username)));
  for (const participant of participants) {
    await purgeParticipant(
      {
        id: participant.id,
        participantId: participant.name || participant.username || participant.id
      },
      headers
    );
  }
  return participants.length;
}

/** What an administrator types to delete every project. */
export const allProjectsPurgeConfirmation = 'DELETE ALL PROJECTS';

/**
 * Delete every project, whoever owns it, with its events and interaction sessions (cascaded);
 * accounts and study runs stay, a study phase run losing only its project.
 */
export async function purgeAllProjects(confirmation: string): Promise<number> {
  if (confirmation !== allProjectsPurgeConfirmation) {
    throw new Error(`Enter ${allProjectsPurgeConfirmation} to confirm deleting every project.`);
  }
  await assertNoActiveProjectOperations();
  const deleted = await database().delete(schema.projects).returning({ id: schema.projects.id });
  return deleted.length;
}

export function participantPurgeConfirmation(participantId: string): string {
  return `DELETE ${participantId}`;
}

async function participantIdentity(userId: string): Promise<{ id: string; participantId: string }> {
  const [row] = await database()
    .select({ id: schema.user.id, name: schema.user.name, username: schema.user.username })
    .from(schema.user)
    .where(
      and(eq(schema.user.id, userId), eq(schema.user.role, 'user'), isNotNull(schema.user.username))
    )
    .limit(1);
  if (!row) throw new Error('Participant not found.');
  return { id: row.id, participantId: row.name || row.username || row.id };
}

async function purgeParticipant(
  participant: { id: string; participantId: string },
  headers: Headers
): Promise<void> {
  await setParticipantEnabled(participant.id, false, headers);
  await assertNoActiveProjectOperations(participant.id);
  const projectIds = await database()
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.ownerUserId, participant.id));
  if (projectIds.length) {
    await database()
      .delete(schema.projects)
      .where(
        inArray(
          schema.projects.id,
          projectIds.map(({ id }) => id)
        )
      );
  }
  await auth.api.removeUser({ headers, body: { userId: participant.id } });
}
