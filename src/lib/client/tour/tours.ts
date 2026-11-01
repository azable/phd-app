/** The interface tour's content per system, where each viewer's progress is kept, and placement. */

import {
  interfacePart,
  type InterfacePartId,
  type InterfacePartLocator
} from '$lib/shared/interface-parts';
import type { VisualizationMode } from '$lib/shared/presentations';

export type TourStep = { part: InterfacePartId; title: string; body: string };
export type Tour = { id: string; steps: TourStep[] };

const introParts: InterfacePartId[] = ['timeline', 'stage', 'step-controls', 'message-box', 'help'];

/** Hints shown the first time their first part appears; later steps show if found. */
const hintParts: Record<string, InterfacePartId[]> = {
  versions: ['version-pill'],
  comparison: ['answer-buttons', 'comparison-card'],
  choices: ['choices-panel'],
  history: ['return-to-present']
};

function stepsFor(mode: VisualizationMode, parts: InterfacePartId[]): TourStep[] {
  return parts.flatMap((id) => {
    const { name, descriptions } = interfacePart(id);
    const body = descriptions[mode];
    return body ? [{ part: id, title: name, body }] : [];
  });
}

export function introTour(mode: VisualizationMode): Tour {
  return { id: `${mode}:intro`, steps: stepsFor(mode, introParts) };
}

/** The just-in-time hints of a system: only those whose first part its interface has. */
export function hintTours(mode: VisualizationMode): Tour[] {
  return Object.entries(hintParts).flatMap(([name, parts]) => {
    const steps = stepsFor(mode, parts);
    return steps[0]?.part === parts[0] ? [{ id: `${mode}:hint:${name}`, steps }] : [];
  });
}

/** Finds a part in `root`: its locator's match, if it takes up room on screen. */
export function locate(
  root: ParentNode,
  { selector, last, up = 0 }: InterfacePartLocator
): Element | undefined {
  const matches = root.querySelectorAll(selector);
  let element: Element | null = (last ? matches[matches.length - 1] : matches[0]) ?? null;
  for (let level = 0; element && level < up; level++) element = element.parentElement;
  return element && element.getClientRects().length > 0 ? element : undefined;
}

/**
 * The tours each viewer has seen, in this browser. Storage can be missing or throw (private
 * windows, blocked site data), so a copy in memory keeps the tour from repeating in this page.
 */
export class SeenTours {
  #seen: Set<string>;
  readonly #key: string;

  constructor(
    viewer: string,
    private readonly storage: () => Storage | undefined = () => globalThis.localStorage
  ) {
    this.#key = `interface-tour:v1:${viewer}`;
    this.#seen = new Set(this.#read());
  }

  has(id: string): boolean {
    return this.#seen.has(id);
  }

  add(id: string): void {
    this.#seen.add(id);
    this.#write();
  }

  reset(): void {
    this.#seen.clear();
    try {
      this.storage()?.removeItem(this.#key);
    } catch {
      // Without storage only this page forgets.
    }
  }

  #read(): string[] {
    try {
      const value: unknown = JSON.parse(this.storage()?.getItem(this.#key) ?? '[]');
      return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  #write() {
    try {
      this.storage()?.setItem(this.#key, JSON.stringify([...this.#seen]));
    } catch {
      // Remembered in memory for this page.
    }
  }
}

type Box = { top: number; left: number; width: number; height: number };
type Size = { width: number; height: number };
export type Side = 'bottom' | 'top' | 'right' | 'left' | 'over';

/**
 * Where a popover of `size` goes beside `target` in the viewport: the first side with room, else
 * over the target's visible part (a part as large as the timeline leaves no room beside it).
 * Always `margin` inside the viewport.
 */
export function placePopover(
  target: Box | undefined,
  size: Size,
  viewport: Size,
  gap = 12,
  margin = 16
): { top: number; left: number; side: Side } {
  const clamp = (value: number, length: number, room: number) =>
    Math.max(margin, Math.min(value, room - length - margin));
  const centered = (start: number, length: number, own: number, room: number) =>
    clamp(start + (length - own) / 2, own, room);
  if (!target) {
    return {
      top: centered(0, viewport.height, size.height, viewport.height),
      left: centered(0, viewport.width, size.width, viewport.width),
      side: 'over'
    };
  }
  const bottom = target.top + target.height;
  const right = target.left + target.width;
  const across = centered(target.left, target.width, size.width, viewport.width);
  const down = centered(target.top, target.height, size.height, viewport.height);
  if (viewport.height - bottom >= size.height + gap + margin)
    return { top: bottom + gap, left: across, side: 'bottom' };
  if (target.top >= size.height + gap + margin)
    return { top: target.top - gap - size.height, left: across, side: 'top' };
  if (viewport.width - right >= size.width + gap + margin)
    return { top: down, left: right + gap, side: 'right' };
  if (target.left >= size.width + gap + margin)
    return { top: down, left: target.left - gap - size.width, side: 'left' };
  // Inside the bottom of the target's visible part, where a large part's own content is least.
  const visibleBottom = Math.min(bottom, viewport.height);
  return {
    top: clamp(visibleBottom - size.height - gap, size.height, viewport.height),
    left: across,
    side: 'over'
  };
}
