/** Client-side projection of immutable visualization events into selectable presentations. */

import { SvelteMap } from 'svelte/reactivity';

import type { ProjectEvent } from '$lib/shared/projects/events';
import { presentationBufferState } from '$lib/shared/projects/presentation-buffer';
import {
  isSverlinPresentation,
  presentationScenarioKey,
  type PresentationLayout,
  type RenderablePresentation
} from '$lib/shared/presentations';

const presentationAdjectives = [
  'Amber',
  'Arctic',
  'Azure',
  'Bold',
  'Bright',
  'Calm',
  'Clear',
  'Coral',
  'Cosmic',
  'Crisp',
  'Dawn',
  'Deep',
  'Ember',
  'Emerald',
  'Gentle',
  'Golden',
  'Indigo',
  'Keen',
  'Lunar',
  'Misty',
  'Noble',
  'Ocean',
  'Olive',
  'Quiet',
  'Rapid',
  'Silver',
  'Solar',
  'Swift',
  'Teal',
  'Vivid',
  'Warm',
  'Wild'
] as const;

const presentationNouns = [
  'Badger',
  'Comet',
  'Crane',
  'Dolphin',
  'Falcon',
  'Finch',
  'Fox',
  'Gecko',
  'Heron',
  'Koala',
  'Lark',
  'Lynx',
  'Maple',
  'Otter',
  'Owl',
  'Panda',
  'Pebble',
  'Pine',
  'Raven',
  'Reef',
  'Robin',
  'Seal',
  'Sparrow',
  'Star',
  'Tiger',
  'Turtle',
  'Wattle',
  'Whale',
  'Willow',
  'Wombat',
  'Wren',
  'Zebra'
] as const;

/** One presentation recorded in the Timeline, with its display-set context retained. */
export type TimelinePresentation = {
  eventId: number;
  eventType: 'visualization.presented';
  operationId: string;
  displaySetId?: string;
  slot: 0 | 1;
  presentation: RenderablePresentation;
};

/** A 32-bit FNV-1a hash of text. */
function fnv(text: string): number {
  let hash = 2166136261;
  for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** A participant-friendly name for a hash, such as Warm-Otter-33. */
function friendlyName(value: number): string {
  const adjective = presentationAdjectives[value & 31];
  const noun = presentationNouns[(value >>> 5) & 31];
  const number = String((value >>> 10) % 100).padStart(2, '0');
  return `${adjective}-${noun}-${number}`;
}

/**
 * A candidate's identifier, `<source>/<values>`: the source it was built from, as the start of the
 * source's hash, with a hue drawn from it so candidates of one source match at a glance; and the
 * values its random variables took, named from their hash, so two candidates that drew the same
 * values share a name. A layout drawn from the seed is one of those values, so the seed counts
 * where the source lays anything out by constraints.
 */
export type CandidateId = { source: string; hue: number; values: string };

/** The start of a source's hash, which names it, and the hue drawn from it. */
export function sourceId(hash: string): { source: string; hue: number } {
  return { source: hash.slice(0, 6), hue: parseInt(hash.slice(6, 9), 16) % 360 };
}

export function candidateId(presentation: RenderablePresentation): CandidateId {
  const hash =
    presentation.format === 'browser-bundle-v1'
      ? presentation.source.sha256
      : presentation.authored.sha256;
  const { source, hue } = sourceId(hash);
  if (presentation.format !== 'browser-bundle-v1')
    return { source, hue, values: friendlyName(fnv(presentation.presentationId)) };
  const seeded = /<Link\b|constraints=|['"]free['"]/u.test(presentation.source.text);
  const values = JSON.stringify([
    sorted(presentation.variant ?? presentation.parameters ?? {}),
    seeded ? presentation.seed : null
  ]);
  return { source, hue, values: friendlyName(fnv(values)) };
}

/** A value with every object's keys in order, so equal values print alike. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted((value as Record<string, unknown>)[key])])
  );
}

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
  return known ? `${known.source}/${known.values}` : friendlyName(fnv(presentationId));
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
          presentation: event.payload.presentation
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

/** Return the FIFO current-source candidates not consumed by committed participant actions. */
export function availablePresentations(
  events: readonly ProjectEvent[],
  layout: PresentationLayout
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
  const available = all.filter(({ presentation }) => availableIds.has(presentation.presentationId));
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
