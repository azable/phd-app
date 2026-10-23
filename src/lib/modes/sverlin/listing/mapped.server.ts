/**
 * A listing of the source's own: a fixed text, such as a textbook's pseudocode, in a
 * <script lang="sverlin" listing="name"> block, whose regions, marked [label: …], light when the
 * algorithm runs the code with that label. The algorithm labels its code in comments at the end of a
 * statement's line, or on the line above it: `// @test` labels the statement, and
 * `// @test; cmp: values[j - 1] > key` also a part of it, named by its text (with #2 for its second
 * occurrence). A call of an operation is labelled with the operation's name where the text has a
 * region by that name. A node without a label of its own takes that of the nearest labelled node
 * around it, up to its statement, so the reads in a labelled comparison light it too, and an
 * unlabelled statement lights nothing.
 */

import type { AnyNode, BlockStatement } from 'acorn';

import { spanKey } from '../algorithm/interpret.server';
import { spanOf, type BlockComment } from '../algorithm/parse.server';
import type { DomainRegistry, RecordType } from '../algorithm/structures.server';
import type { Listing, Mark } from './listing';

/** A region of a listing's text, by its label, at its span in the text as shown and in the block. */
export type Region = { label: string; start: number; end: number; at: number };

/** A problem with a listing: in its block's body, or in the algorithm's, at an offset there. */
export type MappingProblem = { message: string; block: 'listing' | 'algorithm'; at: number };

/** What each region is mapped to: the source each node with its label has, by line. */
export type RegionMap = { label: string; text: string; sources: { text: string; line: number }[] };

const regionOpen = /^\[([A-Za-z_][\w-]*): ?/u;

/**
 * The text a listing shows, without its region marks and the indentation its lines share, and its
 * regions. A [ not opening a region, as in A[i], is text, closed by the ] that matches it.
 */
export function readRegions(body: string): {
  text: string;
  regions: Region[];
  problems: MappingProblem[];
} {
  const lines = body.split('\n');
  const first = lines.findIndex((line) => line.trim());
  const last = lines.findLastIndex((line) => line.trim());
  if (first < 0) return { text: '', regions: [], problems: [] };
  const kept = lines.slice(first, last + 1);
  const indent = Math.min(
    ...kept.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length)
  );
  // Each character kept, with its offset in the body.
  const characters: { character: string; at: number }[] = [];
  let at = lines.slice(0, first).reduce((total, line) => total + line.length + 1, 0);
  kept.forEach((line, index) => {
    const cut = Math.min(indent, line.length);
    for (let column = cut; column < line.length; column++)
      characters.push({ character: line[column], at: at + column });
    if (index < kept.length - 1) characters.push({ character: '\n', at: at + line.length });
    at += line.length + 1;
  });
  const source = characters.map(({ character }) => character).join('');
  let text = '';
  const regions: Region[] = [];
  const problems: MappingProblem[] = [];
  const open: ({ label: string; start: number; at: number } | 'plain')[] = [];
  for (let index = 0; index < source.length; index++) {
    const opening = source[index] === '[' ? regionOpen.exec(source.slice(index)) : null;
    if (opening) {
      open.push({ label: opening[1], start: text.length, at: characters[index].at });
      index += opening[0].length - 1;
      continue;
    }
    if (source[index] === '[') open.push('plain');
    if (source[index] === ']' && open.length) {
      const closing = open.pop();
      if (closing !== 'plain' && closing) {
        regions.push({
          label: closing.label,
          start: closing.start,
          end: text.length,
          at: closing.at
        });
        continue;
      }
    }
    text += source[index];
  }
  for (const unclosed of open)
    if (unclosed !== 'plain')
      problems.push({
        message: `The region [${unclosed.label}: … is never closed with ].`,
        block: 'listing',
        at: unclosed.at
      });
  // Outer regions before those inside them.
  return {
    text,
    regions: regions.sort((a, b) => a.start - b.start || b.end - a.end || a.at - b.at),
    problems
  };
}

/** The algorithm's labels: the labels each node has of its own. */
function readLabels(
  root: BlockStatement,
  comments: readonly BlockComment[],
  body: string
): { labels: Map<AnyNode, string[]>; problems: MappingProblem[]; used: Set<string> } {
  const labels = new Map<AnyNode, string[]>();
  const problems: MappingProblem[] = [];
  const used = new Set<string>();
  const lineOf = (offset: number) => body.slice(0, Math.max(offset, 0)).split('\n').length;
  const statements: AnyNode[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== 'object' || typeof (node as AnyNode).type !== 'string')
      return;
    const part = node as AnyNode;
    if (isStatement(part) && part.type !== 'BlockStatement' && spanOf(part).start >= 0)
      statements.push(part);
    for (const [key, child] of Object.entries(part)) if (key !== 'loc') visit(child);
  };
  root.body.forEach(visit);
  const label = (node: AnyNode, name: string) => {
    labels.set(node, [...(labels.get(node) ?? []), name]);
    used.add(name);
  };
  for (const comment of comments) {
    const content = comment.text.trim();
    if (!content.startsWith('@')) continue;
    const line = lineOf(comment.start);
    // A comment alone on its line labels the statement on the next line with code.
    const alone = !body.slice(body.lastIndexOf('\n', comment.start - 1) + 1, comment.start).trim();
    const lines = body.split('\n');
    let target = line;
    if (alone) while (target < lines.length && !lines[target]?.trim()) target++;
    if (alone) target++;
    const starting = statements.filter((node) => lineOf(spanOf(node).start) === target);
    const statement = starting.reduce<AnyNode | undefined>(
      (outer, node) =>
        !outer || spanOf(node).end - spanOf(node).start > spanOf(outer).end - spanOf(outer).start
          ? node
          : outer,
      undefined
    );
    if (!statement) {
      problems.push({
        message: `No statement starts on the line of the label ${content}: put it at the end of its statement's line, or alone on the line above.`,
        block: 'algorithm',
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
      const matches = partsOf(statement).filter(
        (node) => squeezed(body.slice(spanOf(node).start, spanOf(node).end)) === squeezed(excerpt)
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
          block: 'algorithm',
          at: comment.start
        });
        continue;
      }
      label(chosen, labelName);
    }
  }
  return { labels, problems, used };
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

const isStatement = (node: AnyNode) =>
  node.type.endsWith('Statement') || node.type.endsWith('Declaration');

/**
 * A mapped listing: its text, marked for each node with a label by the regions with that label, and
 * the problems with its labels; also what each region is mapped to.
 */
export function mappedListing(
  block: { body: string },
  algorithm: { root: BlockStatement; comments: readonly BlockComment[]; body: string },
  domain: DomainRegistry
): { listing: Listing; problems: MappingProblem[]; maps: RegionMap[] } {
  const { text, regions, problems } = readRegions(block.body);
  const { root, comments, body } = algorithm;
  const read = readLabels(root, comments, body);
  problems.push(...read.problems);
  const regionLabels = new Set(regions.map(({ label }) => label));
  const own = read.labels;
  const marks: Mark[] = [];
  const mapped = new Map<string, { text: string; line: number }[]>();
  const lineOf = (offset: number) => body.slice(0, Math.max(offset, 0)).split('\n').length;
  const visit = (node: unknown, inherited: readonly string[]): void => {
    if (Array.isArray(node)) return node.forEach((child) => visit(child, inherited));
    if (node === null || typeof node !== 'object' || typeof (node as AnyNode).type !== 'string')
      return;
    const part = node as AnyNode;
    const operation =
      part.type === 'CallExpression' &&
      part.callee.type === 'Identifier' &&
      (domain.structures[part.callee.name] as RecordType | undefined)?.operation &&
      regionLabels.has(part.callee.name)
        ? [part.callee.name]
        : [];
    if (operation.length) read.used.add(operation[0]);
    const mine = [...(own.get(part) ?? []), ...operation];
    const labels = mine.length ? mine : isStatement(part) ? [] : inherited;
    const span = spanOf(part);
    if (span.start >= 0) {
      for (const label of labels)
        for (const region of regions)
          if (region.label === label)
            marks.push({ key: spanKey('algorithm', span), start: region.start, end: region.end });
      for (const label of mine) {
        const line = lineOf(span.start);
        const source = body.slice(span.start, span.end).split('\n')[0].trim();
        mapped.set(label, [...(mapped.get(label) ?? []), { text: source, line }]);
      }
    }
    for (const [key, child] of Object.entries(part)) if (key !== 'loc') visit(child, labels);
  };
  root.body.forEach((statement) => visit(statement, []));
  for (const label of read.used)
    if (!regionLabels.has(label))
      problems.push({
        message: `The algorithm labels code ${label}, but the listing has no region [${label}: …].`,
        block: 'algorithm',
        at: comments.find(({ text }) => text.includes(label))?.start ?? 0
      });
  for (const region of regions)
    if (!read.used.has(region.label))
      problems.push({
        message: `The listing's region [${region.label}: …] is labelled on no code; label the code it shows, as // @${region.label} at the end of its line.`,
        block: 'listing',
        at: region.at
      });
  const maps = regions.map(({ label, start, end }) => ({
    label,
    text: text.slice(start, end),
    sources: mapped.get(label) ?? []
  }));
  return {
    listing: { text, marks, regions: regions.map(({ start, end }) => ({ start, end })) },
    problems,
    maps
  };
}
