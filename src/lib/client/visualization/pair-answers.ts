import type { Component } from 'svelte';

/** A pair's answers, which the stage gives the chat to show in place of Submit. */
export type PairAnswers = {
  /** Each side, either is fine (tie) and unsure (skip), as buttons. */
  answers: { answer: string; label: string; text: string; icons: Component[] }[];
  /** The answer given, its button filled. */
  chosen?: string;
  disabled: boolean;
  /** The answers wait for a reply on its way. */
  waiting: boolean;
};
