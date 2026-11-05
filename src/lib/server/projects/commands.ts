/** Mode-neutral AI feedback, candidate validation, and bounded attempt orchestration. */

import { randomUUID } from 'node:crypto';

import { APIConnectionTimeoutError, APIUserAbortError } from 'openai';

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
import type { FeedbackViewing } from '$lib/shared/projects/events/feedback-submitted';
import type { ArtifactChange, RecordedText } from '$lib/shared/projects/events/values';
import type { ProjectCommandResult, ProjectDocument } from '$lib/shared/projects/model';
import {
  presentationBufferState,
  waitingComparisons
} from '$lib/shared/projects/presentation-buffer';
import {
  stepPlaces,
  type DesignValues,
  type RenderablePresentation
} from '$lib/shared/presentations';
import {
  isSverlinPresentation,
  presentationMode,
  presentationStepLabels,
  presentationStepName,
  presentationVariant
} from '$lib/shared/presentations';
import { headStillCurrent, projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import { differingSteps } from '$lib/shared/differing-steps';
import { unreadableProblem } from '$lib/shared/readability';
import { cutText } from '$lib/shared/text';
import { interfaceReferenceFor } from '$lib/shared/interface-parts';
import { assistantTurnClaim, projectOperation } from '$lib/shared/projects/operations';
import {
  getChatbot,
  getCandidateChatbot,
  getParticipantIntakeClassifier
} from '$lib/server/chat-bots/registry';
import { modeCatalog } from '$lib/modes/catalog';
import { locateElement } from '$lib/modes/sverlin/element-ref';
import {
  checkCandidate,
  mainViewType,
  proposedViewsFormat,
  viewHelperDirections,
  viewHelperPrompt,
  viewHelperTask,
  type ProposedView
} from '$lib/modes/sverlin/view-helpers.server';
import { openAIAdapter } from '$lib/server/chat-adapters/openai';
import type { ChatAdapter } from '$lib/server/chat-adapters/types';
import { turnViewHelpers } from './view-helpers-config';
import {
  viewHelperBackground,
  viewHelperCalls,
  viewHelpersContext,
  viewHelperTimeoutMs
} from './view-helpers';
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
  sourceBuildFacts,
  viewedPresentation,
  type AiContextSelection,
  type AiDesign,
  type AiProjectContext
} from '$lib/server/chat-bots/project-context';
import type {
  Chatbot,
  ChatbotPrompt,
  ChatbotResult,
  CandidateAssistantOutput,
  BuildFeedback,
  ChatTurn,
  GeneratedMessageContent,
  RecoveryExplanation,
  SourceArtifactChatOutput,
  ViewHelpersRequest
} from '$lib/server/chat-bots/types';
import type {
  Comparisons,
  DecisionQuestion,
  SourceDecision,
  SourceDecisionOf
} from '$lib/server/chat-bots/source-decisions';
import { heldQuestion, openQuestion } from '$lib/shared/projects/questions';
import {
  briefAttribute,
  projectBrief,
  type BriefEntry,
  type BriefItem
} from '$lib/shared/projects/brief';
import { briefSteering, type BriefSteering } from '$lib/server/chat-bots/brief-context';
import { elementIdSchema } from '$lib/shared/projects/events/message-content';
import * as v from 'valibot';
import { applySourceEdits } from '$lib/server/chat-bots/source-edits';

import { runProjectCommand } from './command-lock';
import { formatDiagnosticSummary } from './diagnostics';
import { recordText, sourceSha256 } from './fingerprints';
import { appendProjectPreference, type PreferenceAnswer } from './presentations';
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
  queueBuiltPresentations,
  randomVariantRequests,
  type PairQuestion,
  type ProjectServiceDependencies,
  type RecordedBuild,
  type RecordedBuildBatch,
  type VariantRequester
} from './service';
import {
  chooseVariants,
  chosenRequests,
  differences,
  offeredOptions,
  randomChooser,
  type DesignSource
} from './choosers';
import {
  answersAfter,
  askedPair,
  allowedComparisonSide,
  mootComparison,
  pictureTree,
  settledValues,
  type Answer,
  type GuardContext
} from './variant-guard';

/** Replaceable AI and persistence boundaries used by command unit tests. */
export type ProjectCommandDependencies = {
  repository: typeof projectRepository;
  projectService: ProjectServiceDependencies;
  getChatbot: typeof getChatbot;
  getCandidateChatbot: typeof getCandidateChatbot;
  getParticipantIntakeClassifier: typeof getParticipantIntakeClassifier;
  /** Draws whether each comparison shows its sides the other way round (below 0.5 keeps them). */
  comparisonOrder?: () => number;
  /** The provider the view helpers call, the default's where absent. */
  viewHelperAdapter?: ChatAdapter;
};

export const defaultProjectCommandDependencies: ProjectCommandDependencies = {
  repository: projectRepository,
  projectService: defaultProjectServiceDependencies,
  getChatbot,
  getCandidateChatbot,
  getParticipantIntakeClassifier
};

/**
 * New variants of the source as it is, from the presentation they are made from (or the newest of
 * the source), drawn at random, keeping the values preferences and the assistant's vary decisions
 * settled (see variant-guard.ts).
 */
export function chosenVariantRequests(): VariantRequester {
  return async (options) => {
    const snapshot = projectSnapshotAt(options.document);
    const artifact = snapshot.artifacts[snapshot.entryArtifactId];
    const shown = sourcePresentations(options.document, artifact?.content.sha256);
    const from = options.from
      ? shown.find(({ presentationId }) => presentationId === options.from)
      : shown.at(-1);
    if (!artifact || !from?.variant) return randomVariantRequests(options);
    const design: DesignSource = {
      ...from,
      ...sourceBuildFacts(options.document, from.source.sha256)
    };
    const chosen = await chooseVariants(randomChooser, {
      document: options.document,
      source: artifact.content.text,
      count: options.seeds.length,
      design,
      seen: differences(
        shown
          .slice(-recentlySeen)
          .reverse()
          .flatMap(({ variant }) => (variant ? [variant] : [])),
        from.variant
      ),
      settled: settledValues(options.document.events),
      operationId: options.operationId,
      attempt: 1
    });
    return {
      document: chosen.document,
      requests: chosenRequests(options.seeds, designVariables(design), from.variant, chosen.choices)
    };
  };
}

/** How many of a source's newest presentations count as already seen. */
const recentlySeen = 8;

/** The presentations of a source, oldest first. */
function sourcePresentations(document: ProjectDocument, sha256: string | undefined) {
  return document.events.flatMap((event) =>
    event.type === 'visualization.presented' &&
    event.payload.presentation.format === 'browser-bundle-v1' &&
    event.payload.presentation.source.sha256 === sha256
      ? [event.payload.presentation]
      : []
  );
}

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
    viewing?: FeedbackViewing;
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
    const viewing = options.viewing && validateViewing(before, options.viewing);
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
            ...(options.from ? { from: options.from } : {}),
            ...(viewing ? { viewing } : {}),
            ...answering(based)
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
    answer: PreferenceAnswer;
    step: number;
    comment?: MessageContent;
    deadlineAt?: string;
  },
  dependencies: ProjectCommandDependencies = defaultProjectCommandDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    assertCurrentProjectOperationActive();
    const before = await dependencies.repository.load(options.projectId);
    assertAcceptedInteraction(before, options.operationId, 'prefer');
    const based = await basedOnAnswer(before, options.answer, options.operationId, dependencies);
    let document = await appendProjectPreference(
      based,
      { ...options, comment: await validatedComment(before, options.comment) },
      dependencies.projectService
    );
    const preference = document.events.findLast(
      (event) =>
        event.operationId === options.operationId &&
        event.type === 'visualization.preference-recorded'
    );
    if (preference?.type !== 'visualization.preference-recorded') {
      throw new Error('The recorded preference event could not be resolved.');
    }
    const answered = await dropMootComparisons(
      document,
      answersAfter(document.events, preference.id - 1),
      options.operationId,
      dependencies
    );
    document = answered.document;
    // An answer that went back to an earlier source still asks for a turn, which shows that
    // source's next comparison or version (presentAfterRebase).
    if (answered.waiting && based === before) return finishMutation(before, document);
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
  const content = [
    ...feedback.flatMap((event) => event.payload.content),
    ...preferences.flatMap((event) => event.payload.comment ?? [])
  ];
  const contextSelection: AiContextSelection = {
    eventIds: [...new Set(feedback.flatMap((event) => event.payload.focus))],
    presentationIds: [
      ...new Set([
        ...referencedPresentations(content),
        ...feedback.flatMap((event) => viewedPresentations(event.payload.viewing)),
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
  const appendedSince = (document: ProjectDocument) =>
    document.events.filter(
      (event) => event.id > projectHead(before).id && event.operationId === options.operationId
    );
  // Answers to the assistant's comparisons wait for the last to be answered: those that arrived
  // while the rest were still being built are dropped here, as they would have been on arrival.
  let current = before;
  let waiting = false;
  if (preferences.length && preferences.length === interactions.length) {
    const answered = await dropMootComparisons(
      current,
      answersAfter(current.events, Math.min(...preferences.map(({ id }) => id)) - 1),
      options.operationId,
      concurrentDependencies
    );
    current = answered.document;
    waiting = answered.waiting;
  }
  const rebase = unshownRebase(current, preferences);
  if (rebase)
    current = await presentAfterRebase(
      current,
      rebase,
      options.operationId,
      concurrentDependencies
    );
  if (waiting) return { document: current, appendedEvents: appendedSince(current) };
  // A question held back with comparisons is asked once the last is answered, or when the
  // participant writes first; answers alone then wait with it for the participant's reply.
  const answersOnly = preferences.length === interactions.length;
  if (heldQuestion(current.events) && !(answersOnly && waitingComparisons(current).length)) {
    current = await releaseHeldQuestion(current, options.operationId, concurrentDependencies);
    if (answersOnly) return { document: current, appendedEvents: appendedSince(current) };
  }
  const intake = await handleParticipantIntake(
    current,
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
    viewing?: FeedbackViewing;
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
    viewing?: FeedbackViewing;
  },
  dependencies: ProjectCommandDependencies
): Promise<ProjectCommandResult> {
  const before = await dependencies.repository.load(options.projectId);
  assertHead(before, options.expectedHead);
  const focus = validateFocus(before, options.focus);
  const content = await validateMessageContent(before, options.content);
  const viewing = options.viewing && validateViewing(before, options.viewing);
  const presentations = [
    ...new Set([...referencedPresentations(content), ...viewedPresentations(viewing)])
  ];

  let document = await appendProjectEvents(
    before,
    [
      draftEvent({
        type: 'feedback.submitted',
        actor: { kind: 'user' },
        operationId: options.operationId,
        payload: { content, focus, ...(viewing ? { viewing } : {}), ...answering(before) }
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
  document = await releaseHeldQuestion(document, options.operationId, dependencies);
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
    answer: PreferenceAnswer;
    step: number;
    comment?: MessageContent;
    operationId: string;
  },
  dependencies: ProjectCommandDependencies = defaultProjectCommandDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    const before = await dependencies.repository.load(options.projectId);
    assertHead(before, options.expectedHead);
    const based = await basedOnAnswer(before, options.answer, options.operationId, dependencies);
    let document = await appendProjectPreference(
      based,
      { ...options, comment: await validatedComment(before, options.comment) },
      dependencies.projectService
    );
    const preference = document.events.findLast(
      (event) =>
        event.operationId === options.operationId &&
        event.type === 'visualization.preference-recorded'
    );
    if (preference?.type !== 'visualization.preference-recorded') {
      throw new Error('The recorded preference event could not be resolved.');
    }
    const answered = await dropMootComparisons(
      document,
      answersAfter(document.events, preference.id - 1),
      options.operationId,
      dependencies
    );
    document = answered.document;
    if (answered.waiting) return finishMutation(before, document);
    if (heldQuestion(document.events))
      return finishMutation(
        before,
        await releaseHeldQuestion(document, options.operationId, dependencies)
      );
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

/**
 * The assistant builds on the candidate the participant preferred; either is fine and unsure
 * leave the source as it is.
 */
function basedOnAnswer(
  document: ProjectDocument,
  answer: PreferenceAnswer,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  return 'preferred' in answer
    ? baseOnPresentation(document, answer.preferred, operationId, dependencies.projectService)
    : Promise.resolve(document);
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

    // The last question's answer completes intake.
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
      { intakeStep: next.id }
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
  const turn: ChatTurn =
    entrySource(document) === modeCatalog[projectSnapshotAt(document).mode].starter.source ||
    (contextSelection.interactionEventIds ?? []).some(
      (id) => document.events[id - 1]?.type === 'visualization.runtime-failed'
    )
      ? 'authoring'
      : 'feedback';
  let seeds: number[] = [];
  const failureSummaries: string[] = [];
  let buildFeedback: BuildFeedback | undefined;
  const turnBrief = new Map<BriefEntry['key'], BriefEntry>();
  // Whether a built picture went back to the assistant for a soft problem, text too small to read,
  // warnings, or alternatives it offered none of: one does once a turn, then it shows as built.
  let softReturned = false;
  // What the assistant asked the view helpers to propose views of, where they are on.
  let helperRequest: ViewHelpersRequest | undefined;
  const startedFrom = entrySource(document);

  const done = await runAttemptLadder(
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
          turn,
          presentationCount,
          ...(buildFeedback ? { buildFeedback } : {})
        },
        dependencies
      );
      current = generation.document;
      if (!generation.ok) {
        if (!generation.retried) return { document: current, done: true };
        // The next attempt repairs what the last usable one left, if anything, told of this one.
        failureSummaries.push(`Attempt ${attempt}: ${generation.message}`);
        if (buildFeedback)
          buildFeedback = { ...buildFeedback, priorFailureSummaries: [...failureSummaries] };
        return { document: current, done: false };
      }
      // What the participant said holds whether or not the decision with it could be built: the
      // brief entries of every attempt this turn, the latest for each attribute, steer this
      // decision's comparisons and are recorded with the accepted reply.
      for (const entry of generation.result.brief ?? []) turnBrief.set(entry.key, entry);
      helperRequest = generation.result.viewHelpers ?? helperRequest;
      const brief = turnBrief.size ? [...turnBrief.values()] : undefined;

      // The reply is recorded last, once its decision is accepted and has presented its version (a
      // comparison's first pair), so the reply of an attempt set aside is never the turn's and the
      // reply, its question, and what it presents arrive together; its candidate-refs, and a
      // question about the new version, name what this turn presented. A blank reply to a change
      // says what the change does instead; the fallback's starts with what it simplified. A note
      // follows what the reply says, as which comparisons were left out. A question asked with
      // comparisons is held back, to be read after them (releaseHeldQuestion).
      const recordReply = (
        document: ProjectDocument,
        presented: readonly RenderablePresentation[] = [],
        note?: string,
        compared = false
      ) => {
        const { reply, decision, recovery } = generation.result;
        const summary = 'summary' in decision ? decision.summary : undefined;
        const question = recordedQuestion(
          document,
          'question' in decision ? decision.question : undefined,
          presented
        );
        const said: GeneratedMessageContent =
          blankReply(reply) && summary ? [{ type: 'markdown', text: summary }] : reply;
        const last = said.at(-1);
        const noted: GeneratedMessageContent = !note
          ? said
          : last?.type === 'markdown'
            ? [...said.slice(0, -1), { type: 'markdown', text: `${last.text.trimEnd()} ${note}` }]
            : [...said, { type: 'markdown', text: note }];
        return appendAssistantResponse(
          document,
          resolveAssistantContent(document, replyWithRecovery(noted, recovery), presented),
          assistantBotId(generation.generationEvent),
          operationId,
          dependencies,
          inReplyTo,
          {
            ...(question ? (compared ? { heldQuestion: question } : { question }) : {}),
            ...(brief ? { brief } : {})
          }
        );
      };

      // The source each decision asks to build, if any. Edits apply to the source being revised:
      // the failed candidate when repairing it.
      const { decision } = generation.result;
      // The assistant designs every alternative as a comparison, so no chooser fills presentations it
      // did not design: a count goes back to it once to redesign, and after that is ignored.
      const queued: number | undefined = undefined;
      const counted = 'count' in decision && Boolean(decision.count);
      // A decision that cannot be built as given is recorded, as a failed build is, so the Timeline
      // holds every candidate set aside, and the next attempt repairs it.
      const reject = async (
        kind: 'edits' | 'comparisons' | 'picture' | 'warnings' | 'alternatives',
        problems: string[],
        failedSource: string
      ) => {
        const outcome = {
          edits: 'the edits could not be applied',
          comparisons: 'the comparisons could not be built',
          picture: 'the picture drew too large to read',
          warnings: 'the picture built with warnings',
          alternatives: 'the picture offers alternatives no comparison showed'
        }[kind];
        const summary = `Attempt ${attempt}: ${outcome}. ${problems.join(' ')}`;
        failureSummaries.push(summary);
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
                ...(kind === 'edits' ? {} : { rejected: kind }),
                problems
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
          failedSource,
          assistantReply: generatedReplyText(generation.result.reply),
          diagnostics: [
            ...problems.map((message) => ({
              severity:
                kind === 'warnings' || kind === 'alternatives'
                  ? ('warning' as const)
                  : ('error' as const),
              code: {
                edits: 'edit_not_applied',
                comparisons: 'comparison_not_built',
                picture: 'picture_unreadable',
                warnings: 'picture_warning',
                alternatives: 'alternatives_not_offered'
              }[kind],
              message,
              raw: message
            }))
          ],
          priorFailureSummaries: [...failureSummaries]
        };
        return { document: current, done: false };
      };
      // The pairs a decision's comparisons ask, each built as given, and whether they were checked
      // against the design before building: a changed source's design is known only once built.
      let pairs: ShownComparison[] | undefined;
      let checked = false;
      let candidate: string | undefined;
      let variant: { base?: DesignValues; chosen?: DesignValues; randomise?: string[] | true } = {
        base: viewed
      };
      // Of comparisons some of which cannot be built as given (problems, by comparison), the others
      // are built without them, a source that builds showing alone where none can be, and the reply
      // says which were left out; the Timeline tells the next turn why. A comparison costs no repair:
      // only a vary of the shown source, with no comparison left, has nothing to show and is repaired.
      let leftOut: string | undefined;
      const droppedQuestions: string[] = [];
      const screen = async (problems: string[][]) => {
        if (!pairs || candidate === undefined || !problems.flat().length) return undefined;
        const asked = pairs;
        const kept = asked.flatMap((pair, index) => (problems[index]?.length ? [] : [index]));
        const list = (items: string[]) =>
          new Intl.ListFormat('en', { type: 'conjunction' }).format(items);
        if (!kept.length && candidate === entrySource(current))
          return reject('comparisons', problems.flat(), candidate);
        const dropped = asked.flatMap((pair, index) => (problems[index]?.length ? [pair] : []));
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
                rejected: 'comparisons',
                problems: problems.flat(),
                kept: kept.map((index) => index + 1)
              }
            })
          ],
          dependencies.projectService
        );
        pairs = kept.length ? kept.map((index) => asked[index]) : undefined;
        droppedQuestions.push(...dropped.map(({ question }) => `“${question}”`));
        leftOut = `I left out ${list(droppedQuestions)}, which could not be built as asked.`;
        return undefined;
      };
      if (counted && attempt === 1)
        return reject(
          'comparisons',
          [
            'A count is not built: design the alternatives yourself as comparisons, three or four pairs across families, each asking what it shows, and leave count null.'
          ],
          buildFeedback?.failedSource ?? entrySource(current)
        );
      switch (decision.action) {
        case 'respond':
          break;
        case 'resample':
          if (queued) {
            candidate = entrySource(current);
            variant = { base: viewed, randomise: true };
          }
          break;
        case 'revise':
          candidate = decision.source;
          variant = sourceValues(viewed, decision);
          pairs = decision.comparisons ?? undefined;
          break;
        case 'vary': {
          candidate = buildFeedback?.failedSource ?? entrySource(current);
          variant = variedValues(viewed, decision);
          pairs = decision.comparisons ?? undefined;
          if (!pairs || candidate !== entrySource(current)) break;
          const screened = await screen(
            comparisonProblems(
              pairs,
              designVariables(
                viewedPresentation(current, contextSelection.interactionEventIds ?? [])
              ),
              { tree: pictureTree(candidate), base: { ...viewed, ...variant.chosen }, settled: {} },
              briefSteering(projectBrief(current.events, brief))
            )
          );
          if (screened) return screened;
          checked = true;
          break;
        }
        case 'edit': {
          const base = buildFeedback?.failedSource ?? entrySource(current);
          const edited = applySourceEdits(base, decision.edits);
          if ('problems' in edited) return reject('edits', edited.problems, base);
          candidate = edited.source;
          variant = sourceValues(viewed, decision);
          pairs = decision.comparisons ?? undefined;
          break;
        }
        default:
          throw new Error(
            `Unhandled decision ${(decision satisfies never as { action: string }).action}.`
          );
      }
      if (pairs) pairs = shownInRandomOrder(pairs, dependencies.comparisonOrder);
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
          return {
            document: await recordReply(advanced.document, advanced.presentations),
            done: true
          };
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

      // Every attempt builds the same seeds, more of them when a decision asks for more: a decision
      // without comparisons or a count presents one version.
      const size = pairs ? pairs.length * 2 : (queued ?? 1);
      if (seeds.length < size)
        seeds = [...seeds, ...freshPresentationSeeds(size - seeds.length, seeds)];
      const batchSeeds = seeds.slice(0, size);
      const randomised = variant.randomise;
      // Comparisons build their first pair alone, so it shows before the rest are built; one whose
      // sides draw alike, or that cannot be built, gives way to the next, the source alone after the last.
      let built: Awaited<ReturnType<typeof buildCandidateBatch>>;
      // The steps at which the first pair's sides draw differently, where the server laid them out.
      let differsAt: number[] | undefined;
      for (;;) {
        const requests = pairs
          ? comparisonRequests(batchSeeds, viewed, variant.chosen ?? {}, pairs.slice(0, 1))
          : basedRequests(
              batchSeeds.slice(0, queued ?? 1),
              variant.base,
              variant.chosen,
              randomised === true
            ).map((request, index) =>
              index === 0 && Array.isArray(randomised) && randomised.length
                ? { ...request, variant: { ...request.variant, randomise: randomised } }
                : request
            );
        built = await buildCandidateBatch(
          { document: current, candidate, requests, operationId, attempt },
          dependencies
        );
        current = built.document;
        const [first] = built.recorded.builds;
        if (!pairs) break;
        const asked = pairs[0];
        if (!batchSucceeded(built.recorded) || !first?.result.ok) {
          // A value the first comparison sets that the source does not offer leaves it out; any
          // other failure is the source's.
          const unoffered = designValueProblems(built.recorded).map(
            (problem) => `Comparison 1 (“${asked.question}”): ${problem}`
          );
          const screened = unoffered.length
            ? await screen(pairs.map((_, index) => (index ? [] : unoffered)))
            : undefined;
          if (screened) return screened;
          if (pairs?.[0] === asked) break;
          continue;
        }
        const guard = {
          tree: pictureTree(candidate),
          base: { ...viewed, ...variant.chosen },
          settled: {}
        };
        // A changed source's design is known only once built; a vary's was checked before.
        const problems = checked
          ? pairs.map((): string[] => [])
          : comparisonProblems(
              pairs,
              designVariables(first.result.bundle),
              guard,
              briefSteering(projectBrief(current.events, brief))
            );
        checked = true;
        differsAt = pairDifferences(built.recorded.builds);
        if (differsAt?.length === 0) problems[0].push(drawnAlikeProblem(pairs[0], guard.base));
        const screened = await screen(problems);
        if (screened) return screened;
        if (pairs?.[0] === asked) break;
      }
      // A picture whose text would be too small to read on a typical stage, or one built with
      // warnings, goes back once a turn, with an attempt left to show less at once or to settle the
      // warnings; after that it shows as built. Readability goes first, as it stops the picture
      // being read at all.
      const returnable =
        candidate !== undefined &&
        !softReturned &&
        attempt < chatbot.config.attemptProfiles.length &&
        batchSucceeded(built.recorded);
      const bundles = returnable
        ? built.recorded.builds.flatMap(({ result }) => (result.ok ? [result.bundle] : []))
        : [];
      const unreadable = bundles
        .flatMap(({ readability }) => (readability ? [readability] : []))
        .map(unreadableProblem)
        .find((problem) => problem !== undefined);
      if (unreadable && candidate !== undefined) {
        softReturned = true;
        return reject('picture', [unreadable], candidate);
      }
      const warnings = [...new Set(bundles.flatMap(({ warnings = [] }) => warnings))];
      if (warnings.length && candidate !== undefined) {
        softReturned = true;
        return reject('warnings', warnings, candidate);
      }
      // A new or changed picture shown alone, where its source offers another form of a view, a
      // pointer or a free layout's arrangement, goes back once to offer a comparison; one the
      // participant directs is made as asked.
      const alternatives =
        !pairs &&
        !droppedQuestions.length &&
        (decision.action === 'revise' || decision.action === 'edit') &&
        bundles[0]
          ? unofferedAlternatives(bundles[0])
          : undefined;
      if (
        alternatives &&
        candidate !== undefined &&
        !directed(projectBrief(current.events, brief))
      ) {
        softReturned = true;
        return reject('alternatives', [alternatives], candidate);
      }
      if (batchSucceeded(built.recorded)) {
        // The assistant is the one author of a new or edited source: its first build stands, the
        // further variants a vary or resample with a count queues drawn at random in it.
        const shown = { document: current, recorded: built.recorded };
        current = shown.document;
        assertCurrentProjectOperationActive();
        const acceptedAfter = projectHead(current).id;
        current = await acceptSverlinCandidate(
          {
            document: current,
            recorded: shown.recorded,
            generationEvent: generation.generationEvent,
            candidate,
            ...('summary' in decision ? { summary: decision.summary } : {}),
            operationId,
            ...(pairs
              ? { setSize: 2 as const, pairs: [pairQuestion(pairs[0], differsAt)] }
              : queued
                ? { setSize: presentationCount }
                : {})
          },
          dependencies
        );
        // The reply names the first pair's sides in the assistant's order, whichever shows on top.
        const presented = firstPresentedSet(current, acceptedAfter);
        current = await recordReply(
          current,
          pairs?.[0]?.swapped ? [presented[1], presented[0], ...presented.slice(2)] : presented,
          leftOut,
          pairs !== undefined
        );
        if (pairs)
          current = await presentRemainingComparisons(
            {
              document: current,
              candidate,
              pairs,
              seeds: batchSeeds,
              viewed,
              values: variant.chosen ?? {},
              operationId,
              attempt,
              actor: generation.generationEvent.actor
            },
            dependencies
          );
        return { document: current, done: true };
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
      return {
        document: current,
        done: false,
        failure: { source: candidate, diagnostics: failed.result.diagnostics }
      };
    }
  );
  // After a first version, the helpers propose views of its main type; else of the type asked.
  if (!turnViewHelpers(done)) return done;
  const source = entrySource(done);
  const starter = modeCatalog[projectSnapshotAt(done).mode].starter.source;
  const firstVersion = startedFrom === starter && source !== starter;
  const firstType = firstVersion ? mainViewType(source) : undefined;
  const request = helperRequest ?? (firstType ? { type: firstType } : undefined);
  return request && source !== starter
    ? runViewHelpers(done, operationId, source, request, dependencies)
    : done;
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
      if (!generation.ok) {
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
    turn: ChatTurn;
    presentationCount: 1 | 2;
    buildFeedback?: BuildFeedback;
  },
  dependencies: ProjectCommandDependencies
) {
  let prompt;
  try {
    prompt = await options.chatbot.preparePrompt({
      messages: projectConversationMessages(options.document.events),
      project: withViewHelpers(
        projectAiContext(options.document, options.contextSelection),
        options.document
      ),
      attempt: options.attempt,
      turn: options.turn,
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
      attemptsLeft: options.attempt < options.chatbot.config.attemptProfiles.length,
      generate: () =>
        options.chatbot.generatePrepared(prompt, { signal: currentProjectOperationSignal() }),
      validateResult: (result) => {
        validateRecoveryExplanation(prompt, result.recovery, result.providerResponse);
        // Only the fallback explains a simplification; one any other attempt gives is not shown.
        if (prompt.attempt.purpose !== 'fallback') result.recovery = undefined;
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
        validateGeneratedReply(
          result.reply,
          shownSlots(result.decision, options.presentationCount),
          result.providerResponse
        );
        if (
          (result.decision.action === 'respond' || result.decision.action === 'resample') &&
          blankReply(result.reply)
        )
          throw new InvalidChatbotResponseError('The reply was blank.', result.providerResponse);
      },
      fallbackResponse: (result) => ({
        reply: result.reply,
        decision: result.decision,
        brief: result.brief ?? null,
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
    ),
    retried: false,
    message: failed.payload.message
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
    /** Whether the ladder has another attempt, which a response that cannot be used goes on to. */
    attemptsLeft?: boolean;
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
 * Two builds per comparison, both from the viewed variant with the vary's values, each side with
 * the values it sets and nothing else drawn, so the pair differs only as the comparison asks.
 */
function comparisonRequests(
  seeds: readonly number[],
  viewed: DesignValues | undefined,
  values: DesignValues,
  pairs: Comparisons
): BuildRequest[] {
  return pairs.flatMap(({ left, right }, index) =>
    [left, right].map((side, slot) => ({
      seed: seeds[index * 2 + slot],
      variant: {
        ...(viewed ? { base: viewed } : {}),
        chosen: { ...values, ...designValues(side.values) }
      }
    }))
  );
}

/** A comparison as shown: its sides the other way round where swapped. */
type ShownComparison = Comparisons[number] & { swapped?: true };

/**
 * The comparisons with each pair's order drawn at random, so which side shows on top says nothing
 * of the assistant's order and a preference is not confounded with position.
 */
export function shownInRandomOrder(
  comparisons: Comparisons,
  random: () => number = Math.random
): ShownComparison[] {
  return comparisons.map((comparison) =>
    random() < 0.5
      ? comparison
      : {
          ...comparison,
          left: comparison.right,
          right: comparison.left,
          ...(comparison.brief
            ? {
                brief: {
                  ...comparison.brief,
                  left: comparison.brief.right,
                  right: comparison.brief.left
                }
              }
            : {}),
          swapped: true as const
        }
  );
}

/**
 * What a built picture's source offers that a comparison could show, as one message, or undefined:
 * a type drawn by one of several views, a pointer drawn by one of several pointer views, and a free
 * layout's arrangement.
 */
export function unofferedAlternatives(bundle: {
  views?: Record<string, string[]>;
  pointers?: Record<string, string[]>;
  variant?: Record<string, unknown>;
}): string | undefined {
  const forms = [
    ...Object.entries(bundle.views ?? {})
      .filter(([, views]) => views.length > 1)
      .map(([type, views]) => `${type} as ${views.join(' or ')} (views.${type})`),
    ...Object.entries(bundle.pointers ?? {})
      .filter(([, views]) => views.length > 1)
      .map(([type, views]) => `the ${type} pointer as ${views.join(' or ')} (pointers.${type})`),
    ...Object.keys(bundle.variant ?? {})
      .filter((key) => key.endsWith('.layoutSeed'))
      .map((key) => key.slice(0, -'.layoutSeed'.length))
      .map((kind) => `the arrangement of ${kind} (${kind}.direction, ${kind}.layoutSeed)`)
  ];
  return forms.length
    ? `This version is shown alone, but its source offers other forms: ${forms.join('; ')}. Offer a comparison of the one most worth choosing, or send the source again if one form is clearly right.`
    : undefined;
}

/** Whether the participant directs: they would rather say what they want than choose. */
function directed(brief: readonly BriefItem[]): boolean {
  const lead = brief.find(({ key }) => key === 'lead');
  return (
    lead?.status !== undefined &&
    lead.status !== 'unknown' &&
    Boolean(lead.tags?.includes('direct'))
  );
}

function pairQuestion(
  { question, left, right, brief, swapped }: ShownComparison,
  differsAt?: readonly number[]
): PairQuestion {
  return {
    question,
    labels: [left.label, right.label],
    ...(brief ? { brief: { key: brief.attribute, tags: [brief.left, brief.right] } } : {}),
    ...(differsAt ? { differsAt } : {}),
    ...(swapped ? { swapped } : {})
  };
}

/**
 * The steps, by the left side's, at which a pair's two builds draw differently, from what the server
 * laid out (see ModeBuildResult's drawn), matched by where each falls among the source's steps.
 * Sides pausing differently compare at the steps both show; where those all draw alike, the sides
 * still differ at the steps one alone shows, so that is left unknown rather than told as alike.
 * Unknown too where either was not laid out, or they are of two sources.
 */
function pairDifferences(builds: readonly RecordedBuild[]): number[] | undefined {
  const [left, right] = builds.map(({ result }) => (result.ok ? result.bundle : undefined));
  if (!left?.steps || !right?.drawn || left.stepSignature !== right.stepSignature) return undefined;
  if (JSON.stringify(left.labels) === JSON.stringify(right.labels))
    return differingSteps(left.drawn, right.drawn);
  const [leftPlaces, rightPlaces] = [left, right].map(({ labels }) =>
    stepPlaces(left.steps ?? [], labels)
  );
  if (!left.drawn || !leftPlaces || !rightPlaces) return undefined;
  const rightDrawn = new Map(rightPlaces.map((place, step) => [place, right.drawn?.[step]]));
  const differs = leftPlaces.flatMap((place, step) =>
    rightDrawn.has(place) && rightDrawn.get(place) !== left.drawn?.[step] ? [step] : []
  );
  return differs.length ? differs : undefined;
}

/** Why a comparison whose two sides draw the same picture at every step cannot be asked. */
function drawnAlikeProblem(
  { question, left, right }: Comparisons[number],
  base: DesignValues
): string {
  const sides = [designValues(left.values), designValues(right.values)];
  const changed = Object.keys({ ...sides[0], ...sides[1] }).filter(
    (variable) => (sides[0][variable] ?? base[variable]) !== (sides[1][variable] ?? base[variable])
  );
  const named = new Intl.ListFormat('en', { type: 'conjunction' }).format(changed);
  return `Comparison 1 (“${question}”): its two sides draw the same at every step: ${named} ${changed.length > 1 ? 'change' : 'changes'} nothing visible here. Compare a choice that shows, or leave it out.`;
}

/** Why a comparison cannot ask the brief attribute it names by showing, if it cannot. */
function comparisonBriefProblem({ brief }: Comparisons[number]): string | undefined {
  if (!brief) return undefined;
  const tags = Object.keys(briefAttribute(brief.attribute).tags ?? {});
  const unnamed = [brief.left, brief.right].filter((tag) => !tags.includes(tag));
  if (unnamed.length)
    return `${brief.attribute} has no tag ${unnamed.map((tag) => JSON.stringify(tag)).join(' or ')}; its tags are ${tags.join(', ')}.`;
  if (brief.left === brief.right) return `its two sides stand for the same ${brief.attribute}.`;
  return undefined;
}

function designValues(values: readonly { variable: string; value: string | number | boolean }[]) {
  return Object.fromEntries(values.map(({ variable, value }) => [variable, value])) as DesignValues;
}

/**
 * What keeps each of a decision's comparisons from being built as given: a value its variable does
 * not offer, two sides alike, a side hiding the layout itself or most of the picture, a choice the
 * brief keeps out of comparisons (a colour where it must print in grey), or a brief attribute asked
 * by showing with tags it does not name.
 */
function comparisonProblems(
  pairs: Comparisons,
  design: AiDesign,
  guard: GuardContext,
  brief: BriefSteering
): string[][] {
  return pairs.map((pair, index) => {
    const { question, left, right } = pair;
    const name = `Comparison ${index + 1} (“${question}”)`;
    const problems = [...left.values, ...right.values].flatMap(({ variable, value }) =>
      offeredOptions(design, variable)?.includes(value)
        ? []
        : [`${name}: ${variable} has no option ${JSON.stringify(value)} in project.design.`]
    );
    const asked = comparisonBriefProblem(pair);
    if (asked) problems.push(`${name}: ${asked}`);
    const sides = [designValues(left.values), designValues(right.values)];
    for (const variable of Object.keys({ ...sides[0], ...sides[1] })) {
      const excluded = brief.excluded(variable);
      if (excluded)
        problems.push(`${name}: ${variable} is kept out of comparisons by the brief: ${excluded}.`);
    }
    const differ = Object.keys({ ...sides[0], ...sides[1] }).some(
      (variable) =>
        (sides[0][variable] ?? guard.base[variable]) !==
        (sides[1][variable] ?? guard.base[variable])
    );
    if (!differ) problems.push(`${name}: its two sides set the same values.`);
    if (sides.some((side) => !allowedComparisonSide(guard, side)))
      problems.push(`${name}: a side hides the layout itself or most of the picture.`);
    return problems;
  });
}

/** The problems of a failed batch's builds, when every one is a value the design does not offer. */
function designValueProblems(recorded: RecordedBuildBatch): string[] {
  const diagnostics = recorded.builds.flatMap((build) =>
    build.result.ok ? [] : build.result.diagnostics
  );
  return diagnostics.length && diagnostics.every(({ code }) => code === 'design_value')
    ? [...new Set(diagnostics.map(({ message }) => message))]
    : [];
}

/**
 * Build the comparisons after the first, one pair at a time, each queued behind those before as
 * soon as it is built, so the participant answers the first while the rest build. A pair an answer
 * given meanwhile has made moot is not built, and one that fails to build is left out.
 */
async function presentRemainingComparisons(
  options: {
    document: ProjectDocument;
    candidate: string;
    pairs: ShownComparison[];
    seeds: readonly number[];
    viewed: DesignValues | undefined;
    /** The values every side takes, a vary's. */
    values: DesignValues;
    operationId: string;
    attempt: number;
    actor: NewProjectEvent<'visualization.presented'>['actor'];
  },
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  let document = options.document;
  // Preferences after the first pair was shown answer this batch's questions.
  const shownAt =
    document.events.findLast(
      (event) =>
        event.type === 'visualization.presented' && event.operationId === options.operationId
    )?.id ?? projectHead(document).id;
  for (const [index, pair] of options.pairs.entries()) {
    if (index === 0) continue;
    assertCurrentProjectOperationActive();
    const asked = askedPair(designValues(pair.left.values), designValues(pair.right.values));
    if (answersAfter(document.events, shownAt).some((answer) => mootComparison(answer, asked)))
      continue;
    const built = await buildCandidateBatch(
      {
        document,
        candidate: options.candidate,
        requests: comparisonRequests(
          options.seeds.slice(index * 2, index * 2 + 2),
          options.viewed,
          options.values,
          [pair]
        ),
        operationId: options.operationId,
        attempt: options.attempt
      },
      dependencies
    );
    document = built.document;
    if (!batchSucceeded(built.recorded)) continue;
    // A pair whose sides draw alike at every step is left out, as one that fails to build.
    const differsAt = pairDifferences(built.recorded.builds);
    if (differsAt?.length === 0) continue;
    document = await activateBuiltPresentations(
      built.recorded,
      dependencies.projectService,
      options.actor,
      pairQuestion(pair, differsAt)
    );
  }
  return document;
}

/**
 * Set aside the waiting comparisons these answers make moot (mootComparison), of any source, as
 * those asked before an answer went back to an earlier one, and say whether any of the current
 * source are still to answer: the assistant waits for the last of its questions to be answered
 * before it takes a turn on them.
 */
async function dropMootComparisons(
  document: ProjectDocument,
  answers: readonly Answer[],
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<{ document: ProjectDocument; waiting: boolean }> {
  const moot = waitingComparisons(document, { everySource: true }).filter(
    ({ variants: [left = {}, right = {}] }) =>
      answers.some((answer) => mootComparison(answer, askedPair(left, right)))
  );
  const mootSets = new Set(moot.map(({ displaySetId }) => displaySetId));
  const waiting = waitingComparisons(document).filter(
    ({ displaySetId }) => !mootSets.has(displaySetId)
  );
  if (moot.length)
    document = await appendProjectEvents(
      document,
      moot.map(({ presentationIds }) =>
        draftEvent({
          type: 'visualization.candidates-advanced',
          actor: { kind: 'system' },
          operationId,
          payload: { presentations: presentationIds, reason: 'moot' }
        })
      ),
      dependencies.projectService
    );
  return { document, waiting: waiting.length > 0 };
}

/**
 * The version an answer went back to (basedOnAnswer: the source of the side it preferred, which a
 * later version had replaced), while it is still the current version and nothing has shown since.
 */
function unshownRebase(
  document: ProjectDocument,
  answers: readonly ProjectEventOf<'visualization.preference-recorded'>[]
): ProjectEventOf<'artifact.version-created'> | undefined {
  const operations = new Set(answers.map(({ operationId }) => operationId));
  const rebase = document.events.findLast(
    (event): event is ProjectEventOf<'artifact.version-created'> =>
      event.type === 'artifact.version-created' &&
      event.payload.origin.kind === 'candidate' &&
      operations.has(event.operationId)
  );
  if (!rebase) return undefined;
  const since = document.events.slice(rebase.id);
  return since.some(
    ({ type }) => type === 'artifact.version-created' || type === 'visualization.presented'
  )
    ? undefined
    : rebase;
}

/**
 * Show the source an answer went back to, in place of what showed of the source it left: that
 * source's next waiting comparison, built again so it shows as the newest, or else the side the
 * answer preferred. Left as it was when a build fails.
 */
async function presentAfterRebase(
  document: ProjectDocument,
  rebase: ProjectEventOf<'artifact.version-created'>,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  if (rebase.payload.origin.kind !== 'candidate') return document;
  const [next] = waitingComparisons(document);
  const shown = (next?.presentationIds ?? [rebase.payload.origin.presentationId]).map((id) =>
    document.events.findLast(
      (event): event is ProjectEventOf<'visualization.presented'> =>
        event.type === 'visualization.presented' && event.payload.presentation.presentationId === id
    )
  );
  const snapshot = projectSnapshotAt(document);
  const entry = snapshot.artifacts[snapshot.entryArtifactId];
  const requests = shown.flatMap((event): BuildRequest[] => {
    const presentation = event?.payload.presentation;
    if (presentation?.format !== 'browser-bundle-v1') return [];
    const values = presentationVariant(presentation);
    return [
      {
        seed: presentation.seed,
        ...(Object.keys(values).length ? { variant: { base: values } } : {})
      }
    ];
  });
  if (!entry || requests.length !== shown.length) return document;
  const recorded = await buildProjectSourceBatch(
    {
      document,
      sourceContent: entry.content.text,
      source: entry.content,
      sourceLabel: entry.path,
      requests,
      purpose: 'restore',
      input: 'committed-artifact',
      operationId
    },
    dependencies.projectService
  );
  if (!batchSucceeded(recorded)) return recorded.document;
  let current = recorded.document;
  const [left, right] = shown.map((event) => event?.payload);
  const pair: PairQuestion | undefined =
    next && left?.question && right
      ? {
          question: left.question,
          labels: [left.label ?? '', right.label ?? ''],
          ...(left.brief && right.brief
            ? { brief: { key: left.brief.key, tags: [left.brief.tag, right.brief.tag] } }
            : {}),
          ...(left.differsAt ? { differsAt: left.differsAt } : {}),
          ...(left.swapped ? { swapped: left.swapped } : {})
        }
      : undefined;
  if (next)
    current = await appendProjectEvents(
      current,
      [
        draftEvent({
          type: 'visualization.candidates-advanced',
          actor: { kind: 'system' },
          operationId,
          payload: { presentations: next.presentationIds, reason: 'agent-request' }
        })
      ],
      dependencies.projectService
    );
  return activateBuiltPresentations(
    { document: current, builds: recorded.builds },
    dependencies.projectService,
    { kind: 'system' },
    pair
  );
}

/** The assistant's context, with the view helpers' where the turn runs them. */
function withViewHelpers(project: AiProjectContext, document: ProjectDocument): AiProjectContext {
  if (!turnViewHelpers(document)) return project;
  const snapshot = projectSnapshotAt(document);
  const sha256 = snapshot.artifacts[snapshot.entryArtifactId]?.content.sha256 ?? '';
  return { ...project, viewHelpers: viewHelpersContext(document, sha256) };
}

/** The view helpers' model and effort (see attempt-profiles.ts for why they cost no waiting). */
const viewHelperParameters = {
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
  maxOutputTokens: 8000
} as const;

/**
 * Ask the view helpers for alternative views of one type of a source, once the turn's reply has
 * shown: their calls run at once, each time-boxed, then each proposal is built and checked, and
 * those that build and read are recorded for the assistant's next turn. A helper that fails, is
 * late, or proposes nothing usable costs the turn nothing; none starts with too little time left.
 */
async function runViewHelpers(
  document: ProjectDocument,
  operationId: string,
  source: string,
  { type, task }: ViewHelpersRequest,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  const deadline = currentProjectOperationDeadline();
  if (deadline !== undefined && deadline - Date.now() < viewHelperTimeoutMs) return document;
  const adapter = dependencies.viewHelperAdapter ?? openAIAdapter;
  const operation = currentProjectOperationSignal();
  const background = viewHelperBackground(document);
  const prompts: ChatbotPrompt[] = viewHelperDirections
    .slice(0, viewHelperCalls)
    .map((direction, index) => ({
      initialPrompt: viewHelperPrompt,
      messages: [
        {
          role: 'user',
          content: viewHelperTask({ type, count: 1, source, direction, task, background })
        }
      ],
      context: {},
      attempt: { number: index + 1, purpose: 'helper' },
      parameters: { ...viewHelperParameters },
      responseFormat: proposedViewsFormat as unknown as ChatbotPrompt['responseFormat']
    }));
  const replies = await Promise.all(
    prompts.map(async (prompt) => {
      const startedAt = performance.now();
      const timeout = AbortSignal.timeout(viewHelperTimeoutMs);
      const signal = operation ? AbortSignal.any([operation, timeout]) : timeout;
      try {
        const result = await adapter.generateReply({ ...prompt, signal });
        const views = (
          (result.output as { views?: ProposedView[] } | undefined)?.views ?? []
        ).filter(
          (view) =>
            typeof view?.name === 'string' &&
            typeof view.description === 'string' &&
            typeof view.markup === 'string'
        );
        return {
          prompt,
          ok: true as const,
          result,
          views,
          durationMs: performance.now() - startedAt
        };
      } catch (error) {
        return { prompt, ok: false as const, error, durationMs: performance.now() - startedAt };
      }
    })
  );
  let current = document;
  const generationEventIds: EventId[] = [];
  for (const reply of replies) {
    current = await appendProjectEvents(
      current,
      [
        draftEvent<'ai.generation-requested'>({
          type: 'ai.generation-requested',
          actor: { kind: 'system' },
          operationId,
          payload: {
            attempt: reply.prompt.attempt.number,
            purpose: 'helper',
            prompt: recordText(JSON.stringify(reply.prompt), 'application/json'),
            promptTemplateSha256: sourceSha256(reply.prompt.initialPrompt),
            requestedModel: reply.prompt.parameters.model,
            parameters: { ...reply.prompt.parameters }
          }
        }),
        reply.ok
          ? draftEvent<'ai.generation-succeeded'>({
              type: 'ai.generation-succeeded',
              actor: { kind: 'assistant', botId: 'sverlin-view-helper' },
              operationId,
              payload: {
                attempt: reply.prompt.attempt.number,
                adapterId: adapter.id,
                requestedModel: reply.prompt.parameters.model,
                ...(reply.result.generation?.model ? { model: reply.result.generation.model } : {}),
                ...(reply.result.generation?.responseId
                  ? { responseId: reply.result.generation.responseId }
                  : {}),
                durationMs: Math.round(reply.durationMs),
                ...(reply.result.generation?.usage ? { usage: reply.result.generation.usage } : {}),
                response: recordText(
                  JSON.stringify(reply.result.providerResponse ?? { views: reply.views }),
                  'application/json'
                )
              }
            })
          : draftEvent<'ai.generation-failed'>({
              type: 'ai.generation-failed',
              actor: { kind: 'system' },
              operationId,
              payload: {
                attempt: reply.prompt.attempt.number,
                failureKind: generationFailureKind(reply.error),
                durationMs: Math.round(reply.durationMs),
                message: safeErrorMessage(reply.error),
                details: recordText(
                  generationErrorDetails(reply.error).value,
                  generationErrorDetails(reply.error).mediaType
                )
              }
            })
      ],
      dependencies.projectService
    );
    generationEventIds.push(projectHead(current).id);
  }
  const proposed = replies.flatMap((reply) => (reply.ok ? reply.views : []));
  if (!proposed.length) return current;
  const checked = [];
  for (const view of proposed) checked.push(await checkCandidate(source, type, view));
  return appendProjectEvents(
    current,
    [
      draftEvent<'visualization.view-candidates'>({
        type: 'visualization.view-candidates',
        actor: { kind: 'system' },
        operationId,
        payload: {
          sourceSha256: sourceSha256(source),
          type,
          ...(task ? { task } : {}),
          generationEventIds,
          candidates: checked.flatMap((candidate) =>
            candidate.kept
              ? [
                  {
                    name: candidate.name,
                    description: candidate.description,
                    markup: candidate.markup,
                    ...(candidate.readability ? { readability: candidate.readability } : {})
                  }
                ]
              : []
          ),
          dropped: checked.flatMap((candidate) =>
            candidate.kept ? [] : [{ name: candidate.name, reason: candidate.reason }]
          )
        }
      })
    ],
    dependencies.projectService
  );
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
    /** Presentations shown at once, when the batch is queued (queueBuiltPresentations). */
    setSize?: 1 | 2;
    /** What each queued set asks, for a vary's comparisons. */
    pairs?: readonly PairQuestion[];
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
  const document = await appendProjectEvents(
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
  return options.setSize
    ? queueBuiltPresentations(
        { ...options.recorded, document },
        options.setSize,
        dependencies.projectService,
        options.generationEvent.actor,
        options.pairs
      )
    : activateBuiltPresentations(
        { ...options.recorded, document },
        dependencies.projectService,
        options.generationEvent.actor
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
      throw new Error('Only source-authored projects can generate buffered candidates.');
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

/** The first display set presented after an event, by slot: what a reply's candidate-refs name. */
function firstPresentedSet(document: ProjectDocument, after: EventId): RenderablePresentation[] {
  const presented = document.events.flatMap((event) =>
    event.id > after && event.type === 'visualization.presented' ? [event.payload] : []
  );
  return presented
    .filter(({ displaySetId }) => displaySetId === presented[0]?.displaySetId)
    .toSorted((left, right) => left.slot - right.slot)
    .map(({ presentation }) => presentation);
}

/**
 * CSS rules at the start of a reply's text, as `.panel{display:none}`, which a model sometimes
 * leaks from the code it wrote: never meant for the participant.
 */
// One rule at a time: its selector before the brace, bounded and without nested repetition, so a
// sentence never makes the match backtrack.
const styleRule = /^\s*([^{}\n]{1,200})\{([^{}]*)\}/u;
const selector = /^[.#]?[a-z][\w-]*(?:\s*[,>+~ ]\s*[.#]?[a-z][\w-]*)*\s*$/iu;

function withoutLeadingStyleRules(text: string): string {
  let rest = text;
  for (let rule = styleRule.exec(rest); rule; rule = styleRule.exec(rest)) {
    if (!selector.test(rule[1]) || !rule[2].includes(':')) break;
    rest = rest.slice(rule[0].length);
  }
  return rest === text ? text : rest.trimStart();
}

/** A reply with any CSS leaked at the start of its text segments taken out. */
export function withoutLeakedStyles(reply: GeneratedMessageContent): GeneratedMessageContent {
  return reply.flatMap((segment): GeneratedMessageContent => {
    if (segment.type !== 'markdown') return [segment];
    const text = withoutLeadingStyleRules(segment.text);
    return text === segment.text ? [segment] : text.trim() ? [{ ...segment, text }] : [];
  });
}

function resolveAssistantContent(
  document: ProjectDocument,
  reply: GeneratedMessageContent,
  candidates: readonly RenderablePresentation[]
): MessageContent {
  const shown = withoutLeakedStyles(reply);
  const knownPresentationIds = document.events.flatMap((event) =>
    event.type === 'visualization.presented' ? [event.payload.presentation.presentationId] : []
  );
  const { mode } = projectSnapshotAt(document);
  const content: MessageContent = structureKnownPresentationReferences(
    shown,
    knownPresentationIds
  ).map((segment) => {
    if (segment.type === 'presentation-ref') {
      const presentationId = repairedPresentationId(segment.presentationId, knownPresentationIds);
      return presentationId
        ? { type: 'presentation-ref', presentationId }
        : { type: 'markdown', text: 'that presentation' };
    }
    if (segment.type === 'interface-ref') return interfaceReferenceFor(segment.part, mode);
    if (segment.type !== 'candidate-ref') return segment;
    const presentation = candidates[segment.slot];
    // A version a count queues behind the first, as the second of a pair a single view shows one
    // at a time, is named in words rather than failing the turn.
    if (!presentation) return { type: 'markdown', text: 'the next version' };
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

/**
 * How many presentations a decision shows first, which its reply's candidate-refs can name: none
 * for a reply alone, a comparison's pair, a set of those a count or resample makes, or one version.
 */
function shownSlots(decision: SourceDecision, presentationCount: 1 | 2): number {
  if (decision.action === 'respond') return 0;
  if ('comparisons' in decision && decision.comparisons?.length) return 2;
  // A count is ignored (see runSverlinTurn), but a reply naming its first pair is read as words.
  if ('count' in decision && decision.count) return 2;
  if (decision.action === 'resample') return presentationCount;
  return 1;
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
}

function generatedReplyText(reply: GeneratedMessageContent): string {
  return reply
    .map((segment) => {
      if (segment.type === 'markdown') return segment.text;
      if (segment.type === 'presentation-ref') return `[Presentation ${segment.presentationId}]`;
      if (segment.type === 'interface-ref') return `[Interface part ${segment.part}]`;
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

/** The question a message sent now answers, if one is open (see openQuestion). */
function answering(document: ProjectDocument): { answers?: EventId } {
  const open = openQuestion(document.events);
  return open ? { answers: open.eventId } : {};
}

/**
 * A decision's question as recorded with the reply: about the first presentation the decision
 * makes, where it names "new" and makes one; about a presentation shown before, where it names one;
 * otherwise in words. Elements count only with a presentation, and only well-formed ids.
 */
function recordedQuestion(
  document: ProjectDocument,
  question: DecisionQuestion | null | undefined,
  /** What the decision presented, the first of which a question about "new" is about. */
  presented: readonly RenderablePresentation[]
): AssistantQuestion | undefined {
  if (!question) return undefined;
  const presentationId =
    question.presentation === 'new'
      ? presented[0]?.presentationId
      : question.presentation !== null &&
          document.events.some(
            (event) =>
              event.type === 'visualization.presented' &&
              event.payload.presentation.presentationId === question.presentation
          )
        ? question.presentation
        : undefined;
  const elements = (question.elements ?? []).filter((id) => v.is(elementIdSchema, id));
  return {
    text: question.text,
    ...(presentationId ? { presentationId } : {}),
    ...(presentationId && elements.length ? { elements } : {})
  };
}

type AssistantQuestion = NonNullable<NewProjectEvent<'assistant.responded'>['payload']['question']>;

function appendAssistantResponse(
  document: ProjectDocument,
  content: string | MessageContent,
  botId: string,
  operationId: string,
  dependencies: ProjectCommandDependencies,
  inReplyTo: readonly EventId[] = [],
  {
    intakeStep,
    question,
    heldQuestion,
    releases,
    brief
  }: {
    intakeStep?: ParticipantIntakeStepId;
    question?: AssistantQuestion;
    heldQuestion?: AssistantQuestion;
    releases?: EventId;
    brief?: BriefEntry[];
  } = {}
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
          ...(intakeStep ? { intakeStep } : {}),
          ...(question ? { question } : {}),
          ...(heldQuestion ? { heldQuestion } : {}),
          ...(releases ? { releases } : {}),
          ...(brief?.length ? { brief } : {})
        }
      })
    ],
    dependencies.projectService
  );
}

/** What a question the application asks ends with, so the participant never has to answer it. */
const openAlternative = 'Or tell me what you’d like to change, or ask me for suggestions.';

/**
 * Ask the question held back with comparisons (heldQuestion) in a reply of its own, with no model
 * call: once the last of them is answered, or when the participant writes first. It ends with the
 * open alternative, unless it offers one already or would grow too long.
 */
function releaseHeldQuestion(
  document: ProjectDocument,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  const held = heldQuestion(document.events);
  const question = held?.payload.heldQuestion;
  if (!held || !question || held.actor.kind !== 'assistant') return Promise.resolve(document);
  const open = /\bor (?:tell|ask)\b|\bsuggest/iu.test(question.text);
  const opened = `${question.text} ${openAlternative}`;
  const text = open || opened.length > 200 ? question.text : opened;
  return appendAssistantResponse(document, text, held.actor.botId, operationId, dependencies, [], {
    question: { ...question, text },
    releases: held.id
  });
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
    `This visualization needed another attempt, but there was not enough time left in the study phase to complete it safely${keptVersion(document)}.`,
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
    `I could not build the requested visualization after several repairs and a simpler fallback${keptVersion(document)}.${finalDifficulty ? ` The remaining difficulty was: ${plainFailureSummary(finalDifficulty)}` : ''}`,
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
    `I could not make the requested visualization pass the safety checks after several repairs and a simpler fallback${keptVersion(document)}. The remaining difficulty was: ${plainFailureSummary(finalDifficulty)}`,
    operationId,
    dependencies
  );
}

function appendWanderingRepairFailure(
  document: ProjectDocument,
  operationId: string,
  dependencies: ProjectCommandDependencies
) {
  return appendSystemFailure(
    document,
    `I could not build the requested change: each repair ran into a new problem instead of fixing the last, so I stopped${keptVersion(document, ' and')}. A smaller change, or one part at a time, may work better.`,
    operationId,
    dependencies
  );
}

/** A failed build an attempt reports to the ladder: its problems and the source that had them. */
type AttemptFailure = { source: string; diagnostics: readonly Problem[] };
type Problem = { code?: string; message: string };

/**
 * The stage of the build that finds a problem, by its code, in the order a build checks: the source
 * as written (its blocks, labels, and views), then running the algorithm on each case, then the
 * listing, then laying out the steps. A later stage runs only once the earlier ones pass, so its
 * problems were hidden until then. Codes from outside the build have none.
 */
const buildStages: Record<string, number> = {
  js_parse_error: 0,
  import: 0,
  missing_algorithm: 0,
  sverlin_block: 0,
  algorithm_written: 0,
  name_clash: 0,
  reserved_prop: 0,
  unknown_prop: 0,
  invalid_prop: 0,
  design_value: 0,
  view_case: 1,
  algorithm_error: 1,
  listing_label: 2,
  link_placement: 3,
  layout_failed: 3,
  draw_failed: 3,
  too_large: 3,
  too_many_steps: 3
};
const buildStage = (code: string | undefined): number | undefined =>
  code === undefined
    ? undefined
    : (buildStages[code] ?? (code.startsWith('view_') ? 0 : undefined));

/**
 * Whether a failed repair wandered from the attempt it repaired rather than converging: none of
 * that attempt's problems recur, and new ones appear from the same stage of the build or an earlier
 * one. A repair that still has a problem it was asked to fix is stuck on it, which a higher effort
 * may solve, and is not wandering; nor is one whose new problems all come from a later stage than
 * every problem it fixed, which only passing those let the build find.
 */
export function repairWandered(previous: AttemptFailure, repair: AttemptFailure): boolean {
  const key = ({ code, message }: Problem) => `${code ?? ''}\n${stableMessage(message)}`;
  const before = new Set(previous.diagnostics.map(key));
  if (!repair.diagnostics.length || repair.diagnostics.some((d) => before.has(key(d))))
    return false;
  const fixed = previous.diagnostics.map(({ code }) => buildStage(code));
  const found = repair.diagnostics.map(({ code }) => buildStage(code));
  const reached = fixed.every((stage) => stage !== undefined)
    ? Math.max(...(fixed as number[]))
    : undefined;
  return !(reached !== undefined && found.every((stage) => stage !== undefined && stage > reached));
}

/**
 * A problem's message without the list of what exists that some end with ("…; its kinds of node
 * are A, B."), which changes whenever the source does, so the same problem is recognised again.
 */
function stableMessage(message: string): string {
  return message.replace(/;\s+its\b[^;]*?\bare\b[\s\S]*$/, '');
}

/** Whether the project has a version of its own, rather than its mode's starter. */
function hasWorkingVersion(document: ProjectDocument): boolean {
  return entrySource(document) !== modeCatalog[projectSnapshotAt(document).mode].starter.source;
}

/** Says the last working version was kept, only when there is one. */
function keptVersion(document: ProjectDocument, joiner = ', so I'): string {
  return hasWorkingVersion(document) ? `${joiner} kept the last working visualization` : '';
}

/** The share of a source's lines, trimmed, that the one it was made from does not have. */
function sourceRewritten(previous: string, source: string): number {
  const remaining = new Map<string, number>();
  for (const line of previous.split('\n'))
    remaining.set(line.trim(), (remaining.get(line.trim()) ?? 0) + 1);
  const lines = source.split('\n');
  const fresh = lines.filter((line) => {
    const left = remaining.get(line.trim()) ?? 0;
    if (left) remaining.set(line.trim(), left - 1);
    return !left;
  });
  return fresh.length / lines.length;
}

/**
 * Runs attempts until one is done. A ladder whose repairs wander (see repairWandered) is doomed:
 * each fixes what it was told, but the source, too broken to repair one problem at a time, shows
 * a new one, and each higher effort takes longer (a linear search on 2026-11-01 failed four builds
 * so, each with a different problem, the fourth after 97 s). The ladder stops escalating, keeping
 * the current version and saying why, once two repairs have wandered, or one that also rewrote
 * most of the source (more than half its lines new), starting over rather than repairing. One
 * wander is allowed, as fixing a problem often reveals the next, and new problems from a later
 * stage of the build are progress, not wandering (see repairWandered); a repair stuck on the same
 * problem keeps the higher efforts and the fallback. A project with no version of its own yet has
 * nothing to keep, so a doomed ladder there skips to the simpler fallback instead of stopping.
 */
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
  ) => Promise<{ document: ProjectDocument; done: boolean; failure?: AttemptFailure }>
): Promise<ProjectDocument> {
  let previous: AttemptFailure | undefined;
  let wandered = 0;
  for (let attempt = 1; attempt <= chatbot.config.attemptProfiles.length; attempt += 1) {
    if (attempt > 1 && !hasTimeForAnotherAttempt(chatbot)) {
      return appendAttemptDeadlineFailure(document, operationId, dependencies);
    }
    const result = await runAttempt(document, attempt);
    document = result.document;
    if (result.done) return document;
    if (previous && result.failure && repairWandered(previous, result.failure)) {
      wandered += 1;
      if (wandered >= 2 || sourceRewritten(previous.source, result.failure.source) > 0.5) {
        const fallback = chatbot.config.attemptProfiles.length;
        if (hasWorkingVersion(document) || attempt >= fallback)
          return appendWanderingRepairFailure(document, operationId, dependencies);
        attempt = fallback - 1;
      }
    }
    previous = result.failure;
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
  const text = cutText(value.replace(/\s+/g, ' ').trim(), 500);
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

/** A comment written with an answer, checked as a message is; none where it is empty. */
async function validatedComment(
  document: ProjectDocument,
  comment: MessageContent | undefined
): Promise<MessageContent | undefined> {
  return comment?.length ? validateMessageContent(document, comment) : undefined;
}

async function validateMessageContent(
  document: ProjectDocument,
  content: MessageContent
): Promise<MessageContent> {
  const presentations = validatePresentations(document, referencedPresentations(content));
  const known = new Set(presentations);
  for (const segment of content) {
    if (segment.type === 'markdown') continue;
    if (segment.type === 'interface-ref')
      throw new Error('Only the assistant’s replies point at the interface.');
    if (!known.has(segment.presentationId)) {
      throw new Error(`Unknown referenced presentation ${segment.presentationId}.`);
    }
    if (segment.type === 'element-ref') validateElementReference(document, segment);
    else if (segment.step !== undefined)
      validateReferencedStep(document, segment.presentationId, segment.step);
  }
  return content.map((segment) =>
    segment.type === 'markdown' || segment.type === 'interface-ref'
      ? segment
      : named(document, segment)
  );
}

/** What was on screen, its presentations known and at steps they have, each step named. */
function validateViewing(document: ProjectDocument, viewing: FeedbackViewing): FeedbackViewing {
  if (!('presentations' in viewing)) return viewing;
  validatePresentations(document, viewedPresentations(viewing));
  return {
    presentations: viewing.presentations.map(({ presentationId, step }) => {
      if (step === undefined) return { presentationId };
      validateReferencedStep(document, presentationId, step);
      const { stepName } = named<Extract<MessageContent[number], { type: 'presentation-ref' }>>(
        document,
        {
          type: 'presentation-ref',
          presentationId,
          step
        }
      );
      return { presentationId, step, ...(stepName ? { stepName } : {}) };
    })
  };
}

/** The presentations on screen, by id. */
function viewedPresentations(viewing: FeedbackViewing | undefined): string[] {
  return viewing && 'presentations' in viewing
    ? viewing.presentations.map(({ presentationId }) => presentationId)
    : [];
}

/** A reference at a step, named as its presentation names the step, where it does. */
function named<
  Reference extends Exclude<MessageContent[number], { type: 'markdown' | 'interface-ref' }>
>(document: ProjectDocument, reference: Reference): Reference {
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
    throw new Error('Only presentations built from source support element references.');
  if (reference.step >= presentationStepLabels(value).length)
    throw new Error(`Presentation ${reference.presentationId} has no step ${reference.step + 1}.`);
  if (!locateElement(value.source.text, reference.element.id))
    throw new Error(`Element ${reference.element.id} is not a node of that presentation.`);
  for (const { node } of reference.element.layouts ?? [])
    if (!locateElement(value.source.text, node))
      throw new Error(`Layout node ${node} is not a node of that presentation.`);
}

/** Element references in a message. */
function referencedElements(content: MessageContent): ElementReference[] {
  return content.filter((segment): segment is ElementReference => segment.type === 'element-ref');
}

function referencedPresentations(content: MessageContent): string[] {
  return [
    ...new Set(
      content.flatMap((segment) =>
        segment.type === 'markdown' || segment.type === 'interface-ref'
          ? []
          : [segment.presentationId]
      )
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
  if (!headStillCurrent(document.events, expectedHead)) {
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
  return `The previous candidate batch failed validation: ${errorMessage(cause)}. Return one complete corrected batch of up to two candidates. The participant never saw the failed batch or this message: reply only about what they will see, never that something failed or was fixed. Previous candidates: ${JSON.stringify(candidates)}. Failure history: ${JSON.stringify(failureSummaries.map((summary) => summary.slice(0, 2_000)))}`;
}

// The openai SDK's errors are told apart by class: their `name` is plain 'Error'.
function requestTimedOut(error: unknown): boolean {
  return error instanceof APIConnectionTimeoutError;
}

function requestCancelled(error: unknown): boolean {
  return (
    error instanceof APIUserAbortError ||
    (error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'StudyPhaseDeadlineError'))
  );
}

function generationFailureKind(error: unknown) {
  if (error instanceof Error && error.name === 'OpenAIConfigurationError') return 'configuration';
  if (requestTimedOut(error)) return 'timeout';
  if (requestCancelled(error)) return 'cancelled';
  if (error instanceof Error && error.name === 'InvalidChatbotResponseError') {
    return 'invalid-response';
  }
  return 'provider';
}

function safeErrorMessage(error: unknown) {
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
/**
 * A changed source's first build: the viewed variant's values, with the assistant's own values for
 * it, as where its steps pause; unlike a vary's, they settle nothing, being no one's request.
 */
function sourceValues(
  viewed: DesignValues | undefined,
  decision: SourceDecisionOf<'revise' | 'edit'>
): { base?: DesignValues; chosen?: DesignValues } {
  return {
    ...(viewed ? { base: viewed } : {}),
    ...(decision.values?.length ? { chosen: designValues(decision.values) } : {})
  };
}

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
