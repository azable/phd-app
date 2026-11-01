/** Reactive, mode-neutral playback position for one or two retained presentations. */

import { SvelteMap, SvelteSet } from 'svelte/reactivity';

import { alignPresentationFrames, presentationScenarioKey } from '$lib/shared/presentations';
import type { TimelinePresentation } from './presentation-history';

export type PresentationPlaybackFrame = {
  key: string;
  label: string;
  localSteps: Readonly<Record<string, number>>;
  /** Presentations that omit this step and keep showing their previous one. */
  held: readonly string[];
};

export type PresentationPlaybackContext = {
  key: string;
  stepCount: number;
  frames: readonly PresentationPlaybackFrame[];
  /** For a pair, which pair it is, and the frames at which its sides draw differently, if known. */
  pair?: string;
  differsAt?: readonly number[];
};

export function presentationPlaybackContext(
  presentations: readonly TimelinePresentation[]
): PresentationPlaybackContext {
  if (presentations.length === 0) return { key: '', stepCount: 0, frames: [] };
  const frames = alignPresentationFrames(presentations.map(({ presentation }) => presentation)).map(
    (frame, step) => ({ ...frame, key: `step:${step}` })
  );
  const scenarios = presentations.map(({ presentation }) =>
    presentation.format === 'browser-bundle-v1' ? presentationScenarioKey(presentation) : undefined
  );
  const sameSource = scenarios.every((key) => key !== undefined && key === scenarios[0]);
  const ids = presentations.map(({ presentation }) => presentation.presentationId);
  const [first, second] = presentations;
  // A pair's differences are counted in each side's own steps, the same on both sides.
  const differsAt =
    presentations.length === 2 && first.differsAt && second.differsAt
      ? first.differsAt.flatMap((local) => {
          const frame = frames.findIndex(
            ({ localSteps, held }) =>
              localSteps[ids[0]] === local && !held.includes(ids[0]) && !held.includes(ids[1])
          );
          return frame < 0 ? [] : [frame];
        })
      : undefined;
  return {
    key: sameSource ? `source:${scenarios[0]}` : `presentations:${ids.join(':')}`,
    stepCount: frames.length,
    frames,
    ...(differsAt ? { pair: ids.join(':'), differsAt } : {})
  };
}

/** Whether a presentation omits the current step and is holding its previous one. */
export function presentationHeld(
  context: PresentationPlaybackContext,
  presentationId: string,
  step: number
): boolean {
  return context.frames[clampStep(step, context.stepCount)]?.held.includes(presentationId) ?? false;
}

export function localPresentationStep(
  context: PresentationPlaybackContext,
  presentationId: string,
  step: number
): number {
  return context.frames[clampStep(step, context.stepCount)]?.localSteps[presentationId] ?? -1;
}

export class PresentationPlayback {
  #contextKey = $state('');
  #step = $state(0);
  /** The step each context was last left at, so returning to one shows it there again. */
  #lastSteps = new SvelteMap<string, number>();
  /** The pairs shown, each opened at its first difference only the first time. */
  #openedPairs = new SvelteSet<string>();

  activate(context: PresentationPlaybackContext): void {
    const opening = this.#firstDifference(context);
    if (opening !== undefined && context.pair) {
      this.#openedPairs.add(context.pair);
      this.seek(context, opening);
      return;
    }
    if (this.#contextKey !== context.key) {
      this.#contextKey = context.key;
      this.#step = this.#lastStep(context);
      return;
    }
    this.#step = clampStep(this.#step, context.stepCount);
  }

  stepFor(context: PresentationPlaybackContext): number {
    const opening = this.#firstDifference(context);
    if (opening !== undefined) return opening;
    return this.#contextKey === context.key
      ? clampStep(this.#step, context.stepCount)
      : this.#lastStep(context);
  }

  seek(context: PresentationPlaybackContext, step: number): number {
    this.#contextKey = context.key;
    this.#step = clampStep(step, context.stepCount);
    this.#lastSteps.set(context.key, this.#step);
    return this.#step;
  }

  /** Where a pair never shown before opens: the first step at which its sides draw differently. */
  #firstDifference(context: PresentationPlaybackContext): number | undefined {
    if (!context.pair || !context.differsAt?.length || this.#openedPairs.has(context.pair))
      return undefined;
    return clampStep(context.differsAt[0], context.stepCount);
  }

  #lastStep(context: PresentationPlaybackContext): number {
    return clampStep(this.#lastSteps.get(context.key) ?? 0, context.stepCount);
  }
}

function clampStep(step: number, stepCount: number): number {
  return Math.min(Math.max(0, step), Math.max(0, stepCount - 1));
}
