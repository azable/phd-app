/** Parse one block with acorn and check it against the subset its kind allows. */

import { parse, type AnyNode, type BlockStatement, type FunctionDeclaration } from 'acorn';

import { operatorNames, typeNames, type DomainRegistry } from './structures.server';
import { AlgorithmError, type BlockKind, type Span } from './block.server';
import { readMarkers, type Marker } from './labels.server';
import { checkSubset } from './subset.server';

// A strict-mode wrapper lets acorn parse top-level return; it shares the body's first line.
const wrapperPrefix = "function algorithm() {'use strict';";

/**
 * Parse a block's body and check its subset. Offsets are relative to the body; the domain
 * names the type constructors and operators the block may call, and in the domain block itself,
 * where operators' functions make typed values, its own declarations do. The algorithm's label
 * markers, and the domain's types on operators' parameters, are read first and blanked (see
 * labels.server.ts and readParameterTypes): `code` is the body as parsed.
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
  parameterTypes: ParameterTypes;
} {
  let program;
  const read =
    kind === 'algorithm'
      ? { ...readMarkers(body), parameterTypes: new Map() as ParameterTypes }
      : kind === 'domain'
        ? { ...readParameterTypes(body), markers: [], problems: [] }
        : { code: body, markers: [], problems: [], parameterTypes: new Map() as ParameterTypes };
  const { code, markers, problems, parameterTypes } = read;
  const [problem] = problems;
  if (problem) throw new AlgorithmError(problem.message, problem.at);
  try {
    program = parse(`${wrapperPrefix}${code}\n}`, { ecmaVersion: 2022, sourceType: 'script' });
  } catch (cause) {
    const position = (cause as { pos?: unknown }).pos;
    const message = cause instanceof Error ? cause.message : String(cause);
    const at =
      typeof position === 'number'
        ? Math.min(Math.max(position - wrapperPrefix.length, 0), body.length)
        : undefined;
    throw new AlgorithmError(
      at !== undefined && code[at] === ':' && /[\w$]\s*$/u.test(code.slice(0, at))
        ? "Type annotations are written only on an operator's parameters, as (q: Queue, x: Letter) => …"
        : message.replace(/\s*\(\d+:\d+\)$/u, ''),
      at
    );
  }
  const root = (program.body[0] as FunctionDeclaration).body;
  const offset = spanOf;
  checkSubset(
    root,
    offset,
    kind,
    new Set(kind === 'domain' ? declaredIn(root) : domain ? typeNames(domain) : []),
    new Set(domain ? operatorNames(domain) : [])
  );
  return { root, offset, markers, code, parameterTypes };
}

/** Each type written on an operator's parameter, by where the parameter's name ends, and where the type is. */
export type ParameterTypes = Map<number, { type: string; at: number }>;

/**
 * The domain block with the type on each parameter of an operator's function blanked to spaces,
 * keeping every offset, as in binop((q: Queue, x: Letter) => …), and the types read. Strings and
 * comments are skipped.
 */
function readParameterTypes(body: string): { code: string; parameterTypes: ParameterTypes } {
  const code = body.split('');
  const parameterTypes: ParameterTypes = new Map();
  const opening = /^(binop|unop)\s*\(\s*\(/u;
  const typed = /^([A-Za-z_$][\w$]*)(\s*):(\s*)([A-Za-z_$][\w$]*)/u;
  for (let at = 0; at < body.length; at++) {
    const character = body[at];
    if (character === '/' && body[at + 1] === '/') {
      const end = body.indexOf('\n', at);
      at = end < 0 ? body.length : end;
      continue;
    }
    if (character === '/' && body[at + 1] === '*') {
      const end = body.indexOf('*/', at + 2);
      at = end < 0 ? body.length : end + 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      let end = at + 1;
      while (end < body.length && body[end] !== character) end += body[end] === '\\' ? 2 : 1;
      at = end;
      continue;
    }
    if (/[\w$]/u.test(body[at - 1] ?? '')) continue;
    const call = opening.exec(body.slice(at));
    if (!call) continue;
    // The parameter list, up to the parenthesis closing it.
    let from = at + call[0].length;
    let depth = 1;
    let end = from;
    while (end < body.length && depth > 0) {
      if (body[end] === '(') depth += 1;
      else if (body[end] === ')') depth -= 1;
      end += 1;
    }
    while (from < end) {
      const match = typed.exec(body.slice(from, end));
      if (match) {
        const nameEnd = from + match[1].length;
        const colon = nameEnd + match[2].length;
        const typeAt = colon + 1 + match[3].length;
        for (let blank = colon; blank < typeAt + match[4].length; blank++) code[blank] = ' ';
        parameterTypes.set(nameEnd, { type: match[4], at: typeAt });
        from = typeAt + match[4].length;
      } else from += 1;
    }
    at = end - 1;
  }
  return { code: code.join(''), parameterTypes };
}

/** The names a block declares at its top level. */
function declaredIn(root: BlockStatement): string[] {
  return root.body.flatMap((statement) =>
    statement.type === 'VariableDeclaration'
      ? statement.declarations.flatMap(({ id }) => (id.type === 'Identifier' ? [id.name] : []))
      : []
  );
}

/** A node's span in its block's body, the same for every block. */
export function spanOf(node: AnyNode): Span {
  return { start: node.start - wrapperPrefix.length, end: node.end - wrapperPrefix.length };
}
