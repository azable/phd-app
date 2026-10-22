/**
 * The event log: what the algorithm did between its steps, in order, beside the variables each
 * step records. Lit listings and identities read it; nothing is derived from it yet.
 */

import type { AnyNode } from 'acorn';

import type { Span } from './block.server';

export type EventKind =
  | 'call'
  | 'return'
  | 'enter'
  | 'iteration'
  | 'exit'
  | 'test'
  | 'break'
  | 'continue'
  | 'open'
  | 'close'
  | 'read'
  | 'write'
  | 'yield';

/**
 * One event, at the source it comes from: in the algorithm block, or in the domain block for the
 * body of an operation. A loop's events are at the loop, a test's at its condition.
 */
export type TraceEvent = {
  kind: EventKind;
  at: Span;
  block?: 'domain';
  /** For a read or write, the place by the name a step records it under, as values[3] or lo. */
  place?: string;
  /** A read's or write's value, a return's, or an operation's result, when it is a single value. */
  value?: string | number | boolean;
  /** The function called or the operation opened or closed. */
  name?: string;
  /** For an iteration, its number, from 0. */
  index?: number;
  /** For a test, whether it held. */
  held?: boolean;
  /** For a collection changed or read as a whole, the method, as push or slice. */
  method?: string;
};

/** Totals since the algorithm started: events by kind, and calls by operation and function. */
export type EventCounts = {
  events: Partial<Record<EventKind, number>>;
  operations: Record<string, number>;
  calls: Record<string, number>;
};

/** At most this many of the latest events are kept for each step. */
export const maximumStepEvents = 1_000;

/** An event as logged, before the step that keeps it gives it its span and value. */
type Slot = Omit<TraceEvent, 'at' | 'block' | 'value'> & {
  node: AnyNode;
  domain: boolean;
  value: unknown;
};

/**
 * The latest events in a ring of reused slots, as the algorithm may log a million between two
 * steps: only those a step keeps become events.
 */
export class EventLog {
  readonly #slots: Slot[] = [];
  #next = 0;
  #total = 0;
  readonly #counts: EventCounts = { events: {}, operations: {}, calls: {} };

  add(
    kind: EventKind,
    node: AnyNode,
    domain: boolean,
    place?: string,
    value?: unknown,
    details?: Pick<TraceEvent, 'name' | 'index' | 'held' | 'method'>
  ): void {
    let slot = this.#slots[this.#next];
    if (!slot) slot = this.#slots[this.#next] = { kind, node, domain, value };
    slot.kind = kind;
    slot.node = node;
    slot.domain = domain;
    slot.place = place;
    slot.value = value;
    slot.name = details?.name;
    slot.index = details?.index;
    slot.held = details?.held;
    slot.method = details?.method;
    this.#next = (this.#next + 1) % maximumStepEvents;
    this.#total += 1;
    const { events, operations, calls } = this.#counts;
    events[kind] = (events[kind] ?? 0) + 1;
    if (kind === 'open' && details?.name)
      operations[details.name] = (operations[details.name] ?? 0) + 1;
    if (kind === 'call' && details?.name) calls[details.name] = (calls[details.name] ?? 0) + 1;
  }

  /**
   * The events since the last step, the latest kept, each placed in its block's source and with its
   * value if a single one; how many were dropped; and the totals.
   */
  step(
    locate: (node: AnyNode) => Span,
    single: (value: unknown) => TraceEvent['value']
  ): { events: TraceEvent[]; dropped?: number; counts: EventCounts } {
    const kept = Math.min(this.#total, maximumStepEvents);
    const events: TraceEvent[] = [];
    for (let index = 0; index < kept; index++) {
      const slot = this.#slots[(this.#next - kept + index + maximumStepEvents) % maximumStepEvents];
      const value = single(slot.value);
      events.push({
        kind: slot.kind,
        at: locate(slot.node),
        ...(slot.domain ? { block: 'domain' as const } : {}),
        ...(slot.place !== undefined ? { place: slot.place } : {}),
        ...(value !== undefined ? { value } : {}),
        ...(slot.name !== undefined ? { name: slot.name } : {}),
        ...(slot.index !== undefined ? { index: slot.index } : {}),
        ...(slot.held !== undefined ? { held: slot.held } : {}),
        ...(slot.method !== undefined ? { method: slot.method } : {})
      });
    }
    const dropped = this.#total - kept;
    this.#total = 0;
    this.#next = 0;
    const { events: kinds, operations, calls } = this.#counts;
    return {
      events,
      ...(dropped ? { dropped } : {}),
      counts: { events: { ...kinds }, operations: { ...operations }, calls: { ...calls } }
    };
  }
}
