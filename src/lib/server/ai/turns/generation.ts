/** One model call of a turn, prepared and recorded, with its failures. */

/** Mode-neutral AI feedback, candidate validation, and bounded attempt orchestration. */

import type { ProjectDocument } from '$lib/shared/projects/model';
import type { NewProjectEvent } from '$lib/shared/projects/events';
import type { ChatbotPrompt, ChatbotResult } from '$lib/server/ai/bots/types';

import { logModelCall } from '$lib/server/ai/costs/ai-cost-log';
import { escalateForFlag } from '$lib/server/ai/turns/struggle';
import { recordText, sourceSha256 } from '$lib/server/projects/fingerprints';
import { appendProjectEvents, draftEvent } from '$lib/server/projects/service';
import type { ProjectCommandDependencies } from '$lib/server/projects/commands';
import {
  appendSystemFailure,
  generationErrorDetails,
  generationFailureKind,
  safeErrorMessage,
  spentUsage
} from '$lib/server/ai/turns/failures';

/**
 * A model call that failed: the document with its failure recorded, and whether it was retried; or
 * a fast first call that flagged the request as unclear, which the turn runs once more stepped up
 * (`rethink`, see ai/turns/struggle.ts).
 */
export type GenerationFailed = {
  ok: false;
  document: ProjectDocument;
  retried: boolean;
  message: string;
  rethink?: true;
};

/** A model call's outcome: its result and the event recording it, or its failure. */
export type GenerationOutcome<Output extends object> =
  | {
      ok: true;
      document: ProjectDocument;
      result: ChatbotResult<Output>;
      generationEvent: NewProjectEvent<'ai.generation-succeeded'>;
    }
  | GenerationFailed;

export async function generationPreparationFailure(
  options: { document: ProjectDocument; operationId: string; attempt: number },
  error: unknown,
  dependencies: ProjectCommandDependencies
): Promise<GenerationFailed> {
  const details = generationErrorDetails(error);
  const failed = draftEvent<'ai.generation-failed'>({
    type: 'ai.generation-failed',
    actor: { kind: 'system' },
    operationId: options.operationId,
    payload: {
      attempt: options.attempt,
      failureKind: generationFailureKind(error),
      durationMs: 0,
      message: safeErrorMessage(error),
      details: recordText(details.value, details.mediaType)
    }
  });
  const document = await appendProjectEvents(
    options.document,
    [failed],
    dependencies.projectService
  );
  return {
    ok: false as const,
    document: await appendSystemFailure(
      document,
      failed.payload.message,
      options.operationId,
      dependencies
    ),
    retried: false,
    message: failed.payload.message
  };
}

export async function runPreparedGeneration<Output extends object>(
  options: {
    document: ProjectDocument;
    attempt: number;
    operationId: string;
    prompt: ChatbotPrompt;
    generate: () => Promise<ChatbotResult<Output>>;
    validateResult: (result: ChatbotResult<Output>) => void;
    fallbackResponse: (result: ChatbotResult<Output>) => unknown;
    notifyFailure?: boolean;
    /** Whether the ladder has another attempt, which a response that cannot be used goes on to. */
    attemptsLeft?: boolean;
  },
  dependencies: ProjectCommandDependencies
): Promise<GenerationOutcome<Output>> {
  const request = draftEvent<'ai.generation-requested'>({
    type: 'ai.generation-requested',
    actor: { kind: 'system' },
    operationId: options.operationId,
    payload: {
      attempt: options.attempt,
      purpose: options.prompt.attempt.purpose,
      prompt: recordText(JSON.stringify(options.prompt), 'application/json'),
      promptTemplateSha256: sourceSha256(options.prompt.initialPrompt),
      requestedModel: options.prompt.parameters.model,
      parameters: { ...options.prompt.parameters },
      ...(options.prompt.escalation ? { escalation: options.prompt.escalation } : {})
    }
  });
  let document = await appendProjectEvents(
    options.document,
    [request],
    dependencies.projectService
  );
  const startedAt = performance.now();
  // A response refused by validation was still paid for.
  let generated: ChatbotResult<Output> | undefined;
  try {
    const result = await options.generate();
    generated = result;
    options.validateResult(result);
    const generationEvent = draftEvent<'ai.generation-succeeded'>({
      type: 'ai.generation-succeeded',
      actor: { kind: 'assistant', botId: result.generation.botId },
      operationId: options.operationId,
      payload: {
        attempt: options.attempt,
        adapterId: result.generation.adapterId,
        requestedModel: options.prompt.parameters.model,
        ...(result.generation.model ? { model: result.generation.model } : {}),
        ...(result.generation.responseId ? { responseId: result.generation.responseId } : {}),
        durationMs: Math.round(performance.now() - startedAt),
        ...(result.generation.usage ? { usage: result.generation.usage } : {}),
        response: recordText(
          JSON.stringify(result.providerResponse ?? options.fallbackResponse(result)),
          'application/json'
        )
      }
    });
    document = await appendProjectEvents(document, [generationEvent], dependencies.projectService);
    logModelCall({
      projectId: document.projectId,
      operationId: options.operationId,
      attempt: options.attempt,
      purpose: options.prompt.attempt.purpose,
      model: result.generation.model ?? options.prompt.parameters.model,
      failed: false,
      ...(options.prompt.escalation ? { escalation: options.prompt.escalation } : {}),
      ...(result.generation.usage ? { usage: result.generation.usage } : {})
    });
    // The fast first call flagged the request as unclear: the turn runs it once more stepped up,
    // its answer recorded above but not acted on.
    if (
      options.prompt.attempt.purpose === 'initial' &&
      (result as { needsMoreThought?: boolean }).needsMoreThought === true &&
      escalateForFlag()
    )
      return {
        ok: false as const,
        document,
        retried: true,
        rethink: true as const,
        message: 'The first call flagged the request as unclear; it runs again at a higher effort.'
      };
    return { ok: true as const, document, result, generationEvent };
  } catch (error) {
    const details = generationErrorDetails(error);
    const usage = generated?.generation.usage ?? spentUsage(error);
    const failed = draftEvent<'ai.generation-failed'>({
      type: 'ai.generation-failed',
      actor: { kind: 'system' },
      operationId: options.operationId,
      payload: {
        attempt: options.attempt,
        failureKind: generationFailureKind(error),
        durationMs: Math.round(performance.now() - startedAt),
        message: safeErrorMessage(error),
        details: recordText(details.value, details.mediaType),
        ...(usage ? { usage } : {})
      }
    });
    document = await appendProjectEvents(document, [failed], dependencies.projectService);
    logModelCall({
      projectId: document.projectId,
      operationId: options.operationId,
      attempt: options.attempt,
      purpose: options.prompt.attempt.purpose,
      model: options.prompt.parameters.model,
      failed: true,
      ...(options.prompt.escalation ? { escalation: options.prompt.escalation } : {}),
      ...(usage ? { usage } : {})
    });
    // A response that cannot be used, incomplete, unparseable, or refused by validation, fails only
    // its attempt: the ladder goes on. Project 0c34d124's xhigh repair spent its whole output budget
    // reasoning, and its turn ended without the fallback.
    const retried =
      Boolean(options.attemptsLeft) && failed.payload.failureKind === 'invalid-response';
    if (options.notifyFailure !== false && !retried) {
      document = await appendSystemFailure(
        document,
        failed.payload.message,
        options.operationId,
        dependencies
      );
    }
    return { ok: false as const, document, retried, message: failed.payload.message };
  }
}
