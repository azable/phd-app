/** A queued assistant turn: answers and held questions first, then intake, then the mode's own turn. */

/** Mode-neutral AI feedback, candidate validation, and bounded attempt orchestration. */

import type { ProjectCommandResult, ProjectDocument } from '$lib/shared/projects/model';
import { waitingComparisons } from '$lib/shared/projects/presentation-buffer';
import { projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import { assistantTurnClaim } from '$lib/shared/projects/operations';
import { type AiContextSelection } from '$lib/server/ai/context/project-context';
import { heldQuestion } from '$lib/shared/projects/questions';

import { answersAfter } from '$lib/server/projects/variant-guard';
import {
  defaultProjectCommandDependencies,
  rebasingDependencies,
  referencedElements,
  referencedPresentations,
  viewedPresentations
} from '$lib/server/projects/commands';
import type { ProjectCommandDependencies } from '$lib/server/projects/commands';
import {
  dropMootComparisons,
  notedSinceReply,
  presentAfterRebase,
  presentPicks,
  unshownRebase
} from '$lib/server/ai/turns/comparisons';
import { releaseHeldQuestion } from '$lib/server/ai/turns/replies';
import { handleParticipantIntake } from '$lib/server/ai/turns/intake';
import { modeTurns } from '$lib/modes/assistants.server';
import { designingSignal, runWithEscalation, struggleSignal } from '$lib/server/ai/turns/struggle';

/** Process one durable claim while allowing new participant interactions to append concurrently. */
export async function runQueuedAssistantTurn(
  options: { projectId: string; operationId: string },
  dependencies: ProjectCommandDependencies = defaultProjectCommandDependencies
): Promise<ProjectCommandResult> {
  const before = await dependencies.repository.load(options.projectId);
  const claim = assistantTurnClaim(before, options.operationId);
  if (!claim) throw new Error('The assistant operation has no durable turn claim.');
  const requests = claim.payload.requestEventIds.map((id) => before.events[id - 1]);
  if (requests.some((event) => event?.type !== 'assistant.turn-requested')) {
    throw new Error('The assistant turn claim references an unknown request.');
  }
  const interactions = claim.payload.interactionEventIds.map((id) => before.events[id - 1]);
  if (
    interactions.some(
      (event) =>
        event?.type !== 'feedback.submitted' &&
        event?.type !== 'visualization.preference-recorded' &&
        event?.type !== 'visualization.runtime-failed' &&
        event?.type !== 'visualization.view-candidates'
    )
  ) {
    throw new Error('The assistant turn claim references an unknown interaction.');
  }
  const feedback = interactions.filter(
    (event): event is Extract<(typeof interactions)[number], { type: 'feedback.submitted' }> =>
      event?.type === 'feedback.submitted'
  );
  const preferences = interactions.filter(
    (
      event
    ): event is Extract<
      (typeof interactions)[number],
      { type: 'visualization.preference-recorded' }
    > => event?.type === 'visualization.preference-recorded'
  );
  const content = [
    ...feedback.flatMap((event) => event.payload.content),
    ...preferences.flatMap((event) => event.payload.comment ?? [])
  ];
  const contextSelection: AiContextSelection = {
    eventIds: [...new Set(feedback.flatMap((event) => event.payload.focus))],
    presentationIds: [
      ...new Set([
        ...referencedPresentations(content),
        ...feedback.flatMap((event) => viewedPresentations(event.payload.viewing)),
        ...preferences.flatMap((event) => event.payload.presentations),
        ...interactions.flatMap((event) =>
          event?.type === 'visualization.runtime-failed' ? [event.payload.presentationId] : []
        )
      ])
    ],
    elements: referencedElements(content),
    interactionEventIds: claim.payload.interactionEventIds
  };
  const presentationCount = Math.max(
    ...requests.map((event) =>
      event?.type === 'assistant.turn-requested' ? event.payload.presentationCount : 1
    )
  ) as 1 | 2;
  const concurrentDependencies = rebasingDependencies(dependencies);
  const appendedSince = (document: ProjectDocument) =>
    document.events.filter(
      (event) => event.id > projectHead(before).id && event.operationId === options.operationId
    );
  // Answers to the assistant's comparisons wait for the last to be answered: those that arrived
  // while the rest were still being built are dropped here, as they would have been on arrival.
  let current = before;
  let waiting = false;
  if (preferences.length && preferences.length === interactions.length) {
    const answered = await dropMootComparisons(
      current,
      answersAfter(current.events, Math.min(...preferences.map(({ id }) => id)) - 1),
      options.operationId,
      concurrentDependencies
    );
    current = answered.document;
    waiting = answered.waiting;
  }
  const rebase = unshownRebase(current, preferences);
  if (rebase)
    current = await presentAfterRebase(
      current,
      rebase,
      options.operationId,
      concurrentDependencies
    );
  if (waiting) return { document: current, appendedEvents: appendedSince(current) };
  if (preferences.length && !rebase && !waitingComparisons(current).length)
    current = await presentPicks(
      current,
      preferences.map(({ id }) => id),
      options.operationId,
      concurrentDependencies
    );
  // A question held back with comparisons is asked once the last is answered, or when the
  // participant writes first; answers alone then wait with it for the participant's reply. A
  // note written with an answer is the participant writing, so the turn runs for it.
  const noted = notedSinceReply(current.events);
  const answersOnly = preferences.length === interactions.length && !noted;
  if (heldQuestion(current.events) && !(answersOnly && waitingComparisons(current).length)) {
    current = await releaseHeldQuestion(current, options.operationId, concurrentDependencies);
    if (answersOnly) return { document: current, appendedEvents: appendedSince(current) };
  }
  const intake = await handleParticipantIntake(
    current,
    options.operationId,
    feedback,
    concurrentDependencies
  );
  if (!intake.author) {
    return {
      document: intake.document,
      appendedEvents: intake.document.events.filter(
        (event) => event.id > projectHead(before).id && event.operationId === options.operationId
      )
    };
  }
  // Every mode's turn steps its first call up alike where the participant seems to be struggling
  // (ai/turns/struggle.ts), or where it designs a first version for the helpers, so the study's
  // conditions get the same ladder.
  const document = await runWithEscalation(
    struggleSignal(intake.document.events, claim.payload.interactionEventIds) ??
      designingSignal(intake.document),
    () =>
      modeTurns[projectSnapshotAt(intake.document).mode](
        intake.document,
        options.operationId,
        contextSelection,
        presentationCount,
        concurrentDependencies,
        claim.payload.interactionEventIds
      )
  );
  return {
    document,
    appendedEvents: document.events.filter(
      (event) => event.id > projectHead(before).id && event.operationId === options.operationId
    )
  };
}
