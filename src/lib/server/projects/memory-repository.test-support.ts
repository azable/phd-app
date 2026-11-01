/** In-memory ProjectRepository fake for database-free unit tests. */

import type { NewProjectEvent, ProjectEvent } from '$lib/shared/projects/events';
import {
  normalizeProject,
  type ProjectDocument,
  type ProjectId,
  type ProjectSummary
} from '$lib/shared/projects/model';
import { headStillCurrent, summarizeProject } from '$lib/shared/projects/projection';

import {
  ProjectConflictError,
  ProjectNotFoundError,
  type ProjectAppendResult,
  type ProjectRepository
} from './repository';

type StoredProject = { document: ProjectDocument; ownerUserId?: string };

export class MemoryProjectRepository implements ProjectRepository {
  readonly #projects = new Map<ProjectId, StoredProject>();
  readonly #writeTails = new Map<ProjectId, Promise<void>>();

  async initialize(): Promise<void> {}

  async list(ownerUserId?: string): Promise<ProjectSummary[]> {
    return [...this.#projects.values()]
      .filter((project) => !ownerUserId || project.ownerUserId === ownerUserId)
      .map(({ document }) => summarizeProject(document))
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async create(document: ProjectDocument, ownerUserId?: string): Promise<ProjectDocument> {
    const normalized = normalizeProject(document);
    if (this.#projects.has(normalized.projectId)) throw new Error('Project already exists.');
    this.#projects.set(normalized.projectId, {
      document: structuredClone(normalized),
      ownerUserId
    });
    return structuredClone(normalized);
  }

  async load(projectId: ProjectId): Promise<ProjectDocument> {
    const stored = this.#projects.get(projectId);
    if (!stored) throw new ProjectNotFoundError(projectId);
    return structuredClone(stored.document);
  }

  async append(
    projectId: ProjectId,
    expectedHead: number,
    pendingEvents: NewProjectEvent[]
  ): Promise<ProjectAppendResult> {
    return this.withWriteLock(projectId, async () => {
      const stored = this.#projects.get(projectId);
      if (!stored) throw new ProjectNotFoundError(projectId);
      const head = stored.document.events.at(-1)?.id ?? 0;
      if (!headStillCurrent(stored.document.events, expectedHead)) throw new ProjectConflictError();

      const events = pendingEvents.map(
        (event, index): ProjectEvent => ({ ...event, id: head + index + 1 }) as ProjectEvent
      );
      const document = normalizeProject({
        ...stored.document,
        events: [...stored.document.events, ...events]
      });
      stored.document = structuredClone(document);
      return { document: structuredClone(document), events: structuredClone(events) };
    });
  }

  async eventsAfter(projectId: ProjectId, after: number): Promise<ProjectEvent[]> {
    const document = await this.load(projectId);
    const head = document.events.at(-1)?.id ?? 0;
    if (after > head) throw new ProjectConflictError();
    return document.events.filter(({ id }) => id > after);
  }

  async deleteAll(): Promise<void> {
    this.#projects.clear();
  }

  private async withWriteLock<T>(projectId: ProjectId, operation: () => Promise<T>): Promise<T> {
    const previous = this.#writeTails.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => (release = resolve));
    const chain = previous.then(() => tail);
    this.#writeTails.set(projectId, chain);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#writeTails.get(projectId) === chain) this.#writeTails.delete(projectId);
    }
  }
}
