/** One verified export pipeline for project, study-version, and participant scopes. */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

import { type Archiver, ZipArchive } from 'archiver';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { database } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { ProjectNotFoundError } from '$lib/server/projects/repository';
import { buildSha } from '$lib/server/runtime-config';
import { projectSchemaVersion, type ProjectDocument } from '$lib/shared/projects/model';
import {
  activeProjectOperation,
  pendingAssistantTurnRequests
} from '$lib/shared/projects/operations';
import type { VisualizationMode } from '$lib/shared/presentations';
import type { StudyDefinition } from '$lib/shared/study/definition';
import { projectStudyFlow, type StudyFlow } from '$lib/shared/study/projection';
import { registeredStudyDefinitions, studyDefinition } from '$lib/shared/study/registry';

const exportFormat = 'sverlin-data-export';
const exportVersion = 1;

export type ExportScope =
  | { type: 'projects'; projectId?: string }
  | { type: 'study'; studyId?: string; studyVersion?: number }
  | { type: 'participant'; userId: string };

export type ExportOwner = { id: string; label: string; role: string; enabled: boolean };
export type ExportParticipant = {
  id: string;
  participantId: string;
  enabled: boolean;
  createdAt: string;
};
export type ExportProject = {
  id: string;
  ownerUserId: string;
  title: string;
  templateId: string;
  mode: VisualizationMode;
  createdAt: string;
  updatedAt: string;
  document: ProjectDocument;
};
export type ExportSnapshot = {
  owners: ExportOwner[];
  participants: ExportParticipant[];
  projects: ExportProject[];
  study: {
    definitions: StudyDefinition[];
    enrollments: Array<Record<string, unknown>>;
    runs: Array<Record<string, unknown>>;
    phases: Array<Record<string, unknown>>;
    flows: StudyFlow[];
  };
};

export type ExportInteractionSession = {
  id: string;
  projectId: string;
  studyRunId?: string;
  studyPhaseId?: string;
  schemaVersion: number;
  clientStartedAt: string;
  clientTimeOrigin: number;
  initialViewport: Record<string, unknown>;
  applicationVersion: string;
  buildSha?: string;
  capture: Record<string, unknown>;
  acceptedThrough: number;
  clientStoppedAt?: string;
  recordedThrough?: number;
  deliveryCompletedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ExportInteractionEvent = {
  sessionId: string;
  sequence: number;
  kind: string;
  elapsedMs: number;
  clientOccurredAt: string;
  projectHead: number;
  payload: Record<string, unknown>;
  receivedAt: string;
};

export type ExportInteractionSnapshot = {
  sessions: ExportInteractionSession[];
  events: ExportInteractionEvent[];
  expectedProjects: Array<{
    projectId: string;
    studyRunId: string;
    studyPhaseId: string;
    captureStartedAt: string;
    captureEndedAt: string;
    deliveryEndsAt: string;
  }>;
};

export interface ExportDataSource {
  collect(scope: ExportScope): Promise<ExportSnapshot>;
  collectInteractions?(scope: ExportScope): Promise<ExportInteractionSnapshot>;
}

export interface ExportSink {
  write(pathname: string, bytes: Uint8Array, mediaType: string): Promise<void> | void;
}

export type DataExportManifest = {
  format: typeof exportFormat;
  version: typeof exportVersion;
  scope: ExportScope;
  exportedAt: string;
  application: { version: string; buildSha: string | null };
  ownerCount: number;
  participantCount: number;
  projectCount: number;
  interactions: {
    status: 'included' | 'unavailable';
    sessionCount: number;
    eventCount: number;
    draftSnapshotCount: number;
    completeSessionCount: number;
    openSessionCount: number;
    pendingSessionCount: number;
    incompleteSessionCount: number;
    missingProjectCount: number;
    droppedEventCount: number;
    warnings: string[];
  };
  files: Array<{ path: string; sha256: string; byteLength: number; mediaType: string }>;
};

export type PreparedDataExport = {
  filename: string;
  response(): Promise<Response>;
  dispose(): Promise<void>;
};

/** PostgreSQL source with one safe allowlist and phase-link-based research selection. */
export class PostgresExportDataSource implements ExportDataSource {
  async collect(scope: ExportScope): Promise<ExportSnapshot> {
    return database().transaction(
      async (transaction) => {
        let participantRows: Array<{
          id: string;
          participantId: string;
          username: string | null;
          banned: boolean | null;
          createdAt: Date;
          runId: string;
          enrolledAt: Date;
        }> = [];
        let runRows: Array<typeof schema.studyRuns.$inferSelect> = [];
        let phaseRows: Array<typeof schema.studyPhaseRuns.$inferSelect> = [];

        if (scope.type !== 'projects') {
          const conditions = [eq(schema.studyRuns.kind, 'participant')];
          if (scope.type === 'participant') conditions.push(eq(schema.user.id, scope.userId));
          if (scope.type === 'study' && scope.studyId) {
            conditions.push(eq(schema.studyRuns.studyId, scope.studyId));
          }
          if (scope.type === 'study' && scope.studyVersion !== undefined) {
            conditions.push(eq(schema.studyRuns.studyVersion, scope.studyVersion));
          }
          participantRows = await transaction
            .select({
              id: schema.user.id,
              participantId: schema.user.name,
              username: schema.user.username,
              banned: schema.user.banned,
              createdAt: schema.user.createdAt,
              runId: schema.studyRuns.id,
              enrolledAt: schema.studyEnrollments.enrolledAt
            })
            .from(schema.studyEnrollments)
            .innerJoin(schema.studyRuns, eq(schema.studyRuns.id, schema.studyEnrollments.runId))
            .innerJoin(schema.user, eq(schema.user.id, schema.studyEnrollments.userId))
            .where(
              and(...conditions, eq(schema.user.role, 'user'), isNotNull(schema.user.username))
            )
            .orderBy(asc(schema.studyEnrollments.enrolledAt));
          if (scope.type === 'participant' && !participantRows.length) {
            throw new Error('Participant not found.');
          }
          const runIds = participantRows.map(({ runId }) => runId);
          runRows = runIds.length
            ? await transaction
                .select()
                .from(schema.studyRuns)
                .where(inArray(schema.studyRuns.id, runIds))
                .orderBy(asc(schema.studyRuns.createdAt))
            : [];
          phaseRows = runIds.length
            ? await transaction
                .select()
                .from(schema.studyPhaseRuns)
                .where(inArray(schema.studyPhaseRuns.runId, runIds))
                .orderBy(asc(schema.studyPhaseRuns.runId), asc(schema.studyPhaseRuns.sequenceIndex))
            : [];
        }

        const researchProjectIds = phaseRows.flatMap(({ projectId }) =>
          projectId ? [projectId] : []
        );
        const projectRows = await transaction
          .select({
            id: schema.projects.id,
            ownerUserId: schema.projects.ownerUserId,
            title: schema.projects.title,
            templateId: schema.projects.templateId,
            mode: schema.projects.mode,
            createdAt: schema.projects.createdAt,
            updatedAt: schema.projects.updatedAt
          })
          .from(schema.projects)
          .where(
            scope.type === 'projects'
              ? scope.projectId
                ? and(eq(schema.projects.id, scope.projectId), isNull(schema.projects.deletedAt))
                : isNull(schema.projects.deletedAt)
              : researchProjectIds.length
                ? and(
                    inArray(schema.projects.id, researchProjectIds),
                    isNull(schema.projects.deletedAt)
                  )
                : eq(schema.projects.id, '__no_research_projects__')
          )
          .orderBy(asc(schema.projects.createdAt), asc(schema.projects.id));
        if (scope.type === 'projects' && scope.projectId && !projectRows.length) {
          throw new ProjectNotFoundError(scope.projectId);
        }

        const projectIds = projectRows.map(({ id }) => id);
        if (scope.type === 'projects' && projectIds.length) {
          const associatedPhases = await transaction
            .select()
            .from(schema.studyPhaseRuns)
            .where(inArray(schema.studyPhaseRuns.projectId, projectIds))
            .orderBy(asc(schema.studyPhaseRuns.runId), asc(schema.studyPhaseRuns.sequenceIndex));
          const runIds = [...new Set(associatedPhases.map(({ runId }) => runId))];
          runRows = runIds.length
            ? await transaction
                .select()
                .from(schema.studyRuns)
                .where(inArray(schema.studyRuns.id, runIds))
            : [];
          phaseRows = runIds.length
            ? await transaction
                .select()
                .from(schema.studyPhaseRuns)
                .where(inArray(schema.studyPhaseRuns.runId, runIds))
                .orderBy(asc(schema.studyPhaseRuns.runId), asc(schema.studyPhaseRuns.sequenceIndex))
            : [];
          participantRows = runIds.length
            ? await transaction
                .select({
                  id: schema.user.id,
                  participantId: schema.user.name,
                  username: schema.user.username,
                  banned: schema.user.banned,
                  createdAt: schema.user.createdAt,
                  runId: schema.studyRuns.id,
                  enrolledAt: schema.studyEnrollments.enrolledAt
                })
                .from(schema.studyEnrollments)
                .innerJoin(schema.studyRuns, eq(schema.studyRuns.id, schema.studyEnrollments.runId))
                .innerJoin(schema.user, eq(schema.user.id, schema.studyEnrollments.userId))
                .where(
                  and(
                    inArray(schema.studyRuns.id, runIds),
                    eq(schema.studyRuns.kind, 'participant'),
                    eq(schema.user.role, 'user'),
                    isNotNull(schema.user.username)
                  )
                )
                .orderBy(asc(schema.studyEnrollments.enrolledAt))
            : [];
        }
        const ownerIds = [...new Set(projectRows.map(({ ownerUserId }) => ownerUserId))];
        const ownerRows = ownerIds.length
          ? await transaction
              .select({
                id: schema.user.id,
                name: schema.user.name,
                username: schema.user.username,
                role: schema.user.role,
                banned: schema.user.banned
              })
              .from(schema.user)
              .where(inArray(schema.user.id, ownerIds))
              .orderBy(asc(schema.user.createdAt), asc(schema.user.id))
          : [];
        const eventRows = projectIds.length
          ? await transaction
              .select({
                projectId: schema.projectEvents.projectId,
                event: schema.projectEvents.event
              })
              .from(schema.projectEvents)
              .where(inArray(schema.projectEvents.projectId, projectIds))
              .orderBy(asc(schema.projectEvents.projectId), asc(schema.projectEvents.eventId))
          : [];
        const projectDocuments = new Map(
          projectRows.map((project) => {
            const document: ProjectDocument = {
              schemaVersion: projectSchemaVersion,
              projectId: project.id,
              events: eventRows
                .filter((row) => row.projectId === project.id)
                .map(({ event }) => event)
            };
            if (
              activeProjectOperation(document) ||
              pendingAssistantTurnRequests(document).length > 0
            ) {
              throw new Error(
                'A project operation is currently running. Wait for it to finish and try again.'
              );
            }
            return [project.id, document] as const;
          })
        );

        let definitions = [
          ...new Map(
            runRows.map((run) => [
              `${run.studyId}:${run.studyVersion}`,
              studyDefinition(run.studyId, run.studyVersion)
            ])
          ).values()
        ];
        if (scope.type === 'study') {
          definitions =
            scope.studyId && scope.studyVersion !== undefined
              ? [studyDefinition(scope.studyId, scope.studyVersion)]
              : registeredStudyDefinitions();
        }
        const flows = runRows.map((run) =>
          projectStudyFlow(
            studyDefinition(run.studyId, run.studyVersion),
            {
              id: run.id,
              kind: run.kind,
              studyId: run.studyId,
              studyVersion: run.studyVersion,
              armId: run.armId,
              currentPhaseIndex: run.currentPhaseIndex,
              startPhaseIndex: run.startPhaseIndex,
              ...(run.stopAfterPhaseIndex === null
                ? {}
                : { stopAfterPhaseIndex: run.stopAfterPhaseIndex }),
              ...(run.startedAt ? { startedAt: run.startedAt.toISOString() } : {}),
              ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {})
            },
            phaseRows
              .filter(({ runId }) => runId === run.id)
              .map((phase) => ({
                phaseId: phase.phaseId,
                sequenceIndex: phase.sequenceIndex,
                status: phase.status,
                ...(phase.projectId ? { projectId: phase.projectId } : {}),
                ...(phase.startedAt ? { startedAt: phase.startedAt.toISOString() } : {}),
                ...(phase.deadlineAt ? { deadlineAt: phase.deadlineAt.toISOString() } : {}),
                ...(phase.endedAt ? { endedAt: phase.endedAt.toISOString() } : {}),
                ...(phase.endReason ? { endReason: phase.endReason } : {})
              }))
          )
        );

        return {
          owners: ownerRows.map((owner) => ({
            id: owner.id,
            label: owner.name || owner.username || owner.id,
            role: owner.role ?? 'user',
            enabled: !owner.banned
          })),
          participants: participantRows.map((participant) => ({
            id: participant.id,
            participantId: participant.participantId || participant.username || participant.id,
            enabled: !participant.banned,
            createdAt: participant.createdAt.toISOString()
          })),
          projects: projectRows.map((project) => ({
            ...project,
            createdAt: project.createdAt.toISOString(),
            updatedAt: project.updatedAt.toISOString(),
            document: requiredProjectDocument(projectDocuments, project.id)
          })),
          study: {
            definitions,
            enrollments: participantRows.map(({ id, runId, enrolledAt }) => ({
              userId: id,
              runId,
              enrolledAt: enrolledAt.toISOString()
            })),
            runs: runRows.map(serializeDates),
            phases: phaseRows.map(serializeDates),
            flows
          }
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' }
    );
  }

  async collectInteractions(scope: ExportScope): Promise<ExportInteractionSnapshot> {
    return database().transaction(
      async (transaction) => {
        const projectConditions = [isNull(schema.projects.deletedAt)];
        if (scope.type === 'projects' && scope.projectId) {
          projectConditions.push(eq(schema.projectInteractionSessions.projectId, scope.projectId));
        }
        const studyConditions = [eq(schema.studyRuns.kind, 'participant')];
        if (scope.type === 'participant') {
          studyConditions.push(eq(schema.studyRuns.ownerUserId, scope.userId));
        }
        if (scope.type === 'study' && scope.studyId) {
          studyConditions.push(eq(schema.studyRuns.studyId, scope.studyId));
        }
        if (scope.type === 'study' && scope.studyVersion !== undefined) {
          studyConditions.push(eq(schema.studyRuns.studyVersion, scope.studyVersion));
        }

        const rows =
          scope.type === 'projects'
            ? await transaction
                .select({
                  session: schema.projectInteractionSessions,
                  runId: schema.studyPhaseRuns.runId,
                  phaseId: schema.studyPhaseRuns.phaseId
                })
                .from(schema.projectInteractionSessions)
                .innerJoin(
                  schema.projects,
                  eq(schema.projects.id, schema.projectInteractionSessions.projectId)
                )
                .leftJoin(
                  schema.studyPhaseRuns,
                  eq(schema.studyPhaseRuns.projectId, schema.projectInteractionSessions.projectId)
                )
                .where(projectConditions.length ? and(...projectConditions) : undefined)
                .orderBy(
                  asc(schema.projectInteractionSessions.clientStartedAt),
                  asc(schema.projectInteractionSessions.id)
                )
            : await transaction
                .select({
                  session: schema.projectInteractionSessions,
                  runId: schema.studyPhaseRuns.runId,
                  phaseId: schema.studyPhaseRuns.phaseId
                })
                .from(schema.projectInteractionSessions)
                .innerJoin(
                  schema.projects,
                  eq(schema.projects.id, schema.projectInteractionSessions.projectId)
                )
                .innerJoin(
                  schema.studyPhaseRuns,
                  eq(schema.studyPhaseRuns.projectId, schema.projectInteractionSessions.projectId)
                )
                .innerJoin(schema.studyRuns, eq(schema.studyRuns.id, schema.studyPhaseRuns.runId))
                .where(and(...studyConditions, isNull(schema.projects.deletedAt)))
                .orderBy(
                  asc(schema.projectInteractionSessions.clientStartedAt),
                  asc(schema.projectInteractionSessions.id)
                );
        const expectedRows = await transaction
          .select({
            projectId: schema.projects.id,
            runId: schema.studyPhaseRuns.runId,
            phaseId: schema.studyPhaseRuns.phaseId,
            studyId: schema.studyRuns.studyId,
            studyVersion: schema.studyRuns.studyVersion,
            kind: schema.studyRuns.kind,
            startedAt: schema.studyPhaseRuns.startedAt,
            deadlineAt: schema.studyPhaseRuns.deadlineAt,
            endedAt: schema.studyPhaseRuns.endedAt
          })
          .from(schema.studyPhaseRuns)
          .innerJoin(schema.studyRuns, eq(schema.studyRuns.id, schema.studyPhaseRuns.runId))
          .innerJoin(schema.projects, eq(schema.projects.id, schema.studyPhaseRuns.projectId))
          .where(
            and(
              eq(schema.studyPhaseRuns.kind, 'task'),
              isNull(schema.projects.deletedAt),
              ...(scope.type === 'projects'
                ? scope.projectId
                  ? [eq(schema.projects.id, scope.projectId)]
                  : []
                : studyConditions)
            )
          )
          .orderBy(asc(schema.studyPhaseRuns.startedAt), asc(schema.projects.id));
        const sessionIds = rows.map(({ session }) => session.id);
        const events = sessionIds.length
          ? await transaction
              .select()
              .from(schema.projectInteractionEvents)
              .where(inArray(schema.projectInteractionEvents.sessionId, sessionIds))
              .orderBy(
                asc(schema.projectInteractionEvents.sessionId),
                asc(schema.projectInteractionEvents.sequence)
              )
          : [];
        return {
          sessions: rows.map(({ session, runId, phaseId }) => ({
            id: session.id,
            projectId: session.projectId,
            ...(runId ? { studyRunId: runId } : {}),
            ...(phaseId ? { studyPhaseId: phaseId } : {}),
            schemaVersion: session.schemaVersion,
            clientStartedAt: session.clientStartedAt.toISOString(),
            clientTimeOrigin: session.clientTimeOrigin,
            initialViewport: session.initialViewport,
            applicationVersion: session.applicationVersion,
            ...(session.buildSha ? { buildSha: session.buildSha } : {}),
            capture: session.capture,
            acceptedThrough: session.acceptedThrough,
            ...(session.clientStoppedAt
              ? { clientStoppedAt: session.clientStoppedAt.toISOString() }
              : {}),
            ...(session.recordedThrough === null
              ? {}
              : { recordedThrough: session.recordedThrough }),
            ...(session.deliveryCompletedAt
              ? { deliveryCompletedAt: session.deliveryCompletedAt.toISOString() }
              : {}),
            createdAt: session.createdAt.toISOString(),
            updatedAt: session.updatedAt.toISOString()
          })),
          events: events.map((event) => ({
            sessionId: event.sessionId,
            sequence: event.sequence,
            kind: event.kind,
            elapsedMs: event.elapsedMs,
            clientOccurredAt: event.clientOccurredAt.toISOString(),
            projectHead: event.projectHead,
            payload: event.payload as Record<string, unknown>,
            receivedAt: event.receivedAt.toISOString()
          })),
          expectedProjects: expectedRows.flatMap((row) => {
            const policy = studyDefinition(row.studyId, row.studyVersion).interactionCapture;
            const captureEnd = row.endedAt ?? row.deadlineAt;
            if (row.kind !== 'participant' || !row.startedAt || !captureEnd || !policy) return [];
            return [
              {
                projectId: row.projectId,
                studyRunId: row.runId,
                studyPhaseId: row.phaseId,
                captureStartedAt: row.startedAt.toISOString(),
                captureEndedAt: captureEnd.toISOString(),
                deliveryEndsAt: new Date(
                  captureEnd.getTime() + policy.lateDeliverySeconds * 1_000
                ).toISOString()
              }
            ];
          })
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' }
    );
  }
}

function requiredProjectDocument(
  documents: ReadonlyMap<string, ProjectDocument>,
  projectId: string
): ProjectDocument {
  const document = documents.get(projectId);
  if (!document) throw new Error(`Export snapshot is missing project ${projectId}.`);
  return document;
}

/** Write one canonical tree regardless of scope or destination. */
export async function writeDataExport(
  source: ExportDataSource,
  sink: ExportSink,
  scope: ExportScope,
  exportedAt = new Date().toISOString()
): Promise<DataExportManifest> {
  const snapshot = await source.collect(scope);
  const files: DataExportManifest['files'] = [];
  await appendJson(sink, files, 'owners.json', snapshot.owners);
  await appendJson(sink, files, 'participants.json', snapshot.participants);
  await appendJson(sink, files, 'study/definitions.json', snapshot.study.definitions);
  await appendJson(sink, files, 'study/enrollments.json', snapshot.study.enrollments);
  await appendJson(sink, files, 'study/runs.json', snapshot.study.runs);
  await appendJson(sink, files, 'study/phases.json', snapshot.study.phases);
  await appendJson(sink, files, 'study/flows.json', snapshot.study.flows);
  for (const project of snapshot.projects) {
    const root = `projects/${safePathSegment(project.id)}`;
    await appendJson(sink, files, `${root}/project.json`, {
      id: project.id,
      ownerUserId: project.ownerUserId,
      title: project.title,
      templateId: project.templateId,
      mode: project.mode,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      document: project.document
    });
  }
  const interactionExport = await prepareInteractionExport(source, scope, exportedAt);
  for (const file of interactionExport.files) {
    await appendBytes(sink, files, file.path, file.bytes, file.mediaType);
  }
  const manifest: DataExportManifest = {
    format: exportFormat,
    version: exportVersion,
    scope,
    exportedAt,
    application: {
      version: process.env.npm_package_version ?? '0.0.1',
      buildSha: buildSha() ?? null
    },
    ownerCount: snapshot.owners.length,
    participantCount: snapshot.participants.length,
    projectCount: snapshot.projects.length,
    interactions: interactionExport.summary,
    files
  };
  await sink.write('manifest.json', jsonBytes(manifest), 'application/json');
  return manifest;
}

type PreparedInteractionFiles = {
  summary: DataExportManifest['interactions'];
  files: Array<{ path: string; bytes: Uint8Array; mediaType: string }>;
};

async function prepareInteractionExport(
  source: ExportDataSource,
  scope: ExportScope,
  exportedAt: string
): Promise<PreparedInteractionFiles> {
  const warning =
    'Interaction telemetry was unavailable; the primary project Timeline and chat export is complete.';
  try {
    if (!source.collectInteractions) throw new Error('Interaction collection is unsupported.');
    const snapshot = await source.collectInteractions(scope);
    const drafts: Array<Record<string, unknown>> = [];
    const events = snapshot.events.map((event) => {
      if (event.kind !== 'draft.snapshot') return event;
      const recordId = `${event.sessionId}:${event.sequence}`;
      const { content, ...metadata } = event.payload;
      drafts.push({
        id: recordId,
        sessionId: event.sessionId,
        sequence: event.sequence,
        clientOccurredAt: event.clientOccurredAt,
        content
      });
      return {
        ...event,
        payload: { ...metadata, sensitiveDraftRecordId: recordId }
      };
    });
    const coverage = interactionCoverage(snapshot, exportedAt);
    const summary: DataExportManifest['interactions'] = {
      status: 'included',
      sessionCount: snapshot.sessions.length,
      eventCount: snapshot.events.length,
      draftSnapshotCount: drafts.length,
      completeSessionCount: coverage.completeSessionCount,
      openSessionCount: coverage.openSessionCount,
      pendingSessionCount: coverage.pendingSessionCount,
      incompleteSessionCount: coverage.incompleteSessionCount,
      missingProjectCount: coverage.missingProjectCount,
      droppedEventCount: coverage.droppedEventCount,
      warnings: coverage.warnings
    };
    const coverageDocument = {
      ...summary,
      scope,
      exportedAt,
      projects: coverage.projects,
      sessions: coverage.sessions,
      droppedByReason: coverage.droppedByReason,
      note: 'Per-session sequence is authoritative. Cross-tab ordering is approximate using clientOccurredAt, receivedAt, sessionId, sequence, and projectHead.'
    };
    return {
      summary,
      files: [
        {
          path: 'interactions/sessions.json',
          bytes: jsonBytes(snapshot.sessions),
          mediaType: 'application/json'
        },
        {
          path: 'interactions/events.jsonl',
          bytes: jsonLines(events),
          mediaType: 'application/x-ndjson'
        },
        {
          path: 'sensitive/unsent-feedback-drafts.jsonl',
          bytes: jsonLines(drafts),
          mediaType: 'application/x-ndjson'
        },
        {
          path: 'interactions/coverage.json',
          bytes: jsonBytes(coverageDocument),
          mediaType: 'application/json'
        }
      ]
    };
  } catch (cause) {
    console.warn(warning, cause);
    const summary: DataExportManifest['interactions'] = {
      status: 'unavailable',
      sessionCount: 0,
      eventCount: 0,
      draftSnapshotCount: 0,
      completeSessionCount: 0,
      openSessionCount: 0,
      pendingSessionCount: 0,
      incompleteSessionCount: 0,
      missingProjectCount: 0,
      droppedEventCount: 0,
      warnings: [warning]
    };
    return {
      summary,
      files: [
        {
          path: 'interactions/coverage.json',
          bytes: jsonBytes({ ...summary, scope }),
          mediaType: 'application/json'
        }
      ]
    };
  }
}

type InteractionDeliveryStatus = 'complete' | 'incomplete' | 'open' | 'pending';

function interactionCoverage(snapshot: ExportInteractionSnapshot, exportedAt: string) {
  const exportedAtMs = new Date(exportedAt).getTime();
  const expectedByProject = new Map(
    snapshot.expectedProjects.map((project) => [project.projectId, project] as const)
  );
  const sessions = snapshot.sessions.map((session) => {
    const expected = expectedByProject.get(session.projectId);
    const complete =
      session.recordedThrough !== undefined && session.acceptedThrough === session.recordedThrough;
    const deliveryClosed =
      expected !== undefined && exportedAtMs > new Date(expected.deliveryEndsAt).getTime();
    const status: InteractionDeliveryStatus = complete
      ? 'complete'
      : deliveryClosed
        ? 'incomplete'
        : session.recordedThrough === undefined
          ? 'open'
          : 'pending';
    return {
      sessionId: session.id,
      projectId: session.projectId,
      status,
      acceptedThrough: session.acceptedThrough,
      ...(session.recordedThrough === undefined
        ? {}
        : { recordedThrough: session.recordedThrough }),
      ...(session.clientStoppedAt ? { clientStoppedAt: session.clientStoppedAt } : {}),
      ...(session.deliveryCompletedAt ? { deliveryCompletedAt: session.deliveryCompletedAt } : {})
    };
  });
  const sessionsByProject = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const projectSessions = sessionsByProject.get(session.projectId) ?? [];
    projectSessions.push(session);
    sessionsByProject.set(session.projectId, projectSessions);
  }
  const projects = snapshot.expectedProjects.map((project) => {
    const projectSessions = sessionsByProject.get(project.projectId) ?? [];
    return {
      ...project,
      status: projectSessions.length ? 'recorded' : 'missing',
      sessionIds: projectSessions.map(({ sessionId }) => sessionId)
    };
  });
  const droppedByReason: Record<string, number> = {};
  let droppedEventCount = 0;
  for (const event of snapshot.events) {
    if (event.kind !== 'recorder.dropped') continue;
    const reason = typeof event.payload.reason === 'string' ? event.payload.reason : 'unknown';
    const counts = isPlainRecord(event.payload.counts) ? Object.values(event.payload.counts) : [];
    const count = counts.reduce(
      (total: number, value) =>
        total +
        (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0),
      0
    );
    droppedByReason[reason] = (droppedByReason[reason] ?? 0) + count;
    droppedEventCount += count;
  }
  const count = (status: InteractionDeliveryStatus) =>
    sessions.filter((session) => session.status === status).length;
  const incompleteSessionCount = count('incomplete');
  const openSessionCount = count('open');
  const pendingSessionCount = count('pending');
  const missingProjectCount = projects.filter(({ status }) => status === 'missing').length;
  const warnings = [
    ...(missingProjectCount
      ? [`${missingProjectCount} started participant task project(s) have no interaction session.`]
      : []),
    ...(incompleteSessionCount
      ? [`${incompleteSessionCount} interaction session(s) are incomplete after delivery closed.`]
      : []),
    ...(openSessionCount || pendingSessionCount
      ? [
          `${openSessionCount + pendingSessionCount} interaction session(s) were still open or pending when exported.`
        ]
      : [])
  ];
  return {
    projects,
    sessions,
    droppedByReason,
    droppedEventCount,
    completeSessionCount: count('complete'),
    openSessionCount,
    pendingSessionCount,
    incompleteSessionCount,
    missingProjectCount,
    warnings
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function writeDataDirectory(
  outputDirectory: string,
  scope: ExportScope,
  source: ExportDataSource = new PostgresExportDataSource(),
  exportedAt?: string
): Promise<DataExportManifest> {
  const destination = path.resolve(outputDirectory);
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(destination);
  try {
    return await writeDataExport(
      source,
      {
        async write(relativePath, bytes) {
          const target = path.join(destination, relativePath);
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, bytes, { flag: 'wx' });
        }
      },
      scope,
      exportedAt
    );
  } catch (cause) {
    await rm(destination, { recursive: true, force: true });
    throw cause;
  }
}

export async function prepareDataExport(
  scope: ExportScope,
  filenameLabel: string,
  source: ExportDataSource = new PostgresExportDataSource(),
  exportedAt = new Date().toISOString()
): Promise<PreparedDataExport> {
  const root = await mkdtemp(path.join(tmpdir(), 'sverlin-data-export-'));
  const archivePath = path.join(root, 'export.zip');
  const output = createWriteStream(archivePath, { flags: 'wx' });
  const zip = new ZipArchive({ zlib: { level: 9 } });
  zip.pipe(output);
  try {
    await writeDataExport(source, zipSink(zip), scope, exportedAt);
    await zip.finalize();
    await finished(output);
  } catch (cause) {
    zip.abort();
    output.destroy();
    await rm(root, { recursive: true, force: true });
    throw cause;
  }
  const filename = `sverlin-${safePathSegment(filenameLabel)}-${exportedAt.slice(0, 10)}.zip`;
  return {
    filename,
    async response() {
      const details = await stat(archivePath);
      const stream = createReadStream(archivePath);
      stream.once('close', () => void rm(root, { recursive: true, force: true }));
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': String(details.size),
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'private, no-store'
        }
      });
    },
    async dispose() {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function zipSink(zip: Archiver): ExportSink {
  return {
    write(pathname, bytes) {
      zip.append(Buffer.from(bytes), { name: pathname });
    }
  };
}

async function appendJson(
  sink: ExportSink,
  files: DataExportManifest['files'],
  pathname: string,
  value: unknown
): Promise<void> {
  await appendBytes(sink, files, pathname, jsonBytes(value), 'application/json');
}

async function appendBytes(
  sink: ExportSink,
  files: DataExportManifest['files'],
  pathname: string,
  bytes: Uint8Array,
  mediaType: string
): Promise<void> {
  const value = Uint8Array.from(bytes);
  files.push({ path: pathname, sha256: sha256(value), byteLength: value.byteLength, mediaType });
  await sink.write(pathname, value, mediaType);
}

function serializeDates(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      item instanceof Date ? item.toISOString() : item
    ])
  );
}

function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function jsonLines(values: readonly unknown[]): Uint8Array {
  return Buffer.from(
    values.length ? `${values.map((value) => JSON.stringify(value)).join('\n')}\n` : ''
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function safeExportPathSegment(value: string): string {
  return safePathSegment(value);
}

function safePathSegment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || 'unknown';
}
