/**
 * One operation's model calls and builds on a shared time axis, for the developer view: each
 * attempt of the ladder, each build it led to, and the helper round's calls (helpers, scoring,
 * choosing), read from the recorded events, so a turn's agents, repairs and failures read at a
 * glance. It is the developer view's one item for an operation's calls: each call's bar opens its
 * request.
 *
 * @packageDocumentation
 */

import { callCost, costText, costTotal, type AiCall } from '$lib/shared/projects/ai-costs';
import type { ProjectEvent } from '$lib/shared/projects/events';
import { escalationText } from '$lib/shared/projects/events/ai-generation';
import { backgroundOperationKinds } from '$lib/shared/projects/events/operation-lifecycle';
import { isSverlinPresentation } from '$lib/shared/presentations';

import { agentRequests } from './agent-requests';

export type ChartOutcome = 'ok' | 'failed' | 'rejected' | 'incomplete' | 'pending';

/** One bar: a model call or a build, from its start to its end, in ms from the chart's start. */
export type ChartBar = {
  id: string;
  /** The reply's ladder, a helper round's agents by their part, or a build. */
  kind: 'call' | 'helper' | 'scoring' | 'choosing' | 'build';
  /** The model request a call's bar stands for, by its event id; none for a build. */
  requestId?: number;
  label: string;
  /** What a click shows: the error, the tokens, the model. */
  detail: string;
  start: number;
  end: number;
  outcome: ChartOutcome;
};

/** A moment without length: the reply shown, a held question asked, the helpers' candidates. */
export type ChartMark = { id: string; at: number; label: string };

export type TurnChart = {
  /** What ran: the operation's kind, as assistant-turn or prepare-answers. */
  operation?: string;
  /** Whether the system ran it in the background, which participant work cancels. */
  background: boolean;
  /** Its calls, tokens and cost in a line, where it called a model. */
  cost?: string;
  /** Its length in ms, from the first bar's start to the last bar's or mark's end. */
  span: number;
  bars: ChartBar[];
  marks: ChartMark[];
  /** The turn the app started by itself once the helpers' candidates arrived. */
  followUp: boolean;
  /** The warnings the presentations it built kept, each once, as the assistant is told them. */
  warnings: string[];
};

/** One operation's chart, or none where it called no model and built nothing. */
export function turnChart(
  related: readonly ProjectEvent[],
  all: readonly ProjectEvent[] = related
): TurnChart | undefined {
  const time = (event: ProjectEvent) => Date.parse(event.createdAt);
  const bars: (Omit<ChartBar, 'start' | 'end'> & { from: number; to: number })[] = [];
  const calls: AiCall[] = [];

  for (const request of agentRequests(related)) {
    const { attempt, purpose, parameters } = request.request.payload;
    const model = String(parameters.model ?? request.request.payload.requestedModel);
    const effort = parameters.reasoningEffort ? String(parameters.reasoningEffort) : '';
    const outcome = request.outcome;
    // Helpers record their request once they are done, so a call runs back from its outcome.
    const to = outcome ? time(outcome) : time(request.request);
    const from = outcome ? to - outcome.payload.durationMs : to;
    const usage = outcome?.payload.usage ?? {};
    const result = callResult(request.actions, outcome);
    const seconds = outcome ? `${Math.round(outcome.payload.durationMs / 1000)} s` : '…';
    const cost = outcome?.payload.usage ? callCost(model, usage) : undefined;
    if (outcome)
      calls.push({
        requestEventId: request.request.id,
        operationId: request.request.operationId,
        attempt,
        purpose,
        model,
        failed: outcome.type === 'ai.generation-failed',
        usage,
        ...(cost !== undefined ? { costUsd: cost } : {})
      });
    // The pipeline's calls after the reply, its helpers, scoring and choosing, run beside it.
    const agent = purpose === 'helper' || purpose === 'scoring' || purpose === 'choosing';
    bars.push({
      id: `call-${request.request.id}`,
      kind: agent ? purpose : 'call',
      requestId: request.request.id,
      label: agent
        ? `${purpose} ${shortModel(model)} ${seconds}${result.outcome === 'ok' ? '' : ` → ${result.label}`}`
        : `${attempt} ${purpose} ${effort} ${seconds} → ${result.label}`,
      detail: [
        `attempt ${attempt} · ${purpose} · ${shortModel(model)}${effort ? ` · ${effort}` : ''}`,
        request.request.payload.escalation
          ? escalationText(request.request.payload.escalation)
          : '',
        tokensText(usage, cost),
        result.detail
      ]
        .filter(Boolean)
        .join('\n'),
      from,
      to,
      outcome: result.outcome
    });
  }

  const builds = Map.groupBy(
    related.filter(
      (event) =>
        (event.type === 'build.requested' ||
          event.type === 'build.succeeded' ||
          event.type === 'build.failed') &&
        event.payload.buildId
    ),
    (event) => (event.payload as { buildId: string }).buildId
  );
  for (const [buildId, events] of builds) {
    const done = events.filter(
      (event) => event.type === 'build.succeeded' || event.type === 'build.failed'
    );
    if (!done.length) continue;
    const failed = done.find((event) => event.type === 'build.failed');
    const to = Math.max(...done.map(time));
    const from = Math.min(
      ...done.map((event) => time(event) - (event.payload as { durationMs: number }).durationMs)
    );
    const diagnostic = failed?.type === 'build.failed' ? failed.payload.diagnostics[0] : undefined;
    bars.push({
      id: `build-${buildId}`,
      kind: 'build',
      label: `build ×${done.length} → ${failed ? (diagnostic?.code ?? 'failed') : 'ok'}`,
      detail:
        failed?.type === 'build.failed' ? (diagnostic?.message ?? failed.payload.error ?? '') : '',
      from,
      to,
      outcome: failed ? 'failed' : 'ok'
    });
  }

  const marks: (Omit<ChartMark, 'at'> & { when: number })[] = [];
  for (const event of related) {
    if (event.type === 'assistant.responded')
      marks.push({
        id: `mark-${event.id}`,
        when: time(event),
        label: event.payload.releases !== undefined ? 'question asked' : 'reply'
      });
    else if (event.type === 'visualization.view-candidates')
      marks.push({
        id: `mark-${event.id}`,
        when: time(event),
        label: `${event.payload.candidates.length} candidates`
      });
  }
  if (!bars.length) return undefined;

  const origin = Math.min(...bars.map(({ from }) => from), ...marks.map(({ when }) => when));
  const accepted = related.find((event) => event.type === 'operation.accepted');
  const operation = accepted?.type === 'operation.accepted' ? accepted.payload.kind : undefined;
  const end = Math.max(...bars.map(({ to }) => to), ...marks.map(({ when }) => when));
  const candidates = new Set(
    all.filter(({ type }) => type === 'visualization.view-candidates').map(({ id }) => id)
  );
  const warnings = new Set(
    related.flatMap((event) =>
      event.type === 'visualization.presented' && isSverlinPresentation(event.payload.presentation)
        ? (event.payload.presentation.warnings ?? [])
        : []
    )
  );
  return {
    ...(operation ? { operation } : {}),
    background: operation !== undefined && backgroundOperationKinds.has(operation),
    ...(calls.length ? { cost: costText(costTotal(calls)) } : {}),
    span: Math.max(end - origin, 1),
    bars: bars
      .map(({ from, to, ...bar }) => ({
        ...bar,
        start: from - origin,
        end: to - origin,
        detail: [`at ${inSeconds(from - origin)} for ${inSeconds(to - from)}`, bar.detail]
          .filter(Boolean)
          .join('\n')
      }))
      .toSorted((a, b) => a.start - b.start),
    marks: marks.map(({ when, ...mark }) => ({ ...mark, at: when - origin })),
    warnings: [...warnings],
    followUp: related.some(
      (event) =>
        event.type === 'assistant.turn-started' &&
        event.payload.interactionEventIds.some((id) => candidates.has(id))
    )
  };
}

/** What came of a call: its build's first problem, a rejection, or a failed response. */
function callResult(
  actions: readonly ProjectEvent[],
  outcome: ProjectEvent | undefined
): { outcome: ChartOutcome; label: string; detail: string } {
  if (!outcome) return { outcome: 'pending', label: 'waiting', detail: '' };
  if (outcome.type === 'ai.generation-failed')
    return {
      outcome: 'incomplete',
      label: outcome.payload.failureKind,
      detail: outcome.payload.message
    };
  const rejected = actions.find((event) => event.type === 'revision.edits-rejected');
  const failed = actions.find((event) => event.type === 'build.failed');
  if (failed?.type === 'build.failed') {
    const diagnostic = failed.payload.diagnostics[0];
    return {
      outcome: 'failed',
      label: diagnostic?.code ?? 'build failed',
      detail: diagnostic?.message ?? failed.payload.error ?? ''
    };
  }
  if (rejected?.type === 'revision.edits-rejected')
    return {
      outcome: 'rejected',
      label: `rejected ${rejected.payload.rejected ?? 'edits'}`,
      detail: rejected.payload.problems.join('\n')
    };
  return { outcome: 'ok', label: 'ok', detail: '' };
}

/** The tokens a call used, and its cost where its model has a price. */
function tokensText(usage: Record<string, number>, cost: number | undefined): string {
  const parts = [
    usage.inputTokens !== undefined && `${usage.inputTokens.toLocaleString('en')} in`,
    usage.cachedInputTokens !== undefined &&
      `${usage.cachedInputTokens.toLocaleString('en')} cached`,
    usage.outputTokens !== undefined && `${usage.outputTokens.toLocaleString('en')} out`,
    usage.reasoningTokens !== undefined &&
      `${usage.reasoningTokens.toLocaleString('en')} reasoning`,
    cost !== undefined && `${cost.toFixed(4)}`
  ].filter(Boolean);
  return parts.join(' · ');
}

/** A length of time in seconds, to a tenth. */
function inSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** A model's name without its family prefix: gpt-5.6-sol as sol. */
function shortModel(model: string): string {
  return model.replace(/^gpt-[\d.]+-/u, '');
}
