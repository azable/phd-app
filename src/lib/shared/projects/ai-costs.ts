/**
 * What a project's model calls cost, from the token use each recorded: per call, per operation (an
 * assistant turn and its repairs, or a helper run), and in all. Read by dev mode, the export, and
 * the server's logs.
 */

import type { ProjectEvent, ProjectEventOf } from './events';

/** US dollars per million tokens. */
export type ModelPrice = { input: number; cachedInput: number; output: number };

/**
 * Prices by model name, matched by the start of the name a response reports (a dated name, as
 * gpt-5.6-sol-2026-10-01, takes its model's). From the model pages, read 2026-11-05:
 * https://developers.openai.com/api/docs/models/gpt-5.6-sol (Sol's promotional price, until
 * 2026-11-30) and https://developers.openai.com/api/docs/models/gpt-5.6-luna. Prompts over 272,000
 * input tokens cost 2× input and 1.5× output; ours stay far under. Update here when prices change.
 */
export const modelPrices: Readonly<Record<string, ModelPrice>> = {
  'gpt-5.6-sol': { input: 4, cachedInput: 0.4, output: 20 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 }
};

/**
 * Writing to the cache costs 1.25× input for the 30-minute lifetime the adapter asks for
 * (https://developers.openai.com/api/docs/guides/prompt-caching, GPT-5.6 and later).
 */
const cacheWriteFactor = 1.25;

export function priceOf(model: string): ModelPrice | undefined {
  const name = Object.keys(modelPrices)
    .filter((key) => model.startsWith(key))
    .toSorted((a, b) => b.length - a.length)[0];
  return name ? modelPrices[name] : undefined;
}

/**
 * One call's cost in dollars, or undefined where its model has no price. Input neither read from
 * nor written to the cache is ordinary; reasoning is part of the output tokens.
 */
export function callCost(
  model: string,
  usage: Readonly<Record<string, number>>
): number | undefined {
  const price = priceOf(model);
  if (!price) return undefined;
  const input = usage.inputTokens ?? 0;
  const cached = usage.cachedInputTokens ?? 0;
  const written = usage.cacheWriteTokens ?? 0;
  const ordinary = Math.max(0, input - cached - written);
  return (
    (ordinary * price.input +
      cached * price.cachedInput +
      written * price.input * cacheWriteFactor +
      (usage.outputTokens ?? 0) * price.output) /
    1_000_000
  );
}

/** One model call: its request, how it ended, its token use, and its cost where known. */
export type AiCall = {
  requestEventId: number;
  operationId: string;
  attempt: number;
  purpose: ProjectEventOf<'ai.generation-requested'>['payload']['purpose'];
  model: string;
  failed: boolean;
  usage: Record<string, number>;
  costUsd?: number;
};

/** Each recorded call, oldest first, its outcome the next of the same operation and attempt. */
export function aiCalls(events: readonly ProjectEvent[]): AiCall[] {
  const open = new Map<string, ProjectEventOf<'ai.generation-requested'>>();
  const calls: AiCall[] = [];
  for (const event of events) {
    if (event.type === 'ai.generation-requested') {
      open.set(`${event.operationId}:${event.payload.attempt}`, event);
      continue;
    }
    if (event.type !== 'ai.generation-succeeded' && event.type !== 'ai.generation-failed') continue;
    const key = `${event.operationId}:${event.payload.attempt}`;
    const request = open.get(key);
    if (!request) continue;
    open.delete(key);
    const model =
      event.type === 'ai.generation-succeeded'
        ? (event.payload.model ?? event.payload.requestedModel)
        : request.payload.requestedModel;
    const usage = event.payload.usage ?? {};
    const costUsd = event.payload.usage ? callCost(model, usage) : undefined;
    calls.push({
      requestEventId: request.id,
      operationId: event.operationId,
      attempt: event.payload.attempt,
      purpose: request.payload.purpose,
      model,
      failed: event.type === 'ai.generation-failed',
      usage,
      ...(costUsd !== undefined ? { costUsd } : {})
    });
  }
  return calls;
}

/** Calls added up; priced says whether every call with token use had a price. */
export type AiCostTotal = {
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  priced: boolean;
};

export function costTotal(calls: readonly AiCall[]): AiCostTotal {
  const sum = (key: string) => calls.reduce((total, { usage }) => total + (usage[key] ?? 0), 0);
  return {
    calls: calls.length,
    inputTokens: sum('inputTokens'),
    cachedInputTokens: sum('cachedInputTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    outputTokens: sum('outputTokens'),
    reasoningTokens: sum('reasoningTokens'),
    costUsd: calls.reduce((total, { costUsd }) => total + (costUsd ?? 0), 0),
    priced: calls.every(({ usage, costUsd }) => !Object.keys(usage).length || costUsd !== undefined)
  };
}

/** Each operation's calls added up, in the order the operations began. */
export function operationCosts(
  calls: readonly AiCall[]
): { operationId: string; total: AiCostTotal }[] {
  return [...Map.groupBy(calls, ({ operationId }) => operationId)].map(([operationId, group]) => ({
    operationId,
    total: costTotal(group)
  }));
}

/** A total in a line: “12 calls · 640k tokens, 55% cached · $1.23”. */
export function costText(total: AiCostTotal): string {
  const thousands = (count: number) =>
    count >= 10_000 ? `${Math.round(count / 1000)}k` : count.toLocaleString('en');
  const cached = total.inputTokens
    ? `, ${Math.round((100 * total.cachedInputTokens) / total.inputTokens)}% cached`
    : '';
  const cost = `$${total.costUsd.toFixed(total.costUsd < 1 ? 3 : 2)}${total.priced ? '' : '+'}`;
  return `${total.calls} call${total.calls === 1 ? '' : 's'} · ${thousands(total.inputTokens + total.outputTokens)} tokens${cached} · ${cost}`;
}
