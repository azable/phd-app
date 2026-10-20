/** Reactive selection state shared by the Timeline and visualization stage. */

import type { ProjectEvent } from '$lib/shared/projects/events';
import { isSverlinPresentation, type PresentationLayout } from '$lib/shared/presentations';

import {
  availablePresentations,
  compatibleSverlinPair,
  latestPresentations,
  presentationsById,
  timelinePresentations,
  type TimelinePresentation
} from './presentation-history';

/** Coordinates generated sets, custom pairs, and live-head following. */
export class PresentationSelection {
  selectedIds = $state.raw<string[]>([]);
  followingLatest = $state(true);
  notice = $state<string | null>(null);

  /**
   * @param requestLayout Lets the selection imply the layout: Shift-selecting a second variant asks
   *   for comparison and selecting a single variant asks for single view. It returns false where
   *   the layout is fixed, such as study conditions.
   */
  constructor(
    readonly buffered = false,
    private readonly requestLayout?: (layout: PresentationLayout) => boolean
  ) {}

  /** Presentations currently shown on the stage. */
  selected(events: readonly ProjectEvent[], layout: PresentationLayout): TimelinePresentation[] {
    const all = timelinePresentations(events);
    if (this.followingLatest) return this.automatic(events, all, layout);
    return presentationsById(all, this.selectedIds).slice(0, layout === 'comparison' ? 2 : 1);
  }

  /** Activate a generated set, or use Shift to build a compatible historical pair. */
  activate(
    presentation: TimelinePresentation,
    events: readonly ProjectEvent[],
    layout: PresentationLayout,
    extend = false
  ): void {
    const all = timelinePresentations(events);
    if (extend) {
      const activeIds = (
        this.followingLatest
          ? this.automatic(events, all, layout).map(
              ({ presentation: value }) => value.presentationId
            )
          : this.selectedIds
      ).slice(0, layout === 'comparison' ? 2 : 1);
      if (layout !== 'comparison') {
        this.extendIntoComparison(presentation, all, activeIds);
        return;
      }
      this.extend(presentation, all, activeIds);
      return;
    }
    const next = [presentation.presentation.presentationId];
    const effective = layout === 'comparison' && this.requestLayout?.('single') ? 'single' : layout;
    this.setIds(next);
    this.followingLatest =
      effective === 'single' &&
      sameIds(
        next,
        this.automatic(events, all, effective).map(
          ({ presentation: value }) => value.presentationId
        )
      );
    this.notice = null;
  }

  /** Resume automatic selection of newly generated output. */
  returnToLatest(): void {
    this.followingLatest = true;
    this.notice = null;
  }

  /** Keep one visible set stable while an operation evaluates it. */
  pin(presentations: readonly TimelinePresentation[]): void {
    this.setIds(presentations.map(({ presentation }) => presentation.presentationId));
    this.followingLatest = false;
    this.notice = null;
  }

  private automatic(
    events: readonly ProjectEvent[],
    all: readonly TimelinePresentation[],
    layout: PresentationLayout
  ): TimelinePresentation[] {
    return this.buffered
      ? availablePresentations(events, layout)
      : latestPresentations(all, layout);
  }

  /** In single view, Shift adds a compatible second variant and switches to comparison. */
  private extendIntoComparison(
    selected: TimelinePresentation,
    all: readonly TimelinePresentation[],
    activeIds: readonly string[]
  ): void {
    const id = selected.presentation.presentationId;
    if (activeIds.includes(id)) return;
    const problem = this.extensionProblem(selected, all, activeIds);
    if (problem) {
      this.notice = problem;
      return;
    }
    if (!this.requestLayout?.('comparison')) {
      this.notice = 'Comparisons are unavailable in single-view mode.';
      return;
    }
    this.setIds([...activeIds, id]);
    this.followingLatest = false;
    this.notice = null;
  }

  private extend(
    selected: TimelinePresentation,
    all: readonly TimelinePresentation[],
    activeIds: readonly string[]
  ): void {
    const id = selected.presentation.presentationId;
    if (activeIds.includes(id)) {
      const remaining = activeIds.filter((selectedId) => selectedId !== id);
      if (remaining.length === 1) this.requestLayout?.('single');
      this.setIds(remaining);
      this.followingLatest = false;
      this.notice = null;
      return;
    }
    const problem = this.extensionProblem(selected, all, activeIds);
    if (problem) {
      this.notice = problem;
      return;
    }
    this.setIds([...activeIds, id]);
    this.followingLatest = false;
    this.notice = null;
  }

  private extensionProblem(
    selected: TimelinePresentation,
    all: readonly TimelinePresentation[],
    activeIds: readonly string[]
  ): string | undefined {
    if (!isSverlinPresentation(selected.presentation))
      return 'HTML visualizations can only be viewed one at a time.';
    if (activeIds.length >= 2) return 'Deselect one visualization before adding another.';
    const current = presentationsById(all, activeIds);
    if (current.length === 1 && !compatibleSverlinPair(current[0], selected))
      return 'Only compatible versions of the same visualization can be compared.';
    return undefined;
  }

  private setIds(ids: readonly string[]): void {
    if (sameIds(this.selectedIds, ids)) return;
    this.selectedIds = [...ids];
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * The candidate the participant's next step builds on: the one shown, or the first of a pair built
 * from one source. A pair built from two sources leaves the newest source to build on.
 */
export function baseCandidate(visible: readonly TimelinePresentation[]): string | undefined {
  const [first] = visible;
  if (!first || !isSverlinPresentation(first.presentation)) return undefined;
  const hash = first.presentation.source.sha256;
  return visible.every(
    ({ presentation }) => isSverlinPresentation(presentation) && presentation.source.sha256 === hash
  )
    ? first.presentation.presentationId
    : undefined;
}
