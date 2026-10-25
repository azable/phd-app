/**
 * Links from the timeline to the source panel: the source the panel shows, which references in
 * messages are matched against, and the regions to reveal in it.
 *
 * @packageDocumentation
 */

import { getContext, setContext } from 'svelte';

import type { ReferenceDesign, SourceRange } from '$lib/client/artifacts/source-references';

/**
 * Regions to reveal in a source, and design variables whose rows to reveal (see ghostKey), numbered
 * so the same can be revealed again.
 */
export type SourceReveal = {
  source: string;
  ranges: readonly SourceRange[];
  keys: readonly string[];
  id: number;
};

/** The source shown and what to reveal in it, shared by the timeline and the source panel. */
export class SourceLinks {
  /** The source the panel shows. */
  shown = $state('');
  /** What a build of the shown source records, where one did: which choice each render reads. */
  shownDesign = $state.raw<ReferenceDesign | undefined>(undefined);
  /** The regions to reveal, until others are or they are cleared. */
  revealed = $state.raw<SourceReveal | undefined>(undefined);
  #next = 0;

  /** Whether these regions of a source, and these variables' rows, are the ones revealed. */
  isRevealed(
    source: string,
    ranges: readonly SourceRange[],
    keys: readonly string[] = []
  ): boolean {
    const current = this.revealed;
    return (
      current !== undefined &&
      current.source === source &&
      current.ranges.length === ranges.length &&
      current.ranges.every(
        ({ from, to }, index) => from === ranges[index].from && to === ranges[index].to
      ) &&
      current.keys.length === keys.length &&
      current.keys.every((key, index) => key === keys[index])
    );
  }

  /** Reveal regions of a source and rows of variables; revealing the ones already shown clears them. */
  reveal(source: string, ranges: readonly SourceRange[], keys: readonly string[] = []): void {
    if (this.isRevealed(source, ranges, keys)) this.revealed = undefined;
    else this.show(source, ranges, keys);
  }

  /** Reveal regions of a source and rows of variables, whatever is shown. */
  show(source: string, ranges: readonly SourceRange[], keys: readonly string[] = []): void {
    this.revealed =
      ranges.length || keys.length ? { source, ranges, keys, id: ++this.#next } : undefined;
  }
}

const key = Symbol('source-links');

/** Share links to the source panel with the components inside. */
export function provideSourceLinks(links: SourceLinks): SourceLinks {
  return setContext(key, links);
}

/** The links to the source panel, if a workspace provides them. */
export function sourceLinksContext(): SourceLinks | undefined {
  return getContext<SourceLinks | undefined>(key);
}
