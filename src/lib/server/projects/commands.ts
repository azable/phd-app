/** Mode-neutral AI feedback, candidate validation, and bounded attempt orchestration. */

import { randomUUID } from 'node:crypto';

import { InvalidChatbotResponseError } from '$lib/server/chat-adapters/types';
import type {
  EventId,
  NewProjectEvent,
  ParticipantIntakeStepId,
  ProjectEventOf
} from '$lib/shared/projects/events';
import {
  markdownMessage,
  plainMessageText,
  structureKnownPresentationReferences,
  type ElementReference,
  type MessageContent
} from '$lib/shared/projects/events/message-content';
import type { ArtifactChange, RecordedText } from '$lib/shared/projects/events/values';
import type { ProjectCommandResult, ProjectDocument } from '$lib/shared/projects/model';
import { presentationBufferState } from '$lib/shared/projects/presentation-buffer';
import type { DesignValues, RenderablePresentation } from '$lib/shared/presentations';
import {
  isSverlinPresentation,
  presentationMode,
  presentationStepLabels,
  presentationStepName,
  presentationVariant
} from '$lib/shared/presentations';
import { projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import { assistantTurnClaim, projectOperation } from '$lib/shared/projects/operations';
import {
  getChatbot,
  getCandidateChatbot,
  getParticipantIntakeClassifier,
  getSverlinChooser
} from '$lib/server/chat-bots/registry';
import { modeCatalog } from '$lib/modes/catalog';
import { locateElement } from '$lib/modes/sverlin/element-ref';
import { modeBuilders, type BuildRequest } from '$lib/modes/server';
import {
  nextParticipantIntakeStep,
  participantIntakeStep,
  type ParticipantIntakeClassifierOutput
} from '$lib/server/chat-bots/participant-intake';
import {
  projectAiContext,
  projectConversationMessages,
  designVariables,
  viewedPresentation,
  type AiContextSelection,
  type AiProjectContext
} from '$lib/server/chat-bots/project-context';
import type {
  Chatbot,
  ChatbotPrompt,
  ChatbotResult,
  CandidateAssistantOutput,
  BuildFeedback,
  GeneratedMessageContent,
  RecoveryExplanation,
  SourceArtifactChatOutput
} from '$lib/server/chat-bots/types';
import type { SourceDecisionOf } from '$lib/server/chat-bots/source-decisions';
import { applySourceEdits } from '$lib/server/chat-bots/source-edits';

import { runProjectCommand } from './command-lock';
import { formatDiagnosticSummary } from './diagnostics';
import { recordText, sourceSha256 } from './fingerprints';
import { appendProjectPreference } from './presentations';
import {
  assertCurrentProjectOperationActive,
  currentProjectOperationDeadline,
  currentProjectOperationSignal
} from './operation-context';
import { projectRepository, type ProjectRepository } from './repository';
import {
  activateBuiltPresentations,
  appendProjectEvents,
  baseOnPresentation,
  basedRequests,
  buildProjectSourceBatch,
  defaultProjectServiceDependencies,
  draftEvent,
  freshPresentationSeeds,
  type ProjectServiceDependencies,
  type RecordedBuild,
  type RecordedBuildBatch
} from './service';

/** Replaceable AI and persistence boundaries used by command unit tests. */
export type ProjectCommandDependencies = {
  repository: typeof projectRepository;
  projectService: ProjectServiceDependencies;
  getChatbot: typeof getChatbot;
  getCandidateChatbot: typeof getCandidateChatbot;
  getParticipantIntakeClassifier: typeof getParticipantIntakeClassifier;
  /** The bot choosing a built source's variants; without one, a turn shows its first build. */
  getChooser?: typeof getSverlinChooser;
};

export const defaultProjectCommandDependencies: ProjectCommandDependencies = {
  repository: projectRepository,
  projectService: defaultProjectServiceDependencies,
  getChatbot,
  getCandidateChatbot,
  getParticipantIntakeClassifier,
  getChooser: getSverlinChooser
};

/** Validate and durably queue participant feedback without waiting for the assistant. */
export function queueProjectFeedback(
  options: {
    projectId: string;
    operationId: string;
    content: MessageContent;
    focus: EventId[];
    presentationCount: 1 | 2;
    /** The candidate the participant is viewing. */
    from?: string;
    deadlineAt?: string;
  },
  dependencies: ProjectCommandDependencies = defaultProjectCommandDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    assertCurrentProjectOperationActive();
    const before = await dependencies.repository.load(options.projectId);
    assertAcceptedInteraction(before, options.operationId, 'feedback');
    const focus = validateFocus(before, options.focus);
    const content = await validateMessageContent(before, options.content);
    // The assistant revises the source of the candidate the participant is viewing.
    const based = options.from
      ? await baseOnPresentation(
          before,
          options.from,
          options.operationId,
          dependencies.projectService
        )
      : before;
    const interactionEventId = projectHead(based).id + 1;
    const document = await appendProjectEvents(
      based,
      [
        draftEvent({
          type: 'feedback.submitted',
          actor: { kind: 'user' },
          operationId: options.operationId,
          payload: {
            content,
            focus,
            presentationCount: options.presentationCount,
            ...(options.from ? { viewing: options.from } : {})
          }
        }),
        draftEvent({
          type: 'assistant.turn-requested',
          actor: { kind: 'system' },
          operationId: options.operationId,
          payload: {
            interactionEventId,
            presentationCount: options.presentationCount,
            ...(options.deadlineAt ? { deadlineAt: options.deadlineAt } : {})
          }
        })
      ],
      dependencies.projectService
    );
    return finishMutation(before, document);
  });
}

/** Validate and durably queue one comparison preference without waiting for the assistant. */
export function queueProjectPreference(
  options: {
    projectId: string;
    operationId: string;
    presentations: [string, string];
    preferred: string;
    step: number;
    deadlineAt?: string;
  },
  dependencies: ProjectCommandDependencies = defaultProjectCommandDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    assertCurrentProjectOperationActive();
    const before = await dependencies.repository.load(options.projectId);
    assertAcceptedInteraction(before, options.operationId, 'prefer');
    // The assistant builds on the candidate the participant preferred.
    const based = await baseOnPresentation(
      before,
      options.preferred,
      options.operationId,
      dependencies.projectService
    );
    let document = await appendProjectPreference(based, options, dependencies.projectService);
    const preference = document.events.findLast(
      (event) =>
        event.operationId === options.operationId &&
        event.type === 'visualization.preference-recorded'
    );
    if (preference?.type !== 'visualization.preference-recorded') {
      throw new Error('The recorded preference event could not be resolved.');
    }
    document = await appendProjectEvents(
      document,
      [
        draftEvent({
          type: 'assistant.turn-requested',
          actor: { kind: 'system' },
          operationId: options.operationId,
          payload: {
            interactionEventId: preference.id,
            presentationCount: 2,
            ...(options.deadlineAt ? { deadlineAt: options.deadlineAt } : {})
          }
        })
      ],
      dependencies.projectService
    );
    return finishMutation(before, document);
  });
}

/** Process one durable claim while allowing new participant interactions to append concurrently. */
export async function runQueuedAssistantTurn(
  options: { projectId: string; operationId: string },
  dependencies: ProjectCommandDependencies = defaultProjectCommandDependencies
): Promise<ProjectCommandResult> {
  const before = await dependencies.repository.load(options.projectId);
  const claim = assistantTurnClaim(before, options.operationId);
  if (!claim) throw new Error('The assistant operation has no durable turn claim.');
  const requests = claim.payload.requestEventIds.map((id) => before.events[id - 1]);
  if (requests.some((event) => event?.type !== 'assistant.turn-requested')) {
    throw new Error('The assistant turn claim references an unknown request.');
  }
  const interactions = claim.payload.interactionEventIds.map((id) => before.events[id - 1]);
  if (
    interactions.some(
      (event) =>
        event?.type !== 'feedback.submitted' &&
        event?.type !== 'visualization.preference-recorded' &&
        event?.type !== 'visualization.runtime-failed'
    )
  ) {
    throw new Error('The assistant turn claim references an unknown interaction.');
  }
  const feedback = interactions.filter(
    (event): event is Extract<(typeof interactions)[number], { type: 'feedback.submitted' }> =>
      event?.type === 'feedback.submitted'
  );
  const preferences = interactions.filter(
    (
      event
    ): event is Extract<
      (typeof interactions)[number],
      { type: 'visualization.preference-recorded' }
    > => event?.type === 'visualization.preference-recorded'
  );
  const content = feedback.flatMap((event) => event.payload.content);
  const contextSelection: AiContextSelection = {
    eventIds: [...new Set(feedback.flatMap((event) => event.payload.focus))],
    presentationIds: [
      ...new Set([
        ...referencedPresentations(content),
        ...preferences.flatMap((event) => event.payload.presentations),
        ...interactions.flatMap((event) =>
          event?.type === 'visualization.runtime-failed' ? [event.payload.presentationId] : []
        )
      ])
    ],
    elements: referencedElements(content),
    interactionEventIds: claim.payload.interactionEventIds
  };
  const presentationCount = Math.max(
    ...requests.map((event) =>
      event?.type === 'assistant.turn-requested' ? event.payload.presentationCount : 1
    )
  ) as 1 | 2;
  const concurrentDependencies = rebasingDependencies(dependencies);
  const intake = await handleParticipantIntake(
    before,
    options.operationId,
    feedback,
    concurrentDependencies
  );
  if (!intake.author) {
    return {
      document: intake.document,
      appendedEvents: intake.document.events.filter(
        (event) => event.id > projectHead(before).id && event.operationId === options.operationId
      )
    };
  }
  const document =
    projectSnapshotAt(intake.document).mode === 'sverlin'
      ? await runSverlinAssistantTurn(
          intake.document,
          options.operationId,
          contextSelection,
          presentationCount,
          concurrentDependencies,
          claim.payload.interactionEventIds
        )
      : await submitCandidateFeedback(
          intake.document,
          options.operationId,
          contextSelection,
          concurrentDependencies
        );
  return {
    document,
    appendedEvents: document.events.filter(
      (event) => event.id > projectHead(before).id && event.operationId === options.operationId
    )
  };
}

/** Record user feedback and produce the mode's next visualization response. */
export function submitProjectFeedback(
  options: {
    projectId: string;
    expectedHead: EventId;
    content: MessageContent;
    focus: EventId[];
    presentationCount: 1 | 2;
    operationId: string;
  },
  dependencies: ProjectCommandDependencies = defaultProjectCommandDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, () =>
    submitProjectFeedbackUnlocked(options, dependencies)
  );
}

async function submitProjectFeedbackUnlocked(
  options: {
    projectId: string;
    expectedHead: EventId;
    content: MessageContent;
    focus: EventId[];
    presentationCount: 1 | 2;
    operationId: string;
  },
  dependencies: ProjectCommandDependencies
): Promise<ProjectCommandResult> {
  const before = await dependencies.repository.load(options.projectId);
  assertHead(before, options.expectedHead);
  const focus = validateFocus(before, options.focus);
  const content = await validateMessageContent(before, options.content);
  const presentations = referencedPresentations(content);

  let document = await appendProjectEvents(
    before,
    [
      draftEvent({
        type: 'feedback.submitted',
        actor: { kind: 'user' },
        operationId: options.operationId,
        payload: { content, focus }
      })
    ],
    dependencies.projectService
  );
  const interaction = document.events.findLast(
    (event) => event.operationId === options.operationId && event.type === 'feedback.submitted'
  );
  if (interaction?.type !== 'feedback.submitted') {
    throw new Error('The submitted feedback event could not be resolved.');
  }
  const intake = await handleParticipantIntake(
    document,
    options.operationId,
    [interaction],
    dependencies
  );
  document = intake.document;
  if (!intake.author) return finishMutation(before, document);
  if (projectSnapshotAt(document).mode !== 'sverlin') {
    document = await submitCandidateFeedback(
      document,
      options.operationId,
      {
        eventIds: focus,
        presentationIds: presentations
      },
      dependencies
    );
    return finishMutation(before, document);
  }

  const contextSelection: AiContextSelection = {
    eventIds: focus,
    presentationIds: presentations,
    elements: referencedElements(content)
  };
  document = await runSverlinAssistantTurn(
    document,
    options.operationId,
    contextSelection,
    options.presentationCount,
    dependencies
  );
  return finishMutation(before, document);
}

/** Record a pairwise preference and let the Sverlin assistant decide whether to adapt source. */
export function submitProjectPreference(
  options: {
    projectId: string;
    expectedHead: EventId;
    presentations: [string, string];
    preferred: string;
    step: number;
    operationId: string;
  },
  dependencies: ProjectCommandDependencies = defaultProjectCommandDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    const before = await dependencies.repository.load(options.projectId);
    assertHead(before, options.expectedHead);
    // The assistant builds on the candidate the participant preferred.
    const based = await baseOnPresentation(
      before,
      options.preferred,
      options.operationId,
      dependencies.projectService
    );
    let document = await appendProjectPreference(based, options, dependencies.projectService);
    const preference = document.events.findLast(
      (event) =>
        event.operationId === options.operationId &&
        event.type === 'visualization.preference-recorded'
    );
    if (preference?.type !== 'visualization.preference-recorded') {
      throw new Error('The recorded preference event could not be resolved.');
    }
    document = await runSverlinAssistantTurn(
      document,
      options.operationId,
      {
        eventIds: [],
        presentationIds: options.presentations,
        interactionEventIds: [preference.id]
      },
      2,
      dependencies
    );
    return finishMutation(before, document);
  });
}

type ParticipantIntakeResult = { document: ProjectDocument; author: boolean };

/** Advance the durable blank-project intake before its mode may author output. */
async function handleParticipantIntake(
  document: ProjectDocument,
  operationId: string,
  feedback: readonly ProjectEventOf<'feedback.submitted'>[],
  dependencies: ProjectCommandDependencies
): Promise<ParticipantIntakeResult> {
  let current = document;
  for (const interaction of feedback.toSorted((left, right) => left.id - right.id)) {
    const activeStep = activeParticipantIntakeStep(current);
    if (!activeStep) return { document: current, author: true };

    // The last question's answer, or an answer to a question no longer asked, completes intake.
    const next = nextParticipantIntakeStep(activeStep);
    if (!next) {
      current = await completeParticipantIntake(
        current,
        interaction.id,
        'answered',
        operationId,
        dependencies
      );
      return { document: current, author: true };
    }

    const classification = await classifyParticipantIntake(
      current,
      activeStep,
      interaction,
      operationId,
      dependencies
    );
    current = classification.document;
    if (classification.decision === 'exit') {
      current = await completeParticipantIntake(
        current,
        interaction.id,
        'waived',
        operationId,
        dependencies
      );
      return { document: current, author: true };
    }

    current = await appendAssistantResponse(
      current,
      next.question,
      projectSnapshotAt(current).assistantId,
      operationId,
      dependencies,
      [interaction.id],
      next.id
    );
  }
  return { document: current, author: activeParticipantIntakeStep(current) === undefined };
}

function activeParticipantIntakeStep(
  document: ProjectDocument
): ParticipantIntakeStepId | undefined {
  const question = document.events.findLast(
    (event) => event.type === 'assistant.responded' && event.payload.intakeStep !== undefined
  );
  if (question?.type !== 'assistant.responded' || !question.payload.intakeStep) return undefined;
  const completed = document.events.findLast(
    (event) => event.type === 'assistant.intake-completed'
  );
  return completed && completed.id > question.id ? undefined : question.payload.intakeStep;
}

async function classifyParticipantIntake(
  document: ProjectDocument,
  step: ParticipantIntakeStepId,
  interaction: ProjectEventOf<'feedback.submitted'>,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<{ document: ProjectDocument; decision: 'continue' | 'exit' }> {
  const classifier = dependencies.getParticipantIntakeClassifier();
  const prompt = await classifier.preparePrompt({
    messages: [
      {
        role: 'user',
        content: `Question: ${participantIntakeStep(step).question}\nParticipant response: ${plainMessageText(interaction.payload.content)}`
      }
    ],
    project: {},
    attempt: 1
  });
  const generation = await runPreparedGeneration<ParticipantIntakeClassifierOutput>(
    {
      document,
      attempt: 1,
      operationId,
      prompt,
      generate: () =>
        classifier.generatePrepared(prompt, { signal: currentProjectOperationSignal() }),
      validateResult: () => {},
      fallbackResponse: (result) => result,
      notifyFailure: false
    },
    dependencies
  );
  return generation.ok
    ? { document: generation.document, decision: generation.result.decision }
    : { document: generation.document, decision: 'continue' };
}

function completeParticipantIntake(
  document: ProjectDocument,
  interactionEventId: EventId,
  outcome: 'answered' | 'waived',
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  return appendProjectEvents(
    document,
    [
      draftEvent({
        type: 'assistant.intake-completed',
        actor: { kind: 'system' },
        operationId,
        payload: { interactionEventId, outcome }
      })
    ],
    dependencies.projectService
  );
}

async function runSverlinAssistantTurn(
  document: ProjectDocument,
  operationId: string,
  contextSelection: AiContextSelection,
  presentationCount: 1 | 2,
  dependencies: ProjectCommandDependencies,
  inReplyTo: readonly EventId[] = []
): Promise<ProjectDocument> {
  const chatbot = dependencies.getChatbot(projectSnapshotAt(document).assistantId);
  // The first presentation keeps the viewed variant's values; every attempt builds the same seeds.
  const viewedVariant = presentationVariant(
    viewedPresentation(document, contextSelection.interactionEventIds ?? [])
  );
  const viewed = Object.keys(viewedVariant).length ? viewedVariant : undefined;
  let seeds: readonly number[] | undefined;
  const failureSummaries: string[] = [];
  let buildFeedback: BuildFeedback | undefined;

  return runAttemptLadder(
    document,
    operationId,
    chatbot,
    dependencies,
    async (current, attempt) => {
      const generation = await runSverlinGeneration(
        {
          chatbot,
          document: current,
          attempt,
          operationId,
          contextSelection,
          presentationCount,
          ...(buildFeedback ? { buildFeedback } : {})
        },
        dependencies
      );
      current = generation.document;
      if (!generation.ok) return { document: current, done: true };

      if (attempt === 1) {
        // A blank reply to a change says what the change does instead.
        const { reply, decision } = generation.result;
        const summary = 'summary' in decision ? decision.summary : undefined;
        current = await appendAssistantResponse(
          current,
          resolveAssistantContent(
            current,
            blankReply(reply) && summary ? [{ type: 'markdown', text: summary }] : reply,
            []
          ),
          assistantBotId(generation.generationEvent),
          operationId,
          dependencies,
          inReplyTo
        );
      }

      // The source each decision asks to build, if any. Edits apply to the source being revised:
      // the failed candidate when repairing it.
      const { decision } = generation.result;
      let candidate: string | undefined;
      let variant: { base?: DesignValues; chosen?: DesignValues; randomise?: string[] } = {
        base: viewed
      };
      switch (decision.action) {
        case 'respond':
        case 'resample':
          break;
        case 'revise':
          candidate = decision.source;
          break;
        case 'vary':
          candidate = buildFeedback?.failedSource ?? entrySource(current);
          variant = variedValues(viewed, decision);
          break;
        case 'edit': {
          const base = buildFeedback?.failedSource ?? entrySource(current);
          const edited = applySourceEdits(base, decision.edits);
          if ('problems' in edited) {
            const summary = `Attempt ${attempt}: the edits could not be applied. ${edited.problems.join(' ')}`;
            failureSummaries.push(summary);
            // Recorded, as a failed build is, so the Timeline holds every candidate set aside.
            current = await appendProjectEvents(
              current,
              [
                draftEvent({
                  type: 'revision.edits-rejected',
                  actor: { kind: 'system' },
                  operationId,
                  payload: {
                    attempt,
                    ...generationReference(current, operationId),
                    problems: edited.problems
                  }
                })
              ],
              dependencies.projectService
            );
            if (attempt === chatbot.config.attemptProfiles.length) {
              return {
                document: await appendExhaustedSverlinFailure(
                  current,
                  operationId,
                  summary,
                  dependencies
                ),
                done: true
              };
            }
            buildFeedback = {
              attempt,
              buildEventId: projectHead(current).id,
              failedSource: base,
              assistantReply: generatedReplyText(generation.result.reply),
              diagnostics: edited.problems.map((message) => ({
                severity: 'error' as const,
                code: 'edit_not_applied',
                message,
                raw: message
              })),
              priorFailureSummaries: [...failureSummaries]
            };
            return { document: current, done: false };
          }
          candidate = edited.source;
          break;
        }
        default:
          throw new Error(
            `Unhandled decision ${(decision satisfies never as { action: string }).action}.`
          );
      }
      if (candidate === undefined) {
        if (attempt === 1) {
          const advanced =
            decision.action === 'resample'
              ? await advanceCandidatesForAgent(
                  current,
                  presentationCount,
                  operationId,
                  dependencies
                )
              : { document: current, presentations: [] };
          current = advanced.document;
          return { document: advanced.document, done: true };
        }
        failureSummaries.push(`Attempt ${attempt} did not return corrected source.`);
        if (!buildFeedback || attempt === chatbot.config.attemptProfiles.length) {
          return {
            document: await appendExhaustedSverlinFailure(
              current,
              operationId,
              failureSummaries.at(-1),
              dependencies
            ),
            done: true
          };
        }
        buildFeedback = {
          ...buildFeedback,
          attempt,
          assistantReply: generatedReplyText(generation.result.reply),
          priorFailureSummaries: [...failureSummaries]
        };
        return { document: current, done: false };
      }

      seeds ??= freshPresentationSeeds(presentationCount);
      const randomised = variant.randomise;
      const requests = basedRequests(seeds, variant.base, variant.chosen).map((request, index) =>
        index === 0 && randomised?.length
          ? { ...request, variant: { ...request.variant, randomise: randomised } }
          : request
      );
      const built = await buildCandidateBatch(
        { document: current, candidate, requests, operationId, attempt },
        dependencies
      );
      current = built.document;
      if (batchSucceeded(built.recorded)) {
        // A new source's presentations show the variants the chooser picks from its design space.
        const shown =
          decision.action === 'revise' || decision.action === 'edit'
            ? await chosenBuild(
                {
                  document: current,
                  recorded: built.recorded,
                  candidate,
                  summary: decision.summary,
                  seeds,
                  operationId,
                  attempt
                },
                dependencies
              )
            : { document: current, recorded: built.recorded };
        current = shown.document;
        assertCurrentProjectOperationActive();
        return {
          document: await acceptSverlinCandidate(
            {
              document: current,
              recorded: shown.recorded,
              generationEvent: generation.generationEvent,
              candidate,
              ...('summary' in decision ? { summary: decision.summary } : {}),
              operationId,
              recovery: generation.result.recovery,
              recoveryReply: generation.result.reply,
              inReplyTo
            },
            dependencies
          ),
          done: true
        };
      }

      const failed = firstFailure(built.recorded);
      if (!failed || failed.buildEvent.type !== 'build.failed') {
        throw new Error('A failed build batch had no failure event.');
      }
      const summary = formatDiagnosticSummary(failed.result.diagnostics);
      failureSummaries.push(`Attempt ${attempt}: ${summary}`);
      if (!failed.buildEvent.payload.repairEligible) {
        return {
          document: await appendSystemFailure(
            current,
            `The proposed visualization could not be checked safely, so I kept the last working visualization. The remaining difficulty was: ${plainFailureSummary(participantDiagnostic(failed.result.diagnostics))}`,
            operationId,
            dependencies
          ),
          done: true
        };
      }
      if (attempt === chatbot.config.attemptProfiles.length) {
        return {
          document: await appendExhaustedSverlinFailure(
            current,
            operationId,
            participantDiagnostic(failed.result.diagnostics),
            dependencies
          ),
          done: true
        };
      }
      buildFeedback = {
        attempt,
        buildEventId:
          current.events.findLast(
            (event) => event.operationId === operationId && event.type === 'build.failed'
          )?.id ?? projectHead(current).id,
        failedSource: candidate,
        assistantReply: generatedReplyText(generation.result.reply),
        diagnostics: failed.result.diagnostics,
        priorFailureSummaries: [...failureSummaries]
      };
      return { document: current, done: false };
    }
  );
}

async function submitCandidateFeedback(
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
      if (!generation.ok) return { document: current, done: true };
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
        return { document: current, done: false };
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
        return { document: current, done: false };
      }
      assertCurrentProjectOperationActive();
      return {
        document: await acceptCandidateTurn(current, accepted, operationId, dependencies),
        done: true
      };
    }
  );
}

type AcceptedCandidateTurn = {
  source: RecordedText;
  presentations: RenderablePresentation[];
  reply: GeneratedMessageContent;
  generationEvent: NewProjectEvent<'ai.generation-succeeded'>;
};

async function acceptCandidateTurn(
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

async function runSverlinGeneration(
  options: {
    chatbot: Chatbot<AiProjectContext, SourceArtifactChatOutput>;
    document: ProjectDocument;
    attempt: number;
    operationId: string;
    contextSelection: AiContextSelection;
    presentationCount: 1 | 2;
    buildFeedback?: BuildFeedback;
  },
  dependencies: ProjectCommandDependencies
) {
  let prompt;
  try {
    prompt = await options.chatbot.preparePrompt({
      messages: projectConversationMessages(options.document.events),
      project: projectAiContext(options.document, options.contextSelection),
      attempt: options.attempt,
      ...(options.buildFeedback ? { buildFeedback: options.buildFeedback } : {})
    });
  } catch (error) {
    return generationPreparationFailure(options, error, dependencies);
  }
  return runPreparedGeneration(
    {
      document: options.document,
      attempt: options.attempt,
      operationId: options.operationId,
      prompt,
      generate: () =>
        options.chatbot.generatePrepared(prompt, { signal: currentProjectOperationSignal() }),
      validateResult: (result) => {
        validateRecoveryExplanation(prompt, result.recovery, result.providerResponse);
        if (
          options.contextSelection.interactionEventIds?.some(
            (id) => options.document.events[id - 1]?.type === 'visualization.preference-recorded'
          ) &&
          result.decision.action === 'resample'
        ) {
          throw new InvalidChatbotResponseError(
            'A deferred preference adaptation cannot advance candidates itself.',
            result.providerResponse
          );
        }
        validateGeneratedReply(result.reply, 0, result.providerResponse);
        if (
          (result.decision.action === 'respond' || result.decision.action === 'resample') &&
          blankReply(result.reply)
        )
          throw new InvalidChatbotResponseError('The reply was blank.', result.providerResponse);
      },
      fallbackResponse: (result) => ({
        reply: result.reply,
        decision: result.decision,
        recovery: result.recovery ?? null,
        generation: result.generation
      })
    },
    dependencies
  );
}

async function runCandidateGeneration(
  options: {
    chatbot: Chatbot<AiProjectContext, CandidateAssistantOutput>;
    document: ProjectDocument;
    attempt: number;
    operationId: string;
    contextSelection: AiContextSelection;
    correction?: string;
  },
  dependencies: ProjectCommandDependencies
) {
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
      generate: () =>
        options.chatbot.generatePrepared(prompt, { signal: currentProjectOperationSignal() }),
      validateResult: (result) => {
        validateGeneratedReply(result.reply, result.candidates.length, result.providerResponse);
        validateRecoveryExplanation(prompt, result.recovery, result.providerResponse);
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

async function generationPreparationFailure(
  options: { document: ProjectDocument; operationId: string; attempt: number },
  error: unknown,
  dependencies: ProjectCommandDependencies
) {
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
    )
  };
}

async function runPreparedGeneration<Output extends object>(
  options: {
    document: ProjectDocument;
    attempt: number;
    operationId: string;
    prompt: ChatbotPrompt;
    generate: () => Promise<ChatbotResult<Output>>;
    validateResult: (result: ChatbotResult<Output>) => void;
    fallbackResponse: (result: ChatbotResult<Output>) => unknown;
    notifyFailure?: boolean;
  },
  dependencies: ProjectCommandDependencies
) {
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
      parameters: { ...options.prompt.parameters }
    }
  });
  let document = await appendProjectEvents(
    options.document,
    [request],
    dependencies.projectService
  );
  const startedAt = performance.now();
  try {
    const result = await options.generate();
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
    return { ok: true as const, document, result, generationEvent };
  } catch (error) {
    const details = generationErrorDetails(error);
    const failed = draftEvent<'ai.generation-failed'>({
      type: 'ai.generation-failed',
      actor: { kind: 'system' },
      operationId: options.operationId,
      payload: {
        attempt: options.attempt,
        failureKind: generationFailureKind(error),
        durationMs: Math.round(performance.now() - startedAt),
        message: safeErrorMessage(error),
        details: recordText(details.value, details.mediaType)
      }
    });
    document = await appendProjectEvents(document, [failed], dependencies.projectService);
    if (options.notifyFailure !== false) {
      document = await appendSystemFailure(
        document,
        failed.payload.message,
        options.operationId,
        dependencies
      );
    }
    return { ok: false as const, document };
  }
}

async function buildCandidateBatch(
  options: {
    document: ProjectDocument;
    candidate: string;
    requests: readonly BuildRequest[];
    operationId: string;
    attempt: number;
  },
  dependencies: ProjectCommandDependencies
) {
  const snapshot = projectSnapshotAt(options.document);
  const entry = snapshot.artifacts[snapshot.entryArtifactId];
  if (!entry) throw new Error('The project has no entry artifact.');
  const source = recordText(options.candidate, entry.content.mediaType);
  const recorded = await buildProjectSourceBatch(
    {
      document: options.document,
      sourceContent: options.candidate,
      source,
      sourceLabel: entry.path,
      requests: options.requests,
      purpose: 'assistant-edit',
      input: 'assistant-candidate',
      operationId: options.operationId,
      attempt: options.attempt
    },
    dependencies.projectService
  );
  return { document: recorded.document, recorded };
}

/**
 * Build a candidate again with the variants the chooser picks from its design space, starting from
 * the first build's variant (the viewed one, with the starter's values for anything new). A value
 * the space does not offer is left out. Without a chooser, or when choosing or building fails, the
 * first build stands.
 */
async function chosenBuild(
  options: {
    document: ProjectDocument;
    recorded: RecordedBuildBatch;
    candidate: string;
    summary?: string;
    seeds: readonly number[];
    operationId: string;
    attempt: number;
  },
  dependencies: ProjectCommandDependencies
): Promise<{ document: ProjectDocument; recorded: RecordedBuildBatch }> {
  const firstBuild = { document: options.document, recorded: options.recorded };
  const chooser = dependencies.getChooser?.();
  const [first] = options.recorded.builds;
  const bundle = first?.result.ok && 'bundle' in first ? first.result.bundle : undefined;
  if (!chooser || !bundle?.variant) return firstBuild;
  const design = designVariables(bundle);
  const prompt = await chooser.preparePrompt({
    messages: projectConversationMessages(options.document.events),
    project: {
      source: options.candidate,
      ...(options.summary ? { summary: options.summary } : {}),
      count: options.seeds.length,
      design,
      ...(bundle.runs ? { runs: bundle.runs } : {})
    },
    attempt: 1
  });
  const generation = await runPreparedGeneration(
    {
      document: options.document,
      attempt: options.attempt,
      operationId: options.operationId,
      prompt,
      generate: () => chooser.generatePrepared(prompt, { signal: currentProjectOperationSignal() }),
      validateResult: () => {},
      fallbackResponse: (result) => ({ variants: result.variants }),
      notifyFailure: false
    },
    dependencies
  );
  if (!generation.ok) return { ...firstBuild, document: generation.document };
  const offered = (key: string) => {
    const found = design.variables.find(({ variable }) => variable === key);
    if (!found) return undefined;
    return typeof found.options === 'string' ? design.options[found.options] : found.options;
  };
  // The first build's values kept from the viewed variant, not those it took from the starter, so
  // the rebuild's starter values are still recorded as the starter's.
  const base = bundle.origins
    ? Object.fromEntries(
        Object.entries(bundle.variant).filter(([key]) => bundle.origins?.[key] !== 'starter')
      )
    : bundle.variant;
  const requests = options.seeds.map((seed, index) => {
    const variant = generation.result.variants[index];
    const chosen = Object.fromEntries(
      (variant?.values ?? [])
        .filter(({ variable, value }) => offered(variable)?.includes(value))
        .map(({ variable, value }) => [variable, value])
    );
    const randomise = (variant?.randomise ?? []).filter((key) => offered(key));
    // A variant the chooser left out is drawn at random, so a pair still has two.
    return {
      seed,
      variant: {
        base,
        chosen,
        ...(!variant ? { randomise: true as const } : randomise.length ? { randomise } : {})
      }
    };
  });
  const rebuilt = await buildCandidateBatch(
    {
      document: generation.document,
      candidate: options.candidate,
      requests,
      operationId: options.operationId,
      attempt: options.attempt
    },
    dependencies
  );
  return batchSucceeded(rebuilt.recorded)
    ? { document: rebuilt.document, recorded: rebuilt.recorded }
    : { document: rebuilt.document, recorded: options.recorded };
}

/** The entry artifact's source in a project's newest state. */
function entrySource(document: ProjectDocument): string {
  const snapshot = projectSnapshotAt(document);
  return snapshot.artifacts[snapshot.entryArtifactId]?.content.text ?? '';
}

async function acceptSverlinCandidate(
  options: {
    document: ProjectDocument;
    recorded: RecordedBuildBatch;
    generationEvent: NewProjectEvent<'ai.generation-succeeded'>;
    candidate: string;
    /** What the revision shows, for a first source, or what it changes. */
    summary?: string;
    operationId: string;
    recovery?: RecoveryExplanation;
    recoveryReply: GeneratedMessageContent;
    inReplyTo: readonly EventId[];
  },
  dependencies: ProjectCommandDependencies
) {
  const snapshot = projectSnapshotAt(options.document);
  const current = snapshot.artifacts[snapshot.entryArtifactId];
  if (!current) throw new Error('The project has no entry artifact.');
  const change: ArtifactChange = {
    operation: 'upsert',
    artifact: { ...current, content: recordText(options.candidate, current.content.mediaType) }
  };
  // New variants of an unchanged source join its version.
  const unchanged = options.candidate === current.content.text;
  let document = await appendProjectEvents(
    options.document,
    unchanged
      ? []
      : [
          draftEvent({
            type: 'artifact.version-created',
            actor: options.generationEvent.actor,
            operationId: options.operationId,
            payload: {
              origin: { kind: 'assistant-edit' },
              changes: [change],
              ...(options.summary ? { summary: options.summary } : {})
            }
          })
        ],
    dependencies.projectService
  );
  document = await activateBuiltPresentations(
    { ...options.recorded, document },
    dependencies.projectService,
    options.generationEvent.actor
  );
  if (!options.recovery) return document;
  return appendAssistantResponse(
    document,
    resolveAssistantContent(
      document,
      replyWithRecovery(options.recoveryReply, options.recovery),
      []
    ),
    assistantBotId(options.generationEvent),
    options.operationId,
    dependencies,
    options.inReplyTo
  );
}

async function advanceCandidatesForAgent(
  document: ProjectDocument,
  presentationCount: 1 | 2,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<{ document: ProjectDocument; presentations: RenderablePresentation[] }> {
  const current = presentationBufferState(document, 0).available.slice(0, presentationCount);
  let available = presentationBufferState(document, 0).available;
  const remaining = available.slice(current.length);
  if (remaining.length < presentationCount) {
    const snapshot = projectSnapshotAt(document);
    const artifact = snapshot.artifacts[snapshot.entryArtifactId];
    if (!artifact || snapshot.mode !== 'sverlin') {
      throw new Error('Only Sverlin projects can generate buffered candidates from source.');
    }
    const recorded = await buildProjectSourceBatch(
      {
        document,
        sourceContent: artifact.content.text,
        source: artifact.content,
        sourceLabel: artifact.path,
        requests: freshPresentationSeeds((presentationCount - remaining.length) as 1 | 2).map(
          (seed) => ({ seed })
        ),
        purpose: 'seed-change',
        input: 'committed-artifact',
        operationId
      },
      dependencies.projectService
    );
    document = recorded.document;
    if (!batchSucceeded(recorded)) {
      throw new Error('The next visualization candidates could not be built.');
    }
    document = await activateBuiltPresentations(recorded, dependencies.projectService);
    available = presentationBufferState(document, 0).available;
  }
  if (current.length > 0) {
    document = await appendProjectEvents(
      document,
      [
        draftEvent({
          type: 'visualization.candidates-advanced',
          actor: { kind: 'system' },
          operationId,
          payload: {
            presentations: current.map(({ presentationId }) => presentationId),
            reason: 'agent-request'
          }
        })
      ],
      dependencies.projectService
    );
    available = presentationBufferState(document, 0).available;
  }
  const ids = new Set(
    available.slice(0, presentationCount).map(({ presentationId }) => presentationId)
  );
  return {
    document,
    presentations: document.events.flatMap((event) =>
      event.type === 'visualization.presented' && ids.has(event.payload.presentation.presentationId)
        ? [event.payload.presentation]
        : []
    )
  };
}

function resolveAssistantContent(
  document: ProjectDocument,
  reply: GeneratedMessageContent,
  candidates: readonly RenderablePresentation[]
): MessageContent {
  const knownPresentationIds = document.events.flatMap((event) =>
    event.type === 'visualization.presented' ? [event.payload.presentation.presentationId] : []
  );
  const content: MessageContent = structureKnownPresentationReferences(
    reply,
    knownPresentationIds
  ).map((segment) => {
    if (segment.type === 'presentation-ref') {
      const presentationId = repairedPresentationId(segment.presentationId, knownPresentationIds);
      return presentationId
        ? { type: 'presentation-ref', presentationId }
        : { type: 'markdown', text: 'that presentation' };
    }
    if (segment.type !== 'candidate-ref') return segment;
    const presentation = candidates[segment.slot];
    if (!presentation) {
      throw new Error(`The assistant referenced unavailable candidate slot ${segment.slot}.`);
    }
    return { type: 'presentation-ref', presentationId: presentation.presentationId };
  });
  return content;
}

/**
 * The retained presentation a reply's reference means. Models sometimes copy a presentation id's
 * start and garble the rest, so an unknown id resolves to the one known presentation sharing its
 * first group, if exactly one does; otherwise it names none, and the reply keeps its prose.
 */
function repairedPresentationId(
  presentationId: string,
  knownPresentationIds: readonly string[]
): string | undefined {
  const id = presentationId.toLowerCase();
  const exact = knownPresentationIds.find((known) => known.toLowerCase() === id);
  if (exact) return exact;
  const prefix = id.split('-')[0];
  const matches = knownPresentationIds.filter((known) =>
    known.toLowerCase().startsWith(`${prefix}-`)
  );
  return prefix.length === 8 && matches.length === 1 ? matches[0] : undefined;
}

/** A reply with nothing to read: no references, and only blank text. */
/** The id of the operation's newest successful generation, which a record can refer to. */
function generationReference(
  document: ProjectDocument,
  operationId: string
): { generationEventId?: EventId } {
  const id = document.events.findLast(
    (event) => event.operationId === operationId && event.type === 'ai.generation-succeeded'
  )?.id;
  return id === undefined ? {} : { generationEventId: id };
}

function blankReply(reply: GeneratedMessageContent): boolean {
  return reply.every((segment) => segment.type === 'markdown' && !segment.text.trim());
}

function validateGeneratedReply(
  reply: GeneratedMessageContent,
  candidateCount: number,
  providerResponse?: unknown
): void {
  // Unknown presentation ids are repaired or dropped when the reply is resolved, not rejected.
  try {
    for (const segment of reply) {
      if (segment.type === 'candidate-ref' && segment.slot >= candidateCount) {
        throw new Error(`The assistant referenced unavailable candidate slot ${segment.slot}.`);
      }
    }
  } catch (cause) {
    throw new InvalidChatbotResponseError(
      cause instanceof Error ? cause.message : 'The chatbot returned invalid references.',
      providerResponse
    );
  }
}

function validateRecoveryExplanation(
  prompt: ChatbotPrompt,
  recovery: RecoveryExplanation | undefined,
  providerResponse?: unknown
): void {
  if (prompt.attempt.purpose === 'fallback' && !recovery) {
    throw new InvalidChatbotResponseError(
      'The fallback response did not explain what was simplified.',
      providerResponse
    );
  }
  if (prompt.attempt.purpose !== 'fallback' && recovery) {
    throw new InvalidChatbotResponseError(
      'A non-fallback response unexpectedly included a recovery explanation.',
      providerResponse
    );
  }
}

function generatedReplyText(reply: GeneratedMessageContent): string {
  return reply
    .map((segment) => {
      if (segment.type === 'markdown') return segment.text;
      if (segment.type === 'presentation-ref') return `[Presentation ${segment.presentationId}]`;
      return `[Candidate ${segment.slot + 1}]`;
    })
    .join(' ');
}

function batchSucceeded(batch: RecordedBuildBatch): boolean {
  return batch.builds.length > 0 && batch.builds.every(({ result }) => result.ok);
}

function firstFailure(
  batch: RecordedBuildBatch
): Extract<RecordedBuild, { result: { ok: false } }> | undefined {
  return batch.builds.find(({ result }) => !result.ok) as
    | Extract<RecordedBuild, { result: { ok: false } }>
    | undefined;
}

function appendAssistantResponse(
  document: ProjectDocument,
  content: string | MessageContent,
  botId: string,
  operationId: string,
  dependencies: ProjectCommandDependencies,
  inReplyTo: readonly EventId[] = [],
  intakeStep?: ParticipantIntakeStepId
) {
  return appendProjectEvents(
    document,
    [
      draftEvent({
        type: 'assistant.responded',
        actor: { kind: 'assistant', botId },
        operationId,
        payload: {
          content: typeof content === 'string' ? markdownMessage(content) : content,
          ...(inReplyTo.length > 0 ? { inReplyTo: [...inReplyTo] } : {}),
          ...(intakeStep ? { intakeStep } : {})
        }
      })
    ],
    dependencies.projectService
  );
}

function assistantBotId(event: NewProjectEvent<'ai.generation-succeeded'>): string {
  if (event.actor.kind !== 'assistant') {
    throw new Error('A successful AI generation must have an assistant actor.');
  }
  return event.actor.botId;
}

function appendSystemFailure(
  document: ProjectDocument,
  message: string,
  operationId: string,
  dependencies: ProjectCommandDependencies
) {
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

function appendAttemptDeadlineFailure(
  document: ProjectDocument,
  operationId: string,
  dependencies: ProjectCommandDependencies
) {
  return appendSystemFailure(
    document,
    'This visualization needed another attempt, but there was not enough time left in the study phase to complete it safely. I kept the last working visualization.',
    operationId,
    dependencies
  );
}

function appendExhaustedSverlinFailure(
  document: ProjectDocument,
  operationId: string,
  finalDifficulty: string | undefined,
  dependencies: ProjectCommandDependencies
) {
  return appendSystemFailure(
    document,
    `I could not build the requested visualization after several repairs and a simpler fallback, so I kept the last working visualization.${finalDifficulty ? ` The remaining difficulty was: ${plainFailureSummary(finalDifficulty)}` : ''}`,
    operationId,
    dependencies
  );
}

function appendExhaustedCandidateFailure(
  document: ProjectDocument,
  operationId: string,
  finalDifficulty: string,
  dependencies: ProjectCommandDependencies
) {
  return appendSystemFailure(
    document,
    `I could not make the requested visualization pass the safety checks after several repairs and a simpler fallback, so I kept the last working visualization. The remaining difficulty was: ${plainFailureSummary(finalDifficulty)}`,
    operationId,
    dependencies
  );
}

async function runAttemptLadder(
  document: ProjectDocument,
  operationId: string,
  chatbot: {
    config: { attemptProfiles: readonly unknown[] };
    requestTimeoutMs(): number;
  },
  dependencies: ProjectCommandDependencies,
  runAttempt: (
    document: ProjectDocument,
    attempt: number
  ) => Promise<{ document: ProjectDocument; done: boolean }>
): Promise<ProjectDocument> {
  for (let attempt = 1; attempt <= chatbot.config.attemptProfiles.length; attempt += 1) {
    if (attempt > 1 && !hasTimeForAnotherAttempt(chatbot)) {
      return appendAttemptDeadlineFailure(document, operationId, dependencies);
    }
    const result = await runAttempt(document, attempt);
    document = result.document;
    if (result.done) return document;
  }
  throw new Error('The configured attempt ladder ended without a terminal result.');
}

function hasTimeForAnotherAttempt(chatbot: { requestTimeoutMs(): number }): boolean {
  const deadline = currentProjectOperationDeadline();
  return deadline === undefined || deadline - Date.now() >= chatbot.requestTimeoutMs();
}

function replyWithRecovery(
  reply: GeneratedMessageContent,
  recovery?: RecoveryExplanation
): GeneratedMessageContent {
  if (!recovery) return reply;
  return [
    {
      type: 'markdown',
      text: `I ran into a difficulty: ${plainFailureSummary(recovery.struggledWith)} To produce a working visualization, I simplified ${plainFailureSummary(recovery.simplified)}`
    },
    ...reply
  ];
}

function participantDiagnostic(diagnostics: readonly { message: string }[]): string {
  return diagnostics.length > 0
    ? 'the generated program still did not satisfy the visualization language checks'
    : 'the visualization builder could not validate the generated source';
}

function plainFailureSummary(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text) return 'an unspecified validation problem.';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function validateFocus(document: ProjectDocument, focus: EventId[]) {
  const unique = [...new Set(focus)];
  for (const id of unique) {
    if (document.events[id - 1]?.id !== id) throw new Error(`Unknown focused event ${id}.`);
  }
  return unique;
}

function validatePresentations(document: ProjectDocument, presentationIds: string[]): string[] {
  const unique = [...new Set(presentationIds)];
  if (unique.length > 2) throw new Error('Feedback can reference at most two presentations.');
  const available = new Set(
    document.events.flatMap((event) =>
      event.type === 'visualization.presented' ? [event.payload.presentation.presentationId] : []
    )
  );
  for (const id of unique) {
    if (!available.has(id)) throw new Error(`Unknown selected presentation ${id}.`);
  }
  return unique;
}

async function validateMessageContent(
  document: ProjectDocument,
  content: MessageContent
): Promise<MessageContent> {
  const presentations = validatePresentations(document, referencedPresentations(content));
  const known = new Set(presentations);
  for (const segment of content) {
    if (segment.type === 'markdown') continue;
    if (!known.has(segment.presentationId)) {
      throw new Error(`Unknown referenced presentation ${segment.presentationId}.`);
    }
    if (segment.type === 'element-ref') validateElementReference(document, segment);
    else if (segment.step !== undefined)
      validateReferencedStep(document, segment.presentationId, segment.step);
  }
  return content.map((segment) =>
    segment.type === 'markdown' ? segment : named(document, segment)
  );
}

/** A reference at a step, named as its presentation names the step, where it does. */
function named<Reference extends Exclude<MessageContent[number], { type: 'markdown' }>>(
  document: ProjectDocument,
  reference: Reference
): Reference {
  const presentation = document.events.find(
    (event) =>
      event.type === 'visualization.presented' &&
      event.payload.presentation.presentationId === reference.presentationId
  );
  const name =
    presentation?.type === 'visualization.presented' && reference.step !== undefined
      ? presentationStepName(presentation.payload.presentation, reference.step)
      : undefined;
  const renamed = { ...reference, stepName: name };
  if (!name) delete renamed.stepName;
  return renamed;
}

/** A presentation referenced at a step must have that step. */
function validateReferencedStep(
  document: ProjectDocument,
  presentationId: string,
  step: number
): void {
  const presentation = document.events.find(
    (event) =>
      event.type === 'visualization.presented' &&
      event.payload.presentation.presentationId === presentationId
  );
  if (presentation?.type !== 'visualization.presented') return;
  if (step >= presentationStepLabels(presentation.payload.presentation).length)
    throw new Error(`Presentation ${presentationId} has no step ${step + 1}.`);
}

/** An element reference must name a step of a Sverlin presentation and a <Node> in its source. */
function validateElementReference(document: ProjectDocument, reference: ElementReference): void {
  const presentation = document.events.find(
    (event) =>
      event.type === 'visualization.presented' &&
      event.payload.presentation.presentationId === reference.presentationId
  );
  if (presentation?.type !== 'visualization.presented') return;
  const value = presentation.payload.presentation;
  if (!isSverlinPresentation(value))
    throw new Error('Only Sverlin presentations support element references.');
  if (reference.step >= presentationStepLabels(value).length)
    throw new Error(`Presentation ${reference.presentationId} has no step ${reference.step + 1}.`);
  if (!locateElement(value.source.text, reference.element.id))
    throw new Error(`Element ${reference.element.id} is not a node of that presentation.`);
  for (const { node } of reference.element.layouts ?? [])
    if (node !== 'frame' && !locateElement(value.source.text, node))
      throw new Error(`Layout node ${node} is not a node of that presentation.`);
}

/** Element references in a message. */
function referencedElements(content: MessageContent): ElementReference[] {
  return content.filter((segment): segment is ElementReference => segment.type === 'element-ref');
}

function referencedPresentations(content: MessageContent): string[] {
  return [
    ...new Set(
      content.flatMap((segment) => (segment.type === 'markdown' ? [] : [segment.presentationId]))
    )
  ];
}

function finishMutation(before: ProjectDocument, document: ProjectDocument): ProjectCommandResult {
  return { document, appendedEvents: document.events.slice(before.events.length) };
}

function assertAcceptedInteraction(
  document: ProjectDocument,
  operationId: string,
  kind: 'feedback' | 'prefer'
): void {
  const operation = projectOperation(document, operationId);
  if (
    !operation ||
    operation.kind !== kind ||
    operation.status === 'completed' ||
    operation.status === 'failed'
  ) {
    throw new Error(`The ${kind} operation is not active.`);
  }
}

function rebasingDependencies(
  dependencies: ProjectCommandDependencies
): ProjectCommandDependencies {
  const repository = rebasingRepository(dependencies.repository);
  return {
    ...dependencies,
    repository,
    projectService: { ...dependencies.projectService, repository }
  };
}

function rebasingRepository(repository: ProjectRepository): ProjectRepository {
  return {
    initialize: () => repository.initialize(),
    create: (document, ownerUserId) => repository.create(document, ownerUserId),
    list: (ownerUserId) => repository.list(ownerUserId),
    load: (projectId) => repository.load(projectId),
    eventsAfter: (projectId, after) => repository.eventsAfter(projectId, after),
    deleteAll: () => repository.deleteAll(),
    append: (projectId, _expectedHead, events) =>
      runProjectCommand(projectId, async () => {
        const current = await repository.load(projectId);
        return repository.append(projectId, projectHead(current).id, events);
      })
  };
}

function assertHead(document: ProjectDocument, expectedHead: EventId) {
  if (projectHead(document).id !== expectedHead) {
    const error = new Error('The project changed before this operation completed.');
    error.name = 'ProjectConflictError';
    throw error;
  }
}

function candidateCorrection(
  candidates: Array<{ label: string; manifest: unknown }>,
  cause: unknown,
  failureSummaries: readonly string[]
): string {
  return `The previous candidate batch failed validation: ${errorMessage(cause)}. Return one complete corrected batch of up to two candidates. Previous candidates: ${JSON.stringify(candidates)}. Failure history: ${JSON.stringify(failureSummaries.map((summary) => summary.slice(0, 2_000)))}`;
}

function generationFailureKind(error: unknown) {
  if (error instanceof Error && error.name === 'OpenAIConfigurationError') return 'configuration';
  if (
    error instanceof Error &&
    (error.name === 'APITimeoutError' || error.name === 'APIConnectionTimeoutError')
  )
    return 'timeout';
  if (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      error.name === 'APIUserAbortError' ||
      error.name === 'StudyPhaseDeadlineError')
  )
    return 'cancelled';
  if (error instanceof Error && error.name === 'InvalidChatbotResponseError') {
    return 'invalid-response';
  }
  return 'provider';
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.name === 'OpenAIConfigurationError') return error.message;
  if (error instanceof Error && error.name === 'ChatContextOverflowError') return error.message;
  if (
    error instanceof Error &&
    (error.name === 'APITimeoutError' || error.name === 'APIConnectionTimeoutError')
  )
    return 'The AI request timed out.';
  if (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      error.name === 'APIUserAbortError' ||
      error.name === 'StudyPhaseDeadlineError')
  ) {
    const reason = currentProjectOperationSignal()?.reason;
    return reason instanceof Error
      ? reason.message
      : 'The AI request was cancelled before it could finish.';
  }
  if (error instanceof Error && error.name === 'InvalidChatbotResponseError') return error.message;
  return 'The AI service could not complete this request.';
}

function generationErrorDetails(error: unknown) {
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

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The variant a vary decision builds from: the viewed one, with the values it sets, and the
 * variables it asks to draw afresh.
 */
function variedValues(
  viewed: DesignValues | undefined,
  decision: SourceDecisionOf<'vary'>
): { base?: DesignValues; chosen: DesignValues; randomise: string[] } {
  return {
    ...(viewed ? { base: viewed } : {}),
    chosen: Object.fromEntries(decision.values.map(({ variable, value }) => [variable, value])),
    randomise: [...decision.randomise]
  };
}
