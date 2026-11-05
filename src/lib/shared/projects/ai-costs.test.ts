import { describe, expect, it } from 'vitest';

import { aiCalls, callCost, costText, costTotal, operationCosts, priceOf } from './ai-costs';
import type { ProjectEvent } from './events';

const event = (id: number, type: string, operationId: string, payload: object) =>
  ({ id, type, operationId, payload }) as unknown as ProjectEvent;
const requested = (id: number, operationId: string, attempt: number, model = 'gpt-5.6-sol') =>
  event(id, 'ai.generation-requested', operationId, {
    attempt,
    purpose: attempt === 1 ? 'initial' : 'repair',
    requestedModel: model
  });

describe('model call costs', () => {
  it('prices ordinary, cached, cache-written and output tokens, by the model a response names', () => {
    expect(priceOf('gpt-5.6-sol-2026-10-01')).toEqual({ input: 4, cachedInput: 0.4, output: 20 });
    expect(priceOf('gpt-4o')).toBeUndefined();
    // 1,000 ordinary at $4, 37,000 cached at $0.40, none written, 2,000 output at $20, per million.
    expect(
      callCost('gpt-5.6-sol', {
        inputTokens: 38_000,
        cachedInputTokens: 37_000,
        cacheWriteTokens: 0,
        outputTokens: 2_000
      })
    ).toBeCloseTo((1_000 * 4 + 37_000 * 0.4 + 2_000 * 20) / 1e6);
    // Written at 1.25× input.
    expect(
      callCost('gpt-5.6-luna', { inputTokens: 1_000, cacheWriteTokens: 1_000, outputTokens: 0 })
    ).toBeCloseTo((1_000 * 0.2 * 1.25) / 1e6);
  });

  it('pairs each call with its outcome, failed ones and their spent tokens included', () => {
    const events = [
      requested(1, 'turn', 1),
      event(2, 'ai.generation-failed', 'turn', {
        attempt: 1,
        usage: { inputTokens: 1_000, outputTokens: 500 }
      }),
      requested(3, 'turn', 2),
      event(4, 'ai.generation-succeeded', 'turn', {
        attempt: 2,
        requestedModel: 'gpt-5.6-sol',
        model: 'gpt-5.6-sol-2026-10-01',
        usage: { inputTokens: 2_000, cachedInputTokens: 1_000, outputTokens: 100 }
      }),
      requested(5, 'helpers', 1, 'gpt-5.6-luna'),
      event(6, 'ai.generation-succeeded', 'helpers', {
        attempt: 1,
        requestedModel: 'gpt-5.6-luna',
        usage: { inputTokens: 1_000, outputTokens: 10 }
      })
    ];
    const calls = aiCalls(events);
    expect(
      calls.map(({ operationId, attempt, failed, purpose }) => [
        operationId,
        attempt,
        failed,
        purpose
      ])
    ).toEqual([
      ['turn', 1, true, 'initial'],
      ['turn', 2, false, 'repair'],
      ['helpers', 1, false, 'initial']
    ]);
    expect(calls.every(({ costUsd }) => costUsd !== undefined)).toBe(true);
    const total = costTotal(calls);
    expect(total).toMatchObject({
      calls: 3,
      inputTokens: 4_000,
      cachedInputTokens: 1_000,
      priced: true
    });
    expect(
      operationCosts(calls).map(({ operationId, total }) => [operationId, total.calls])
    ).toEqual([
      ['turn', 2],
      ['helpers', 1]
    ]);
    expect(costText(total)).toMatch(/^3 calls · 4,610 tokens, 25% cached · \$0\.0\d\d$/u);
  });

  it('marks a total with an unpriced model, and reads old calls with no usage', () => {
    const calls = aiCalls([
      requested(1, 'turn', 1, 'gpt-4o'),
      event(2, 'ai.generation-succeeded', 'turn', {
        attempt: 1,
        requestedModel: 'gpt-4o',
        usage: { inputTokens: 10, outputTokens: 1 }
      }),
      requested(3, 'old', 1),
      event(4, 'ai.generation-succeeded', 'old', { attempt: 1, requestedModel: 'gpt-5.6-sol' })
    ]);
    expect(costTotal(calls).priced).toBe(false);
    expect(costText(costTotal(calls))).toMatch(/\+$/u);
  });
});
