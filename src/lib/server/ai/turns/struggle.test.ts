import { describe, expect, it, vi } from 'vitest';

import type { ProjectEvent } from '$lib/shared/projects/events';
import { aiGenerationRequestedEventSchema } from '$lib/shared/projects/events/ai-generation';
import type { ChatBotConfig } from '$lib/server/ai/bots/types';
import { createChatbot } from '$lib/server/ai/bots/registry';
import { steppedUpParameters } from '$lib/server/ai/bots/attempt-profiles';
import { logModelCall } from '$lib/server/ai/costs/ai-cost-log';
import { runAttemptLadder } from '$lib/server/ai/turns/attempt-ladder';
import { runPreparedGeneration } from '$lib/server/ai/turns/generation';
import {
  currentEscalation,
  designingSignal,
  escalateForFlag,
  runWithEscalation,
  struggleSignal
} from '$lib/server/ai/turns/struggle';
import * as attemptLadder from '$lib/server/ai/turns/attempt-ladder';
import { helperPipeline } from '$lib/server/ai/bots/helper-pipeline';
import type { ProjectDocument } from '$lib/shared/projects/model';
import { modeAssistants } from '$lib/modes/assistants.server';
import * as v from 'valibot';

// Only the fields struggleSignal reads; the Timeline's own schemas are tested where they live.
const event = (id: number, type: string, payload: Record<string, unknown>) =>
  ({ id, type, payload }) as unknown as ProjectEvent;
const said = (id: number, text: string, more: Record<string, unknown> = {}) =>
  event(id, 'feedback.submitted', {
    content: [{ type: 'markdown', text }],
    focus: [],
    ...more
  });
const reply = (id: number, question?: string) =>
  event(id, 'assistant.responded', {
    content: [{ type: 'markdown', text: 'Done.' }],
    ...(question ? { question: { text: question } } : {})
  });
const answer = (id: number, preferred: string) =>
  event(id, 'visualization.preference-recorded', { presentations: ['a', 'b'], step: 0, preferred });

describe('struggle signals', () => {
  it('finds none in an ordinary turn', () => {
    const events = [said(1, 'Show binary search'), reply(2), said(3, 'Add the target value')];
    expect(struggleSignal(events, [3])).toBeUndefined();
  });

  it('steps up after an earlier version is restored since the last reply', () => {
    const events = [
      said(1, 'Show binary search'),
      reply(2),
      event(3, 'artifact.version-created', { origin: { kind: 'restore', restoredFrom: 1 } }),
      said(4, 'Use this one instead')
    ];
    expect(struggleSignal(events, [4])).toBe('restored-version');
  });

  it('steps up when an answer to a comparison reverses an earlier one', () => {
    const events = [said(1, 'Compare looks'), reply(2), answer(3, 'a'), reply(4), answer(5, 'b')];
    expect(struggleSignal(events, [5])).toBe('comparison-rejected');
    expect(struggleSignal([answer(1, 'a'), answer(2, 'a')], [2])).toBeUndefined();
  });

  it('steps up when the same request comes again after it was answered', () => {
    const events = [
      said(1, 'Draw the queue under the graph please'),
      reply(2),
      said(3, 'please draw the queue under the graph')
    ];
    expect(struggleSignal(events, [3])).toBe('repeat-request');
  });

  it('steps up when an answered question is followed by another question', () => {
    const events = [
      said(1, 'Show sorting'),
      reply(2, 'Which sort?'),
      said(3, 'Insertion', { answers: 2 }),
      reply(4, 'For whom?'),
      said(5, 'Students', { answers: 4 })
    ];
    expect(struggleSignal(events, [5])).toBe('question-unsettled');
  });

  it('steps up on a short negative judgement that points at nothing', () => {
    expect(struggleSignal([reply(1), said(2, 'This doesnt look very good')], [2])).toBe(
      'vague-negative'
    );
    expect(
      struggleSignal([reply(1), said(2, 'This doesnt look very good', { focus: [1] })], [2])
    ).toBeUndefined();
  });
});

describe('a stepped-up first call', () => {
  const config = {
    id: 'test-agent',
    participantIntake: [{ id: 'algorithm', question: 'Test' }],
    initialPrompt: 'Test prompt',
    attemptProfiles: [
      { purpose: 'initial', parameters: { model: 'gpt-6.1-terra', reasoningEffort: 'low' } },
      { purpose: 'repair', parameters: { model: 'gpt-6.1-sol', reasoningEffort: 'high' } }
    ],
    buildContext: () => ({}),
    responseFormat: { name: 'test', schema: {} },
    parseOutput: () => ({
      reply: [{ type: 'markdown', text: 'Done' }],
      decision: { action: 'respond' }
    })
  } satisfies ChatBotConfig<Record<string, never>>;
  const chatbot = createChatbot(config, {
    id: 'test',
    generateReply: async () => ({ output: {} })
  });
  const prepare = (attempt: number) =>
    chatbot.preparePrompt({ messages: [], project: {}, attempt });

  it('uses the fast model with no signal, and the stepped-up model for the first call only with one', async () => {
    expect((await prepare(1)).parameters).toMatchObject({ model: 'gpt-6.1-terra' });
    expect((await prepare(1)).escalation).toBeUndefined();
    await runWithEscalation('repeat-request', async () => {
      const first = await prepare(1);
      expect(first.parameters).toMatchObject(steppedUpParameters);
      expect(first.escalation).toBe('repeat-request');
      // The repairs after it are unchanged.
      expect((await prepare(2)).parameters).toMatchObject({ reasoningEffort: 'high' });
      expect((await prepare(2)).escalation).toBeUndefined();
    });
  });

  it('steps a first version up to the designing model only while the helpers are on', async () => {
    await runWithEscalation('designing', async () => {
      expect((await prepare(1)).parameters).toMatchObject(helperPipeline.designing);
    });
    const started = (viewHelpers: boolean) =>
      event(1, 'assistant.turn-started', {
        requestEventIds: [],
        interactionEventIds: [],
        viewHelpers
      });
    const document = (viewHelpers: boolean) =>
      ({ events: [started(viewHelpers)] }) as unknown as ProjectDocument;
    const firstVersion = vi.spyOn(attemptLadder, 'hasWorkingVersion').mockReturnValue(false);
    expect(designingSignal(document(true))).toBe('designing');
    expect(designingSignal(document(false))).toBeUndefined();
    firstVersion.mockReturnValue(true);
    expect(designingSignal(document(true))).toBeUndefined();
    firstVersion.mockRestore();
  });

  it('steps up both modes alike, as both start their ladder with the same first call', () => {
    // Each mode keeps its own output budget; the model, effort and purpose are what step up.
    const firsts = Object.values(modeAssistants).map(({ default: bot }) => {
      const { purpose, parameters } = bot.attemptProfiles[0];
      return { purpose, model: parameters.model, effort: parameters.reasoningEffort };
    });
    expect(firsts.length).toBeGreaterThanOrEqual(2);
    for (const first of firsts) expect(first).toEqual(firsts[0]);
    expect(firsts[0].purpose).toBe('initial');
  });

  it('lets the model flag a turn once, never on a turn that already stepped up', () => {
    runWithEscalation(undefined, () => {
      expect(escalateForFlag()).toBe(true);
      expect(currentEscalation()).toBe('model-flag');
      expect(escalateForFlag()).toBe(false);
    });
    runWithEscalation('vague-negative', () => expect(escalateForFlag()).toBe(false));
  });

  it('runs the first attempt once more on a flag, and not a second time', async () => {
    const attempts: number[] = [];
    await runAttemptLadder(
      {} as never,
      'op',
      { config: config, requestTimeoutMs: () => 0 },
      {} as never,
      async (document, attempt) => {
        attempts.push(attempt);
        return attempts.length <= 2
          ? { document, done: false, rethink: true }
          : { document, done: true };
      }
    );
    expect(attempts).toEqual([1, 1, 2]);
  });
});

describe('where a step up shows', () => {
  it('records the reason on the Timeline, and old requests without one stay valid', () => {
    const request = {
      id: 1,
      projectId: '00000000-0000-4000-8000-000000000000',
      type: 'ai.generation-requested',
      createdAt: new Date().toISOString(),
      actor: { kind: 'system' },
      operationId: '00000000-0000-4000-8000-000000000001',
      payload: {
        attempt: 1,
        purpose: 'initial',
        prompt: { text: '{}', sha256: 'a'.repeat(64), mediaType: 'application/json' },
        promptTemplateSha256: 'b'.repeat(64),
        requestedModel: 'gpt-6.1-sol',
        parameters: { model: 'gpt-6.1-sol' }
      }
    };
    const withReason = { ...request, payload: { ...request.payload, escalation: 'model-flag' } };
    const parsed = v.safeParse(aiGenerationRequestedEventSchema, withReason);
    expect(parsed.success).toBe(true);
    expect(v.safeParse(aiGenerationRequestedEventSchema, request).success).toBe(true);
    expect(
      v.safeParse(aiGenerationRequestedEventSchema, {
        ...request,
        payload: { ...request.payload, escalation: 'bored' }
      }).success
    ).toBe(false);
  });

  it('writes the reason on the ai.call log line', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    logModelCall({
      projectId: 'p',
      operationId: 'o',
      attempt: 1,
      purpose: 'initial',
      model: 'gpt-6.1-sol',
      failed: false,
      escalation: 'repeat-request'
    });
    const line = JSON.parse(String(info.mock.calls[0][0]));
    expect(line).toMatchObject({
      type: 'ai.call',
      escalation: 'repeat-request',
      model: 'gpt-6.1-sol'
    });
    info.mockRestore();
  });

  it('records a flagged fast call and asks for a rethink, then acts on the stepped-up answer', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    // A repository that only appends, numbering the events after the last it holds.
    const stored: { id: number; type: string }[] = [{ id: 1, type: 'project.created' }];
    const repository = {
      append: async (projectId: string, _head: number, events: { type: string }[]) => {
        for (const e of events) stored.push({ ...e, id: stored.length + 1 });
        return { document: { projectId, events: [...stored] } };
      }
    };
    let document = { projectId: 'p', events: [...stored] };
    const dependencies = { projectService: { repository } } as never;
    const prompt = (escalation?: 'model-flag') =>
      ({
        initialPrompt: 'x',
        messages: [],
        context: {},
        attempt: { number: 1, purpose: 'initial' },
        parameters: { model: escalation ? 'gpt-6.1-sol' : 'gpt-6.1-terra' },
        responseFormat: { name: 't', schema: {} },
        ...(escalation ? { escalation } : {})
      }) as never;
    const generate = async () =>
      ({
        reply: [],
        needsMoreThought: true,
        generation: { botId: 'b', adapterId: 'a' }
      }) as never;
    await runWithEscalation(undefined, async () => {
      const fast = await runPreparedGeneration(
        {
          document: document as never,
          attempt: 1,
          operationId: 'o',
          prompt: prompt(),
          generate,
          validateResult: () => undefined,
          fallbackResponse: () => ({})
        },
        dependencies
      );
      expect(fast).toMatchObject({ ok: false, rethink: true, retried: true });
      document = fast.document as never;
      expect(document.events.map((e) => e.type)).toContain('ai.generation-succeeded');
      expect(currentEscalation()).toBe('model-flag');
      // The stepped-up call flags too, but the turn already stepped up: its answer is used.
      const careful = await runPreparedGeneration(
        {
          document: document as never,
          attempt: 1,
          operationId: 'o',
          prompt: prompt('model-flag'),
          generate,
          validateResult: () => undefined,
          fallbackResponse: () => ({})
        },
        dependencies
      );
      expect(careful.ok).toBe(true);
      const requests = careful.document.events.filter(
        (e) => e.type === 'ai.generation-requested'
      ) as unknown as { payload: { escalation?: string } }[];
      expect(requests.map((r) => r.payload.escalation)).toEqual([undefined, 'model-flag']);
    });
    vi.restoreAllMocks();
  });
});
