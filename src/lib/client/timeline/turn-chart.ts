/**
 * One operation's model calls and builds on a shared time axis, for the developer view: each
 * attempt of the ladder, each build it led to, and the view helpers' parallel calls, read from the
 * recorded events, so a turn's repairs and failures read at a glance.
 *
 * @packageDocumentation
 */

import type { ProjectEvent } from '$lib/shared/projects/events';

import { agentRequests } from './agent-requests';

export type ChartOutcome = 'ok' | 'failed' | 'rejected' | 'incomplete' | 'pending';

/** One bar: a model call or a build, from its start to its end, in ms from the chart's start. */
export type ChartBar = {
  id: string;
  kind: 'call' | 'helper' | 'build';
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
  /** Its length in ms, from the first bar's start to the last bar's or mark's end. */
  span: number;
  bars: ChartBar[];
  marks: ChartMark[];
  /** The turn the app started by itself once the helpers' candidates arrived. */
  followUp: boolean;
};

/** One operation's chart, or none where it called no model and built nothing. */
export function turnChart(
  related: readonly ProjectEvent[],
  all: readonly ProjectEvent[] = related
): TurnChart | undefined {
  const time = (event: ProjectEvent) => Date.parse(event.createdAt);
  const bars: (Omit<ChartBar, 'start' | 'end'> & { from: number; to: number })[] = [];

  for (const request of agentRequests(related)) {
    const { attempt, purpose, parameters } = request.request.payload;
    const model = String(parameters.model ?? request.request.payload.requestedModel);
    const effort = parameters.reasoningEffort ? String(parameters.reasoningEffort) : '';
    const outcome = request.outcome;
    // Helpers record their request once they are done, so a call runs back from its outcome.
    const to = outcome ? time(outcome) : time(request.request);
    const from = outcome ? to - outcome.payload.durationMs : to;
    const usage = outcome?.type === 'ai.generation-succeeded' ? (outcome.payload.usage ?? {}) : {};
    const result = callResult(request.actions, outcome);
    const seconds = outcome ? `${Math.round(outcome.payload.durationMs / 1000)} s` : '…';
    bars.push({
      id: `call-${request.request.id}`,
      kind: purpose === 'helper' ? 'helper' : 'call',
      label:
        purpose === 'helper'
          ? `helper ${shortModel(model)} ${seconds}`
          : `${attempt} ${purpose} ${effort} ${seconds} → ${result.label}`,
      detail: [
        `${shortModel(model)}${effort ? ` · ${effort}` : ''}`,
        tokensText(usage),
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
  const end = Math.max(...bars.map(({ to }) => to), ...marks.map(({ when }) => when));
  const candidates = new Set(
    all.filter(({ type }) => type === 'visualization.view-candidates').map(({ id }) => id)
  );
  return {
    span: Math.max(end - origin, 1),
    bars: bars
      .map(({ from, to, ...bar }) => ({ ...bar, start: from - origin, end: to - origin }))
      .toSorted((a, b) => a.start - b.start),
    marks: marks.map(({ when, ...mark }) => ({ ...mark, at: when - origin })),
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

/** The tokens a call used, and its cost where recorded. */
function tokensText(usage: Record<string, number>): string {
  const parts = [
    usage.inputTokens !== undefined && `${usage.inputTokens.toLocaleString('en')} in`,
    usage.cachedTokens !== undefined && `${usage.cachedTokens.toLocaleString('en')} cached`,
    usage.outputTokens !== undefined && `${usage.outputTokens.toLocaleString('en')} out`,
    usage.reasoningTokens !== undefined &&
      `${usage.reasoningTokens.toLocaleString('en')} reasoning`,
    usage.costUsd !== undefined && `$${usage.costUsd.toFixed(4)}`
  ].filter(Boolean);
  return parts.join(' · ');
}

/** A model's name without its family prefix: gpt-5.6-sol as sol. */
function shortModel(model: string): string {
  return model.replace(/^gpt-[\d.]+-/u, '');
}
