/**
 * Test support: a source whose stepping scenes name no pause, made to pause at every label, as
 * sources were paced before each scene chose its own pauses. A scene with a pause, a scene stepping
 * over a list, and a frame, are left as written.
 */

import { prepareSvelteComponent } from '../compile.server';

export function pausingEveryLabel(source: string): string {
  const { labels } = prepareSvelteComponent(source).pauses;
  if (!labels.length) return source;
  const pause = labels.map((label) => `@${label}`).join(', ');
  return source.replace(
    /<Scene(?![^>]*\b(?:pause|over)=)(?=[^>]*\bcase=)/gu,
    `<Scene pause="${pause}"`
  );
}

/** A source whose stepping scenes all pause at these labels, as `@insert.swap, @insert.test`. */
export function pausingAt(source: string, pause: string): string {
  return source
    .replace(/(<Scene[^>]*?) pause="[^"]*"/gu, '$1')
    .replace(/<Scene(?=[^>]*\bcase=)/gu, `<Scene pause="${pause}"`);
}
