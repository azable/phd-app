/**
 * Links from the timeline to the source panel: the source the panel shows, which references in
 * messages are matched against, and the regions to reveal in it.
 *
 * @packageDocumentation
 */

import { getContext, setContext } from 'svelte';

import type { ReferenceDesign, SourceRange } from '$lib/client/artifacts/source-references';

/** Regions to reveal in a source, numbered so the same regions can be revealed again. */
export type SourceReveal = { source: string; ranges: readonly SourceRange[]; id: number };

/** The source shown and what to reveal in it, shared by the timeline and the source panel. */
export class SourceLinks {
  /** The source the panel shows. */
  shown = $state('');
  /** What a build of the shown source records, where one did: which choice each render reads. */
  shownDesign = $state.raw<ReferenceDesign | undefined>(undefined);
  /** The regions to reveal, until others are or they are cleared. */
  revealed = $state.raw<SourceReveal | undefined>(undefined);
  #next = 0;

  /** Whether these regions of a source are the ones revealed. */
  isRevealed(source: string, ranges: readonly SourceRange[]): boolean {
    const current = this.revealed;
    return (
      current !== undefined &&
      current.source === source &&
      current.ranges.length === ranges.length &&
      current.ranges.every(
        ({ from, to }, index) => from === ranges[index].from && to === ranges[index].to
      )
    );
  }

  /** Reveal regions of a source; revealing the ones already shown clears them. */
  reveal(source: string, ranges: readonly SourceRange[]): void {
    if (this.isRevealed(source, ranges)) this.revealed = undefined;
    else this.show(source, ranges);
  }

  /** Reveal regions of a source, whatever is shown. */
  show(source: string, ranges: readonly SourceRange[]): void {
    this.revealed = ranges.length ? { source, ranges, id: ++this.#next } : undefined;
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
