/** PostgreSQL persistence for immutable project Timelines. */

import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm';

import { headStillCurrent, summarizeProject } from '$lib/shared/projects/projection';
import {
  activeProjectOperation,
  pendingAssistantTurnRequests
} from '$lib/shared/projects/operations';
import {
  InvalidProjectDocumentError,
  normalizeProjectEvent,
  type NewProjectEvent,
  type ProjectEvent
} from '$lib/shared/projects/events';
import {
  normalizeProject,
  projectSchemaVersion,
  type ProjectDocument,
  type ProjectId,
  type ProjectSummary
} from '$lib/shared/projects/model';
import { modeCatalog } from '$lib/modes/catalog';
import type { VisualizationMode } from '$lib/shared/presentations';
import { storableJson } from '$lib/shared/text';
import { database } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';

/** Validated document and stable events produced by one atomic append. */
export type ProjectAppendResult = {
  document: ProjectDocument;
  events: ProjectEvent[];
};

/** Read-only project access used by HTTP delivery and analysis code. */
export interface ProjectReader {
  list(ownerUserId?: string): Promise<ProjectSummary[]>;
  load(projectId: ProjectId): Promise<ProjectDocument>;
  eventsAfter(projectId: ProjectId, after: number): Promise<ProjectEvent[]>;
}

/** Project mutations used by command orchestration and administrative deletion. */
export interface ProjectWriter {
  initialize(): Promise<void>;
  create(document: ProjectDocument, ownerUserId?: string): Promise<ProjectDocument>;
  append(
    projectId: ProjectId,
    expectedHead: number,
    pendingEvents: NewProjectEvent[]
  ): Promise<ProjectAppendResult>;
  deleteAll(): Promise<void>;
}

/** Complete persistence contract; production has exactly one PostgreSQL implementation. */
export interface ProjectRepository extends ProjectReader, ProjectWriter {}

/** The modes a project can be listed and opened in: those still registered. */
const registeredModes = Object.keys(modeCatalog) as VisualizationMode[];

/** Raised when a requested active project does not exist, or cannot be opened. */
export class ProjectNotFoundError extends Error {
  constructor(projectId: string, message = `Unknown project ${projectId}.`) {
    super(message);
    this.name = 'ProjectNotFoundError';
  }
}

/** Raised when an append targets a project head that has already advanced. */
export class ProjectConflictError extends Error {
  constructor() {
    super('The project changed before this operation completed.');
    this.name = 'ProjectConflictError';
  }
}

/** PostgreSQL event repository used by the application service. */
export class PostgresProjectRepository implements ProjectRepository {
  async initialize(): Promise<void> {
    // Migrations own schema creation; application processes never mutate it implicitly.
  }

  // A project made in a mode since removed, as html-js, stays stored and in the data export but is
  // neither listed nor opened, as nothing can draw or edit it.
  async list(ownerUserId?: string): Promise<ProjectSummary[]> {
    const condition = ownerUserId
      ? and(eq(schema.projects.ownerUserId, ownerUserId), isNull(schema.projects.deletedAt))
      : isNull(schema.projects.deletedAt);
    const rows = await database()
      .select({
        projectId: schema.projects.id,
        title: schema.projects.title,
        updatedAt: schema.projects.updatedAt,
        eventCount: schema.projects.head,
        templateId: schema.projects.templateId,
        mode: schema.projects.mode
      })
      .from(schema.projects)
      .where(and(condition, inArray(schema.projects.mode, registeredModes)))
      .orderBy(desc(schema.projects.updatedAt));
    return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
  }

  async create(document: ProjectDocument, ownerUserId?: string): Promise<ProjectDocument> {
    assertProjectId(document.projectId);
    const normalized = normalizeProject(storableJson(document));
    if (!ownerUserId) throw new Error('A project owner is required for PostgreSQL storage.');
    const summary = summarizeProject(normalized);
    await database().transaction(async (transaction) => {
      await transaction.insert(schema.projects).values({
        id: normalized.projectId,
        ownerUserId,
        head: summary.eventCount,
        title: summary.title,
        templateId: summary.templateId,
        mode: summary.mode,
        createdAt: new Date(normalized.events[0].createdAt),
        updatedAt: new Date(summary.updatedAt)
      });
      await transaction.insert(schema.projectEvents).values(
        normalized.events.map((event) => ({
          projectId: normalized.projectId,
          eventId: event.id,
          operationId: event.operationId,
          event,
          createdAt: new Date(event.createdAt)
        }))
      );
    });
    return structuredClone(normalized);
  }

  async load(projectId: ProjectId): Promise<ProjectDocument> {
    assertProjectId(projectId);
    const project = await database()
      .select({ id: schema.projects.id, mode: schema.projects.mode })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)))
      .limit(1);
    if (!project[0]) throw new ProjectNotFoundError(projectId);
    if (!registeredModes.includes(project[0].mode))
      throw new ProjectNotFoundError(
        projectId,
        `Project ${projectId} was made in a visualization mode that has been removed (${project[0].mode}); it stays in the data export but can no longer be opened.`
      );
    const rows = await database()
      .select({ event: schema.projectEvents.event })
      .from(schema.projectEvents)
      .where(eq(schema.projectEvents.projectId, projectId))
      .orderBy(asc(schema.projectEvents.eventId));
    return normalizeProject({
      schemaVersion: projectSchemaVersion,
      projectId,
      events: rows.map(({ event }) => event)
    });
  }

  async append(
    projectId: ProjectId,
    expectedHead: number,
    pendingEvents: NewProjectEvent[]
  ): Promise<ProjectAppendResult> {
    assertProjectId(projectId);

    return database().transaction(async (transaction) => {
      const locked = await transaction
        .select({ head: schema.projects.head })
        .from(schema.projects)
        .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)))
        .for('update')
        .limit(1);
      if (!locked[0]) throw new ProjectNotFoundError(projectId);
      const { head } = locked[0];
      const rows = await transaction
        .select({ event: schema.projectEvents.event })
        .from(schema.projectEvents)
        .where(eq(schema.projectEvents.projectId, projectId))
        .orderBy(asc(schema.projectEvents.eventId));
      if (
        !headStillCurrent(
          rows.map(({ event }) => event),
          expectedHead
        )
      )
        throw new ProjectConflictError();

      const events = pendingEvents.map(
        (pending, index): ProjectEvent =>
          storableJson({ ...pending, id: head + index + 1 }) as ProjectEvent
      );
      const document = normalizeProject({
        schemaVersion: projectSchemaVersion,
        projectId,
        events: [...rows.map(({ event }) => event), ...events]
      });
      const summary = summarizeProject(document);

      if (events.length) {
        await transaction.insert(schema.projectEvents).values(
          events.map((event) => ({
            projectId,
            eventId: event.id,
            operationId: event.operationId,
            event,
            createdAt: new Date(event.createdAt)
          }))
        );
      }
      await transaction
        .update(schema.projects)
        .set({
          head: summary.eventCount,
          title: summary.title,
          templateId: summary.templateId,
          mode: summary.mode,
          updatedAt: new Date(summary.updatedAt)
        })
        .where(eq(schema.projects.id, projectId));
      return { document: structuredClone(document), events: structuredClone(events) };
    });
  }

  async eventsAfter(projectId: ProjectId, after: number): Promise<ProjectEvent[]> {
    const project = await database()
      .select({ head: schema.projects.head })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)))
      .limit(1);
    if (!project[0]) throw new ProjectNotFoundError(projectId);
    if (after > project[0].head) throw new ProjectConflictError();
    const rows = await database()
      .select({ event: schema.projectEvents.event })
      .from(schema.projectEvents)
      .where(
        and(eq(schema.projectEvents.projectId, projectId), gt(schema.projectEvents.eventId, after))
      )
      .orderBy(asc(schema.projectEvents.eventId));
    return rows.map(({ event }) => normalizeProjectEvent(event));
  }

  async deleteAll(): Promise<void> {
    await database().delete(schema.projects);
  }
}

/** Default repository used by server routes and project operations. */
export const projectRepository: ProjectRepository = new PostgresProjectRepository();

/** Projects skipped as unreadable, each logged once. */
const unreadableProjects = new Set<string>();

/**
 * Refuse export or deletion while a selected project's Timeline is still changing. A project whose
 * Timeline no longer reads as the events are now defined runs no operation (none can load it), and
 * one deleted since the list has none, so neither keeps the others from being exported or deleted.
 */
export async function assertNoActiveProjectOperations(
  ownerUserId?: string,
  repository: ProjectReader = projectRepository
): Promise<void> {
  for (const summary of await repository.list(ownerUserId)) {
    let document: ProjectDocument;
    try {
      document = await repository.load(summary.projectId);
    } catch (cause) {
      if (cause instanceof ProjectNotFoundError) continue;
      if (!(cause instanceof InvalidProjectDocumentError)) throw cause;
      if (!unreadableProjects.has(summary.projectId)) {
        unreadableProjects.add(summary.projectId);
        console.warn(`Skipping project ${summary.projectId}, whose Timeline no longer reads.`);
      }
      continue;
    }
    if (activeProjectOperation(document) || pendingAssistantTurnRequests(document).length > 0) {
      throw new Error(
        'A project operation is currently running. Wait for it to finish and try again.'
      );
    }
  }
}

function assertProjectId(projectId: string) {
  if (!isProjectId(projectId)) {
    throw new Error('Invalid project ID.');
  }
}

function isProjectId(projectId: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(projectId);
}
