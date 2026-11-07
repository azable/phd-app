/**
 * A listing of the source's own: a fixed text, such as a textbook's pseudocode, in a
 * <script listing="name"> block, whose regions, marked @name[…], light when the
 * algorithm runs the code with that label (see algorithm/labels.server.ts). A region inside
 * another takes its name as a prefix, as a label does, so names line up with the algorithm's.
 * Every region needs a label, and every label a region, as each label is a place the page can
 * pause. A node without a label of its own takes that of the nearest labelled node around it, and
 * lights the line of that region's own text its statement shows where they pair up (see markOf).
 * Its tokens, marked $name[…], name places the view renders (see places.server.ts).
 */

import type { AnyNode, BlockStatement } from 'acorn';

import { spanKey } from '../algorithm/interpret.server';
import type { Label } from '../algorithm/labels.server';
import { spanOf } from '../algorithm/parse.server';
import type { Listing, Mark } from './listing';
import { mathsFenceAt, mathsText, tokenInMaths, unclosedMaths } from '../maths.server';
import { closesOnly, keptLines, opensOnly } from './source-lines';

/** A region of a listing's text, by its label, at its span in the text as shown and in the block. */
export type Region = { label: string; start: number; end: number; at: number };

/**
 * A token of a listing's text, marked $name[…]: a reference to the place the view renders at @name
 * (see Place), at its span in the text as shown and in the block.
 */
export type Token = { place: string; start: number; end: number; at: number };

/** A problem with a listing: in its block's body, or in the algorithm's, at an offset there. */
export type MappingProblem = { message: string; block: 'listing' | 'algorithm'; at: number };

/** What each region is mapped to: the source each node with its label has, by line. */
export type RegionMap = { label: string; text: string; sources: { text: string; line: number }[] };

const regionOpen = /^@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\[/u;
/**
 * A place token opening at `index`, `:mid[`, or `:@front[` for a label's place. A `:` opens one
 * only where no name, closing bracket or `:` comes just before it, so `x := y`, `a : b` and
 * `{key:values[0]}` hold none.
 */
export function placeTokenAt(text: string, index: number): RegExpExecArray | null {
  if (text[index] !== ':') return null;
  if (index > 0 && /[\w$)\]}:]/u.test(text[index - 1])) return null;
  return /^:(@?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\[/u.exec(text.slice(index));
}

/** A place token anywhere in a text, as maths must hold none. */
export const placeTokenIn = /(?<![\w$)\]}:]):@?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\[/u;

/**
 * The old place token, `$mid[`, at `index`, which the build refuses, naming `:mid[`: a `$` after no
 * name, as `$5` or `$$` are no tokens.
 */
export function oldPlaceTokenAt(text: string, index: number): string | undefined {
  if (text[index] !== '$' || (index > 0 && /[\w$]/u.test(text[index - 1]))) return undefined;
  const token = /^\$([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\[/u.exec(text.slice(index));
  return token ? `$${token[1]}[ is no token: a place token is written :${token[1]}[…].` : undefined;
}

/** Whether a place is a label's, as :@front, a moment of the run rather than a variable. */
export const isLabelPlace = (place: string): boolean => place.startsWith(':@');

/**
 * The label a name as written means, as regions resolve theirs: the label with that full name, else
 * the one whose full name ends with it, or with its last parts, the fewest dropped from the front;
 * or why none does: several end with it, or none, naming the nearest by its own name.
 */
export function labelNamed(
  written: string,
  labels: readonly Label[]
): { full: string } | { problem: string } {
  const parts = written.split('.');
  for (let dropped = 0; dropped < parts.length; dropped++) {
    const name = parts.slice(dropped).join('.');
    const exact = labels.find(({ full }) => full === name);
    const ending = exact ? [exact] : labels.filter(({ full }) => full.endsWith(`.${name}`));
    if (ending.length === 1) return { full: ending[0].full };
    if (ending.length > 1) {
      const names = ending.map(({ full }) => `@${full}`);
      return {
        problem: `@${name} could be ${names.slice(0, -1).join(', ')} or ${names.at(-1)}: write the full name of the one it means, as ${names[0]}.`
      };
    }
  }
  const own = parts.at(-1) ?? written;
  const nearest = [...labels].sort(
    (a, b) => editDistance(a.name, own) - editDistance(b.name, own)
  )[0];
  return {
    problem: `no label is named @${written}${nearest ? `; the nearest is @${nearest.full}` : ''}.`
  };
}

/** How many single-character edits turn one text into another (Levenshtein). */
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
/**
 * The text a listing shows, without its region and token marks and the indentation its lines
 * share; its regions, each named with the names of those around it; and its tokens, which nest with
 * regions either way, a region inside a token keeping its prefix. A [ not opening a region or a
 * token, as in A[i], is text, closed by the ] that matches it.
 */
export function readRegions(body: string): {
  text: string;
  regions: Region[];
  tokens: Token[];
  problems: MappingProblem[];
} {
  const lines = body.split('\n');
  const shown = keptLines(lines);
  if (!shown) return { text: '', regions: [], tokens: [], problems: [] };
  const { first, last } = shown;
  const kept = lines.slice(first, last + 1);
  const indent = Math.min(
    ...kept.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length)
  );
  // Each character kept, with its offset in the body.
  const characters: { character: string; at: number }[] = [];
  let at = lines.slice(0, first).reduce((total, line) => total + line.length + 1, 0);
  // A line of marks alone would show blank: openings join the next line, which takes their
  // indentation, and closings join the line before (see shownLineGroups).
  kept.forEach((line, index) => {
    const joined = (index > 0 && opensOnly.test(kept[index - 1])) || closesOnly.test(line);
    if (closesOnly.test(line) && characters.at(-1)?.character === '\n') characters.pop();
    const cut = joined ? line.length - line.trimStart().length : Math.min(indent, line.length);
    const end = opensOnly.test(line) ? line.trimEnd().length : line.length;
    for (let column = cut; column < end; column++)
      characters.push({ character: line[column], at: at + column });
    if (index < kept.length - 1 && !opensOnly.test(line))
      characters.push({ character: '\n', at: at + line.length });
    at += line.length + 1;
  });
  const source = characters.map(({ character }) => character).join('');
  let text = '';
  const regions: Region[] = [];
  const tokens: Token[] = [];
  const problems: MappingProblem[] = [];
  // A listing's text is shown as written, so an HTML escape would show as itself.
  for (const match of body.matchAll(/&(lt|gt|amp|le|ge|ne|quot|#\d+|#x[\da-f]+);/giu))
    problems.push({
      message: `The listing writes ${match[0]}, which shows as it is written: write ${({ lt: '<', gt: '>', amp: '&', le: '≤', ge: '≥', ne: '≠', quot: '"' } as Record<string, string>)[match[1].toLowerCase()] ?? 'the character'} itself; a listing needs no escaping.`,
      block: 'listing',
      at: match.index ?? 0
    });
  type Opened =
    | { label: string; start: number; at: number }
    | { place: string; start: number; at: number; inside: boolean }
    | 'plain';
  const open: Opened[] = [];
  const prefix = () =>
    open
      .flatMap((region) => (region !== 'plain' && 'label' in region ? [region.label] : []))
      .at(-1);
  for (let index = 0; index < source.length; index++) {
    // Inline maths, $$…$$, is its Unicode text in a listing, holding no region or token: a listing
    // is lines of text, so it draws no SVG.
    const fence = mathsFenceAt(source, index);
    if (fence) {
      const [open, closing] = fence;
      const close = source.indexOf(closing, index + open.length);
      if (close < 0) {
        problems.push({ message: unclosedMaths, block: 'listing', at: characters[index].at });
        break;
      }
      const inside = source.slice(index + open.length, close);
      const marked =
        /@[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\[/u.exec(inside) ?? placeTokenIn.exec(inside);
      const converted = marked ? { problem: tokenInMaths(marked[0]) } : mathsText(inside);
      if ('problem' in converted)
        problems.push({ message: converted.problem, block: 'listing', at: characters[index].at });
      else text += converted.text;
      index = close + closing.length - 1;
      continue;
    }
    const old = oldPlaceTokenAt(source, index);
    if (old) problems.push({ message: old, block: 'listing', at: characters[index].at });
    const token = placeTokenAt(source, index);
    if (token) {
      const outer = open.find(
        (entry): entry is Extract<Opened, { place: string }> =>
          entry !== 'plain' && 'place' in entry
      );
      if (outer)
        problems.push({
          message: `The token :${token[1]}[ is inside the token :${outer.place.slice(1)}[…]: a token names one place, so write tokens side by side, as :i[i] and :j[j], never one inside another.`,
          block: 'listing',
          at: characters[index].at
        });
      // A label's token is named inside the regions around it, as a region is.
      const around = token[1].startsWith('@') ? prefix() : undefined;
      open.push({
        place: around ? `:@${around}.${token[1].slice(1)}` : `:${token[1]}`,
        start: text.length,
        at: characters[index].at,
        inside: Boolean(outer)
      });
      index += token[0].length - 1;
      continue;
    }
    const opening = source[index] === '@' ? regionOpen.exec(source.slice(index)) : null;
    if (opening) {
      const outer = prefix();
      open.push({
        label: outer ? `${outer}.${opening[1]}` : opening[1],
        start: text.length,
        at: characters[index].at
      });
      index += opening[0].length - 1;
      continue;
    }
    if (source[index] === '[') open.push('plain');
    if (source[index] === ']' && open.length) {
      const closing = open.pop();
      if (closing && closing !== 'plain' && 'place' in closing) {
        if (!closing.inside)
          tokens.push({
            place: closing.place,
            start: closing.start,
            end: text.length,
            at: closing.at
          });
        continue;
      }
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
    if (unclosed !== 'plain' && 'place' in unclosed)
      problems.push({
        message: `The token :${unclosed.place.slice(1)}[ is never closed with ].`,
        block: 'listing',
        at: unclosed.at
      });
    else if (unclosed !== 'plain')
      problems.push({
        message: `The region @${unclosed.label.split('.').at(-1)}[ is never closed with ].`,
        block: 'listing',
        at: unclosed.at
      });
  // Outer regions before those inside them.
  return {
    text,
    regions: regions.sort((a, b) => a.start - b.start || b.end - a.end || a.at - b.at),
    tokens: tokens.sort((a, b) => a.start - b.start),
    problems
  };
}

/** Statements that hold others, which have run once their own code has, though code runs inside. */
const compound = new Set([
  'BlockStatement',
  'DoWhileStatement',
  'ForInStatement',
  'ForOfStatement',
  'ForStatement',
  'FunctionDeclaration',
  'IfStatement',
  'SwitchStatement',
  'WhileStatement'
]);

/** The code a node stands for, whether it holds other statements, and its test if it has one. */
const flagsOf = (node: AnyNode): Pick<Mark, 'scope' | 'compound' | 'test'> => {
  const test = 'test' in node && node.test ? spanOf(node.test) : undefined;
  return { scope: spanOf(node), compound: compound.has(node.type), ...(test && { test }) };
};

const within = (inner: { start: number; end: number }, outer: { start: number; end: number }) =>
  outer.start <= inner.start && inner.end <= outer.end;

/** The statements a label marks: a block's, or those it wraps, or its expression. */
function statementsOf(label: Label): AnyNode[] {
  const [first] = label.nodes;
  return label.nodes.length === 1 && first.type === 'BlockStatement'
    ? (first as BlockStatement).body
    : label.nodes;
}

/**
 * A region's own text, outside the regions inside it, by line: each line's pieces, trimmed of
 * spaces, the lines with none left out. A region inside it spanning lines ends the line before it.
 */
function ownLines(
  text: string,
  region: Region,
  regions: readonly Region[]
): [start: number, end: number][][] {
  const holes = regions
    .filter(
      (other) =>
        other !== region &&
        within(other, region) &&
        (other.start !== region.start || other.end !== region.end)
    )
    .sort((a, b) => a.start - b.start);
  const lines: [number, number][][] = [[]];
  const piece = (start: number, end: number) => {
    const slice = text.slice(start, end);
    const lead = slice.length - slice.trimStart().length;
    const trail = slice.length - slice.trimEnd().length;
    if (end - trail > start + lead) lines.at(-1)!.push([start + lead, end - trail]);
  };
  const cut = (start: number, end: number) => {
    let from = start;
    for (let at = start; at < end; at++)
      if (text[at] === '\n') {
        piece(from, at);
        lines.push([]);
        from = at + 1;
      }
    piece(from, end);
  };
  let from = region.start;
  for (const hole of holes) {
    if (hole.start < from) continue;
    cut(from, hole.start);
    if (text.slice(hole.start, hole.end).includes('\n')) lines.push([]);
    from = hole.end;
  }
  cut(from, region.end);
  return lines.filter((line) => line.length);
}

/**
 * Each region named by the label it stands for: the one its name as written means, with the regions
 * around it, where a label has that full name; else the one label whose full name ends with it, or
 * with its last parts, the fewest dropped from the front. A name that more labels end with is a
 * problem naming them; one no label ends with is left for unlabelledRegion.
 */
function resolveRegions(
  regions: Region[],
  labels: readonly Label[]
): { problems: MappingProblem[]; unclear: Set<Region> } {
  const problems: MappingProblem[] = [];
  const unclear = new Set<Region>();
  for (const region of regions) {
    const parts = region.label.split('.');
    for (let dropped = 0; dropped < parts.length; dropped++) {
      const name = parts.slice(dropped).join('.');
      const exact = labels.find(({ full }) => full === name);
      const ending = exact ? [exact] : labels.filter(({ full }) => full.endsWith(`.${name}`));
      if (ending.length === 1) {
        region.label = ending[0].full;
        break;
      }
      if (ending.length > 1) {
        const names = ending.map(({ full }) => `@${full}`);
        problems.push({
          message: `The listing's region @${name} could be ${names.slice(0, -1).join(', ')} or ${names.at(-1)}: write the full name of the one it marks, as ${names[0]}[…].`,
          block: 'listing',
          at: region.at
        });
        unclear.add(region);
        break;
      }
    }
  }
  return { problems, unclear };
}

/**
 * Why a region names no label, and its fix: where the code has a label of the same name elsewhere,
 * as a for header's parts beside its body's label, where that label is; otherwise to label the code.
 */
function unlabelledRegion(full: string, labels: readonly Label[]): string {
  const parts = full.split('.');
  const name = parts.at(-1) ?? full;
  const around = parts.slice(0, -1).join('.');
  const same = labels.find((label) => label.name === name);
  if (!same)
    return `The listing's region @${full} is labelled on no code; label the code it shows the same way, with @${name}[…] around it${around ? ` inside @${around}` : ''}.`;
  const body = labels.find((label) => label.full === around);
  const beside =
    body && body.parent === same.parent && same.start < body.start
      ? `, as a for header's parts sit beside its body's label, not inside it; move the region out of @${body.name}[…]`
      : `; mark the region where @${same.full} is`;
  return `The listing's region @${full} names no label: the code's @${name} is @${same.full}${beside}.`;
}

/**
 * A mapped listing: its text, marked for each node with a label by the regions with that label, and
 * the problems with its labels; also what each region is mapped to, its tokens (see Token), and
 * the labels it marks no region for.
 */
export function mappedListing(
  block: { body: string },
  algorithm: { root: BlockStatement; labels: readonly Label[]; code: string }
): {
  listing: Listing;
  problems: MappingProblem[];
  maps: RegionMap[];
  tokens: Token[];
  unmarked: { full: string; name: string }[];
} {
  const { text, regions, tokens, problems } = readRegions(block.body);
  const { root, labels, code } = algorithm;
  const resolved = resolveRegions(regions, labels);
  problems.push(...resolved.problems);
  for (const token of tokens) {
    if (!isLabelPlace(token.place)) continue;
    const named = labelNamed(token.place.slice(2), labels);
    if ('full' in named) token.place = `:@${named.full}`;
    else
      problems.push({
        message: `The token ${token.place}[…] names a label, a moment of the run, but ${named.problem}`,
        block: 'listing',
        at: token.at
      });
  }
  const own = new Map<AnyNode, string[]>();
  for (const { full, nodes } of labels)
    for (const node of nodes) own.set(node, [...(own.get(node) ?? []), full]);
  const used = new Set(labels.map(({ full }) => full));
  const byName = new Map(labels.map((label) => [label.full, label]));
  const marks: Mark[] = [];
  // A node inside a label's code lights the line of the region's own text its statement shows,
  // where the region's own lines and the label's statements pair up one to one; and it counts as
  // run before a step only once the code has left its statement (see light.server.ts).
  const markOf = (part: AnyNode, label: string, region: Region): Mark[] => {
    const key = spanKey(spanOf(part));
    const whole = { key, label, start: region.start, end: region.end };
    const marked = byName.get(label);
    if (!marked) return [whole];
    if (marked.nodes.includes(part)) return [{ ...whole, ...flagsOf(part) }];
    const statements = statementsOf(marked);
    const index = statements.findIndex((statement) => within(spanOf(part), spanOf(statement)));
    if (index < 0) return [whole];
    const statement = statements[index];
    const lines = ownLines(text, region, regions);
    const line = lines.length === statements.length ? lines[index] : undefined;
    const flags = flagsOf(statement);
    return line
      ? line.map(([start, end]) => ({ key, label, start, end, ...flags }))
      : [{ ...whole, ...flags }];
  };
  const mapped = new Map<string, { text: string; line: number }[]>();
  const lineOf = (offset: number) => code.slice(0, Math.max(offset, 0)).split('\n').length;
  const visit = (node: unknown, inherited: readonly string[]): void => {
    if (Array.isArray(node)) return node.forEach((child) => visit(child, inherited));
    if (node === null || typeof node !== 'object' || typeof (node as AnyNode).type !== 'string')
      return;
    const part = node as AnyNode;
    const mine = own.get(part) ?? [];
    const names = mine.length ? mine : inherited;
    const span = spanOf(part);
    if (span.start >= 0) {
      for (const label of names)
        for (const region of regions)
          if (region.label === label) marks.push(...markOf(part, label, region));
      for (const label of mine) {
        const source = code.slice(span.start, span.end).split('\n')[0].trim();
        mapped.set(label, [
          ...(mapped.get(label) ?? []),
          { text: source, line: lineOf(span.start) }
        ]);
      }
    }
    for (const [key, child] of Object.entries(part)) if (key !== 'loc') visit(child, names);
  };
  root.body.forEach((statement) => visit(statement, []));
  for (const region of regions)
    if (!used.has(region.label) && !resolved.unclear.has(region))
      problems.push({
        message: unlabelledRegion(region.label, labels),
        block: 'listing',
        at: region.at
      });
  // A label with no region lights nothing where a scene pauses at it, which the build warns of.
  const shown = new Set(regions.map(({ label }) => label));
  const unmarked = labels
    .filter(({ full }) => !shown.has(full))
    .map(({ full, name }) => ({ full, name }));
  const maps = regions.map(({ label, start, end }) => ({
    label,
    text: text.slice(start, end),
    sources: mapped.get(label) ?? []
  }));
  return {
    listing: {
      text,
      marks,
      regions: regions.map(({ label, start, end }) => ({ label, start, end })),
      ...(tokens.length
        ? { tokens: tokens.map(({ place, start, end }) => ({ place, start, end })) }
        : {})
    },
    problems,
    maps,
    tokens,
    unmarked
  };
}
