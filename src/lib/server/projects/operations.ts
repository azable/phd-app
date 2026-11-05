/** In-process asynchronous execution backed by durable Timeline lifecycle events. */

import { randomUUID } from 'node:crypto';

import { DrizzleQueryError } from 'drizzle-orm';
import postgres from 'postgres';

import {
  InvalidProjectDocumentError,
  type NewProjectEvent,
  type ProjectEvent,
  type ProjectOperationKind
} from '$lib/shared/projects/events';
import type {
  ProjectCommand,
  ProjectCommandResult,
  ProjectDocument
} from '$lib/shared/projects/model';
import {
  activeProjectOperation,
  pendingAssistantTurnRequests,
  projectOperation
} from '$lib/shared/projects/operations';
import { headStillCurrent } from '$lib/shared/projects/projection';
import { cutText } from '$lib/shared/text';
import { sqlClient } from '$lib/server/db';

import {
  chosenVariantRequests,
  queueProjectFeedback,
  queueProjectPreference,
  runQueuedAssistantTurn
} from './commands';
import { preferenceAnswer } from './presentations';
import { runProjectCommand } from './command-lock';
import { conditionHelperCounts, projectViewHelpers } from './view-helpers-config';
import {
  operationGraceUntil,
  projectOperationDeadlineError,
  runWithProjectOperationSignal
} from './operation-context';
import { logOperationCost } from './ai-cost-log';
import { recoveryEventsForInterruptedOperations } from './recovery';
import { ProjectNotFoundError, projectRepository, type ProjectRepository } from './repository';
import {
  renameProject,
  setProjectViewHelpers,
  advanceProjectPresentations,
  reportRuntimeFailure,
  replenishProjectPresentations,
  buildProjectPresentations,
  restoreProjectArtifacts,
  updateProjectArtifact
} from './service';

export type InitialBuildCommand = { type: 'initial-build'; seed: number };
export type PresentationRefillCommand = { type: 'presentation-refill'; target: number };
export type AssistantTurnCommand = { type: 'assistant-turn'; requestEventIds: number[] };
export type ProjectOperationCommand =
  | ProjectCommand
  | InitialBuildCommand
  | PresentationRefillCommand
  | AssistantTurnCommand;

export type AcceptedProjectOperation = {
  projectId: string;
  operationId: string;
  acceptedEventId: number;
};

type OperationLease = { release(): Promise<void> };
type OperationLock = { acquire(operationId: string): Promise<OperationLease | null> };
type ExecuteCommand = (options: {
  projectId: string;
  expectedHead: number;
  operationId: string;
  command: ProjectOperationCommand;
  signal: AbortSignal;
  deadlineAt?: number;
}) => Promise<ProjectCommandResult>;

/**
 * Operations running at once across every project. Most of an operation is spent waiting on the
 * model, so this is not a CPU bound: builds, the CPU work, take turns under their own smaller limit
 * (buildLimit in modes/build-limit.server.ts). Each running operation holds one database
 * connection for its lock, so the pool (db/index.ts) keeps room above this for everything else.
 */
export const operationCapacity = 6;

/** Raised when this small deployment has reached its explicit work capacity. */
export class ProjectOperationCapacityError extends Error {
  constructor() {
    super(
      'The server is already processing the maximum number of project operations. Try again shortly.'
    );
    this.name = 'ProjectOperationCapacityError';
  }
}

/** Coordinates accepted Timeline operations with bounded process-owned execution. */
export class ProjectOperationExecutor {
  readonly #active = new Map<
    string,
    {
      projectId: string;
      kind: ProjectOperationKind;
      promise: Promise<void>;
      controller: AbortController;
    }
  >();
  #accepting = true;
  #recoveryTimer?: ReturnType<typeof setInterval>;
  /** Projects the scans skip, warned about once each. */
  readonly #unreadable = new Set<string>();
  /** The head of each project the last scan found with nothing to do, so the next skips it. */
  #idleHeads = new Map<string, number>();
  #scan?: Promise<number>;
  readonly #assistantProjects = new Set<string>();
  #assistantDrain?: Promise<void>;

  constructor(
    private readonly repository: ProjectRepository = latestModule((loaded) => loaded.repository),
    private readonly lock: OperationLock = latestModule((loaded) => loaded.lock),
    private readonly execute: ExecuteCommand = (options) => latestLoaded().execute(options),
    private readonly capacity = operationCapacity
  ) {}

  /** Persist acceptance before returning, then execute without holding the HTTP request open. */
  async accept(options: {
    projectId: string;
    operationId: string;
    expectedHead: number;
    command: ProjectOperationCommand;
    actor?: 'user' | 'system';
    deadlineAt?: string;
  }): Promise<AcceptedProjectOperation> {
    if (!this.#accepting) {
      throw new ProjectOperationCapacityError();
    }
    const deadlineAt = parseDeadline(options.deadlineAt);
    const kind = commandKind(options.command);
    await this.repository.load(options.projectId);
    if (options.command.type === 'feedback' || options.command.type === 'prefer') {
      return this.acceptInteraction({
        ...options,
        kind: options.command.type,
        command: options.command,
        deadlineAt
      });
    }
    const expectedHead =
      kind === 'presentation-refill'
        ? options.expectedHead
        : await this.preemptRefill(options.projectId, options.expectedHead);
    if (kind !== 'presentation-refill' && this.#active.size >= this.capacity) {
      await this.preemptAnyRefill();
    }
    if (this.#active.size >= this.capacity) throw new ProjectOperationCapacityError();
    const reserved = new AbortController();
    let releaseReservation!: () => void;
    const reservation = new Promise<void>((resolve) => {
      releaseReservation = resolve;
    });
    this.#active.set(options.operationId, {
      projectId: options.projectId,
      kind,
      promise: reservation,
      controller: reserved
    });
    let lease: OperationLease | null = null;
    try {
      lease = await this.lock.acquire(options.operationId);
      if (!lease) throw new Error('This operation is already running.');
      const acceptedEvent = lifecycleEvent(
        'operation.accepted',
        options.operationId,
        kind,
        options.actor ?? (kind === 'presentation-refill' ? 'system' : 'user')
      );
      const accepted = await this.appendAccepted(
        options.projectId,
        expectedHead,
        acceptedEvent,
        kind === 'assistant-turn'
      );
      const acceptedEventId = accepted.events[0].id;
      const promise = this.runAccepted(
        {
          projectId: options.projectId,
          operationId: options.operationId,
          command: options.command,
          expectedHead: acceptedEventId,
          ...(deadlineAt === undefined ? {} : { deadlineAt })
        },
        reserved,
        lease
      );
      this.#active.set(options.operationId, {
        projectId: options.projectId,
        kind,
        promise,
        controller: reserved
      });
      void promise.finally(() => {
        releaseReservation();
        const projectId = this.#active.get(options.operationId)?.projectId;
        this.#active.delete(options.operationId);
        if (projectId) this.queueAssistantProject(projectId);
      });
      return { projectId: options.projectId, operationId: options.operationId, acceptedEventId };
    } catch (cause) {
      releaseReservation();
      this.#active.delete(options.operationId);
      if (lease) await lease.release();
      throw cause;
    }
  }

  /**
   * Mark operations abandoned by replaced processes as explicitly cancelled, and queue assistant
   * turns waiting to run. A scan still running is shared rather than overlapped. Each scan loads
   * a project once, and only if it has changed since a scan last found nothing to do in it: one
   * with an operation or a waiting turn is loaded every scan, until it settles, so work another
   * process abandons is still found. The first scan loads every project.
   */
  recoverInterrupted(): Promise<number> {
    this.#scan ??= this.scanProjects().finally(() => (this.#scan = undefined));
    return this.#scan;
  }

  private async scanProjects(): Promise<number> {
    let recovered = 0;
    const idleHeads = new Map<string, number>();
    for (const { projectId, eventCount } of await this.repository.list()) {
      if (this.#idleHeads.get(projectId) === eventCount) {
        idleHeads.set(projectId, eventCount);
        continue;
      }
      const document = await this.readableProject(projectId);
      if (!document) {
        if (this.#unreadable.has(projectId)) idleHeads.set(projectId, eventCount);
        continue;
      }
      const waiting = pendingAssistantTurnRequests(document).length > 0;
      if (!activeProjectOperation(document) && !waiting) {
        idleHeads.set(projectId, eventCount);
        continue;
      }
      try {
        if (await this.recoverProject(projectId, document)) recovered += 1;
        else if (waiting) this.queueAssistantProject(projectId);
      } catch (cause) {
        console.error(`Could not recover operations of project ${projectId}.`, cause);
      }
    }
    this.#idleHeads = idleHeads;
    return recovered;
  }

  /** Fail the project's active operation if no process runs it, saying whether one was failed. */
  private async recoverProject(projectId: string, document: ProjectDocument): Promise<boolean> {
    const active = activeProjectOperation(document);
    if (!active || this.#active.has(active.operationId)) return false;
    const lease = await this.lock.acquire(active.operationId);
    if (!lease) return false;
    try {
      const latest = await this.repository.load(projectId);
      const current = projectOperation(latest, active.operationId);
      if (!current || current.status === 'completed' || current.status === 'failed') return false;
      const related = latest.events.filter(
        (event) => event.operationId === active.operationId && event.id > active.acceptedEventId
      );
      await this.repository.append(projectId, latest.events.length, [
        ...recoveryEventsForInterruptedOperations(related),
        lifecycleFailure(
          active.operationId,
          active.kind,
          'cancelled',
          'The project operation was interrupted by a server restart. Retry the operation.'
        )
      ]);
    } finally {
      await lease.release();
    }
    this.queueAssistantProject(projectId);
    return true;
  }

  /** Periodically catch overlap where a replacement starts before the old process exits. */
  startRecovery(intervalMs = 30_000): void {
    if (this.#recoveryTimer) return;
    this.#recoveryTimer = setInterval(() => {
      void this.recoverInterrupted().catch((cause) =>
        console.error('Interrupted project operation recovery failed.', cause)
      );
    }, intervalMs);
    this.#recoveryTimer.unref();
  }

  /** Stop admission, cancel active work, and wait up to the configured drain deadline. */
  async shutdown(timeoutMs: number): Promise<void> {
    this.#accepting = false;
    this.#assistantProjects.clear();
    if (this.#recoveryTimer) clearInterval(this.#recoveryTimer);
    this.#recoveryTimer = undefined;
    for (const { controller } of this.#active.values()) controller.abort();
    const draining = Promise.allSettled([...this.#active.values()].map(({ promise }) => promise));
    await Promise.race([draining, delay(timeoutMs)]);
  }

  status(): { accepting: boolean; active: number; capacity: number } {
    return { accepting: this.#accepting, active: this.#active.size, capacity: this.capacity };
  }

  private async acceptInteraction(options: {
    projectId: string;
    operationId: string;
    expectedHead: number;
    command: Extract<ProjectOperationCommand, { type: 'feedback' | 'prefer' }>;
    actor?: 'user' | 'system';
    deadlineAt?: number;
    kind: 'feedback' | 'prefer';
  }): Promise<AcceptedProjectOperation> {
    await this.preemptRefill(options.projectId, options.expectedHead).catch(async (cause) => {
      if (!(cause instanceof Error) || cause.name !== 'ProjectConflictError') throw cause;
      const latest = await this.repository.load(options.projectId);
      if (options.expectedHead > latest.events.length) throw cause;
      return latest.events.length;
    });
    const lease = await this.lock.acquire(options.operationId);
    if (!lease) throw new Error('This operation is already running.');
    try {
      const accepted = await runProjectCommand(options.projectId, async () => {
        const document = await this.repository.load(options.projectId);
        const active = activeProjectOperation(document);
        if (active && active.kind !== 'assistant-turn') {
          throw new Error('This project already has an active operation.');
        }
        if (options.expectedHead > document.events.length) {
          const conflict = new Error('The project changed before this operation was accepted.');
          conflict.name = 'ProjectConflictError';
          throw conflict;
        }
        return this.repository.append(options.projectId, document.events.length, [
          lifecycleEvent(
            'operation.accepted',
            options.operationId,
            options.kind,
            options.actor ?? 'user'
          )
        ]);
      });
      const acceptedEventId = accepted.events[0].id;
      const controller = new AbortController();
      const graceUntil =
        options.deadlineAt === undefined ? undefined : operationGraceUntil(options.deadlineAt);
      const deadlineTimer =
        graceUntil === undefined
          ? undefined
          : setTimeout(
              () => controller.abort(projectOperationDeadlineError()),
              Math.max(0, graceUntil - Date.now())
            );
      deadlineTimer?.unref();
      try {
        await runWithProjectOperationSignal(
          controller.signal,
          () =>
            this.execute({
              projectId: options.projectId,
              operationId: options.operationId,
              expectedHead: acceptedEventId,
              command: options.command,
              signal: controller.signal,
              ...(options.deadlineAt === undefined ? {} : { deadlineAt: options.deadlineAt })
            }),
          options.deadlineAt,
          graceUntil
        );
        await this.appendCurrent(options.projectId, [
          lifecycleEvent(
            'operation.completed',
            options.operationId,
            options.kind,
            'user',
            pastDeadline(options.deadlineAt)
          )
        ]);
      } catch (cause) {
        await this.closeFailedOperation(
          options.projectId,
          options.operationId,
          options.kind,
          controller.signal.aborted ? 'cancelled' : 'infrastructure',
          controller.signal.aborted ? cancellationMessage(controller.signal) : messageFor(cause),
          pastDeadline(options.deadlineAt)
        );
      } finally {
        if (deadlineTimer) clearTimeout(deadlineTimer);
      }
      this.queueAssistantProject(options.projectId);
      return { projectId: options.projectId, operationId: options.operationId, acceptedEventId };
    } finally {
      await lease.release();
    }
  }

  private queueAssistantProject(projectId: string): void {
    if (!this.#accepting) return;
    this.#assistantProjects.add(projectId);
    if (!this.#assistantDrain) {
      this.#assistantDrain = this.drainAssistantTurns().finally(() => {
        this.#assistantDrain = undefined;
        if (
          this.#accepting &&
          this.#assistantProjects.size > 0 &&
          this.#active.size < this.capacity
        ) {
          const next = this.#assistantProjects.values().next().value as string;
          queueMicrotask(() => this.queueAssistantProject(next));
        }
      });
    }
  }

  private async drainAssistantTurns(): Promise<void> {
    while (this.#accepting && this.#active.size < this.capacity) {
      const projectId = this.#assistantProjects.values().next().value as string | undefined;
      if (!projectId) return;
      this.#assistantProjects.delete(projectId);
      let document: ProjectDocument;
      try {
        document = await this.repository.load(projectId);
      } catch (cause) {
        // One unreadable project must not reject the drain, which would end the whole process.
        console.error(`Could not load project ${projectId} for queued assistant turns.`, cause);
        continue;
      }
      if (activeProjectOperation(document)) continue;
      const requests = pendingAssistantTurnRequests(document);
      if (requests.length === 0) continue;
      const deadlineAt = requests
        .map((event) => event.payload.deadlineAt)
        .filter((value): value is string => value !== undefined)
        .toSorted()[0];
      try {
        await this.accept({
          projectId,
          operationId: randomUUID(),
          expectedHead: document.events.length,
          command: { type: 'assistant-turn', requestEventIds: requests.map(({ id }) => id) },
          actor: 'system',
          ...(deadlineAt ? { deadlineAt } : {})
        });
      } catch (cause) {
        if (cause instanceof ProjectOperationCapacityError) {
          this.#assistantProjects.add(projectId);
          return;
        }
        console.error(`Could not start queued assistant turn for ${projectId}.`, cause);
      }
    }
  }

  /**
   * A project for the scans across every project, none where it cannot be loaded, so one such
   * project stops no other: deleted since the list, its Timeline no longer reading as the events
   * are now defined (made before a change to them), logged once, or any other failure, logged.
   */
  private async readableProject(projectId: string): Promise<ProjectDocument | undefined> {
    try {
      return await this.repository.load(projectId);
    } catch (cause) {
      if (cause instanceof ProjectNotFoundError) return undefined;
      if (!(cause instanceof InvalidProjectDocumentError)) {
        console.error(`Could not load project ${projectId} while scanning projects.`, cause);
        return undefined;
      }
      if (!this.#unreadable.has(projectId)) {
        this.#unreadable.add(projectId);
        console.warn(
          `Skipping project ${projectId}, whose Timeline no longer reads.`,
          cause.message
        );
      }
      return undefined;
    }
  }

  private appendCurrent(projectId: string, events: NewProjectEvent[]) {
    return runProjectCommand(projectId, async () => {
      const document = await this.repository.load(projectId);
      for (const event of events)
        if (event.type === 'operation.completed' || event.type === 'operation.failed')
          logOperationCost(projectId, event.operationId, document.events);
      return this.repository.append(projectId, document.events.length, events);
    });
  }

  private appendAccepted(
    projectId: string,
    expectedHead: number,
    event: NewProjectEvent<'operation.accepted'>,
    mayRebase: boolean
  ) {
    return runProjectCommand(projectId, async () => {
      const document = await this.repository.load(projectId);
      if (activeProjectOperation(document)) {
        throw new Error('This project already has an active operation.');
      }
      return this.repository.append(projectId, mayRebase ? document.events.length : expectedHead, [
        event
      ]);
    });
  }

  private async preemptRefill(projectId: string, expectedHead: number): Promise<number> {
    const refill = [...this.#active.entries()].find(
      ([, active]) => active.projectId === projectId && active.kind === 'presentation-refill'
    );
    if (!refill) return expectedHead;
    const [operationId, active] = refill;
    await this.cancelRefill(operationId, active);
    const document = await this.repository.load(projectId);
    if (expectedHead > document.events.length) {
      const conflict = new Error('The project changed before this operation was accepted.');
      conflict.name = 'ProjectConflictError';
      throw conflict;
    }
    // Only the cancelled refill's own events may have come since, besides what never conflicts.
    const others = document.events
      .slice(expectedHead)
      .filter((event) => event.operationId !== operationId);
    if (!headStillCurrent(others, 0)) {
      const conflict = new Error('The project changed before this operation was accepted.');
      conflict.name = 'ProjectConflictError';
      throw conflict;
    }
    return document.events.length;
  }

  private async preemptAnyRefill(): Promise<void> {
    const refill = [...this.#active.entries()].find(
      ([, active]) => active.kind === 'presentation-refill'
    );
    if (refill) await this.cancelRefill(...refill);
  }

  private async cancelRefill(
    operationId: string,
    active: {
      promise: Promise<void>;
      controller: AbortController;
    }
  ): Promise<void> {
    active.controller.abort(new Error('Superseded by participant activity.'));
    await active.promise;
    this.#active.delete(operationId);
  }

  private async runAccepted(
    options: {
      projectId: string;
      operationId: string;
      expectedHead: number;
      command: ProjectOperationCommand;
      deadlineAt?: number;
    },
    controller: AbortController,
    lease: OperationLease
  ): Promise<void> {
    const kind = commandKind(options.command);
    const deadlineAt = options.deadlineAt;
    // A repair the page asks for after a runtime failure is no participant's request, so it gets no
    // grace: it stops at the deadline.
    const graceUntil =
      deadlineAt === undefined
        ? undefined
        : kind === 'report-runtime-error'
          ? deadlineAt
          : operationGraceUntil(deadlineAt);
    const deadlineTimer =
      graceUntil !== undefined
        ? setTimeout(
            () => controller.abort(projectOperationDeadlineError()),
            Math.max(0, graceUntil - Date.now())
          )
        : undefined;
    deadlineTimer?.unref();
    try {
      const result = await runWithProjectOperationSignal(
        controller.signal,
        () => this.execute({ ...options, signal: controller.signal }),
        deadlineAt,
        graceUntil
      );
      const terminalFailure = terminalFailureFor(kind, result.appendedEvents);
      await this.appendCurrent(options.projectId, [
        terminalFailure
          ? lifecycleFailure(
              options.operationId,
              kind,
              terminalFailure.failureKind,
              terminalFailure.message,
              pastDeadline(deadlineAt)
            )
          : lifecycleEvent(
              'operation.completed',
              options.operationId,
              kind,
              'user',
              pastDeadline(deadlineAt)
            )
      ]);
    } catch (cause) {
      const cancelled =
        controller.signal.aborted ||
        (cause instanceof Error && cause.name === 'StudyPhaseDeadlineError');
      await this.closeFailedOperation(
        options.projectId,
        options.operationId,
        kind,
        cancelled ? 'cancelled' : 'infrastructure',
        controller.signal.aborted ? cancellationMessage(controller.signal) : messageFor(cause),
        pastDeadline(deadlineAt)
      );
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      await lease.release();
    }
  }

  private async closeFailedOperation(
    projectId: string,
    operationId: string,
    kind: ProjectOperationKind,
    failureKind: 'infrastructure' | 'cancelled',
    message: string,
    pastDeadlineMs?: number
  ): Promise<void> {
    try {
      await runProjectCommand(projectId, async () => {
        const document = await this.repository.load(projectId);
        const operation = projectOperation(document, operationId);
        if (!operation || operation.status === 'completed' || operation.status === 'failed') return;
        logOperationCost(projectId, operationId, document.events);
        const related = document.events.filter(
          (event) => event.operationId === operationId && event.id > operation.acceptedEventId
        );
        await this.repository.append(projectId, document.events.length, [
          ...recoveryEventsForInterruptedOperations(related),
          lifecycleFailure(operationId, kind, failureKind, message, pastDeadlineMs)
        ]);
      });
    } catch (cause) {
      console.error(`Could not close failed project operation ${operationId}.`, cause);
    }
  }
}

const postgresOperationLock: OperationLock = {
  async acquire(operationId) {
    const connection = await sqlClient().reserve();
    let row: { acquired: boolean } | undefined;
    try {
      [row] = await connection<{ acquired: boolean }[]>`
        select pg_try_advisory_lock(hashtextextended(${operationId}, 0)) as acquired
      `;
    } catch (cause) {
      connection.release();
      throw cause;
    }
    if (!row?.acquired) {
      connection.release();
      return null;
    }
    return {
      async release() {
        await connection`
          select pg_advisory_unlock(hashtextextended(${operationId}, 0))
        `.catch(() => undefined);
        connection.release();
      }
    };
  }
};

const executorKey = Symbol.for('sverlin.project-operation-executor');
const loadedKey = Symbol.for('sverlin.project-operation-module');
type LoadedModule = { repository: ProjectRepository; lock: OperationLock; execute: ExecuteCommand };
const executorGlobal = globalThis as typeof globalThis & {
  [executorKey]?: ProjectOperationExecutor;
  [loadedKey]?: LoadedModule;
};
// The executor outlives development reloads. Its repository, lock, and commands resolve through
// the most recently loaded module so one process never mixes old and new event schemas; only the
// executor class itself needs a restart to change.
executorGlobal[loadedKey] = {
  repository: projectRepository,
  lock: postgresOperationLock,
  execute: executeProjectCommand
};

function latestLoaded(): LoadedModule {
  return executorGlobal[loadedKey] as LoadedModule;
}

/** Forward every member access to the latest loaded module's instance. */
function latestModule<T extends object>(select: (loaded: LoadedModule) => T): T {
  return new Proxy({} as T, {
    get(_target, key) {
      const current = select(latestLoaded());
      const value: unknown = Reflect.get(current, key);
      return typeof value === 'function' ? value.bind(current) : value;
    }
  });
}
export const projectOperationExecutor = (executorGlobal[executorKey] ??=
  new ProjectOperationExecutor());

async function executeProjectCommand(options: {
  projectId: string;
  expectedHead: number;
  operationId: string;
  command: ProjectOperationCommand;
  signal: AbortSignal;
  deadlineAt?: number;
}): Promise<ProjectCommandResult> {
  if (options.signal.aborted) throw options.signal.reason;
  const common = {
    projectId: options.projectId,
    expectedHead: options.expectedHead,
    operationId: options.operationId
  };
  switch (options.command.type) {
    case 'initial-build':
      return buildProjectPresentations({
        ...common,
        seed: options.command.seed,
        purpose: 'initial'
      });
    case 'rename':
      return renameProject({ ...common, title: options.command.title });
    case 'view-helpers':
      return setProjectViewHelpers({ ...common, enabled: options.command.enabled });
    case 'feedback':
      // Every mode's turn waits for the executor, which runs it under capacity, deadline and abort.
      return queueProjectFeedback({
        ...common,
        content: options.command.content,
        focus: options.command.focus,
        presentationCount: options.command.presentationCount,
        ...(options.command.from ? { from: options.command.from } : {}),
        ...(options.command.viewing ? { viewing: options.command.viewing } : {}),
        ...(options.deadlineAt === undefined
          ? {}
          : { deadlineAt: new Date(options.deadlineAt).toISOString() })
      });
    case 'advance-presentations':
      return advanceProjectPresentations({
        ...common,
        presentations: options.command.presentations
      });
    case 'report-runtime-error':
      return reportRuntimeFailure({
        ...common,
        presentationId: options.command.presentationId,
        message: options.command.message,
        ...(options.command.step === undefined ? {} : { step: options.command.step }),
        ...(options.deadlineAt === undefined
          ? {}
          : { deadlineAt: new Date(options.deadlineAt).toISOString() })
      });
    case 'rebuild':
      return buildProjectPresentations({
        ...common,
        seed: options.command.seed,
        purpose: 'seed-change'
      });
    case 'resample':
      return buildProjectPresentations({
        ...common,
        presentationCount: options.command.presentationCount,
        requestVariants: chosenVariantRequests(),
        ...(options.command.from ? { from: options.command.from } : {})
      });
    case 'presentation-refill':
      return replenishProjectPresentations({ ...common, target: options.command.target });
    case 'prefer':
      return queueProjectPreference({
        ...common,
        presentations: options.command.presentations,
        answer: preferenceAnswer(options.command),
        step: options.command.step,
        ...(options.command.comment ? { comment: options.command.comment } : {}),
        ...(options.deadlineAt === undefined
          ? {}
          : { deadlineAt: new Date(options.deadlineAt).toISOString() })
      });
    case 'assistant-turn': {
      const command = options.command;
      await runProjectCommand(options.projectId, async () => {
        const document = await projectRepository.load(options.projectId);
        const requests = command.requestEventIds.map((id) => document.events[id - 1]);
        if (requests.some((event) => event?.type !== 'assistant.turn-requested')) {
          throw new Error('The assistant operation references an unknown queued request.');
        }
        const interactionEventIds = requests.map((event) =>
          event?.type === 'assistant.turn-requested' ? event.payload.interactionEventId : 0
        );
        const viewHelpers = await projectViewHelpers(document);
        const helperCounts = viewHelpers
          ? await conditionHelperCounts(document.projectId)
          : undefined;
        await projectRepository.append(options.projectId, document.events.length, [
          {
            type: 'assistant.turn-started',
            actor: { kind: 'system' },
            operationId: options.operationId,
            createdAt: new Date().toISOString(),
            payload: {
              requestEventIds: command.requestEventIds,
              interactionEventIds,
              viewHelpers,
              ...(helperCounts ? { helperCounts } : {})
            }
          }
        ]);
      });
      return runQueuedAssistantTurn(common);
    }
    case 'save':
      return updateProjectArtifact({
        ...common,
        artifactId: options.command.artifactId,
        source: options.command.source,
        presentationCount: options.command.presentationCount,
        ...(options.command.from ? { from: options.command.from } : {}),
        ...(options.command.summary ? { summary: options.command.summary } : {}),
        ...(options.command.root ? { root: true } : {}),
        ...(options.command.variant ? { variant: options.command.variant } : {}),
        ...(options.command.unset ? { unset: options.command.unset } : {})
      });
    case 'restore':
      return restoreProjectArtifacts({
        ...common,
        from: options.command.from,
        seed: options.command.seed
      });
  }
}

function commandKind(command: ProjectOperationCommand): ProjectOperationKind {
  return command.type;
}

function lifecycleEvent<Type extends 'operation.accepted' | 'operation.completed'>(
  type: Type,
  operationId: string,
  kind: ProjectOperationKind,
  acceptedActor: 'user' | 'system' = 'user',
  pastDeadlineMs?: number
): NewProjectEvent<Type> {
  return {
    type,
    actor: type === 'operation.accepted' ? { kind: acceptedActor } : { kind: 'system' },
    operationId,
    createdAt: new Date().toISOString(),
    payload: { kind, ...(pastDeadlineMs ? { pastDeadlineMs } : {}) }
  } as NewProjectEvent<Type>;
}

function lifecycleFailure(
  operationId: string,
  kind: ProjectOperationKind,
  failureKind: 'domain' | 'infrastructure' | 'cancelled',
  message: string,
  pastDeadlineMs?: number
): NewProjectEvent<'operation.failed'> {
  return {
    type: 'operation.failed',
    actor: { kind: 'system' },
    operationId,
    createdAt: new Date().toISOString(),
    payload: {
      kind,
      failureKind,
      message: cutText(message, 4_000) || 'Project operation failed.',
      ...(pastDeadlineMs ? { pastDeadlineMs } : {})
    }
  };
}

/** How long after its phase's deadline an operation ends, in whole milliseconds, where it does. */
function pastDeadline(deadlineAt: number | undefined, now = Date.now()): number | undefined {
  return deadlineAt !== undefined && now > deadlineAt ? Math.ceil(now - deadlineAt) : undefined;
}

function terminalFailureFor(
  kind: ProjectOperationKind,
  events: readonly ProjectEvent[]
): { failureKind: 'domain' | 'infrastructure' | 'cancelled'; message: string } | undefined {
  if (kind === 'rename' || kind === 'advance-presentations' || kind === 'report-runtime-error')
    return undefined;
  const outcome = events.findLast((event) => {
    if (kind === 'feedback' || kind === 'prefer' || kind === 'assistant-turn') {
      return (
        event.type === 'assistant.responded' ||
        event.type === 'visualization.presented' ||
        event.type === 'ai.generation-failed' ||
        event.type === 'build.failed' ||
        (event.type === 'system.notified' && event.payload.severity === 'error')
      );
    }
    return event.type === 'visualization.presented' || event.type === 'build.failed';
  });
  if (!outcome) return undefined;
  const noticeMessage =
    outcome.type === 'system.notified' && outcome.payload.severity === 'error'
      ? outcome.payload.message
      : undefined;
  const failure =
    outcome.type === 'system.notified'
      ? (events.findLast(
          (event) => event.type === 'ai.generation-failed' || event.type === 'build.failed'
        ) ?? outcome)
      : outcome;
  if (failure.type === 'ai.generation-failed') {
    return {
      failureKind: failure.payload.failureKind === 'cancelled' ? 'cancelled' : 'infrastructure',
      message: noticeMessage ?? failure.payload.message
    };
  }
  if (failure.type === 'build.failed') {
    return {
      failureKind:
        failure.payload.failureKind === 'source'
          ? 'domain'
          : failure.payload.failureKind === 'cancelled'
            ? 'cancelled'
            : 'infrastructure',
      message:
        noticeMessage ??
        failure.payload.diagnostics[0]?.message ??
        failure.payload.error ??
        'Presentation build failed.'
    };
  }
  if (failure.type === 'system.notified' && failure.payload.severity === 'error') {
    return { failureKind: 'domain', message: failure.payload.message };
  }
  return undefined;
}

/**
 * The failure as participants see it. A database error's message quotes the query and its values,
 * the participant's own text among them, so it stays in the server log and they see a plain one.
 */
function messageFor(cause: unknown): string {
  if (cause instanceof DrizzleQueryError || cause instanceof postgres.PostgresError) {
    console.error('A project operation failed in the database.', cause);
    return 'The project could not be saved. Try again in a moment.';
  }
  return cutText(cause instanceof Error ? cause.message : String(cause), 4_000);
}

function cancellationMessage(signal: AbortSignal): string {
  const reason = signal.reason;
  return reason instanceof Error && reason.name !== 'AbortError'
    ? reason.message
    : 'The project operation was cancelled while the server was shutting down. Retry the operation.';
}

function parseDeadline(value?: string): number | undefined {
  if (!value) return undefined;
  const deadline = Date.parse(value);
  if (!Number.isFinite(deadline)) throw new Error('The project operation deadline is invalid.');
  return deadline;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds).unref());
}
