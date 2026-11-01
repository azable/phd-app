/**
 * Browser-side project state, commands, history navigation, and live event sync.
 *
 * @packageDocumentation
 */

import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

import {
  normalizeProjectEvent,
  type EventId,
  type ProjectEvent,
  type ProjectOperationKind
} from '$lib/shared/projects/events';
import {
  normalizeProjectResource,
  projectSchemaVersion,
  type ProjectCommandInput,
  type ProjectId,
  type ProjectResource,
  type ProjectSnapshot,
  type ProjectSummary,
  type WorkspaceResource
} from '$lib/shared/projects/model';
import type { PresentationLoadTiming } from '$lib/shared/presentation-load-timing';
import { defaultProjectCreation, type ProjectCreation } from '$lib/shared/projects/creation';
import { projectSnapshotAt, summarizeProject } from '$lib/shared/projects/projection';
import {
  activeProjectOperation,
  pendingAssistantTurnRequests,
  projectOperation,
  projectOperations
} from '$lib/shared/projects/operations';
import { presentationBufferState } from '$lib/shared/projects/presentation-buffer';

/** Browser-visible state of the project's durable event polling connection. */
export type ProjectConnectionState = 'connecting' | 'open' | 'reconnecting';

/** Metadata for the project command currently awaiting completion. */
export type PendingProjectCommand = {
  type: ProjectOperationKind;
  operationId: string;
  startedAfter: EventId;
};

/**
 * Owns one project's reactive browser session. The complete document is the
 * only synchronized state; snapshots and visualizations are local projections.
 */
export class ProjectSession {
  #submitting = $state.raw<PendingProjectCommand | null>(null);
  /** Whether a new template-backed project is currently being created. */
  creating = $state(false);
  /** Current state of the live event connection. */
  connection = $state<ProjectConnectionState>('connecting');
  /** Last user-facing session error. */
  error = $state<string | null>(null);
  /** Timeline events explicitly selected as feedback context. */
  focusedEvents = $state.raw<EventId[]>([]);
  #resource = $state.raw<ProjectResource | null>(null);
  #workspace = $state.raw<WorkspaceResource | null>(null);
  #selectedAt = $state<EventId | undefined>(undefined);
  #eventTimer?: ReturnType<typeof setInterval>;
  #request?: AbortController;
  #commandRequest?: AbortController;
  #refillRequest?: AbortController;
  /** View failures the presentations reported, waiting to be recorded, by presentation and message. */
  #runtimeReports = new SvelteMap<
    string,
    { presentationId: string; step?: number; message: string }
  >();
  #runtimeReportsSent = new SvelteSet<string>();
  #runtimeReportRequest?: AbortController;
  /** Load reports waiting to be sent, by presentation and outcome, and every one ever queued. */
  #loadReports = new SvelteMap<string, PresentationLoadTiming>();
  #loadReportsSeen = new SvelteSet<string>();
  #loadReportSending = false;
  #refillBlocked = false;
  #refillRetryTimer?: ReturnType<typeof setTimeout>;
  #loadVersion = 0;
  /** Last non-cancellation failure while filling the ahead-of-time presentation buffer. */
  refillError = $state<string | null>(null);

  constructor(
    readonly projectId: ProjectId,
    readonly developerView = true,
    readonly layout: 'single' | 'comparison' = 'single',
    readonly presentationBufferTarget?: number,
    readonly enforcedReadOnly = false
  ) {}

  /** Command currently accepted or running according to the durable Timeline. */
  get pending(): PendingProjectCommand | null {
    if (this.#submitting) return this.#submitting;
    const operation = this.#resource ? activeProjectOperation(this.#resource.document) : undefined;
    if (
      !operation ||
      operation.kind === 'presentation-refill' ||
      operation.kind === 'assistant-turn'
    )
      return null;
    return {
      type: operation.kind === 'initial-build' ? 'rebuild' : operation.kind,
      operationId: operation.operationId,
      startedAfter: operation.acceptedEventId - 1
    };
  }

  /** Background presentation generation currently recorded at the Timeline head. */
  get refillPending(): boolean {
    return (
      activeProjectOperation(this.events)?.kind === 'presentation-refill' || !!this.#refillRequest
    );
  }

  /** Whether durable queued or active assistant work should keep the response indicator visible. */
  get assistantResponding(): boolean {
    return (
      pendingAssistantTurnRequests(this.events).length > 0 ||
      projectOperations(this.events).some(
        ({ kind, status }) =>
          kind === 'assistant-turn' && (status === 'accepted' || status === 'running')
      )
    );
  }

  /** Complete project resource most recently received from the server. */
  get resource(): ProjectResource | null {
    return this.#resource;
  }

  /** Whether either authorized workspace representation has loaded. */
  get loaded(): boolean {
    return this.#resource !== null || this.#workspace !== null;
  }

  /** Whether the server has locked this workspace. */
  get readOnly(): boolean {
    return this.enforcedReadOnly || (this.#workspace?.readOnly ?? false);
  }

  /** Label used for retained user-authored messages in the current inspection context. */
  get userAuthorLabel(): string {
    return this.#workspace?.userAuthorLabel ?? 'You';
  }

  /** Project state reconstructed at the selected event position. */
  get snapshot(): ProjectSnapshot {
    if (!this.#resource) throw new Error('The project has not loaded.');
    return projectSnapshotAt(this.#resource.document, this.#selectedAt);
  }

  /** Available projects ordered by the server. */
  get projects(): ProjectSummary[] {
    return this.#resource?.projects ?? [];
  }

  /** Immutable events in the loaded project document. */
  get events(): ProjectEvent[] {
    return this.#resource?.document.events ?? [];
  }

  /** Stable event ID at the project head, or zero before loading. */
  get head(): number {
    return this.events.length;
  }

  /** Whether the session is viewing the current project state. */
  get atHead(): boolean {
    return this.loaded && this.#selectedAt === undefined;
  }

  /** Most recent streamed event belonging to the pending command. */
  get pendingEvent(): ProjectEvent | undefined {
    const pending = this.pending;
    if (!pending) return undefined;
    return this.events.findLast(
      (event) => event.id > pending.startedAfter && event.operationId === pending.operationId
    );
  }

  /** Select a historical event locally; omitting it follows the live head. */
  select(at?: EventId): void {
    if (at !== undefined && this.#resource && at > this.head) {
      this.error = `Unknown project event ${at}.`;
      this.#selectedAt = undefined;
      return;
    }
    this.#selectedAt = at;
  }

  /** Load the complete project resource once and start live synchronization. */
  async open(): Promise<void> {
    const version = ++this.#loadVersion;
    this.disconnect();
    this.#request?.abort();
    const request = new AbortController();
    this.#request = request;
    this.connection = 'connecting';

    try {
      const response = await fetch(this.resourceUrl(), {
        cache: 'no-store',
        signal: request.signal
      });
      if (!response.ok) throw new Error(await responseError(response));
      if (version !== this.#loadVersion) return;
      this.installResource(await response.json());
      this.select(this.#selectedAt);
      this.connect();
    } catch (cause) {
      if (request.signal.aborted || version !== this.#loadVersion) return;
      this.error = cause instanceof Error ? cause.message : 'The project could not be loaded.';
      this.connection = 'reconnecting';
    }
  }

  /** Stop requests and live updates owned by this session. */
  dispose(): void {
    this.#loadVersion += 1;
    this.#request?.abort();
    this.#commandRequest?.abort();
    this.#refillRequest?.abort();
    clearTimeout(this.#refillRetryTimer);
    this.#runtimeReportRequest?.abort();
    this.disconnect();
  }

  /** Toggle an event's inclusion in future feedback context. */
  toggleFocus(id: EventId): void {
    this.focusedEvents = this.focusedEvents.includes(id)
      ? this.focusedEvents.filter((focused) => focused !== id)
      : [...this.focusedEvents, id].toSorted((left, right) => left - right);
  }

  /** Remove an event from future feedback context. */
  removeFocus(id: EventId): void {
    this.focusedEvents = this.focusedEvents.filter((focused) => focused !== id);
  }

  /** Create a new project and navigate to it. */
  async createProject(
    creation: ProjectCreation = defaultProjectCreation,
    devMode = false
  ): Promise<boolean> {
    if (this.pending || this.creating) return false;
    this.creating = true;
    this.error = null;

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(creation)
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const { projectId } = (await response.json()) as { projectId: string };
      const path = resolve('/projects/[projectId]', { projectId });
      const parameters = devMode ? 'dev=1' : '';
      // The route is resolved above; the optional query controls browser-only detail.
      // eslint-disable-next-line svelte/no-navigation-without-resolve
      await goto(parameters ? `${path}?${parameters}` : path);
      return true;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : 'Project creation failed.';
      return false;
    } finally {
      this.creating = false;
    }
  }

  /** Submit a command and install the server's authoritative complete resource. */
  async runCommand(input: ProjectCommandInput): Promise<boolean> {
    if (this.pending || !this.loaded || !this.atHead || this.readOnly) return false;
    const operationId = crypto.randomUUID();
    const request = new AbortController();
    this.#commandRequest?.abort();
    this.#commandRequest = request;
    this.#submitting = { type: input.type, operationId, startedAfter: this.head };
    this.error = null;

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(this.projectId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, operationId, expectedHead: this.head }),
        signal: request.signal
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const accepted = (await response.json()) as { operationId: string };
      await this.reloadResource(request.signal);
      this.#submitting = null;
      await this.waitForOperation(accepted.operationId, request.signal);
      return true;
    } catch (cause) {
      if (request.signal.aborted) return false;
      this.error = cause instanceof Error ? cause.message : 'The project operation failed.';
      await this.open();
      return false;
    } finally {
      if (this.#commandRequest === request) {
        this.#commandRequest = undefined;
        this.#submitting = null;
      }
    }
  }

  /**
   * Record how a presentation loaded, for debugging (see presentation-load-timing.ts): its first
   * outcome, and a later ready after stalled, once each per page load. A viewer who may change the
   * project sends it when the project is quiet, to be recorded in the Timeline without affecting
   * the participant's own commands; any other viewer sends it at once, only to the server's log.
   */
  reportLoadTiming(timing: PresentationLoadTiming): void {
    const key = `${timing.presentationId} ${timing.outcome}`;
    if (this.#loadReportsSeen.has(key)) return;
    this.#loadReportsSeen.add(key);
    this.#loadReports.set(key, timing);
    this.flushLoadReports();
  }

  private flushLoadReports(): void {
    const next = this.#loadReports.entries().next();
    if (next.done || this.#loadReportSending) return;
    const busy =
      !this.#resource ||
      !this.atHead ||
      !!this.pending ||
      !!this.#refillRequest ||
      !!activeProjectOperation(this.events);
    if (!this.readOnly && busy) return;
    const [key, timing] = next.value;
    this.#loadReportSending = true;
    void fetch(`/api/projects/${encodeURIComponent(this.projectId)}/load-timings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(timing),
      keepalive: true
    })
      .then((response) => {
        // A conflict means an operation started; the report waits for the next quiet moment.
        if (response.status !== 409) this.#loadReports.delete(key);
      })
      .catch(() => {
        // A lost report only loses a diagnostic.
        this.#loadReports.delete(key);
      })
      .finally(() => {
        this.#loadReportSending = false;
        if (!this.#loadReports.has(key)) this.flushLoadReports();
      });
  }

  /**
   * Record that a presentation's view failed while drawing, for the assistant to fix. Reports are
   * sent in the background when the project is idle, once each, without affecting the participant's
   * own commands or messages.
   */
  reportRuntimeFailure(failure: { presentationId: string; step?: number; message: string }): void {
    const key = `${failure.presentationId} ${failure.message}`;
    if (this.readOnly || this.#runtimeReportsSent.has(key)) return;
    this.#runtimeReports.set(key, failure);
    this.flushRuntimeReports();
  }

  private flushRuntimeReports(): void {
    const next = this.#runtimeReports.entries().next();
    if (
      next.done ||
      !this.#resource ||
      !this.atHead ||
      this.readOnly ||
      this.pending ||
      this.#runtimeReportRequest ||
      activeProjectOperation(this.events)
    )
      return;
    const [key, failure] = next.value;
    const request = new AbortController();
    this.#runtimeReportRequest = request;
    void fetch(`/api/projects/${encodeURIComponent(this.projectId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'report-runtime-error',
        ...failure,
        operationId: crypto.randomUUID(),
        expectedHead: this.head
      }),
      signal: request.signal
    })
      .then(async (response) => {
        // A conflict means the project moved on; the report waits for the next quiet moment.
        if (response.status === 409) return;
        this.#runtimeReports.delete(key);
        this.#runtimeReportsSent.add(key);
        if (response.ok) await this.reloadResource(request.signal);
      })
      .catch(() => {
        if (!request.signal.aborted) this.#runtimeReports.delete(key);
      })
      .finally(() => {
        if (this.#runtimeReportRequest === request) this.#runtimeReportRequest = undefined;
      });
  }

  /** Explicitly retry a failed automatic presentation refill. */
  retryPresentationRefill(): void {
    this.#refillBlocked = false;
    this.refillError = null;
    this.reconcilePresentationBuffer();
    this.flushRuntimeReports();
    this.flushLoadReports();
  }

  /** Stop automatic generation when the local task timer reaches its deadline. */
  disablePresentationBuffer(): void {
    this.#refillBlocked = true;
    this.#refillRequest?.abort();
  }

  private connect(): void {
    if (!this.loaded) return;
    this.connection = 'open';
    this.#eventTimer = setInterval(() => void this.pollEvents(), 1_000);
  }

  private disconnect(): void {
    if (this.#eventTimer) clearInterval(this.#eventTimer);
    this.#eventTimer = undefined;
  }

  private async pollEvents(): Promise<void> {
    if (!this.loaded) return;
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(this.projectId)}/events?after=${this.head}`,
        { cache: 'no-store' }
      );
      if (!response.ok) throw new Error(await responseError(response));
      const value = (await response.json()) as { events?: unknown[] };
      for (const event of value.events ?? []) this.ingest(normalizeProjectEvent(event));
      this.connection = 'open';
    } catch {
      this.connection = 'reconnecting';
    }
  }

  private async waitForOperation(operationId: string, signal: AbortSignal): Promise<void> {
    for (;;) {
      await this.pollEvents();
      const operation = this.#resource
        ? projectOperation(this.#resource.document, operationId)
        : undefined;
      if (operation?.status === 'completed') return;
      if (operation?.status === 'failed') {
        throw new Error(
          operation.terminalEvent?.type === 'operation.failed'
            ? operation.terminalEvent.payload.message
            : 'The project operation failed.'
        );
      }
      await delay(1_000, signal);
    }
  }

  private async reloadResource(signal: AbortSignal): Promise<void> {
    const response = await fetch(this.resourceUrl(), {
      cache: 'no-store',
      signal
    });
    if (!response.ok) throw new Error(await responseError(response));
    this.installResource(await response.json());
  }

  private ingest(event: ProjectEvent): void {
    if (!this.#resource) return;
    const existing = this.#resource.document.events[event.id - 1];
    if (existing) {
      if (existing.operationId !== event.operationId || existing.type !== event.type) {
        void this.recover();
      }
      return;
    }
    if (event.id !== this.head + 1) return void this.recover();

    const document = {
      ...this.#resource.document,
      events: [...this.#resource.document.events, event]
    };
    const summary = summarizeProject(document);
    this.#resource = {
      document,
      projects: this.#resource.projects
        .map((project) => (project.projectId === this.projectId ? summary : project))
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    };
    const cancelledRefill =
      event.type === 'operation.failed' &&
      event.payload.kind === 'presentation-refill' &&
      event.payload.failureKind === 'cancelled';
    if (event.type === 'operation.failed' && event.payload.kind === 'presentation-refill') {
      if (event.payload.failureKind !== 'cancelled') {
        this.#refillBlocked = true;
        this.refillError = event.payload.message;
      }
    } else if (
      event.type === 'operation.completed' &&
      event.payload.kind === 'presentation-refill'
    ) {
      this.#refillBlocked = false;
      this.refillError = null;
    }
    if (!cancelledRefill) this.reconcilePresentationBuffer();
    this.flushLoadReports();
  }

  private async recover(): Promise<void> {
    this.connection = 'reconnecting';
    await this.open();
  }

  private resourceUrl(): string {
    const encoded = encodeURIComponent(this.projectId);
    if (this.developerView) return `/api/projects/${encoded}`;
    return `/api/projects/${encoded}/workspace?layout=${this.layout}`;
  }

  private installResource(value: unknown): void {
    if (this.developerView) {
      this.#resource = parseProjectResource(value);
      this.#workspace = null;
      this.restoreRefillFailure();
      this.reconcilePresentationBuffer();
      this.flushRuntimeReports();
      this.flushLoadReports();
      return;
    }
    const workspace = value as WorkspaceResource;
    if (
      workspace?.schemaVersion !== projectSchemaVersion ||
      workspace.projectId !== this.projectId ||
      workspace.document?.projectId !== this.projectId
    ) {
      throw new Error('The server returned an invalid project workspace.');
    }
    this.#workspace = workspace;
    this.#resource = normalizeProjectResource({
      document: workspace.document,
      projects: workspace.projects
    });
    this.restoreRefillFailure();
    this.reconcilePresentationBuffer();
    this.flushRuntimeReports();
    this.flushLoadReports();
  }

  private restoreRefillFailure(): void {
    const failure = this.events.findLast(
      (event) =>
        event.type === 'operation.failed' &&
        event.payload.kind === 'presentation-refill' &&
        event.payload.failureKind !== 'cancelled'
    );
    const laterSuccess = failure
      ? this.events.some(
          (event) =>
            event.id > failure.id &&
            event.type === 'operation.completed' &&
            event.payload.kind === 'presentation-refill'
        )
      : false;
    const retryRunning =
      activeProjectOperation(this.events)?.kind === 'presentation-refill' && !!failure;
    this.#refillBlocked = !!failure && !laterSuccess && !retryRunning;
    this.refillError =
      this.#refillBlocked && failure?.type === 'operation.failed' ? failure.payload.message : null;
  }

  private reconcilePresentationBuffer(): void {
    if (
      !this.presentationBufferTarget ||
      !this.#resource ||
      !this.atHead ||
      this.readOnly ||
      this.#refillBlocked ||
      this.#refillRequest ||
      activeProjectOperation(this.events)
    ) {
      return;
    }
    const buffer = presentationBufferState(this.#resource.document, this.presentationBufferTarget);
    if (!buffer.hasCurrentSourcePresentation || buffer.deficit === 0) return;
    const request = new AbortController();
    this.#refillRequest = request;
    const operationId = crypto.randomUUID();
    void fetch(`/api/projects/${encodeURIComponent(this.projectId)}/presentation-refill`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId, expectedHead: this.head }),
      signal: request.signal
    })
      .then(async (response) => {
        // The project moved on or the server is busy; the refill waits for the next quiet moment.
        if (response.status === 409 || response.status === 503) return this.retryRefillLater();
        if (!response.ok) throw new Error(await responseError(response));
        await this.reloadResource(request.signal);
      })
      .catch((cause: unknown) => {
        if (request.signal.aborted) return;
        this.#refillBlocked = true;
        this.refillError =
          cause instanceof Error ? cause.message : 'Presentation generation failed.';
      })
      .finally(() => {
        if (this.#refillRequest === request) this.#refillRequest = undefined;
      });
  }

  /** Try the refill again after a pause, unless a new event starts it sooner. */
  private retryRefillLater(): void {
    clearTimeout(this.#refillRetryTimer);
    this.#refillRetryTimer = setTimeout(() => {
      this.#refillRetryTimer = undefined;
      this.reconcilePresentationBuffer();
    }, refillRetryDelayMs);
  }
}

/**
 * Pause before retrying a refill that lost a race. Refills take tens of seconds, so a few more
 * go unnoticed, while a busy server sees at most one small rejected request per pause per page.
 */
const refillRetryDelayMs = 5_000;

function parseProjectResource(value: unknown): ProjectResource {
  return normalizeProjectResource(value);
}

async function responseError(response: Response): Promise<string> {
  try {
    const value = (await response.json()) as { error?: unknown };
    if (typeof value.error === 'string') return value.error;
  } catch {
    // Fall back to the status below.
  }
  return `Project request failed (${response.status}).`;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolveDelay();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
