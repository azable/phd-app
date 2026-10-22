/** Vocabulary shared by every Sverlin block: its kinds, its error, and its reserved names. */

/**
 * Domain: type definitions. Input: fixed initial state. Design: seeded presentation choices.
 * Algorithm: the yielding steps.
 */
export type BlockKind = 'domain' | 'input' | 'algorithm';

/**
 * Names the view receives from the application rather than from a block, and those each step
 * records for operations: the calls since the last step, and every call so far by operation.
 */
export const reservedNames: ReadonlySet<string> = new Set(['step', 'seed', 'event', 'history']);

/** The domain block's functions, each defining one type or operation. */
export const domainFunctions: ReadonlySet<string> = new Set([
  'type',
  'union',
  'record',
  'collection',
  'index',
  'ref',
  'operation'
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
  /** The block the problem is in, when not the one being run, as an operation's body is. */
  readonly block?: BlockKind;

  constructor(message: string, at?: number | Span, block?: BlockKind) {
    super(message);
    this.name = 'AlgorithmError';
    if (block) this.block = block;
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
