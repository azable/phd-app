/** Vocabulary shared by every Sverlin block: its kinds, its error, and its reserved names. */

/**
 * Domain: type definitions. Input: fixed initial state. Design: seeded presentation choices.
 * Algorithm: the yielding steps.
 */
export type BlockKind = 'domain' | 'input' | 'design' | 'algorithm';

/** Names the view receives from the application rather than from a block. */
export const reservedNames: ReadonlySet<string> = new Set(['step', 'seed']);

/** The domain block's functions, each defining one type. */
export const domainFunctions: ReadonlySet<string> = new Set([
  'type',
  'union',
  'record',
  'collection'
]);

/** Property names no block may read, write, or declare. */
export const forbiddenProperties: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor'
]);

/** A problem in a block, at an offset into the block's body when known. */
export class AlgorithmError extends Error {
  readonly offset?: number;

  constructor(message: string, offset?: number) {
    super(message);
    this.name = 'AlgorithmError';
    if (offset !== undefined) this.offset = offset;
  }
}

/** An acorn node type as words, such as "Arrow Function Expression". */
export function describe(type: string): string {
  return type.replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/^./u, (first) => first.toUpperCase());
}
