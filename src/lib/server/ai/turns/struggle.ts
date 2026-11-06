/**
 * When a participant seems to be struggling to get a point across, a turn's first call steps up
 * from the fast model to a higher-reasoning one (bots/attempt-profiles.ts steppedUpParameters), the
 * same in every mode. The signals are read from the Timeline, actions first, as they need no
 * language: an earlier version restored since the last reply, an answer to a comparison reversed,
 * the same request again after it was answered, an answer to a question that itself followed a
 * question. Words count only weakly: a short message judging a version negatively, with nothing
 * pointed at. The model may also flag the request as unclear on the fast call, and the turn then
 * runs once more stepped up. Project 475043d1's "This doesnt look very good" got generic
 * comparisons from the fast call, which missed that the two folds were drawn in different shapes.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { ProjectEvent } from '$lib/shared/projects/events';
import type { EscalationReason } from '$lib/shared/projects/events/ai-generation';
import type { MessageContent } from '$lib/shared/projects/events/message-content';

type Turn = { reason?: EscalationReason };

const turns = new AsyncLocalStorage<Turn>();

/** Runs a turn whose first call steps up for `reason`, where it has one. */
export function runWithEscalation<T>(reason: EscalationReason | undefined, run: () => T): T {
  return turns.run(reason ? { reason } : {}, run);
}

/** Why the current turn's first call steps up, where it does. */
export const currentEscalation = (): EscalationReason | undefined => turns.getStore()?.reason;

/**
 * Marks the current turn to run once more stepped up, because the fast call flagged the request as
 * unclear; false where it already stepped up, so a turn reruns at most once.
 */
export function escalateForFlag(): boolean {
  const turn = turns.getStore();
  if (!turn || turn.reason) return false;
  turn.reason = 'model-flag';
  return true;
}

/** A message's words, without the references it holds. */
function wordsOf(content: MessageContent): string {
  return content
    .flatMap((segment) => (segment.type === 'markdown' ? [segment.text] : []))
    .join(' ')
    .toLowerCase();
}

const tokens = (text: string) => new Set(text.match(/[\p{L}\p{N}]+/gu) ?? []);

/** Whether two messages say nearly the same thing: most of their words shared (Jaccard ≥ 0.7). */
function sameRequest(a: string, b: string): boolean {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size < 2 || y.size < 2) return false;
  const shared = [...x].filter((word) => y.has(word)).length;
  return shared / (x.size + y.size - shared) >= 0.7;
}

/**
 * Words of a short negative judgement, deliberately few (English only; other languages rely on
 * the actions and the model's own flag).
 */
const negative =
  /\b(not|doesn'?t|dont|isn'?t|bad|wrong|confusing|confused|ugly|messy|unclear|still|again|weird|odd)\b/u;

/** A message too vague to act on: short, negative, and pointing at nothing. */
function vaguelyNegative(event: Extract<ProjectEvent, { type: 'feedback.submitted' }>): boolean {
  const words = wordsOf(event.payload.content);
  const count = tokens(words).size;
  const pointed =
    event.payload.focus.length > 0 ||
    event.payload.content.some((segment) => segment.type !== 'markdown');
  return count > 0 && count <= 12 && negative.test(words) && !pointed;
}

/**
 * Why this turn's first call should step up, from the Timeline before it and the interactions it
 * answers; none where the participant does not seem to be struggling.
 */
export function struggleSignal(
  events: readonly ProjectEvent[],
  interactionEventIds: readonly number[]
): EscalationReason | undefined {
  const replies = events.filter(
    (event): event is Extract<ProjectEvent, { type: 'assistant.responded' }> =>
      event.type === 'assistant.responded'
  );
  const lastReply = replies.at(-1);
  const since = lastReply?.id ?? 0;
  const asked = new Set(interactionEventIds);
  const interactions = events.filter((event) => asked.has(event.id));
  const feedback = interactions.filter(
    (event): event is Extract<ProjectEvent, { type: 'feedback.submitted' }> =>
      event.type === 'feedback.submitted'
  );

  // An earlier version restored since the assistant last replied.
  if (
    events.some(
      (event) =>
        event.id > since &&
        event.type === 'artifact.version-created' &&
        event.payload.origin.kind === 'restore'
    )
  )
    return 'restored-version';

  // An answer to a comparison that reverses an earlier answer to the same pair.
  for (const answer of interactions) {
    if (answer.type !== 'visualization.preference-recorded') continue;
    const pair = [...answer.payload.presentations].sort().join(' ');
    const choice = (payload: typeof answer.payload) =>
      'preferred' in payload ? payload.preferred : payload.outcome;
    const reversed = events.some(
      (earlier) =>
        earlier.id < answer.id &&
        earlier.type === 'visualization.preference-recorded' &&
        [...earlier.payload.presentations].sort().join(' ') === pair &&
        choice(earlier.payload) !== choice(answer.payload)
    );
    if (reversed) return 'comparison-rejected';
  }

  // The same request again, after the assistant answered it.
  const said = feedback.map((event) => wordsOf(event.payload.content)).filter(Boolean);
  const earlier = events.filter(
    (event): event is Extract<ProjectEvent, { type: 'feedback.submitted' }> =>
      event.type === 'feedback.submitted' && event.id < since && !asked.has(event.id)
  );
  if (
    said.some((text) =>
      earlier.some((before) => sameRequest(text, wordsOf(before.payload.content)))
    )
  )
    return 'repeat-request';

  // An answer to a question that itself followed a question the participant answered.
  const [previous, last] = replies.slice(-2);
  if (
    previous?.payload.question &&
    last?.payload.question &&
    feedback.some((event) => event.payload.answers === last.id) &&
    events.some(
      (event) =>
        event.type === 'feedback.submitted' &&
        event.payload.answers === previous.id &&
        event.id < last.id
    )
  )
    return 'question-unsettled';

  if (feedback.some(vaguelyNegative)) return 'vague-negative';
  return undefined;
}
