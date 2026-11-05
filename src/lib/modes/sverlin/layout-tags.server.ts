/**
 * Layouts with inputs, `<Layout name="Window" of="values, lo, hi">…</Layout>`, and their tags,
 * `<Window values={values} lo={lo} hi={hi} />`. A layout declares what it reads and reads nothing
 * else (checked once the view is parsed, see layoutReads); one rendered by a tag inside another
 * layout is a part of it, and becomes the snippet it stands for, its tag a render of it, before
 * Svelte sees the view; one no tag renders is a page, which a scene shows (see storyboard.server.ts).
 * Snippets and renders written by the author are refused, each with the form that replaces it.
 * Every line stays in place: an opening and a tag become no longer than written where they can,
 * padded with spaces, and a part's closing is one longer.
 */

import { drawingTags } from './drawings.server';
import { fitted } from './layouts.server';
import { mathsSvg } from './maths-svg.server';
import { mathsSpans, tokenInMaths, unclosedMaths } from './maths.server';
import { writtenStoryboard, type Scene } from './storyboard.server';
import type { ColumnShift } from './written-columns';

/** One layout as declared: its name, its inputs, whether a tag renders it, and where it is. */
export type DeclaredLayout = {
  name: string;
  /**
   * The state it reads, variables by name and labels as @insert.compare: as its of lists them, or,
   * with no of, inferred from the names its body uses (inferred), the build keeping those of the
   * state and naming any other.
   */
  inputs: { variables: string[]; labels: string[]; inferred?: boolean };
  /** Whether another layout renders it as a tag, which makes it a part of that layout. */
  part: boolean;
  start: number;
  /** Where its body starts and ends, in the source returned. */
  body: { start: number; end: number };
};

type Problem = { message: string; start: number };

/** The components of the library and Sverlin's tags, which no layout may be named. */
const reserved = new Set([
  'Node',
  'Link',
  'Pointed',
  'Listing',
  'Layout',
  'When',
  'OneOf',
  'View',
  'Storyboard',
  'Scene'
]);

const name = /^[A-Za-z_$][\w$]*$/u;
const label = /^@[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u;
// A label named in a layout's body, as {@insert.compare} or <When of="@scan.found">.
const labelReference = /(?<![\w$.@])@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/gu;
// Svelte's own tags, {@render …} and {@html …}, written with an @ that names no label.
const svelteTags = new Set(['render', 'html', 'const', 'debug', 'attach']);
// Words in a layout's braces that name no variable: keywords, the markup's own, and globals.
const unnamed = new Set([
  ...['if', 'else', 'each', 'as', 'key', 'await', 'then', 'catch', 'snippet', 'const', 'let'],
  ...['true', 'false', 'null', 'undefined', 'typeof', 'new', 'in', 'of', 'this', 'return'],
  ...['Math', 'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Infinity', 'NaN'],
  ...['count', 'spans', 'at', ...svelteTags]
]);

/**
 * The names a layout's body uses in its braces that could be the algorithm's variables: every name
 * not after a dot, not a key, not a word of the markup's own, and not one an {#each} or {@const}
 * names there. The build keeps those of the state (see layoutReadProblems).
 */
function namesUsed(body: string): string[] {
  const used: string[] = [];
  const local = new Set<string>();
  for (const [, inside] of body.matchAll(/\{((?:[^{}]|\{[^{}]*\})*)\}/gu)) {
    let code = inside.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/gu, "''");
    const each = /^#each\s+([\s\S]*?)\s+as\s+([\s\S]*)$/u.exec(code);
    if (each) {
      for (const [alias] of each[2].matchAll(/[A-Za-z_$][\w$]*/gu)) local.add(alias);
      code = each[1];
    }
    const constant = /^@const\s+([A-Za-z_$][\w$]*)\s*=([\s\S]*)$/u.exec(code);
    if (constant) {
      local.add(constant[1]);
      code = constant[2];
    }
    if (/^@/u.test(code) && !constant) continue;
    for (const match of code.matchAll(/(?<![\w$.@#/:])([A-Za-z_$][\w$]*)(?!\w|:[^:])/gu))
      if (!unnamed.has(match[1])) used.push(match[1]);
  }
  return [...new Set(used.filter((each) => !local.has(each)))];
}
const layoutOpening = /<Layout\b((?:[^>{"']|"[^"]*"|'[^']*'|\{[^}]*\})*)>/gu;
const layoutProp = /^\s*([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{[^}]*\}))/u;
const tagProp = /^\s*([A-Za-z_$][\w$]*)\s*=\s*\{([^}]*)\}/u;

/** How a layout is written, for messages. */
const layoutAdvice =
  'a layout is written <Layout name="Window" of="values, lo, hi">…</Layout>, named, with the state it reads, and rendered by another as <Window values={values} lo={lo} hi={hi} />';

/** Blank text, keeping its lines. */
const blank = (text: string) => text.replace(/[^\n]/gu, ' ');

/** Where each snippet or render written in the source is, with what replaces it. */
function writtenSnippets(scanned: string): Problem[] {
  const problems: Problem[] = [];
  const views = [...scanned.matchAll(/<View\b[\s\S]*?<\/View\s*>/gu)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));
  const inView = (at: number) => views.some(({ start, end }) => at > start && at < end);
  for (const match of scanned.matchAll(/\{#snippet\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\}/gu)) {
    const [, snippet, parameters] = match;
    const start = match.index ?? 0;
    const type = /:\s*([^,]+?)\s*$/u.exec(parameters)?.[1];
    problems.push({
      message: parameters.trim()
        ? `${snippet} takes a value, as only a view does: write it as a view, <View of="${type ?? 'Int'}" name="${snippet}">…</View>, its value this.`
        : inView(start)
          ? `{#snippet ${snippet}()} gives the nodes inside it a kind of their own: write kind="${snippet}" on the node instead, as <Node kind="${snippet}">…</Node>, where it is drawn.`
          : `{#snippet ${snippet}()} is written as a layout: <Layout name="${snippet}" of="…">…</Layout>, declaring the state it reads, rendered where it is drawn as <${snippet} … />.`,
      start
    });
  }
  for (const match of scanned.matchAll(/\{@render\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\}/gu)) {
    const [, rendered, argument] = match;
    problems.push({
      message: argument.trim()
        ? `{@render ${rendered}(${argument.trim()})} is written {${argument.trim()}}: a value in braces draws its type's view.`
        : `{@render ${rendered}()} is written as the layout's tag, <${rendered} … />, passing the state it declares.`,
      start: match.index ?? 0
    });
  }
  for (const match of scanned.matchAll(/\{@render\b(?!\s+[A-Za-z_$][\w$]*\s*\()/gu))
    problems.push({
      message:
        'A layout is drawn by its tag where it is written, as <Title />: which layout draws is fixed in the source, never worked out as the view runs.',
      start: match.index ?? 0
    });
  return problems;
}

/**
 * The source with every part layout as a snippet and every tag as a render, every page layout as
 * `<Layout name="…">`, and the layouts declared, with the problems: a snippet or render written by
 * the author, a layout or tag written otherwise, an input missing, extra or passed another value,
 * or a layout rendering itself.
 */
export function layoutTags(source: string): {
  source: string;
  layouts: DeclaredLayout[];
  problems: Problem[];
  /** Where a rewrite made a line longer, for positions to name the source as written. */
  shifts: ColumnShift[];
  /** The storyboard's scenes, in the order they play. */
  scenes: Scene[];
  /**
   * A missing storyboard, reported after the view's own problems, as a source being written often
   * lacks its storyboard first.
   */
  unshown: Problem[];
  /** The places caption tokens name, as @i for $i[A[i]], each where it is written. */
  captions: { place: string; start: number }[];
} {
  // Comments and scripts are not markup: read as spaces, nothing in them counts.
  let scanned = source.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>/gu, blank);
  // Inline maths, $$…$$, becomes a node of kind Math holding MathJax's SVG and the text the PDF
  // draws in its place (see maths-svg), and is read as spaces by every scan after, so its braces
  // and $ are no Svelte expression or token.
  const mathsProblems: Problem[] = [];
  const mathsEdits: { start: number; length: number; text: string }[] = [];
  for (const { start, end, inside } of mathsSpans(scanned)) {
    if (end < 0) {
      mathsProblems.push({ message: unclosedMaths, start });
      break;
    }
    const token = /\$[A-Za-z_]\w*\[/u.exec(inside);
    const converted = token ? { problem: tokenInMaths(token[0]) } : mathsSvg(inside);
    if ('problem' in converted) mathsProblems.push({ message: converted.problem, start });
    else
      mathsEdits.push({
        start,
        length: end - start,
        text: `<Node kind="Math" __math={${JSON.stringify(converted.svg)}} __mathText={${JSON.stringify(converted.text)}} />`
      });
    scanned = scanned.slice(0, start) + blank(scanned.slice(start, end)) + scanned.slice(end);
  }
  // A drawing, <Svg viewBox="…">…</Svg>, becomes a sized <svg> root (see drawings), its tags read
  // as spaces by every scan after, so no scan takes <Svg> for a layout's tag.
  const drawings = drawingTags(scanned);
  scanned = drawings.scanned;
  const problems = [...mathsProblems, ...drawings.problems, ...writtenSnippets(scanned)];
  const declared: (DeclaredLayout & { opening: { start: number; end: number } })[] = [];
  for (const match of scanned.matchAll(layoutOpening)) {
    const start = match.index ?? 0;
    const [whole, props] = match;
    if (props.trimEnd().endsWith('/')) continue; // left to pageLayouts, which names its fix
    const given = new Map<string, string>();
    let rest = props;
    let problem: string | undefined;
    while (rest.trim() && !problem) {
      const prop = layoutProp.exec(rest);
      if (!prop) problem = `${whole} is no layout: ${layoutAdvice}.`;
      else if (prop[1] !== 'name' && prop[1] !== 'of')
        problem = `A <Layout> takes only name and of, the state it reads: ${prop[1]} is no prop of a layout.`;
      else if (prop[4] !== undefined)
        problem = `A <Layout>'s ${prop[1]} is written as it is, not computed, as of="values, lo": every layout's inputs are known before the algorithm runs.`;
      else {
        given.set(prop[1], (prop[2] ?? prop[3]).trim());
        rest = rest.slice(prop[0].length);
      }
    }
    if (problem) {
      problems.push({ message: problem, start });
      continue;
    }
    const layoutName = given.get('name') ?? '';
    if (!name.test(layoutName)) continue; // left to pageLayouts, which names its fix
    if (reserved.has(layoutName)) {
      problems.push({
        message: `${layoutName} names a component of the library; name the layout after the arrangement, as <Layout name="Board">.`,
        start
      });
      continue;
    }
    const inputs: DeclaredLayout['inputs'] = {
      variables: [],
      labels: [],
      ...(given.has('of') ? {} : { inferred: true })
    };
    for (const input of (given.get('of') ?? '')
      .split(',')
      .map((each) => each.trim())
      .filter(Boolean)) {
      if (label.test(input)) inputs.labels.push(input.slice(1));
      else if (name.test(input)) inputs.variables.push(input);
      else
        problems.push({
          message: `of="${given.get('of')}" names ${input}, no variable or label: a layout's inputs are variables, as values, and labels, as @insert.compare, separated by commas.`,
          start
        });
    }
    const closing = scanned.indexOf('</Layout', start + whole.length);
    const end = closing < 0 ? scanned.length : closing;
    declared.push({
      name: layoutName,
      inputs,
      part: false,
      start,
      opening: { start, end: start + whole.length },
      body: { start: start + whole.length, end }
    });
  }
  const byName = new Map<string, (typeof declared)[number]>();
  for (const layout of declared)
    if (byName.has(layout.name))
      problems.push({
        message: `Two layouts are named ${layout.name}; each layout's name is its kind, so give each its own.`,
        start: layout.start
      });
    else byName.set(layout.name, layout);
  // Labels are global, so a layout reads every label its body names, and those of the layouts it
  // draws, whether or not its of lists them.
  const named = new Map(
    declared.map((layout) => {
      const body = scanned.slice(layout.body.start, layout.body.end);
      const labels = [...body.matchAll(labelReference)]
        .map((match) => match[1])
        .filter((path) => !svelteTags.has(path.split('.')[0]));
      const drawn = [...byName.keys()].filter((other) =>
        new RegExp(`<${other.replace('$', '\\$')}\\b`, 'u').test(body)
      );
      return [layout.name, { labels, drawn }];
    })
  );
  const readLabels = (layoutName: string, seen = new Set<string>()): string[] => {
    if (seen.has(layoutName)) return [];
    seen.add(layoutName);
    const own = named.get(layoutName);
    return own ? [...own.labels, ...own.drawn.flatMap((other) => readLabels(other, seen))] : [];
  };
  // With no of, a layout reads the names its body uses, and those of the layouts it draws.
  const readNames = (layoutName: string, seen = new Set<string>()): string[] => {
    if (seen.has(layoutName)) return [];
    seen.add(layoutName);
    const layout = byName.get(layoutName);
    if (!layout) return [];
    return [
      ...namesUsed(scanned.slice(layout.body.start, layout.body.end)),
      ...(named.get(layoutName)?.drawn ?? []).flatMap((other) => readNames(other, seen))
    ];
  };
  for (const layout of declared) {
    layout.inputs.labels = [...new Set([...layout.inputs.labels, ...readLabels(layout.name)])];
    if (layout.inputs.inferred)
      layout.inputs.variables = [...new Set(readNames(layout.name))].filter(
        (each) => !byName.has(each)
      );
  }
  const views = [...scanned.matchAll(/<View\b[\s\S]*?<\/View\s*>/gu)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));
  const storyboard = writtenStoryboard(
    scanned,
    new Map([...byName].map(([each, layout]) => [each, layout.inputs]))
  );
  problems.push(...storyboard.problems);
  const unshown: Problem[] = storyboard.missing ? [storyboard.missing] : [];
  const containing = (at: number) => declared.find(({ body }) => at >= body.start && at < body.end);
  const edits: { start: number; length: number; text: string }[] = [
    ...mathsEdits,
    ...drawings.edits
  ];
  const renders = new Map<string, Set<string>>();
  const tags = new RegExp(
    `<(${[...byName.keys()].map((each) => each.replace('$', '\\$')).join('|') || '(?!)'})\\b((?:[^>{"']|"[^"]*"|'[^']*'|\\{[^}]*\\})*)>`,
    'gu'
  );
  for (const match of scanned.matchAll(tags)) {
    const start = match.index ?? 0;
    const [whole, tagged, props] = match;
    const layout = byName.get(tagged)!;
    const around = containing(start);
    // Outside views, left as written for pageLayouts, which names what the top level holds.
    if (!around) {
      if (views.some((view) => start > view.start && start < view.end))
        problems.push({
          message: `<${tagged} … /> draws a layout, which reads the algorithm's state, and a view reads only its value, this: draw the layout in another layout, beside the value.`,
          start
        });
      continue;
    }
    if (!props.trimEnd().endsWith('/')) {
      problems.push({
        message: `<${tagged}> holds nothing: a layout's tag passes its inputs and draws the layout, so close it at once, as <${tagged} ${layout.inputs.variables.map((input) => `${input}={${input}}`).join(' ')} />.`,
        start
      });
      continue;
    }
    const passed = new Map<string, string>();
    let rest = props.trimEnd().slice(0, -1);
    let problem: string | undefined;
    while (rest.trim() && !problem) {
      const prop = tagProp.exec(rest);
      if (!prop)
        problem = `${whole} passes its inputs as name={value}, as <${tagged} ${layout.inputs.variables.map((input) => `${input}={${input}}`).join(' ')} />.`;
      else if (passed.has(prop[1])) problem = `${whole} passes ${prop[1]} twice.`;
      else {
        passed.set(prop[1], prop[2].trim());
        rest = rest.slice(prop[0].length);
      }
    }
    for (const [input, value] of passed) {
      if (problem) break;
      if (!layout.inputs.variables.includes(input))
        problem = `${tagged} has no input ${input}: it reads ${[...layout.inputs.variables, ...layout.inputs.labels.map((each) => `@${each}`)].join(', ') || 'nothing of the state'}.`;
      else if (value !== input)
        problem = `${input}={${value}} passes ${input} another value: an input is passed as the state of its own name, as ${input}={${input}}, so it keeps its places and pointers.`;
      else if (!around.inputs.inferred && !around.inputs.variables.includes(input))
        problem = `${around.name} passes ${input} to ${tagged} without reading it: add ${input} to ${around.name}'s inputs, of="${[...around.inputs.variables, input].join(', ')}".`;
    }
    if (problem) {
      problems.push({ message: problem, start });
      continue;
    }
    layout.part = true;
    renders.set(around.name, (renders.get(around.name) ?? new Set()).add(tagged));
    edits.push({ start, length: whole.length, text: `{@render ${tagged}()}` });
  }
  // A layout drawn inside itself, directly or through others, would draw without end.
  const cycle = (from: string, seen: string[] = []): string[] | undefined => {
    if (seen.includes(from)) return [...seen, from];
    for (const next of renders.get(from) ?? []) {
      const found = cycle(next, [...seen, from]);
      if (found) return found;
    }
    return undefined;
  };
  for (const layout of declared) {
    const found = cycle(layout.name);
    if (found && found[0] === layout.name)
      problems.push({
        message: `${found.join(' renders ')}: a layout drawn inside itself would draw without end.`,
        start: layout.start
      });
  }
  // A layout a scene shows arranges the whole page, so no other layout draws it.
  const shown = new Set(storyboard.scenes.map(({ layout }) => layout));
  if (storyboard.range)
    for (const layout of declared)
      if (layout.part && shown.has(layout.name))
        problems.push({
          message: `${layout.name} is shown by a scene, so it arranges the whole page, and is drawn inside another layout too: show it by scenes only, or draw it by tags only.`,
          start: layout.start
        });
  if (storyboard.range)
    edits.push({
      start: storyboard.range.start,
      length: storyboard.range.end - storyboard.range.start,
      text: blank(scanned.slice(storyboard.range.start, storyboard.range.end))
    });
  for (const layout of declared) {
    const { opening } = layout;
    if (layout.part) {
      edits.push({
        start: opening.start,
        length: opening.end - opening.start,
        text: `{#snippet ${layout.name}()}`
      });
      const closing = /^<\/Layout\s*>/u.exec(scanned.slice(layout.body.end));
      if (closing)
        edits.push({ start: layout.body.end, length: closing[0].length, text: '{/snippet}' });
    } else {
      // A page keeps its opening as pageLayouts reads it, its inputs blanked.
      const written = source.slice(opening.start, opening.end);
      edits.push({
        start: opening.start,
        length: written.length,
        text: written.replace(/\s+of\s*=\s*("[^"]*"|'[^']*')/u, (of) => blank(of))
      });
    }
  }
  // A node shown only at a label's steps, <Node when="@scan.found">, is <When> around it, and
  // keeps its room elsewhere; a stack of such nodes takes turns in one place, as <OneOf> did.
  const nodeOpening = /<Node\b((?:[^>{"']|"[^"]*"|'[^']*'|\{[^}]*\})*)>/gu;
  for (const match of scanned.matchAll(nodeOpening)) {
    const [opening, props] = match;
    const when = /\swhen\s*=\s*("([^"]*)"|'([^']*)'|\{[^}]*\})/u.exec(props);
    if (!when) continue;
    const start = match.index ?? 0;
    const shownAt = when[2] ?? when[3];
    if (shownAt === undefined) {
      problems.push({
        message: `when takes a label or a stop of the case, written as text, as when="@scan.found": ${when[1]} is computed. To choose by the state, write {#if …} around the node; to show it where an outcome happens, give that outcome a label and name it.`,
        start
      });
      continue;
    }
    const bare = opening.replace(when[0], '');
    if (props.trimEnd().endsWith('/')) {
      edits.push({ start, length: opening.length, text: `<When of="${shownAt}">${bare}</When>` });
      continue;
    }
    // Its closing tag, past the nodes inside it.
    let depth = 1;
    let at = start + opening.length;
    const tags = /<Node\b((?:[^>{"']|"[^"]*"|'[^']*'|\{[^}]*\})*)>|<\/Node\s*>/gu;
    tags.lastIndex = at;
    let closing: RegExpExecArray | null = null;
    for (let tag = tags.exec(scanned); tag; tag = tags.exec(scanned)) {
      if (tag[0].startsWith('</')) depth--;
      else if (!tag[1].trimEnd().endsWith('/')) depth++;
      if (depth === 0) {
        closing = tag;
        break;
      }
      at = tags.lastIndex;
    }
    if (!closing) continue; // left to Svelte, which names the unclosed node
    edits.push({ start, length: opening.length, text: `<When of="${shownAt}">${bare}` });
    edits.push({ start: closing.index, length: closing[0].length, text: `${closing[0]}</When>` });
  }
  // A token in a caption's text, $name[text], refers to the place @name as a listing's token does
  // (see listing/places.ts), and is drawn as inline code: a node of kind Code linked to that place.
  const captions = captionTokens(scanned);
  for (const token of captions) {
    edits.push({
      start: token.start,
      length: token.open,
      text: `<Node kind="Code" __code="@${token.place}">`
    });
    edits.push({ start: token.end, length: 1, text: '</Node>' });
  }
  for (const match of scanned.matchAll(/\b__code\b/gu))
    problems.push({
      message:
        '__code is reserved for the library: write a token in the text, as $i[A[i]], to refer to the place @i.',
      start: match.index ?? 0
    });
  for (const match of scanned.matchAll(/\b__math(?:Text)?\b/gu))
    problems.push({
      message: `${match[0]} is reserved for the library: write inline maths in the text, as $$O(n \\log n)$$.`,
      start: match.index ?? 0
    });
  edits.sort((a, b) => b.start - a.start);
  let rewritten = source;
  for (const { start, length, text } of edits)
    rewritten =
      rewritten.slice(0, start) +
      fitted(text, rewritten.slice(start, start + length)) +
      rewritten.slice(start + length);
  // Each rewrite longer than written: on its line, where it ends as rewritten and what it adds.
  const shifts: ColumnShift[] = [];
  const longer = edits
    .filter(({ text, length }) => text.length > length)
    .sort((a, c) => a.start - c.start);
  for (const { start, length, text } of longer) {
    const line = source.slice(0, start).split('\n').length;
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const before = shifts
      .filter((shift) => shift.line === line)
      .reduce((total, shift) => total + shift.added, 0);
    shifts.push({
      line,
      end: start + length - lineStart + before + text.length - length,
      added: text.length - length
    });
  }
  // Offsets after an edit longer than written move by the difference.
  const shift = (at: number) =>
    edits
      .filter(({ start, length, text }) => start < at && text.length > length)
      .reduce((total, { length, text }) => total + text.length - length, 0);
  return {
    source: rewritten,
    layouts: declared.map(({ opening: _, ...layout }) => ({
      ...layout,
      start: layout.start + shift(layout.start),
      body: {
        start: layout.body.start + shift(layout.body.start),
        end: layout.body.end + shift(layout.body.end)
      }
    })),
    problems,
    shifts,
    scenes: storyboard.scenes,
    unshown,
    captions: captions.map(({ place, start }) => ({ place: `@${place}`, start }))
  };
}

type Markup = { type?: string; start?: number; end?: number; children?: unknown[] } & Record<
  string,
  unknown
>;

/**
 * What each layout reads that it does not declare, or declares that is no variable, once the view
 * is parsed: a part as its snippet, a page as its block. Variables are read by name. Labels are
 * global, so a layout reads those its body names without declaring them (see layoutTags).
 */
export function layoutReadProblems(
  top: readonly unknown[],
  layouts: readonly DeclaredLayout[],
  stateNames: readonly string[],
  readsOf: (node: { children?: unknown[] }) => Set<string>,
  pageNameOf: (block: unknown) => string | undefined
): Problem[] {
  const problems: Problem[] = [];
  const variables = new Set(stateNames);
  const byName = new Map(layouts.map((layout) => [layout.name, layout]));
  for (const node of top as Markup[]) {
    const layoutName =
      node.type === 'SnippetBlock'
        ? (node.expression as { name?: string } | undefined)?.name
        : pageNameOf(node);
    const layout = layoutName === undefined ? undefined : byName.get(layoutName);
    if (!layout) continue;
    const start = node.start ?? 0;
    if (layout.inputs.inferred) {
      // With no of, it reads the names its body uses that are the state's; any other the view's
      // own check names where it is written.
      layout.inputs.variables = layout.inputs.variables.filter((each) => variables.has(each));
      continue;
    }
    for (const input of layout.inputs.variables)
      if (!variables.has(input))
        problems.push({
          message: `${layout.name} declares ${input}, which is no variable of the input or algorithm: a layout's inputs are the state it reads.`,
          start
        });
    for (const read of readsOf({ children: node.children }))
      if (variables.has(read) && !layout.inputs.variables.includes(read))
        problems.push({
          message: `${layout.name} reads ${read} without declaring it: a layout reads only its inputs, so add it, of="${[...layout.inputs.variables, read].join(', ')}".`,
          start
        });
  }
  return problems;
}

/**
 * Each token in the markup's text, `$name[text]`, outside tags and braces: where it starts, how long
 * its opening is, where its closing `]` is, and the place it names; its text keeps any `[…]` in it.
 */
function captionTokens(
  scanned: string
): { start: number; open: number; end: number; place: string }[] {
  const tokens: { start: number; open: number; end: number; place: string }[] = [];
  let tag = false;
  let braces = 0;
  for (let at = 0; at < scanned.length; at++) {
    const character = scanned[at];
    if (braces) {
      if (character === '{') braces++;
      else if (character === '}') braces--;
      continue;
    }
    if (character === '{') {
      braces = 1;
      continue;
    }
    if (tag) {
      if (character === '>') tag = false;
      continue;
    }
    if (character === '<') {
      tag = true;
      continue;
    }
    if (character !== '$') continue;
    const opening = /^\$([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\[/u.exec(scanned.slice(at));
    if (!opening) continue;
    let depth = 0;
    let end = -1;
    for (let inner = at + opening[0].length; inner < scanned.length; inner++) {
      if (scanned[inner] === '[') depth++;
      else if (scanned[inner] === ']') {
        if (!depth) {
          end = inner;
          break;
        }
        depth--;
      } else if ('<{\n'.includes(scanned[inner])) break;
    }
    if (end < 0) continue;
    tokens.push({ start: at, open: opening[0].length, end, place: opening[1] });
    at = end;
  }
  return tokens;
}
