import type { ChatBotAttemptProfile } from '$lib/server/ai/bots/types';

/**
 * One bounded attempt ladder shared by visualization modes: a first call, quick retries for a
 * source refused as written (see writtenRetries), two repairs at rising effort, and a simpler
 * fallback that explains what it reduced: six calls at most, and four where no source is refused
 * as written. On 2026-11-05,
 * across six projects, ten of thirteen repairs ran at medium and most fixed the first version; the
 * xhigh repair ran once and took 91 s, and in project 7464186f the fallback succeeded at once where
 * two repairs had failed. So the xhigh repair was dropped and the fallback runs at high: the worst
 * case falls from about five minutes to about two, in a 15-minute session. With the 180-second
 * request ceiling (ai/providers/openai.ts) and provider retries off, a turn can never outlast the
 * 15-minute study phase, and each condition's turns stay bounded and comparable.
 *
 * The first call is GPT-6.1 Terra at low effort, the repairs and fallback GPT-6.1 Sol. On
 * 2026-11-05's benchmark of 12 first requests (twice each), Terra at low built 21 of 24 first time
 * in a median 14 s for $0.010 a request, GPT-6.1 Sol at low 19 of 24 in 19 s for $0.023, and
 * GPT-5.6 Sol at low 15 of 24 in 28 s for $0.075; repairing 20 failed first sources at medium,
 * 6.1 Sol fixed 17 and 5.6 Sol 16. This whole ladder made a working first version of all 24 in a
 * mean 20 s for $0.021, where the 5.6 Sol ladder took 36 s for $0.125 (12 of 12). Replaying 24 real
 * feedback turns, Terra's first call answered all 24 usably in a median 16 s for $0.031 a turn
 * against 5.6 Sol's 24 s and $0.169, though in 3 it explained where Sol had changed the source.
 * Prices: https://developers.openai.com/api/docs/models/gpt-6.1-terra and
 * https://developers.openai.com/api/docs/models/gpt-6.1-sol (read 2026-11-05).
 *
 * Where a study condition, or an administrator's dev-mode switch, turns the view helpers on
 * (modes/sverlin/assistant/helpers/context.server.ts), a turn adds one round of Luna calls at low effort after its reply has
 * shown, all at once, each time-boxed to 30 seconds: five views of a type or eight arrangements of
 * a layout by default (study/definition.ts), and a retry for at most three that did not build or
 * read. Each call sends its extract of the guide and the source, about 11k input tokens for a view
 * and 10k for a layout, the extract alike across a round's calls, so a round is some 55k–80k input
 * tokens and 5k–10k output, but never delays the reply, and none counts against the ladder's four.
 */

/**
 * Quick retries on the first call's model for a source the build refused as written (a label on a
 * block, a statement in no label, a view or layout in the wrong place, a label that does not
 * exist), taken one after another before the Sol repairs; any other failure goes to them at once.
 * On 2026-11-05's repair benchmark (20 failed first sources, each repaired once), Terra at low fixed
 * 17, as many as 6.1 Sol at medium, in a median call of about 6 s against 15 s, for about $0.010 a
 * call against $0.025 at the prices above; written-source problems were about three in four of
 * those the benchmark's builds found. A second Terra retry was not measured: it costs about one
 * Sol repair's time at under half its price, and reads the first retry's cached prompt. They add at
 * most two calls to a turn, about 15–35 s at the benchmark's slowest Terra repairs (16–18 s); the
 * request ceiling and the study deadline still bound the turn.
 */
export const writtenRetries = 2;

/**
 * The model a turn's first call steps up to when the participant seems to be struggling to get a
 * point across, or the fast first call flags the request as unclear (ai/turns/struggle.ts): GPT-6.1
 * Sol at medium, the ladder's first Sol repair, the same in both modes. On 2026-11-05's benchmark
 * a Sol call at medium took about 15 s against Terra's 6 s, for about $0.025 against $0.010
 * (prices above), and fixed as many failed sources (17 of 20); high would take longer still
 * (project 7464186f's high fallback, the 91 s xhigh repair dropped above). Only the first call
 * changes: the repairs after it are the same. A step up because of the Timeline costs no extra
 * call; one because the model flagged the request adds one, so a turn makes at most seven calls,
 * and the request ceiling and study deadline still bound it.
 */
export const steppedUpParameters = { model: 'gpt-6.1-sol', reasoningEffort: 'medium' } as const;

export function visualizationAttemptProfiles(
  maxOutputTokens: number
): readonly [ChatBotAttemptProfile, ...ChatBotAttemptProfile[]] {
  return [
    {
      purpose: 'initial',
      parameters: { model: 'gpt-6.1-terra', reasoningEffort: 'low', maxOutputTokens }
    },
    ...Array.from({ length: writtenRetries }, () => ({
      purpose: 'repair' as const,
      writtenRetry: true as const,
      parameters: { model: 'gpt-6.1-terra', reasoningEffort: 'low' as const, maxOutputTokens }
    })),
    {
      purpose: 'repair',
      parameters: { model: 'gpt-6.1-sol', reasoningEffort: 'medium', maxOutputTokens }
    },
    {
      purpose: 'repair',
      parameters: { model: 'gpt-6.1-sol', reasoningEffort: 'high', maxOutputTokens }
    },
    {
      purpose: 'fallback',
      parameters: { model: 'gpt-6.1-sol', reasoningEffort: 'high', maxOutputTokens }
    }
  ];
}
