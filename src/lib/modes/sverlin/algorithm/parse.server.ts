/** Parse one block with acorn and check it against the subset its kind allows. */

import {
  parse,
  tokenizer,
  type AnyNode,
  type BlockStatement,
  type FunctionDeclaration,
  type Options
} from 'acorn';

import { typeNames, type DomainRegistry } from './structures.server';
import { AlgorithmError, type BlockKind, type Span } from './block.server';
import { readMarkers, type Marker } from './labels.server';
import { checkSubset } from './subset.server';

// A strict-mode generator wrapper lets acorn parse top-level yield; it shares the body's first line.
const wrapperPrefix = "function* algorithm() {'use strict';";
const options: Options = { ecmaVersion: 2022, sourceType: 'script' };

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
  comments: BlockComment[];
  markers: Marker[];
  code: string;
} {
  let program;
  let functions = new Set<number>();
  const comments: BlockComment[] = [];
  const { code, markers, problems } =
    kind === 'algorithm' ? readMarkers(body) : { code: body, markers: [], problems: [] };
  const [problem] = problems;
  if (problem) throw new AlgorithmError(problem.message, problem.at);
  try {
    let wrapped = `${wrapperPrefix}${code}\n}`;
    if (kind === 'algorithm') [wrapped, functions] = asGenerators(wrapped);
    program = parse(wrapped, {
      ...options,
      onComment: (_block, text, start, end) =>
        comments.push({
          text,
          start: start - wrapperPrefix.length,
          end: end - wrapperPrefix.length
        })
    });
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
  checkSubset(root, offset, kind, new Set(domain ? typeNames(domain) : []), functions);
  return { root, offset, comments, markers, code };
}

/** A comment in a block, its text without its markers, at its span in the block's body. */
export type BlockComment = { text: string } & Span;

/** A node's span in its block's body, the same for every block. */
export function spanOf(node: AnyNode): Span {
  return { start: node.start - wrapperPrefix.length, end: node.end - wrapperPrefix.length };
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
