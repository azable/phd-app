/** Fail-isolated browser recorder for coarse project-workspace replay. */

import * as v from 'valibot';

import type { MessageContent } from '$lib/shared/projects/events/message-content';
import {
  studyInteractionEventInputSchema,
  type StudyInteractionEventInput,
  type StudyInteractionCapturePolicy,
  type StudyInteractionSessionInput,
  type StudyWorkspaceObservation
} from '$lib/shared/study/interactions';

import { ProjectInteractionDelivery } from './interaction-delivery';
import {
  droppedStoredRecord,
  ResilientInteractionOutbox,
  type InteractionOutbox,
  type StoredInteractionEvent
} from './interaction-outbox';

// This retains useful unsent text while keeping one record below the 32 KiB flush target.
const maximumDraftBytes = 16 * 1024;
// Rapid Svelte updates settle before one combined state observation is stored.
const stateDebounceMs = 100;

export type ProjectInteractionRecorderOptions = {
  projectId: string;
  participantId: string;
  capture: StudyInteractionCapturePolicy;
  applicationVersion: string;
  buildSha?: string;
  captureEndsAt?: string;
  outbox?: InteractionOutbox;
  fetch?: typeof fetch;
  now?: () => number;
  monotonicNow?: () => number;
  readProjectHead?: () => number;
};

type InteractionRecord = StudyInteractionEventInput extends infer Event
  ? Event extends StudyInteractionEventInput
    ? Omit<Event, 'sequence' | 'elapsedMs' | 'clientOccurredAt' | 'projectHead'>
    : never
  : never;

/** Records only allowlisted state and never exposes a failure to the project UI. */
export class ProjectInteractionRecorder {
  readonly #options: ProjectInteractionRecorderOptions;
  readonly #outbox: InteractionOutbox;
  readonly #delivery: ProjectInteractionDelivery;
  readonly #now: () => number;
  readonly #monotonicNow: () => number;
  readonly #startedMonotonic: number;
  readonly #captureEndsAt?: number;
  readonly #session: StudyInteractionSessionInput;
  #sequence = 0;
  #lastProjectHead = 0;
  #lastState?: StudyWorkspaceObservation;
  #root?: HTMLElement;
  #queue = Promise.resolve();
  #stateTimer?: ReturnType<typeof setTimeout>;
  #draftTimer?: ReturnType<typeof setTimeout>;
  #pendingDraft?: { content: MessageContent; focused: boolean };
  #lastDraftAt = -Infinity;
  #checkpointTimer?: ReturnType<typeof setInterval>;
  #expiryTimer?: ReturnType<typeof setTimeout>;
  #pointerStartedAt?: number;
  #pointerLastSampleAt = -Infinity;
  #pointerPoints: Array<{
    offsetMs: number;
    clientX: number;
    clientY: number;
    normalizedX: number;
    normalizedY: number;
    region?: string;
  }> = [];
  #pointerType: 'mouse' | 'pen' | 'touch' | 'unknown' = 'unknown';
  #stopped = false;
  #disposed = false;
  #storageUnavailableReported = false;

  constructor(options: ProjectInteractionRecorderOptions) {
    this.#options = options;
    this.#outbox = options.outbox ?? new ResilientInteractionOutbox();
    this.#delivery = new ProjectInteractionDelivery({
      participantId: options.participantId,
      outbox: this.#outbox,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.now ? { now: options.now } : {})
    });
    this.#now = options.now ?? Date.now;
    // performance.now is immune to wall-clock corrections during a task.
    this.#monotonicNow =
      options.monotonicNow ??
      (() => (typeof performance === 'undefined' ? this.#now() : performance.now()));
    this.#startedMonotonic = this.#monotonicNow();
    const startedAt = this.#now();
    this.#captureEndsAt = options.captureEndsAt
      ? new Date(options.captureEndsAt).getTime()
      : undefined;
    this.#session = {
      id: crypto.randomUUID(),
      projectId: options.projectId,
      schemaVersion: 1,
      clientStartedAt: new Date(startedAt).toISOString(),
      timeOrigin:
        typeof performance === 'undefined' ? startedAt : Math.max(0, performance.timeOrigin),
      initialViewport: browserViewport(),
      applicationVersion: options.applicationVersion,
      ...(options.buildSha ? { buildSha: options.buildSha } : {}),
      capture: options.capture
    };
  }

  /** Attach lifecycle capture and begin opportunistically draining prior sessions. */
  start(root: HTMLElement): void {
    if (this.#root || this.#stopped) return;
    if (this.#captureEndsAt !== undefined && this.#now() >= this.#captureEndsAt) {
      this.#stopped = true;
      return;
    }
    this.#root = root;
    root.addEventListener('click', this.#activated, { capture: true });
    root.addEventListener('pointermove', this.#pointerMoved, { passive: true });
    root.addEventListener('pointerover', this.#regionEntered, { passive: true });
    root.addEventListener('pointerout', this.#regionLeft, { passive: true });
    root.addEventListener('focusin', this.#regionFocused);
    this.#safely(async () => {
      await this.#outbox.putSession({
        session: this.#session,
        participantId: this.#options.participantId,
        ...(this.#captureEndsAt !== undefined
          ? {
              deliveryExpiresAt: new Date(
                this.#captureEndsAt + this.#options.capture.lateDeliverySeconds * 1_000
              ).toISOString()
            }
          : {})
      });
      if (!this.#disposed) this.#delivery.start();
    });
    document.addEventListener('visibilitychange', this.#visibilityChanged);
    window.addEventListener('focus', this.#focused);
    window.addEventListener('blur', this.#blurred);
    window.addEventListener('online', this.#online);
    window.addEventListener('offline', this.#offline);
    window.addEventListener('resize', this.#resized, { passive: true });
    this.#checkpointTimer = setInterval(
      () => this.#recordLastState('checkpoint'),
      this.#options.capture.checkpointIntervalMs
    );
    if (this.#captureEndsAt !== undefined) {
      this.#expiryTimer = setTimeout(
        () => this.stop(false),
        Math.max(0, this.#captureEndsAt - this.#now())
      );
    }
  }

  /** Record an explicit projection of Svelte-owned workspace state. */
  recordWorkspaceState(
    state: StudyWorkspaceObservation,
    reason: 'changed' | 'started' = 'changed'
  ): void {
    if (!this.#canRecord()) return;
    const first = !this.#lastState;
    this.#lastProjectHead = state.projectHead;
    this.#lastState = withCurrentDocumentState(state);
    if (reason === 'started' || first) {
      this.#recordLastState('started');
      return;
    }
    clearTimeout(this.#stateTimer);
    this.#stateTimer = setTimeout(() => this.#recordLastState('changed'), stateDebounceMs);
  }

  /** Capture an allowlisted activation target from the workspace root. */
  recordActivation(event: MouseEvent): void {
    if (!this.#canRecord() || !this.#root) return;
    const target = interactionTarget(event.target);
    if (!target || !this.#root.contains(target)) return;
    const position = normalizedPosition(event.clientX, event.clientY);
    this.#record({
      kind: 'ui.activated',
      payload: {
        input: event.detail === 0 ? 'keyboard' : 'pointer',
        action: interactionName(target),
        ...(interactionRegion(target) ? { region: interactionRegion(target) } : {}),
        clientX: event.clientX,
        clientY: event.clientY,
        normalizedX: position.x,
        normalizedY: position.y,
        button: Math.max(0, Math.min(5, event.button)),
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey
      }
    });
  }

  /** Sample pointer motion and store it in compact time-bounded chunks. */
  recordPointerMove(event: PointerEvent): void {
    if (!this.#canRecord()) return;
    const now = this.#monotonicNow();
    if (now - this.#pointerLastSampleAt < this.#options.capture.cursorSampleIntervalMs) return;
    if (
      this.#pointerStartedAt !== undefined &&
      now - this.#pointerStartedAt >= this.#options.capture.cursorChunkDurationMs
    ) {
      this.#flushPointerPath();
    }
    this.#pointerStartedAt ??= now;
    this.#pointerLastSampleAt = now;
    this.#pointerType = pointerType(event.pointerType);
    const position = normalizedPosition(event.clientX, event.clientY);
    const region = interactionRegion(event.target instanceof Element ? event.target : undefined);
    this.#pointerPoints.push({
      offsetMs: Math.max(0, Math.round(now - this.#pointerStartedAt)),
      clientX: event.clientX,
      clientY: event.clientY,
      normalizedX: position.x,
      normalizedY: position.y,
      ...(region ? { region } : {})
    });
    if (this.#pointerPoints.length >= 32) this.#flushPointerPath();
  }

  /** Throttle unsent structured feedback independently from submitted Timeline data. */
  recordDraft(content: MessageContent, focused: boolean): void {
    if (!this.#canRecord()) return;
    this.#pendingDraft = { content, focused };
    if (this.#draftTimer) return;
    const delay = Math.max(
      0,
      this.#options.capture.draftSnapshotIntervalMs - (this.#monotonicNow() - this.#lastDraftAt)
    );
    this.#draftTimer = setTimeout(() => this.#flushDraft(), delay);
  }

  /** Stop new capture while the independent delivery loop keeps draining this session. */
  stop(recordTerminal = true): void {
    if (this.#stopped) return;
    const withinCapture = this.#captureEndsAt === undefined || this.#now() <= this.#captureEndsAt;
    clearTimeout(this.#stateTimer);
    clearTimeout(this.#draftTimer);
    this.#draftTimer = undefined;
    clearInterval(this.#checkpointTimer);
    clearTimeout(this.#expiryTimer);
    document.removeEventListener('visibilitychange', this.#visibilityChanged);
    window.removeEventListener('focus', this.#focused);
    window.removeEventListener('blur', this.#blurred);
    window.removeEventListener('online', this.#online);
    window.removeEventListener('offline', this.#offline);
    window.removeEventListener('resize', this.#resized);
    this.#root?.removeEventListener('click', this.#activated, { capture: true });
    this.#root?.removeEventListener('pointermove', this.#pointerMoved);
    this.#root?.removeEventListener('pointerover', this.#regionEntered);
    this.#root?.removeEventListener('pointerout', this.#regionLeft);
    this.#root?.removeEventListener('focusin', this.#regionFocused);
    if (withinCapture && recordTerminal) {
      this.#flushPointerPath();
      this.#flushDraft();
      this.#record({ kind: 'document.lifecycle', payload: { state: 'stopped' } });
    } else {
      this.#pointerPoints = [];
      this.#pendingDraft = undefined;
    }
    this.#stopped = true;
    const stoppedAt = new Date(
      this.#captureEndsAt === undefined ? this.#now() : Math.min(this.#now(), this.#captureEndsAt)
    ).toISOString();
    this.#safely(async () => {
      await this.#outbox.finalize(this.#session.id, {
        clientStoppedAt: stoppedAt,
        recordedThrough: this.#sequence
      });
      await this.#delivery.flush(true);
    });
  }

  /** Stop capture and detach delivery listeners when the workspace is destroyed. */
  dispose(): void {
    this.#disposed = true;
    this.stop();
    // stop() already queues a keepalive flush after terminal metadata; only detach here.
    this.#delivery.stop(false);
  }

  /** Drain durable sessions after all observations already queued by this recorder. */
  async flush(keepalive = false): Promise<void> {
    await this.#queue;
    await this.#delivery.flush(keepalive);
  }

  #recordLastState(reason: 'changed' | 'checkpoint' | 'started' | 'resumed'): void {
    if (!this.#lastState) return;
    this.#record({
      kind: 'workspace.state',
      payload: { reason, state: withCurrentDocumentState(this.#lastState) }
    });
  }

  #recordRegion(event: Event, state: 'entered' | 'left' | 'focused'): void {
    if (!this.#canRecord() || !this.#root) return;
    const region = replayPresentationRegion(event.target);
    if (!region || !this.#root.contains(region)) return;
    if (event instanceof PointerEvent && replayPresentationRegion(event.relatedTarget) === region) {
      return;
    }
    const rect = region.getBoundingClientRect();
    const viewportWidth = Math.max(1, globalThis.innerWidth ?? 1);
    const viewportHeight = Math.max(1, globalThis.innerHeight ?? 1);
    this.#record({
      kind: 'ui.region',
      payload: {
        state,
        region: region.dataset.replayRegion!,
        ...(region.dataset.replayPresentationId
          ? { presentationId: region.dataset.replayPresentationId }
          : {}),
        bounds: {
          x: clamp(rect.left / viewportWidth, 0, 1),
          y: clamp(rect.top / viewportHeight, 0, 1),
          width: clamp(rect.width / viewportWidth, 0, 1),
          height: clamp(rect.height / viewportHeight, 0, 1)
        }
      }
    });
  }

  #flushPointerPath(): void {
    if (!this.#pointerPoints.length) return;
    const points = this.#pointerPoints;
    const pointerTypeValue = this.#pointerType;
    this.#pointerPoints = [];
    this.#pointerStartedAt = undefined;
    this.#record({ kind: 'pointer.path', payload: { pointerType: pointerTypeValue, points } });
  }

  #flushDraft(): void {
    this.#draftTimer = undefined;
    const pending = this.#pendingDraft;
    this.#pendingDraft = undefined;
    if (!pending) return;
    this.#lastDraftAt = this.#monotonicNow();
    const limited = limitDraft(pending.content);
    this.#record({
      kind: 'draft.snapshot',
      payload: {
        content: limited.content,
        focused: pending.focused,
        truncated: limited.truncated,
        originalByteLength: limited.originalByteLength
      }
    });
  }

  #record(value: InteractionRecord): void {
    if (!this.#canRecord()) return;
    const now = validTime(this.#now());
    const sequence = ++this.#sequence;
    const envelope = {
      sequence,
      elapsedMs: natural(this.#monotonicNow() - this.#startedMonotonic),
      clientOccurredAt: new Date(now).toISOString(),
      projectHead: natural(this.#options.readProjectHead?.() ?? this.#lastProjectHead)
    };
    const parsed = v.safeParse(studyInteractionEventInputSchema, {
      ...envelope,
      ...value
    });
    const event: StudyInteractionEventInput = parsed.success
      ? parsed.output
      : {
          ...envelope,
          kind: 'recorder.dropped',
          payload: { counts: { [value.kind]: 1 }, reason: 'invalid-record' }
        };
    const stored: StoredInteractionEvent = {
      sessionId: this.#session.id,
      sequence: event.sequence,
      event,
      byteLength: new TextEncoder().encode(JSON.stringify(event)).byteLength
    };
    this.#safely(async () => {
      const result = await this.#outbox.putEvent(stored, this.#options.capture.outboxByteLimit);
      if (!result.stored) {
        await this.#outbox.replaceEvent(droppedStoredRecord(stored, 'outbox-limit'));
      }
      if (result.storageUnavailable && !this.#storageUnavailableReported) {
        this.#storageUnavailableReported = true;
        this.#record({
          kind: 'recorder.dropped',
          payload: { counts: { 'durable-storage': 1 }, reason: 'storage-unavailable' }
        });
      }
      const count = (await this.#outbox.events(this.#session.id)).length;
      if (count >= this.#options.capture.flushRecordThreshold) this.#delivery.requestFlush();
    });
  }

  #safely(operation: () => Promise<void>): void {
    this.#queue = this.#queue.then(operation, operation).catch(() => undefined);
  }

  #canRecord(): boolean {
    if (this.#stopped) return false;
    if (this.#captureEndsAt !== undefined && this.#now() > this.#captureEndsAt) {
      this.stop(false);
      return false;
    }
    return true;
  }

  #visibilityChanged = () => {
    this.#record({
      kind: 'document.lifecycle',
      payload: { state: document.visibilityState === 'hidden' ? 'hidden' : 'visible' }
    });
    this.#recordLastState('resumed');
    if (document.visibilityState === 'hidden') void this.flush(true);
  };
  #focused = () => this.#record({ kind: 'document.lifecycle', payload: { state: 'focused' } });
  #blurred = () => this.#record({ kind: 'document.lifecycle', payload: { state: 'blurred' } });
  #online = () => {
    this.#record({ kind: 'document.lifecycle', payload: { state: 'online' } });
    void this.flush();
  };
  #offline = () => this.#record({ kind: 'document.lifecycle', payload: { state: 'offline' } });
  #resized = () => this.#recordLastState('changed');
  #activated = (event: MouseEvent) => this.recordActivation(event);
  #pointerMoved = (event: PointerEvent) => this.recordPointerMove(event);
  #regionEntered = (event: PointerEvent) => this.#recordRegion(event, 'entered');
  #regionLeft = (event: PointerEvent) => this.#recordRegion(event, 'left');
  #regionFocused = (event: FocusEvent) => this.#recordRegion(event, 'focused');
}

function withCurrentDocumentState(state: StudyWorkspaceObservation): StudyWorkspaceObservation {
  return {
    ...state,
    document: {
      visibility: document.visibilityState === 'hidden' ? 'hidden' : 'visible',
      focused: document.hasFocus(),
      viewport: browserViewport()
    }
  };
}

function browserViewport() {
  return {
    width: Math.max(0, Math.round(globalThis.innerWidth ?? 0)),
    height: Math.max(0, Math.round(globalThis.innerHeight ?? 0)),
    devicePixelRatio: Math.max(0.1, globalThis.devicePixelRatio ?? 1)
  };
}

function normalizedPosition(clientX: number, clientY: number) {
  return {
    x: clamp(clientX / Math.max(1, globalThis.innerWidth ?? 1), 0, 1),
    y: clamp(clientY / Math.max(1, globalThis.innerHeight ?? 1), 0, 1)
  };
}

function interactionTarget(target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof Element)) return undefined;
  return (
    target.closest<HTMLElement>(
      '[data-interaction],button,a,input,select,textarea,[role="button"],[contenteditable="true"]'
    ) ?? undefined
  );
}

/** What an activated element is called in the recording: never its text, which may be the participant's. */
export function interactionName(target: HTMLElement): string {
  return (
    target.dataset.interaction ||
    target.getAttribute('aria-label') ||
    target.getAttribute('name') ||
    target.getAttribute('title') ||
    target.getAttribute('role') ||
    target.tagName.toLowerCase()
  ).slice(0, 128);
}

function interactionRegion(target?: Element): string | undefined {
  return target?.closest<HTMLElement>('[data-replay-region]')?.dataset.replayRegion?.slice(0, 128);
}

function replayPresentationRegion(target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof Element)) return undefined;
  return (
    target.closest<HTMLElement>('[data-replay-region][data-replay-presentation-id]') ?? undefined
  );
}

function pointerType(value: string): 'mouse' | 'pen' | 'touch' | 'unknown' {
  return value === 'mouse' || value === 'pen' || value === 'touch' ? value : 'unknown';
}

function limitDraft(content: MessageContent): {
  content: MessageContent;
  truncated: boolean;
  originalByteLength: number;
} {
  const originalByteLength = encodedLength(content);
  const boundedContent = content.slice(0, 200);
  if (originalByteLength <= maximumDraftBytes && boundedContent.length === content.length) {
    return { content: boundedContent, truncated: false, originalByteLength };
  }
  const retained: MessageContent = [];
  for (const segment of boundedContent) {
    const candidate = [...retained, segment];
    if (encodedLength(candidate) <= maximumDraftBytes) {
      retained.push(segment);
      continue;
    }
    if (segment.type === 'markdown') {
      let text = segment.text;
      while (
        text.length &&
        encodedLength([...retained, { ...segment, text }]) > maximumDraftBytes
      ) {
        text = text.slice(0, Math.floor(text.length * 0.9));
      }
      if (text) retained.push({ ...segment, text });
    }
    break;
  }
  return { content: retained, truncated: true, originalByteLength };
}

function encodedLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

function natural(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function validTime(value: number): number {
  return Number.isFinite(value) ? value : Date.now();
}
