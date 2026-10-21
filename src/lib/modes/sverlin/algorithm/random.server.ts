/**
 * Seeded randomness for choosing variants: a deterministic generator, and one number per seed and
 * key, independent of every other key (see ../design.server.ts).
 */

// Changing the generator, the hashes, or this stream changes every randomised variant; version
// them if presentations must keep rebuilding identically.
const designStream = 1;

/**
 * Deterministic mulberry32 generator for one seed and stream, returning values in [0, 1). The
 * seed and stream are hashed first so that neighbouring seeds give unrelated sequences.
 */
export function seededRandom(seed: number, stream: number): () => number {
  let state = mix32(mix32(seed) ^ Math.imul(stream, 0x9e3779b9));
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit integer hash with full avalanche (the murmur3 finaliser with tuned constants). */
function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

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
