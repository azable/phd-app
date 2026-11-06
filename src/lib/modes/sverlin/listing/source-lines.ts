/**
 * Where a listing's lines and the source's labels are in the source text, for the editor and for
 * the assistant's view of a selection, browser-safe: the lines a listing shows from its block's
 * lines, and every label the algorithm and the listings declare, with its full name and its code.
 */

/** A line of marks alone, `@test[` or `:i[`, which joins the next line as it would show blank. */
export const opensOnly = /^\s*(?:(?:[@$]|:@?)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\[\s*)+$/u;
/** A line of closing brackets alone, which joins the line before. */
export const closesOnly = /^\s*\]+\s*$/u;

/** The lines of a block's body a listing shows, from its first line holding text to its last. */
export function keptLines(lines: readonly string[]): { first: number; last: number } | undefined {
  const first = lines.findIndex((line) => line.trim());
  return first < 0 ? undefined : { first, last: lines.findLastIndex((line) => line.trim()) };
}

/**
 * The body lines each shown line of a listing comes from, by index in the body, in the order shown:
 * a line of openings alone joins the next, and a line of closings alone the one before, as
 * readRegions (mapped.server.ts) shows them.
 */
export function shownLineGroups(body: string): number[][] {
  const lines = body.split('\n');
  const kept = keptLines(lines);
  if (!kept) return [];
  const groups: number[][] = [];
  for (let index = kept.first; index <= kept.last; index++) {
    const joinsPrevious =
      groups.length > 0 && (closesOnly.test(lines[index]) || opensOnly.test(lines[index - 1]));
    if (joinsPrevious) groups.at(-1)!.push(index);
    else groups.push([index]);
  }
  return groups;
}

/** A label as a block declares it: its full name, its `@name`, its code to the closing bracket. */
export type LabelDeclaration = {
  full: string;
  listing?: string;
  from: number;
  to: number;
  end: number;
};

const scriptBlocks = /<script\s+(?:algorithm|listing="([^"]*)")\s*>([\s\S]*?)<\/script>/gu;

/**
 * Every label declared in the algorithm block and the listings, `@name[` or `@name{` (a listing's
 * only `@name[`, and its name possibly dotted), each with its full name, named by the labels around
 * it, where its `@name` is, and where its code ends. A `[` or `{` opening no label closes with its
 * own match, as in `values[i]` or `A[i]`; strings and comments in the algorithm are skipped.
 */
export function labelDeclarations(source: string): LabelDeclaration[] {
  const found: LabelDeclaration[] = [];
  for (const block of source.matchAll(scriptBlocks)) {
    const listing = block[1];
    const body = block[2];
    const offset = (block.index ?? 0) + block[0].indexOf(body, block[0].indexOf('>'));
    const open: (LabelDeclaration | undefined)[] = [];
    const names = () => open.flatMap((each) => (each ? [each.full] : [])).slice(-1);
    for (let at = 0; at < body.length; at++) {
      const char = body[at];
      if (listing === undefined && (char === '"' || char === "'" || char === '`')) {
        for (at++; at < body.length && body[at] !== char; at++) if (body[at] === '\\') at++;
        continue;
      }
      if (listing === undefined && body.startsWith('//', at)) {
        at = body.indexOf('\n', at);
        if (at < 0) break;
        continue;
      }
      if (listing === undefined && body.startsWith('/*', at)) {
        at = body.indexOf('*/', at);
        if (at < 0) break;
        at++;
        continue;
      }
      const declared =
        char === '@'
          ? (listing === undefined
              ? /^@([A-Za-z_$][\w$]*)([[{])/u
              : /^@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(\[)/u
            ).exec(body.slice(at))
          : null;
      if (declared) {
        const label: LabelDeclaration = {
          full: [...names(), declared[1]].join('.'),
          ...(listing === undefined ? {} : { listing }),
          from: offset + at,
          to: offset + at + 1 + declared[1].length,
          end: offset + body.length
        };
        found.push(label);
        open.push(label);
        at += declared[0].length - 1;
        continue;
      }
      if (char === '[' || (listing === undefined && char === '{')) open.push(undefined);
      else if ((char === ']' || (listing === undefined && char === '}')) && open.length) {
        const closed = open.pop();
        if (closed) closed.end = offset + at + 1;
      }
    }
  }
  return found;
}

/**
 * The algorithm's label a listing names as written: the one with that full name, else the one whose
 * full name alone ends with it, as a listing names a label by its short name (labelNamed in
 * mapped.server.ts).
 */
function algorithmLabel(
  labels: readonly LabelDeclaration[],
  written: string
): LabelDeclaration | undefined {
  const algorithm = labels.filter(({ listing }) => listing === undefined);
  const exact = algorithm.find(({ full }) => full === written);
  if (exact) return exact;
  const ending = algorithm.filter(({ full }) => full.endsWith(`.${written}`));
  return ending.length === 1 ? ending[0] : undefined;
}

/** The algorithm's declaration of a label, by its full name or a short name only it ends with. */
export function labelCode(source: string, written: string): LabelDeclaration | undefined {
  return algorithmLabel(labelDeclarations(source), written);
}

/** A shown line of a listing, as the source holds it. */
export type ListingLine = {
  /** The listing's name, as `textbook` for <script listing="textbook">. */
  name: string;
  /** The source lines it comes from, from 1. */
  lines: { first: number; last: number };
  /** The labels of the regions it is in, by their full names in the algorithm, outermost first. */
  labels: string[];
};

/**
 * Where a listing's shown line is in the source, by its number from 1 (the L3 of its element id):
 * the block named, or the first, and the labels of the regions round its text.
 */
export function listingLine(source: string, shown: number, name?: string): ListingLine | undefined {
  const blocks = [...source.matchAll(scriptBlocks)].filter((block) => block[1] !== undefined);
  const block = blocks.find((each) => each[1] === name) ?? blocks[0];
  if (!block) return undefined;
  const body = block[2];
  const group = shownLineGroups(body)[shown - 1];
  if (!group) return undefined;
  const bodyStart = (block.index ?? 0) + block[0].indexOf(body, block[0].indexOf('>'));
  const lineOf = (offset: number) => source.slice(0, offset).split('\n').length;
  const bodyLines = body.split('\n');
  const startOf = (index: number) =>
    bodyStart + bodyLines.slice(0, index).reduce((total, line) => total + line.length + 1, 0);
  const from = startOf(group[0]);
  const to = startOf(group.at(-1)!) + bodyLines[group.at(-1)!].length;
  const labels = labelDeclarations(source);
  const around = labels
    .filter((label) => label.listing === block[1] && label.from < to && label.end > from)
    .flatMap((label) => algorithmLabel(labels, label.full)?.full ?? []);
  return {
    name: block[1],
    lines: { first: lineOf(from), last: lineOf(to) },
    labels: [...new Set(around)]
  };
}
