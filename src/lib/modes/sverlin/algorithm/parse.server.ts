/** Parse one block with acorn and check it against the subset its kind allows. */

import { parse, type AnyNode, type BlockStatement, type FunctionDeclaration } from 'acorn';

import { typeNames, type DomainRegistry } from './structures.server';
import { AlgorithmError, type BlockKind, type Span } from './block.server';
import { readMarkers, type Marker } from './labels.server';
import { checkSubset } from './subset.server';

// A strict-mode wrapper lets acorn parse top-level return; it shares the body's first line.
const wrapperPrefix = "function algorithm() {'use strict';";

/**
 * Parse a block's body and check its subset. Offsets are relative to the body; the domain
 * names the type constructors the block may call. The algorithm's label markers are read first
 * and blanked (see labels.server.ts): `code` is the body as parsed.
 */
export function parseBlock(
  body: string,
  kind: BlockKind,
  domain?: DomainRegistry
): {
  root: BlockStatement;
  offset: (node: AnyNode) => Span;
  markers: Marker[];
  code: string;
} {
  let program;
  const { code, markers, problems } =
    kind === 'algorithm' ? readMarkers(body) : { code: body, markers: [], problems: [] };
  const [problem] = problems;
  if (problem) throw new AlgorithmError(problem.message, problem.at);
  try {
    program = parse(`${wrapperPrefix}${code}\n}`, { ecmaVersion: 2022, sourceType: 'script' });
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
  const offset = spanOf;
  checkSubset(root, offset, kind, new Set(domain ? typeNames(domain) : []));
  return { root, offset, markers, code };
}

/** A node's span in its block's body, the same for every block. */
export function spanOf(node: AnyNode): Span {
  return { start: node.start - wrapperPrefix.length, end: node.end - wrapperPrefix.length };
}
