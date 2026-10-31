/** Durable, retry-safe orchestration for registered participant studies and admin previews. */

import { createHash, randomUUID } from 'node:crypto';

import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

import type { ParticipantPrincipal } from '$lib/server/auth';
import { database, sqlClient } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { projectRepository, ProjectNotFoundError } from '$lib/server/projects/repository';
import { createProject, buildProjectPresentations } from '$lib/server/projects/service';
import { projectSnapshotAt } from '$lib/shared/projects/projection';
import { resolveStudyArm, type ResolvedStudyPhase } from '$lib/shared/study/definition';
import type { StudyInteractionCapturePolicy } from '$lib/shared/study/interactions';
import type { ChooserId } from '$lib/shared/choosers';
import {
  projectStudyFlow,
  type StudyFlow,
  type StudyPhaseEndReason,
  type StudyPhaseRunSnapshot,
  type StudyRunKind,
  type StudyRunSnapshot
} from '$lib/shared/study/projection';
import { studyDefinition, studyRegistration, type StudyRef } from '$lib/shared/study/registry';

type StudyRunRow = typeof schema.studyRuns.$inferSelect;
type StudyPhaseRunRow = typeof schema.studyPhaseRuns.$inferSelect;

export type StudyRunState = {
  runId: string;
  kind: StudyRunKind;
  studyId: string;
  studyVersion: number;
  armId: string;
  phaseIndex: number;
  phase: ResolvedStudyPhase;
  projectId?: string;
  startedAt?: string;
  deadlineAt?: string;
  expired: boolean;
  completed: boolean;
  flow: StudyFlow;
};

export type StudyProjectContext = {
  runId: string;
  kind: StudyRunKind;
  ownerUserId: string;
  phaseId: string;
  sequenceIndex: number;
  isCurrent: boolean;
  active: boolean;
  expired: boolean;
  deadlineAt?: string;
  presentationBufferTarget?: number;
  chooser?: ChooserId;
  interactionCapture?: StudyInteractionCapturePolicy;
  layout?: string;
  view?: string;
};

/** Assign a newly provisioned participant to the smaller arm of an exact open version. */
export async function enrollParticipant(userId: string, ref: StudyRef): Promise<string> {
  const registration = studyRegistration(ref);
  if (registration.enrollment !== 'open') {
    throw new Error(`${registration.definition.name} version ${ref.version} is closed.`);
  }
  return database().transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`study-enrollment:${userId}`}, 1))`
    );
    const [existing] = await transaction
      .select({ runId: schema.studyEnrollments.runId })
      .from(schema.studyEnrollments)
      .where(eq(schema.studyEnrollments.userId, userId))
      .limit(1);
    if (existing) return existing.runId;

    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${ref.id}, ${ref.version}))`
    );
    const totals = await transaction
      .select({ armId: schema.studyRuns.armId, total: count() })
      .from(schema.studyRuns)
      .where(
        and(
          eq(schema.studyRuns.kind, 'participant'),
          eq(schema.studyRuns.studyId, ref.id),
          eq(schema.studyRuns.studyVersion, ref.version)
        )
      )
      .groupBy(schema.studyRuns.armId);
    const byArm = new Map(totals.map(({ armId, total }) => [armId, total]));
    const armId = registration.definition.assignment.tieBreakOrder.reduce((selected, candidate) =>
      (byArm.get(candidate) ?? 0) < (byArm.get(selected) ?? 0) ? candidate : selected
    );
    const [run] = await transaction
      .insert(schema.studyRuns)
      .values({
        kind: 'participant',
        ownerUserId: userId,
        studyId: ref.id,
        studyVersion: ref.version,
        armId
      })
      .returning({ id: schema.studyRuns.id });
    if (!run) throw new Error('The participant study run could not be created.');
    await transaction.insert(schema.studyEnrollments).values({ userId, runId: run.id });
    return run.id;
  });
}

/** Return the participant's current phase from the exact assigned protocol version. */
export async function participantStudyState(userId: string): Promise<StudyRunState> {
  const [enrollment] = await database()
    .select({ runId: schema.studyEnrollments.runId })
    .from(schema.studyEnrollments)
    .where(eq(schema.studyEnrollments.userId, userId))
    .limit(1);
  if (!enrollment) throw new Error('The participant is not assigned to a study.');
  return loadStudyRunState(enrollment.runId);
}

/** Return a run's complete flow projection. */
export async function studyRunState(runId: string): Promise<StudyRunState> {
  return loadStudyRunState(runId);
}

/** Load several complete run projections with one run query and one phase query. */
export async function studyRunStates(runIds: readonly string[]): Promise<StudyRunState[]> {
  if (!runIds.length) return [];
  const [runs, phaseRows] = await Promise.all([
    database()
      .select()
      .from(schema.studyRuns)
      .where(inArray(schema.studyRuns.id, [...runIds])),
    database()
      .select()
      .from(schema.studyPhaseRuns)
      .where(inArray(schema.studyPhaseRuns.runId, [...runIds]))
      .orderBy(asc(schema.studyPhaseRuns.runId), asc(schema.studyPhaseRuns.sequenceIndex))
  ]);
  const byId = new Map(runs.map((run) => [run.id, run]));
  return runIds.map((runId) => {
    const run = byId.get(runId);
    if (!run) throw new Error('Study run not found.');
    return stateFromRows(
      run,
      phaseRows.filter((phaseRun) => phaseRun.runId === runId)
    );
  });
}

/** Reveal the configured gift card only after the participant run is complete. */
export async function participantCompletionGiftCardUrl(
  userId: string
): Promise<string | undefined> {
  const [row] = await database()
    .select({
      giftCardUrl: schema.studyEnrollments.giftCardUrl,
      completedAt: schema.studyRuns.completedAt
    })
    .from(schema.studyEnrollments)
    .innerJoin(schema.studyRuns, eq(schema.studyRuns.id, schema.studyEnrollments.runId))
    .where(eq(schema.studyEnrollments.userId, userId))
    .limit(1);
  return row?.completedAt ? (row.giftCardUrl ?? undefined) : undefined;
}

/** Advance normally, or explicitly finish an allowed timed task early. */
export async function continueParticipantStudy(
  userId: string,
  options: { early?: boolean } = {}
): Promise<StudyRunState> {
  const state = await participantStudyState(userId);
  return advanceStudyRun(state.runId, userId, options.early ? 'participant-early' : 'continue');
}

/** Create a durable admin-owned preview for a complete flow or one isolated phase. */
export async function createStudyPreview(options: {
  ownerUserId: string;
  ref: StudyRef;
  armId: string;
  phaseId?: string;
}): Promise<StudyRunState> {
  const definition = studyDefinition(options.ref.id, options.ref.version);
  const phases = resolveStudyArm(definition, options.armId);
  const startPhaseIndex = options.phaseId
    ? phases.findIndex(({ id }) => id === options.phaseId)
    : 0;
  if (startPhaseIndex < 0) throw new Error(`Unknown study phase ${options.phaseId}.`);
  const phase = phases[startPhaseIndex];
  if (!phase) throw new Error('The study preview has no phase to show.');
  const createdAt = new Date();
  const [run] = await database()
    .insert(schema.studyRuns)
    .values({
      kind: 'preview',
      ownerUserId: options.ownerUserId,
      studyId: options.ref.id,
      studyVersion: options.ref.version,
      armId: options.armId,
      currentPhaseIndex: startPhaseIndex,
      startPhaseIndex,
      ...(options.phaseId ? { stopAfterPhaseIndex: startPhaseIndex } : {}),
      ...(phase.kind === 'task' ? {} : { startedAt: createdAt }),
      ...(phase.kind === 'completion' ? { completedAt: createdAt } : {})
    })
    .returning();
  if (!run) throw new Error('The preview run could not be created.');

  try {
    const projectId =
      phase.kind === 'task'
        ? await ensureTaskProject({ run, phase, definitionName: definition.name })
        : undefined;
    const activatedAt = new Date();
    if (phase.kind === 'task') {
      await database()
        .update(schema.studyRuns)
        .set({ startedAt: activatedAt })
        .where(eq(schema.studyRuns.id, run.id));
    }
    await database()
      .insert(schema.studyPhaseRuns)
      .values(
        phase.kind === 'completion'
          ? {
              ...phaseRunValues(run.id, startPhaseIndex, phase, activatedAt, projectId),
              status: 'completed',
              endedAt: activatedAt,
              endReason: 'flow-complete'
            }
          : phaseRunValues(run.id, startPhaseIndex, phase, activatedAt, projectId)
      )
      .onConflictDoNothing();
    return loadStudyRunState(run.id);
  } catch (cause) {
    await database().delete(schema.studyRuns).where(eq(schema.studyRuns.id, run.id));
    throw cause;
  }
}

/** Force a preview past its current phase without changing participant-run timing rules. */
export function forceStudyPreview(runId: string, ownerUserId: string): Promise<StudyRunState> {
  return advanceStudyRun(runId, ownerUserId, 'admin-forced');
}

/** Load a durable preview only for the administrator who created it. */
export async function adminStudyPreviewState(
  runId: string,
  ownerUserId: string
): Promise<StudyRunState> {
  const run = await loadStudyRun(runId);
  if (run.kind !== 'preview' || run.ownerUserId !== ownerUserId) {
    throw new Error('Preview run not found.');
  }
  return loadStudyRunState(runId);
}

/** List durable preview runs newest-first for one administrator. */
export async function listStudyPreviews(ownerUserId: string): Promise<StudyRunState[]> {
  const runs = await database()
    .select({ id: schema.studyRuns.id })
    .from(schema.studyRuns)
    .where(and(eq(schema.studyRuns.kind, 'preview'), eq(schema.studyRuns.ownerUserId, ownerUserId)))
    .orderBy(desc(schema.studyRuns.createdAt));
  return studyRunStates(runs.map(({ id }) => id));
}

/** Find the study execution and phase associated with a project, if any. */
export async function studyProjectContext(
  projectId: string
): Promise<StudyProjectContext | undefined> {
  const [row] = await database()
    .select({
      runId: schema.studyRuns.id,
      kind: schema.studyRuns.kind,
      ownerUserId: schema.studyRuns.ownerUserId,
      currentPhaseIndex: schema.studyRuns.currentPhaseIndex,
      completedAt: schema.studyRuns.completedAt,
      studyId: schema.studyRuns.studyId,
      studyVersion: schema.studyRuns.studyVersion,
      armId: schema.studyRuns.armId,
      phaseId: schema.studyPhaseRuns.phaseId,
      sequenceIndex: schema.studyPhaseRuns.sequenceIndex,
      status: schema.studyPhaseRuns.status,
      deadlineAt: schema.studyPhaseRuns.deadlineAt,
      layout: schema.studyPhaseRuns.layout,
      view: schema.studyPhaseRuns.view
    })
    .from(schema.studyPhaseRuns)
    .innerJoin(schema.studyRuns, eq(schema.studyRuns.id, schema.studyPhaseRuns.runId))
    .where(eq(schema.studyPhaseRuns.projectId, projectId))
    .limit(1);
  if (!row) return undefined;
  const expired = !!row.deadlineAt && row.deadlineAt.getTime() <= Date.now();
  const definition = studyDefinition(row.studyId, row.studyVersion);
  const phase = resolveStudyArm(definition, row.armId).find(({ id }) => id === row.phaseId);
  return {
    runId: row.runId,
    kind: row.kind,
    ownerUserId: row.ownerUserId,
    phaseId: row.phaseId,
    sequenceIndex: row.sequenceIndex,
    isCurrent: row.sequenceIndex === row.currentPhaseIndex,
    active: row.status === 'active' && !row.completedAt,
    expired,
    ...(row.deadlineAt ? { deadlineAt: row.deadlineAt.toISOString() } : {}),
    ...(phase?.kind === 'task' && phase.condition.presentationBufferTarget
      ? { presentationBufferTarget: phase.condition.presentationBufferTarget }
      : {}),
    ...(phase?.kind === 'task' && phase.condition.chooser
      ? { chooser: phase.condition.chooser }
      : {}),
    ...(phase?.kind === 'task' && definition.interactionCapture
      ? { interactionCapture: definition.interactionCapture }
      : {}),
    ...(row.layout ? { layout: row.layout } : {}),
    ...(row.view ? { view: row.view } : {})
  };
}

/** Enforce that participant mutations target only their current live task project. */
export async function assertParticipantStudyMutation(
  principal: ParticipantPrincipal,
  projectId: string
): Promise<void> {
  const context = await studyProjectContext(projectId);
  if (
    !context ||
    context.kind !== 'participant' ||
    context.ownerUserId !== principal.user.id ||
    !context.isCurrent ||
    !context.active ||
    context.expired
  ) {
    throw new StudyReadOnlyError();
  }
}

/** Stable task-project identity used to resume preparation after interrupted requests. */
export function studyTaskProjectId(runId: string, phaseId: string): string {
  const identity = `${runId}:${phaseId}`;
  return `study-${createHash('sha256').update(identity).digest('hex').slice(0, 48)}`;
}

export class StudyReadOnlyError extends Error {
  constructor(message = 'This study phase is read-only.') {
    super(message);
    this.name = 'StudyReadOnlyError';
  }
}

async function advanceStudyRun(
  runId: string,
  ownerUserId: string,
  action: 'continue' | 'participant-early' | 'admin-forced'
): Promise<StudyRunState> {
  return withStudyRunLock(runId, async () => {
    const state = await loadStudyRunState(runId);
    const run = await loadStudyRun(runId);
    if (run.ownerUserId !== ownerUserId) throw new StudyReadOnlyError();
    if (action === 'admin-forced' && run.kind !== 'preview') throw new StudyReadOnlyError();
    if (action !== 'admin-forced' && run.kind !== 'participant') throw new StudyReadOnlyError();
    if (state.completed || state.phase.kind === 'completion') return state;

    if (state.phase.kind === 'task' && action !== 'admin-forced') {
      if (action === 'participant-early') {
        if (!state.phase.allowEarlyCompletion || state.expired) throw new StudyReadOnlyError();
      } else if (!state.expired) {
        return state;
      }
    }

    const definition = studyDefinition(run.studyId, run.studyVersion);
    const phases = resolveStudyArm(definition, run.armId);
    const stopAfter = run.stopAfterPhaseIndex ?? phases.length - 1;
    const completesRun = run.currentPhaseIndex >= stopAfter;
    const nextIndex = run.currentPhaseIndex + 1;
    const nextPhase = completesRun ? undefined : phases[nextIndex];
    if (!completesRun && !nextPhase) throw new Error('The study protocol has no next phase.');

    const transitionAt = new Date();
    const nextProjectId =
      nextPhase?.kind === 'task'
        ? await ensureTaskProject({ run, phase: nextPhase, definitionName: definition.name })
        : undefined;
    const activatedAt = new Date();
    const currentReason = endReason(state, action);

    await database().transaction(async (transaction) => {
      const currentValues = phaseRunValues(
        run.id,
        run.currentPhaseIndex,
        state.phase,
        state.startedAt ? new Date(state.startedAt) : transitionAt,
        state.projectId
      );
      await transaction
        .insert(schema.studyPhaseRuns)
        .values({
          ...currentValues,
          status: 'completed',
          endedAt: transitionAt,
          endReason: currentReason
        })
        .onConflictDoUpdate({
          target: [schema.studyPhaseRuns.runId, schema.studyPhaseRuns.phaseId],
          set: { status: 'completed', endedAt: transitionAt, endReason: currentReason }
        });

      if (nextPhase) {
        const values = phaseRunValues(run.id, nextIndex, nextPhase, activatedAt, nextProjectId);
        await transaction
          .insert(schema.studyPhaseRuns)
          .values(
            nextPhase.kind === 'completion'
              ? {
                  ...values,
                  status: 'completed',
                  endedAt: transitionAt,
                  endReason: 'flow-complete'
                }
              : values
          )
          .onConflictDoNothing();
      }

      await transaction
        .update(schema.studyRuns)
        .set({
          currentPhaseIndex: nextPhase ? nextIndex : run.currentPhaseIndex,
          ...(run.startedAt ? {} : { startedAt: nextPhase ? activatedAt : transitionAt }),
          ...(completesRun || nextPhase?.kind === 'completion' ? { completedAt: transitionAt } : {})
        })
        .where(
          and(
            eq(schema.studyRuns.id, run.id),
            eq(schema.studyRuns.currentPhaseIndex, run.currentPhaseIndex)
          )
        );
    });

    return loadStudyRunState(run.id);
  });
}

function endReason(
  state: StudyRunState,
  action: 'continue' | 'participant-early' | 'admin-forced'
): StudyPhaseEndReason {
  if (action === 'admin-forced') return 'admin-forced';
  if (action === 'participant-early') return 'participant-early';
  return state.phase.kind === 'task' ? 'deadline' : 'continued';
}

async function loadStudyRunState(runId: string): Promise<StudyRunState> {
  const run = await loadStudyRun(runId);
  const phaseRows = await database()
    .select()
    .from(schema.studyPhaseRuns)
    .where(eq(schema.studyPhaseRuns.runId, run.id))
    .orderBy(asc(schema.studyPhaseRuns.sequenceIndex));
  return stateFromRows(run, phaseRows);
}

function stateFromRows(run: StudyRunRow, phaseRows: StudyPhaseRunRow[]): StudyRunState {
  const definition = studyDefinition(run.studyId, run.studyVersion);
  const phases = resolveStudyArm(definition, run.armId);
  const phase = phases[run.currentPhaseIndex];
  if (!phase) throw new Error('The study run points outside its registered flow.');
  const current = phaseRows.find(({ sequenceIndex }) => sequenceIndex === run.currentPhaseIndex);
  const deadlineAt = current?.deadlineAt?.toISOString();
  return {
    runId: run.id,
    kind: run.kind,
    studyId: run.studyId,
    studyVersion: run.studyVersion,
    armId: run.armId,
    phaseIndex: run.currentPhaseIndex,
    phase,
    ...(current?.projectId ? { projectId: current.projectId } : {}),
    ...(current?.startedAt ? { startedAt: current.startedAt.toISOString() } : {}),
    ...(deadlineAt ? { deadlineAt } : {}),
    expired: !!deadlineAt && Date.parse(deadlineAt) <= Date.now(),
    completed: !!run.completedAt,
    flow: projectStudyFlow(definition, runSnapshot(run), phaseRows.map(phaseRunSnapshot))
  };
}

async function loadStudyRun(runId: string): Promise<StudyRunRow> {
  const [run] = await database()
    .select()
    .from(schema.studyRuns)
    .where(eq(schema.studyRuns.id, runId))
    .limit(1);
  if (!run) throw new Error('Study run not found.');
  return run;
}

function runSnapshot(run: StudyRunRow): StudyRunSnapshot {
  return {
    id: run.id,
    kind: run.kind,
    studyId: run.studyId,
    studyVersion: run.studyVersion,
    armId: run.armId,
    currentPhaseIndex: run.currentPhaseIndex,
    startPhaseIndex: run.startPhaseIndex,
    ...(run.stopAfterPhaseIndex === null ? {} : { stopAfterPhaseIndex: run.stopAfterPhaseIndex }),
    ...(run.startedAt ? { startedAt: run.startedAt.toISOString() } : {}),
    ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {})
  };
}

function phaseRunSnapshot(row: StudyPhaseRunRow): StudyPhaseRunSnapshot {
  return {
    phaseId: row.phaseId,
    sequenceIndex: row.sequenceIndex,
    status: row.status,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
    ...(row.deadlineAt ? { deadlineAt: row.deadlineAt.toISOString() } : {}),
    ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
    ...(row.endReason ? { endReason: row.endReason } : {})
  };
}

function phaseRunValues(
  runId: string,
  sequenceIndex: number,
  phase: ResolvedStudyPhase,
  activatedAt: Date,
  projectId?: string
): typeof schema.studyPhaseRuns.$inferInsert {
  if (phase.kind !== 'task') {
    return {
      runId,
      phaseId: phase.id,
      sequenceIndex,
      kind: phase.kind,
      status: 'active',
      startedAt: activatedAt
    };
  }
  return {
    runId,
    phaseId: phase.id,
    sequenceIndex,
    kind: 'task',
    conditionId: phase.conditionId,
    mode: phase.condition.mode,
    layout: phase.condition.workspace.layout,
    view: phase.condition.workspace.view,
    projectId,
    status: 'active',
    startedAt: activatedAt,
    deadlineAt: new Date(activatedAt.getTime() + phase.condition.durationSeconds * 1_000)
  };
}

async function ensureTaskProject(options: {
  run: StudyRunRow;
  phase: Extract<ResolvedStudyPhase, { kind: 'task' }>;
  definitionName: string;
}): Promise<string> {
  const projectId = studyTaskProjectId(options.run.id, options.phase.id);
  const presentationCount = options.phase.condition.workspace.layout === 'comparison' ? 2 : 1;
  let document;
  try {
    document = await projectRepository.load(projectId);
  } catch (cause) {
    if (!(cause instanceof ProjectNotFoundError)) throw cause;
    document = await createProject({
      projectId,
      ownerUserId: options.run.ownerUserId,
      operationId: randomUUID(),
      title: `${options.run.kind === 'preview' ? 'Preview · ' : ''}${options.definitionName} · ${options.phase.instructions.title}`,
      creation: {
        templateId: options.phase.condition.project.templateId,
        mode: options.phase.condition.mode
      },
      presentationCount
    });
    if (options.phase.condition.project.templateId === 'blank') return projectId;
    if (!hasReadyPresentation(document, presentationCount)) {
      throw new Error('The task visualization could not be prepared. Retry to continue.');
    }
    return projectId;
  }

  if (
    options.phase.condition.project.templateId !== 'blank' &&
    !hasReadyPresentation(document, presentationCount)
  ) {
    const built = await buildProjectPresentations({
      projectId,
      expectedHead: document.events.length,
      presentationCount,
      operationId: randomUUID()
    });
    document = built.document;
  }
  if (
    options.phase.condition.project.templateId !== 'blank' &&
    !hasReadyPresentation(document, presentationCount)
  ) {
    throw new Error('The task visualization could not be prepared. Retry to continue.');
  }
  return projectId;
}

function hasReadyPresentation(
  document: Awaited<ReturnType<typeof projectRepository.load>>,
  count: 1 | 2
) {
  const active = projectSnapshotAt(document).activePresentationSet;
  return active?.presentations.length === count;
}

async function withStudyRunLock<Result>(
  runId: string,
  operation: () => Promise<Result>
): Promise<Result> {
  const connection = await sqlClient().reserve();
  try {
    await connection`select pg_advisory_lock(hashtextextended(${`study-run:${runId}`}, 1))`;
    return await operation();
  } finally {
    await connection`
      select pg_advisory_unlock(hashtextextended(${`study-run:${runId}`}, 1))
    `.catch(() => undefined);
    connection.release();
  }
}
