/** Parse one block with acorn and check it against the subset its kind allows. */

import { parse, type AnyNode, type BlockStatement, type FunctionDeclaration } from 'acorn';

import { operationNames, typeNames, type DomainRegistry } from './structures.server';
import { AlgorithmError, type BlockKind, type Span } from './block.server';
import { checkSubset } from './subset.server';

// A strict-mode generator wrapper lets acorn parse top-level yield; it shares the body's first line.
const wrapperPrefix = "function* algorithm() {'use strict';";

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
  try {
    program = parse(`${wrapperPrefix}${body}\n}`, { ecmaVersion: 2022, sourceType: 'script' });
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
    new Set(declared?.operations ?? (domain ? operationNames(domain) : []))
  );
  return { root, offset };
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
