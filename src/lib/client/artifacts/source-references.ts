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

/**
 * What a build of the source records that references need: the variable each render of a type by
 * name reads (`views.Index`, `pointers.Index`), by the line:column of its tag, and a variant's
 * values, which say the view each choice draws with.
 */
export type ReferenceDesign = {
  renders?: Readonly<Record<string, string>>;
  variant?: Readonly<Record<string, unknown>>;
};

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

/**
 * The regions a reference names in a source, in order; none when it names nothing there. A view
 * choice names the renders a build of the source (`design`) records as reading it, and the view it
 * draws them with now, or without a record, every render of its type.
 */
export function referenceRanges(
  source: string,
  text: string,
  design?: ReferenceDesign
): SourceRange[] {
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
    if (design?.renders && Object.keys(design.renders).length)
      return choiceRanges(source, written, design);
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
  // Code written with … for what is left out, as `{@render Highlight(…)}`: wherever it fits.
  if (written.includes('…')) return elided(source, written);
  // Code written as it is in the source, specific enough not to be a word or a name.
  if (written.length >= 3 && /[^\w\s]/u.test(written)) return occurrences(source, written);
  return [];
}

/**
 * The design variable a reference names whose value the editor shows in a row of its own, which a
 * link then reveals: a kind's or a place's prop (`IntCell.fill`, `Highlight.Pointed@left.fill`), a
 * place's view choice (`pointers.Index@found`), or a page-frame or listing setting, as the variant
 * of a build of the source (`design`) has it. A type's own view choice (`views.Index`) has no row:
 * the view markers after its renders show it.
 */
export function ghostKey(text: string, design?: ReferenceDesign): string | undefined {
  const written = text.trim();
  if (!design?.variant || !Object.hasOwn(design.variant, written)) return undefined;
  return /^(?:views|pointers)\.[^@]+$/u.test(written) ? undefined : written;
}

/**
 * A label's full name as a pill shows it, kept to its last two parts, the parts before elided:
 * `@insert.compare.left` as `@…compare.left`, `pause@insert.compare.left` as
 * `pause@…compare.left`, `Highlight.Pointed@insert.compare.left.fill` as
 * `Highlight.Pointed@…compare.left.fill`, a kind's place keeping its prop; `head` before the
 * ellipsis, `hidden` the parts it stands for, `tail` after it. None for a name of two parts or
 * fewer, or text that names no label.
 */
export function elidedName(
  text: string
): { head: string; hidden: string; tail: string } | undefined {
  const written = new RegExp(
    String.raw`^((?:${name}(?:\.${name})*)?@)(${name}(?:\.${name})*)$`,
    'u'
  );
  const match = written.exec(text);
  if (!match) return undefined;
  const [, head, path] = match;
  const parts = path.split('.');
  const prop = head.includes('.') && !/^(?:views|pointers)\./u.test(head) ? 1 : 0;
  const cut = parts.length - prop - 2;
  if (cut <= 0) return undefined;
  return { head, hidden: `${parts.slice(0, cut).join('.')}.`, tail: parts.slice(cut).join('.') };
}

/**
 * Text split into its code and the rest, as an error message names code without marking it: a
 * `{…}` span, a label (`@left`, `@check.found[`), a key or path (`pointers.Index@found`,
 * `Row.Under`), or a call (`Highlight(…)`), each code only where it names something in the source.
 */
export function codeIn(
  source: string,
  text: string,
  design?: ReferenceDesign
): { text: string; code: boolean }[] {
  const spans: { text: string; code: boolean }[] = [];
  const add = (written: string, code: boolean) => {
    const last = spans.at(-1);
    if (last && !last.code && !code) last.text += written;
    else spans.push({ text: written, code });
  };
  for (let at = 0; at < text.length; ) {
    const candidates = codeAt(text, at);
    const piece = candidates.find((candidate) => referenceRanges(source, candidate, design).length);
    // Code naming nothing in the source, as a fix a message suggests, is text, inside it too.
    const written = piece ?? candidates[0] ?? text[at];
    add(written, piece !== undefined);
    at += written.length;
  }
  return spans;
}

/** Text as Markdown that shows it as written, its code as inline code, from `codeIn`. */
export function codeMarkdown(spans: readonly { text: string; code: boolean }[]): string {
  return spans
    .map(({ text, code }) => {
      if (!code) return text.replace(/[!-/:-@[-`{-~]/gu, '\\$&');
      const fence = '`'.repeat(
        Math.max(0, ...[...text.matchAll(/`+/gu)].map(([run]) => run.length)) + 1
      );
      return `${fence}${text.startsWith('`') || text.endsWith('`') ? ` ${text} ` : text}${fence}`;
    })
    .join('');
}

/** The code-shaped pieces of text starting at an offset, longest first; see `codeIn`. */
function codeAt(text: string, at: number): string[] {
  if (at > 0 && /[\w$@.{]/u.test(text[at - 1])) return [];
  if (text[at] === '{') return [balanced(text, at, '{', '}') ?? ''].filter(Boolean);
  const rest = text.slice(at);
  const label = new RegExp(String.raw`^@${name}(?:\.${name})*`, 'u').exec(rest)?.[0];
  if (label) {
    // A label opening a region, as `@check.found[`, is code only with its region, where closed.
    return rest[label.length] === '['
      ? [label + (balanced(rest, label.length, '[', ']') ?? '[')]
      : [label];
  }
  const path = new RegExp(String.raw`^${name}(?:\.${name})*(?:@${name}(?:\.${name})*)?`, 'u').exec(
    rest
  )?.[0];
  if (!path) return [];
  const call = rest[path.length] === '(' ? balanced(rest, path.length, '(', ')') : undefined;
  // A word alone is no code: only a call, or a path with a dot or a place.
  return [...(call ? [path + call] : []), ...(/[.@]/u.test(path) ? [path] : [])];
}

/** From an opener to the closer that matches it, or nothing where it is never closed. */
function balanced(text: string, at: number, open: string, close: string): string | undefined {
  let depth = 0;
  for (let index = at; index < text.length; index++) {
    if (text[index] === open) depth++;
    else if (text[index] === close && --depth === 0) return text.slice(at, index + 1);
  }
  return undefined;
}

/** Where code written with … fits, each … standing for anything on one line. */
function elided(source: string, written: string): SourceRange[] {
  const parts = written.split('…');
  if (parts.join('').trim().length < 3) return [];
  return matches(source, new RegExp(parts.map(escape).join('[^\\n]*?'), 'gu')).slice(0, 20);
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

/**
 * A label, by its full name: where the algorithm and a listing declare it, each declaration named
 * by the labels around it, so `@rise.compare.left` is never `@fall.compare.left`; and where the view
 * reads it.
 */
function labelRanges(source: string, label: string): SourceRange[] {
  return sorted([
    ...labelDeclarations(source)
      .filter(({ full }) => full === label)
      .map(({ from, to }) => ({ from, to })),
    ...matches(source, new RegExp(String.raw`(?<!\{)@${escape(label)}(?![\w$.[{])`, 'gu'))
  ]);
}

/**
 * Every label declared in the algorithm block and the listings, `@name[` or `@name{` (a listing's
 * only `@name[`), each with its full name and where its `@name` is. A `[` or `{` opening no label
 * closes with its own match, as in `values[i]` or `A[i]`; strings and comments in the algorithm are
 * skipped.
 */
function labelDeclarations(source: string): { full: string; from: number; to: number }[] {
  const found: { full: string; from: number; to: number }[] = [];
  const blocks = /<script\s+lang="sverlin"(\s+listing="[^"]*")?\s*>([\s\S]*?)<\/script>/gu;
  for (const block of source.matchAll(blocks)) {
    const listing = Boolean(block[1]);
    const body = block[2];
    const offset = (block.index ?? 0) + block[0].indexOf(body, block[0].indexOf('>'));
    const open: (string | undefined)[] = [];
    const names = () => open.filter((name): name is string => name !== undefined);
    for (let at = 0; at < body.length; at++) {
      const char = body[at];
      if (!listing && (char === '"' || char === "'" || char === '`')) {
        for (at++; at < body.length && body[at] !== char; at++) if (body[at] === '\\') at++;
        continue;
      }
      if (!listing && body.startsWith('//', at)) {
        at = body.indexOf('\n', at);
        if (at < 0) break;
        continue;
      }
      if (!listing && body.startsWith('/*', at)) {
        at = body.indexOf('*/', at);
        if (at < 0) break;
        at++;
        continue;
      }
      const declared = char === '@' ? /^@([A-Za-z_$][\w$]*)([[{])/u.exec(body.slice(at)) : null;
      if (declared && (!listing || declared[2] === '[')) {
        const full = [...names(), declared[1]].join('.');
        found.push({ full, from: offset + at, to: offset + at + 1 + declared[1].length });
        open.push(declared[1]);
        at += declared[0].length - 1;
        continue;
      }
      if (char === '[' || (!listing && char === '{')) open.push(undefined);
      else if ((char === ']' || (!listing && char === '}')) && open.length) open.pop();
    }
  }
  return found;
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

/** A view choice's parts: `views` or `pointers`, the type it draws, and its place, if any. */
function choice(key: string): { kind: string; type: string; place?: string } | undefined {
  const parsed = new RegExp(
    String.raw`^(views|pointers)\.(?:${name}\.)*(${name})(?:@(.+))?$`,
    'u'
  ).exec(key);
  return parsed ? { kind: parsed[1], type: parsed[2], place: parsed[3] } : undefined;
}

/**
 * The renders a build records as reading a view choice, each tag whole, and the declaration of the
 * view the variant chooses. A type's choice (`views.Index`) also names the renders of the type at
 * places of their own that draw with its view, as they do until a variant sets theirs apart; a
 * place's choice (`pointers.Index@found`) names only its own.
 */
function choiceRanges(source: string, key: string, design: ReferenceDesign): SourceRange[] {
  const wanted = choice(key);
  if (!wanted) return [];
  const view = design.variant?.[key] ?? design.variant?.[`${wanted.kind}.${wanted.type}`];
  const starts = lineStarts(source);
  const found: SourceRange[] = [];
  for (const match of source.matchAll(/\{@render\s/gu)) {
    const at = match.index ?? 0;
    const line = starts.findLastIndex((start) => start <= at);
    const read = design.renders?.[`${line + 1}:${at - starts[line] + 1}`];
    const reading = read ? choice(read) : undefined;
    if (
      !read ||
      !reading ||
      reading.kind !== wanted.kind ||
      reading.type !== wanted.type ||
      (wanted.place !== undefined && read !== key) ||
      (read !== key && design.variant?.[read] !== undefined && design.variant[read] !== view)
    )
      continue;
    const tag = balanced(source, at, '{', '}');
    if (tag) found.push({ from: at, to: at + tag.length });
  }
  const chosen = typeof view === 'string' && view !== 'none' ? kindRanges(source, [view]) : [];
  return found.length ? sorted([...found, ...chosen]) : [];
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
