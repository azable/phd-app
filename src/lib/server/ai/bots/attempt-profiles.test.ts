import { describe, expect, it } from 'vitest';

import { visualizationAttemptProfiles, writtenRetries } from '$lib/server/ai/bots/attempt-profiles';

describe('visualization attempt profiles', () => {
  it('keeps the shared ladder bounded: a quick Terra first call and retries, then Sol repairs', () => {
    const terra = { model: 'gpt-6.1-terra', reasoningEffort: 'low', maxOutputTokens: 12_000 };
    expect(visualizationAttemptProfiles(12_000)).toEqual([
      { purpose: 'initial', parameters: terra },
      ...Array.from({ length: writtenRetries }, () => ({
        purpose: 'repair',
        writtenRetry: true,
        parameters: terra
      })),
      {
        purpose: 'repair',
        parameters: { model: 'gpt-6.1-sol', reasoningEffort: 'medium', maxOutputTokens: 12_000 }
      },
      {
        purpose: 'repair',
        parameters: { model: 'gpt-6.1-sol', reasoningEffort: 'high', maxOutputTokens: 12_000 }
      },
      {
        purpose: 'fallback',
        parameters: { model: 'gpt-6.1-sol', reasoningEffort: 'high', maxOutputTokens: 12_000 }
      }
    ]);
  });
});
