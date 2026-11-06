/** A turn's failures as the participant and the Timeline see them, and how a model call failed. */

/** Mode-neutral AI feedback, candidate validation, and bounded attempt orchestration. */

import { APIConnectionTimeoutError, APIUserAbortError } from 'openai';

import { InvalidChatbotResponseError } from '$lib/server/ai/providers/types';
import type { NewProjectEvent } from '$lib/shared/projects/events';
import type { ProjectDocument } from '$lib/shared/projects/model';

import { currentProjectOperationSignal } from '$lib/server/projects/operation-context';
import { appendProjectEvents, draftEvent } from '$lib/server/projects/service';
import type { ProjectCommandDependencies } from '$lib/server/projects/commands';
import { keptVersion } from '$lib/server/ai/turns/attempt-ladder';

export function assistantBotId(event: NewProjectEvent<'ai.generation-succeeded'>): string {
  if (event.actor.kind !== 'assistant') {
    throw new Error('A successful AI generation must have an assistant actor.');
  }
  return event.actor.botId;
}

export function appendSystemFailure(
  document: ProjectDocument,
  message: string,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  return appendProjectEvents(
    document,
    [
      draftEvent({
        type: 'system.notified',
        actor: { kind: 'system' },
        operationId,
        payload: { severity: 'error', message }
      })
    ],
    dependencies.projectService
  );
}

export function appendAttemptDeadlineFailure(
  document: ProjectDocument,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  return appendSystemFailure(
    document,
    `This visualization needed another attempt, but there was not enough time left in the study phase to complete it safely${keptVersion(document)}.`,
    operationId,
    dependencies
  );
}

export function appendWanderingRepairFailure(
  document: ProjectDocument,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  return appendSystemFailure(
    document,
    `I could not build the requested change: each repair ran into a new problem instead of fixing the last, so I stopped${keptVersion(document, ' and')}. A smaller change, or one part at a time, may work better.`,
    operationId,
    dependencies
  );
}

/** A failed build an attempt reports to the ladder: its problems and the source that had them. */
export type AttemptFailure = { source: string; diagnostics: readonly Problem[] };
export type Problem = { code?: string; message: string };

// The openai SDK's errors are told apart by class: their `name` is plain 'Error'.
export function requestTimedOut(error: unknown): boolean {
  return error instanceof APIConnectionTimeoutError;
}

export function requestCancelled(error: unknown): boolean {
  return (
    error instanceof APIUserAbortError ||
    (error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'StudyPhaseDeadlineError'))
  );
}

export function generationFailureKind(
  error: unknown
): 'cancelled' | 'configuration' | 'provider' | 'timeout' | 'invalid-response' {
  if (error instanceof Error && error.name === 'OpenAIConfigurationError') return 'configuration';
  if (requestTimedOut(error)) return 'timeout';
  if (requestCancelled(error)) return 'cancelled';
  if (error instanceof Error && error.name === 'InvalidChatbotResponseError') {
    return 'invalid-response';
  }
  return 'provider';
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'OpenAIConfigurationError') return error.message;
  if (error instanceof Error && error.name === 'ChatContextOverflowError') return error.message;
  if (requestTimedOut(error)) return 'The AI request timed out.';
  if (requestCancelled(error)) {
    const reason = currentProjectOperationSignal()?.reason;
    return reason instanceof Error
      ? reason.message
      : 'The AI request was cancelled before it could finish.';
  }
  if (error instanceof Error && error.name === 'InvalidChatbotResponseError') return error.message;
  return 'The AI service could not complete this request.';
}

/** The tokens a response that came back but could not be used still spent, where reported. */
export function spentUsage(error: unknown): Record<string, number> | undefined {
  return error instanceof InvalidChatbotResponseError ? error.usage : undefined;
}

export function generationErrorDetails(error: unknown): { value: string; mediaType: string } {
  const summary = error instanceof Error ? (error.stack ?? error.message) : String(error);
  if (
    error instanceof Error &&
    'providerResponse' in error &&
    error.providerResponse !== undefined
  ) {
    try {
      return {
        value: JSON.stringify({ error: summary, providerResponse: error.providerResponse }),
        mediaType: 'application/json'
      };
    } catch {
      // Use the readable error if a provider object is not serializable.
    }
  }
  return { value: summary, mediaType: 'text/plain' };
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
