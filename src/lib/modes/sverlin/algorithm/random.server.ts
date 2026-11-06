/**
 * Seeded randomness for choosing variants: one number per seed and key, independent of every
 * other key (see ../design.server.ts), from the shared generator ($lib/shared/random.ts).
 */

import { seededRandom } from '$lib/shared/random';

// Changing the generator, the hashes, or this stream changes every randomised variant; version
// them if presentations must keep rebuilding identically.
const designStream = 1;

/** One random number in [0, 1) for a seed and a key, independent of every other key. */
export function keyedRandom(seed: number, key: string): number {
  return seededRandom(seed, keyStream(key))();
}

/** A stream number for a key: FNV-1a over the key, mixed with the design stream. */
function keyStream(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++)
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193);
  return (hash ^ designStream) >>> 0;
}
