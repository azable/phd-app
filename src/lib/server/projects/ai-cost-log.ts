/** Model calls and their costs in the web process's structured logs, one JSON line each. */

import { aiCalls, callCost, costTotal } from '$lib/shared/projects/ai-costs';
import type { ProjectEvent } from '$lib/shared/projects/events';

/** One call's tokens and cost, as it ends. */
export function logModelCall(call: {
  projectId: string;
  operationId: string;
  attempt: number;
  purpose: string;
  model: string;
  failed: boolean;
  usage?: Readonly<Record<string, number>>;
}): void {
  const costUsd = call.usage ? callCost(call.model, call.usage) : undefined;
  console.info(
    JSON.stringify({
      type: 'ai.call',
      at: new Date().toISOString(),
      ...call,
      ...(costUsd !== undefined ? { costUsd } : {})
    })
  );
}

/**
 * An operation's calls added up, once it ends, where it made any. It runs as the operation closes,
 * so it never throws: a log line must not keep an operation from ending.
 */
export function logOperationCost(
  projectId: string,
  operationId: string,
  events: readonly ProjectEvent[] | undefined
): void {
  try {
    const calls = aiCalls(events ?? []).filter((call) => call.operationId === operationId);
    if (!calls.length) return;
    console.info(
      JSON.stringify({
        type: 'ai.turn-cost',
        at: new Date().toISOString(),
        projectId,
        operationId,
        ...costTotal(calls)
      })
    );
  } catch (cause) {
    console.error('The cost of an operation could not be logged.', cause);
  }
}
