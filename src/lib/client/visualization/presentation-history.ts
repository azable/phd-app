/** Client-side projection of immutable visualization events into selectable presentations. */

import { SvelteMap } from 'svelte/reactivity';

import type { ProjectEvent } from '$lib/shared/projects/events';
import { presentationBufferState } from '$lib/shared/projects/presentation-buffer';
import {
  candidateId,
  fallbackPresentationName,
  type CandidateId
} from '$lib/shared/presentation-names';
import {
  isSverlinPresentation,
  presentationScenarioKey,
  type PresentationLayout,
  type RenderablePresentation
} from '$lib/shared/presentations';

export { candidateId, sourceId, type CandidateId } from '$lib/shared/presentation-names';

/** One presentation recorded in the Timeline, with its display-set context retained. */
export type TimelinePresentation = {
  eventId: number;
  eventType: 'visualization.presented';
  operationId: string;
  displaySetId?: string;
  slot: 0 | 1;
  presentation: RenderablePresentation;
  /** The question its pair asks, for an assistant's comparison. */
  question?: string;
  /** With a question, the steps at which its pair draws differently, where the server knew. */
  differsAt?: readonly number[];
};

// The identifiers of the project's candidates by presentation id, for labels that hold only an id.
const knownCandidates = new SvelteMap<string, CandidateId>();

/** Remember the identifiers of the presentations a project has shown. */
export function rememberCandidates(presentations: readonly TimelinePresentation[]): void {
  for (const { presentation } of presentations)
    if (!knownCandidates.has(presentation.presentationId))
      knownCandidates.set(presentation.presentationId, candidateId(presentation));
}

/** A presentation's identifier, if the project has shown it. */
export function knownCandidate(presentationId: string): CandidateId | undefined {
  return knownCandidates.get(presentationId);
}

/** A presentation's identifier as text, `<source>/<values>`. */
export function presentationDisplayId(presentationId: string): string {
  const known = knownCandidates.get(presentationId);
  return known ? `${known.source}/${known.values}` : fallbackPresentationName(presentationId);
}

/** Return every presentation in Timeline order. */
export function timelinePresentations(events: readonly ProjectEvent[]): TimelinePresentation[] {
  return events.flatMap<TimelinePresentation>((event): TimelinePresentation[] => {
    if (event.type === 'visualization.presented') {
      return [
        {
          eventId: event.id,
          eventType: 'visualization.presented',
          operationId: event.operationId,
          displaySetId: event.payload.displaySetId,
          slot: event.payload.slot,
          presentation: event.payload.presentation,
          ...(event.payload.question ? { question: event.payload.question } : {}),
          ...(event.payload.differsAt ? { differsAt: event.payload.differsAt } : {})
        }
      ];
    }
    return [];
  });
}

/** Return the most recently generated presentation or compatible comparison pair. */
export function latestPresentations(
  presentations: readonly TimelinePresentation[],
  layout: PresentationLayout
): TimelinePresentation[] {
  const latest = presentations.at(-1);
  if (!latest) return [];
  if (latest.presentation.format === 'html-frames-v1' && latest.displaySetId) {
    return presentations
      .filter(({ displaySetId }) => displaySetId === latest.displaySetId)
      .toSorted((left, right) => left.slot - right.slot)
      .slice(0, 1);
  }
  return presentationGroup(presentations, latest, layout);
}

/**
 * Return the newest generated set; where the newest operation presented several, as a vary or
 * resample with a count queues them, the first of them not yet consumed, so New pair, consuming it,
 * shows the next.
 */
export function newestPresentations(
  events: readonly ProjectEvent[],
  layout: PresentationLayout,
  answered: readonly string[] = []
): TimelinePresentation[] {
  const all = timelinePresentations(events);
  const latest = all.at(-1);
  if (!latest || !isSverlinPresentation(latest.presentation))
    return latestPresentations(all, layout);
  const made = all.filter(({ operationId }) => operationId === latest.operationId);
  if (new Set(made.map(({ displaySetId }) => displaySetId)).size < 2)
    return latestPresentations(all, layout);
  const available = new Set(
    presentationBufferState(events, 0, latest.presentation.source.sha256).available.map(
      ({ presentationId }) => presentationId
    )
  );
  const next = made.find(
    ({ presentation }) =>
      available.has(presentation.presentationId) && !answered.includes(presentation.presentationId)
  );
  return next ? presentationGroup(all, next, layout) : latestPresentations(all, layout);
}

/**
 * The one presentation under discussion: the first of the newest set that no comparison asked
 * about, as the assistant's change shows first, or else the newest.
 */
export function discussedPresentation(
  presentations: readonly TimelinePresentation[]
): TimelinePresentation[] {
  const latest = presentations.findLast(({ question }) => !question) ?? presentations.at(-1);
  if (!latest) return [];
  const set = presentations
    .filter(({ displaySetId }) => displaySetId === latest.displaySetId)
    .toSorted((left, right) => left.slot - right.slot);
  return [latest.displaySetId ? (set[0] ?? latest) : latest];
}

/** The question a shown pair asks, where both are of one assistant's comparison. */
export function pairQuestion(visible: readonly TimelinePresentation[]): string | undefined {
  const [first, second] = visible;
  return visible.length === 2 && first.displaySetId === second.displaySetId
    ? first.question
    : undefined;
}

/**
 * Where a shown comparison falls among those its operation asked, as “2 of 3”; undefined unless it
 * is one of the assistant's comparisons.
 */
export function comparisonProgress(
  presentations: readonly TimelinePresentation[],
  visible: readonly TimelinePresentation[]
): { number: number; count: number } | undefined {
  if (!pairQuestion(visible)) return undefined;
  const { operationId, displaySetId } = visible[0];
  const asked = [
    ...new Set(
      presentations
        .filter((entry) => entry.operationId === operationId && entry.question)
        .map((entry) => entry.displaySetId)
    )
  ];
  return { number: asked.indexOf(displaySetId) + 1, count: asked.length };
}

/**
 * Return the FIFO current-source candidates not consumed by committed participant actions, nor
 * answered while the answer is being saved.
 */
export function availablePresentations(
  events: readonly ProjectEvent[],
  layout: PresentationLayout,
  answered: readonly string[] = []
): TimelinePresentation[] {
  const all = timelinePresentations(events);
  const latest = all.findLast(({ presentation }) => isSverlinPresentation(presentation));
  if (!latest || !isSverlinPresentation(latest.presentation)) {
    return latestPresentations(all, layout);
  }
  const availableIds = new Set(
    presentationBufferState(events, 0, latest.presentation.source.sha256).available.map(
      ({ presentationId }) => presentationId
    )
  );
  const available = all.filter(
    ({ presentation }) =>
      availableIds.has(presentation.presentationId) &&
      !answered.includes(presentation.presentationId)
  );
  if (layout !== 'comparison') return available.slice(0, 1);
  const groups = new Map<string, TimelinePresentation[]>();
  for (const entry of available) {
    const key = isSverlinPresentation(entry.presentation)
      ? presentationScenarioKey(entry.presentation)
      : entry.presentation.presentationId;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const pair = [...groups.values()].find((group) => group.length >= 2);
  return pair?.slice(0, 2) ?? available.slice(0, 1);
}

/** Return the generated set containing a selected presentation, subject to the current layout. */
export function presentationGroup(
  presentations: readonly TimelinePresentation[],
  selected: TimelinePresentation,
  layout: PresentationLayout
): TimelinePresentation[] {
  if (layout !== 'comparison' || !isSverlinPresentation(selected.presentation)) {
    return [selected];
  }
  const group = presentations
    .filter((candidate) => sameDisplaySet(candidate, selected))
    .toSorted((left, right) => left.slot - right.slot || left.eventId - right.eventId)
    .slice(0, 2);
  return group.length === 2 && compatibleSverlinPair(group[0], group[1]) ? group : [selected];
}

/** Whether two presentations can share one playback position in a custom comparison. */
export function compatibleSverlinPair(
  left: TimelinePresentation,
  right: TimelinePresentation
): boolean {
  return (
    isSverlinPresentation(left.presentation) &&
    isSverlinPresentation(right.presentation) &&
    presentationScenarioKey(left.presentation) === presentationScenarioKey(right.presentation)
  );
}

/** Find presentations by stable IDs while preserving the requested order. */
export function presentationsById(
  presentations: readonly TimelinePresentation[],
  ids: readonly string[]
): TimelinePresentation[] {
  const byId = new Map(
    presentations.map((entry) => [entry.presentation.presentationId, entry] as const)
  );
  return ids.flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
}

function sameDisplaySet(left: TimelinePresentation, right: TimelinePresentation): boolean {
  if (left.displaySetId || right.displaySetId) return left.displaySetId === right.displaySetId;
  return left.operationId === right.operationId;
}
