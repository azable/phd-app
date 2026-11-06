/** The HTML assistant's turn: a model returns a candidate of frames, checked before it is shown. */

/** Mode-neutral AI feedback, candidate validation, and bounded attempt orchestration. */

import type { AssistantTurn } from '$lib/modes/assistants.server';
import { randomUUID } from 'node:crypto';

import type { NewProjectEvent } from '$lib/shared/projects/events';
import type { RecordedText } from '$lib/shared/projects/events/values';
import type { ProjectDocument } from '$lib/shared/projects/model';
import { type RenderablePresentation } from '$lib/shared/presentations';
import { presentationMode } from '$lib/shared/presentations';
import { projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import { modeCatalog } from '$lib/modes/catalog';
import { modeBuilders } from '$lib/modes/server';
import {
  projectAiContext,
  projectConversationMessages,
  type AiContextSelection,
  type AiProjectContext
} from '$lib/server/ai/context/project-context';
import type {
  Chatbot,
  CandidateAssistantOutput,
  GeneratedMessageContent
} from '$lib/server/ai/bots/types';

import { recordText } from '$lib/server/projects/fingerprints';
import {
  assertCurrentProjectOperationActive,
  currentProjectOperationSignal
} from '$lib/server/projects/operation-context';
import { appendProjectEvents, draftEvent } from '$lib/server/projects/service';
import type { ProjectCommandDependencies } from '$lib/server/projects/commands';
import {
  keptVersion,
  plainFailureSummary,
  replyWithRecovery,
  runAttemptLadder,
  type BuildStages
} from '$lib/server/ai/turns/attempt-ladder';
import { HtmlFramesError, type HtmlFramesCode } from '../html-safety.server';
import {
  appendAssistantResponse,
  resolveAssistantContent,
  validateGeneratedReply,
  validateRecoveryExplanation
} from '$lib/server/ai/turns/replies';
import {
  appendSystemFailure,
  assistantBotId,
  errorMessage,
  type AttemptFailure
} from '$lib/server/ai/turns/failures';
import {
  generationPreparationFailure,
  runPreparedGeneration
} from '$lib/server/ai/turns/generation';
import type { GenerationOutcome } from '$lib/server/ai/turns/generation';

export async function submitCandidateFeedback(
  document: ProjectDocument,
  operationId: string,
  contextSelection: AiContextSelection,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  const mode = projectSnapshotAt(document).mode;
  const chatbot = dependencies.getCandidateChatbot(projectSnapshotAt(document).assistantId);
  const failureSummaries: string[] = [];
  let correction: string | undefined;

  return runAttemptLadder(
    document,
    operationId,
    chatbot,
    dependencies,
    async (current, attempt) => {
      const generation = await runCandidateGeneration(
        {
          chatbot,
          document: current,
          attempt,
          operationId,
          contextSelection,
          ...(correction ? { correction } : {})
        },
        dependencies
      );
      current = generation.document;
      if (!generation.ok) {
        // The fast first call flagged the request as unclear: it runs again, stepped up.
        if (generation.rethink) return { document: current, done: false, rethink: true };
        if (!generation.retried) return { document: current, done: true };
        failureSummaries.push(`Attempt ${attempt}: ${generation.message}`);
        return { document: current, done: false };
      }
      if (generation.result.candidates.length === 0) {
        if (attempt === 1) {
          return {
            document: await appendAssistantResponse(
              current,
              resolveAssistantContent(current, generation.result.reply, []),
              assistantBotId(generation.generationEvent),
              operationId,
              dependencies
            ),
            done: true
          };
        }
        const summary = `Attempt ${attempt} did not return a visualization candidate.`;
        failureSummaries.push(summary);
        if (attempt === chatbot.config.attemptProfiles.length) {
          return {
            document: await appendExhaustedCandidateFailure(
              current,
              operationId,
              'the generated artifact still did not pass the visualization checks',
              dependencies
            ),
            done: true
          };
        }
        correction = candidateCorrection([], summary, failureSummaries);
        return {
          document: current,
          done: false,
          failure: { source: '', diagnostics: [{ code: candidateMissing, message: summary }] }
        };
      }

      let accepted: AcceptedCandidateTurn;
      try {
        accepted = {
          source: recordText(
            JSON.stringify(generation.result.candidates[0].manifest),
            modeCatalog[mode].starter.mediaType
          ),
          presentations: await Promise.all(
            generation.result.candidates.map(async ({ manifest }) => {
              const builder = modeBuilders[mode].buildPresentation;
              if (!builder) throw new Error(`Mode ${mode} cannot build a presentation.`);
              const presentation = await builder(
                JSON.stringify(manifest),
                1,
                projectHead(current).id
              );
              if (presentationMode(presentation) !== mode)
                throw new Error('The mode builder returned a presentation for a different mode.');
              return presentation;
            })
          ),
          reply: replyWithRecovery(generation.result.reply, generation.result.recovery),
          generationEvent: generation.generationEvent
        };
      } catch (cause) {
        const summary = errorMessage(cause);
        failureSummaries.push(`Attempt ${attempt}: ${summary}`);
        if (attempt === chatbot.config.attemptProfiles.length) {
          return {
            document: await appendExhaustedCandidateFailure(
              current,
              operationId,
              'the generated artifact still did not pass the visualization checks',
              dependencies
            ),
            done: true
          };
        }
        correction = candidateCorrection(generation.result.candidates, cause, failureSummaries);
        return {
          document: current,
          done: false,
          failure: candidateFailure(generation.result.candidates, cause, summary)
        };
      }
      assertCurrentProjectOperationActive();
      return {
        document: await acceptCandidateTurn(current, accepted, operationId, dependencies),
        done: true
      };
    },
    htmlBuildStages
  );
}

export type AcceptedCandidateTurn = {
  source: RecordedText;
  presentations: RenderablePresentation[];
  reply: GeneratedMessageContent;
  generationEvent: NewProjectEvent<'ai.generation-succeeded'>;
};

export async function acceptCandidateTurn(
  document: ProjectDocument,
  accepted: AcceptedCandidateTurn,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  const snapshot = projectSnapshotAt(document);
  const current = snapshot.artifacts[snapshot.entryArtifactId];
  if (!current) throw new Error('The project has no entry artifact.');
  const first = accepted.presentations[0];
  if (!first) throw new Error('An accepted candidate turn needs at least one presentation.');
  const displaySetId = randomUUID();
  document = await appendProjectEvents(
    document,
    [
      draftEvent({
        type: 'artifact.version-created',
        actor: accepted.generationEvent.actor,
        operationId,
        payload: {
          origin: { kind: 'assistant-edit' },
          changes: [
            {
              operation: 'upsert',
              artifact: {
                ...current,
                language: 'json',
                content: accepted.source
              }
            }
          ]
        }
      }),
      ...accepted.presentations.map((presentation, slot) =>
        draftEvent({
          type: 'visualization.presented',
          actor: accepted.generationEvent.actor,
          operationId,
          payload: { displaySetId, slot: slot as 0 | 1, presentation }
        })
      )
    ],
    dependencies.projectService
  );
  return appendAssistantResponse(
    document,
    resolveAssistantContent(document, accepted.reply, accepted.presentations),
    assistantBotId(accepted.generationEvent),
    operationId,
    dependencies
  );
}

export async function runCandidateGeneration(
  options: {
    chatbot: Chatbot<AiProjectContext, CandidateAssistantOutput>;
    document: ProjectDocument;
    attempt: number;
    operationId: string;
    contextSelection: AiContextSelection;
    correction?: string;
  },
  dependencies: ProjectCommandDependencies
): Promise<GenerationOutcome<CandidateAssistantOutput>> {
  let prompt;
  try {
    prompt = await options.chatbot.preparePrompt({
      messages: [
        ...projectConversationMessages(options.document.events),
        ...(options.correction ? [{ role: 'user' as const, content: options.correction }] : [])
      ],
      project: projectAiContext(options.document, options.contextSelection),
      attempt: options.attempt
    });
  } catch (error) {
    return generationPreparationFailure(options, error, dependencies);
  }
  return runPreparedGeneration<CandidateAssistantOutput>(
    {
      document: options.document,
      attempt: options.attempt,
      operationId: options.operationId,
      prompt,
      attemptsLeft: options.attempt < options.chatbot.config.attemptProfiles.length,
      generate: () =>
        options.chatbot.generatePrepared(prompt, { signal: currentProjectOperationSignal() }),
      validateResult: (result) => {
        validateGeneratedReply(result.reply, result.candidates.length, result.providerResponse);
        validateRecoveryExplanation(prompt, result.recovery, result.providerResponse);
        // Only the fallback explains a simplification; one any other attempt gives is not shown.
        if (prompt.attempt.purpose !== 'fallback') result.recovery = undefined;
      },
      fallbackResponse: (result) => ({
        reply: result.reply,
        candidates: result.candidates,
        recovery: result.recovery ?? null,
        generation: result.generation
      })
    },
    dependencies
  );
}

export function appendExhaustedCandidateFailure(
  document: ProjectDocument,
  operationId: string,
  finalDifficulty: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  return appendSystemFailure(
    document,
    `I could not make the requested visualization pass the safety checks after several repairs and a simpler fallback${keptVersion(document)}. The remaining difficulty was: ${plainFailureSummary(finalDifficulty)}`,
    operationId,
    dependencies
  );
}

export function candidateCorrection(
  candidates: Array<{ label: string; manifest: unknown }>,
  cause: unknown,
  failureSummaries: readonly string[]
): string {
  return `The previous candidate batch failed validation: ${errorMessage(cause)}. Return one complete corrected batch of up to two candidates. The participant never saw the failed batch or this message: reply only about what they will see, never that something failed or was fixed. Previous candidates: ${JSON.stringify(candidates)}. Failure history: ${JSON.stringify(failureSummaries.map((summary) => summary.slice(0, 2_000)))}`;
}

/**
 * The HTML authoring turn, as the assistants registry calls it (see ../../assistants.server.ts): it
 * returns one candidate, so it takes no count of presentations.
 */
export const runAssistantTurn: AssistantTurn = (
  document,
  operationId,
  selection,
  _count,
  dependencies
) => submitCandidateFeedback(document, operationId, selection, dependencies);

/** A repair that returned no candidate where one was asked for: a slip, as a missing algorithm is. */
const candidateMissing = 'candidate_missing';

/** A failed candidate as the ladder reads it: its manifests, and why the checks refused them. */
function candidateFailure(
  candidates: Array<{ label: string; manifest: unknown }>,
  cause: unknown,
  message: string
): AttemptFailure {
  return {
    source: JSON.stringify(candidates.map(({ manifest }) => manifest)),
    diagnostics: [{ ...(cause instanceof HtmlFramesError ? { code: cause.code } : {}), message }]
  };
}

/**
 * The frames' refusals that are slips in the HTML as written, which the model can fix from the
 * message alone, as Sverlin's source refused as written is (sverlinBuildStages): a manifest of the
 * wrong shape, labels that repeat, markup the frames may not hold, a frame left empty, or no
 * candidate. A manifest over the size limit needs a smaller design, not a fix, so it goes to the
 * slower repairs, as Sverlin's `too_large` does; so does a failure with no code.
 */
const writtenCodes: ReadonlySet<string> = new Set<HtmlFramesCode | typeof candidateMissing>([
  'html_manifest',
  'html_labels',
  'html_forbidden',
  'html_empty',
  candidateMissing
]);

/** How HTML's checks sort their refusals, for the attempt ladder (see attempt-ladder.ts BuildStages). */
export const htmlBuildStages: BuildStages = {
  stageOf: (code) =>
    code === undefined
      ? undefined
      : writtenCodes.has(code)
        ? 0
        : code === 'html_too_large'
          ? 1
          : undefined,
  refusedAsWritten: (failure) =>
    !!failure?.diagnostics.length &&
    failure.diagnostics.every(({ code }) => code !== undefined && writtenCodes.has(code))
};
