/**
 * Labels on the algorithm's code, naming what a step is about and what a listing's regions show.
 * `@name[…]` wraps a statement, statements in a row, or an expression; `@name{` names a block the
 * code has, a loop's, an if's, or a function's body. A label inside another takes its name as a
 * prefix (insert.shift). The markers are blanked to spaces before parsing, keeping every offset.
 * In a label with labelled statements, every statement is inside one of them or contains one. In
 * an authored source no code runs outside a label: every statement is inside one, every test is a
 * label's own code or conditions joined by && and || that each are, and every part of a for header
 * is a label's own code; for … of is refused (see checkCoverage and checkParts).
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
  /** For a span written as a body, why it may wrap only one statement. */
  asBody?: string;
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
  /** Spans written as an if's, an else's, a loop's or a function's body, the problem if the parse fails. */
  bodies: LabelProblem[];
} {
  const code = body.split('');
  const blank = (from: number, to: number) => {
    for (let at = from; at < to; at++) if (code[at] !== '\n') code[at] = ' ';
  };
  const markers: Marker[] = [];
  const problems: LabelProblem[] = [];
  const bodies: LabelProblem[] = [];
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
        // A span as a body works where it wraps one statement; where it wraps more, the parse fails,
        // and the parse's problem names this (see bodySpans).
        const body = bodyOf(at);
        const asBody =
          body &&
          `@${name}[ is the body of ${body.what}: a body takes a block label, as ${body.example(name)}; @${name}[…] wraps statements inside a block.`;
        if (asBody) bodies.push({ at, message: asBody });
        open.push({ name, at, start: at + written.length, ...(asBody ? { asBody } : {}) });
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
  return {
    code: code.join(''),
    markers: markers.sort((a, b) => a.at - b.at),
    problems,
    bodies
  };

  /**
   * What a marker here would be the body of, an if's, an else's, a loop's or a function's, where
   * `@name[` cannot stand: a span wraps statements inside a block and is no statement itself.
   */
  function bodyOf(at: number): { what: string; example: (name: string) => string } | undefined {
    const before = body.slice(0, at).trimEnd();
    if (/\belse$/u.test(before))
      return { what: 'an else', example: (name) => `if (…) @…{ … } else @${name}{ … }` };
    if (/\bdo$/u.test(before))
      return { what: 'a do loop', example: (name) => `do @${name}{ … } while (…)` };
    if (!before.endsWith(')')) return undefined;
    let depth = 0;
    let open = -1;
    for (let index = before.length - 1; index >= 0; index--) {
      if (before[index] === ')') depth += 1;
      else if (before[index] === '(' && (depth -= 1) === 0) {
        open = index;
        break;
      }
    }
    if (open < 0) return undefined;
    const keyword = /([\w$]+)\s*$/u.exec(body.slice(0, open))?.[1];
    if (keyword === 'if')
      return { what: 'an if', example: (name) => `if (…) @${name}{ … } else @…{ … }` };
    if (keyword === 'while' || keyword === 'for')
      return {
        what: `a ${keyword} loop`,
        example: (name) => `${keyword} (…) @${name}{ … }`
      };
    if (/\bfunction\s+[\w$]+\s*$/u.test(body.slice(0, open)))
      return { what: 'a function', example: (name) => `function f(…) @${name}{ … }` };
    return undefined;
  }
}

/**
 * The labels, in the order written, each with the code it marks and its place among the others,
 * and the problems with them: a marker on no code, and a statement no label covers.
 */
export function readLabels(
  root: BlockStatement,
  markers: readonly Marker[],
  code: string,
  /** Whether no code may run outside a label, as in an authored source; else a fragment. */
  complete = false
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
    // A span of several statements as a loop's body parses, the later ones outside the loop.
    if (marker.asBody && marked.length > 1) {
      problems.push({ message: marker.asBody, at: marker.at });
      continue;
    }
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
  if (complete) checkParts();
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
        message: `@${marker.name}{ here is on a block of its own, whose declarations later code could not see; wrap the statements as @${marker.name}[…] instead. (As the body of an if, an else, a loop or a function, @${marker.name}{ is right.)`,
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
      message:
        marker.asBody ??
        `@${marker.name}[…] wraps ${code.slice(start, end).trim().split('\n')[0]}, which is not a statement, statements in a row, or an expression.`,
      at: marker.at
    });
    return undefined;
  }

  /**
   * In each label with labelled statements, and in the algorithm and each function's body, every
   * statement is inside one of them or contains one; in an authored source, every statement is
   * inside a label at all. A header's parts are its own (see checkParts).
   */
  function checkCoverage(): void {
    const parts = partsOfHeaders();
    const statementLabels = labels.filter((label) => label.statement && !parts.has(label.nodes[0]));
    const reported: AnyNode[] = [];
    const report = (node: AnyNode, message: (text: string) => string) => {
      if (reported.some((outer) => within(node, outer))) return;
      reported.push(node);
      const text = code.slice(spanOf(node).start, spanOf(node).end).trim().split('\n')[0];
      problems.push({ message: message(text), at: spanOf(node).start });
    };
    for (const node of nodes) {
      if (!isStatement(node) || node.type === 'BlockStatement') continue;
      if (node.type === 'FunctionDeclaration' || spanOf(node).start < 0) continue;
      // A loop's header declaration is its control code, labelled as a part of it (see checkParts).
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
      const containsOne = beside.some((label) =>
        label.nodes.some((marked) => within(marked, node))
      );
      if (complete && !owner && !containsOne) {
        report(
          node,
          (text) =>
            `${text} runs outside every label, and no code may: wrap it, as @name[${text}]${fn ? ", or label the function's body, as function f(…) @f{" : ''}.`
        );
        continue;
      }
      if (!beside.length || containsOne) continue;
      // Declarations leading their block, before any labelled code, are the lead-up to its first
      // step, as a loop's header is.
      if (node.type === 'VariableDeclaration' && leading(node, beside)) continue;
      report(
        node,
        (text) =>
          `${text} is ${owner ? `in @${owner.full}` : 'in the algorithm'} but in none of the labels beside it (${beside.map((label) => `@${label.full}`).join(', ')}); wrap it, as @name[${text}], or put it inside one of them, so each step is one label's code.`
      );
    }
  }

  /** The tests of ifs and loops and the parts of for headers. */
  function partsOfHeaders(): Set<AnyNode> {
    const parts = new Set<AnyNode>();
    for (const node of nodes)
      for (const part of headerParts[node.type] ?? []) {
        const child = (node as unknown as Record<string, AnyNode | null>)[part];
        if (child) parts.add(child);
      }
    return parts;
  }

  /**
   * In an authored source, every test and every part of a for header is a label's own code, so
   * each decision and each move of a loop is a run of its own; a for … of loop, whose header walks
   * a collection no label can split, is refused.
   */
  function checkParts(): void {
    const own = new Set(
      labels.filter(({ nodes: marked }) => marked.length === 1).map(({ nodes: [node] }) => node)
    );
    // A label's own code, or conditions joined by && and || or negated, each its own label's, so
    // each part's decision shows as its run, as @bound[…] && @compare[…].
    const labelled = (node: AnyNode): boolean => {
      if (own.has(node)) return true;
      if (node.type === 'LogicalExpression') return labelled(node.left) && labelled(node.right);
      if (node.type === 'UnaryExpression' && node.operator === '!') return labelled(node.argument);
      return false;
    };
    for (const node of nodes) {
      if (spanOf(node).start < 0) continue;
      if (node.type === 'ForOfStatement') {
        const loop = node as unknown as { left: AnyNode; right: AnyNode };
        const items = code.slice(spanOf(loop.right).start, spanOf(loop.right).end).trim();
        problems.push({
          message: `for (… of ${items}) walks ${items} in a header no label can split; write an index loop, its three parts labelled, as for (@start[let i = Index(0)]; @more[Before(i, Length(${items}))]; @next[i = Next(i)]) @visit{ … }, reading ${items}[i].`,
          at: spanOf(node).start
        });
        continue;
      }
      for (const part of headerParts[node.type] ?? []) {
        const child = (node as unknown as Record<string, AnyNode | null>)[part];
        if (!child || labelled(child)) continue;
        const written = code.slice(spanOf(child).start, spanOf(child).end).trim();
        const keyword =
          node.type === 'IfStatement' ? 'if' : node.type === 'ForStatement' ? 'for' : 'while';
        const shows = {
          init: 'what it sets up',
          test: 'the decision it makes',
          update: 'the move it makes'
        }[part];
        problems.push({
          message: `The ${part} of ${keyword} (…), ${written}, is in no label of its own, so ${shows} would not show: label it, as @name[${written}]${keyword === 'for' ? ', as each part of a for header is: for (@start[…]; @more[…]; @next[…])' : ''}.`,
          at: spanOf(child).start
        });
      }
    }
  }

  /** Whether every statement before a declaration in its block is a declaration, labelled none. */
  function leading(node: AnyNode, beside: readonly Label[]): boolean {
    const list = lists.find((statements) => statements.includes(node));
    if (!list) return false;
    const labelled = (statement: AnyNode) =>
      beside.some(({ nodes: marked }) =>
        marked.some((part) => within(part, statement) || within(statement, part))
      );
    return list
      .slice(0, list.indexOf(node))
      .filter((statement) => spanOf(statement).start >= 0)
      .every((statement) => statement.type === 'VariableDeclaration' && !labelled(statement));
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

/** The parts of a header that are each a label's own code in an authored source, by statement. */
const headerParts: Record<string, readonly ('init' | 'test' | 'update')[]> = {
  ForStatement: ['init', 'test', 'update'],
  WhileStatement: ['test'],
  DoWhileStatement: ['test'],
  IfStatement: ['test']
};

const isLoop = (node: AnyNode) =>
  ['ForStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'].includes(node.type);

/** Whether a node lies within another's span. */
function within(inner: AnyNode, outer: AnyNode): boolean {
  return spanOf(outer).start <= spanOf(inner).start && spanOf(inner).end <= spanOf(outer).end;
}
