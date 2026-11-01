/**
 * Spotlighting an interface part, from the tour or from anywhere else (for example a reply that
 * points at a part). The tour's overlay draws it; with no overlay mounted nothing shows.
 */

import { interfacePart, type InterfacePartId } from '$lib/shared/interface-parts';

import { locate } from './tours';

/** How long a highlight asked for outside the tour stays, long enough to find the part. */
const highlightMilliseconds = 6_000;

export const spotlight = $state<{ highlighted?: InterfacePartId }>({});

let clearing: ReturnType<typeof setTimeout> | undefined;

/** The part on screen now, if it is. */
export function findPart(id: InterfacePartId, root: ParentNode = document): Element | undefined {
  return locate(root, interfacePart(id).locator);
}

/** Spotlight a part for a few seconds; false, and nothing shown, when it is not on screen. */
export function highlightPart(id: InterfacePartId): boolean {
  const onScreen = typeof document !== 'undefined' && findPart(id) !== undefined;
  clearHighlight();
  if (!onScreen) return false;
  spotlight.highlighted = id;
  clearing = setTimeout(clearHighlight, highlightMilliseconds);
  return true;
}

export function clearHighlight(): void {
  clearTimeout(clearing);
  spotlight.highlighted = undefined;
}
