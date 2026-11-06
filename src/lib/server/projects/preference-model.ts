/**
 * What the participant's answers say about each choice of the design: a Bayesian Bradley–Terry
 * model with ties (Davidson 1970), fitted afresh from the project's events on every call, so it
 * keeps no state of its own. Every option of every choice adds to a variant's utility, so an answer
 * to a pair is evidence about the options the pair differed in (one-hot features, as in
 * preferential Bayesian optimisation, González et al. 2017); the posterior is Gaussian by
 * Laplace's approximation, solved in the answers' terms as a session has far fewer answers than
 * options (Rasmussen and Williams 2006, algorithm 3.1).
 *
 * A preferred side is a win. Either is fine is a tie: Davidson's model, P(tie) = ν / (e^{d/2} +
 * e^{−d/2} + ν) for a utility difference d, so ties pull the two options together. Unsure is
 * no evidence. A vary decision of the assistant, which records what the participant asked for in
 * chat, is strong evidence that its value beats every other the participant has seen.
 */

import type { DesignValues } from '$lib/shared/presentations';
import type { ProjectEvent } from '$lib/shared/projects/events';
import {
  comparisonOutcome,
  preferredPresentation
} from '$lib/shared/projects/events/visualization-presented';
import { seededRandom } from '$lib/modes/sverlin/algorithm/random.server';
import { keptKey } from '$lib/modes/sverlin/library/node/design-keys';
import { readDesignPatch } from '$lib/modes/sverlin/assistant/design-patch.server';

type DesignValue = string | number | boolean;

/**
 * One piece of evidence: two sides' values where they differ, the first won or the two tied, with
 * its weight (an answer 1, a vary decision strongEvidence) and the event it came from.
 */
export type Duel = {
  first: DesignValues;
  second: DesignValues;
  outcome: 'win' | 'tie';
  weight: number;
  eventId: number;
};

/** A value the assistant's vary decision set, which fixes it until an answer disagrees. */
export type Fix = { variable: string; value: DesignValue; eventId: number };

export type PreferenceEvidence = { duels: Duel[]; fixes: Fix[]; skipped: number };

/**
 * The weight of a vary decision against each other option seen: three answers' worth, so it and
 * one agreeing answer settle the choice, yet two later answers against it outweigh it.
 */
const strongEvidence = 3;

/** Davidson's tie parameter: at equal utilities a tie is as likely as either win (1/3 each). */
const tieWeight = 1;

/**
 * The prior's standard deviation on each option's effect, in logits. Chosen so two agreeing answers
 * on a minimal pair settle it (P(best) ≈ 0.92) and one does not (≈ 0.84).
 */
const priorScale = 3;
const variance = priorScale ** 2;

/** The probability of being best at which a choice settles, over at least settlingAnswers. */
export const settlingProbability = 0.9;
export const settlingAnswers = 2;

/** Each presented presentation's variant, by its id, as of each event. */
function presentedVariant(event: ProjectEvent): [string, DesignValues] | undefined {
  return event.type === 'visualization.presented' &&
    event.payload.presentation.format === 'browser-bundle-v1' &&
    event.payload.presentation.variant
    ? [event.payload.presentation.presentationId, event.payload.presentation.variant]
    : undefined;
}

/** Two variants' values where both have the variable and they differ. */
function differingSides(left: DesignValues, right: DesignValues): [DesignValues, DesignValues] {
  const first: Record<string, DesignValue> = {};
  const second: Record<string, DesignValue> = {};
  for (const [variable, value] of Object.entries(left))
    if (variable in right && right[variable] !== value) {
      first[variable] = value;
      second[variable] = right[variable];
    }
  return [first, second];
}

/**
 * The evidence a project's events hold: every answered comparison, a pair answered again by its
 * latest answer only, and every vary decision.
 */
export function preferenceEvidence(events: readonly ProjectEvent[]): PreferenceEvidence {
  const variants = new Map<string, DesignValues>();
  const seen = new Map<string, Set<DesignValue>>();
  const duels: Duel[] = [];
  const fixes: Fix[] = [];
  let skipped = 0;
  const latestAnswers = latestAnswerIds(events);
  for (const event of events) {
    if (event.type === 'visualization.preference-recorded' && !latestAnswers.has(event.id))
      continue;
    const presented = presentedVariant(event);
    if (presented) {
      variants.set(...presented);
      for (const [variable, value] of Object.entries(presented[1])) {
        if (!seen.has(variable)) seen.set(variable, new Set());
        seen.get(variable)!.add(value);
      }
    }
    if (event.type === 'visualization.preference-recorded') {
      const outcome = comparisonOutcome(event.payload);
      if (outcome === 'skip') {
        skipped += 1;
        continue;
      }
      const winner = preferredPresentation(event.payload) ?? event.payload.presentations[0];
      const other = event.payload.presentations.find((id) => id !== winner);
      const left = variants.get(winner);
      const right = other ? variants.get(other) : undefined;
      if (!left || !right) continue;
      const [first, second] = differingSides(left, right);
      if (Object.keys(first).length)
        duels.push({
          first,
          second,
          outcome: outcome === 'tie' ? 'tie' : 'win',
          weight: 1,
          eventId: event.id
        });
    }
    if (event.type === 'ai.generation-succeeded')
      for (const { variable, value } of varyValues(event.payload.response.text)) {
        fixes.push({ variable, value, eventId: event.id });
        for (const other of seen.get(variable) ?? [])
          if (other !== value)
            duels.push({
              first: { [variable]: value },
              second: { [variable]: other },
              outcome: 'win',
              weight: strongEvidence,
              eventId: event.id
            });
      }
  }
  return { duels, fixes, skipped };
}

/** The event of each pair's latest answer, a pair being its two presentations in either order. */
function latestAnswerIds(events: readonly ProjectEvent[]): Set<number> {
  const latest = new Map<string, number>();
  for (const event of events)
    if (event.type === 'visualization.preference-recorded')
      latest.set(event.payload.presentations.toSorted().join('|'), event.id);
  return new Set(latest.values());
}

/** The values a recorded assistant response's vary decision sets, if it made one. */
export function varyValues(response: string): { variable: string; value: DesignValue }[] {
  try {
    const parsed = JSON.parse(response) as {
      output_text?: string;
      output?: { content?: { text?: string }[] }[];
      decision?: unknown;
    };
    const texts = [
      parsed.output_text,
      ...(parsed.output ?? []).flatMap(({ content }) => (content ?? []).map(({ text }) => text))
    ].filter((text): text is string => typeof text === 'string');
    const decisions = [
      parsed.decision,
      ...texts.map((text) => {
        try {
          return (JSON.parse(text) as { decision?: unknown }).decision;
        } catch {
          return undefined;
        }
      })
    ];
    for (const decision of decisions) {
      const vary = decision as { action?: unknown; values?: unknown } | undefined;
      if (vary?.action !== 'vary') continue;
      // A JSON string of a nested design, or an older list of {variable, value}.
      const patch = readDesignPatch(vary.values);
      if ('problem' in patch) return [];
      return patch.set.map(({ variable, value }) => ({ variable: keptKey(variable), value }));
    }
  } catch {
    // Not a recorded response with a decision.
  }
  return [];
}

// --- The model --------------------------------------------------------------------------------

/** The options the evidence names, each one feature, grouped by their choice. */
type Space = { size: number; options: Map<string, { values: DesignValue[]; features: number[] }> };

const featureKey = (variable: string, value: DesignValue) =>
  `${variable}\u0000${typeof value}:${String(value)}`;

/** A sparse difference of features, the first side's less the second's. */
type Difference = [number, number][];

function spaceOf(duels: readonly Duel[]): { space: Space; differences: Difference[] } {
  const index = new Map<string, number>();
  const space: Space = { size: 0, options: new Map() };
  const feature = (variable: string, value: DesignValue) => {
    const key = featureKey(variable, value);
    if (!index.has(key)) {
      index.set(key, space.size);
      if (!space.options.has(variable)) space.options.set(variable, { values: [], features: [] });
      space.options.get(variable)!.values.push(value);
      space.options.get(variable)!.features.push(space.size);
      space.size += 1;
    }
    return index.get(key)!;
  };
  const differences = duels.map(({ first, second }) =>
    Object.keys(first).flatMap(
      (variable): Difference => [
        [feature(variable, first[variable]), 1],
        [feature(variable, second[variable]), -1]
      ]
    )
  );
  return { space, differences };
}

/** Davidson's log-likelihood's gradient and negative curvature in the difference d. */
function likelihood(d: number, outcome: Duel['outcome']): { gradient: number; curvature: number } {
  const clamped = Math.max(-60, Math.min(60, d));
  const up = Math.exp(clamped / 2);
  const down = Math.exp(-clamped / 2);
  const total = up + down + tieWeight;
  const slope = (up - down) / (2 * total);
  const curvature = ((up + down) / 4) * (1 / total) - slope * slope;
  return { gradient: (outcome === 'win' ? 0.5 : 0) - slope, curvature };
}

/** The Cholesky factor of a symmetric positive-definite matrix, in place, lower triangle. */
function cholesky(matrix: Float64Array, n: number): Float64Array {
  for (let j = 0; j < n; j++) {
    let diagonal = matrix[j * n + j];
    for (let k = 0; k < j; k++) diagonal -= matrix[j * n + k] ** 2;
    const root = Math.sqrt(Math.max(diagonal, 1e-12));
    matrix[j * n + j] = root;
    for (let i = j + 1; i < n; i++) {
      let sum = matrix[i * n + j];
      for (let k = 0; k < j; k++) sum -= matrix[i * n + k] * matrix[j * n + k];
      matrix[i * n + j] = sum / root;
    }
    for (let k = j + 1; k < n; k++) matrix[j * n + k] = 0;
  }
  return matrix;
}

/** Solve L y = b. */
function forward(lower: Float64Array, n: number, b: ArrayLike<number>): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= lower[i * n + k] * y[k];
    y[i] = sum / lower[i * n + i];
  }
  return y;
}

/** Solve Lᵀ x = y. */
function backward(lower: Float64Array, n: number, y: ArrayLike<number>): Float64Array {
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= lower[k * n + i] * x[k];
    x[i] = sum / lower[i * n + i];
  }
  return x;
}

function along(difference: Difference, vector: ArrayLike<number>): number {
  let sum = 0;
  for (const [i, value] of difference) sum += value * vector[i];
  return sum;
}

/**
 * The Laplace posterior over the options' effects: its mean, and for any options their
 * covariance, τ²I − τ⁴ (L⁻¹ √W Δ)ᵀ (L⁻¹ √W Δ) restricted to them, where L is the Cholesky factor of
 * B = I + √W K √W at the mode, with K = τ² Δ Δᵀ the prior covariance of the answers' differences.
 */
export type Posterior = {
  space: Space;
  mean: Float64Array;
  covariance: (features: readonly number[]) => Float64Array;
};

/** The posterior of the evidence, by Newton's method to its mode. */
export function fitPreferences(duels: readonly Duel[]): Posterior {
  const { space, differences } = spaceOf(duels);
  const n = duels.length;
  const kernel = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const dense = new Float64Array(space.size);
    for (const [k, value] of differences[i]) dense[k] += value;
    for (let j = 0; j < n; j++) kernel[i * n + j] = variance * along(differences[j], dense);
  }
  const times = (vector: ArrayLike<number>) =>
    Float64Array.from({ length: n }, (_, i) => {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += kernel[i * n + j] * vector[j];
      return sum;
    });
  let latent = new Float64Array(n);
  const at = () => {
    const gradient = new Float64Array(n);
    const rootW = new Float64Array(n);
    duels.forEach(({ outcome, weight }, i) => {
      const { gradient: g, curvature } = likelihood(latent[i], outcome);
      gradient[i] = weight * g;
      rootW[i] = Math.sqrt(weight * Math.max(curvature, 0));
    });
    const b = new Float64Array(n * n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        b[i * n + j] = (i === j ? 1 : 0) + rootW[i] * kernel[i * n + j] * rootW[j];
    return { gradient, rootW, lower: cholesky(b, n) };
  };
  for (let iteration = 0; iteration < 50; iteration++) {
    const { gradient, rootW, lower } = at();
    const b = latent.map((value, i) => rootW[i] ** 2 * value + gradient[i]);
    const c = backward(
      lower,
      n,
      forward(
        lower,
        n,
        times(b).map((value, i) => rootW[i] * value)
      )
    );
    const next = times(b.map((value, i) => value - rootW[i] * c[i]));
    const moved = next.reduce(
      (largest, value, i) => Math.max(largest, Math.abs(value - latent[i])),
      0
    );
    latent = next;
    if (moved < 1e-8) break;
  }
  const { gradient, rootW, lower } = at();
  // At the mode, the mean is τ² Δᵀ ∇ log p(answers | f).
  const mean = new Float64Array(space.size);
  differences.forEach((difference, i) => {
    for (const [k, value] of difference) mean[k] += variance * value * gradient[i];
  });
  const covariance = (features: readonly number[]) => {
    const k = features.length;
    // Columns of L⁻¹ √W Δ for these features.
    const columns = features.map((feature) =>
      forward(
        lower,
        n,
        differences.map((difference, i) => {
          let sum = 0;
          for (const [index, value] of difference) if (index === feature) sum += value;
          return rootW[i] * sum;
        })
      )
    );
    const result = new Float64Array(k * k);
    for (let a = 0; a < k; a++)
      for (let b = 0; b < k; b++) {
        let explained = 0;
        for (let i = 0; i < n; i++) explained += columns[a][i] * columns[b][i];
        result[a * k + b] = (a === b ? variance : 0) - variance ** 2 * explained;
      }
    return result;
  };
  return { space, mean, covariance };
}

/** A standard normal draw (Box–Muller). */
function normal(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

/**
 * Draws of the posterior that tell the probability of being best apart to about ±0.01, from a
 * fixed seed, so the same events always settle the same choices.
 */
const draws = 2000;

/** What the evidence says about one choice: each option it compared, and how likely each is best. */
export type ChoiceBelief = {
  variable: string;
  options: DesignValue[];
  /** The probability each option is the best of those compared, in the order of options. */
  best: number[];
  likeliest: DesignValue;
  probability: number;
};

/** The probability each compared option of each choice is best, by draws from the posterior. */
export function choiceBeliefs(posterior: Posterior): Map<string, ChoiceBelief> {
  const beliefs = new Map<string, ChoiceBelief>();
  for (const [variable, { values, features }] of posterior.space.options) {
    const k = features.length;
    if (k < 2) continue;
    const lower = cholesky(posterior.covariance(features), k);
    const random = seededRandom(1, 1);
    const wins = new Array<number>(k).fill(0);
    const noise = new Float64Array(k);
    for (let draw = 0; draw < draws; draw++) {
      for (let i = 0; i < k; i++) noise[i] = normal(random);
      let top = 0;
      let topValue = -Infinity;
      for (let i = 0; i < k; i++) {
        let value = posterior.mean[features[i]];
        for (let j = 0; j <= i; j++) value += lower[i * k + j] * noise[j];
        if (value > topValue) [top, topValue] = [i, value];
      }
      wins[top] += 1;
    }
    const best = wins.map((count) => count / draws);
    const top = best.indexOf(Math.max(...best));
    beliefs.set(variable, {
      variable,
      options: values,
      best,
      likeliest: values[top],
      probability: best[top]
    });
  }
  return beliefs;
}

// --- Settling ---------------------------------------------------------------------------------

/**
 * Where a choice stands: settled at a value (very likely best, or fixed by a vary decision no answer
 * has since disagreed with), either (the latest answer about it was either is fine, so it does not
 * matter, and the value shown stays), or open.
 */
export type ChoiceState = {
  variable: string;
  state: 'settled' | 'either' | 'open';
  value?: DesignValue;
  /** The likeliest option of those compared, and how likely it is best of them. */
  likeliest?: DesignValue;
  probability?: number;
  /** How many answers and vary decisions involved it. */
  answers: number;
  /** The options the answers compared. */
  compared: DesignValue[];
  /** Where a later answer preferred the option an earlier one turned down: the two, earlier first. */
  reversed?: { earlier: DesignValue; later: DesignValue };
};

/**
 * Every choice the evidence touches, and where it stands. Rules, in order, by the choice's latest
 * evidence: a vary decision last fixes its value; either is fine last makes it either; otherwise it
 * settles at an option at least settlingProbability likely best over at least settlingAnswers
 * answers, or at a vary decision's value no later answer went against, and is open otherwise.
 */
export function choiceStates(evidence: PreferenceEvidence): Map<string, ChoiceState> {
  const beliefs = choiceBeliefs(fitPreferences(evidence.duels));
  // Each choice's evidence, oldest first: answers (duels of weight 1) and fixes.
  type Mark = { kind: 'answer'; duel: Duel } | { kind: 'fix'; value: DesignValue; eventId: number };
  const marks = new Map<string, Mark[]>();
  const mark = (variable: string, entry: Mark) => {
    if (!marks.has(variable)) marks.set(variable, []);
    marks.get(variable)!.push(entry);
  };
  for (const duel of evidence.duels)
    if (duel.weight === 1)
      for (const variable of Object.keys(duel.first)) mark(variable, { kind: 'answer', duel });
  for (const fix of evidence.fixes) mark(fix.variable, { kind: 'fix', ...fix });
  const states = new Map<string, ChoiceState>();
  for (const [variable, entries] of marks) {
    entries.sort(
      (a, b) =>
        (a.kind === 'fix' ? a.eventId : a.duel.eventId) -
        (b.kind === 'fix' ? b.eventId : b.duel.eventId)
    );
    const belief = beliefs.get(variable);
    const compared = belief?.options ?? [
      ...new Set(
        entries.flatMap((entry) =>
          entry.kind === 'fix'
            ? [entry.value]
            : [entry.duel.first[variable], entry.duel.second[variable]]
        )
      )
    ];
    const won = new Set<string>();
    let reversed: ChoiceState['reversed'];
    for (const entry of entries) {
      if (entry.kind !== 'answer' || entry.duel.outcome !== 'win') continue;
      const [winner, loser] = [entry.duel.first[variable], entry.duel.second[variable]];
      if (won.has(JSON.stringify([loser, winner]))) reversed = { earlier: loser, later: winner };
      won.add(JSON.stringify([winner, loser]));
    }
    const common = {
      variable,
      answers: entries.length,
      compared,
      ...(reversed ? { reversed } : {}),
      ...(belief ? { likeliest: belief.likeliest, probability: belief.probability } : {})
    };
    const last = entries.at(-1)!;
    const lastFix = entries.findLastIndex((entry) => entry.kind === 'fix');
    const fixed = lastFix >= 0 ? (entries[lastFix] as Extract<Mark, { kind: 'fix' }>) : undefined;
    // An answer after the fix that preferred another value, or called it a tie with another.
    const disagreed =
      fixed &&
      entries
        .slice(lastFix + 1)
        .some(
          (entry) =>
            entry.kind === 'answer' &&
            (entry.duel.first[variable] !== fixed.value || entry.duel.outcome === 'tie')
        );
    let state: Pick<ChoiceState, 'state' | 'value'>;
    if (last.kind === 'fix') state = { state: 'settled', value: last.value };
    else if (last.duel.outcome === 'tie')
      state = { state: 'either', value: last.duel.first[variable] };
    else if (
      belief &&
      belief.probability >= settlingProbability &&
      entries.length >= settlingAnswers
    )
      state = { state: 'settled', value: belief.likeliest };
    else if (fixed && !disagreed) state = { state: 'settled', value: fixed.value };
    else state = { state: 'open' };
    states.set(variable, { ...common, ...state });
  }
  return states;
}

/** The values the evidence in these events settles, a choice that is either keeping what showed. */
export function settledFromEvidence(events: readonly ProjectEvent[]): DesignValues {
  const settled: Record<string, DesignValue> = {};
  for (const { variable, state, value } of choiceStates(preferenceEvidence(events)).values())
    if (state !== 'open' && value !== undefined) settled[variable] = value;
  return settled;
}
