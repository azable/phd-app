/**
 * Seeded randomness for the design block: a deterministic generator, keys that tie each draw to its
 * place in the block, and the meaning of each draw function.
 */

import type { AnyNode, BlockStatement } from 'acorn';

/** The draw functions a design block may call. */
export const drawFunctions: ReadonlySet<string> = new Set(['pick', 'int', 'real', 'chance']);

// Changing the generator, the hashes, or this stream changes every rebuilt presentation; version
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

/**
 * The random number for each draw of a parsed design block. Each draw is keyed by its place, such
 * as `flow` or `look.cells`, and takes its value from the seed and that key alone, so adding,
 * removing, or reordering other draws never changes it.
 */
export function keyedDraws(root: BlockStatement, seed: number): (draw: AnyNode) => number {
  const keys = drawKeys(root);
  return (draw) => keyedRandom(seed, keys.get(draw) ?? '');
}

/** One random number in [0, 1) for a seed and a key, independent of every other key. */
export function keyedRandom(seed: number, key: string): number {
  return seededRandom(seed, drawStream(key))();
}

/**
 * The key of every draw: its top-level const's name, then the property names and indices of the
 * object and array literals around it. The placement rules give every draw exactly one key.
 */
export function drawKeys(root: BlockStatement): Map<AnyNode, string> {
  const keys = new Map<AnyNode, string>();
  const visit = (node: AnyNode | null | undefined, path: string): void => {
    if (!node) return;
    if (node.type === 'CallExpression') keys.set(node, path);
    else if (node.type === 'ArrayExpression')
      node.elements.forEach((element, index) => visit(element, `${path}[${index}]`));
    else if (node.type === 'ObjectExpression')
      for (const property of node.properties) {
        if (property.type !== 'Property') continue;
        const name =
          property.key.type === 'Identifier'
            ? property.key.name
            : String((property.key as { value?: unknown }).value);
        visit(property.value, `${path}.${name}`);
      }
  };
  for (const statement of root.body)
    if (statement.type === 'VariableDeclaration')
      for (const declarator of statement.declarations)
        visit(declarator.init, (declarator.id as { name: string }).name);
  return keys;
}

/** A stream number for a draw key: FNV-1a over the key, mixed with the design stream. */
function drawStream(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++)
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193);
  return (hash ^ designStream) >>> 0;
}

/**
 * The value of one draw from its arguments and a single random number: pick(items), int(min, max)
 * inclusive, real(min, max), or chance(p). Invalid arguments throw an error naming the problem.
 */
export function drawValue(name: string, args: readonly unknown[], random: () => number): unknown {
  if (name === 'pick') {
    const [items] = args;
    if (!Array.isArray(items) || items.length === 0 || args.length !== 1)
      throw new Error('pick() takes one non-empty array of choices.');
    return items[Math.floor(random() * items.length)];
  }
  if (name === 'chance') {
    const [probability] = args;
    if (
      args.length !== 1 ||
      typeof probability !== 'number' ||
      !(probability >= 0 && probability <= 1)
    )
      throw new Error('chance() takes one probability from 0 to 1.');
    return random() < probability;
  }
  const [min, max] = args;
  if (
    args.length !== 2 ||
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min > max
  )
    throw new Error(`${name}() takes a finite minimum and maximum, with minimum ≤ maximum.`);
  if (name === 'int') {
    if (!Number.isInteger(min) || !Number.isInteger(max))
      throw new Error('int() bounds must be integers.');
    return min + Math.floor(random() * (max - min + 1));
  }
  if (name === 'real') return min + random() * (max - min);
  throw new Error(`${name}() is not a draw function.`);
}
