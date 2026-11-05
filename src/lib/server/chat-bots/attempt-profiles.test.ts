import { describe, expect, it } from 'vitest';

import { visualizationAttemptProfiles } from './attempt-profiles';

describe('visualization attempt profiles', () => {
  it('keeps the shared four-stage ladder bounded: a quick Terra first call, then Sol repairs', () => {
    expect(visualizationAttemptProfiles(12_000)).toEqual([
      {
        purpose: 'initial',
        parameters: {
          model: 'gpt-6.1-terra',
          reasoningEffort: 'low',
          maxOutputTokens: 12_000
        }
      },
      {
        purpose: 'repair',
        parameters: {
          model: 'gpt-6.1-sol',
          reasoningEffort: 'medium',
          maxOutputTokens: 12_000
        }
      },
      {
        purpose: 'repair',
        parameters: {
          model: 'gpt-6.1-sol',
          reasoningEffort: 'high',
          maxOutputTokens: 12_000
        }
      },
      {
        purpose: 'fallback',
        parameters: {
          model: 'gpt-6.1-sol',
          reasoningEffort: 'high',
          maxOutputTokens: 12_000
        }
      }
    ]);
  });
});
