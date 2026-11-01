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

import {
  answerLabel,
  projectQuestions,
  type ProjectQuestion
} from '$lib/shared/projects/questions';

import { agentRequests, type AgentRequest } from './agent-requests';

/** A question with its answer as its caption shows it, once given. */
export type CaptionedQuestion = { question: ProjectQuestion; answer?: MessageContent };

/** A presentation as a pill in an assistant's message: what it shows, and its source. */
export type VersionPill = {
  value: TimelinePresentation;
  /** What its source shows or changes, or how it was made where nobody said: the pill's tooltip. */
  summary?: string;
  /** The hash of its source, for a Sverlin presentation, which its code button shows. */
  sourceHash?: string;
  /** The source it was made from, where that was presented. */
  parentHash?: string;
};

/** What a source first presented in a turn without a reply shows, said in the reply's place. */
export type VersionSummary = {
  sourceHash: string;
  text: string;
  described: boolean;
  /** Its source, which code its summary names is found in. */
  source: string;
  parentHash?: string;
};

export type ParticipantTimelineItem =
  | { id: string; kind: 'message'; actor: 'user'; content: MessageContent; eventId: number }
  /**
   * One assistant turn as one message: its reply, naming the versions it presents inline; those it
   * does not name as pills at its end; the comparisons it asks; and its question, last.
   */
  | {
      id: string;
      kind: 'turn';
      /** The reply; absent where the turn presented without one, as a save or a demo example. */
      content?: MessageContent;
      eventId?: number;
      /** What each source first presented here shows, where the turn has no reply to say it. */
      summaries: VersionSummary[];
      /** The presentations it made that its words do not name, by id, as pills at its end. */
      appended: string[];
      /** Its comparisons: each pair's question, with its answer once given. */
      comparisons: CaptionedQuestion[];
      /** Its question, with a pill only where the message does not already show what it is about. */
      question?: CaptionedQuestion & { pill: boolean };
      /** Every presentation it shows as a pill, by id. */
      pills: Record<string, VersionPill>;
      /** The sources first presented here, which a link to a version's parent finds. */
      firsts: string[];
    }
  /** A note from the developer, as the demo project's examples carry, about the version before it. */
  | {
      id: string;
      kind: 'note';
      text: string;
      eventId: number;
      /** The version it follows, whose source code it names is found in. */
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
  | { id: string; kind: 'request'; value: AgentRequest }
  /** How a presentation loaded in a viewer's browser, shown for audit in developer view. */
  | { id: string; kind: 'load'; event: ProjectEventOf<'visualization.loaded'> };

type Turn = Extract<ParticipantTimelineItem, { kind: 'turn' }>;

/** Keep research data lossless while deriving a concise participant conversation locally. */
export function participantTimeline(
  events: readonly ProjectEvent[],
  options: { audit?: boolean } = {}
): ParticipantTimelineItem[] {
  const presentations = new Map(
    timelinePresentations(events).map((entry) => [entry.presentation.presentationId, entry])
  );
  const presentationIds = [...presentations.keys()];
  // Each presented source, by hash, as its first presentation has it.
  const sources = new Map<string, string>();
  for (const { presentation } of presentations.values())
    if (isSverlinPresentation(presentation) && !sources.has(presentation.source.sha256))
      sources.set(presentation.source.sha256, presentation.source.text);
  const versions = sourceVersions(events);
  const versionOf = (sourceHash: string) => {
    const version = versions.first.get(sourceHash);
    const parentHash = version?.payload.parent
      ? versions.hashes.get(version.payload.parent)
      : undefined;
    return {
      summary: version?.payload.summary ?? madeBy[version?.payload.origin.kind ?? 'none'],
      described: version?.payload.summary !== undefined,
      ...(parentHash && parentHash !== sourceHash && sources.has(parentHash) ? { parentHash } : {})
    };
  };
  const pillOf = (value: TimelinePresentation): VersionPill => {
    if (!isSverlinPresentation(value.presentation)) return { value };
    const sourceHash = value.presentation.source.sha256;
    const { summary, parentHash } = versionOf(sourceHash);
    return { value, summary, sourceHash, ...(parentHash ? { parentHash } : {}) };
  };
  const captioned = (question: ProjectQuestion): CaptionedQuestion => {
    const answer = answerLabel(question);
    return { question, ...(answer ? { answer } : {}) };
  };
  const questions = projectQuestions(events);
  const asked = new Map(questions.map((question) => [question.eventId, question]));
  const pairQuestions = new Map(
    questions.flatMap((question) =>
      question.displaySetId ? [[question.displaySetId, question] as const] : []
    )
  );
  // Answers to pairs that asked a question show under it, not as messages of their own.
  const answeredPairs = new Set(
    questions.flatMap(({ kind, answer }) => (kind === 'pair' && answer ? [answer.eventId] : []))
  );
  const placed = new Set<string>();
  // The source presented last, by hash, which a note that follows is about.
  let presented: string | undefined;

  /**
   * An operation's assistant messages, a turn each; the last holds what the operation presented,
   * or, where it replied nothing, a turn of its own does.
   */
  function turnItems(related: readonly ProjectEvent[]): Turn[] {
    const turns = related.flatMap((event): Turn[] => {
      if (event.type !== 'assistant.responded') return [];
      const question = asked.get(event.id);
      return [
        {
          ...emptyTurn(`assistant-${event.id}`),
          content: withoutRepeatedQuestion(
            structureKnownPresentationReferences(event.payload.content, presentationIds),
            question?.text
          ),
          eventId: event.id,
          ...(question ? { question: { ...captioned(question), pill: false } } : {})
        }
      ];
    });
    const made = related.flatMap((event) => {
      const value =
        event.type === 'visualization.presented'
          ? presentations.get(event.payload.presentation.presentationId)
          : undefined;
      return value ? [value] : [];
    });
    if (made.length && !turns.length) turns.push(emptyTurn(`presented-${made[0].eventId}`));
    const holder = turns.at(-1);
    if (!holder) return [];
    const named = new Set(turns.flatMap(({ content }) => referencedIn(content)));
    for (const value of made) {
      const { presentation } = value;
      if (isSverlinPresentation(presentation)) {
        const sourceHash = presentation.source.sha256;
        presented = sourceHash;
        if (!placed.has(sourceHash)) {
          placed.add(sourceHash);
          holder.firsts.push(sourceHash);
          const { summary, described, parentHash } = versionOf(sourceHash);
          if (!holder.content)
            holder.summaries.push({
              sourceHash,
              text: summary,
              described,
              source: presentation.source.text,
              ...(parentHash ? { parentHash } : {})
            });
        }
      }
      const pair = value.displaySetId ? pairQuestions.get(value.displaySetId) : undefined;
      if (pair) {
        if (!holder.comparisons.some(({ question }) => question === pair))
          holder.comparisons.push(captioned(pair));
      } else if (!named.has(presentation.presentationId))
        holder.appended.push(presentation.presentationId);
    }
    // A question about what the message shows needs no pill; one about a presentation the turn
    // made but did not name, as its example, shows it in place of the pill at the message's end.
    const compared = new Set(
      holder.comparisons.flatMap(({ question }) => question.presentationIds)
    );
    for (const { question } of turns) {
      const about = question?.question.presentationIds[0];
      if (!question || !about) continue;
      question.pill = !named.has(about) && !compared.has(about);
      holder.appended = holder.appended.filter((id) => id !== about);
    }
    for (const turn of turns)
      for (const id of [
        ...referencedIn(turn.content),
        ...turn.appended,
        ...turn.comparisons.flatMap(({ question }) => question.presentationIds),
        ...(turn.question?.pill ? turn.question.question.presentationIds : [])
      ]) {
        const value = presentations.get(id);
        if (value) turn.pills[id] = pillOf(value);
      }
    return turns;
  }

  return [...Map.groupBy(events, ({ operationId }) => operationId).values()]
    .toSorted((left, right) => left[0].id - right[0].id)
    .flatMap((related) => {
      const items: ParticipantTimelineItem[] = [];
      for (const event of related) {
        if (event.type === 'feedback.submitted') {
          items.push(userMessage(`user-${event.id}`, event.payload.content, event.id));
        } else if (
          event.type === 'visualization.preference-recorded' &&
          !answeredPairs.has(event.id)
        ) {
          const [first, second] = event.payload.presentations;
          const preferred = 'preferred' in event.payload ? event.payload.preferred : undefined;
          const other = event.payload.presentations.find((id) => id !== preferred);
          if (!other) continue;
          const said =
            'outcome' in event.payload
              ? event.payload.outcome === 'tie'
                ? 'Either is fine:'
                : 'Decide later:'
              : undefined;
          items.push(
            userMessage(
              `preference-${event.id}`,
              preferred
                ? [
                    { type: 'markdown', text: 'Preferred' },
                    { type: 'presentation-ref', presentationId: preferred },
                    { type: 'markdown', text: 'over' },
                    { type: 'presentation-ref', presentationId: other },
                    { type: 'markdown', text: `at step ${event.payload.step + 1}.` }
                  ]
                : [
                    { type: 'markdown', text: said ?? '' },
                    { type: 'presentation-ref', presentationId: first },
                    { type: 'markdown', text: 'or' },
                    { type: 'presentation-ref', presentationId: second },
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
      if (options.audit)
        for (const event of related)
          if (event.type === 'visualization.loaded')
            items.push({ id: `load-${event.id}`, kind: 'load', event });
      items.push(...turnItems(related));
      // A note is about the source presented before it.
      for (const event of related) {
        if (event.type !== 'system.notified' || event.payload.severity !== 'info') continue;
        const source = presented ? sources.get(presented) : undefined;
        const parentHash = presented ? versionOf(presented).parentHash : undefined;
        items.push({
          id: `note-${event.id}`,
          kind: 'note',
          text: event.payload.message,
          eventId: event.id,
          ...(presented && source !== undefined
            ? { of: { sourceHash: presented, source, ...(parentHash ? { parentHash } : {}) } }
            : {})
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
}

/**
 * A reply as shown above its question: without its last sentence or paragraph where that says the
 * question again, as the question shows under it.
 */
export function withoutRepeatedQuestion(
  content: MessageContent,
  question: string | undefined
): MessageContent {
  const last = content.at(-1);
  if (!question || last?.type !== 'markdown') return content;
  const text = last.text.trimEnd();
  // Where the last sentence and the last paragraph start, where they start in this text.
  const sentences = [...text.matchAll(/[.!?:]\s+/g)].map(({ index, 0: end }) => index + end.length);
  const paragraphs = [...text.matchAll(/\n\s*\n/g)].map(({ index, 0: end }) => index + end.length);
  const whole = content.length === 1 ? 0 : undefined;
  const start = [sentences.at(-1) ?? whole, paragraphs.at(-1) ?? whole].find(
    (at) => at !== undefined && repeats(text.slice(at), question)
  );
  if (start === undefined) return content;
  const kept = text.slice(0, start).trimEnd();
  return [...content.slice(0, -1), ...(kept ? [{ ...last, text: kept }] : [])];
}

/**
 * Whether a passage says essentially the question: the same words, one within the other (at least
 * half its length), or, both asking, reworded with most of the same words.
 */
function repeats(passage: string, question: string): boolean {
  const [said, asked] = [normalised(passage), normalised(question)];
  if (!said || !asked) return false;
  const [shorter, longer] = said.length < asked.length ? [said, asked] : [asked, said];
  if (longer.includes(shorter) && shorter.length * 2 >= longer.length) return true;
  if (!passage.trim().endsWith('?')) return false;
  const words = (value: string) =>
    new Set(value.split(' ').filter((word) => !commonWords.has(word)));
  const [a, b] = [words(said), words(asked)];
  const shared = [...a].filter((word) => b.has(word)).length;
  return a.size + b.size > 0 && (2 * shared) / (a.size + b.size) >= rewordedOverlap;
}

const normalised = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * The share of their words (the Dice coefficient, beyond common words) a reworded repeat keeps.
 * The repeat seen in trials kept 0.7: “Would you like me to suggest some alternatives to
 * compare—for example, different ways to mark the current cell or arrange the pseudocode?” for
 * “Would you like me to suggest alternatives to compare, such as different current-cell markers or
 * pseudocode arrangements?”.
 */
const rewordedOverlap = 0.6;

const commonWords = new Set(
  'a an and any are as at be by can do for from how i if in is it like me my of on or say so some such that the them they this to was we what when which who would you your'.split(
    ' '
  )
);

function emptyTurn(id: string): Turn {
  return { id, kind: 'turn', summaries: [], appended: [], comparisons: [], pills: {}, firsts: [] };
}

/** The presentations a message names, by id. */
function referencedIn(content: MessageContent = []): string[] {
  return content.flatMap((segment) =>
    segment.type === 'presentation-ref' ? [segment.presentationId] : []
  );
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

// What a version says of a source that has no summary: how it was made.
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

function userMessage(
  id: string,
  content: MessageContent,
  eventId: number
): Extract<ParticipantTimelineItem, { kind: 'message' }> {
  return { id, kind: 'message', actor: 'user', content, eventId };
}
