/**
 * AI-owned projections from complete project history into bounded model context.
 *
 * The event document remains lossless. This module deliberately gives the model
 * a compact index, the source the turn builds on, every version of the source as a tree, and
 * details for explicitly selected events, presentations, and elements.
 *
 * @packageDocumentation
 */

import {
  matchProjectEvent,
  type EventId,
  type ProjectEvent,
  type ProjectEventCases,
  type ProjectEventOf,
  type ProjectEventType
} from '$lib/shared/projects/events';
import {
  plainMessageText,
  type ElementReference
} from '$lib/shared/projects/events/message-content';
import type { FeedbackViewing } from '$lib/shared/projects/events/feedback-submitted';
import {
  comparisonOutcome,
  preferredPresentation
} from '$lib/shared/projects/events/visualization-presented';
import {
  designKeys,
  modeBuilders,
  type ElementLocation,
  type NestedDesign
} from '$lib/modes/server';
import { modeAssistants } from '$lib/modes/assistants.server';
import type { ProjectDocument, ProjectSnapshot } from '$lib/shared/projects/model';
import type {
  BrowserBundlePresentation,
  DesignValues,
  RenderablePresentation
} from '$lib/shared/presentations';
import { presentationStepLabels } from '$lib/shared/presentations';

type DesignValue = string | number | boolean;
import { projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import { waitingComparisons } from '$lib/shared/projects/presentation-buffer';
import { stepRuns } from '$lib/shared/differing-steps';
import { arrangementsText, readabilityText } from '$lib/shared/readability';
import { interfacePartsFor, type InterfacePartId } from '$lib/shared/interface-parts';
import type { ConversationMessage } from '$lib/server/ai/bots/types';
import {
  heldQuestion,
  projectQuestions,
  type ProjectQuestion
} from '$lib/shared/projects/questions';

import { projectBrief } from '$lib/shared/projects/brief';

import {
  briefContext,
  briefSteering,
  conversationState,
  type AiBrief
} from '$lib/server/ai/context/brief-context';
import {
  openChoices,
  preferenceSummary,
  type AiPreferences
} from '$lib/server/projects/preference-summary';

/** Compact, body-free entry that lets the AI identify one retained event. */
export type AiTimelineEntry = {
  id: EventId;
  type: ProjectEventType;
  actor: ProjectEvent['actor'];
  createdAt: string;
  operationId: string;
  summary: string;
};

/** Immutable source artifact exposed to the AI. */
export type AiArtifact = {
  artifactId: string;
  path: string;
  language: 'svelte' | 'json';
  source: string;
  sha256: string;
};

/** Source state at one event position. */
export type AiWorkspace = {
  entryArtifactId: string;
  artifacts: AiArtifact[];
};

/**
 * One variable of the base's design space: its key, as Compared.Pointed.fill, views.Int, or
 * pointers.Index, its options
 * (a list, or the name of an option set in design.options, as fill), and its value in the viewed
 * variant, with where that value came from.
 */
export type AiVariable = {
  variable: string;
  options: string | readonly DesignValue[];
  value: DesignValue;
  origin?: string;
  /**
   * For a kind's prop holding the value of what it follows, that: its group, as <Node>.padding, or
   * the token its role's look names, as $spacing.
   */
  follows?: string;
};

/** A label's runs, and how many of them change what the view draws (compile.server.ts LabelRuns). */
export type AiLabelRuns = { runs: number; drawn: number };

/** A label's spans as the assistant reads them: how many, and how many change what the view draws. */
export type AiLabelSpans = { spans: number; drawn: number };

/** What a source's build found that every variant shares: each label's runs, each free layout kind's structure. */
export type SourceBuildFacts = {
  runs?: Record<string, AiLabelRuns>;
  structures?: Record<string, string>;
};

/** The base's design space as the viewed variant has it: its variables, and their option sets. */
export type AiDesign = {
  options: Record<string, readonly DesignValue[]>;
  variables: AiVariable[];
};

/**
 * The design as the assistant reads it, most variables in brief: in full only those with options of
 * their own (views, pointers, a listing's language, a prop whose option set is not named after it)
 * or a value chosen or drawn for the viewed variant; every other variable, kept from the variant
 * built on or the starter's, by its kind and prop with its value, its options design.options[prop].
 * Each variable written out cost about 90 characters, and a typical design has 700 (project
 * 7464186f: 63,000 of a 149,000-character context).
 */
export type AiDesignContext = {
  options: Record<string, readonly DesignValue[] | string>;
  variables: AiVariable[];
  values: Record<string, Record<string, DesignValue>>;
  /**
   * The levels above the kinds: each token by its key, and each group a variant sets by its tag, as
   * <Node>, with the kinds following it; a kind's prop following its group is told only there, and
   * one following a token is told as the token. A project's 700 variables were mostly kinds
   * repeating their role's starter look.
   */
  levels?: Record<string, DesignValue | Record<string, DesignValue>>;
};

/** One version of the source, named as the participant sees it, by the start of its hash. */
export type AiSourceVersion = {
  id: string;
  eventId: EventId;
  parent?: string;
  madeBy: string;
  summary?: string;
};

/** Compact identity of one activated visualization. */
export type AiPresentationSummary = {
  eventId: EventId;
  presentationId: string;
  seed?: number;
  sourceSha256: string;
  contentSha256: string;
  /** How large it draws on a typical stage, where the server laid it out. */
  readability?: string;
  /**
   * The best arrangements of its free layouts, the shown one among them, laid out by the server
   * with no model call: the values each sets and how it draws (see arrangementsText).
   */
  arrangements?: string[];
  /** Each step a scene leaves out, drawing what the step before it drew (see sceneSteps). */
  warnings?: string[];
  /**
   * What it actually draws, from the server's layout of its fullest step: each kind of node, by
   * the shape its paint gives it and its size, and its links, those drawn and those drawing nothing.
   */
  drawing?: string;
};

/** Full details resolved for an event explicitly selected by the user. */
export type AiEventDetail = {
  event: ProjectEvent;
  workspace: AiWorkspace;
  activePresentations: AiPresentationSummary[];
};

/** Explicit expansion request supplied by the feedback command. */
export type AiContextSelection = {
  eventIds: readonly EventId[];
  presentationIds?: readonly string[];
  /** Elements the participant selected and referenced in feedback. */
  elements?: readonly ElementReference[];
  interactionEventIds?: readonly EventId[];
};

/** One variable a compared pair gave different values: the preferred one's, and the other's. */
export type VariantDifference = {
  variable: string;
  preferred?: DesignValue;
  other?: DesignValue;
};

/** Why the current assistant turn was started. */
export type AiInteraction =
  | { kind: 'feedback'; eventIds: EventId[] }
  | { kind: 'runtime-failure'; eventId: EventId }
  /** The view helpers' candidates, recorded after a reply that only asked for them. */
  | { kind: 'view-helpers'; eventId: EventId }
  | {
      kind: 'preference';
      eventId: EventId;
      preferredPresentationId: string;
      alternativePresentationId: string;
      step: number;
      /** The variables the pair gave different values, the preferred value first. */
      differences: VariantDifference[];
      /** The question the pair asked, where it was one of the assistant's comparisons. */
      question?: string;
      /** The preferred side as the participant would call it, as “tallies”, for a comparison. */
      answer?: string;
      /**
       * Either is fine (tie) or unsure (skip), where no side was preferred: the preferred and
       * alternative are then the pair's first and second.
       */
      outcome?: 'tie' | 'skip';
      /** For a comparison, the steps at which its two sides draw differently, where known. */
      differsAt?: string;
      /** What the participant wrote in the chat with the answer: a request to act on with it. */
      comment?: string;
    }
  | {
      kind: 'batch';
      eventIds: EventId[];
      preferences: Array<{
        eventId: EventId;
        preferredPresentationId: string;
        alternativePresentationId: string;
        step: number;
        differences: VariantDifference[];
        question?: string;
        answer?: string;
        outcome?: 'tie' | 'skip';
        differsAt?: string;
        comment?: string;
      }>;
    };

/** Compact retained presentation explicitly visible when the user submitted feedback. */
export type AiSelectedPresentation = AiPresentationSummary & {
  displaySetId?: string;
  format: RenderablePresentation['format'];
  steps: Array<{ label: string }>;
  /**
   * Where its variant differs from the viewed one in project.design: those variables, nested (see
   * nestedDesign), with its values. The whole variant repeated the design (23,000 characters in
   * project 7464186f).
   */
  differs?: NestedDesign;
};

/**
 * An element the participant selected in a presentation and referenced in feedback, traced to the
 * <Node> tag in that presentation's source that drew it. The label is what the participant saw.
 */
export type AiSelectedElement = {
  presentationId: string;
  step: number;
  stepLabel: string;
  elementId: string;
  label: string;
  source: ElementLocation;
  /**
   * The free layouts around the element: the one placing it and the one placing its children. Each
   * gives the arranging node (its tag in the source), its kind, that kind's layoutSeed, and the form,
   * direction and curve it drew; varying the kind's form, direction and layoutSeed to these keeps
   * the layout.
   */
  layouts: Array<{
    node: string;
    source?: ElementLocation;
    kind?: string;
    layoutSeed: number;
    form?: string;
    direction?: string;
    curve?: string;
  }>;
};

/** The view helpers' note and candidates (see AiProjectContext.viewHelpers). */
export type AiViewHelpers = {
  note: string;
  /** Whether and when the helpers have run in this project, so no claim about them is guessed. */
  status?: string;
  /** The type the candidates are views of, or the layout they are arrangements of. */
  type?: string;
  layout?: string;
  /** The task the candidates answered, as the assistant gave it. */
  task?: string;
  candidates: {
    name: string;
    description: string;
    markup: string;
    readability?: string;
    /** What its helper tried, telling apart arrangements of one layout, which share its name. */
    label?: string;
  }[];
  /** Replies given since they were proposed, none of them offering these. */
  repliesSince?: number;
};

/** Strongly typed, consumer-specific context supplied to the AI assistant. */
export type AiProjectContext = {
  projectId: string;
  title: string;
  headEventId: EventId;
  /** The source this turn builds on: that of the candidate the participant is viewing. */
  base: AiWorkspace;
  /**
   * Every version of the source, oldest first: the version each was made from, so they form a tree
   * whose branches each hold their own changes, how each was made, and what it shows or changes.
   */
  versions: AiSourceVersion[];
  /**
   * The base's design space, with the values of the variant the participant is viewing. Empty when
   * no presentation of the base recorded its variant. Most variables in brief (see designContext).
   */
  design: AiDesignContext;
  /**
   * Each label of the base, by name: how many spans it has, and how many of those change what the
   * view draws (drawn), from its newest successful build. Builds store them as runs.
   */
  spans?: Record<string, AiLabelSpans>;
  activePresentations: AiPresentationSummary[];
  interfaceCapabilities: string[];
  /**
   * The parts of this system's workspace, each with its name and what it does, as the participant
   * sees them: what an answer about using the interface draws on, pointing at a part with an
   * interface-ref by its id.
   */
  interfaceParts: { id: InterfacePartId; name: string; description: string }[];
  interaction: AiInteraction;
  /**
   * The questions of the assistant's comparisons still to answer, the one showing first, each with
   * the steps at which its two sides draw differently, where known.
   */
  waitingComparisons?: string[];
  /**
   * Your latest question, not a comparison's, and where it stands: held, asked with comparisons and
   * shown once the last is answered or the participant writes; shown, in the chat and not yet
   * answered; or answered.
   */
  question?: { text: string; status: 'held' | 'shown' | 'answered' };
  /**
   * What the preference model believes from every answer so far (preference-summary.ts): each
   * touched choice's likeliest option and whether it is settled, what is most worth asking next,
   * and what was never compared. Recorded with each request's prompt, so the export shows what the
   * system believed when the assistant asked.
   */
  preferences?: AiPreferences;
  /**
   * The design brief (brief-context.ts): what the participant is trying to achieve, each attribute
   * unknown, inferred or confirmed, which are worth asking or confirming now, and what it keeps out
   * of comparisons. It weights preferences' askNext.
   */
  brief: AiBrief;
  /**
   * Present only where the view helpers are on: what they are, and the alternative views they last
   * proposed for the base source, each built and readable, for you to add (edit) and compare
   * (vary), or to leave out.
   */
  viewHelpers?: AiViewHelpers;
  timelineWindow: {
    totalEventCount: number;
    omittedEventCount: number;
  };
  timeline: AiTimelineEntry[];
  selected: {
    events: AiEventDetail[];
    presentations: AiSelectedPresentation[];
    elements: AiSelectedElement[];
  };
};

// The bounded five-call repair ladder can emit at most 30 generation and
// two-seed build events. Forty-eight retains that full ladder plus its
// surrounding interaction events without resending an unbounded event log.
const recentTimelineEventLimit = 48;

const timelineCases = {
  'project.created': (event) => `Created project “${event.payload.title}”.`,
  'project.renamed': (event) =>
    `Renamed project from “${event.payload.previousTitle}” to “${event.payload.title}”.`,
  'operation.accepted': (event) => `Accepted ${event.payload.kind} operation.`,
  'operation.completed': (event) => `Completed ${event.payload.kind} operation.`,
  'operation.failed': (event) =>
    `${event.payload.kind} operation failed (${event.payload.failureKind}): ${event.payload.message}`,
  'feedback.submitted': (event) =>
    `Submitted structured feedback with ${event.payload.content.length} segment(s)${event.payload.focus.length ? ` focused on events ${event.payload.focus.join(', ')}` : ''}.`,
  'assistant.turn-requested': (event) =>
    `Queued assistant consideration of interaction ${event.payload.interactionEventId}.`,
  'assistant.turn-started': (event) =>
    `Started assistant consideration of interactions ${event.payload.interactionEventIds.join(', ')}.`,
  'assistant.intake-completed': (event) =>
    `Completed participant intake (${event.payload.outcome}) at interaction ${event.payload.interactionEventId}.`,
  'visualization.candidates-advanced': (event) =>
    `Advanced past presentations ${event.payload.presentations.join(', ')} (${event.payload.reason}).`,
  'ai.generation-requested': (event) =>
    `Requested ${event.payload.purpose} generation attempt ${event.payload.attempt} from ${event.payload.requestedModel}; prompt ${shortHash(event.payload.prompt.sha256)}.`,
  'ai.generation-succeeded': (event) =>
    `Generation attempt ${event.payload.attempt} succeeded in ${event.payload.durationMs} ms with ${event.payload.model ?? event.payload.requestedModel}; response ${shortHash(event.payload.response.sha256)}.`,
  'ai.generation-failed': (event) =>
    `Generation attempt ${event.payload.attempt} failed (${event.payload.failureKind}): ${event.payload.message}`,
  'build.requested': (event) =>
    `Requested ${event.payload.purpose} build of ${event.payload.sourceLabel} at seed ${event.payload.seed}; source ${shortHash(event.payload.source.sha256)}.`,
  'build.succeeded': (event) =>
    `Build succeeded in ${event.payload.durationMs} ms; bundle ${shortHash(event.payload.bundle.sha256)}.`,
  'build.failed': (event) =>
    `Build failed (${event.payload.failureKind}) with ${event.payload.diagnostics.length} diagnostic(s).`,
  'revision.edits-rejected': (event) =>
    `Rejected the ${event.payload.rejected ?? 'edits'} of generation attempt ${event.payload.attempt}: ${event.payload.problems.join(' ')}${event.payload.kept ? (event.payload.kept.length ? ` Built only comparison${event.payload.kept.length > 1 ? 's' : ''} ${event.payload.kept.join(', ')}, leaving the others out.` : ' Showed the source alone, leaving every comparison out.') : ''}`,
  'artifact.version-created': (event) => {
    const id = entryHash(event);
    return `Created ${event.payload.origin.kind} source version${id ? ` ${id.slice(0, 6)}` : ''}${event.payload.summary ? `: ${event.payload.summary}` : ''}.`;
  },
  'visualization.presented': (event) =>
    `Presented ${event.payload.presentation.format} visualization ${event.payload.presentation.presentationId} in display set ${event.payload.displaySetId}.`,
  'visualization.preference-recorded': (event) => {
    const preferred = preferredPresentation(event.payload);
    const [first, second] = event.payload.presentations;
    if (!preferred)
      return `${comparisonOutcome(event.payload) === 'tie' ? 'Either is fine' : 'Unsure'} between presentations ${first} and ${second} at step ${event.payload.step}.`;
    return `Preferred presentation ${preferred} over ${event.payload.presentations.find((id) => id !== preferred) ?? 'the alternative'} at step ${event.payload.step}.`;
  },
  'visualization.runtime-failed': (event) => runtimeFailureText(event),
  'visualization.variant-reverted': (event) =>
    `Presentation ${event.payload.presentationId} failed with its variant's values ${JSON.stringify(designKeys.writtenNested(event.payload.values))}, though its source draws without them; shown instead with ${JSON.stringify(designKeys.writtenNested(event.payload.shown))} as ${event.payload.replacements.join(', ')}. Nothing in the source needs fixing.`,
  // Left out of the index (projectAiContext).
  'visualization.loaded': (event) => `Presentation ${event.payload.presentationId} loaded.`,
  'assistant.responded': () => 'Assistant responded to the user.',
  'system.notified': (event) => `System ${event.payload.severity}: ${event.payload.message}`,
  'project.view-helpers-set': (event) =>
    `View helpers turned ${event.payload.enabled ? 'on' : 'off'} for this project.`,
  'visualization.view-candidates': (event) =>
    `The view helpers proposed ${event.payload.candidates.length} alternative views of ${event.payload.type}${event.payload.task ? ` for the task "${event.payload.task}"` : ''} that build and read (see viewHelpers).`
} satisfies ProjectEventCases<string>;

const conversationCases = {
  'project.created': () => [],
  'project.renamed': () => [],
  'operation.accepted': () => [],
  'operation.completed': () => [],
  'operation.failed': () => [],
  'feedback.submitted': (event) => [{ role: 'user', content: feedbackMessage(event) } as const],
  'assistant.turn-requested': () => [],
  'assistant.turn-started': () => [],
  'assistant.intake-completed': () => [],
  'visualization.candidates-advanced': () => [],
  'ai.generation-requested': () => [],
  'ai.generation-succeeded': () => [],
  'ai.generation-failed': () => [],
  'build.requested': () => [],
  'build.succeeded': () => [],
  'build.failed': () => [],
  'revision.edits-rejected': () => [],
  'artifact.version-created': () => [],
  'visualization.presented': () => [],
  // Reported by the participant's browser, not written by them; the next revision should fix it.
  'visualization.runtime-failed': (event) => [
    {
      role: 'user',
      content: `[Reported automatically by the participant’s browser, not written by the participant] ${runtimeFailureText(event)} Fix the view so that every step draws.`
    } as const
  ],
  // A variant's failure, already shown as before, is not the source's to fix.
  'visualization.variant-reverted': () => [],
  'visualization.loaded': () => [],
  // Written with its pair's differences, which need the presentations (projectConversationMessages).
  'visualization.preference-recorded': () => [],
  'assistant.responded': (event) => [
    {
      role: 'assistant',
      content: `${event.payload.inReplyTo?.length ? `[In reply to interaction events ${event.payload.inReplyTo.join(', ')}]\n` : ''}${plainMessageText(event.payload.content)}`
    } as const
  ],
  'system.notified': () => [],
  'project.view-helpers-set': () => [],
  'visualization.view-candidates': () => []
} satisfies ProjectEventCases<ConversationMessage[]>;

/** Project one immutable event into the AI's compact, body-free timeline index. */
export function projectAiTimelineEntry(event: ProjectEvent): AiTimelineEntry {
  return {
    id: event.id,
    type: event.type,
    actor: event.actor,
    createdAt: event.createdAt,
    operationId: event.operationId,
    summary: matchProjectEvent(event, timelineCases)
  };
}

/** Project event history into conversational user and assistant messages. */
export function projectConversationMessages(
  events: readonly ProjectEvent[]
): ConversationMessage[] {
  const variants = presentedVariants(events);
  const questions = presentedQuestions(events);
  // A failure its variant caused asks for no fix of the source (see visualization.variant-reverted).
  const reverted = new Set(
    events.flatMap((event) =>
      event.type === 'visualization.variant-reverted' ? [event.payload.presentationId] : []
    )
  );
  const asked = new Map(projectQuestions(events).map((question) => [question.eventId, question]));
  return events.flatMap((event): ConversationMessage[] => {
    if (event.type === 'visualization.preference-recorded')
      return [{ role: 'user', content: preferenceMessage(event, variants, questions) }];
    if (event.type === 'visualization.runtime-failed' && reverted.has(event.payload.presentationId))
      return [];
    const messages =
      event.type === 'feedback.submitted'
        ? [{ role: 'user' as const, content: feedbackMessage(event, questions, variants) }]
        : matchProjectEvent<ConversationMessage[]>(event, conversationCases);
    // A held question is read with its reply as held, and asked where the application asks it.
    const held = event.type === 'assistant.responded' ? event.payload.heldQuestion : undefined;
    if (held)
      return messages.map((message) => ({
        ...message,
        content: `${message.content}\n[Held until its comparisons are answered: “${held.text}”]`
      }));
    if (event.type === 'assistant.responded' && event.payload.releases)
      return [
        {
          role: 'assistant',
          content: `[Your held question, asked now: “${event.payload.question?.text ?? ''}”]`
        }
      ];
    // A question is read with its reply, and an answer with its question.
    const question =
      event.type === 'assistant.responded'
        ? asked.get(event.id)
        : event.type === 'feedback.submitted' && event.payload.answers
          ? asked.get(event.payload.answers)
          : undefined;
    if (!question) return messages;
    return messages.map((message) => ({
      ...message,
      content:
        event.type === 'assistant.responded'
          ? `${message.content}\n[Asked: ${questionText(question)}]`
          : `[Answering your question “${question.text}”] ${message.content}`
    }));
  });
}

/** The assistant's latest question, not a comparison's, and where it stands. */
function latestQuestion(events: readonly ProjectEvent[]): Pick<AiProjectContext, 'question'> {
  const held = heldQuestion(events)?.payload.heldQuestion;
  if (held) return { question: { text: held.text, status: 'held' } };
  const latest = projectQuestions(events).findLast(({ kind }) => kind !== 'pair');
  return latest
    ? { question: { text: latest.text, status: latest.answer ? 'answered' : 'shown' } }
    : {};
}

/** A question as the assistant asked it, with what it is about. */
function questionText(question: ProjectQuestion): string {
  const about = question.presentationIds[0]
    ? ` (about presentation ${question.presentationIds[0]}${question.elements?.length ? `, elements ${question.elements.join(', ')}` : ''})`
    : '';
  return `“${question.text}”${about}`;
}

/** Each presented presentation's variant, by its id. */
function presentedVariants(events: readonly ProjectEvent[]): Map<string, DesignValues> {
  const variants = new Map<string, DesignValues>();
  for (const event of events)
    if (
      event.type === 'visualization.presented' &&
      event.payload.presentation.format === 'browser-bundle-v1' &&
      event.payload.presentation.variant
    )
      variants.set(event.payload.presentation.presentationId, event.payload.presentation.variant);
  return variants;
}

/** The variables two variants give different values, in key order. */
export function variantDifferences(
  preferred: DesignValues | undefined,
  other: DesignValues | undefined
): VariantDifference[] {
  if (!preferred || !other) return [];
  return [...new Set([...Object.keys(preferred), ...Object.keys(other)])]
    .filter((variable) => preferred[variable] !== other[variable])
    .sort()
    .map((variable) => ({
      variable: designKeys.written(variable, (key) => key in preferred || key in other),
      ...(variable in preferred ? { preferred: preferred[variable] } : {}),
      ...(variable in other ? { other: other[variable] } : {})
    }));
}

// A preference names at most this many differences in the conversation, the rest counted.
const namedDifferences = 12;

/**
 * The question a presentation's pair asked, what the participant would call its side, its display
 * set, and the steps at which the pair draws differently, with the steps' names.
 */
type PresentedQuestion = {
  question: string;
  label?: string;
  displaySetId: string;
  differsAt?: readonly number[];
  stepNames: readonly string[];
};

/** The question each presentation's pair asked, by its id, for an assistant's comparisons. */
function presentedQuestions(events: readonly ProjectEvent[]): Map<string, PresentedQuestion> {
  return new Map(
    events.flatMap((event) =>
      event.type === 'visualization.presented' && event.payload.question
        ? [
            [
              event.payload.presentation.presentationId,
              {
                question: event.payload.question,
                ...(event.payload.label ? { label: event.payload.label } : {}),
                displaySetId: event.payload.displaySetId,
                ...(event.payload.differsAt ? { differsAt: event.payload.differsAt } : {}),
                stepNames: presentationStepLabels(event.payload.presentation)
              }
            ] as const
          ]
        : []
    )
  );
}

/** A preference as the participant's message, with what its pair differed in. */
function preferenceMessage(
  event: Extract<ProjectEvent, { type: 'visualization.preference-recorded' }>,
  variants: ReadonlyMap<string, DesignValues>,
  questions: ReadonlyMap<string, PresentedQuestion>
): string {
  const outcome = comparisonOutcome(event.payload);
  const preferred = preferredPresentation(event.payload) ?? event.payload.presentations[0];
  const other = event.payload.presentations.find((id) => id !== preferred);
  const differences = variantDifferences(
    variants.get(preferred),
    other ? variants.get(other) : undefined
  );
  const named = differences
    .slice(0, namedDifferences)
    .map(({ variable, preferred, other }) =>
      outcome === 'preferred'
        ? `${variable} ${String(preferred ?? 'unset')} (the other: ${String(other ?? 'unset')})`
        : `${variable} ${String(preferred ?? 'unset')} or ${String(other ?? 'unset')}`
    );
  const more = differences.length - named.length;
  const differed = named.length
    ? ` They differed in ${named.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`
    : '';
  // A comparison's answer, as the preferred side's label: “Cells or tallies?” → tallies.
  const { question, label } = questions.get(preferred) ?? {};
  const where = `${event.payload.displaySetId ? ` in display set ${event.payload.displaySetId}` : ''} at step ${event.payload.step}`;
  const commented = event.payload.comment
    ? `\nWith this choice I wrote: ${plainMessageText(event.payload.comment)}`
    : '';
  if (outcome !== 'preferred') {
    const said = outcome === 'tie' ? 'either is fine' : 'unsure';
    const meaning =
      outcome === 'tie'
        ? 'I find the two equally good, so this choice does not matter to me.'
        : 'I am unsure which I prefer; ask it again another time, perhaps in other words.';
    return `${question ? `${question} → ${said}. ` : ''}${meaning} (Presentations ${preferred} and ${other ?? 'the alternative'}${where}.)${differed}${commented}`;
  }
  const answer = question ? `${question} → ${label ?? 'the presentation preferred'}. ` : '';
  return `${answer}I preferred presentation ${preferred} over the alternative${where}.${differed}${commented}`;
}

/** Build the pure, explicitly bounded project context supplied to the AI assistant. */
export function projectAiContext(
  document: ProjectDocument,
  selection: AiContextSelection = { eventIds: [] }
): AiProjectContext {
  const snapshot = projectSnapshotAt(document);
  const interaction = assistantInteraction(document, selection.interactionEventIds ?? []);
  // Load reports are diagnostics for developers, not part of the project's story.
  const events = document.events.filter(({ type }) => type !== 'visualization.loaded');
  const timelineEvents = events.slice(-recentTimelineEventLimit);
  const asked = presentedQuestions(document.events);
  const waiting = waitingComparisons(document).map(({ question, presentationIds: [first] }) => {
    const differs = differencesText(asked.get(first ?? ''));
    return differs ? `${question} (${differs})` : question;
  });
  const base = projectWorkspace(snapshot);
  const entry = base.artifacts.find(({ artifactId }) => artifactId === base.entryArtifactId);
  const { runs, structures } = entry ? sourceBuildFacts(document, entry.sha256) : {};
  // A mode with a design space describes it (see modes/assistants.server.ts); none has an empty one.
  const assistant = modeAssistants[snapshot.mode];
  const design = assistant.design?.variables(
    viewedPresentation(document, selection.interactionEventIds ?? []),
    structures
  ) ?? { options: {}, variables: [] };
  const brief = projectBrief(document.events);
  const preferences = preferenceSummary(document.events, design, briefSteering(brief));

  return {
    projectId: document.projectId,
    title: snapshot.title,
    headEventId: events.at(-1)?.id ?? projectHead(document).id,
    base,
    versions: sourceVersions(document),
    design: assistant.design?.context(design) ?? { options: {}, variables: [], values: {} },
    ...(runs
      ? {
          spans: Object.fromEntries(
            Object.entries(runs).map(([label, { runs: spans, drawn }]) => [label, { spans, drawn }])
          )
        }
      : {}),
    activePresentations: activePresentationSummaries(snapshot),
    interaction,
    ...(waiting.length ? { waitingComparisons: waiting } : {}),
    ...latestQuestion(document.events),
    ...(preferences ? { preferences } : {}),
    brief: briefContext(
      brief,
      openChoices(document.events, design),
      conversationState(document.events)
    ),
    timelineWindow: {
      totalEventCount: events.length,
      omittedEventCount: events.length - timelineEvents.length
    },
    // What interfaceParts says of the controls is not repeated here: only how they bear on authoring
    // and on reading the participant's messages.
    interfaceCapabilities: [
      'The application owns the step controls; never draw replacement controls inside a visualization.',
      'A participant’s message starts with a note of what was on screen when they sent it, as (viewing presentation id at step 3, @insert.swap#1) or (comparing … with …; your comparison “…”; they differ in …): the number they saw in that presentation and the step’s name, as recordedSteps name it, and for a pair, your question and the values its two sides differ in, so you know which pair the message is about. It says where they were, not something they pointed at; a reference in their words, as [Presentation id at @insert.swap#1 (step 3)], is one they made.',
      ...(assistant.interfaceCapabilities ?? [])
    ],
    interfaceParts: interfacePartsFor(snapshot.mode),
    timeline: timelineEvents.map(projectAiTimelineEntry),
    selected: {
      events: selection.eventIds.map((id) => eventDetail(document, id)),
      presentations: (selection.presentationIds ?? []).map((id) =>
        selectedPresentation(document, id, design)
      ),
      elements: (selection.elements ?? []).flatMap((reference) =>
        selectedElement(document, reference)
      )
    }
  };
}

function assistantInteraction(
  document: ProjectDocument,
  eventIds: readonly EventId[]
): AiInteraction {
  const interactions = eventIds.map((id) => {
    const event = document.events[id - 1];
    if (
      event?.type !== 'feedback.submitted' &&
      event?.type !== 'visualization.preference-recorded' &&
      event?.type !== 'visualization.runtime-failed' &&
      event?.type !== 'visualization.view-candidates'
    ) {
      throw new Error('The assistant turn references an unknown interaction event.');
    }
    return event;
  });
  const variants = presentedVariants(document.events);
  const questions = presentedQuestions(document.events);
  const preferences = interactions.flatMap((event) => {
    if (event.type !== 'visualization.preference-recorded') return [];
    const outcome = comparisonOutcome(event.payload);
    const preferred = preferredPresentation(event.payload) ?? event.payload.presentations[0];
    const alternativePresentationId = event.payload.presentations.find((id) => id !== preferred);
    if (!alternativePresentationId) {
      throw new Error('The preference interaction has no alternative presentation.');
    }
    const { question, label } = questions.get(preferred) ?? {};
    const differs = differencesText(questions.get(preferred));
    return [
      {
        ...(question ? { question } : {}),
        ...(label && outcome === 'preferred' ? { answer: label } : {}),
        ...(outcome === 'preferred' ? {} : { outcome }),
        ...(differs ? { differsAt: differs } : {}),
        ...(event.payload.comment ? { comment: plainMessageText(event.payload.comment) } : {}),
        eventId: event.id,
        preferredPresentationId: preferred,
        alternativePresentationId,
        step: event.payload.step,
        differences: variantDifferences(
          variants.get(preferred),
          variants.get(alternativePresentationId)
        )
      }
    ];
  });
  if (interactions.length === 1 && preferences[0]) {
    return { kind: 'preference', ...preferences[0] };
  }
  if (interactions.length === 1 && interactions[0].type === 'visualization.runtime-failed') {
    return { kind: 'runtime-failure', eventId: interactions[0].id };
  }
  if (interactions.length === 1 && interactions[0].type === 'visualization.view-candidates') {
    return { kind: 'view-helpers', eventId: interactions[0].id };
  }
  if (interactions.length <= 1) return { kind: 'feedback', eventIds: [...eventIds] };
  return { kind: 'batch', eventIds: [...eventIds], preferences };
}

function selectedPresentation(
  document: ProjectDocument,
  id: string,
  viewed: AiDesign
): AiSelectedPresentation {
  for (const event of document.events) {
    if (
      event.type === 'visualization.presented' &&
      event.payload.presentation.presentationId === id
    ) {
      const presentation = event.payload.presentation;
      const current = new Map(viewed.variables.map(({ variable, value }) => [variable, value]));
      const differs =
        presentation.format === 'browser-bundle-v1' && presentation.variant
          ? Object.fromEntries(
              Object.entries(presentation.variant).filter(
                ([key, value]) => current.get(key) !== value
              )
            )
          : undefined;
      return {
        ...presentationSummary(event),
        displaySetId: event.payload.displaySetId,
        format: presentation.format,
        steps: presentationStepLabels(presentation).map((label) => ({ label })),
        ...(differs && Object.keys(differs).length
          ? { differs: designKeys.writtenNested(differs) }
          : {})
      };
    }
  }
  throw new Error(`Unknown selected presentation ${id}.`);
}

function selectedElement(
  document: ProjectDocument,
  reference: ElementReference
): AiSelectedElement[] {
  const event = document.events.find(
    (candidate) =>
      candidate.type === 'visualization.presented' &&
      candidate.payload.presentation.presentationId === reference.presentationId
  );
  if (event?.type !== 'visualization.presented') return [];
  const presentation = event.payload.presentation;
  if (presentation.format !== 'browser-bundle-v1') return [];
  const locate = modeBuilders[presentation.mode]?.locateElement;
  const source = locate?.(presentation.source.text, reference.element.id);
  if (!source) return [];
  return [
    {
      presentationId: reference.presentationId,
      step: reference.step,
      stepLabel: presentationStepLabels(presentation)[reference.step] ?? '',
      elementId: reference.element.id,
      label: reference.element.label,
      source,
      layouts: (reference.element.layouts ?? []).map(({ seed, ...layout }) => {
        const located = locate?.(presentation.source.text, layout.node);
        return { ...layout, layoutSeed: seed, ...(located ? { source: located } : {}) };
      })
    }
  ];
}

function eventDetail(document: ProjectDocument, id: EventId): AiEventDetail {
  const event = document.events[id - 1];
  if (!event) throw new Error(`Unknown selected event ${id}.`);
  const snapshot = projectSnapshotAt(document, id);
  return {
    event,
    workspace: projectWorkspace(snapshot),
    activePresentations: activePresentationSummaries(snapshot)
  };
}

/** The hash of the source a version made of the entry artifact, the first artifact it changes. */
function entryHash(event: ProjectEventOf<'artifact.version-created'>): string | undefined {
  const change = event.payload.changes.find(({ operation }) => operation === 'upsert');
  return change?.operation === 'upsert' ? change.artifact.content.sha256 : undefined;
}

/**
 * The source's versions, once each: a version that brings back an earlier source, to build on it,
 * is that earlier version. Each names the version it was made from.
 */
function sourceVersions(document: ProjectDocument): AiSourceVersion[] {
  const hashes = new Map<EventId, string>();
  const versions = new Map<string, AiSourceVersion>();
  for (const event of document.events) {
    if (event.type !== 'artifact.version-created') continue;
    const hash = entryHash(event);
    if (!hash) continue;
    hashes.set(event.id, hash);
    if (versions.has(hash)) continue;
    const parent = event.payload.parent ? hashes.get(event.payload.parent) : undefined;
    versions.set(hash, {
      id: hash.slice(0, 6),
      eventId: event.id,
      ...(parent && parent !== hash ? { parent: parent.slice(0, 6) } : {}),
      madeBy: event.payload.origin.kind,
      ...(event.payload.summary ? { summary: event.payload.summary } : {})
    });
  }
  return [...versions.values()];
}

/** A source's runs and structures, from its newest successful build, which every variant shares. */
export function sourceBuildFacts(document: ProjectDocument, sha256: string): SourceBuildFacts {
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
  const bundle = JSON.parse(built.payload.bundle.text) as SourceBuildFacts;
  return {
    ...(bundle.runs ? { runs: bundle.runs } : {}),
    ...(bundle.structures ? { structures: bundle.structures } : {})
  };
}

function projectWorkspace(snapshot: ProjectSnapshot): AiWorkspace {
  return {
    entryArtifactId: snapshot.entryArtifactId,
    artifacts: Object.values(snapshot.artifacts).map((artifact) => ({
      artifactId: artifact.artifactId,
      path: artifact.path,
      language: artifact.language,
      source: artifact.content.text,
      sha256: artifact.content.sha256
    }))
  };
}

function runtimeFailureText(event: ProjectEventOf<'visualization.runtime-failed'>): string {
  const { presentationId, step, message } = event.payload;
  return `Presentation ${presentationId} failed while drawing ${step === undefined ? 'a step' : `step ${step + 1}`}: ${message}`;
}

function feedbackMessage(
  event: ProjectEventOf<'feedback.submitted'>,
  questions: ReadonlyMap<string, PresentedQuestion> = new Map(),
  variants: ReadonlyMap<string, DesignValues> = new Map()
): string {
  const { viewing } = event.payload;
  const said = plainMessageText(event.payload.content);
  const details = [viewing ? `${viewingNote(viewing, questions, variants)}\n${said}` : said];
  if (event.payload.focus.length > 0) {
    details.push(`Focused timeline events: ${event.payload.focus.join(', ')}`);
  }
  return details.filter(Boolean).join('\n\n');
}

/**
 * What was on screen when a message was sent, as the note before it; for one of the assistant's
 * comparisons, with its question and the steps at which its two sides draw differently; for any
 * pair, the values its two sides differ in, so a message about the pair says which pair it was.
 */
function viewingNote(
  viewing: FeedbackViewing,
  questions: ReadonlyMap<string, PresentedQuestion>,
  variants: ReadonlyMap<string, DesignValues>
): string {
  if ('source' in viewing) return `(viewing source ${viewing.source} on its own)`;
  const [first, second] = viewing.presentations.map(
    ({ presentationId, step, stepName }) =>
      `presentation ${presentationId}${step === undefined ? '' : ` at step ${step + 1}${stepName ? `, ${stepName}` : ''}`}`
  );
  if (!second) return `(viewing ${first})`;
  const [left, right] = viewing.presentations.map(({ presentationId }) =>
    questions.get(presentationId)
  );
  const comparison = left && left.displaySetId === right?.displaySetId ? left : undefined;
  const [firstId, secondId] = viewing.presentations.map(({ presentationId }) => presentationId);
  const values = variantDifferences(variants.get(firstId), variants.get(secondId))
    .slice(0, namedDifferences)
    .map(
      ({ variable, preferred, other }) =>
        `${variable} ${String(preferred ?? 'unset')} or ${String(other ?? 'unset')}`
    );
  const notes = [
    comparison && `your comparison “${comparison.question}”`,
    values.length && `they differ in ${values.join('; ')}`,
    differencesText(comparison)
  ].filter(Boolean);
  return `(comparing ${first} with ${second}${notes.length ? `; ${notes.join('; ')}` : ''})`;
}

/**
 * Where a comparison's two sides draw differently, as the server laid them out, each run of steps
 * with its first and last step's names: “the two draw differently only at steps 3–9 (@a#1 to
 * @b#2), alike at every other step”. None where the server did not lay them out.
 */
function differencesText(asked: PresentedQuestion | undefined): string | undefined {
  if (!asked?.differsAt) return undefined;
  if (!asked.differsAt.length) return 'the two draw the same at every step';
  const named = (step: number) => asked.stepNames[step] ?? `step ${step + 1}`;
  const runs = stepRuns(asked.differsAt).map(([first, last]) =>
    first === last
      ? `${first + 1} (${named(first)})`
      : `${first + 1}–${last + 1} (${named(first)} to ${named(last)})`
  );
  const several = asked.differsAt.length > 1;
  const all = asked.differsAt.length === asked.stepNames.length;
  return all
    ? 'the two draw differently at every step'
    : `the two draw differently only at step${several ? 's' : ''} ${new Intl.ListFormat('en', { type: 'conjunction' }).format(runs)}, alike at every other step`;
}

/** A shown presentation, as the assistant is told of it. */
export function presentationSummary(
  event: ProjectEventOf<'visualization.presented'>
): AiPresentationSummary {
  const presentation = event.payload.presentation;
  const scripted = presentation.format === 'browser-bundle-v1';
  return {
    eventId: event.id,
    presentationId: presentation.presentationId,
    ...(scripted ? { seed: presentation.seed } : {}),
    sourceSha256: (scripted ? presentation.source : presentation.authored).sha256,
    contentSha256: (scripted ? presentation.javascript : presentation.rendered).sha256,
    ...(scripted && presentation.readability
      ? { readability: readabilityText(presentation.readability) }
      : {}),
    ...(scripted && presentation.arrangements?.length
      ? { arrangements: arrangementsText(presentation.arrangements) }
      : {}),
    ...(scripted && presentation.warnings?.length ? { warnings: presentation.warnings } : {}),
    ...(scripted && presentation.drawing ? { drawing: presentation.drawing } : {})
  };
}

function activePresentationSummaries(snapshot: ProjectSnapshot): AiPresentationSummary[] {
  return (snapshot.activePresentationSet?.presentations ?? []).map(presentationSummary);
}

function shortHash(sha256: string): string {
  return sha256.slice(0, 12);
}

/**
 * The presentation the participant was viewing when they started a turn: the one their feedback
 * was given on, the one they preferred, or the one that failed; otherwise the newest presentation of
 * the newest source.
 */
export function viewedPresentation(
  document: ProjectDocument,
  interactionEventIds: readonly EventId[]
): BrowserBundlePresentation | undefined {
  const viewed = interactionEventIds
    .flatMap((id) => {
      const event = document.events.find((candidate) => candidate.id === id);
      if (event?.type === 'feedback.submitted') return event.payload.from ?? [];
      if (event?.type === 'visualization.preference-recorded')
        return [preferredPresentation(event.payload) ?? event.payload.presentations[0]];
      if (event?.type === 'visualization.runtime-failed') return [event.payload.presentationId];
      return [];
    })
    .at(-1);
  const snapshot = projectSnapshotAt(document);
  const source = snapshot.artifacts[snapshot.entryArtifactId]?.content.sha256;
  const presented = document.events.findLast(
    (event) =>
      event.type === 'visualization.presented' &&
      (viewed
        ? event.payload.presentation.presentationId === viewed
        : event.payload.presentation.format === 'browser-bundle-v1' &&
          event.payload.presentation.source.sha256 === source)
  );
  return presented?.type === 'visualization.presented' &&
    presented.payload.presentation.format === 'browser-bundle-v1'
    ? presented.payload.presentation
    : undefined;
}
