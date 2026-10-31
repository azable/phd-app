/**
 * Whether the dev-mode variant controls (the chooser picker and New pair or Another variant)
 * show: only in dev mode, for a Sverlin source, and not where a buffer hands out the next pair.
 */
export function showsVariantControls(options: {
  developerView: boolean;
  mode: string;
  buffered: boolean;
}): boolean {
  return options.developerView && options.mode === 'sverlin' && !options.buffered;
}

/** Whether the current viewer owns the workflow represented by the timeout dialog. */
export function shouldShowPhaseExpiredDialog(
  isAdmin: boolean,
  context: 'participant' | 'admin-preview'
): boolean {
  return !isAdmin || context === 'admin-preview';
}
