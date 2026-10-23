/**
 * Labels on the algorithm's code, in its comments, naming what a step is about and what a
 * listing's regions show. A label comment starts with @: `// @shift` at the end of a line labels
 * the last statement that starts on it; `/* @shift *\/` before code labels the statement right
 * after it; either alone on its line labels the first statement on the next line with code.
 * `@test; cmp: values[j - 1] > key` also labels a part of that statement, by its text on its line
 * (#2 for a second occurrence), with spaces and a closing semicolon ignored.
 */

import type { AnyNode, BlockStatement } from 'acorn';

import { spanOf, type BlockComment } from './parse.server';

export type LabelProblem = { message: string; at: number };

export const isStatement = (node: AnyNode): boolean =>
  node.type.endsWith('Statement') || node.type.endsWith('Declaration');

/**
 * The labels each node has of its own, the labels in the order they are first written, and the
 * problems with them.
 */
export function readLabels(
  root: BlockStatement,
  comments: readonly BlockComment[],
  body: string
): { labels: Map<AnyNode, string[]>; order: string[]; problems: LabelProblem[] } {
  const labels = new Map<AnyNode, string[]>();
  const order: string[] = [];
  const problems: LabelProblem[] = [];
  const lineOf = (offset: number) => body.slice(0, Math.max(offset, 0)).split('\n').length;
  const statements: AnyNode[] = [];
  // Every statement, nested ones too, for a comment right before one.
  const every: AnyNode[] = [];
  const visit = (node: unknown, inStatementOnLine?: number): void => {
    if (Array.isArray(node)) return node.forEach((child) => visit(child, inStatementOnLine));
    if (node === null || typeof node !== 'object' || typeof (node as AnyNode).type !== 'string')
      return;
    const part = node as AnyNode;
    let line = inStatementOnLine;
    if (isStatement(part) && part.type !== 'BlockStatement' && spanOf(part).start >= 0) {
      const starts = lineOf(spanOf(part).start);
      // Outermost on its line: not inside another statement that starts on the same line.
      if (starts !== inStatementOnLine) statements.push(part);
      every.push(part);
      line = starts;
    }
    for (const [key, child] of Object.entries(part)) if (key !== 'loc') visit(child, line);
  };
  root.body.forEach((statement) => visit(statement));
  const lines = body.split('\n');
  const label = (node: AnyNode, name: string) => {
    labels.set(node, [...(labels.get(node) ?? []), name]);
    if (!order.includes(name)) order.push(name);
  };
  for (const comment of comments) {
    const content = comment.text.trim();
    if (!content.startsWith('@')) continue;
    const line = lineOf(comment.start);
    const lineStart = body.lastIndexOf('\n', comment.start - 1) + 1;
    const lineEnd = body.indexOf('\n', comment.end);
    const before = body.slice(lineStart, comment.start).trim();
    const after = body.slice(comment.end, lineEnd < 0 ? body.length : lineEnd).trim();
    let statement: AnyNode | undefined;
    if (before && !after) {
      // At the end of a line: the last statement starting on it.
      statement = statements.filter((node) => lineOf(spanOf(node).start) === line).at(-1);
    } else if (after) {
      // Before code: the statement right after it, as `for (…) /* @x */ total += v;`.
      const start = Math.min(
        ...every.map((node) => spanOf(node).start).filter((at) => at >= comment.end)
      );
      statement = every.find((node) => spanOf(node).start === start && lineOf(start) === line);
    } else {
      // Alone on its line: the first statement on the next line with code.
      let next = line;
      while (next < lines.length && !lines[next]?.trim()) next++;
      statement = statements.find((node) => lineOf(spanOf(node).start) === next + 1);
    }
    if (!statement) {
      problems.push({
        message: `No statement is where the label ${content} is: put it at the end of its statement's line, before the statement, or alone on the line above.`,
        at: comment.start
      });
      continue;
    }
    for (const item of content.slice(1).split(';')) {
      const [name, ...excerptParts] = item.split(':');
      const labelName = name.trim();
      if (!labelName) continue;
      if (!excerptParts.length) {
        label(statement, labelName);
        continue;
      }
      const written = excerptParts.join(':').trim();
      const [, excerpt, occurrence] = /^(.*?)(?:#(\d+))?$/su.exec(written) ?? [];
      const same = partsOf(statement).filter(
        (node) => squeezed(body.slice(spanOf(node).start, spanOf(node).end)) === squeezed(excerpt)
      );
      // A part and one wrapping it with the same text, as a call and its statement, are one: the
      // outer.
      const matches = same.filter(
        (node) =>
          !same.some(
            (other) =>
              other !== node &&
              spanOf(other).start <= spanOf(node).start &&
              spanOf(node).end <= spanOf(other).end
          )
      );
      const chosen = occurrence
        ? matches[Number(occurrence) - 1]
        : matches.length === 1
          ? matches[0]
          : undefined;
      if (!chosen) {
        const statementText = body
          .slice(spanOf(statement).start, spanOf(statement).end)
          .split('\n')[0];
        problems.push({
          message: matches.length
            ? `${labelName}: ${written} matches ${matches.length} parts of its line; name one, as ${labelName}: ${excerpt}#2.`
            : `${labelName}: ${written} matches no part of its line, which reads ${statementText.trim()}.`,
          at: comment.start
        });
        continue;
      }
      label(chosen, labelName);
    }
  }
  return { labels, order, problems };
}

/** A statement's parts on its own line: its head, not the bodies of blocks inside it. */
function partsOf(statement: AnyNode): AnyNode[] {
  const parts: AnyNode[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== 'object' || typeof (node as AnyNode).type !== 'string')
      return;
    const part = node as AnyNode;
    if (part.type === 'BlockStatement') return;
    parts.push(part);
    for (const [key, child] of Object.entries(part)) if (key !== 'loc') visit(child);
  };
  visit(statement);
  // A node and one wrapping it with the same text are one part.
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = `${part.start}:${part.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Text as an excerpt is matched: without spaces, or a statement's closing semicolon. */
const squeezed = (text: string) => text.replace(/\s+/gu, '').replace(/;$/u, '');
