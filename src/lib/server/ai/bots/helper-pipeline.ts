/**
 * The helper pipeline's stages and models, set in one place so a benchmark or the study can change
 * one line (design: workspace projects/phd-app/design.md, "Helpers: skeletons with holes"). A turn
 * that runs helpers (a study condition's `viewHelpers`, or an administrator's dev-mode switch)
 * passes through these stages in order, each of which can be switched off on its own:
 *
 * 1. helpers fill the holes of a skeleton, each fill built and measured by the app;
 * 2. scoring: a decision model scores pictures of the fills that built, a view drawn alone and a
 *    layout in the whole picture, and keeps a shortlist of each hole group; switched off, the
 *    app's own measures alone rank the shortlist;
 * 3. choosing: the designing model reads the shortlists and picks which fills go together, and the
 *    app builds only those combinations; switched off, or for a round of one hole group, which has
 *    nothing to combine, each shortlisted fill is offered by itself with the other holes as they
 *    were, as the helpers' candidates were before.
 *
 * With `helpers` off no turn runs any stage, whatever its condition says, and turns behave as they
 * did before the helpers existed.
 *
 * `firstTurns` sets how the first turns go, from the big picture down (the developer, 7 November
 * 2026: one first comparison was often not enough to see what is wanted at a high level).
 */

import type { ChatBotParameters } from '$lib/server/ai/bots/types';

/** What a hole asks for: a view of a type, a layout, an input, the algorithm, or anything. */
export const holeKinds = ['view', 'layout', 'case', 'algorithm', 'any'] as const;
export type HoleKind = (typeof holeKinds)[number];

type Parameters = ChatBotParameters;

export type HelperPipelineConfig = {
  /** Whether any turn runs the helpers; off overrides every study condition and dev switch. */
  helpers: boolean;
  /** The model and effort that fill each kind of hole. */
  holeModels: Readonly<Record<HoleKind, Parameters>>;
  scoring: {
    enabled: boolean;
    /** The Decisions API model that scores pictures of each fill. */
    model: string;
    /** How many fills of each hole group stay on its shortlist. */
    shortlist: number;
  };
  choosing: {
    enabled: boolean;
    /** The model that picks which shortlisted fills go together: the designing model. */
    parameters: Parameters;
    /** The most combinations it may ask the app to build. */
    combinations: number;
  };
  /**
   * How a round's candidates reach the participant: those ready within `replyWaitMs` of the reply
   * are offered as soon as they are, by a follow-up of the assistant; later ones join as a further
   * comparison when ready where `lateCandidatesJoin`, else the round stops at the wait.
   */
  timing: { replyWaitMs: number; lateCandidatesJoin: boolean };
  /**
   * The first call of a turn that designs (a first version while the helpers are on) steps up to
   * this, as a struggling participant's does (bots/attempt-profiles.ts steppedUpParameters).
   */
  designing: Pick<Parameters, 'model' | 'reasoningEffort'>;
  firstTurns: {
    /**
     * A first version's reply shows one version and asks a high-level question with short answers,
     * not a comparison of its own, and the round the app starts after it tries whole pictures (one
     * hole over the views and layouts), not the main type's look; the helpers' candidates then
     * become the comparison, shown live by the follow-up as nothing else waits. Off, a first
     * version is as before: the reply's own comparison, then a round on the main type or layout.
     */
    flow: boolean;
    /**
     * While a question with answers waits, each answer with a task gets a round of its own in the
     * background (a prepare-answers operation the participant's next action cancels), its
     * candidates kept by that answer until the source changes, so the reply to the answer offers
     * them at once instead of starting a round.
     */
    caching: boolean;
  };
};

/**
 * The cheap helper model: GPT-5.6 Luna at low effort, chosen on 2026-11-05 for cost (about
 * $0.003 a call at 11k cached input tokens and a few hundred out, 6.7 s median in the experiment);
 * not yet compared with GPT-6.1 Terra, which the design wants measured first. 8,000 output tokens
 * fit the longest layout a helper wrote in the audit of 7 projects (about 3,000) with room.
 */
const cheapHelper = {
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
  maxOutputTokens: 8000
} as const;

/**
 * Holes that change the algorithm or anything at all go to GPT-6.1 Terra at low effort, the
 * ladder's first call, which built 21 of 24 first sources on 2026-11-05's benchmark; Luna was not
 * measured on whole sources. 12,000 output tokens, as the main assistant's calls.
 */
const wholeSourceHelper = {
  model: 'gpt-6.1-terra',
  reasoningEffort: 'low',
  maxOutputTokens: 12000
} as const;

export const helperPipeline: HelperPipelineConfig = {
  helpers: true,
  holeModels: {
    view: cheapHelper,
    layout: cheapHelper,
    case: cheapHelper,
    algorithm: wholeSourceHelper,
    any: wholeSourceHelper
  },
  scoring: {
    enabled: true,
    // The Decisions API's model in OpenAI's announcement (public beta, 6 October 2026), priced at
    // $0.10 per million input tokens with no charge for output (shared/projects/ai-costs.ts).
    model: 'gpt-6-luna',
    // The design's 3 to 5: enough for a pair and a spare per group, few enough for the designing
    // model to read with their pictures; the same as candidatesGiven before (helpers/context).
    shortlist: 4
  },
  choosing: {
    enabled: true,
    // GPT-6.1 Sol at medium, the ladder's first Sol repair and the struggle step-up: the choice is
    // a design judgement over a few candidates, and medium took about 15 s on 2026-11-05.
    parameters: { model: 'gpt-6.1-sol', reasoningEffort: 'medium', maxOutputTokens: 4000 },
    // Each combination is one build (0.2–3.4 s, helpers/context.server.ts helperBuildBudgetMs);
    // four fill two comparisons, so builds stay linear in what is shown.
    combinations: 4
  },
  timing: {
    // The design's starting value (decided 6 November): about one Luna call and a few warm builds.
    replyWaitMs: 10_000,
    lateCandidatesJoin: true
  },
  designing: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
  // Both on to try the flow (the developer, 7 November 2026). Caching runs a round for each answer
  // with a task, at most three (source-decisions.ts maximumQuestionOptions), chosen or not, and a
  // whole-picture round goes to holeModels.any, the whole-source helper, dearer than a Luna call.
  firstTurns: { flow: true, caching: true }
};
