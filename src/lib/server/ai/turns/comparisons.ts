/** Comparisons the assistant made: shown, answered, dropped once moot, and picks presented. */

/** Mode-neutral AI feedback, candidate validation, and bounded attempt orchestration. */

import type { EventId, ProjectEventOf } from '$lib/shared/projects/events';
import { preferredPresentation } from '$lib/shared/projects/events/visualization-presented';
import type { ProjectDocument } from '$lib/shared/projects/model';
import { waitingComparisons } from '$lib/shared/projects/presentation-buffer';
import { type DesignValues } from '$lib/shared/presentations';
import { presentationVariant } from '$lib/shared/presentations';
import { projectSnapshotAt } from '$lib/shared/projects/projection';
import { type BuildRequest } from '$lib/modes/server';
import type { Comparisons } from '$lib/server/ai/decisions/source-decisions';

import { recordText } from '$lib/server/projects/fingerprints';
import { assertCurrentProjectOperationActive } from '$lib/server/projects/operation-context';
import {
  activateBuiltPresentations,
  appendProjectEvents,
  buildProjectSourceBatch,
  draftEvent,
  type PairQuestion
} from '$lib/server/projects/service';
import { askedPair, mootComparison, type Answer } from '$lib/server/projects/variant-guard';
import type { ProjectCommandDependencies } from '$lib/server/projects/commands';
import { batchSucceeded } from '$lib/server/ai/turns/replies';

export async function buildCandidateBatch(
  options: {
    document: ProjectDocument;
    candidate: string;
    requests: readonly BuildRequest[];
    operationId: string;
    attempt: number;
  },
  dependencies: ProjectCommandDependencies
): Promise<{
  document: ProjectDocument;
  recorded: Awaited<ReturnType<typeof buildProjectSourceBatch>>;
}> {
  const snapshot = projectSnapshotAt(options.document);
  const entry = snapshot.artifacts[snapshot.entryArtifactId];
  if (!entry) throw new Error('The project has no entry artifact.');
  const source = recordText(options.candidate, entry.content.mediaType);
  const recorded = await buildProjectSourceBatch(
    {
      document: options.document,
      sourceContent: options.candidate,
      source,
      sourceLabel: entry.path,
      requests: options.requests,
      purpose: 'assistant-edit',
      input: 'assistant-candidate',
      operationId: options.operationId,
      attempt: options.attempt
    },
    dependencies.projectService
  );
  return { document: recorded.document, recorded };
}

/** A comparison as shown: its sides the other way round where swapped. */
export type ShownComparison = Comparisons[number] & { swapped?: true };

/**
 * The comparisons with each pair's order drawn at random, so which side shows on top says nothing
 * of the assistant's order and a preference is not confounded with position.
 */
export function shownInRandomOrder(
  comparisons: Comparisons,
  random: () => number = Math.random
): ShownComparison[] {
  return comparisons.map((comparison) =>
    random() < 0.5
      ? comparison
      : {
          ...comparison,
          left: comparison.right,
          right: comparison.left,
          ...(comparison.brief
            ? {
                brief: {
                  ...comparison.brief,
                  left: comparison.brief.right,
                  right: comparison.brief.left
                }
              }
            : {}),
          swapped: true as const
        }
  );
}

/**
 * Whether an answer since the assistant's last reply came with a note: the participant wrote, so
 * the turn runs for it once the batch is answered, whichever pair the note went with (project
 * fd7591a2's note on its first pair waited unread while the last, with none, asked the held
 * question).
 */
export function notedSinceReply(events: ProjectDocument['events']): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'assistant.responded') return false;
    if (event.type === 'visualization.preference-recorded' && event.payload.comment?.length)
      return true;
  }
  return false;
}

/**
 * Set aside the waiting comparisons these answers make moot (mootComparison), of any source, as
 * those asked before an answer went back to an earlier one, and say whether any of the current
 * source are still to answer: the assistant waits for the last of its questions to be answered
 * before it takes a turn on them.
 */
export async function dropMootComparisons(
  document: ProjectDocument,
  answers: readonly Answer[],
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<{ document: ProjectDocument; waiting: boolean }> {
  const moot = waitingComparisons(document, { everySource: true }).filter(
    ({ variants: [left = {}, right = {}] }) =>
      answers.some((answer) => mootComparison(answer, askedPair(left, right)))
  );
  const mootSets = new Set(moot.map(({ displaySetId }) => displaySetId));
  const waiting = waitingComparisons(document).filter(
    ({ displaySetId }) => !mootSets.has(displaySetId)
  );
  if (moot.length)
    document = await appendProjectEvents(
      document,
      moot.map(({ presentationIds }) =>
        draftEvent({
          type: 'visualization.candidates-advanced',
          actor: { kind: 'system' },
          operationId,
          payload: { presentations: presentationIds, reason: 'moot' }
        })
      ),
      dependencies.projectService
    );
  return { document, waiting: waiting.length > 0 };
}

/**
 * The version an answer went back to (basedOnAnswer: the source of the side it preferred, which a
 * later version had replaced), while it is still the current version and nothing has shown since.
 */
export function unshownRebase(
  document: ProjectDocument,
  answers: readonly ProjectEventOf<'visualization.preference-recorded'>[]
): ProjectEventOf<'artifact.version-created'> | undefined {
  const operations = new Set(answers.map(({ operationId }) => operationId));
  const rebase = document.events.findLast(
    (event): event is ProjectEventOf<'artifact.version-created'> =>
      event.type === 'artifact.version-created' &&
      event.payload.origin.kind === 'candidate' &&
      operations.has(event.operationId)
  );
  if (!rebase) return undefined;
  const since = document.events.slice(rebase.id);
  return since.some(
    ({ type }) => type === 'artifact.version-created' || type === 'visualization.presented'
  )
    ? undefined
    : rebase;
}

/**
 * Show the source an answer went back to, in place of what showed of the source it left: that
 * source's next waiting comparison, built again so it shows as the newest, or else the side the
 * answer preferred. Left as it was when a build fails.
 */
export async function presentAfterRebase(
  document: ProjectDocument,
  rebase: ProjectEventOf<'artifact.version-created'>,
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  if (rebase.payload.origin.kind !== 'candidate') return document;
  const [next] = waitingComparisons(document);
  const shown = (next?.presentationIds ?? [rebase.payload.origin.presentationId]).map((id) =>
    document.events.findLast(
      (event): event is ProjectEventOf<'visualization.presented'> =>
        event.type === 'visualization.presented' && event.payload.presentation.presentationId === id
    )
  );
  const snapshot = projectSnapshotAt(document);
  const entry = snapshot.artifacts[snapshot.entryArtifactId];
  const requests = shown.flatMap((event): BuildRequest[] => {
    const presentation = event?.payload.presentation;
    if (presentation?.format !== 'browser-bundle-v1') return [];
    const values = presentationVariant(presentation);
    return [
      {
        seed: presentation.seed,
        ...(Object.keys(values).length ? { variant: { base: values } } : {})
      }
    ];
  });
  if (!entry || requests.length !== shown.length) return document;
  const recorded = await buildProjectSourceBatch(
    {
      document,
      sourceContent: entry.content.text,
      source: entry.content,
      sourceLabel: entry.path,
      requests,
      purpose: 'restore',
      input: 'committed-artifact',
      operationId
    },
    dependencies.projectService
  );
  if (!batchSucceeded(recorded)) return recorded.document;
  let current = recorded.document;
  const [left, right] = shown.map((event) => event?.payload);
  const pair: PairQuestion | undefined =
    next && left?.question && right
      ? {
          question: left.question,
          labels: [left.label ?? '', right.label ?? ''],
          ...(left.brief && right.brief
            ? { brief: { key: left.brief.key, tags: [left.brief.tag, right.brief.tag] } }
            : {}),
          ...(left.differsAt ? { differsAt: left.differsAt } : {}),
          ...(left.swapped ? { swapped: left.swapped } : {})
        }
      : undefined;
  if (next)
    current = await appendProjectEvents(
      current,
      [
        draftEvent({
          type: 'visualization.candidates-advanced',
          actor: { kind: 'system' },
          operationId,
          payload: { presentations: next.presentationIds, reason: 'agent-request' }
        })
      ],
      dependencies.projectService
    );
  return activateBuiltPresentations(
    { document: current, builds: recorded.builds },
    dependencies.projectService,
    { kind: 'system' },
    pair
  );
}

/**
 * Once the last of a batch of comparisons is answered, show their outcome in place of the answered
 * pair: the source as it is, with the values each pair's picked side set, and for a pair answered
 * either is fine, unsure or not at all, the values the batch's other sides share. It is built with
 * no model call; where that fails, the version the pairs were asked about is built instead. Pairs
 * of another source than the current one, as an edit's, are left out.
 */
export async function presentPicks(
  document: ProjectDocument,
  answeredIds: readonly EventId[],
  operationId: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  const snapshot = projectSnapshotAt(document);
  const entry = snapshot.artifacts[snapshot.entryArtifactId];
  const presented = new Map(
    document.events.flatMap((event) =>
      event.type === 'visualization.presented'
        ? [[event.payload.presentation.presentationId, event] as const]
        : []
    )
  );
  const answer = document.events.findLast(
    (event): event is ProjectEventOf<'visualization.preference-recorded'> =>
      event.type === 'visualization.preference-recorded' && answeredIds.includes(event.id)
  );
  const batch = answer && presented.get(answer.payload.presentations[0])?.operationId;
  if (!entry || !batch) return document;
  const sets = Map.groupBy(
    [...presented.values()].filter(
      (event) =>
        event.operationId === batch &&
        event.payload.question &&
        event.payload.displaySetId &&
        event.payload.presentation.format === 'browser-bundle-v1' &&
        event.payload.presentation.source.sha256 === entry.content.sha256
    ),
    (event) => event.payload.displaySetId
  );
  const pairs = [...sets.values()].flatMap((set) => {
    const [left, right] = set.toSorted((a, b) => a.payload.slot - b.payload.slot);
    if (!left || !right) return [];
    const ids = [left, right].map((event) => event.payload.presentation.presentationId);
    const picked = document.events.findLast(
      (event): event is ProjectEventOf<'visualization.preference-recorded'> =>
        event.type === 'visualization.preference-recorded' &&
        event.payload.presentations.every((id) => ids.includes(id))
    );
    const preferred = picked && preferredPresentation(picked.payload);
    return [
      {
        left: presentationVariant(left.payload.presentation),
        right: presentationVariant(right.payload.presentation),
        picked: preferred
          ? presentationVariant(presented.get(preferred)?.payload.presentation)
          : undefined,
        seed:
          left.payload.presentation.format === 'browser-bundle-v1'
            ? left.payload.presentation.seed
            : 1
      }
    ];
  });
  if (!pairs.length) return document;
  const asked = (applyPicks: boolean): DesignValues => {
    const values: DesignValues = { ...pairs[0].left };
    for (const [index, pair] of pairs.entries()) {
      const other = pairs.find((_, at) => at !== index)?.left ?? pair.left;
      for (const key of new Set([...Object.keys(pair.left), ...Object.keys(pair.right)])) {
        if (pair.left[key] === pair.right[key]) continue;
        const value = applyPicks && pair.picked ? pair.picked[key] : other[key];
        if (value === undefined) delete values[key];
        else values[key] = value;
      }
    }
    return values;
  };
  for (const values of [asked(true), asked(false)]) {
    assertCurrentProjectOperationActive();
    const recorded = await buildProjectSourceBatch(
      {
        document,
        sourceContent: entry.content.text,
        source: entry.content,
        sourceLabel: entry.path,
        requests: [
          {
            seed: pairs[0].seed,
            ...(Object.keys(values).length ? { variant: { base: values } } : {})
          }
        ],
        purpose: 'picks',
        input: 'committed-artifact',
        operationId
      },
      dependencies.projectService
    );
    document = recorded.document;
    if (batchSucceeded(recorded))
      return activateBuiltPresentations(
        { document, builds: recorded.builds },
        dependencies.projectService,
        { kind: 'system' }
      );
  }
  return document;
}
