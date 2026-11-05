import type { ChatBotAttemptProfile } from './types';

/**
 * One bounded Sol attempt ladder shared by visualization modes: a first call, two repairs at
 * rising effort, and a simpler fallback that explains what it reduced, four calls at most. On
 * 2026-11-05, across six projects, ten of thirteen repairs ran at medium and most fixed the first
 * version; the xhigh repair ran once and took 91 s, and in project 7464186f the fallback succeeded
 * at once where two repairs had failed. So the xhigh repair was dropped and the fallback runs at
 * high: the worst case falls from about five minutes to about two, in a 15-minute session. With the
 * 180-second request ceiling (chat-adapters/openai.ts) and provider retries off, a turn can never
 * outlast the 15-minute study phase, and each condition's turns stay bounded and comparable. A
 * feedback turn's first attempt thinks less, as it mostly edits, varies, compares, or replies, and
 * waiting on it is most of the participant's wait; a first source, and every repair, keep the
 * ladder's effort. Where a study condition, or an administrator's dev-mode switch, turns the view
 * helpers on (projects/view-helpers.ts), a turn adds one round of Luna calls at low effort after its
 * reply has shown, all at once, each time-boxed to 30 seconds: five views of a type or eight
 * arrangements of a layout by default (study/definition.ts), and a retry for at most three that did
 * not build or read. Each call sends its extract of the guide and the source, about 11k input
 * tokens for a view and 10k for a layout, the extract alike across a round's calls, so a round is
 * some 55k–80k input tokens and 5k–10k output, but never delays the reply, and none counts against
 * the ladder's four.
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
      purpose: 'fallback',
      parameters: { model: 'gpt-5.6-sol', reasoningEffort: 'high', maxOutputTokens }
    }
  ];
}
