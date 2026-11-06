/** The assistant's replies: their content resolved and checked, recorded, and held questions released. */

/** Mode-neutral AI feedback, candidate validation, and bounded attempt orchestration. */

import { InvalidChatbotResponseError } from '$lib/server/ai/providers/types';
import type {
  EventId,
  NewProjectEvent,
  ParticipantIntakeStepId
} from '$lib/shared/projects/events';
import {
  markdownMessage,
  structureKnownPresentationReferences,
  type MessageContent
} from '$lib/shared/projects/events/message-content';
import type { ProjectDocument } from '$lib/shared/projects/model';
import { type RenderablePresentation } from '$lib/shared/presentations';
import { projectSnapshotAt } from '$lib/shared/projects/projection';
import { interfaceReferenceFor } from '$lib/shared/interface-parts';
import type {
  ChatbotPrompt,
  GeneratedMessageContent,
  RecoveryExplanation
} from '$lib/server/ai/bots/types';
import type { DecisionQuestion, SourceDecision } from '$lib/server/ai/decisions/source-decisions';
import { heldQuestion, openQuestion } from '$lib/shared/projects/questions';
import { maximumQuestionText } from '$lib/shared/projects/events/assistant-responded';
import { type BriefEntry } from '$lib/shared/projects/brief';
import { elementIdSchema } from '$lib/shared/projects/events/message-content';
import * as v from 'valibot';

import {
  appendProjectEvents,
  draftEvent,
  type RecordedBuild,
  type RecordedBuildBatch
} from '$lib/server/projects/service';
import type { ProjectCommandDependencies } from '$lib/server/projects/commands';

/** The first display set presented after an event, by slot: what a reply's candidate-refs name. */
export function firstPresentedSet(
  document: ProjectDocument,
  after: EventId
): RenderablePresentation[] {
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
export const styleRule = /^\s*([^{}\n]{1,200})\{([^{}]*)\}/u;
export const selector = /^[.#]?[a-z][\w-]*(?:\s*[,>+~ ]\s*[.#]?[a-z][\w-]*)*\s*$/iu;

export function withoutLeadingStyleRules(text: string): string {
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

export function resolveAssistantContent(
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
export function repairedPresentationId(
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
export function generationReference(
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
export function shownSlots(decision: SourceDecision, presentationCount: 1 | 2): number {
  if (decision.action === 'respond') return 0;
  if ('comparisons' in decision && decision.comparisons?.length) return 2;
  // A count is ignored (see runSverlinTurn), but a reply naming its first pair is read as words.
  if ('count' in decision && decision.count) return 2;
  if (decision.action === 'resample') return presentationCount;
  return 1;
}

export function blankReply(reply: GeneratedMessageContent): boolean {
  return reply.every((segment) => segment.type === 'markdown' && !segment.text.trim());
}

export function validateGeneratedReply(
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

export function validateRecoveryExplanation(
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

export function generatedReplyText(reply: GeneratedMessageContent): string {
  return reply
    .map((segment) => {
      if (segment.type === 'markdown') return segment.text;
      if (segment.type === 'presentation-ref') return `[Presentation ${segment.presentationId}]`;
      if (segment.type === 'interface-ref') return `[Interface part ${segment.part}]`;
      return `[Candidate ${segment.slot + 1}]`;
    })
    .join(' ');
}

export function batchSucceeded(batch: RecordedBuildBatch): boolean {
  return batch.builds.length > 0 && batch.builds.every(({ result }) => result.ok);
}

export function firstFailure(
  batch: RecordedBuildBatch
): Extract<RecordedBuild, { result: { ok: false } }> | undefined {
  return batch.builds.find(({ result }) => !result.ok) as
    | Extract<RecordedBuild, { result: { ok: false } }>
    | undefined;
}

/** The question a message sent now answers, if one is open (see openQuestion). */
export function answering(document: ProjectDocument): { answers?: EventId } {
  const open = openQuestion(document.events);
  return open ? { answers: open.eventId } : {};
}

/**
 * A decision's question as recorded with the reply: about the first presentation the decision
 * makes, where it names "new" and makes one; about a presentation shown before, where it names one;
 * otherwise in words. Elements count only with a presentation, and only well-formed ids.
 */
export function recordedQuestion(
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

export type AssistantQuestion = NonNullable<
  NewProjectEvent<'assistant.responded'>['payload']['question']
>;

export function appendAssistantResponse(
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
): Promise<ProjectDocument> {
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
export const openAlternative = 'Or tell me what you’d like to change, or ask me for suggestions.';

/**
 * Ask the question held back with comparisons (heldQuestion) in a reply of its own, with no model
 * call: once the last of them is answered, or when the participant writes first. It ends with the
 * open alternative, unless it offers one already or would grow too long.
 */
export function releaseHeldQuestion(
  document: ProjectDocument,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  const held = heldQuestion(document.events);
  const question = held?.payload.heldQuestion;
  if (!held || !question || held.actor.kind !== 'assistant') return Promise.resolve(document);
  const open = /\bor (?:tell|ask)\b|\bsuggest/iu.test(question.text);
  const opened = `${question.text} ${openAlternative}`;
  const text = open || opened.length > maximumQuestionText ? question.text : opened;
  return appendAssistantResponse(document, text, held.actor.botId, operationId, dependencies, [], {
    question: { ...question, text },
    releases: held.id
  });
}
