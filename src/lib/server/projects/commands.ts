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
import type { FeedbackViewing } from '$lib/shared/projects/events/feedback-submitted';
import type { ArtifactChange, RecordedText } from '$lib/shared/projects/events/values';
import type { ProjectCommandResult, ProjectDocument } from '$lib/shared/projects/model';
import {
  presentationBufferState,
  waitingComparisons
} from '$lib/shared/projects/presentation-buffer';
import type { DesignValues, RenderablePresentation } from '$lib/shared/presentations';
import {
  isSverlinPresentation,
  presentationMode,
  presentationStepLabels,
  presentationStepName,
  presentationVariant
} from '$lib/shared/presentations';
import { headStillCurrent, projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
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
  SourceArtifactChatOutput
} from '$lib/server/chat-bots/types';
import type {
  Comparisons,
  DecisionQuestion,
  SourceDecision,
  SourceDecisionOf
} from '$lib/server/chat-bots/source-decisions';
import { openQuestion } from '$lib/shared/projects/questions';
import { briefAttribute, projectBrief, type BriefEntry } from '$lib/shared/projects/brief';
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
  type ChooserId,
  type DesignSource,
  type VariantChoice,
  type VariantChooser
} from './choosers';
import { projectChooserId } from './chooser-config';
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
  /** The bot choosing variants by its id; without one, variants are drawn at random. */
  getChooser?: typeof getSverlinChooser;
  /** Which chooser a project's variants come from. */
  chooserFor?: (projectId: string) => Promise<ChooserId>;
  /** How long Another variant waits for a chooser bot before drawing at random. */
  resampleTimeLimitMs?: number;
};

export const defaultProjectCommandDependencies: ProjectCommandDependencies = {
  repository: projectRepository,
  projectService: defaultProjectServiceDependencies,
  getChatbot,
  getCandidateChatbot,
  getParticipantIntakeClassifier,
  getChooser: getSverlinChooser,
  chooserFor: projectChooserId
};

/**
 * How long a participant waits for a model chooser's variants of the source as it is before they
 * are drawn at random instead: they are waiting on the button, unlike after an assistant's turn.
 */
const resampleTimeLimitMs = 20_000;

/** The chooser a project's variants come from, the random draw where none is configured. */
async function projectChooser(
  projectId: string,
  dependencies: ProjectCommandDependencies,
  timeLimitMs?: number,
  chosen?: ChooserId
): Promise<VariantChooser> {
  const id = chosen ?? (await dependencies.chooserFor?.(projectId)) ?? 'model';
  const bot = id === 'random' ? undefined : dependencies.getChooser?.(id);
  return bot ? botChooser(id, bot, dependencies, timeLimitMs) : randomChooser;
}

/**
 * A chooser bot (the model, or the Decisions API) behind the chooser interface, its generation
 * recorded on the Timeline; failing, or past its time limit, it returns no choices.
 */
function botChooser(
  id: ChooserId,
  bot: NonNullable<ReturnType<NonNullable<ProjectCommandDependencies['getChooser']>>>,
  dependencies: ProjectCommandDependencies,
  timeLimitMs?: number
): VariantChooser {
  return {
    id,
    async choose(request) {
      const design = designVariables(request.design);
      const prompt = await bot.preparePrompt({
        messages: projectConversationMessages(request.document.events),
        project: {
          purpose: request.purpose,
          source: request.source,
          ...(request.summary ? { summary: request.summary } : {}),
          count: request.count,
          design,
          ...(request.seen.length ? { seen: request.seen } : {}),
          ...(Object.keys(request.settled).length ? { settled: request.settled } : {}),
          ...(request.design.runs ? { runs: request.design.runs } : {}),
          ...(request.design.structures && Object.keys(request.design.structures).length
            ? { structures: request.design.structures }
            : {})
        },
        attempt: 1
      });
      const operation = currentProjectOperationSignal();
      const signals = [
        ...(operation ? [operation] : []),
        ...(timeLimitMs ? [AbortSignal.timeout(timeLimitMs)] : [])
      ];
      const signal = signals.length ? AbortSignal.any(signals) : undefined;
      const generation = await runPreparedGeneration(
        {
          document: request.document,
          attempt: request.attempt,
          operationId: request.operationId,
          prompt,
          generate: () => bot.generatePrepared(prompt, { signal }),
          validateResult: () => {},
          fallbackResponse: (result) => ({ variants: result.variants }),
          notifyFailure: false
        },
        dependencies
      );
      if (!generation.ok) return { document: generation.document };
      return {
        document: generation.document,
        choices: generation.result.variants.map((variant) => ({
          // Only values the space offers, so an invalid repeat of a variable does not replace a valid one.
          chosen: Object.fromEntries(
            variant.values
              .filter(({ variable, value }) => offeredOptions(design, variable)?.includes(value))
              .map(({ variable, value }) => [variable, value])
          ),
          randomise: variant.randomise
        }))
      };
    }
  };
}

/**
 * New variants of the source as it is, from the presentation they are made from (or the newest of
 * the source), as the project's chooser picks them: given the variants of the source already seen,
 * so they differ in what is still open.
 */
export function chosenVariantRequests(
  dependencies: ProjectCommandDependencies = defaultProjectCommandDependencies,
  /** A chooser picked for this resample in dev mode, over the project's. */
  picked?: ChooserId
): VariantRequester {
  return async (options) => {
    const snapshot = projectSnapshotAt(options.document);
    const artifact = snapshot.artifacts[snapshot.entryArtifactId];
    const shown = sourcePresentations(options.document, artifact?.content.sha256);
    const from = options.from
      ? shown.find(({ presentationId }) => presentationId === options.from)
      : shown.at(-1);
    if (!artifact || !from?.variant) return randomVariantRequests(options);
    const chooser = await projectChooser(
      options.document.projectId,
      dependencies,
      dependencies.resampleTimeLimitMs ?? resampleTimeLimitMs,
      picked
    );
    const design: DesignSource = {
      ...from,
      ...sourceBuildFacts(options.document, from.source.sha256)
    };
    const chosen = await chooseVariants(chooser, {
      document: options.document,
      purpose: 'resample',
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

/** How many of a source's newest presentations a chooser is told were already seen. */
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

/** A source's runs and structures, from its newest successful build, which every variant shares. */
function sourceBuildFacts(
  document: ProjectDocument,
  sha256: string
): Pick<DesignSource, 'runs' | 'structures'> {
  const builds = new Set(
    document.events.flatMap((event) =>
      event.type === 'build.requested' && event.payload.source.sha256 === sha256
        ? [event.payload.buildId]
        : []
    )
  );
  const built = document.events.findLast(
    (event) => event.type === 'build.succeeded' && builds.has(event.payload.buildId)
  );
  if (built?.type !== 'build.succeeded') return {};
  const bundle = JSON.parse(built.payload.bundle.text) as Pick<DesignSource, 'runs' | 'structures'>;
  return {
    ...(bundle.runs ? { runs: bundle.runs } : {}),
    ...(bundle.structures ? { structures: bundle.structures } : {})
  };
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
    deadlineAt?: string;
  },
  dependencies: ProjectCommandDependencies = defaultProjectCommandDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    assertCurrentProjectOperationActive();
    const before = await dependencies.repository.load(options.projectId);
    assertAcceptedInteraction(before, options.operationId, 'prefer');
    const based = await basedOnAnswer(before, options.answer, options.operationId, dependencies);
    let document = await appendProjectPreference(based, options, dependencies.projectService);
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
  if (preferences.length && preferences.length === interactions.length) {
    const answered = await dropMootComparisons(
      before,
      answersAfter(before.events, Math.min(...preferences.map(({ id }) => id)) - 1),
      options.operationId,
      concurrentDependencies
    );
    if (answered.waiting)
      return { document: answered.document, appendedEvents: appendedSince(answered.document) };
  }
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
    operationId: string;
  },
  dependencies: ProjectCommandDependencies = defaultProjectCommandDependencies
): Promise<ProjectCommandResult> {
  return runProjectCommand(options.projectId, async () => {
    const before = await dependencies.repository.load(options.projectId);
    assertHead(before, options.expectedHead);
    const based = await basedOnAnswer(before, options.answer, options.operationId, dependencies);
    let document = await appendProjectPreference(based, options, dependencies.projectService);
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
 * The assistant builds on the candidate the participant preferred; either is fine and decide later
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
          turn,
          presentationCount,
          ...(buildFeedback ? { buildFeedback } : {})
        },
        dependencies
      );
      current = generation.document;
      if (!generation.ok) return { document: current, done: true };
      // What the participant said holds whether or not the decision with it could be built: the
      // brief entries of every attempt this turn, the latest for each attribute, steer this
      // decision's comparisons and are recorded with the accepted reply.
      for (const entry of generation.result.brief ?? []) turnBrief.set(entry.key, entry);
      const brief = turnBrief.size ? [...turnBrief.values()] : undefined;

      // The reply is recorded last, once its decision is accepted and has presented its version (a
      // comparison's first pair), so the reply of an attempt set aside is never the turn's and the
      // reply, its question, and what it presents arrive together; its candidate-refs, and a
      // question about the new version, name what this turn presented. A blank reply to a change
      // says what the change does instead; the fallback's starts with what it simplified. A note
      // follows what the reply says, as which comparisons were left out.
      const recordReply = (
        document: ProjectDocument,
        presented: readonly RenderablePresentation[] = [],
        note?: string
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
          { ...(question ? { question } : {}), ...(brief ? { brief } : {}) }
        );
      };

      // The source each decision asks to build, if any. Edits apply to the source being revised:
      // the failed candidate when repairing it.
      const { decision } = generation.result;
      // With a count, that many presentations, in whole sets: the first shows and the rest wait.
      const queued =
        'count' in decision && decision.count
          ? Math.ceil(decision.count / presentationCount) * presentationCount
          : undefined;
      // A decision that cannot be built as given is recorded, as a failed build is, so the Timeline
      // holds every candidate set aside, and the next attempt repairs it.
      const reject = async (
        kind: 'edits' | 'comparisons',
        problems: string[],
        failedSource: string,
        advice: string[] = []
      ) => {
        const summary = `Attempt ${attempt}: the ${kind} could not be ${kind === 'edits' ? 'applied' : 'built'}. ${problems.join(' ')}`;
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
                ...(kind === 'comparisons' ? { rejected: kind } : {}),
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
              severity: 'error' as const,
              code: kind === 'edits' ? 'edit_not_applied' : 'comparison_not_built',
              message,
              raw: message
            })),
            ...advice.map((message) => ({
              severity: 'warning' as const,
              code: 'comparison_kept',
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
      let pairs: Comparisons | undefined;
      let checked = false;
      let candidate: string | undefined;
      let variant: { base?: DesignValues; chosen?: DesignValues; randomise?: string[] | true } = {
        base: viewed
      };
      // Of comparisons some of which cannot be built as given (problems, by comparison): with
      // attempts left, a repair is told to keep the others unchanged, so its reply counts only
      // what is built; on the last, the others are built without them and the reply says which
      // were left out. None buildable, or a changed source's first pair, built already, among them,
      // the comparisons are repaired as a whole.
      let leftOut: string | undefined;
      const screen = async (problems: string[][], firstBuilt: boolean) => {
        if (!pairs || candidate === undefined || !problems.flat().length) return undefined;
        const asked = pairs;
        const kept = asked.flatMap((pair, index) => (problems[index]?.length ? [] : [index]));
        const list = (items: string[]) =>
          new Intl.ListFormat('en', { type: 'conjunction' }).format(items);
        const named = (indexes: number[]) =>
          list(indexes.map((index) => `${index + 1} (“${asked[index].question}”)`));
        if (
          attempt < chatbot.config.attemptProfiles.length ||
          !kept.length ||
          (firstBuilt && problems[0]?.length)
        )
          return reject(
            'comparisons',
            problems.flat(),
            candidate,
            kept.length
              ? [
                  `Comparison${kept.length > 1 ? 's' : ''} ${named(kept)} can be built as given: return ${kept.length > 1 ? 'them' : 'it'} unchanged, leaving out or correcting the others, and count in your reply only the comparisons you return.`
                ]
              : []
          );
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
        pairs = kept.map((index) => asked[index]);
        leftOut = `I left out ${list(dropped.map(({ question }) => `“${question}”`))}, which could not be built as asked.`;
        return undefined;
      };
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
            ),
            false
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
          pairs = decision.comparisons ?? undefined;
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
      // Comparisons build their first pair alone, so it shows before the rest are built.
      const requests = pairs
        ? comparisonRequests(batchSeeds, viewed, variant.chosen ?? {}, pairs.slice(0, 1))
        : basedRequests(batchSeeds, variant.base, variant.chosen, randomised === true).map(
            (request, index) =>
              index === 0 && Array.isArray(randomised) && randomised.length
                ? { ...request, variant: { ...request.variant, randomise: randomised } }
                : request
          );
      const built = await buildCandidateBatch(
        { document: current, candidate, requests, operationId, attempt },
        dependencies
      );
      current = built.document;
      if (pairs && !batchSucceeded(built.recorded)) {
        // A value the first comparison sets that the source does not offer.
        const unoffered = designValueProblems(built.recorded);
        const { question } = pairs[0];
        if (unoffered.length)
          return reject(
            'comparisons',
            unoffered.map((problem) => `Comparison 1 (“${question}”): ${problem}`),
            candidate
          );
      }
      if (batchSucceeded(built.recorded)) {
        const [first] = built.recorded.builds;
        if (pairs && !checked && first?.result.ok) {
          const screened = await screen(
            comparisonProblems(
              pairs,
              designVariables(first.result.bundle),
              { tree: pictureTree(candidate), base: { ...viewed, ...variant.chosen }, settled: {} },
              briefSteering(projectBrief(current.events, brief))
            ),
            true
          );
          if (screened) return screened;
        }
        // The assistant is the one author of a new or edited source: its first build stands. Only
        // the presentations a vary or resample with a count queues, more variants of the source as
        // it is, show the variants the chooser picks; the first build stands if that fails.
        const shown = queued
          ? await chosenBuild(
              {
                document: current,
                recorded: built.recorded,
                candidate,
                ...('summary' in decision ? { summary: decision.summary } : {}),
                seeds: batchSeeds,
                operationId,
                attempt,
                base: { ...variant.base, ...variant.chosen },
                fixed: variant.chosen ?? {}
              },
              dependencies
            )
          : { document: current, recorded: built.recorded };
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
              ? { setSize: 2 as const, pairs: [pairQuestion(pairs[0])] }
              : queued
                ? { setSize: presentationCount }
                : {})
          },
          dependencies
        );
        current = await recordReply(current, firstPresentedSet(current, acceptedAfter), leftOut);
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
      project: projectAiContext(options.document, options.contextSelection),
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
 * Build more variants of the source as it is again, as a vary or resample with a count asks, with
 * those the chooser picks from its design space: from the viewed variant with the values the
 * assistant fixes, which every variant keeps, given the variants of the source already seen. A
 * value the space does not offer is left out. With the random draw, or when choosing or building
 * fails, the first build stands.
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
    /** The variant every build starts from: the viewed one, with the fixed values. */
    base?: DesignValues;
    fixed: DesignValues;
  },
  dependencies: ProjectCommandDependencies
): Promise<{ document: ProjectDocument; recorded: RecordedBuildBatch }> {
  const firstBuild = { document: options.document, recorded: options.recorded };
  const [first] = options.recorded.builds;
  const bundle = first?.result.ok && 'bundle' in first ? first.result.bundle : undefined;
  const chooser = await projectChooser(options.document.projectId, dependencies);
  // With the random draw, the first build already draws every variant but the first afresh.
  if (chooser.id === 'random' || !bundle?.variant) return firstBuild;
  const base = options.base && Object.keys(options.base).length ? options.base : undefined;
  const seen = differences(
    sourcePresentations(options.document, sourceSha256(options.candidate))
      .slice(-recentlySeen)
      .reverse()
      .flatMap(({ variant }) => (variant ? [variant] : [])),
    base
  );
  const chosen = await chooseVariants(chooser, {
    document: options.document,
    purpose: 'resample',
    source: options.candidate,
    ...(options.summary ? { summary: options.summary } : {}),
    count: options.seeds.length,
    design: base ? { ...bundle, variant: { ...bundle.variant, ...base } } : bundle,
    seen,
    settled: { ...settledValues(options.document.events), ...options.fixed },
    operationId: options.operationId,
    attempt: options.attempt
  });
  if (chosen.chooser === 'random') return { ...firstBuild, document: chosen.document };
  const choices = distinctChoices(
    chosen.choices.map((choice) => keeping(choice, options.fixed)),
    base,
    seen
  );
  const requests = chosenRequests(options.seeds, designVariables(bundle), base, choices);
  const rebuilt = await buildCandidateBatch(
    {
      document: chosen.document,
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

function pairQuestion({ question, left, right, brief }: Comparisons[number]): PairQuestion {
  return {
    question,
    labels: [left.label, right.label],
    ...(brief ? { brief: { key: brief.attribute, tags: [brief.left, brief.right] } } : {})
  };
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
    pairs: Comparisons;
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
    if (batchSucceeded(built.recorded))
      document = await activateBuiltPresentations(
        built.recorded,
        dependencies.projectService,
        options.actor,
        pairQuestion(pair)
      );
  }
  return document;
}

/**
 * Set aside the waiting comparisons these answers make moot (mootComparison), and say whether any
 * are still to answer: the assistant waits for the last of its questions to be answered before it
 * takes a turn on them.
 */
async function dropMootComparisons(
  document: ProjectDocument,
  answers: readonly Answer[],
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<{ document: ProjectDocument; waiting: boolean }> {
  const waiting = waitingComparisons(document);
  const moot = waiting.filter(({ variants: [left = {}, right = {}] }) =>
    answers.some((answer) => mootComparison(answer, askedPair(left, right)))
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
  return { document, waiting: waiting.length > moot.length };
}

/** A choice with the values the assistant fixed, which it neither changes nor draws afresh. */
function keeping(choice: VariantChoice, fixed: DesignValues): VariantChoice {
  const randomise =
    choice.randomise === true || choice.randomise === undefined
      ? choice.randomise
      : choice.randomise.filter((key) => !(key in fixed));
  return { chosen: { ...choice.chosen, ...fixed }, ...(randomise ? { randomise } : {}) };
}

/**
 * Choices apart from each other and from the variants seen: one that draws nothing afresh and sets
 * no value apart from the base, or the same values as an earlier choice or a seen variant, draws
 * the rest at random instead.
 */
function distinctChoices(
  choices: readonly VariantChoice[],
  base: DesignValues | undefined,
  seen: readonly DesignValues[]
): VariantChoice[] {
  const key = (values: DesignValues) =>
    JSON.stringify(
      Object.entries(values)
        .filter(([variable, value]) => base?.[variable] !== value)
        .sort(([left], [right]) => left.localeCompare(right))
    );
  const taken = new Set([key({}), ...seen.map(key)]);
  return choices.map((choice) => {
    const draws = choice.randomise === true || !!choice.randomise?.length;
    const values = key(choice.chosen);
    if (draws || !taken.has(values)) {
      taken.add(values);
      return choice;
    }
    return { ...choice, randomise: true };
  });
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

/**
 * How many presentations a decision shows first, which its reply's candidate-refs can name: none
 * for a reply alone, a comparison's pair, a set of those a count or resample makes, or one version.
 */
function shownSlots(decision: SourceDecision, presentationCount: 1 | 2): number {
  if (decision.action === 'respond') return 0;
  if ('comparisons' in decision && decision.comparisons?.length) return 2;
  if (decision.action === 'resample' || ('count' in decision && decision.count))
    return presentationCount;
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
    brief
  }: {
    intakeStep?: ParticipantIntakeStepId;
    question?: AssistantQuestion;
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
          ...(brief?.length ? { brief } : {})
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
