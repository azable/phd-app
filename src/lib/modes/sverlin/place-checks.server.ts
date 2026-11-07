/**
 * Warnings where a listing or a view names a variable or a label in plain text, so it neither
 * lights with its place nor follows the run: read from the source text alone, so they can be
 * counted on any stored version, built or not (data-export.ts warningSummary). Each warning has a
 * fixed code, as the export counts them by code.
 */

import { parse } from 'svelte/compiler';

import type { BuildWarning } from './warnings';
import { labelDeclarations, shownLineGroups } from './listing/source-lines';

const identifier = '[A-Za-z_$][\\w$]*';
const blockOf = (source: string, name: string) =>
  new RegExp(`<script\\s+${name}\\s*>([\\s\\S]*?)<\\/script>`, 'u').exec(source)?.[1] ?? '';

/** The algorithm's variables and the inputs: what a listing or a view could name by its place. */
export function sourceVariables(source: string): Set<string> {
  const algorithm = blockOf(source, 'algorithm');
  const input = blockOf(source, 'input');
  const declared = [
    ...[...algorithm.matchAll(new RegExp(`\\b(?:let|const|var)\\s+(${identifier})`, 'gu'))].map(
      (match) => match[1]
    ),
    ...[...algorithm.matchAll(new RegExp(`\\bfunction\\s+${identifier}\\s*\\(([^)]*)\\)`, 'gu'))]
      .flatMap((match) => match[1].split(','))
      .map((parameter) => parameter.trim()),
    ...[...input.matchAll(new RegExp(`\\bconst\\s+(${identifier})`, 'gu'))].map((match) => match[1])
  ];
  return new Set(declared.filter((name) => new RegExp(`^${identifier}$`, 'u').test(name)));
}

/**
 * The variables the views and layouts draw, as `{i}` or `index={i}`: those a token can name, as the
 * build refuses a token naming a place no render draws.
 */
export function drawnVariables(source: string): Set<string> {
  const markup = source.replace(/<script\b[\s\S]*?<\/script>/gu, '');
  const variables = sourceVariables(source);
  const drawn = new Set<string>();
  // A render draws the variable itself, `{i}` or `value={i}`; one inside an expression, as
  // `{#each values as v}`, draws what the expression gives, and a prop passed on, as
  // `<Row />`, draws nothing itself.
  for (const match of markup.matchAll(/(?:(?<!=)|\bvalue=)\{\s*([A-Za-z_$][\w$]*)\s*\}/gu))
    if (variables.has(match[1])) drawn.add(match[1]);
  return drawn;
}

/** The labels each scene pauses at, by full name, their moments (`.end`) left out. */
function pausedLabels(source: string): string[] {
  return [...source.matchAll(/<Scene\b[^>]*?\bpause="([^"]*)"/gu)].flatMap((match) =>
    match[1]
      .split(',')
      .map((each) =>
        each
          .trim()
          .replace(/^@/u, '')
          .replace(/\.(?:start|end)$/u, '')
      )
      .filter(Boolean)
  );
}

/** Text with each token, `:i[…]` or `:@label[…]`, blanked to its length, brackets balanced. */
function withoutTokens(text: string): string {
  let out = '';
  for (let at = 0; at < text.length; at++) {
    const token = /^:@?[A-Za-z_$][\w$.]*\[/u.exec(text.slice(at));
    if (!token) {
      out += text[at];
      continue;
    }
    let depth = 0;
    let end = at + token[0].length - 1;
    for (; end < text.length; end++) {
      if (text[end] === '[') depth++;
      else if (text[end] === ']' && --depth === 0) break;
    }
    out += ' '.repeat(end + 1 - at);
    at = end;
  }
  return out;
}

/** A listing's text as shown: its region marks, `@name[` and their `]`, blanked. */
function withoutRegions(text: string): string {
  return text.replace(/@[A-Za-z_$][\w$.]*\[/gu, (mark) => ' '.repeat(mark.length));
}

const words = (text: string) =>
  [...text.matchAll(new RegExp(`(?<![\\w$.:@])(${identifier})(?![\\w$])`, 'gu'))].map(
    (match) => match[1]
  );

/** The tokens a text writes, by the place each names, as `i` for `:i[…]`. */
const tokenPlaces = (text: string) =>
  new Set([...text.matchAll(/:([A-Za-z_$][\w$]*)\[/gu)].map((match) => match[1]));

type Listing = { name: string; body: string };

function listings(source: string): Listing[] {
  return [...source.matchAll(/<script\s+listing="([^"]*)"\s*>([\s\S]*?)<\/script>/gu)].map(
    (match) => ({ name: match[1], body: match[2] })
  );
}

/** A variable a listing writes as plain text: listing.plain-variable. */
export function plainListingVariables(source: string): BuildWarning[] {
  const variables = drawnVariables(source);
  return listings(source).flatMap(({ name, body }) => {
    const lines = body.split('\n');
    const plain = new Map<string, number[]>();
    shownLineGroups(body).forEach((group, shown) => {
      // The first line of a listing is its heading, as LINEAR-SEARCH(A, target): no line runs it.
      if (shown === 0) return;
      const text = withoutRegions(withoutTokens(group.map((index) => lines[index]).join('\n')));
      for (const word of new Set(words(text)))
        if (variables.has(word)) plain.set(word, [...(plain.get(word) ?? []), shown + 1]);
    });
    return [...plain].map(([variable, shown]) => ({
      code: 'listing.plain-variable',
      message: `The listing "${name}" writes ${variable} as plain text on line${shown.length > 1 ? 's' : ''} ${shown.join(', ')}: write it as a token, :${variable}[${variable}], so it lights with the place ${variable} at each step that touches it.`
    }));
  });
}

/** What a label's code changes: a variable written, as `i++`, `i = …` or `values[j] = …`. */
function changedVariables(code: string, variables: ReadonlySet<string>): string[] {
  const changed = new Set<string>();
  for (const match of code.matchAll(
    new RegExp(
      `(?<![\\w$.])(${identifier})\\s*(?:\\[[^\\]]*\\]\\s*)?(?:=(?!=)|\\+\\+|--|[-+*/%]=|\\.(?:push|pop|shift|unshift)\\()`,
      'gu'
    )
  ))
    if (variables.has(match[1])) changed.add(match[1]);
  for (const match of code.matchAll(new RegExp(`(?:\\+\\+|--)(${identifier})`, 'gu')))
    if (variables.has(match[1])) changed.add(match[1]);
  return [...changed];
}

/**
 * A variable a label's code changes that its region in a listing marks nowhere, by any name, as
 * `values` its listing calls A: listing.unmarked-read. Only what the code changes is asked for,
 * as a region's text names what its step does, not every value it reads.
 */
export function unmarkedListingChanges(source: string): BuildWarning[] {
  const variables = drawnVariables(source);
  const labels = labelDeclarations(source);
  const algorithm = labels.filter(({ listing }) => listing === undefined);
  const resolve = (written: string) =>
    algorithm.find(({ full }) => full === written) ??
    (() => {
      const ending = algorithm.filter(({ full }) => full.endsWith(`.${written}`));
      return ending.length === 1 ? ending[0] : undefined;
    })();
  // A label's own code, without the code of labels inside it, which their own regions mark.
  const ownCode = (label: (typeof algorithm)[number]) => {
    let code = source.slice(label.to, label.end);
    for (const inner of algorithm)
      if (inner !== label && inner.from >= label.to && inner.end <= label.end)
        code =
          code.slice(0, inner.from - label.to) +
          ' '.repeat(inner.end - inner.from) +
          code.slice(inner.end - label.to);
    return code;
  };
  return labels.flatMap((region) => {
    if (region.listing === undefined) return [];
    const label = resolve(region.full);
    if (!label) return [];
    const text = source.slice(region.to, region.end);
    const marked = tokenPlaces(text);
    return changedVariables(ownCode(label), variables)
      .filter((variable) => !marked.has(variable))
      .map((variable) => ({
        code: 'listing.unmarked-read',
        message: `The listing "${region.listing}" region @${region.full.split('.').at(-1)} changes ${variable} (its code in @${label.full}) but marks it nowhere: write the name it shows as a token of the place, as :${variable}[${variable}] or :${variable}[A] where the listing calls it A, so it lights when ${variable} changes.`
      }));
  });
}

/**
 * A listing line no region marks, between lines regions mark, so it never lights though the lines
 * round it do: listing.line-without-region.
 */
export function unmarkedListingLines(source: string): BuildWarning[] {
  return listings(source).flatMap(({ name, body }) => {
    const lines = body.split('\n');
    const groups = shownLineGroups(body);
    const offsets: number[] = [0];
    for (const line of lines) offsets.push(offsets.at(-1)! + line.length + 1);
    const regions: [number, number][] = [];
    const open: (number | undefined)[] = [];
    for (let at = 0; at < body.length; at++) {
      const mark = /^@[A-Za-z_$][\w$.]*\[/u.exec(body.slice(at));
      if (mark) {
        open.push(at);
        at += mark[0].length - 1;
      } else if (body[at] === '[') open.push(undefined);
      else if (body[at] === ']') {
        const start = open.pop();
        if (start !== undefined) regions.push([start, at]);
      }
    }
    const marked = groups.map((group) => {
      const from = offsets[group[0]];
      const to = offsets[group.at(-1)! + 1] - 1;
      const text = lines.slice(group[0], group.at(-1)! + 1).join('\n');
      return !text.trim() || regions.some(([start, end]) => start < to && end >= from);
    });
    const unmarked = marked.flatMap((isMarked, shown) =>
      shown > 0 &&
      !isMarked &&
      marked.slice(1, shown).some(Boolean) &&
      marked.slice(shown + 1).some(Boolean)
        ? [shown + 1]
        : []
    );
    return unmarked.length
      ? [
          {
            code: 'listing.line-without-region',
            message: `The listing "${name}" marks no region on line${unmarked.length > 1 ? 's' : ''} ${unmarked.join(', ')}, between lines it marks, so ${unmarked.length > 1 ? 'they never light' : 'it never lights'}: mark the code ${unmarked.length > 1 ? 'each runs' : 'it runs'} as @label[…] of its label in the algorithm.`
          }
        ]
      : [];
  });
}

type MarkupText = { text: string; kind?: string };

/** The words of each node in the views, layouts and storyboard: its text between renders. */
function markupTexts(source: string): MarkupText[] {
  const markup = source.replace(/<script\b[\s\S]*?<\/script>/gu, (block) =>
    block.replace(/[^\n]/gu, ' ')
  );
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(markup, { modern: true });
  } catch {
    return [];
  }
  const texts: MarkupText[] = [];
  const visit = (node: unknown, kind: string | undefined) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => visit(child, kind));
    const part = node as {
      type?: string;
      name?: string;
      data?: string;
      attributes?: { name?: string; value?: unknown }[];
      fragment?: { nodes: unknown[] };
    };
    if (part.type === 'Component' && part.name === 'Node') {
      const kindAttribute = part.attributes?.find((attribute) => attribute.name === 'kind');
      const value = Array.isArray(kindAttribute?.value) ? kindAttribute.value[0] : undefined;
      const written = (value as { data?: string } | undefined)?.data;
      const nodes = part.fragment?.nodes ?? [];
      const text = nodes
        .map((child) =>
          (child as { type?: string }).type === 'Text'
            ? ((child as { data: string }).data ?? '')
            : ' '
        )
        .join('');
      if (text.trim()) texts.push({ text, kind: written });
      return visit(nodes, written);
    }
    for (const [key, child] of Object.entries(part))
      if (key !== 'attributes' && typeof child === 'object') visit(child, kind);
  };
  visit(ast.fragment, undefined);
  return texts;
}

/**
 * Words naming a variable where its place would follow it: a node whose words are only a variable's
 * name, as a caption `i`, is view.caption-name.
 */
export function captionNames(source: string): BuildWarning[] {
  const variables = drawnVariables(source);
  return [
    ...new Set(
      markupTexts(source)
        .map(({ text }) => withoutTokens(text).trim())
        .filter((text) => variables.has(text))
    )
  ].map((variable) => ({
    code: 'view.caption-name',
    message: `A node's words are ${variable}, the variable's name as plain text: write {place()} in a view drawn at the place, so the words follow it, or a token, :${variable}[${variable}], which lights with the place and draws the words as inline code.`
  }));
}

/**
 * Code written as plain words in a view, as `values[i] > key`, which shows as it is written and
 * lights nothing: view.plain-code.
 */
export function plainCode(source: string): BuildWarning[] {
  const variables = drawnVariables(source);
  const name = `(?<![\\w$.:@])(${identifier})`;
  const code = new RegExp(
    `${name}\\s*(?:\\[[^\\]\\s]+\\]|(?:===?|!==?|<=?|>=?|\\+\\+|--)\\s*[\\w$]+)`,
    'gu'
  );
  const found = new Set<string>();
  for (const { text } of markupTexts(source))
    for (const match of withoutTokens(text).matchAll(code))
      if (variables.has(match[1])) found.add(match[0].trim());
  return [...found].map((written) => ({
    code: 'view.plain-code',
    message: `A node's words write code as plain text, ${written}: write it as a token naming its place, as :${written.match(new RegExp(identifier, 'u'))?.[0]}[${written}], or draw the label's value, as {@label}, so it lights with the run.`
  }));
}

/**
 * A variable's value written as words, as `i is 3`, which the run never changes:
 * view.literal-value.
 */
export function literalValues(source: string): BuildWarning[] {
  const variables = sourceVariables(source);
  const found = new Set<string>();
  for (const { text } of markupTexts(source))
    for (const match of withoutTokens(text).matchAll(
      new RegExp(`(?<![\\w$.:@])(${identifier})\\s+(?:is|=|equals)\\s+(-?\\d+)\\b`, 'gu')
    ))
      if (variables.has(match[1])) found.add(match[0]);
  return [...found].map((written) => ({
    code: 'view.literal-value',
    message: `A node's words write a value as text, "${written}", which stays the same at every step: draw the variable, as {${written.split(/\s/u)[0]}}, so it shows the value each step has.`
  }));
}

/**
 * A label a view shows by (`when="@x"`) or reads (`{@x}`, `of="@x"`) that no scene pauses at, nor at
 * a label inside it, so it never shows: view.unpaused-label.
 */
export function unpausedLabels(source: string): BuildWarning[] {
  const paused = pausedLabels(source);
  if (!paused.length) return [];
  const algorithm = labelDeclarations(source).filter(({ listing }) => listing === undefined);
  const full = (written: string) =>
    algorithm.find((label) => label.full === written)?.full ??
    algorithm.filter((label) => label.full.endsWith(`.${written}`)).map((label) => label.full)[0] ??
    written;
  const fullPaused = paused.map(full);
  const markup = source.replace(/<script\b[\s\S]*?<\/script>/gu, '');
  const named = new Set([
    ...[...markup.matchAll(/\b(?:when|of)="@([\w$.]+)"/gu)].map((match) => match[1]),
    ...[...markup.matchAll(/\{@([A-Za-z_$][\w$.]*)\}/gu)].map((match) => match[1])
  ]);
  return [...named].flatMap((written) => {
    const label = full(written);
    const shows = fullPaused.some(
      (each) => each === label || each.startsWith(`${label}.`) || label.startsWith(`${each}.`)
    );
    return shows
      ? []
      : [
          {
            code: 'view.unpaused-label',
            message: `The view shows or reads @${written}, but no scene pauses at it or at a label inside it, so it never shows: add @${label} to a scene's pause, or name a label the scene pauses at.`
          }
        ];
  });
}

/**
 * The statements at a code's top level, each with whether a label inside it marks it: split at each
 * `;` outside brackets, and after a block `}` closing at the top level.
 */
function topStatements(code: string, labelled: (from: number, to: number) => boolean) {
  const statements: { text: string; labelled: boolean }[] = [];
  let depth = 0;
  let start = 0;
  const close = (end: number) => {
    const text = code.slice(start, end).trim();
    if (text && text !== ';') statements.push({ text, labelled: labelled(start, end) });
    start = end;
  };
  for (let at = 0; at < code.length; at++) {
    const char = code[at];
    if (char === '"' || char === "'" || char === '`') {
      for (at++; at < code.length && code[at] !== char; at++) if (code[at] === '\\') at++;
    } else if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) {
      depth = Math.max(0, depth - 1);
      // A block closing at the top level ends its statement, unless `else` follows it.
      if (char === '}' && depth === 0 && !/^\s*else\b/u.test(code.slice(at + 1))) close(at + 1);
    } else if (char === ';' && depth === 0) close(at + 1);
  }
  close(code.length);
  return statements;
}

/**
 * A label holding, at its own top level, two or more statements that are not each labelled, so a
 * learner cannot step through or light each one, as `@halves[sort(a, b, lo, mid); sort(a, b, mid,
 * hi);]` or a swap's three writes; or a listing region spanning two or more lines with no region of
 * their own: label.clumped. Label finely in the algorithm and the listing, and choose the level in
 * the view: a scene pausing at the outer label steps and lights the group as one.
 */
export function clumpedLabels(source: string): BuildWarning[] {
  const labels = labelDeclarations(source);
  const algorithm = labels.filter(({ listing }) => listing === undefined);
  const inner = (label: (typeof labels)[number], from: number, to: number) =>
    labels.some(
      (each) =>
        each !== label &&
        each.listing === label.listing &&
        each.from >= label.to + 1 + from &&
        each.from < label.to + 1 + to
    );
  const fromAlgorithm = algorithm.flatMap((label) => {
    const code = source.slice(label.to + 1, label.end - 1);
    const statements = topStatements(code, (from, to) => inner(label, from, to));
    const plain = statements.filter((statement) => !statement.labelled);
    if (statements.length < 2 || !plain.length) return [];
    const name = label.full.split('.').at(-1);
    return [
      {
        code: 'label.clumped',
        message: `@${label.full} holds ${statements.length} statements, ${plain.length} with no label of ${plain.length > 1 ? 'their' : 'its'} own (${plain
          .map(({ text }) => text.replace(/\s+/gu, ' ').replace(/;$/u, '').slice(0, 40))
          .join(
            '; '
          )}), so a learner cannot step through or light each: label each inside it, as @${name}[@first[…] @second[…]]. The group stays: a scene pausing at @${name} steps and lights it as one, and one pausing at the inner labels steps each.`
      }
    ];
  });
  const fromListings = labels.flatMap((region) => {
    if (region.listing === undefined) return [];
    const text = source.slice(region.to + 1, region.end - 1);
    const lines = text.split('\n');
    if (lines.filter((line) => line.trim()).length < 2) return [];
    let offset = 0;
    const plain = lines.filter((line) => {
      const from = offset;
      offset += line.length + 1;
      return line.trim() && !/^\s*\]+\s*$/u.test(line) && !inner(region, from, from + line.length);
    });
    if (plain.length < 2) return [];
    const name = region.full.split('.').at(-1);
    return [
      {
        code: 'label.clumped',
        message: `The listing "${region.listing}" region @${region.full} spans ${plain.length} lines with no region of their own (${plain
          .map((line) => line.trim().slice(0, 30))
          .join(
            '; '
          )}): mark each line's code with the label of its own part, inside @${name}, so each lights at its own step and @${name} still lights them all.`
      }
    ];
  });
  return [...fromAlgorithm, ...fromListings];
}

/** The codes of the warnings below. */
export const placeWarningCodes: ReadonlySet<string> = new Set([
  'label.clumped',
  'listing.plain-variable',
  'listing.unmarked-read',
  'listing.line-without-region',
  'view.caption-name',
  'view.plain-code',
  'view.literal-value',
  'view.unpaused-label'
]);

/** Every place and label warning of a source. */
export function placeWarnings(source: string): BuildWarning[] {
  return [
    ...clumpedLabels(source),
    ...plainListingVariables(source),
    ...unmarkedListingChanges(source),
    ...unmarkedListingLines(source),
    ...captionNames(source),
    ...plainCode(source),
    ...literalValues(source),
    ...unpausedLabels(source)
  ];
}
