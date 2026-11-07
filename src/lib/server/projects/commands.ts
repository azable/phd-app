/** Mode-neutral AI feedback, candidate validation, and bounded attempt orchestration. */

import type { EventId } from '$lib/shared/projects/events';
import {
  type Annotation,
  type ElementReference,
  type MessageContent
} from '$lib/shared/projects/events/message-content';
import type { FeedbackViewing } from '$lib/shared/projects/events/feedback-submitted';
import type { ProjectCommandResult, ProjectDocument } from '$lib/shared/projects/model';
import {
  isSverlinPresentation,
  presentationStepLabels,
  presentationStepName
} from '$lib/shared/presentations';
import { headStillCurrent, projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import { projectOperation } from '$lib/shared/projects/operations';
import {
  getChatbot,
  getCandidateChatbot,
  getParticipantIntakeClassifier
} from '$lib/server/ai/bots/registry';
import type { ChatAdapter } from '$lib/server/ai/providers/types';
import type {
  DecisionsRequest,
  DecisionsResponse
} from '$lib/server/ai/providers/openai-decisions';
import type { HelperPipelineConfig } from '$lib/server/ai/bots/helper-pipeline';
import { sourceBuildFacts, type AiContextSelection } from '$lib/server/ai/context/project-context';
import { heldQuestion } from '$lib/shared/projects/questions';

import { runProjectCommand } from './command-lock';
import { appendProjectPreference, type PreferenceAnswer } from './presentations';
import { assertCurrentProjectOperationActive } from './operation-context';
import { projectRepository, type ProjectRepository } from './repository';
import {
  appendProjectEvents,
  baseOnPresentation,
  defaultProjectServiceDependencies,
  draftEvent,
  randomVariantRequests,
  type ProjectServiceDependencies,
  type VariantRequester
} from './service';
import {
  chooseVariants,
  chosenRequests,
  differences,
  randomChooser,
  type DesignSource
} from './choosers';
import { answersAfter, settledValues } from './variant-guard';
import { answering, releaseHeldQuestion } from '$lib/server/ai/turns/replies';
import { basedOnAnswer, handleParticipantIntake } from '$lib/server/ai/turns/intake';
import {
  dropMootComparisons,
  notedSinceReply,
  presentPicks
} from '$lib/server/ai/turns/comparisons';
import { modeAssistants, modeTurns } from '$lib/modes/assistants.server';
import { modeBuilders } from '$lib/modes/server';

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
  /** The Decisions API the helpers' scoring stage calls, the real one where absent. */
  decide?: (request: DecisionsRequest, signal?: AbortSignal) => Promise<DecisionsResponse>;
  /** The helper pipeline's stages and models, ai/bots/helper-pipeline.ts's where absent. */
  helperPipeline?: HelperPipelineConfig;
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
    if (!artifact || !from?.design) return randomVariantRequests(options);
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
      requests: chosenRequests(
        options.seeds,
        modeAssistants[snapshot.mode].design?.variables(design) ?? { options: {}, variables: [] },
        from.design,
        chosen.choices
      )
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
  // A mode with no elements to reference (html) has none in its messages (validateMessageContent).
  const contextSelection: AiContextSelection = {
    eventIds: focus,
    presentationIds: presentations,
    elements: referencedElements(content)
  };
  document = await modeTurns[projectSnapshotAt(document).mode](
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
    document = await presentPicks(document, [preference.id], options.operationId, dependencies);
    if (heldQuestion(document.events)) {
      // A note written with an answer is the participant writing, so the turn runs for it; read
      // before the release, which is itself a reply.
      const noted = notedSinceReply(document.events);
      document = await releaseHeldQuestion(document, options.operationId, dependencies);
      if (!noted) return finishMutation(before, document);
    }
    document = await modeTurns[projectSnapshotAt(document).mode](
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
    else if (segment.type === 'annotation' && segment.element)
      validateElementReference(document, annotatedElement(segment)!);
    else if (segment.step !== undefined)
      validateReferencedStep(document, segment.presentationId, segment.step);
  }
  return content.flatMap((segment): MessageContent => {
    if (segment.type === 'markdown' || segment.type === 'interface-ref') return [segment];
    // A comment on an element its source does not show keeps its words and its point.
    if (segment.type === 'annotation') {
      const element = annotatedElement(segment);
      if (!element || elementLocated(document, element)) return [named(document, segment)];
      const kept = { ...segment };
      delete kept.element;
      return [named(document, kept)];
    }
    if (segment.type !== 'element-ref' || elementLocated(document, segment))
      return [named(document, segment)];
    // An element its source does not show where its id says, as one an older compiler named,
    // keeps the participant's words: it becomes its version at that step, with what it showed.
    const { presentationId, step, element } = segment;
    return [
      named(document, { type: 'presentation-ref', presentationId, step }),
      { type: 'markdown', text: ` (the part showing “${element.label}”)` }
    ];
  });
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
export function viewedPresentations(viewing: FeedbackViewing | undefined): string[] {
  return viewing && 'presentations' in viewing
    ? viewing.presentations.map(({ presentationId }) => presentationId)
    : [];
}

/** A reference at a step, named as its presentation names the step, where it does. */
export function named<
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

/** An element reference must name a step of a Sverlin presentation. */
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
}

/** Whether an element reference, and every layout around it, names a <Node> in its source. */
function elementLocated(document: ProjectDocument, reference: ElementReference): boolean {
  const presentation = document.events.find(
    (event) =>
      event.type === 'visualization.presented' &&
      event.payload.presentation.presentationId === reference.presentationId
  );
  if (presentation?.type !== 'visualization.presented') return true;
  const value = presentation.payload.presentation;
  if (!isSverlinPresentation(value)) return true;
  const locate = modeBuilders[value.mode]?.locateElement;
  if (!locate) return true;
  return [reference.element.id, ...(reference.element.layouts ?? []).map(({ node }) => node)].every(
    (id) => locate(value.source.text, id) !== undefined
  );
}

/** Element references in a message, the elements its comments are pinned to among them. */
export function referencedElements(content: MessageContent): ElementReference[] {
  return content.flatMap((segment) =>
    segment.type === 'element-ref'
      ? [segment]
      : segment.type === 'annotation'
        ? (annotatedElement(segment) ?? [])
        : []
  );
}

/** The element a comment is pinned to, as a reference to it at the comment's step. */
function annotatedElement(annotation: Annotation): ElementReference | undefined {
  const { presentationId, step, stepName, element } = annotation;
  return element
    ? { type: 'element-ref', presentationId, step, ...(stepName ? { stepName } : {}), element }
    : undefined;
}

export function referencedPresentations(content: MessageContent): string[] {
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

export function rebasingDependencies(
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
