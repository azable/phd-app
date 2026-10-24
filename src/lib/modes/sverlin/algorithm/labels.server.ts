/**
 * Labels on the algorithm's code, naming what a step is about and what a listing's regions show.
 * `@name[…]` wraps a statement, statements in a row, or an expression; `@name{` names a block the
 * code has, a loop's, an if's, or a function's body. A label inside another takes its name as a
 * prefix (insert.shift). The markers are blanked to spaces before parsing, keeping every offset.
 * The algorithm is the root label: in a label with labelled statements, every statement is inside
 * one of them or contains one.
 */

import type { AnyNode, BlockStatement } from 'acorn';

import { spanOf } from './parse.server';

export type LabelProblem = { message: string; at: number };

/**
 * A label's marker as written: its name, at the @, and what it wraps, the text inside a span's
 * brackets or a block's {.
 */
export type Marker = {
  name: string;
  at: number;
  kind: 'span' | 'block';
  start: number;
  end: number;
};

/**
 * A label: its name as written and with its prefix, the code it marks (statements in a row, a
 * block, or an expression), where it is written, and the labels inside it.
 */
export type Label = {
  name: string;
  full: string;
  nodes: AnyNode[];
  at: number;
  start: number;
  end: number;
  statement: boolean;
  parent?: Label;
  children: Label[];
};

export const isStatement = (node: AnyNode): boolean =>
  node.type.endsWith('Statement') || node.type.endsWith('Declaration');

const markerPattern = /^@([A-Za-z_$][\w$]*)((?:\.[\w$]*)*)([ \t]*)([[{])?/u;

/**
 * The body with every marker blanked to spaces, and the markers. Strings and comments are skipped;
 * a span's ] is the one matching its [.
 */
export function readMarkers(body: string): {
  code: string;
  markers: Marker[];
  problems: LabelProblem[];
} {
  const code = body.split('');
  const blank = (from: number, to: number) => {
    for (let at = from; at < to; at++) if (code[at] !== '\n') code[at] = ' ';
  };
  const markers: Marker[] = [];
  const problems: LabelProblem[] = [];
  const open: (Omit<Marker, 'end' | 'kind'> | null)[] = [];
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
    if (character === '@') {
      const match = markerPattern.exec(body.slice(at));
      if (!match) continue;
      const [written, name, dotted, , bracket] = match;
      if (dotted) {
        problems.push({
          message: `A label's name has no dots: write @${name}, and the labels it is inside give its prefix.`,
          at
        });
        continue;
      }
      if (!bracket) {
        problems.push({
          message: `@${name} needs code to label: write @${name}[…] around a statement or part of one, or @${name}{ on a loop's, an if's, or a function's block.`,
          at
        });
        continue;
      }
      if (bracket === '[') {
        open.push({ name, at, start: at + written.length });
        blank(at, at + written.length);
      } else {
        markers.push({
          name,
          at,
          kind: 'block',
          start: at + written.length - 1,
          end: at + written.length
        });
        blank(at, at + written.length - 1);
      }
      at += written.length - 1;
      continue;
    }
    if (character === '[') open.push(null);
    if (character === ']' && open.length) {
      const marker = open.pop();
      if (marker) {
        markers.push({ ...marker, kind: 'span', end: at });
        blank(at, at + 1);
      }
    }
  }
  for (const marker of open)
    if (marker)
      problems.push({ message: `@${marker.name}[ is never closed with ].`, at: marker.at });
  return { code: code.join(''), markers: markers.sort((a, b) => a.at - b.at), problems };
}

/**
 * The labels, in the order written, each with the code it marks and its place among the others,
 * and the problems with them: a marker on no code, and a statement no label covers.
 */
export function readLabels(
  root: BlockStatement,
  markers: readonly Marker[],
  code: string
): { labels: Label[]; problems: LabelProblem[] } {
  const problems: LabelProblem[] = [];

  // Every node, with its parent, and every list of statements.
  const parents = new Map<AnyNode, AnyNode | undefined>();
  const lists: AnyNode[][] = [root.body];
  const nodes: AnyNode[] = [];
  const visit = (node: unknown, parent?: AnyNode): void => {
    if (Array.isArray(node)) return node.forEach((child) => visit(child, parent));
    if (node === null || typeof node !== 'object' || typeof (node as AnyNode).type !== 'string')
      return;
    const part = node as AnyNode;
    parents.set(part, parent);
    nodes.push(part);
    if (part.type === 'BlockStatement') lists.push(part.body);
    for (const [key, child] of Object.entries(part)) if (key !== 'loc') visit(child, part);
  };
  root.body.forEach((statement) => visit(statement));

  const labels: Label[] = [];
  for (const marker of markers) {
    const marked = marker.kind === 'block' ? blockOf(marker) : spanned(marker);
    if (!marked) continue;
    const { start } = spanOf(marked[0]);
    const { end } = spanOf(marked[marked.length - 1]);
    labels.push({
      name: marker.name,
      full: marker.name,
      nodes: marked,
      at: marker.at,
      start,
      end,
      statement: isStatement(marked[0]),
      children: []
    });
  }

  // A label's parent is the smallest around it; of two around the same code, the one written first.
  for (const label of labels) {
    const around = labels.filter(
      (other) =>
        other !== label &&
        other.start <= label.start &&
        label.end <= other.end &&
        (other.start !== label.start || other.end !== label.end || other.at < label.at)
    );
    label.parent = around.sort((a, b) => a.end - a.start - (b.end - b.start) || b.at - a.at)[0];
    label.parent?.children.push(label);
  }
  for (const label of labels) label.full = fullName(label);
  checkCoverage();
  return { labels, problems };

  function fullName(label: Label): string {
    return label.parent ? `${fullName(label.parent)}.${label.name}` : label.name;
  }

  function blockOf(marker: Marker): AnyNode[] | undefined {
    const block = nodes.find(
      (node) => node.type === 'BlockStatement' && spanOf(node).start === marker.start
    );
    const parent = block && parents.get(block);
    if (!block) {
      problems.push({ message: `@${marker.name}{ is on no block.`, at: marker.at });
      return undefined;
    }
    if (!parent || parent.type === 'BlockStatement') {
      problems.push({
        message: `@${marker.name}{ is on a block of its own, whose declarations later code could not see; wrap the statements as @${marker.name}[…] instead.`,
        at: marker.at
      });
      return undefined;
    }
    return [block];
  }

  function spanned(marker: Marker): AnyNode[] | undefined {
    const inside = code.slice(marker.start, marker.end);
    const start = marker.start + (inside.length - inside.trimStart().length);
    let end = marker.end - (inside.length - inside.trimEnd().length);
    if (end <= start) {
      problems.push({ message: `@${marker.name}[ ] wraps no code.`, at: marker.at });
      return undefined;
    }
    // Statements in a row, or one, in one list; the last one's semicolon may follow the ].
    for (const list of lists) {
      const first = list.findIndex((node) => spanOf(node).start === start);
      const last = list.findIndex(
        (node, index) =>
          index >= first &&
          spanOf(node).end >= end &&
          /^\s*;?$/u.test(code.slice(end, spanOf(node).end))
      );
      if (first >= 0 && last >= 0) return list.slice(first, last + 1);
    }
    const at = (to: number) =>
      nodes.filter((node) => spanOf(node).start === start && spanOf(node).end === to);
    // A statement with its semicolon, or what is inside it.
    let exact = at(end);
    if (!exact.length && code[end - 1] === ';') exact = at((end -= 1));
    // The outermost of several with the same text, as a call and its statement.
    const outer = exact.find((node) => !exact.includes(parents.get(node)!));
    if (outer) {
      const parent = parents.get(outer);
      // An expression that is its statement's whole expression labels the statement.
      return [parent?.type === 'ExpressionStatement' ? parent : outer];
    }
    problems.push({
      message: `@${marker.name}[…] wraps ${code.slice(start, end).trim().split('\n')[0]}, which is not a statement, statements in a row, or an expression.`,
      at: marker.at
    });
    return undefined;
  }

  /**
   * In each label with labelled statements, and in the algorithm and each function's body, every
   * statement is inside one of them or contains one.
   */
  function checkCoverage(): void {
    const statementLabels = labels.filter((label) => label.statement);
    const reported: AnyNode[] = [];
    for (const node of nodes) {
      if (!isStatement(node) || node.type === 'BlockStatement') continue;
      if (node.type === 'FunctionDeclaration' || spanOf(node).start < 0) continue;
      // A loop's header declaration is its control code.
      const parent = parents.get(node);
      if (parent && isLoop(parent) && (parent as { body: AnyNode }).body !== node) continue;
      const fn = enclosingFunction(node);
      const inScope = (label: Label) => enclosingFunction(label.nodes[0]) === fn;
      // The innermost label around it, in the function it is in.
      const owner = statementLabels
        .filter((label) => inScope(label) && label.nodes.some((marked) => within(node, marked)))
        .sort((a, b) => a.end - a.start - (b.end - b.start) || b.at - a.at)[0];
      const beside = statementLabels.filter(
        (label) => inScope(label) && outerStatementLabel(label) === owner
      );
      if (!beside.length) continue;
      if (beside.some((label) => label.nodes.some((marked) => within(marked, node)))) continue;
      if (reported.some((outer) => within(node, outer))) continue;
      reported.push(node);
      const text = code.slice(spanOf(node).start, spanOf(node).end).trim().split('\n')[0];
      problems.push({
        message: `${text} is ${owner ? `in @${owner.full}` : 'in the algorithm'} but in none of the labels beside it (${beside.map((label) => `@${label.name}`).join(', ')}); wrap it, as @name[${text}], or put it inside one of them, so each step is one label's code.`,
        at: spanOf(node).start
      });
    }
  }

  /** The nearest statement label around a label, in the same function. */
  function outerStatementLabel(label: Label): Label | undefined {
    const fn = enclosingFunction(label.nodes[0]);
    for (let parent = label.parent; parent; parent = parent.parent)
      if (parent.statement && enclosingFunction(parent.nodes[0]) === fn) return parent;
    return undefined;
  }

  function enclosingFunction(node: AnyNode): AnyNode | undefined {
    for (let parent = parents.get(node); parent; parent = parents.get(parent))
      if (parent.type === 'FunctionDeclaration') return parent;
    return undefined;
  }
}

const isLoop = (node: AnyNode) =>
  ['ForStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'].includes(node.type);

/** Whether a node lies within another's span. */
function within(inner: AnyNode, outer: AnyNode): boolean {
  return spanOf(outer).start <= spanOf(inner).start && spanOf(inner).end <= spanOf(outer).end;
}
