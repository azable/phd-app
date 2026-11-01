/** Participant-scoped, fail-isolated delivery for durable interaction observations. */

import type {
  StudyInteractionErrorResponse,
  StudyInteractionIngestionResult
} from '$lib/shared/study/interactions';

import {
  droppedStoredRecord,
  ResilientInteractionOutbox,
  type InteractionOutbox,
  type StoredInteractionEvent,
  type StoredInteractionSession
} from './interaction-outbox';

// One minute prevents request storms while leaving many attempts inside the 24-hour delivery window.
const maximumRetryDelayMs = 60_000;
// This matches the current study policy when durable session metadata cannot be read.
const fallbackFlushIntervalMs = 5_000;

export type ProjectInteractionDeliveryOptions = {
  participantId: string;
  outbox?: InteractionOutbox;
  fetch?: typeof fetch;
  now?: () => number;
};

type BatchDisposition = 'accepted' | 'abandoned' | 'blocked' | 'refresh' | 'retry';

/** Drains only the signed-in participant's sessions and never reports failures to the study UI. */
export class ProjectInteractionDelivery {
  readonly #participantId: string;
  readonly #outbox: InteractionOutbox;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  #started = false;
  #timer?: ReturnType<typeof setTimeout>;
  #flushInFlight?: Promise<void>;
  #flushRequested = false;
  #keepaliveRequested = false;
  #retryDelayMs?: number;

  constructor(options: ProjectInteractionDeliveryOptions) {
    this.#participantId = options.participantId;
    this.#outbox = options.outbox ?? new ResilientInteractionOutbox();
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = options.now ?? Date.now;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.#visibilityChanged);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.#online);
      window.addEventListener('pagehide', this.#pageHidden);
    }
    void this.flush();
  }

  stop(flush = true): void {
    if (!this.#started) return;
    this.#started = false;
    clearTimeout(this.#timer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#visibilityChanged);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.#online);
      window.removeEventListener('pagehide', this.#pageHidden);
    }
    if (flush) void this.flush(true);
  }

  requestFlush(): void {
    clearTimeout(this.#timer);
    if (this.#started) void this.flush();
  }

  async flush(keepalive = false): Promise<void> {
    this.#flushRequested = true;
    this.#keepaliveRequested ||= keepalive;
    this.#flushInFlight ??= this.#runRequestedFlushes();
    return this.#flushInFlight;
  }

  async #runRequestedFlushes(): Promise<void> {
    try {
      while (this.#flushRequested) {
        const keepalive = this.#keepaliveRequested;
        this.#flushRequested = false;
        this.#keepaliveRequested = false;
        await this.#withDeliveryLock(() => this.#flushSessions(keepalive));
      }
    } catch {
      this.#scheduleAfterUnexpectedFailure();
    } finally {
      this.#flushInFlight = undefined;
    }
  }

  async #flushSessions(keepalive: boolean): Promise<void> {
    let retry = false;
    const sessions = (await this.#outbox.sessions()).filter(
      ({ participantId }) => participantId === this.#participantId
    );
    for (const stored of sessions) {
      if (this.#expired(stored)) {
        await this.#outbox.abandon(stored.session.id);
        continue;
      }
      if (stored.blocked) continue;
      const disposition = await this.#flushSession(stored, keepalive);
      if (disposition === 'retry') {
        retry = true;
        break;
      }
    }
    this.#retryDelayMs = retry
      ? Math.min(
          maximumRetryDelayMs,
          this.#retryDelayMs === undefined ? minimumFlushInterval(sessions) : this.#retryDelayMs * 2
        )
      : undefined;
    if (this.#started) await this.#scheduleNext(retry);
  }

  async #flushSession(
    stored: StoredInteractionSession,
    keepalive: boolean
  ): Promise<BatchDisposition> {
    for (;;) {
      const events = await this.#outbox.events(stored.session.id);
      const pendingBatches = batches(events, stored.session.capture.flushByteThreshold);
      if (!pendingBatches.length) {
        if (!stored.terminal) return 'accepted';
        pendingBatches.push([]);
      }
      let refresh = false;
      for (const batch of pendingBatches) {
        const disposition = await this.#deliverBatch(stored, batch, keepalive);
        if (disposition === 'refresh') {
          refresh = true;
          break;
        }
        if (disposition !== 'accepted') return disposition;
      }
      if (!refresh) return 'accepted';
    }
  }

  async #deliverBatch(
    stored: StoredInteractionSession,
    batch: StoredInteractionEvent[],
    keepalive: boolean
  ): Promise<BatchDisposition> {
    let response: Response;
    try {
      response = await this.#fetch(
        `/api/projects/${encodeURIComponent(stored.session.projectId)}/interactions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session: stored.session,
            ...(stored.terminal ? { terminal: stored.terminal } : {}),
            events: batch.map(({ event }) => event)
          }),
          keepalive
        }
      );
    } catch {
      return 'retry';
    }

    if (response.ok) {
      const result = (await safeJson(response)) as Partial<StudyInteractionIngestionResult>;
      if (!Number.isSafeInteger(result.acceptedThrough)) return 'retry';
      await this.#outbox.acknowledge(stored.session.id, result.acceptedThrough as number);
      if (result.deliveryComplete === true) await this.#outbox.complete(stored.session.id);
      return 'accepted';
    }

    const error = (await safeJson(response)) as Partial<StudyInteractionErrorResponse>;
    if (response.status === 413) {
      if (batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        const left = await this.#deliverBatch(stored, batch.slice(0, middle), keepalive);
        if (left !== 'accepted') return left;
        return this.#deliverBatch(stored, batch.slice(middle), keepalive);
      }
      const [event] = batch;
      if (!event) {
        await this.#block(stored, 'terminal metadata exceeds the transport limit');
        return 'blocked';
      }
      await this.#outbox.replaceEvent(droppedStoredRecord(event, 'transport-limit'));
      return 'refresh';
    }
    if (response.status === 400 && error.code === 'invalid-event') {
      const invalid = batch[error.invalidEventIndex ?? -1];
      if (invalid) {
        await this.#outbox.replaceEvent(droppedStoredRecord(invalid, 'invalid-record'));
        return 'refresh';
      }
    }
    if (response.status === 409 && error.code === 'sequence-conflict') {
      if (Number.isSafeInteger(error.acceptedThrough)) {
        await this.#outbox.acknowledge(stored.session.id, error.acceptedThrough as number);
        const [next] = await this.#outbox.events(stored.session.id);
        if (next?.sequence === error.requiredNext) return 'refresh';
        if (
          !next &&
          stored.terminal?.recordedThrough === error.acceptedThrough &&
          error.requiredNext === (error.acceptedThrough as number) + 1
        ) {
          return 'refresh';
        }
      }
      await this.#block(stored, 'the server and local session sequences cannot be reconciled');
      return 'blocked';
    }
    if (response.status === 409 && error.code === 'future-project-head') return 'retry';
    if (response.status === 401) return 'retry';
    if (response.status === 403 || response.status === 410) {
      await this.#outbox.abandon(stored.session.id);
      console.warn('Participant interaction session was refused and discarded.', {
        sessionId: stored.session.id,
        reason: error.code ?? `HTTP ${response.status}`
      });
      return 'abandoned';
    }
    if (response.status === 429 || response.status >= 500) return 'retry';
    await this.#block(stored, error.code ?? `unexpected HTTP ${response.status}`);
    return 'blocked';
  }

  async #block(stored: StoredInteractionSession, reason: string): Promise<void> {
    await this.#outbox.block(stored.session.id, reason, new Date(this.#now()).toISOString());
    console.warn('Participant interaction delivery was quarantined.', {
      sessionId: stored.session.id,
      reason
    });
  }

  async #scheduleNext(retrying: boolean): Promise<void> {
    clearTimeout(this.#timer);
    const sessions = (await this.#outbox.sessions()).filter(
      ({ participantId }) => participantId === this.#participantId
    );
    if (!sessions.length) return;
    const now = this.#now();
    const activeIntervals = sessions
      .filter((session) => !session.blocked)
      .map(({ session }) => session.capture.flushIntervalMs);
    const expiryIntervals = sessions
      .filter(({ blocked, deliveryExpiresAt }) => blocked && deliveryExpiresAt)
      .map(({ deliveryExpiresAt }) => Math.max(0, new Date(deliveryExpiresAt!).getTime() - now));
    const delay = retrying
      ? (this.#retryDelayMs ?? minimumFlushInterval(sessions))
      : Math.min(...activeIntervals, ...expiryIntervals);
    if (!Number.isFinite(delay)) return;
    this.#timer = setTimeout(() => void this.flush(), Math.max(0, delay));
  }

  #scheduleAfterUnexpectedFailure(): void {
    if (!this.#started) return;
    this.#retryDelayMs = Math.min(
      maximumRetryDelayMs,
      this.#retryDelayMs === undefined ? fallbackFlushIntervalMs : this.#retryDelayMs * 2
    );
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), this.#retryDelayMs);
  }

  #expired(stored: StoredInteractionSession): boolean {
    return Boolean(
      stored.deliveryExpiresAt && this.#now() > new Date(stored.deliveryExpiresAt).getTime()
    );
  }

  async #withDeliveryLock(operation: () => Promise<void>): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.locks) return operation();
    await navigator.locks.request('sverlin-project-interaction-delivery', operation);
  }

  #visibilityChanged = () => {
    if (document.visibilityState === 'hidden') void this.flush(true);
  };
  #online = () => {
    this.#retryDelayMs = undefined;
    this.requestFlush();
  };
  #pageHidden = () => void this.flush(true);
}

function minimumFlushInterval(sessions: readonly StoredInteractionSession[]): number {
  return sessions.length
    ? Math.min(...sessions.map(({ session }) => session.capture.flushIntervalMs))
    : fallbackFlushIntervalMs;
}

function batches(
  events: StoredInteractionEvent[],
  maximumBytes: number
): StoredInteractionEvent[][] {
  const result: StoredInteractionEvent[][] = [];
  let current: StoredInteractionEvent[] = [];
  let bytes = 0;
  for (const event of events) {
    if (current.length && (current.length >= 100 || bytes + event.byteLength > maximumBytes)) {
      result.push(current);
      current = [];
      bytes = 0;
    }
    current.push(event);
    bytes += event.byteLength;
  }
  if (current.length) result.push(current);
  return result;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
