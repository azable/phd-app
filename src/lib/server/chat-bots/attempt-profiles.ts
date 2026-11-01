import type { ChatBotAttemptProfile } from './types';

/**
 * One bounded Sol attempt ladder shared by visualization modes. A feedback turn's first attempt
 * thinks less, as it mostly edits, varies, compares, or replies, and waiting on it is most of the
 * participant's wait; a first source, and every repair, keep the ladder's effort.
 */
export function visualizationAttemptProfiles(
  maxOutputTokens: number
): readonly [ChatBotAttemptProfile, ...ChatBotAttemptProfile[]] {
  return [
    {
      purpose: 'initial',
      parameters: { model: 'gpt-5.6-sol', reasoningEffort: 'medium', maxOutputTokens },
      feedbackParameters: { reasoningEffort: 'low' }
    },
    {
      purpose: 'repair',
      parameters: { model: 'gpt-5.6-sol', reasoningEffort: 'medium', maxOutputTokens }
    },
    {
      purpose: 'repair',
      parameters: { model: 'gpt-5.6-sol', reasoningEffort: 'high', maxOutputTokens }
    },
    {
      purpose: 'repair',
      parameters: { model: 'gpt-5.6-sol', reasoningEffort: 'xhigh', maxOutputTokens }
    },
    {
      purpose: 'fallback',
      parameters: { model: 'gpt-5.6-sol', reasoningEffort: 'xhigh', maxOutputTokens }
    }
  ];
}
