import { describe, expect, it } from 'vitest';

import { parseResult, strictSchema } from './openai';

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
