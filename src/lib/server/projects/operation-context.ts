/** Async context used to propagate operation cancellation through service boundaries. */

import { AsyncLocalStorage } from 'node:async_hooks';

import { studyPhaseGraceMs } from '$lib/shared/projects/operations';

type ProjectOperationContext = {
  signal: AbortSignal;
  /** The study phase's deadline: no attempt or model call starts after it. */
  deadlineAt?: number;
  /** Until when an operation running at the deadline may still publish (see studyPhaseGraceMs). */
  graceUntil?: number;
};

/** Until when an operation started at `startedAt` may publish: with the grace only if it began in time. */
export function operationGraceUntil(deadlineAt: number, startedAt = Date.now()): number {
  return startedAt < deadlineAt ? deadlineAt + studyPhaseGraceMs : deadlineAt;
}

const operationContexts = new AsyncLocalStorage<ProjectOperationContext>();

export function runWithProjectOperationSignal<T>(
  signal: AbortSignal,
  callback: () => Promise<T>,
  deadlineAt?: number,
  graceUntil?: number
): Promise<T> {
  return operationContexts.run(
    {
      signal,
      ...(deadlineAt === undefined ? {} : { deadlineAt }),
      ...(graceUntil === undefined ? {} : { graceUntil })
    },
    callback
  );
}

export function currentProjectOperationSignal(): AbortSignal | undefined {
  return operationContexts.getStore()?.signal;
}

/** Absolute study-phase deadline for the current operation, when one applies. */
export function currentProjectOperationDeadline(): number | undefined {
  return operationContexts.getStore()?.deadlineAt;
}

/** Whether the current operation's study phase has ended, so nothing new may start. */
export function currentProjectOperationPastDeadline(): boolean {
  const deadline = currentProjectOperationDeadline();
  return deadline !== undefined && Date.now() >= deadline;
}

/**
 * Fail immediately before publishing a result if cancellation or a phase deadline won the race; an
 * operation running at the deadline may still publish until its grace ends.
 */
export function assertCurrentProjectOperationActive(): void {
  const context = operationContexts.getStore();
  if (context?.signal.aborted) throw context.signal.reason ?? abortError();
  const until = context?.graceUntil ?? context?.deadlineAt;
  if (until !== undefined && Date.now() >= until) throw projectOperationDeadlineError();
}

/** Shared cancellation reason for work that reaches its server-authoritative study deadline. */
export function projectOperationDeadlineError(): Error {
  const error = new Error(
    'The study phase ended before this project operation could finish. The last working visualization was kept.'
  );
  error.name = 'StudyPhaseDeadlineError';
  return error;
}

function abortError(): Error {
  const error = new Error('The project operation was cancelled.');
  error.name = 'AbortError';
  return error;
}
