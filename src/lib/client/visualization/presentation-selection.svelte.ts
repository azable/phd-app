/** Reactive selection state shared by the Timeline and visualization stage. */

import type { EventId, ProjectEvent } from '$lib/shared/projects/events';
import { projectOperation } from '$lib/shared/projects/operations';
import { isSverlinPresentation, type PresentationLayout } from '$lib/shared/presentations';

import {
  availablePresentations,
  compatibleSverlinPair,
  discussedPresentation,
  newestPresentations,
  pairQuestion,
  presentationsById,
  timelinePresentations,
  type TimelinePresentation
} from './presentation-history';

/**
 * How long a comparison's answer shows on its pair before the next comparison replaces it, so the
 * pick is seen to register: about the half second people take to notice a change they made.
 */
export const pickConfirmationMs = 500;
/** How long the question of the comparison that replaced it stays highlighted, to be noticed. */
export const arrivalHighlightMs = 1200;

/** Coordinates generated sets, custom pairs, and live-head following. */
export class PresentationSelection {
  selectedIds = $state.raw<string[]>([]);
  followingLatest = $state(true);
  notice = $state<string | null>(null);
  /** A pair answered while its answer is saved, left out as if recorded. */
  #answered = $state.raw<readonly string[]>([]);
  /** The pair last answered, kept on the stage until what follows it arrives (see `awaiting`). */
  #held = $state.raw<HeldPair>();
  /** The pair last shown again from its comparison, a new object each time (see `showPair`). */
  reopened = $state.raw<{ ids: readonly string[] }>();
  /** The comparison answered last, once the next has replaced it, for a while (see `arrived`). */
  #replaced = $state.raw<readonly string[]>();

  /**
   * @param requestLayout Lets the selection imply the layout: Shift-selecting a second variant asks
   *   for comparison and selecting a single variant asks for single view. It returns false where
   *   the layout is fixed, such as study conditions.
   * @param questionPairs In the comparison layout, show a pair only while one of the assistant's
   *   comparisons is current, and otherwise the one presentation under discussion, as participants
   *   in the comparison condition see it.
   */
  constructor(
    readonly buffered = false,
    private readonly requestLayout?: (layout: PresentationLayout) => boolean,
    readonly questionPairs = false
  ) {}

  /** Presentations currently shown on the stage. */
  selected(events: readonly ProjectEvent[], layout: PresentationLayout): TimelinePresentation[] {
    const all = timelinePresentations(events);
    if (this.#holding(events, all, layout)) return presentationsById(all, this.#held?.ids ?? []);
    if (this.followingLatest) return this.automatic(events, all, layout);
    return presentationsById(all, this.selectedIds).slice(0, layout === 'comparison' ? 2 : 1);
  }

  /**
   * Whether the pair last answered is still shown in place of what follows it: `confirming` while
   * its answer shows on it (`pickConfirmationMs`); then `updating` while no other comparison waits
   * and the assistant's turn that the answer asked for has neither shown a version nor ended.
   */
  awaiting(events: readonly ProjectEvent[], layout: PresentationLayout): Awaiting | undefined {
    return this.#holding(events, timelinePresentations(events), layout);
  }

  /** Whether the comparison shown has just replaced the one answered (`arrivalHighlightMs`). */
  arrived(events: readonly ProjectEvent[], layout: PresentationLayout): boolean {
    const replaced = this.#replaced;
    if (!replaced) return false;
    const shown = this.selected(events, layout);
    const ids = shown.map(({ presentation }) => presentation.presentationId);
    return !!pairQuestion(shown) && !sameIds(ids, replaced);
  }

  /** Activate a generated set, or use Shift to build a compatible historical pair. */
  activate(
    presentation: TimelinePresentation,
    events: readonly ProjectEvent[],
    layout: PresentationLayout,
    extend = false
  ): void {
    this.#held = undefined;
    this.#replaced = undefined;
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

  /**
   * Show a pair side by side, as one of the assistant's comparisons, current or not, is shown;
   * following the latest only where it is what would show anyway.
   */
  showPair(
    pair: readonly TimelinePresentation[],
    events: readonly ProjectEvent[],
    layout: PresentationLayout
  ): void {
    if (pair.length !== 2) return;
    this.#held = undefined;
    this.#replaced = undefined;
    const effective =
      layout !== 'comparison' && this.requestLayout?.('comparison') ? 'comparison' : layout;
    const ids = pair.map(({ presentation }) => presentation.presentationId);
    this.setIds(ids);
    this.reopened = { ids };
    this.followingLatest = sameIds(
      ids,
      this.automatic(events, timelinePresentations(events), effective).map(
        ({ presentation }) => presentation.presentationId
      )
    );
    this.notice = null;
  }

  /** Resume automatic selection of newly generated output. */
  returnToLatest(): void {
    this.#held = undefined;
    this.#replaced = undefined;
    this.followingLatest = true;
    this.notice = null;
  }

  /**
   * Answer a pair: show what follows it, as if the answer were recorded, while `save` records it;
   * if saving fails, show the answered pair again. One of the assistant's comparisons first shows
   * its answer (`awaiting`); then another comparison waiting replaces it, or with none it stays
   * until its reply arrives.
   *
   * @param head The Timeline's head when answering, after which the reply's events follow.
   */
  async answer(
    presentations: readonly TimelinePresentation[],
    save: () => Promise<boolean>,
    head: EventId
  ): Promise<boolean> {
    const ids = presentations.map(({ presentation }) => presentation.presentationId);
    this.#answered = ids;
    this.returnToLatest();
    if (pairQuestion(presentations)) {
      this.#held = { ids, head, saving: true, confirming: true };
      setTimeout(() => {
        if (this.#held?.ids !== ids) return;
        this.#held = { ...this.#held, confirming: false };
        this.#replaced = ids;
        setTimeout(() => {
          if (this.#replaced === ids) this.#replaced = undefined;
        }, arrivalHighlightMs);
      }, pickConfirmationMs);
    }
    let saved = false;
    try {
      saved = await save();
    } finally {
      this.#answered = [];
      if (!saved) {
        this.#held = undefined;
        this.setIds(ids);
        this.followingLatest = false;
      } else if (this.#held?.ids === ids) this.#held = { ...this.#held, saving: false };
    }
    return saved;
  }

  #holding(
    events: readonly ProjectEvent[],
    all: readonly TimelinePresentation[],
    layout: PresentationLayout
  ): Awaiting | undefined {
    const held = this.#held;
    if (!held || !this.followingLatest) return undefined;
    if (held.confirming) return 'confirming';
    const next = this.automatic(events, all, layout);
    const nextIds = next.map(({ presentation }) => presentation.presentationId);
    if (pairQuestion(next) && !sameIds(nextIds, held.ids)) return undefined;
    if (events.some(({ id, type }) => id > held.head && type === 'visualization.presented'))
      return undefined;
    return held.saving || replyRunning(events, held.head) ? 'updating' : undefined;
  }

  private automatic(
    events: readonly ProjectEvent[],
    all: readonly TimelinePresentation[],
    layout: PresentationLayout
  ): TimelinePresentation[] {
    const answered = this.#answered;
    if (this.questionPairs && layout === 'comparison') {
      const pair = availablePresentations(events, layout, answered);
      return pairQuestion(pair) ? pair : discussedPresentation(all);
    }
    return this.buffered
      ? availablePresentations(events, layout, answered)
      : newestPresentations(events, layout, answered);
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
      return 'These visualizations can only be viewed one at a time.';
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

type Awaiting = 'confirming' | 'updating';
type HeldPair = { ids: readonly string[]; head: EventId; saving: boolean; confirming: boolean };

/** Whether the first assistant turn asked for after `head` is waiting or running. */
function replyRunning(events: readonly ProjectEvent[], head: EventId): boolean {
  const request = events.find(({ id, type }) => id > head && type === 'assistant.turn-requested');
  if (!request) return false;
  const claim = events.find(
    (event) =>
      event.type === 'assistant.turn-started' && event.payload.requestEventIds.includes(request.id)
  );
  if (!claim) return true;
  const status = projectOperation(events, claim.operationId)?.status;
  return status === 'accepted' || status === 'running';
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
