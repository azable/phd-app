/** Parse one block with acorn and check it against the subset its kind allows. */

import {
  parse,
  tokenizer,
  type AnyNode,
  type BlockStatement,
  type FunctionDeclaration,
  type Options
} from 'acorn';

import { operationNames, typeNames, type DomainRegistry } from './structures.server';
import { AlgorithmError, type BlockKind, type Span } from './block.server';
import { checkSubset } from './subset.server';

// A strict-mode generator wrapper lets acorn parse top-level yield; it shares the body's first line.
const wrapperPrefix = "function* algorithm() {'use strict';";
const options: Options = { ecmaVersion: 2022, sourceType: 'script' };

/**
 * Parse a block's body and check its subset. Offsets are relative to the body; the domain
 * names the type constructors and operations the block may call, and in the domain block itself,
 * where operations' bodies call them, its own declarations do.
 */
export function parseBlock(
  body: string,
  kind: BlockKind,
  domain?: DomainRegistry
): { root: BlockStatement; offset: (node: AnyNode) => Span } {
  let program;
  let functions = new Set<number>();
  try {
    let wrapped = `${wrapperPrefix}${body}\n}`;
    if (kind === 'algorithm') [wrapped, functions] = asGenerators(wrapped);
    program = parse(wrapped, options);
  } catch (cause) {
    const position = (cause as { pos?: unknown }).pos;
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new AlgorithmError(
      message.replace(/\s*\(\d+:\d+\)$/u, ''),
      typeof position === 'number'
        ? Math.min(Math.max(position - wrapperPrefix.length, 0), body.length)
        : undefined
    );
  }
  const root = (program.body[0] as FunctionDeclaration).body;
  const offset = (node: AnyNode): Span => ({
    start: node.start - wrapperPrefix.length,
    end: node.end - wrapperPrefix.length
  });
  const declared = kind === 'domain' ? ownDeclarations(root) : undefined;
  checkSubset(
    root,
    offset,
    kind,
    new Set(declared?.names ?? (domain ? typeNames(domain) : [])),
    new Set(declared?.operations ?? (domain ? operationNames(domain) : [])),
    functions
  );
  return { root, offset };
}

/**
 * The source with every function declaration read as a generator, so its body may yield as the
 * algorithm's does: the space after `function` becomes `*`, keeping every offset. Returns where
 * each such function starts; a function written with `*` is not among them.
 */
function asGenerators(source: string): [string, Set<number>] {
  let read = source;
  const starts = new Set<number>();
  for (const token of tokenizer(source, options)) {
    if (token.type.keyword !== 'function' || !/\s/u.test(source[token.end])) continue;
    const next = source[token.end + source.slice(token.end).search(/\S/u)];
    if (next === '*' || next === '(') continue;
    read = `${read.slice(0, token.end)}*${read.slice(token.end + 1)}`;
    starts.add(token.start);
  }
  return [read, starts];
}

/** The names the domain block declares, and those of them it declares as operations. */
function ownDeclarations(root: BlockStatement): { names: string[]; operations: string[] } {
  const names: string[] = [];
  const operations: string[] = [];
  for (const statement of root.body)
    if (statement.type === 'VariableDeclaration')
      for (const { id, init } of statement.declarations) {
        if (id.type !== 'Identifier') continue;
        names.push(id.name);
        if (
          init?.type === 'CallExpression' &&
          init.callee.type === 'Identifier' &&
          init.callee.name === 'operation'
        )
          operations.push(id.name);
      }
  return { names, operations };
}
