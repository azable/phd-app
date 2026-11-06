/** The view and layout helpers' rounds during a Sverlin turn (see ../view-helpers.server.ts). */

/** Mode-neutral AI feedback, candidate validation, and bounded attempt orchestration. */

import type { EventId } from '$lib/shared/projects/events';
import type { ProjectDocument } from '$lib/shared/projects/model';
import { waitingComparisons } from '$lib/shared/projects/presentation-buffer';
import { projectHead, projectSnapshotAt } from '$lib/shared/projects/projection';
import { pendingAssistantTurnRequests } from '$lib/shared/projects/operations';
import {
  bestCandidates,
  checkCandidate,
  checkLayoutCandidate,
  layoutHelperDirections,
  layoutHelperPrompt,
  layoutHelperTask,
  proposedViewsFormat,
  viewHelperDirections,
  viewHelperPrompt,
  viewHelperTask,
  type ProposedView,
  type ViewCandidate
} from '$lib/modes/sverlin/assistant/view-helpers.server';
import { openAIAdapter } from '$lib/server/ai/providers/openai';
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

/** The view helpers' model and effort (see attempt-profiles.ts for why they cost no waiting). */
export const viewHelperParameters = {
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
  maxOutputTokens: 8000
} as const;

/**
 * Ask the view helpers for alternative views of one type of a source, once the turn's reply has
 * shown: their calls run at once, each time-boxed, then each proposal is built and checked, and
 * those that build and read are recorded for the assistant's next turn. A helper that fails, is
 * late, or proposes nothing usable costs the turn nothing; none starts with too little time left.
 */
export async function runViewHelpers(
  document: ProjectDocument,
  operationId: string,
  source: string,
  request: ViewHelpersRequest,
  dependencies: ProjectCommandDependencies
): Promise<ProjectDocument> {
  const deadline = currentProjectOperationDeadline();
  if (deadline !== undefined && deadline - Date.now() < viewHelperTimeoutMs) return document;
  const adapter = dependencies.viewHelperAdapter ?? openAIAdapter;
  const operation = currentProjectOperationSignal();
  const background = viewHelperBackground(document);
  const { task } = request;
  // A round proposes views of a type, or arrangements of a layout: the same calls and checks,
  // each kind with its own prompt, directions and build.
  const round =
    request.layout !== undefined
      ? {
          part: request.layout,
          prompt: layoutHelperPrompt,
          directions: layoutHelperDirections.slice(0, turnHelperCounts(document).layouts),
          ask: (direction: string) =>
            layoutHelperTask({ layout: request.layout, source, direction, task, background }),
          check: (view: ProposedView) => checkLayoutCandidate(source, request.layout, view)
        }
      : {
          part: request.type,
          prompt: viewHelperPrompt,
          directions: viewHelperDirections.slice(0, turnHelperCounts(document).views),
          ask: (direction: string) =>
            viewHelperTask({ type: request.type, count: 1, source, direction, task, background }),
          check: (view: ProposedView) => checkCandidate(source, request.type, view)
        };
  const prompts: ChatbotPrompt[] = round.directions.map((direction, index) => ({
    initialPrompt: round.prompt,
    messages: [{ role: 'user', content: round.ask(direction) }],
    context: {},
    attempt: { number: index + 1, purpose: 'helper' },
    parameters: { ...viewHelperParameters },
    responseFormat: proposedViewsFormat as unknown as ChatbotPrompt['responseFormat']
  }));
  const call = (batch: ChatbotPrompt[]) =>
    Promise.all(
      batch.map(async (prompt) => {
        const startedAt = performance.now();
        const timeout = AbortSignal.timeout(viewHelperTimeoutMs);
        const signal = operation ? AbortSignal.any([operation, timeout]) : timeout;
        try {
          const result = await adapter.generateReply({ ...prompt, signal });
          const views = (
            (result.output as { views?: ProposedView[] } | undefined)?.views ?? []
          ).filter(
            (view) =>
              typeof view?.name === 'string' &&
              typeof view.description === 'string' &&
              typeof view.markup === 'string'
          );
          return {
            prompt,
            ok: true as const,
            result,
            views,
            durationMs: performance.now() - startedAt
          };
        } catch (error) {
          return { prompt, ok: false as const, error, durationMs: performance.now() - startedAt };
        }
      })
    );
  let current = document;
  const generationEventIds: EventId[] = [];
  const record = async (replies: Awaited<ReturnType<typeof call>>) => {
    for (const reply of replies) {
      current = await appendProjectEvents(
        current,
        [
          draftEvent<'ai.generation-requested'>({
            type: 'ai.generation-requested',
            actor: { kind: 'system' },
            operationId,
            payload: {
              attempt: reply.prompt.attempt.number,
              purpose: 'helper',
              prompt: recordText(JSON.stringify(reply.prompt), 'application/json'),
              promptTemplateSha256: sourceSha256(reply.prompt.initialPrompt),
              requestedModel: reply.prompt.parameters.model,
              parameters: { ...reply.prompt.parameters }
            }
          }),
          reply.ok
            ? draftEvent<'ai.generation-succeeded'>({
                type: 'ai.generation-succeeded',
                actor: { kind: 'assistant', botId: 'sverlin-view-helper' },
                operationId,
                payload: {
                  attempt: reply.prompt.attempt.number,
                  adapterId: adapter.id,
                  requestedModel: reply.prompt.parameters.model,
                  ...(reply.result.generation?.model
                    ? { model: reply.result.generation.model }
                    : {}),
                  ...(reply.result.generation?.responseId
                    ? { responseId: reply.result.generation.responseId }
                    : {}),
                  durationMs: Math.round(reply.durationMs),
                  ...(reply.result.generation?.usage
                    ? { usage: reply.result.generation.usage }
                    : {}),
                  response: recordText(
                    JSON.stringify(reply.result.providerResponse ?? { views: reply.views }),
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
        purpose: 'helper',
        model: (reply.ok && reply.result.generation?.model) || reply.prompt.parameters.model,
        failed: !reply.ok,
        ...(usage ? { usage } : {})
      });
      generationEventIds.push(projectHead(current).id);
    }
  };
  const replies = await call(prompts);
  await record(replies);
  const proposed = replies.flatMap((reply) =>
    reply.ok ? reply.views.map((view) => ({ view, prompt: reply.prompt })) : []
  );
  if (!proposed.length) return current;
  // Each proposal is built in turn within one budget for the round: one that would end past it,
  // judged by the longest so far, is not started (as arrangements.server.ts bounds its layouts).
  const started = performance.now();
  let longest = 0;
  const built = async (view: ProposedView): Promise<ViewCandidate> => {
    if (performance.now() - started + longest > helperBuildBudgetMs)
      return { kept: false, name: view.name, reason: 'not built within the round’s time' };
    const begun = performance.now();
    const result = await round.check(view);
    longest = Math.max(longest, performance.now() - begun);
    return result;
  };
  const checked: ViewCandidate[] = [];
  for (const { view } of proposed) checked.push(await built(view));
  // What each proposal's helper tried, so arrangements of one layout, all named after it, differ.
  const labels = new Map<ViewCandidate, string>();
  proposed.forEach(({ prompt }, index) => {
    const direction = round.directions[prompt.attempt.number - 1];
    if (direction) labels.set(checked[index], direction);
  });
  // A proposal that did not build or read goes back once to its helper with the reason, as a
  // repair does, rather than the helpers' prompt growing a rule for each mistake seen.
  const retried = checked
    .map((candidate, index) => ({ candidate, ...proposed[index] }))
    .filter(({ candidate }) => !candidate.kept)
    .slice(0, viewHelperCalls);
  const late = deadline !== undefined && deadline - Date.now() < viewHelperTimeoutMs;
  if (retried.length && !late) {
    const again = await call(
      retried.map(({ candidate, view, prompt }, index) => ({
        ...prompt,
        messages: [
          ...prompt.messages,
          { role: 'assistant', content: JSON.stringify({ views: [view] }) },
          {
            role: 'user',
            content: `${view.name} was left out: ${candidate.kept ? '' : candidate.reason} Return it fixed, as {"views":[{"name","description","markup"}]}.`
          }
        ],
        attempt: { number: round.directions.length + index + 1, purpose: 'helper' }
      }))
    );
    await record(again);
    for (const [index, reply] of again.entries()) {
      const fixed = reply.ok ? reply.views[0] : undefined;
      if (!fixed) continue;
      const result = await built(fixed);
      if (!result.kept) continue;
      const label = labels.get(retried[index].candidate);
      if (label) labels.set(result, label);
      checked[checked.indexOf(retried[index].candidate)] = result;
    }
  }
  const best = bestCandidates(checked, candidatesGiven);
  return appendProjectEvents(
    current,
    [
      draftEvent<'visualization.view-candidates'>({
        type: 'visualization.view-candidates',
        actor: { kind: 'system' },
        operationId,
        payload: {
          sourceSha256: sourceSha256(source),
          ...(request.layout !== undefined ? { layout: request.layout } : { type: request.type }),
          ...(task ? { task } : {}),
          generationEventIds,
          candidates: best.flatMap((candidate) =>
            candidate.kept
              ? [
                  {
                    name: candidate.name,
                    description: candidate.description,
                    markup: candidate.markup,
                    ...(candidate.readability ? { readability: candidate.readability } : {}),
                    ...(labels.has(candidate) ? { label: labels.get(candidate) } : {})
                  }
                ]
              : []
          ),
          dropped: checked.flatMap((candidate) =>
            candidate.kept
              ? best.includes(candidate)
                ? []
                : [{ name: candidate.name, reason: 'drew alike, or ranked below the best' }]
              : [{ name: candidate.name, reason: candidate.reason }]
          )
        }
      })
    ],
    dependencies.projectService
  );
}
