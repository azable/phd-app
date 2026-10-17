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

/** The part of a block's body a piece of code covers, as offsets from its start. */
export type Span = { start: number; end: number };

/**
 * A problem in a block: where in the block's body it starts when known, and where the code it is
 * about ends, so the whole of it can be underlined.
 */
export class AlgorithmError extends Error {
  readonly offset?: number;
  readonly end?: number;

  constructor(message: string, at?: number | Span) {
    super(message);
    this.name = 'AlgorithmError';
    if (typeof at === 'number') this.offset = at;
    else if (at) {
      this.offset = at.start;
      this.end = at.end;
    }
  }
}

/** An acorn node type as words, such as "Arrow Function Expression". */
export function describe(type: string): string {
  return type.replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/^./u, (first) => first.toUpperCase());
}
