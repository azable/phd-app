/**
 * The names a presentation is shown and referred to by, as `3fa2c1/Misty-Falcon-09`: the start of
 * its source's hash, then a participant-friendly name of the values its random variables took.
 * Environment-neutral, so the page, the data export and the demo name presentations alike.
 */

import type { ProjectEvent } from '$lib/shared/projects/events';
import type { RenderablePresentation } from '$lib/shared/presentations';

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
 * values share a name. The seed draws nothing the values do not record, so it plays no part.
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
  const values = JSON.stringify(sorted(presentation.variant ?? {}));
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

/** A presentation's name as text, `<source>/<values>`, as the page shows it. */
export function presentationName(presentation: RenderablePresentation): string {
  const { source, values } = candidateId(presentation);
  return `${source}/${values}`;
}

/** The name of a presentation known only by its id, as the page labels one it has not seen. */
export function fallbackPresentationName(presentationId: string): string {
  return friendlyName(fnv(presentationId));
}

/** Every presentation a Timeline records, in order, with the name the page shows it by. */
export function namedPresentations(
  events: readonly ProjectEvent[]
): { eventId: number; presentationId: string; name: string }[] {
  return events.flatMap((event) =>
    event.type === 'visualization.presented'
      ? [
          {
            eventId: event.id,
            presentationId: event.payload.presentation.presentationId,
            name: presentationName(event.payload.presentation)
          }
        ]
      : []
  );
}
