import { describe, expect, it } from 'vitest';

import { cacheOptions, parseResult, requestInput, strictSchema, usageOf } from './openai';
import type { ChatAdapterRequest } from './types';

describe('prompt caching', () => {
  const request = (context: unknown) =>
    ({
      initialPrompt: 'The guide.',
      context,
      messages: [{ role: 'user', content: 'Hello' }]
    }) as unknown as ChatAdapterRequest;

  it('ends the prompt, the same for every project, at a breakpoint, the context after it', () => {
    const first = requestInput(request({ project: 1 }), '{"project":1}');
    const second = requestInput(request({ project: 2 }), '{"project":2}');
    expect(first[0]).toEqual(second[0]);
    expect(first[0]).toEqual({
      role: 'developer',
      content: [
        { type: 'input_text', text: 'The guide.', prompt_cache_breakpoint: { mode: 'explicit' } }
      ]
    });
    expect(first[1]).toEqual({
      role: 'developer',
      content: 'Context provided by this chat configuration:\n\n{"project":1}'
    });
    expect(first[2]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('caches explicitly only on models that accept it', () => {
    expect(cacheOptions('gpt-5.6-sol')).toEqual({
      prompt_cache_options: { mode: 'explicit', ttl: '30m' }
    });
    expect(cacheOptions('gpt-5.6-luna')).toHaveProperty('prompt_cache_options');
    expect(cacheOptions('gpt-5.5')).toEqual({});
  });

  it('records cached, written and reasoning tokens where the provider reports them', () => {
    expect(
      usageOf({
        input_tokens: 38014,
        output_tokens: 120,
        total_tokens: 38134,
        input_tokens_details: { cached_tokens: 37967, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 100 }
      })
    ).toEqual({
      inputTokens: 38014,
      outputTokens: 120,
      totalTokens: 38134,
      cachedInputTokens: 37967,
      cacheWriteTokens: 0,
      reasoningTokens: 100
    });
    expect(usageOf({ input_tokens: 1, output_tokens: 2, total_tokens: 3 })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3
    });
  });
});

describe('parseResult', () => {
  it('accepts the strict source-or-null response shape', () => {
    expect(parseResult('{"reply":"Done","sourceArtifactContent":null}')).toEqual({
      output: { reply: 'Done', sourceArtifactContent: null }
    });
  });

  it('preserves an incomplete provider response for the project audit', () => {
    const providerResponse = {
      id: 'response-1',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: []
    };

    expect(() => parseResult('', providerResponse)).toThrowError(
      expect.objectContaining({
        name: 'InvalidChatbotResponseError',
        message: 'The chatbot response was incomplete (max_output_tokens).',
        providerResponse
      })
    );
  });

  it('distinguishes a refusal from malformed JSON', () => {
    expect(() =>
      parseResult('', {
        status: 'completed',
        output: [{ content: [{ type: 'refusal', refusal: 'No' }] }]
      })
    ).toThrowError(
      expect.objectContaining({
        name: 'InvalidChatbotResponseError',
        message: 'The chatbot refused the request instead of returning structured output.'
      })
    );
  });
});

describe('strict response schemas', () => {
  it('states oneOf as anyOf and const as an enum, without $schema, as strict mode accepts', () => {
    expect(
      strictSchema({
        $schema: 'http://json-schema.org/draft-07/schema#',
        oneOf: [
          { type: 'object', properties: { action: { const: 'respond' } } },
          { type: 'object', properties: { action: { const: 'edit' }, edits: { type: 'array' } } }
        ]
      })
    ).toEqual({
      anyOf: [
        { type: 'object', properties: { action: { enum: ['respond'] } } },
        { type: 'object', properties: { action: { enum: ['edit'] }, edits: { type: 'array' } } }
      ]
    });
  });
});
