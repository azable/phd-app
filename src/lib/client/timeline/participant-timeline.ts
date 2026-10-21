/** Participant-facing conversational projection of the complete immutable Timeline. */

import type { ProjectEvent, ProjectEventOf } from '$lib/shared/projects/events';
import { isSverlinPresentation } from '$lib/shared/presentations';
import {
  structureKnownPresentationReferences,
  type MessageContent
} from '$lib/shared/projects/events/message-content';

import {
  timelinePresentations,
  type TimelinePresentation
} from '$lib/client/visualization/presentation-history';

export type ParticipantTimelineItem =
  | {
      id: string;
      kind: 'message';
      actor: 'user' | 'assistant';
      content: MessageContent;
      eventId: number;
    }
  | { id: string; kind: 'presentation'; value: TimelinePresentation }
  | {
      id: string;
      kind: 'version';
      /** The hash of the source, which names it. */
      sourceHash: string;
      /** What it shows or changes, or how it was made where nobody said. */
      summary: string;
      described: boolean;
      /** The source it was made from, where that has a card of its own. */
      parentHash?: string;
      /** Its presentations, each a variant of its random values, oldest first. */
      variants: TimelinePresentation[];
    }
  | { id: string; kind: 'error'; text: string; eventId: number };

/** Keep research data lossless while deriving a concise participant conversation locally. */
export function participantTimeline(events: readonly ProjectEvent[]): ParticipantTimelineItem[] {
  const presentations = new Map(
    timelinePresentations(events).map((entry) => [entry.eventId, entry] as const)
  );
  const presentationIds = [...presentations.values()].map(
    ({ presentation }) => presentation.presentationId
  );
  const versions = sourceVersions(events);
  const variants = Map.groupBy(
    [...presentations.values()].filter(({ presentation }) => isSverlinPresentation(presentation)),
    ({ presentation }) => (presentation as { source: { sha256: string } }).source.sha256
  );
  // A source has one card, where it was first presented; later variants join it there.
  const placed = new Set<string>();
  const groups = Map.groupBy(events, ({ operationId }) => operationId);
  return [...groups.values()]
    .toSorted((left, right) => left[0].id - right[0].id)
    .flatMap((related) => {
      const items: ParticipantTimelineItem[] = [];
      for (const event of related) {
        if (event.type === 'feedback.submitted') {
          items.push(messageItem(`user-${event.id}`, 'user', event.payload.content, event.id));
        } else if (event.type === 'visualization.preference-recorded') {
          const other = event.payload.presentations.find((id) => id !== event.payload.preferred);
          if (!other) continue;
          items.push(
            messageItem(
              `preference-${event.id}`,
              'user',
              [
                { type: 'markdown', text: 'Preferred' },
                { type: 'presentation-ref', presentationId: event.payload.preferred },
                { type: 'markdown', text: 'over' },
                { type: 'presentation-ref', presentationId: other },
                { type: 'markdown', text: `at step ${event.payload.step + 1}.` }
              ],
              event.id
            )
          );
        }
      }
      for (const event of related) {
        if (event.type === 'assistant.responded') {
          items.push(
            messageItem(
              `assistant-${event.id}`,
              'assistant',
              structureKnownPresentationReferences(event.payload.content, presentationIds),
              event.id
            )
          );
        }
      }
      for (const event of related) {
        if (event.type !== 'visualization.presented') continue;
        const value = presentations.get(event.id);
        if (!value) continue;
        if (!isSverlinPresentation(value.presentation)) {
          items.push({ id: `presentation-${event.id}`, kind: 'presentation', value });
          continue;
        }
        const sourceHash = value.presentation.source.sha256;
        if (placed.has(sourceHash)) continue;
        placed.add(sourceHash);
        const version = versions.first.get(sourceHash);
        const parentHash = version?.payload.parent
          ? versions.hashes.get(version.payload.parent)
          : undefined;
        items.push({
          id: `version-${sourceHash}`,
          kind: 'version',
          sourceHash,
          summary: version?.payload.summary ?? madeBy[version?.payload.origin.kind ?? 'none'],
          described: version?.payload.summary !== undefined,
          ...(parentHash && parentHash !== sourceHash && variants.has(parentHash)
            ? { parentHash }
            : {}),
          variants: variants.get(sourceHash) ?? [value]
        });
      }
      const failure = related.findLast(({ type }) => type === 'operation.failed');
      if (failure?.type === 'operation.failed' && failure.payload.kind !== 'presentation-refill') {
        items.push({
          id: `error-${failure.id}`,
          kind: 'error',
          text: failure.payload.message,
          eventId: failure.id
        });
      }
      return items;
    });
}

// What a card says of a source whose version has no summary: how it was made.
const madeBy: Record<string, string> = {
  initial: 'The starting source',
  'manual-edit': 'Edited by hand',
  'assistant-edit': 'Revised by the assistant',
  restore: 'An earlier source, restored',
  candidate: 'An earlier source, built on again',
  none: 'A source'
};

/**
 * The artifact versions of the entry artifact: the hash of the source each made, by event id, and
 * the version that first made each source, by its hash.
 */
function sourceVersions(events: readonly ProjectEvent[]) {
  const created = events.find(({ type }) => type === 'project.created');
  const entry = created?.type === 'project.created' ? created.payload.entryArtifactId : undefined;
  const hashes = new Map<number, string>();
  const first = new Map<string, ProjectEventOf<'artifact.version-created'>>();
  for (const event of events) {
    if (event.type !== 'artifact.version-created') continue;
    const change = event.payload.changes.find(
      (change) => change.operation === 'upsert' && change.artifact.artifactId === entry
    );
    if (change?.operation !== 'upsert') continue;
    const hash = change.artifact.content.sha256;
    hashes.set(event.id, hash);
    if (!first.has(hash)) first.set(hash, event);
  }
  return { hashes, first };
}

function messageItem(
  id: string,
  actor: 'user' | 'assistant',
  content: MessageContent,
  eventId: number
): Extract<ParticipantTimelineItem, { kind: 'message' }> {
  return { id, kind: 'message', actor, content, eventId };
}
