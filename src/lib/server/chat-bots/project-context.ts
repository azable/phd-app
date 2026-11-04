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
import { locateElement, type ElementLocation } from '$lib/modes/sverlin/element-ref';
import type { ProjectDocument, ProjectSnapshot } from '$lib/shared/projects/model';
import type {
  BrowserBundlePresentation,
  DesignValues,
  RenderablePresentation
} from '$lib/shared/presentations';
import { presentationStepLabels } from '$lib/shared/presentations';
import {
  frameOptions,
  listingOptions,
  listingPlacesOptions,
  listingPropOptions,
  overflowOptions,
  propOptions
} from '$lib/modes/sverlin/library/node/design';

type DesignValue = string | number | boolean;
import { projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import { waitingComparisons } from '$lib/shared/projects/presentation-buffer';
import { stepRuns } from '$lib/shared/differing-steps';
import { readabilityText } from '$lib/shared/readability';
import { interfacePartsFor, type InterfacePartId } from '$lib/shared/interface-parts';
import type { ConversationMessage } from '$lib/server/chat-bots/types';
import { projectQuestions, type ProjectQuestion } from '$lib/shared/projects/questions';

import { projectBrief } from '$lib/shared/projects/brief';

import { briefContext, briefSteering, conversationState, type AiBrief } from './brief-context';
import { openChoices, preferenceSummary, type AiPreferences } from './preference-summary';

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
};

/** A label's runs, and how many of them change what the view draws (compile.server.ts LabelRuns). */
export type AiLabelRuns = { runs: number; drawn: number };

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
      }>;
    };

/** Compact retained presentation explicitly visible when the user submitted feedback. */
export type AiSelectedPresentation = AiPresentationSummary & {
  displaySetId?: string;
  format: RenderablePresentation['format'];
  steps: Array<{ label: string }>;
  /** Its variant: every variable of its design space, by key. */
  variant?: Record<string, DesignValue>;
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
   * no presentation of the base recorded its variant.
   */
  design: AiDesign;
  /**
   * Each label of the base, by name: how many times it runs, and how many of those runs change what
   * the view draws (drawn), from its newest successful build.
   */
  runs?: Record<string, AiLabelRuns>;
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
    `Rejected the ${event.payload.rejected ?? 'edits'} of generation attempt ${event.payload.attempt}: ${event.payload.problems.join(' ')}${event.payload.kept ? ` Built only comparison${event.payload.kept.length > 1 ? 's' : ''} ${event.payload.kept.join(', ')}.` : ''}`,
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
    `Presentation ${event.payload.presentationId} failed with its variant's values ${JSON.stringify(event.payload.values)}, though its source draws without them; shown instead with ${JSON.stringify(event.payload.shown)} as ${event.payload.replacements.join(', ')}. Nothing in the source needs fixing.`,
  // Left out of the index (projectAiContext).
  'visualization.loaded': (event) => `Presentation ${event.payload.presentationId} loaded.`,
  'assistant.responded': () => 'Assistant responded to the user.',
  'system.notified': (event) => `System ${event.payload.severity}: ${event.payload.message}`
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
  'system.notified': () => []
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
        ? [{ role: 'user' as const, content: feedbackMessage(event, questions) }]
        : matchProjectEvent<ConversationMessage[]>(event, conversationCases);
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
      variable,
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
  if (outcome !== 'preferred') {
    const said = outcome === 'tie' ? 'either is fine' : 'unsure';
    const meaning =
      outcome === 'tie'
        ? 'I find the two equally good, so this choice does not matter to me.'
        : 'I am unsure which I prefer; ask it again another time, perhaps in other words.';
    return `${question ? `${question} → ${said}. ` : ''}${meaning} (Presentations ${preferred} and ${other ?? 'the alternative'}${where}.)${differed}`;
  }
  const answer = question ? `${question} → ${label ?? 'the presentation preferred'}. ` : '';
  return `${answer}I preferred presentation ${preferred} over the alternative${where}.${differed}`;
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
  const design = designVariables(viewedPresentation(document, selection.interactionEventIds ?? []));
  const brief = projectBrief(document.events);
  const preferences = preferenceSummary(document.events, design, briefSteering(brief));
  const base = projectWorkspace(snapshot);
  const entry = base.artifacts.find(({ artifactId }) => artifactId === base.entryArtifactId);
  const { runs } = entry ? sourceBuildFacts(document, entry.sha256) : {};

  return {
    projectId: document.projectId,
    title: snapshot.title,
    headEventId: events.at(-1)?.id ?? projectHead(document).id,
    base,
    versions: sourceVersions(document),
    design,
    ...(runs ? { runs } : {}),
    activePresentations: activePresentationSummaries(snapshot),
    interaction,
    ...(waiting.length ? { waitingComparisons: waiting } : {}),
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
      'A participant’s message starts with a note of what was on screen when they sent it, as (viewing presentation id at step 3, @insert.swap#1) or (comparing … with …): the number they saw in that presentation and the step’s name, as recordedSteps name it. It says where they were, not something they pointed at; a reference in their words, as [Presentation id at @insert.swap#1 (step 3)], is one they made.',
      ...(snapshot.mode === 'sverlin'
        ? [
            'selected.elements traces each element a participant referenced to the <Node> tag that drew it.',
            'A project may keep another pair generated ahead of time; ordinary conversation does not advance the visible pair.'
          ]
        : [])
    ],
    interfaceParts: interfacePartsFor(snapshot.mode),
    timeline: timelineEvents.map(projectAiTimelineEntry),
    selected: {
      events: selection.eventIds.map((id) => eventDetail(document, id)),
      presentations: (selection.presentationIds ?? []).map((id) =>
        selectedPresentation(document, id)
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
      event?.type !== 'visualization.runtime-failed'
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
  if (interactions.length <= 1) return { kind: 'feedback', eventIds: [...eventIds] };
  return { kind: 'batch', eventIds: [...eventIds], preferences };
}

function selectedPresentation(document: ProjectDocument, id: string): AiSelectedPresentation {
  for (const event of document.events) {
    if (
      event.type === 'visualization.presented' &&
      event.payload.presentation.presentationId === id
    ) {
      const presentation = event.payload.presentation;
      return {
        ...presentationSummary(event),
        displaySetId: event.payload.displaySetId,
        format: presentation.format,
        steps: presentationStepLabels(presentation).map((label) => ({ label })),
        ...(presentation.format === 'browser-bundle-v1' && presentation.variant
          ? { variant: presentation.variant }
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
  const source = locateElement(presentation.source.text, reference.element.id);
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
        const located = locateElement(presentation.source.text, layout.node);
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
  questions: ReadonlyMap<string, PresentedQuestion> = new Map()
): string {
  const { viewing } = event.payload;
  const said = plainMessageText(event.payload.content);
  const details = [viewing ? `${viewingNote(viewing, questions)}\n${said}` : said];
  if (event.payload.focus.length > 0) {
    details.push(`Focused timeline events: ${event.payload.focus.join(', ')}`);
  }
  return details.filter(Boolean).join('\n\n');
}

/**
 * What was on screen when a message was sent, as the note before it; for one of the assistant's
 * comparisons, with the steps at which its two sides draw differently.
 */
function viewingNote(
  viewing: FeedbackViewing,
  questions: ReadonlyMap<string, PresentedQuestion>
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
  const differs =
    left && left.displaySetId === right?.displaySetId ? differencesText(left) : undefined;
  return `(comparing ${first} with ${second}${differs ? `; ${differs}` : ''})`;
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

function presentationSummary(
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
      : {})
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

/** A presentation's design space and variant, each prop's options named once. */
export function designVariables(
  presentation:
    | Pick<BrowserBundlePresentation, 'variant' | 'origins' | 'views' | 'pointers' | 'listings'>
    | undefined
): AiDesign {
  const options: Record<string, readonly DesignValue[]> = {};
  const variables = Object.entries(presentation?.variant ?? {}).map(([key, value]): AiVariable => {
    const origin = presentation?.origins?.[key];
    // A place's own choice, as views.Int@swap.held or views.Ask.Int@g.a, has its type's options.
    const typeIn = (rest: string) => rest.split('@')[0].split('.').at(-1) ?? rest;
    const view = key.startsWith('views.') ? typeIn(key.slice('views.'.length)) : undefined;
    const pointer = key.startsWith('pointers.') ? typeIn(key.slice('pointers.'.length)) : undefined;
    const prop =
      key === 'listing.language' || key === 'listing.places'
        ? key
        : key.slice(key.lastIndexOf('.') + 1);
    // A pointer's overflow and a collection's have options of their own, as does a listing's text
    // colour, which can keep the listing's ink.
    const set =
      prop === 'overflow'
        ? (overflowOptions.pointer as readonly DesignValue[]).includes(value)
          ? 'overflow.pointer'
          : 'overflow.collection'
        : prop === 'color' && key.startsWith('listing.')
          ? 'listing.color'
          : prop;
    const known: Record<string, readonly DesignValue[]> = {
      ...propOptions,
      ...frameOptions,
      'listing.language': listingOptions['listing.language'],
      'listing.places': listingPlacesOptions,
      'listing.color': listingPropOptions('color') ?? [],
      'overflow.pointer': overflowOptions.pointer,
      'overflow.collection': overflowOptions.collection
    };
    if (!view && !pointer && Object.hasOwn(known, set)) options[set] = known[set];
    return {
      variable: key,
      options: view
        ? [...(presentation?.views?.[view] ?? []), 'none']
        : pointer
          ? [...(presentation?.pointers?.[pointer] ?? []), 'none']
          : key === 'listing.language' && presentation?.listings?.length
            ? [...presentation.listings, ...listingOptions['listing.language']]
            : set,
      value,
      ...(origin ? { origin } : {})
    };
  });
  return { options, variables };
}
