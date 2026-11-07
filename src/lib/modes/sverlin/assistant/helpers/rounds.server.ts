/**
 * The helpers' rounds during a Sverlin turn, through the pipeline's stages (ai/bots/helper-pipeline
 * .ts): helpers fill a skeleton's holes and the app builds and measures each fill; a decision model
 * scores pictures of them and keeps each group's shortlist; the designing model picks which fills
 * go together, and the app builds only those. Each stage can be switched off on its own.
 */

import type { EventId, ProjectEventOf } from '$lib/shared/projects/events';
import { presentationDesign } from '$lib/shared/presentations';
import type { ProjectDocument } from '$lib/shared/projects/model';
import { waitingComparisons } from '$lib/shared/projects/presentation-buffer';
import { projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import { pendingAssistantTurnRequests } from '$lib/shared/projects/operations';
import {
  bestCandidates,
  checkFills,
  drawingShape,
  holeHelperPrompt,
  layoutHelperDirections,
  viewHelperDirections,
  type ViewCandidate
} from '$lib/modes/sverlin/assistant/view-helpers.server';
import {
  holeGroups,
  holesOf,
  pictureHole,
  representationFamilies,
  representationSkeleton,
  skeletonFor,
  type Hole
} from '$lib/modes/sverlin/assistant/skeleton.server';
import { openQuestion } from '$lib/shared/projects/questions';
import {
  fillsOf,
  holeHelperTask,
  parseProposals,
  proposalsFormat,
  type Proposal
} from '$lib/modes/sverlin/assistant/helper-proposals.server';
import { factsText } from '$lib/modes/sverlin/assistant/candidate-facts.server';
import { telltaleSteps, viewAlone } from '$lib/modes/sverlin/targets/crops';
import { scenePictures } from '$lib/modes/sverlin/targets/png.server';
import { openAIAdapter } from '$lib/server/ai/providers/openai';
import type { ChatAdapter } from '$lib/server/ai/providers/types';
import { createDecisions } from '$lib/server/ai/providers/openai-decisions';
import { turnHelperCounts, turnViewHelpers } from '$lib/server/projects/view-helpers-config';
import {
  candidatesGiven,
  helperBuildBudgetMs,
  viewHelperBackground,
  viewHelperCalls,
  viewHelpersContext,
  viewHelperTimeoutMs
} from '$lib/modes/sverlin/assistant/helpers/context.server';
import {
  type AiContextSelection,
  type AiProjectContext
} from '$lib/server/ai/context/project-context';
import type { ChatbotPrompt, ViewHelpersRequest } from '$lib/server/ai/bots/types';
import {
  helperPipeline,
  type HelperPipelineConfig,
  type HoleKind
} from '$lib/server/ai/bots/helper-pipeline';
import {
  decisionsUsage,
  scoreOptions,
  shortlists,
  type OptionScore,
  type ScoringCall,
  type ScoringOption
} from '$lib/server/ai/choosing/scoring';
import {
  choosingInput,
  choosingInstructions,
  combineDecisionFormat,
  validCombinations,
  type ShortlistedGroup
} from '$lib/server/ai/decisions/combine-decision';

import { logModelCall } from '$lib/server/ai/costs/ai-cost-log';
import { recordText, sourceSha256 } from '$lib/server/projects/fingerprints';
import {
  currentProjectOperationDeadline,
  currentProjectOperationSignal
} from '$lib/server/projects/operation-context';
import { appendProjectEvents, draftEvent } from '$lib/server/projects/service';
import type { ProjectCommandDependencies } from '$lib/server/projects/commands';
import {
  generationErrorDetails,
  generationFailureKind,
  safeErrorMessage,
  spentUsage
} from '$lib/server/ai/turns/failures';

/**
 * Once a helper round has recorded candidates, the assistant goes on by itself, once, offering them
 * (see the interaction kind view-helpers), whoever started the round: not after such a follow-up,
 * nor where the participant has written meanwhile (their turn takes the candidates), nor past the
 * phase deadline, nor while the participant still has comparisons to answer, the candidates then
 * waiting for their next turn (project 180c7b48's follow-up asked the held question and added a
 * pair while five were unanswered). A round that kept none goes on only where the reply showed
 * nothing, the assistant then showing something of its own (project 5cb84e44's five arrangements
 * waited unoffered).
 */
export async function followAfterHelpers(
  document: ProjectDocument,
  operationId: string,
  contextSelection: AiContextSelection,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  const ours = document.events.filter((event) => event.operationId === operationId);
  const candidates = ours.findLast((event) => event.type === 'visualization.view-candidates');
  const interactions = contextSelection.interactionEventIds ?? [];
  const deadline = currentProjectOperationDeadline();
  if (
    candidates?.type !== 'visualization.view-candidates' ||
    (!candidates.payload.candidates.length &&
      ours.some((event) => event.type === 'visualization.presented')) ||
    (interactions.length > 0 &&
      interactions.every(
        (id) => document.events[id - 1]?.type === 'visualization.view-candidates'
      )) ||
    pendingAssistantTurnRequests(document).length > 0 ||
    waitingComparisons(document).length > 0 ||
    (deadline !== undefined && Date.now() >= deadline)
  )
    return document;
  return appendProjectEvents(
    document,
    [
      draftEvent({
        type: 'assistant.turn-requested',
        actor: { kind: 'system' },
        operationId,
        payload: {
          interactionEventId: candidates.id,
          presentationCount: 1,
          ...(deadline === undefined ? {} : { deadlineAt: new Date(deadline).toISOString() })
        }
      })
    ],
    dependencies.projectService
  );
}

/**
 * Whether a round has prepared candidates for an answer of a question for this source: one whose
 * candidates were written for it, kept or not, so an answer that proposed nothing is not tried
 * again for the same source.
 */
function prepared(
  document: ProjectDocument,
  option: { question: number; label: string },
  sha256: string
): boolean {
  return document.events.some(
    (event) =>
      event.type === 'visualization.view-candidates' &&
      event.payload.sourceSha256 === sha256 &&
      event.payload.option?.question === option.question &&
      event.payload.option.label === option.label
  );
}

/**
 * The answers of the open question still to prepare for this source: each with a task and a
 * skeleton, none prepared yet, and none once a background operation has started on the question,
 * so a round cancelled by the participant, or one that failed, is not started again (the answer's
 * turn then runs an ordinary round). None where caching is off.
 */
export function answersToPrepare(
  document: ProjectDocument,
  source: string,
  pipeline: HelperPipelineConfig = helperPipeline
): { option: { question: number; label: string }; task: string; skeleton: string }[] {
  if (!pipeline.firstTurns.caching) return [];
  const open = openQuestion(document.events);
  if (!open?.options) return [];
  const tried = document.events.some(
    (event) =>
      event.id > open.eventId &&
      event.type === 'operation.accepted' &&
      event.payload.kind === 'prepare-answers'
  );
  if (tried) return [];
  return open.options.flatMap(({ label, task }) => {
    const option = { question: open.eventId, label };
    const skeleton = task ? representationSkeleton(source, task) : undefined;
    return task && skeleton && !prepared(document, option, sourceSha256(source))
      ? [{ option, task, skeleton }]
      : [];
  });
}

/**
 * While the participant reads a question with answers, a round for each answer with a task, in
 * order, its candidates kept by that answer (helper-pipeline.ts firstTurns.caching): whole pictures,
 * as the question settles what to show, each its own round so it never waits for the others. They
 * run in a background operation of their own once the turn has ended (prepare-answers), which the
 * participant's next action cancels, so no answer waits for them (project 2c3573a3's preference
 * waited 45 s while they ran in the follow-up's turn).
 */
export async function prepareAnswers(
  document: ProjectDocument,
  operationId: string,
  source: string,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  const pipeline = dependencies.helperPipeline ?? helperPipeline;
  const signal = currentProjectOperationSignal();
  let current = document;
  for (const { option, task, skeleton } of answersToPrepare(document, source, pipeline)) {
    if (signal?.aborted) break;
    current = await runViewHelpers(
      current,
      operationId,
      source,
      { skeleton, task, option },
      dependencies
    );
  }
  return current;
}

/** The assistant's context, with the view helpers' where the turn runs them. */
export function withViewHelpers(
  project: AiProjectContext,
  document: ProjectDocument
): AiProjectContext {
  if (!turnViewHelpers(document)) return project;
  const snapshot = projectSnapshotAt(document);
  const content = snapshot.artifacts[snapshot.entryArtifactId]?.content;
  return {
    ...project,
    viewHelpers: viewHelpersContext(document, {
      sha256: content?.sha256 ?? '',
      text: content?.text ?? ''
    })
  };
}

/**
 * What each helper of a group tries, so that their fills differ: a view's and a layout's own
 * directions, and for other holes these, from the plainest answer to a new representation.
 */
const holeDirections = [
  'the plainest answer to the task',
  'a different representation from the one the skeleton suggests',
  'the most compact answer that still reads at a glance',
  'an answer that makes the step-by-step change easiest to follow',
  'an answer that shows the hardest case of the idea'
];

/** The kind whose model fills a group: the strongest any of its holes needs. */
const strongestKind = (holes: readonly Hole[]): HoleKind =>
  (['any', 'algorithm', 'layout', 'case', 'view'] as const).find((kind) =>
    holes.some((hole) => hole.kind === kind)
  ) ?? 'view';

/** Whether a group is a whole-picture skeleton's one hole (see representationSkeleton). */
const isWholePicture = (group: readonly Hole[]) =>
  group.length === 1 && group[0].kind === 'any' && group[0].name === pictureHole;

/** One group's helpers: their directions, prompt, and model. */
function groupRound(
  group: readonly Hole[],
  document: ProjectDocument,
  pipeline: HelperPipelineConfig,
  skeleton: string
) {
  const counts = turnHelperCounts(document);
  const kinds = group.map((hole) => hole.kind);
  const directions = isWholePicture(group)
    ? representationFamilies(skeleton)
        .slice(0, counts.views)
        .map((family) => `a whole picture drawn as ${family}`)
    : kinds.every((kind) => kind === 'view')
      ? viewHelperDirections.slice(0, counts.views)
      : kinds.every((kind) => kind === 'layout')
        ? layoutHelperDirections.slice(0, counts.layouts)
        : holeDirections.slice(0, counts.views);
  return {
    holes: group,
    directions,
    prompt: holeHelperPrompt(kinds),
    parameters: { ...pipeline.holeModels[strongestKind(group)] }
  };
}

type Reply = {
  prompt: ChatbotPrompt;
  group: number;
  durationMs: number;
} & (
  | { ok: true; result: Awaited<ReturnType<ChatAdapter['generateReply']>> }
  | { ok: false; error: unknown }
);

/** A candidate of one group, with the round's facts about it. */
type GroupCandidate = { candidate: ViewCandidate; group: number; label?: string; id: string };

/** The pipeline's record of stages, for the candidates event. */
type Stages = {
  scoring: 'on' | 'off' | 'skipped';
  choosing: 'on' | 'off' | 'skipped';
  skipped?: string;
  late: boolean;
  ms: { calls: number; builds: number; scoring: number; choosing: number };
};

/**
 * Run a helper round once the turn's reply has shown: the request becomes a skeleton (a view of a
 * type, an arrangement of a layout, or the main agent's own), its hole groups' helpers run at once,
 * each time-boxed, each fill is built and measured, then scored and chosen as the pipeline allows,
 * and the candidates are recorded for the assistant's next turn. A helper that fails, is late, or
 * proposes nothing usable costs the turn nothing; none starts with too little time left.
 */
export async function runViewHelpers(
  document: ProjectDocument,
  operationId: string,
  source: string,
  request: ViewHelpersRequest,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  const pipeline = dependencies.helperPipeline ?? helperPipeline;
  const deadline = currentProjectOperationDeadline();
  if (deadline !== undefined && deadline - Date.now() < viewHelperTimeoutMs) return document;
  const made =
    request.skeleton !== undefined
      ? { skeleton: request.skeleton, originals: {} as Record<string, string> }
      : skeletonFor(source, request);
  const parsed = made ? holesOf(made.skeleton) : undefined;
  if (!made || !parsed || 'problems' in parsed) return document;
  const { skeleton, originals } = made;
  // Each fill is built on the design file of the newest version of this source.
  const design = presentationDesign(
    document.events.findLast(
      (event): event is ProjectEventOf<'visualization.presented'> =>
        event.type === 'visualization.presented' &&
        event.payload.presentation.format === 'browser-bundle-v1' &&
        event.payload.presentation.source.text === source
    )?.payload.presentation
  );
  const constraints = request.skeleton !== undefined ? (request.constraints ?? []) : [];
  const adapter = dependencies.viewHelperAdapter ?? openAIAdapter;
  const operation = currentProjectOperationSignal();
  const background = viewHelperBackground(document);
  const roundStarted = performance.now();
  // Past the reply's wait, a round that late candidates may not join stops where it is.
  const waitSignal = pipeline.timing.lateCandidatesJoin
    ? undefined
    : AbortSignal.timeout(pipeline.timing.replyWaitMs);
  const pastWait = () => performance.now() - roundStarted > pipeline.timing.replyWaitMs;
  const groups = holeGroups(parsed.holes).map((group) =>
    groupRound(group, document, pipeline, skeleton)
  );
  let attemptNumber = 0;
  const prompts = groups.flatMap((round, group) =>
    round.directions.map((direction) => ({
      group,
      prompt: {
        initialPrompt: round.prompt,
        messages: [
          {
            role: 'user' as const,
            content: holeHelperTask({
              skeleton,
              holes: round.holes,
              count: 1,
              direction,
              constraints,
              ...(background ? { background } : {})
            })
          }
        ],
        context: {},
        attempt: { number: ++attemptNumber, purpose: 'helper' as const },
        parameters: round.parameters,
        responseFormat: proposalsFormat as unknown as ChatbotPrompt['responseFormat']
      } satisfies ChatbotPrompt,
      direction
    }))
  );
  const signalFor = () => {
    const timeout = AbortSignal.timeout(viewHelperTimeoutMs);
    return AbortSignal.any([
      timeout,
      ...(operation ? [operation] : []),
      ...(waitSignal ? [waitSignal] : [])
    ]);
  };
  const call = (batch: readonly { prompt: ChatbotPrompt; group: number }[]) =>
    Promise.all(
      batch.map(async ({ prompt, group }): Promise<Reply> => {
        const startedAt = performance.now();
        try {
          const result = await adapter.generateReply({ ...prompt, signal: signalFor() });
          return { prompt, group, ok: true, result, durationMs: performance.now() - startedAt };
        } catch (error) {
          return { prompt, group, ok: false, error, durationMs: performance.now() - startedAt };
        }
      })
    );
  let current = document;
  const generationEventIds: EventId[] = [];
  const recordCall = async (
    reply: Pick<Reply, 'prompt' | 'durationMs'> &
      (
        | { ok: true; result: Extract<Reply, { ok: true }>['result'] }
        | { ok: false; error: unknown }
      ),
    botId: string,
    adapterId: string
  ) => {
    const purpose = reply.prompt.attempt.purpose;
    current = await appendProjectEvents(
      current,
      [
        draftEvent<'ai.generation-requested'>({
          type: 'ai.generation-requested',
          actor: { kind: 'system' },
          operationId,
          payload: {
            attempt: reply.prompt.attempt.number,
            purpose,
            prompt: recordText(JSON.stringify(reply.prompt), 'application/json'),
            promptTemplateSha256: sourceSha256(reply.prompt.initialPrompt),
            requestedModel: reply.prompt.parameters.model,
            parameters: { ...reply.prompt.parameters }
          }
        }),
        reply.ok
          ? draftEvent<'ai.generation-succeeded'>({
              type: 'ai.generation-succeeded',
              actor: { kind: 'assistant', botId },
              operationId,
              payload: {
                attempt: reply.prompt.attempt.number,
                adapterId,
                requestedModel: reply.prompt.parameters.model,
                ...(reply.result.generation?.model ? { model: reply.result.generation.model } : {}),
                ...(reply.result.generation?.responseId
                  ? { responseId: reply.result.generation.responseId }
                  : {}),
                durationMs: Math.round(reply.durationMs),
                ...(reply.result.generation?.usage ? { usage: reply.result.generation.usage } : {}),
                response: recordText(
                  JSON.stringify(reply.result.providerResponse ?? reply.result.output ?? {}),
                  'application/json'
                )
              }
            })
          : draftEvent<'ai.generation-failed'>({
              type: 'ai.generation-failed',
              actor: { kind: 'system' },
              operationId,
              payload: {
                attempt: reply.prompt.attempt.number,
                failureKind: generationFailureKind(reply.error),
                durationMs: Math.round(reply.durationMs),
                message: safeErrorMessage(reply.error),
                details: recordText(
                  generationErrorDetails(reply.error).value,
                  generationErrorDetails(reply.error).mediaType
                ),
                ...(spentUsage(reply.error) ? { usage: spentUsage(reply.error) } : {})
              }
            })
      ],
      dependencies.projectService
    );
    const usage = reply.ok ? reply.result.generation?.usage : spentUsage(reply.error);
    logModelCall({
      projectId: current.projectId,
      operationId,
      attempt: reply.prompt.attempt.number,
      purpose,
      model: (reply.ok && reply.result.generation?.model) || reply.prompt.parameters.model,
      failed: !reply.ok,
      ...(usage ? { usage } : {})
    });
    generationEventIds.push(projectHead(current).id);
  };
  const record = async (replies: readonly Reply[]) => {
    for (const reply of replies) await recordCall(reply, 'sverlin-view-helper', adapter.id);
  };

  // 1. Helpers: every group's calls at once, then each proposal built and measured.
  const replies = await call(prompts);
  await record(replies);
  let callsMs = performance.now() - roundStarted;
  const proposed = replies.flatMap((reply) =>
    reply.ok
      ? parseProposals(reply.result.output).map((proposal) => ({
          proposal,
          group: reply.group,
          prompt: reply.prompt
        }))
      : []
  );
  if (!proposed.length) return current;
  // A hole the skeleton had nothing in before takes its group's first proposal while other groups
  // are built, so every candidate builds as a whole source.
  const others: Record<string, string> = { ...originals };
  for (const { proposal } of proposed)
    for (const [hole, markup] of Object.entries(fillsOf(proposal)))
      if (others[hole] === undefined) others[hole] = markup;
  const buildsStarted = performance.now();
  let longest = 0;
  // Each proposal is built in turn within one budget for the round: one that would end past it,
  // judged by the longest so far, is not started (as arrangements.server.ts bounds its layouts).
  // In turn, not at once: on one CPU, as the Render host has (render.yaml), five bfs-undirected
  // views took 4.2–5.0 s built one, two, three or five at a time (2026-11-07), and each build at
  // once holds its own isolate's memory.
  const built = async (proposal: Proposal, group: number): Promise<ViewCandidate> => {
    if (performance.now() - buildsStarted + longest > helperBuildBudgetMs)
      return { kept: false, name: proposal.name, reason: 'not built within the round’s time' };
    const begun = performance.now();
    const own = new Set(groups[group].holes.map((hole) => hole.name));
    const fills = Object.fromEntries(
      Object.entries(fillsOf(proposal)).filter(([hole]) => own.has(hole))
    );
    const result = await checkFills(skeleton, design, fills, others, proposal, constraints);
    longest = Math.max(longest, performance.now() - begun);
    return result;
  };
  const checked: GroupCandidate[] = [];
  for (const [index, { proposal, group, prompt }] of proposed.entries())
    checked.push({
      candidate: await built(proposal, group),
      group,
      id: `g${group + 1}o${index + 1}`,
      label: prompts.find((each) => each.prompt === prompt)?.direction
    });
  // A proposal that did not build or read goes back once to its helper with the reason, as a
  // repair does, rather than the helpers' prompt growing a rule for each mistake seen.
  const retried = checked
    .map((each, index) => ({ ...each, ...proposed[index] }))
    .filter(({ candidate }) => !candidate.kept)
    .slice(0, viewHelperCalls);
  const late = deadline !== undefined && deadline - Date.now() < viewHelperTimeoutMs;
  let retryCallsMs = 0;
  if (retried.length && !late && !waitSignal?.aborted) {
    const retryStarted = performance.now();
    const again = await call(
      retried.map(({ candidate, proposal, prompt, group }) => ({
        group,
        prompt: {
          ...prompt,
          messages: [
            ...prompt.messages,
            { role: 'assistant', content: JSON.stringify({ proposals: [proposal] }) },
            {
              role: 'user',
              content: `${proposal.name} was left out: ${candidate.kept ? '' : candidate.reason} Return it fixed, in the same JSON.`
            }
          ],
          attempt: { number: ++attemptNumber, purpose: 'helper' }
        }
      }))
    );
    retryCallsMs = performance.now() - retryStarted;
    await record(again);
    for (const [index, reply] of again.entries()) {
      const fixed = reply.ok ? parseProposals(reply.result.output)[0] : undefined;
      if (!fixed) continue;
      const result = await built(fixed, reply.group);
      if (!result.kept) continue;
      const at = checked.findIndex((each) => each.candidate === retried[index].candidate);
      checked[at] = { ...checked[at], candidate: result };
    }
  }
  // A retry's calls count as calls, so builds is the app's own time (project f9cbf444's 10.4 s of
  // builds held a 6.3 s retry call).
  const buildsMs = performance.now() - buildsStarted - retryCallsMs;
  callsMs += retryCallsMs;
  // Whole pictures that draw the same shapes in the same arrangement are one picture, however their
  // kinds are named: the best measured of each is kept, before scoring spends a call on the rest.
  const kept = distinctPictures(
    checked.filter(({ candidate }) => candidate.kept),
    (each) => isWholePicture(groups[each.group].holes)
  );
  const stages: Stages = {
    scoring: pipeline.scoring.enabled ? 'on' : 'off',
    choosing: pipeline.choosing.enabled ? 'on' : 'off',
    late: false,
    ms: { calls: Math.round(callsMs), builds: Math.round(buildsMs), scoring: 0, choosing: 0 }
  };
  const skip = (stage: 'scoring' | 'choosing', why: string) => {
    if (stages[stage] !== 'on') return;
    stages[stage] = 'skipped';
    stages.skipped = stages.skipped ? `${stages.skipped}; ${why}` : why;
  };
  if (!pipeline.timing.lateCandidatesJoin && pastWait()) {
    skip('scoring', 'past the reply’s wait');
    skip('choosing', 'past the reply’s wait');
  }

  // 2. Scoring: pictures of each kept fill, a view alone or the whole picture, judged at once.
  let scores = new Map<string, OptionScore>();
  if (stages.scoring === 'on' && kept.length) {
    const started = performance.now();
    try {
      const options = await scoringOptions(kept, groups);
      const scored = await scoreOptions(
        options,
        pipeline.scoring.model,
        dependencies.decide ?? createDecisions,
        operation
      );
      scores = scored.scores;
      await recordScoring(scored.calls, recordCall);
      if (!scores.size) skip('scoring', 'no call returned a score');
    } catch (cause) {
      skip('scoring', `no pictures: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    stages.ms.scoring = Math.round(performance.now() - started);
  }
  const listed = shortlists(
    kept.map((each) => ({
      ...each,
      group: String(each.group),
      measure: each.candidate.kept ? (each.candidate.facts?.score ?? 0) : 0
    })),
    scores,
    pipeline.scoring.shortlist
  );
  const shortlisted = [...listed.values()].flat();
  if (!pipeline.timing.lateCandidatesJoin && pastWait()) skip('choosing', 'past the reply’s wait');

  // 3. Choosing: the designing model picks which fills go together; the app builds only those.
  let finals: {
    candidate: ViewCandidate;
    label?: string;
    group: string;
    score?: OptionScore;
    why?: string;
  }[] = shortlisted.map((each) => ({
    candidate: each.candidate,
    ...(each.label ? { label: each.label } : {}),
    group: `g${Number(each.group) + 1}`,
    ...(scores.has(each.id) ? { score: scores.get(each.id) } : {})
  }));
  // With one group nothing goes together, so its shortlist is the answer (project f9cbf444's one
  // group of Int waited 8.9 s for the choice).
  if (listed.size === 1) skip('choosing', 'one hole group: its shortlist is the choice');
  if (stages.choosing === 'on' && shortlisted.length) {
    const started = performance.now();
    const shortlistedGroups: ShortlistedGroup[] = [...listed].map(([group, members]) => ({
      id: `g${Number(group) + 1}`,
      holes: groups[Number(group)].holes.map(
        (hole) =>
          `${hole.name} (${hole.kind}${hole.of ? ` of ${hole.of}` : ''}): ${hole.task || 'open'}`
      ),
      options: members.flatMap(({ id, candidate }) =>
        candidate.kept
          ? [
              {
                id,
                name: candidate.name,
                description: candidate.description,
                facts: candidate.facts ? factsText(candidate.facts) : '',
                ...(scores.has(id)
                  ? { score: scores.get(id)!.score, answers: scores.get(id)!.answers }
                  : {})
              }
            ]
          : []
      )
    }));
    const prompt: ChatbotPrompt = {
      initialPrompt: choosingInstructions,
      messages: [
        {
          role: 'user',
          content: choosingInput(shortlistedGroups, pipeline.choosing.combinations, request.task)
        }
      ],
      context: {},
      attempt: { number: ++attemptNumber, purpose: 'choosing' },
      parameters: { ...pipeline.choosing.parameters },
      responseFormat: combineDecisionFormat as unknown as ChatbotPrompt['responseFormat']
    };
    const startedAt = performance.now();
    let combinations: ReturnType<typeof validCombinations> = [];
    try {
      const result = await adapter.generateReply({ ...prompt, signal: signalFor() });
      await recordCall(
        { prompt, ok: true, result, durationMs: performance.now() - startedAt },
        'sverlin-chooser',
        adapter.id
      );
      combinations = validCombinations(
        result.output,
        shortlistedGroups,
        pipeline.choosing.combinations
      );
    } catch (error) {
      await recordCall(
        { prompt, ok: false, error, durationMs: performance.now() - startedAt },
        'sverlin-chooser',
        adapter.id
      );
    }
    const chosen: typeof finals = [];
    for (const combination of combinations) {
      const picked = combination.picks.flatMap(({ option }) => {
        const found = shortlisted.find((each) => each.id === option);
        return found?.candidate.kept ? [found.candidate] : [];
      });
      const fills = Object.assign(
        {},
        ...picked.map((candidate) => (candidate.kept ? candidate.fills : {}))
      );
      const result =
        picked.length === 1
          ? picked[0]
          : await checkFills(skeleton, design, fills, others, {
              name: picked.map((candidate) => candidate.name).join(' + '),
              description: picked
                .map((candidate) => (candidate.kept ? candidate.description : ''))
                .join('; ')
            });
      if (result.kept)
        chosen.push({
          candidate: result,
          group: combination.picks.map(({ group }) => group).join('+'),
          why: combination.why,
          ...(picked.length === 1 && scores.has(combination.picks[0].option)
            ? { score: scores.get(combination.picks[0].option) }
            : {})
        });
    }
    if (chosen.length) finals = chosen;
    else skip('choosing', 'no combination the designing model chose built');
    stages.ms.choosing = Math.round(performance.now() - started);
  }
  stages.late = pastWait();
  // A round its operation cancelled, as participant work does a background one, records no
  // candidates, only the calls it spent.
  if (operation?.aborted) return current;

  const best = new Set(
    bestCandidates(
      finals.map(({ candidate }) => candidate),
      candidatesGiven
    )
  );
  const offered = finals.filter(({ candidate }) => best.has(candidate));
  return appendProjectEvents(
    current,
    [
      draftEvent<'visualization.view-candidates'>({
        type: 'visualization.view-candidates',
        actor: { kind: 'system' },
        operationId,
        payload: {
          sourceSha256: sourceSha256(source),
          ...(request.skeleton !== undefined
            ? { skeleton }
            : request.layout !== undefined
              ? { layout: request.layout }
              : { type: request.type }),
          ...(request.task ? { task: request.task } : {}),
          ...(request.skeleton !== undefined && request.option ? { option: request.option } : {}),
          generationEventIds,
          candidates: offered.flatMap(({ candidate, label, group, score, why }) =>
            candidate.kept
              ? [
                  {
                    name: candidate.name,
                    description: candidate.description,
                    markup: candidate.markup,
                    ...(candidate.readability ? { readability: candidate.readability } : {}),
                    ...(label ? { label: label.slice(0, 200) } : {}),
                    ...(request.skeleton !== undefined && candidate.fills
                      ? { fills: candidate.fills }
                      : {}),
                    group,
                    ...(candidate.facts ? { facts: factsText(candidate.facts) } : {}),
                    ...(score ? { score: score.score, answers: score.answers } : {}),
                    ...(why ? { why: why.slice(0, 500) } : {})
                  }
                ]
              : []
          ),
          dropped: checked.flatMap(({ candidate }) =>
            candidate.kept
              ? offered.some((each) => each.candidate === candidate)
                ? []
                : [{ name: candidate.name, reason: 'drew alike, or ranked below the best' }]
              : [{ name: candidate.name, reason: candidate.reason }]
          ),
          stages
        }
      })
    ],
    dependencies.projectService
  );
}

/**
 * What the scoring stage judges of each kept fill: a group of one view hole is a component, drawn
 * alone for a few of its values; any other is judged in context, the whole picture at its telltale
 * steps. Each picture is as wide as it shows on the typical stage.
 */
async function scoringOptions(
  kept: readonly GroupCandidate[],
  groups: readonly { holes: readonly Hole[] }[]
): Promise<ScoringOption[]> {
  const options: ScoringOption[] = [];
  for (const { candidate, group, id } of kept) {
    if (!candidate.kept || !candidate.built?.layout.scenes || !candidate.facts) continue;
    const { frame, steps } = candidate.built.layout.scenes;
    const holes = groups[group].holes;
    const view = holes.length === 1 && holes[0].kind === 'view' ? holes[0].of : undefined;
    const alone = view ? viewAlone({ frame, steps }, view) : undefined;
    const scale = candidate.facts.scale;
    const pictures = alone
      ? await scenePictures(alone, alone.frame.width * scale)
      : await scenePictures(
          { frame, steps: telltaleSteps(steps).map((index) => steps[index]) },
          frame.width * scale
        );
    options.push({
      id,
      group: String(group),
      look: alone ? 'component' : 'context',
      pictures,
      facts: factsText(candidate.facts),
      measure: candidate.facts.score
    });
  }
  return options;
}

/** Each scoring call on the Timeline and in the logs, as the helpers' calls are. */
async function recordScoring(
  calls: readonly ScoringCall[],
  recordCall: (
    reply: {
      prompt: ChatbotPrompt;
      durationMs: number;
    } & (
      | { ok: true; result: Extract<Reply, { ok: true }>['result'] }
      | { ok: false; error: unknown }
    ),
    botId: string,
    adapterId: string
  ) => Promise<void>
) {
  for (const [index, call] of calls.entries()) {
    const prompt: ChatbotPrompt = {
      initialPrompt: 'decisions',
      messages: [{ role: 'user', content: JSON.stringify(call.request) }],
      context: { option: call.optionId },
      attempt: { number: index + 1, purpose: 'scoring' },
      parameters: { model: call.model },
      responseFormat: { name: 'decisions', schema: {} }
    };
    const usage = call.response ? decisionsUsage(call.response) : undefined;
    await recordCall(
      call.response
        ? {
            prompt,
            durationMs: call.durationMs,
            ok: true,
            result: {
              output: call.response,
              providerResponse: call.response,
              generation: {
                model: call.response.model ?? call.model,
                ...(call.response.id ? { responseId: call.response.id } : {}),
                ...(usage ? { usage } : {})
              }
            } as Extract<Reply, { ok: true }>['result']
          }
        : { prompt, durationMs: call.durationMs, ok: false, error: call.error },
      'sverlin-scorer',
      'openai-decisions'
    );
  }
}

/**
 * The kept candidates with one of each whole picture that draws alike in shape (drawingShape), the
 * best measured first; candidates `compared` leaves out pass as they are.
 */
export function distinctPictures<Each extends { candidate: ViewCandidate }>(
  kept: readonly Each[],
  compared: (each: Each) => boolean
): Each[] {
  const score = ({ candidate }: Each) => (candidate.kept ? (candidate.facts?.score ?? 0) : 0);
  const seen = new Set<string>();
  const distinct = new Set(
    kept
      .filter(compared)
      .toSorted((a, b) => score(b) - score(a))
      .filter(({ candidate }) => {
        const shape = candidate.kept && candidate.built ? drawingShape(candidate.built) : undefined;
        if (shape === undefined) return true;
        if (seen.has(shape)) return false;
        seen.add(shape);
        return true;
      })
  );
  return kept.filter((each) => !compared(each) || distinct.has(each));
}
