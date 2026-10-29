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

import { agentRequests, type AgentRequest } from './agent-requests';

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
      /** Its source, which code its summary names is found in. */
      source: string;
      /** The source it was made from, where that has a card of its own. */
      parentHash?: string;
      /** The presentations this turn made of it, each a variant of its values, oldest first. */
      variants: TimelinePresentation[];
      /** Whether the source was first presented here, so this item says what it shows. */
      first: boolean;
    }
  /** A note from the developer, as the demo project's examples carry, about the card before it. */
  | {
      id: string;
      kind: 'note';
      text: string;
      eventId: number;
      /** The card it follows, whose source code it names is found in. */
      of?: { sourceHash: string; source: string; parentHash?: string };
    }
  | {
      id: string;
      kind: 'error';
      text: string;
      eventId: number;
      /** The source whose build failed on its code, where one did: the assistant's or a save's. */
      failed?: { source: string; by: 'assistant' | 'save' };
    }
  /** A request to a model, shown for audit in developer view. */
  | { id: string; kind: 'request'; value: AgentRequest };

/** Keep research data lossless while deriving a concise participant conversation locally. */
export function participantTimeline(
  events: readonly ProjectEvent[],
  options: { audit?: boolean } = {}
): ParticipantTimelineItem[] {
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
  // Each turn shows the variants it made, a card each; a source's first says what it shows.
  const placed = new Set<string>();
  const groups = Map.groupBy(events, ({ operationId }) => operationId);
  // The source presented last, by hash, which a note that follows is about.
  let presented: string | undefined;
  const about = new Map<string, string>();
  const items = [...groups.values()]
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
      if (options.audit)
        for (const value of agentRequests(related))
          items.push({ id: `request-${value.request.id}`, kind: 'request', value });
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
        if (event.type !== 'system.notified' || event.payload.severity !== 'info') continue;
        const id = `note-${event.id}`;
        items.push({ id, kind: 'note', text: event.payload.message, eventId: event.id });
        if (presented) about.set(id, presented);
      }
      const made = new Map<string, TimelinePresentation[]>();
      for (const event of related) {
        if (event.type !== 'visualization.presented') continue;
        const value = presentations.get(event.id);
        if (!value) continue;
        if (!isSverlinPresentation(value.presentation)) {
          items.push({ id: `presentation-${event.id}`, kind: 'presentation', value });
          continue;
        }
        const sourceHash = value.presentation.source.sha256;
        presented = sourceHash;
        const turn = made.get(sourceHash);
        if (turn) {
          turn.push(value);
          continue;
        }
        const turnVariants = [value];
        made.set(sourceHash, turnVariants);
        const first = !placed.has(sourceHash);
        placed.add(sourceHash);
        const version = versions.first.get(sourceHash);
        const parentHash = version?.payload.parent
          ? versions.hashes.get(version.payload.parent)
          : undefined;
        items.push({
          id: first ? `version-${sourceHash}` : `version-${sourceHash}-${event.id}`,
          kind: 'version',
          sourceHash,
          summary: version?.payload.summary ?? madeBy[version?.payload.origin.kind ?? 'none'],
          described: version?.payload.summary !== undefined,
          source: value.presentation.source.text,
          ...(parentHash && parentHash !== sourceHash && variants.has(parentHash)
            ? { parentHash }
            : {}),
          variants: turnVariants,
          first
        });
      }
      const failure = related.findLast(({ type }) => type === 'operation.failed');
      if (failure?.type === 'operation.failed' && failure.payload.kind !== 'presentation-refill') {
        const failed = failedSource(related);
        items.push({
          id: `error-${failure.id}`,
          kind: 'error',
          text: failure.payload.message,
          eventId: failure.id,
          ...(failed ? { failed } : {})
        });
      }
      return items;
    });
  // A note is about the source presented before it, on that source's card.
  const cards = new Map(
    items.flatMap((item) =>
      item.kind === 'version' && item.first ? [[item.sourceHash, item] as const] : []
    )
  );
  for (const item of items) {
    const card = item.kind === 'note' ? cards.get(about.get(item.id) ?? '') : undefined;
    if (item.kind === 'note' && card)
      item.of = {
        sourceHash: card.sourceHash,
        source: card.source,
        ...(card.parentHash ? { parentHash: card.parentHash } : {})
      };
  }
  return items;
}

/** The source of an operation's last build that failed on its code, and who wrote it. */
function failedSource(
  related: readonly ProjectEvent[]
): { source: string; by: 'assistant' | 'save' } | undefined {
  const failed = related.findLast(
    (event): event is ProjectEventOf<'build.failed'> =>
      event.type === 'build.failed' && event.payload.failureKind === 'source'
  );
  if (!failed) return undefined;
  // The request it answers: the one with its build id, or else the latest before it.
  const request = related.findLast(
    (event): event is ProjectEventOf<'build.requested'> =>
      event.type === 'build.requested' &&
      event.id < failed.id &&
      (failed.payload.buildId === undefined || event.payload.buildId === failed.payload.buildId)
  );
  return request
    ? {
        source: request.payload.source.text,
        by: request.payload.input === 'assistant-candidate' ? 'assistant' : 'save'
      }
    : undefined;
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
