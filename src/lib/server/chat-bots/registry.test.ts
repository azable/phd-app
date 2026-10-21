import { describe, expect, it } from 'vitest';

import type { ChatBotConfig } from './types';
import { assistantIntroduction, createChatbot, getChatbot, getCandidateChatbot } from './registry';

describe('chatbot registry', () => {
  it('resolves only assistants compatible with the requested execution contract', () => {
    expect(getChatbot('sverlin-assistant').id).toBe('sverlin-assistant');
    expect(getCandidateChatbot('html-assistant').id).toBe('html-assistant');
    expect(getCandidateChatbot('html-js-assistant').id).toBe('html-js-assistant');
    expect(() => getChatbot('html-assistant')).toThrow('Unknown Sverlin assistant');
    expect(() => getCandidateChatbot('sverlin-assistant')).toThrow('Unknown candidate assistant');
  });

  it('uses the resolved assistant identity for participant introductions', () => {
    expect(assistantIntroduction('sverlin-assistant')).toEqual({
      botId: 'sverlin-assistant',
      step: 'algorithm',
      text: 'What algorithm would you like to visualise?'
    });
    expect(assistantIntroduction('html-assistant')).toEqual({
      botId: 'html-assistant',
      step: 'algorithm',
      text: 'What algorithm would you like to visualise?'
    });
    expect(assistantIntroduction('html-js-assistant')).toMatchObject({
      botId: 'html-js-assistant',
      step: 'algorithm'
    });
  });

  it('selects one exact configured profile and rejects attempts outside the ladder', async () => {
    let receivedSignal: AbortSignal | undefined;
    const config = {
      id: 'test-agent',
      participantIntake: [{ id: 'algorithm', question: 'Test' }],
      initialPrompt: 'Test prompt',
      attemptProfiles: [
        { purpose: 'initial', parameters: { model: 'fast', reasoningEffort: 'low' } },
        { purpose: 'fallback', parameters: { model: 'careful', reasoningEffort: 'xhigh' } }
      ],
      buildContext: ({ attempt }) => ({ attemptContext: attempt }),
      responseFormat: { name: 'test', schema: {} },
      parseOutput: () => ({
        reply: [{ type: 'markdown', text: 'Done' }],
        decision: { action: 'respond' }
      })
    } satisfies ChatBotConfig<Record<string, never>>;
    const chatbot = createChatbot(config, {
      id: 'test-adapter',
      requestTimeoutMs: () => 123,
      generateReply: async (request) => {
        receivedSignal = request.signal;
        return { output: {} };
      }
    });

    const prompt = await chatbot.preparePrompt({ messages: [], project: {}, attempt: 2 });
    expect(prompt).toMatchObject({
      attempt: { number: 2, purpose: 'fallback' },
      parameters: { model: 'careful', reasoningEffort: 'xhigh' },
      context: { attemptContext: { number: 2, purpose: 'fallback' } }
    });
    const controller = new AbortController();
    await chatbot.generatePrepared(prompt, { signal: controller.signal });
    expect(receivedSignal).toBe(controller.signal);
    await expect(chatbot.preparePrompt({ messages: [], project: {}, attempt: 3 })).rejects.toThrow(
      'outside the configured ladder'
    );
    expect(chatbot.requestTimeoutMs()).toBe(123);
  });
});
