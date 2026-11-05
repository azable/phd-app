import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from '$lib/shared/projects/events';

import { turnChart } from './turn-chart';

/** Events of one operation, numbered in order, each at the second given. */
function events(entries: [number, string, Record<string, unknown>][]): ProjectEvent[] {
  return entries.map(
    ([second, type, payload], index) =>
      ({
        id: index + 1,
        operationId: 'op',
        actor: { kind: 'system' },
        createdAt: new Date(Date.UTC(2026, 10, 5, 0, 0, second)).toISOString(),
        type,
        payload
      }) as unknown as ProjectEvent
  );
}

const call = (attempt: number, purpose: string, effort: string) => ({
  attempt,
  purpose,
  requestedModel: 'gpt-5.6-sol',
  parameters: { model: 'gpt-5.6-sol', reasoningEffort: effort }
});
const done = (attempt: number, durationMs: number) => ({
  attempt,
  durationMs,
  usage: { inputTokens: 44000, outputTokens: 900 }
});
const failedBuild = (buildId: string, code: string) => ({
  buildId,
  durationMs: 100,
  diagnostics: [{ code, message: `${code} here` }]
});

describe('a turn chart', () => {
  it('draws a ladder of two failed attempts and a fallback, each with its build', () => {
    const chart = turnChart(
      events([
        [0, 'ai.generation-requested', call(1, 'initial', 'medium')],
        [40, 'ai.generation-succeeded', done(1, 40_000)],
        [41, 'build.failed', failedBuild('b1', 'draw_failed')],
        [41, 'ai.generation-requested', call(2, 'repair', 'medium')],
        [61, 'ai.generation-succeeded', done(2, 20_000)],
        [62, 'build.failed', failedBuild('b2', 'view_storyboard')],
        [62, 'ai.generation-requested', call(3, 'fallback', 'high')],
        [90, 'ai.generation-succeeded', done(3, 28_000)],
        [91, 'build.succeeded', { buildId: 'b3', durationMs: 500 }],
        [92, 'assistant.responded', { content: [] }]
      ])
    )!;
    expect(
      chart.bars.filter(({ kind }) => kind === 'call').map(({ label, outcome }) => [label, outcome])
    ).toEqual([
      ['1 initial medium 40 s → draw_failed', 'failed'],
      ['2 repair medium 20 s → view_storyboard', 'failed'],
      ['3 fallback high 28 s → ok', 'ok']
    ]);
    expect(chart.bars.filter(({ kind }) => kind === 'build').map(({ label }) => label)).toEqual([
      'build ×1 → draw_failed',
      'build ×1 → view_storyboard',
      'build ×1 → ok'
    ]);
    expect(chart.bars[0]).toMatchObject({ start: 0, end: 40_000 });
    expect(chart.bars[0].detail).toContain('44,000 in · 900 out');
    expect(chart.bars[0].detail).toContain('draw_failed here');
    expect(chart.marks).toEqual([{ id: 'mark-10', at: 92_000, label: 'reply' }]);
    expect(chart.span).toBe(92_000);
  });

  it("draws the helpers' calls after the reply, running back from when they were recorded", () => {
    const helper = {
      ...call(1, 'helper', 'low'),
      parameters: { model: 'gpt-5.6-luna', reasoningEffort: 'low' }
    };
    const chart = turnChart(
      events([
        [0, 'ai.generation-requested', call(1, 'initial', 'low')],
        [5, 'ai.generation-succeeded', done(1, 5000)],
        [5, 'assistant.responded', { content: [] }],
        [12, 'ai.generation-requested', helper],
        [12, 'ai.generation-succeeded', done(1, 6000)],
        [12, 'ai.generation-requested', helper],
        [12, 'ai.generation-succeeded', done(1, 7000)],
        [13, 'visualization.view-candidates', { candidates: [{}, {}] }]
      ])
    )!;
    const helpers = chart.bars.filter(({ kind }) => kind === 'helper');
    expect(helpers.map(({ start, end, label }) => [start, end, label])).toEqual([
      [5000, 12_000, 'helper luna 7 s'],
      [6000, 12_000, 'helper luna 6 s']
    ]);
    expect(chart.marks.map(({ label }) => label)).toEqual(['reply', '2 candidates']);
    expect(chart.followUp).toBe(false);
  });

  it('draws nothing for an operation that called no model and built nothing', () => {
    expect(turnChart(events([[0, 'feedback.submitted', { content: [] }]]))).toBeUndefined();
  });
});
