import { describe, expect, it } from 'vitest';

import * as v from 'valibot';

import { interfacePartIds } from '$lib/shared/interface-parts';

import {
  generatedMessageContentJsonSchema,
  generatedMessageContentSchema
} from '$lib/server/ai/bots/types';

describe('generated message provider schema', () => {
  it('uses structured-output-compatible unions and mirrors non-empty text validation', () => {
    expect(generatedMessageContentJsonSchema.items).toHaveProperty('anyOf');
    expect(generatedMessageContentJsonSchema.items).not.toHaveProperty('oneOf');
    expect(generatedMessageContentJsonSchema.items.anyOf[0]).toMatchObject({
      properties: { text: { type: 'string', minLength: 1 } }
    });
  });

  it('lets a reply point at an interface part by its id, and no other', () => {
    expect(generatedMessageContentJsonSchema.items.anyOf).toContainEqual(
      expect.objectContaining({
        properties: {
          type: { type: 'string', enum: ['interface-ref'] },
          part: { type: 'string', enum: [...interfacePartIds] }
        },
        required: ['type', 'part']
      })
    );
    const reply = (part: string) => [
      { type: 'markdown', text: 'Use the' },
      { type: 'interface-ref', part },
      { type: 'markdown', text: 'under the pair.' }
    ];
    expect(v.safeParse(generatedMessageContentSchema, reply('answer-buttons')).success).toBe(true);
    expect(v.safeParse(generatedMessageContentSchema, reply('play-button')).success).toBe(false);
  });
});
