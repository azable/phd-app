/** Copy text to the clipboard, whether it could. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a key press is the shortcut copying the shown presentation's name, Alt+Shift+C, outside
 * text being edited; by the key's place, as Alt changes the character it types on macOS.
 */
export function isCopyNameShortcut(event: KeyboardEvent): boolean {
  if (!(event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey)) return false;
  if (event.code !== 'KeyC') return false;
  const target = event.target as HTMLElement | null;
  return !target?.closest?.(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"]'
  );
}
