/** Stable step identity for comparison and retained presentation playback. */

import { createHash } from 'node:crypto';

export function stepSignature(steps: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(steps)).digest('hex');
}
