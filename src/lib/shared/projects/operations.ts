/** Pure projections for asynchronous operation state recorded in a project Timeline. */

import type { EventId, ProjectEvent, ProjectOperationKind } from './events';
import type { ProjectDocument } from './model';

/**
 * How long an operation still running when its study phase ends may go on to publish its result,
 * and the page waits for it: one model call at its 180-second request ceiling
 * (readRequestTimeoutMs) plus that attempt's build, as no further attempt starts after the
 * deadline; five minutes bounds a build that runs long.
 */
export const studyPhaseGraceMs = 5 * 60_000;

/** One durable interaction waiting to be claimed by a background assistant turn. */
export type PendingAssistantTurnRequest = Extract<
  ProjectEvent,
  { type: 'assistant.turn-requested' }
>;

/** Current state of one accepted project operation. */
export type ProjectOperation = {
  operationId: string;
  kind: ProjectOperationKind;
  acceptedEventId: EventId;
  status: 'accepted' | 'running' | 'completed' | 'failed';
  terminalEvent?: Extract<ProjectEvent, { type: 'operation.completed' | 'operation.failed' }>;
};

/** Reconstruct every explicitly accepted operation in Timeline order. */
export function projectOperations(
  value: ProjectDocument | readonly ProjectEvent[]
): ProjectOperation[] {
  const events = 'events' in value ? value.events : value;
  const operations = new Map<string, ProjectOperation>();

  for (const event of events) {
    if (event.type === 'operation.accepted') {
      operations.set(event.operationId, {
        operationId: event.operationId,
        kind: event.payload.kind,
        acceptedEventId: event.id,
        status: 'accepted'
      });
      continue;
    }
    const operation = operations.get(event.operationId);
    if (!operation || operation.terminalEvent) continue;
    if (event.type === 'operation.completed' || event.type === 'operation.failed') {
      operation.status = event.type === 'operation.completed' ? 'completed' : 'failed';
      operation.terminalEvent = event;
    } else {
      operation.status = 'running';
    }
  }
  return [...operations.values()];
}

/** Find an explicitly accepted operation by its opaque correlation identifier. */
export function projectOperation(
  value: ProjectDocument | readonly ProjectEvent[],
  operationId: string
): ProjectOperation | undefined {
  return projectOperations(value).find((operation) => operation.operationId === operationId);
}

/** Return the first unfinished operation, if the project is currently busy. */
export function activeProjectOperation(
  value: ProjectDocument | readonly ProjectEvent[]
): ProjectOperation | undefined {
  return projectOperations(value).find(
    ({ status }) => status === 'accepted' || status === 'running'
  );
}

/** Return assistant requests that no started turn has claimed. */
export function pendingAssistantTurnRequests(
  value: ProjectDocument | readonly ProjectEvent[]
): PendingAssistantTurnRequest[] {
  const events = 'events' in value ? value.events : value;
  const claimed = new Set(
    events.flatMap((event) =>
      event.type === 'assistant.turn-started' ? event.payload.requestEventIds : []
    )
  );
  return events.filter(
    (event): event is PendingAssistantTurnRequest =>
      event.type === 'assistant.turn-requested' && !claimed.has(event.id)
  );
}

/** Find the durable claim associated with one assistant operation. */
export function assistantTurnClaim(
  value: ProjectDocument | readonly ProjectEvent[],
  operationId: string
): Extract<ProjectEvent, { type: 'assistant.turn-started' }> | undefined {
  const events = 'events' in value ? value.events : value;
  return events.find(
    (event): event is Extract<ProjectEvent, { type: 'assistant.turn-started' }> =>
      event.type === 'assistant.turn-started' && event.operationId === operationId
  );
}
