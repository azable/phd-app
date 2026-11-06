/**
 * Seeded randomness: a deterministic generator for one seed and stream, used by the design's
 * random variants (modes/sverlin/algorithm/random.server.ts) and the preference model.
 */

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
