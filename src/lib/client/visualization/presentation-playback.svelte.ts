/** Reactive, mode-neutral playback position for one or two retained presentations. */

import { SvelteMap } from 'svelte/reactivity';

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
  return {
    key: sameSource
      ? `source:${scenarios[0]}`
      : `presentations:${presentations.map(({ presentation }) => presentation.presentationId).join(':')}`,
    stepCount: frames.length,
    frames
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

  activate(context: PresentationPlaybackContext): void {
    if (this.#contextKey !== context.key) {
      this.#contextKey = context.key;
      this.#step = this.#lastStep(context);
      return;
    }
    this.#step = clampStep(this.#step, context.stepCount);
  }

  stepFor(context: PresentationPlaybackContext): number {
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

  #lastStep(context: PresentationPlaybackContext): number {
    return clampStep(this.#lastSteps.get(context.key) ?? 0, context.stepCount);
  }
}

function clampStep(step: number, stepCount: number): number {
  return Math.min(Math.max(0, step), Math.max(0, stepCount - 1));
}
