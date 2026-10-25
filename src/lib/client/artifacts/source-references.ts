/**
 * What text in a message refers to in a source: the regions an inline code span names, as a snippet
 * (`Highlight`, `Row.Under`), a label (`@left`, `@swap.held`), a design variable
 * (`Highlight.Pointed@left.fill`, `views.Int`), a line (`line 33`, `33:12`), or code written as it
 * is there; and the regions build problems are about.
 *
 * @packageDocumentation
 */

import type { BuildDiagnostic } from '$lib/shared/projects/events/values';

/** A region of a source, by offsets into its text. */
export type SourceRange = { from: number; to: number };

/** The props a kind's variable can set, the last part of a key such as `Highlight.Pointed.fill`. */
const props = new Set([
  'shown',
  'fill',
  'stroke',
  'color',
  'strokeWidth',
  'strokeStyle',
  'opacity',
  'font',
  'size',
  'weight',
  'padding',
  'radius',
  'minSize',
  'gap',
  'align',
  'justify',
  'overflow'
]);

const name = String.raw`[A-Za-z_$][\w$]*`;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** The regions a reference names in a source, in order; none when it names nothing there. */
export function referenceRanges(source: string, text: string): SourceRange[] {
  const written = text.trim();
  if (!written) return [];
  const line = /^(?:lines?\s+(\d+)(?:\s*[-–]\s*(\d+))?|(\d+):(\d+))$/u.exec(written);
  if (line) {
    const [, first, last, at, column] = line;
    return at
      ? linePosition(source, Number(at), Number(column))
      : lineRange(source, Number(first), Number(last ?? first));
  }
  const variable = new RegExp(
    String.raw`^(views|pointers)\.(${name}(?:\.${name})*)(?:@(.+))?$`,
    'u'
  ).exec(written);
  if (variable) {
    const [, , path, place] = variable;
    return renders(source, path.split('.').at(-1) ?? path, place);
  }
  const label = new RegExp(String.raw`^@(${name}(?:\.${name})*)$`, 'u').exec(written);
  if (label) return labelRanges(source, label[1]);
  const kind = kindKey(written);
  if (kind) {
    const regions = kindRanges(source, kind.segments);
    if (regions.length && kind.place) regions.push(...placeRenders(source, kind.place));
    if (regions.length) return sorted(regions);
  }
  // Code written as it is in the source, specific enough not to be a word or a name.
  if (written.length >= 3 && /[^\w\s]/u.test(written)) return occurrences(source, written);
  return [];
}

/** The regions build problems are about, as the editor underlines them. */
export function diagnosticRanges(
  source: string,
  diagnostics: readonly BuildDiagnostic[]
): SourceRange[] {
  return sorted(
    diagnostics.flatMap((diagnostic) => {
      const [from] = linePosition(source, diagnostic.line ?? 1, diagnostic.column ?? 1);
      if (!from) return [];
      const end =
        diagnostic.endLine && diagnostic.endColumn
          ? linePosition(source, diagnostic.endLine, diagnostic.endColumn)[0]?.from
          : undefined;
      const lineEnd =
        lineRange(source, diagnostic.line ?? 1, diagnostic.line ?? 1)[0]?.to ?? from.to;
      return [{ from: from.from, to: Math.max(end ?? lineEnd, from.from) }];
    })
  );
}

/** Whole lines, from 1; none outside the source. */
function lineRange(source: string, first: number, last: number): SourceRange[] {
  const starts = lineStarts(source);
  if (first < 1 || first > starts.length || last < first) return [];
  const end = Math.min(last, starts.length);
  const to = end < starts.length ? starts[end] - 1 : source.length;
  return [{ from: starts[first - 1], to }];
}

/** A line and column, both from 1, to the end of that line. */
function linePosition(source: string, line: number, column: number): SourceRange[] {
  const [whole] = lineRange(source, line, line);
  if (!whole) return [];
  return [{ from: Math.min(whole.from + Math.max(column - 1, 0), whole.to), to: whole.to }];
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++)
    if (source[index] === '\n') starts.push(index + 1);
  return starts;
}

/** Each place the text is written, at most twenty. */
function occurrences(source: string, text: string): SourceRange[] {
  const found: SourceRange[] = [];
  for (
    let at = source.indexOf(text);
    at >= 0 && found.length < 20;
    at = source.indexOf(text, at + 1)
  )
    found.push({ from: at, to: at + text.length });
  return found;
}

function matches(source: string, pattern: RegExp, group = 0): SourceRange[] {
  return [...source.matchAll(pattern)].map((match) => {
    const at = (match.index ?? 0) + (group ? match[0].indexOf(match[group]) : 0);
    return { from: at, to: at + match[group].length };
  });
}

/**
 * A kind or its variable, as `Row.Under`, `Highlight.Pointed.fill` or `IntCell@swap.held.fill`:
 * the snippet path, and the place after `@`, less a prop at the end.
 */
function kindKey(text: string): { segments: string[]; place?: string } | undefined {
  const [path, ...rest] = text.split('@');
  const pathPattern = new RegExp(String.raw`^${name}(?:\.${name})*$`, 'u');
  if (!pathPattern.test(path) || rest.length > 1) return undefined;
  if (!rest.length) {
    const segments = path.split('.');
    if (props.has(segments.at(-1) ?? '')) segments.pop();
    return segments.length ? { segments } : undefined;
  }
  const place = rest[0].split('.');
  if (props.has(place.at(-1) ?? '') && place.length > 1) place.pop();
  if (!pathPattern.test(place.join('.'))) return undefined;
  return { segments: path.split('.'), place: place.join('.') };
}

/** A label: where the algorithm labels code with it, and where the view reads it. */
function labelRanges(source: string, label: string): SourceRange[] {
  const last = label.split('.').at(-1) ?? label;
  return sorted([
    ...matches(source, new RegExp(String.raw`@${escape(last)}(?=[[{])`, 'gu')),
    ...matches(source, new RegExp(String.raw`@${escape(label)}(?![\w$.[{])`, 'gu'))
  ]);
}

/** A snippet's declaration, or a declaration in a script; for `.Pointed`, the snippet's marks. */
function kindRanges(source: string, segments: string[]): SourceRange[] {
  const part = segments.at(-1) === 'Pointed' || segments.at(-1) === 'Link' ? segments.at(-1) : '';
  const snippet = part ? segments.at(-2) : segments.at(-1);
  if (!snippet) return [];
  const declared = matches(
    source,
    new RegExp(String.raw`\{#snippet\s+(${escape(snippet)})\s*\(`, 'gu'),
    1
  );
  if (!declared.length) {
    if (segments.length > 1) return [];
    return matches(
      source,
      new RegExp(String.raw`(?:\b(?:const|let|function)\s+)(${escape(snippet)})\b`, 'gu'),
      1
    );
  }
  if (!part) return declared;
  const body = source.slice(declared[0].to);
  const end = body.indexOf('{/snippet}');
  const inside = end < 0 ? body : body.slice(0, end);
  return [
    ...declared,
    ...matches(inside, new RegExp(String.raw`<${part}\b`, 'gu')).map(({ from, to }) => ({
      from: from + declared[0].to,
      to: to + declared[0].to
    }))
  ];
}

/** The renders of a type by name, or only those at a place. */
function renders(source: string, type: string, place?: string): SourceRange[] {
  const argument = place === undefined ? '[^)]*' : placeArgument(place);
  return matches(
    source,
    new RegExp(String.raw`\{@render\s+${escape(type)}\(${argument}\)\}`, 'gu')
  );
}

/** The renders at a place, whatever they render. */
function placeRenders(source: string, place: string): SourceRange[] {
  return matches(
    source,
    new RegExp(String.raw`\{@render\s+${name}\(${placeArgument(place)}\)\}`, 'gu')
  );
}

/** A place as written in a render: a label, or a variable or field. */
function placeArgument(place: string): string {
  return `@?${escape(place)}`;
}

function sorted(ranges: SourceRange[]): SourceRange[] {
  return ranges
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .filter((range, index, all) => index === 0 || range.from !== all[index - 1].from);
}
