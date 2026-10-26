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
  listingPropOptions,
  overflowOptions,
  propOptions
} from '$lib/modes/sverlin/library/node/design';

type DesignValue = string | number | boolean;
import { projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import type { ConversationMessage } from '$lib/server/chat-bots/types';

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
   * The constraint layouts around the element: the one placing it and the one placing its children.
   * Each gives the arranging node (its tag in the source), the seed its layout drew from, and what
   * it drew; setting that node's layoutSeed to the seed keeps the layout in every presentation.
   */
  layouts: Array<{
    node: string;
    source?: ElementLocation;
    seed: number;
    form?: string;
    curve?: string;
  }>;
  /** For a link, the curve it drew; setting bend on its <Link> to this value keeps that curve. */
  bend?: number;
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
  activePresentations: AiPresentationSummary[];
  interfaceCapabilities: string[];
  interaction: AiInteraction;
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
    `Rejected the edits of generation attempt ${event.payload.attempt}: ${event.payload.problems.join(' ')}`,
  'artifact.version-created': (event) => {
    const id = entryHash(event);
    return `Created ${event.payload.origin.kind} source version${id ? ` ${id.slice(0, 6)}` : ''}${event.payload.summary ? `: ${event.payload.summary}` : ''}.`;
  },
  'visualization.presented': (event) =>
    `Presented ${event.payload.presentation.format} visualization ${event.payload.presentation.presentationId} in display set ${event.payload.displaySetId}.`,
  'visualization.preference-recorded': (event) =>
    `Preferred presentation ${event.payload.preferred} over ${event.payload.presentations.find((id) => id !== event.payload.preferred) ?? 'the alternative'} at step ${event.payload.step}.`,
  'visualization.runtime-failed': (event) => runtimeFailureText(event),
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
  return events.flatMap((event) =>
    event.type === 'visualization.preference-recorded'
      ? [{ role: 'user', content: preferenceMessage(event, variants) } as const]
      : matchProjectEvent<ConversationMessage[]>(event, conversationCases)
  );
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

/** A preference as the participant's message, with what its pair differed in. */
function preferenceMessage(
  event: Extract<ProjectEvent, { type: 'visualization.preference-recorded' }>,
  variants: ReadonlyMap<string, DesignValues>
): string {
  const other = event.payload.presentations.find((id) => id !== event.payload.preferred);
  const differences = variantDifferences(
    variants.get(event.payload.preferred),
    other ? variants.get(other) : undefined
  );
  const named = differences
    .slice(0, namedDifferences)
    .map(
      ({ variable, preferred, other }) =>
        `${variable} ${String(preferred ?? 'unset')} (the other: ${String(other ?? 'unset')})`
    );
  const more = differences.length - named.length;
  const differed = named.length
    ? ` They differed in ${named.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`
    : '';
  return `I preferred presentation ${event.payload.preferred} over the alternative${event.payload.displaySetId ? ` in display set ${event.payload.displaySetId}` : ''} at step ${event.payload.step}.${differed}`;
}

/** Build the pure, explicitly bounded project context supplied to the AI assistant. */
export function projectAiContext(
  document: ProjectDocument,
  selection: AiContextSelection = { eventIds: [] }
): AiProjectContext {
  const snapshot = projectSnapshotAt(document);
  const interaction = assistantInteraction(document, selection.interactionEventIds ?? []);
  const timelineEvents = document.events.slice(-recentTimelineEventLimit);

  return {
    projectId: document.projectId,
    title: snapshot.title,
    headEventId: projectHead(document).id,
    base: projectWorkspace(snapshot),
    versions: sourceVersions(document),
    design: designVariables(viewedPresentation(document, selection.interactionEventIds ?? [])),
    activePresentations: activePresentationSummaries(snapshot),
    interaction,
    timelineWindow: {
      totalEventCount: document.events.length,
      omittedEventCount: document.events.length - timelineEvents.length
    },
    interfaceCapabilities: [
      'The application owns previous/next step playback controls; never draw replacement controls inside a visualization.',
      'The participant can select compatible retained Sverlin presentations to compare a pair.',
      'A visible pair has preference controls; participants can reference retained presentations inline in messages.',
      'A message viewing a presentation names the step the participant was on, as [Presentation id at @insert.swap#1 (step 3)]: its name, as recordedSteps name it, and the number the participant saw in that presentation.',
      'Participants can select elements of a Sverlin presentation and reference them in messages; selected.elements traces each to the <Node> tag that drew it.',
      'Sverlin projects may keep another pair generated ahead of time; ordinary conversation does not advance the visible pair.'
    ],
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
  const preferences = interactions.flatMap((event) => {
    if (event.type !== 'visualization.preference-recorded') return [];
    const alternativePresentationId = event.payload.presentations.find(
      (id) => id !== event.payload.preferred
    );
    if (!alternativePresentationId) {
      throw new Error('The preference interaction has no alternative presentation.');
    }
    return [
      {
        eventId: event.id,
        preferredPresentationId: event.payload.preferred,
        alternativePresentationId,
        step: event.payload.step,
        differences: variantDifferences(
          variants.get(event.payload.preferred),
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
      ...(reference.element.bend !== undefined ? { bend: reference.element.bend } : {}),
      layouts: (reference.element.layouts ?? []).map((layout) => {
        const located = locateElement(presentation.source.text, layout.node);
        return { ...layout, ...(located ? { source: located } : {}) };
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

function feedbackMessage(event: ProjectEventOf<'feedback.submitted'>): string {
  const details = [plainMessageText(event.payload.content)];
  if (event.payload.focus.length > 0) {
    details.push(`Focused timeline events: ${event.payload.focus.join(', ')}`);
  }
  return details.filter(Boolean).join('\n\n');
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
    contentSha256: (scripted ? presentation.javascript : presentation.rendered).sha256
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
      if (event?.type === 'feedback.submitted') return event.payload.viewing ?? [];
      if (event?.type === 'visualization.preference-recorded') return [event.payload.preferred];
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
      key.startsWith('frame.') || key === 'listing.language'
        ? key
        : key.slice(key.lastIndexOf('.') + 1);
    // A pointer's overflow and a collection's have options of their own, as does a listing's
    // text colour, which can keep the listing's ink.
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
