/** Isolated ingestion for best-effort participant workspace observations. */

import { and, eq, sql } from 'drizzle-orm';

import type { ParticipantPrincipal } from '$lib/server/auth';
import { database } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import type {
  StudyInteractionBatchInput,
  StudyInteractionCapturePolicy,
  StudyInteractionErrorCode,
  StudyInteractionIngestionResult
} from '$lib/shared/study/interactions';
import { studyDefinition } from '$lib/shared/study/registry';

// Normal clients flush every five seconds; thirty batches leave headroom for reconnect drains.
const batchRateWindowMs = 60_000;
const batchRateLimit = 30;
// How far a participant's clock may be from the server's: laptops drift by seconds, and a pilot
// participant's ran 7 s behind, so a 5 s allowance refused a task page that loaded promptly and lost its
// capture. Collection stays bounded by the recorder stopping at the deadline and by the delivery
// window, both in server time; analysis places events by the phase's server times.
const clientClockToleranceMs = 120_000;

type RateWindow = { startedAt: number; count: number };
const rateWindows = new Map<string, RateWindow>();

export class StudyInteractionIngestionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409 | 410 | 429 = 400,
    readonly code: StudyInteractionErrorCode = 'invalid-batch',
    readonly details: {
      acceptedThrough?: number;
      requiredNext?: number;
      invalidEventIndex?: number;
    } = {}
  ) {
    super(message);
    this.name = 'StudyInteractionIngestionError';
  }
}

/** Process-local guard supplementing strict body and batch limits. */
export function consumeStudyInteractionBatchAllowance(userId: string, now = Date.now()): boolean {
  const current = rateWindows.get(userId);
  if (!current || now - current.startedAt >= batchRateWindowMs) {
    rateWindows.set(userId, { startedAt: now, count: 1 });
    pruneRateWindows(now);
    return true;
  }
  if (current.count >= batchRateLimit) return false;
  current.count += 1;
  return true;
}

/** Clear process-local rate state in deterministic tests. */
export function resetStudyInteractionRateLimits(): void {
  rateWindows.clear();
}

/** Accept one contiguous idempotent batch without touching project events or locks. */
export async function ingestStudyInteractions(
  principal: ParticipantPrincipal,
  batch: StudyInteractionBatchInput,
  now = new Date()
): Promise<StudyInteractionIngestionResult> {
  assertContiguousBatch(batch);
  const result = await database().transaction(async (transaction) => {
    let [stored] = await transaction
      .select()
      .from(schema.projectInteractionSessions)
      .where(eq(schema.projectInteractionSessions.id, batch.session.id))
      .limit(1);

    if (!stored) {
      const association = await projectAssociation(transaction, batch.session.projectId);
      const policy = association
        ? studyDefinition(association.studyId, association.studyVersion).interactionCapture
        : undefined;
      if (
        !association ||
        association.projectDeletedAt ||
        association.kind !== 'participant' ||
        association.ownerUserId !== principal.user.id ||
        !association.deadlineAt ||
        !policy
      ) {
        throw new StudyInteractionIngestionError(
          'Interaction recording is unavailable for this study phase.',
          403,
          'capture-unavailable'
        );
      }
      const captureEnd = association.endedAt ?? association.deadlineAt;
      if (now.getTime() > captureEnd.getTime() + policy.lateDeliverySeconds * 1_000) {
        throw new StudyInteractionIngestionError(
          'The interaction delivery window has closed.',
          410,
          'delivery-window-closed'
        );
      }
      const clientStartedAt = new Date(batch.session.clientStartedAt);
      if (!sameCapturePolicy(batch.session.capture, policy)) {
        throw new StudyInteractionIngestionError(
          'The interaction capture policy has changed.',
          409,
          'capture-policy-mismatch'
        );
      }
      if (
        !association.startedAt ||
        clientStartedAt.getTime() < association.startedAt.getTime() - clientClockToleranceMs ||
        clientStartedAt.getTime() > captureEnd.getTime() + clientClockToleranceMs
      ) {
        throw new StudyInteractionIngestionError(
          'The interaction session falls outside the study phase.',
          410,
          'session-outside-phase'
        );
      }
      assertWithinCaptureWindow(clientStartedAt, captureEnd, batch.events);
      await transaction
        .insert(schema.projectInteractionSessions)
        .values({
          id: batch.session.id,
          projectId: batch.session.projectId,
          schemaVersion: batch.session.schemaVersion,
          clientStartedAt: new Date(batch.session.clientStartedAt),
          clientTimeOrigin: batch.session.timeOrigin,
          initialViewport: batch.session.initialViewport,
          applicationVersion: batch.session.applicationVersion,
          buildSha: batch.session.buildSha,
          capture: batch.session.capture
        })
        .onConflictDoNothing({ target: schema.projectInteractionSessions.id });
    }

    await transaction.execute(
      sql`select id from project_interaction_session where id = ${batch.session.id} for update`
    );
    [stored] = await transaction
      .select()
      .from(schema.projectInteractionSessions)
      .where(eq(schema.projectInteractionSessions.id, batch.session.id))
      .limit(1);
    if (!stored) {
      throw new StudyInteractionIngestionError(
        'The interaction session could not be created.',
        409,
        'invalid-session'
      );
    }

    const association = await projectAssociation(transaction, stored.projectId);
    if (
      !association ||
      association.projectDeletedAt ||
      association.kind !== 'participant' ||
      association.ownerUserId !== principal.user.id ||
      stored.projectId !== batch.session.projectId
    ) {
      throw new StudyInteractionIngestionError(
        'Interaction session access was rejected.',
        403,
        'capture-unavailable'
      );
    }
    if (!sameSessionMetadata(stored, batch.session)) {
      throw new StudyInteractionIngestionError(
        'The interaction session metadata conflicts with its stored value.',
        409,
        'invalid-session'
      );
    }

    const captureEnd = association.endedAt ?? association.deadlineAt;
    if (!captureEnd) {
      throw new StudyInteractionIngestionError(
        'The study phase has no capture boundary.',
        409,
        'capture-unavailable'
      );
    }
    const deliveryEndsAt = captureEnd.getTime() + stored.capture.lateDeliverySeconds * 1_000;
    if (now.getTime() > deliveryEndsAt) {
      throw new StudyInteractionIngestionError(
        'The interaction delivery window has closed.',
        410,
        'delivery-window-closed'
      );
    }

    const terminal = reconcileTerminal(stored, batch, captureEnd);
    const pending = batch.events.filter(({ sequence }) => sequence > stored.acceptedThrough);
    if (pending.length && pending[0]?.sequence !== stored.acceptedThrough + 1) {
      const requiredNext = stored.acceptedThrough + 1;
      throw new StudyInteractionIngestionError(
        `Interaction sequence ${requiredNext} is required next.`,
        409,
        'sequence-conflict',
        { acceptedThrough: stored.acceptedThrough, requiredNext }
      );
    }
    assertWithinCaptureWindow(stored.clientStartedAt, captureEnd, pending);
    if (pending.some((event) => event.projectHead > association.projectHead)) {
      throw new StudyInteractionIngestionError(
        'An interaction references a future project Timeline head.',
        409,
        'future-project-head'
      );
    }
    if (terminal && pending.at(-1) && pending.at(-1)!.sequence > terminal.recordedThrough) {
      throw new StudyInteractionIngestionError(
        'Interaction records extend beyond the session terminal sequence.',
        409,
        'terminal-conflict'
      );
    }

    if (pending.length) {
      await transaction.insert(schema.projectInteractionEvents).values(
        pending.map((event) => ({
          sessionId: stored.id,
          sequence: event.sequence,
          kind: event.kind,
          elapsedMs: event.elapsedMs,
          clientOccurredAt: new Date(event.clientOccurredAt),
          projectHead: event.projectHead,
          payload: event.payload,
          receivedAt: now
        }))
      );
    }
    const acceptedThrough = pending.at(-1)?.sequence ?? stored.acceptedThrough;
    if (terminal && acceptedThrough > terminal.recordedThrough) {
      throw new StudyInteractionIngestionError(
        'The terminal sequence precedes records already accepted by the server.',
        409,
        'terminal-conflict'
      );
    }
    const deliveryComplete = terminal?.recordedThrough === acceptedThrough;
    await transaction
      .update(schema.projectInteractionSessions)
      .set({
        acceptedThrough,
        ...(terminal
          ? {
              clientStoppedAt: terminal.clientStoppedAt,
              recordedThrough: terminal.recordedThrough,
              deliveryCompletedAt: deliveryComplete ? (stored.deliveryCompletedAt ?? now) : null
            }
          : {}),
        updatedAt: now
      })
      .where(eq(schema.projectInteractionSessions.id, stored.id));
    return {
      acceptedThrough,
      serverReceivedAt: now.toISOString(),
      terminalAccepted: terminal !== undefined,
      deliveryComplete
    };
  });
  return result;
}

function assertContiguousBatch(batch: StudyInteractionBatchInput): void {
  for (let index = 1; index < batch.events.length; index += 1) {
    if (batch.events[index]!.sequence !== batch.events[index - 1]!.sequence + 1) {
      throw new StudyInteractionIngestionError(
        'Interaction batches must be contiguous.',
        409,
        'sequence-conflict'
      );
    }
  }
}

function assertWithinCaptureWindow(
  clientStartedAt: Date,
  captureEnd: Date,
  events: StudyInteractionBatchInput['events']
): void {
  const maximumElapsed =
    Math.max(0, captureEnd.getTime() - clientStartedAt.getTime()) + clientClockToleranceMs;
  const earliest = clientStartedAt.getTime() - clientClockToleranceMs;
  const latest = captureEnd.getTime() + clientClockToleranceMs;
  for (const event of events) {
    const occurredAt = new Date(event.clientOccurredAt).getTime();
    if (event.elapsedMs > maximumElapsed || occurredAt < earliest || occurredAt > latest) {
      throw new StudyInteractionIngestionError(
        'An interaction falls outside the study phase capture window.',
        410,
        'delivery-window-closed'
      );
    }
  }
}

function reconcileTerminal(
  stored: typeof schema.projectInteractionSessions.$inferSelect,
  batch: StudyInteractionBatchInput,
  captureEnd: Date
): { clientStoppedAt: Date; recordedThrough: number } | undefined {
  const supplied = batch.terminal;
  const existing =
    stored.clientStoppedAt && stored.recordedThrough !== null
      ? {
          clientStoppedAt: stored.clientStoppedAt,
          recordedThrough: stored.recordedThrough
        }
      : undefined;
  if (!supplied) return existing;
  const clientStoppedAt = new Date(supplied.clientStoppedAt);
  const earliest = stored.clientStartedAt.getTime() - clientClockToleranceMs;
  const latest = captureEnd.getTime() + clientClockToleranceMs;
  if (clientStoppedAt.getTime() < earliest || clientStoppedAt.getTime() > latest) {
    throw new StudyInteractionIngestionError(
      'The terminal timestamp falls outside the study phase.',
      410,
      'delivery-window-closed'
    );
  }
  if (
    existing &&
    (existing.clientStoppedAt.getTime() !== clientStoppedAt.getTime() ||
      existing.recordedThrough !== supplied.recordedThrough)
  ) {
    throw new StudyInteractionIngestionError(
      'The interaction session terminal metadata conflicts with its stored value.',
      409,
      'terminal-conflict'
    );
  }
  return existing ?? { clientStoppedAt, recordedThrough: supplied.recordedThrough };
}

async function projectAssociation(
  transaction: Parameters<Parameters<ReturnType<typeof database>['transaction']>[0]>[0],
  projectId: string
) {
  const [row] = await transaction
    .select({
      kind: schema.studyRuns.kind,
      ownerUserId: schema.studyRuns.ownerUserId,
      studyId: schema.studyRuns.studyId,
      studyVersion: schema.studyRuns.studyVersion,
      deadlineAt: schema.studyPhaseRuns.deadlineAt,
      startedAt: schema.studyPhaseRuns.startedAt,
      endedAt: schema.studyPhaseRuns.endedAt,
      projectHead: schema.projects.head,
      projectDeletedAt: schema.projects.deletedAt
    })
    .from(schema.studyPhaseRuns)
    .innerJoin(schema.studyRuns, eq(schema.studyRuns.id, schema.studyPhaseRuns.runId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.studyPhaseRuns.projectId))
    .where(
      and(eq(schema.studyPhaseRuns.projectId, projectId), eq(schema.studyPhaseRuns.kind, 'task'))
    )
    .limit(1);
  return row;
}

function sameCapturePolicy(
  left: StudyInteractionCapturePolicy,
  right: StudyInteractionCapturePolicy
): boolean {
  const keys: Array<keyof StudyInteractionCapturePolicy> = [
    'schemaVersion',
    'cursorSampleIntervalMs',
    'cursorChunkDurationMs',
    'flushIntervalMs',
    'flushRecordThreshold',
    'flushByteThreshold',
    'checkpointIntervalMs',
    'draftSnapshotIntervalMs',
    'outboxByteLimit',
    'lateDeliverySeconds'
  ];
  return keys.every((key) => left[key] === right[key]);
}

function sameSessionMetadata(
  stored: typeof schema.projectInteractionSessions.$inferSelect,
  supplied: StudyInteractionBatchInput['session']
): boolean {
  return (
    stored.schemaVersion === supplied.schemaVersion &&
    stored.clientStartedAt.getTime() === new Date(supplied.clientStartedAt).getTime() &&
    stored.clientTimeOrigin === supplied.timeOrigin &&
    stored.initialViewport.width === supplied.initialViewport.width &&
    stored.initialViewport.height === supplied.initialViewport.height &&
    stored.initialViewport.devicePixelRatio === supplied.initialViewport.devicePixelRatio &&
    stored.applicationVersion === supplied.applicationVersion &&
    (stored.buildSha ?? undefined) === supplied.buildSha &&
    sameCapturePolicy(stored.capture, supplied.capture)
  );
}

function pruneRateWindows(now: number): void {
  if (rateWindows.size < 1_000) return;
  for (const [userId, window] of rateWindows) {
    if (now - window.startedAt >= batchRateWindowMs) rateWindows.delete(userId);
  }
}
