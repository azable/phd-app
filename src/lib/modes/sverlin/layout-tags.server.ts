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

import { writtenStoryboard, type Scene } from './storyboard.server';
import type { ColumnShift } from './written-columns';

/** One layout as declared: its name, its inputs, whether a tag renders it, and where it is. */
export type DeclaredLayout = {
  name: string;
  /** The state it reads, variables by name and labels as @insert.compare. */
  inputs: { variables: string[]; labels: string[] };
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
} {
  // Comments and scripts are not markup: read as spaces, nothing in them counts.
  const scanned = source.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>/gu, blank);
  const problems = writtenSnippets(scanned);
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
    const inputs = { variables: [] as string[], labels: [] as string[] };
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
  const edits: { start: number; length: number; text: string }[] = [];
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
    for (const input of layout.inputs.variables)
      if (!problem && !passed.has(input))
        problem = `<${tagged}> declares ${input} among its inputs, and this tag passes none: pass it, as ${input}={${input}}.`;
    for (const [input, value] of passed) {
      if (problem) break;
      if (!layout.inputs.variables.includes(input))
        problem = `${tagged} has no input ${input}: it declares of="${[...layout.inputs.variables, ...layout.inputs.labels.map((each) => `@${each}`)].join(', ')}".`;
      else if (value !== input)
        problem = `${input}={${value}} passes ${input} another value: an input is passed as the state of its own name, as ${input}={${input}}, so it keeps its places and pointers.`;
      else if (!around.inputs.variables.includes(input))
        problem = `${around.name} passes ${input} to ${tagged} without reading it: add ${input} to ${around.name}'s inputs, of="${[...around.inputs.variables, input].join(', ')}".`;
    }
    for (const read of layout.inputs.labels)
      if (
        !problem &&
        !around.inputs.labels.some((each) => read === each || read.startsWith(`${each}.`))
      )
        problem = `${tagged} reads @${read}, which ${around.name} gives it by name: add @${read} to ${around.name}'s inputs.`;
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
  edits.sort((a, b) => b.start - a.start);
  let rewritten = source;
  for (const { start, length, text } of edits)
    rewritten =
      rewritten.slice(0, start) +
      (text.length < length ? text.padEnd(length) : text) +
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
    unshown
  };
}

type Markup = { type?: string; start?: number; end?: number; children?: unknown[] } & Record<
  string,
  unknown
>;

/**
 * What each layout reads that it does not declare, or declares that is no variable, once the view
 * is parsed: a part as its snippet, a page as its block. Variables are read by name; a label, by the
 * references marked in the view (see label-values.ts), is declared by it or a label it is inside,
 * @insert.compare declaring @insert.compare.left.
 */
export function layoutReadProblems(
  top: readonly unknown[],
  layouts: readonly DeclaredLayout[],
  stateNames: readonly string[],
  labelReads: readonly { path: string; start: number }[],
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
    for (const { path, start: at } of labelReads)
      if (
        at >= start &&
        at < (node.end ?? start) &&
        !layout.inputs.labels.some((each) => path === each || path.startsWith(`${each}.`))
      )
        problems.push({
          message: `${layout.name} reads @${path} without declaring it: a layout reads only its inputs, so add @${path.split('.').slice(0, -1).join('.') || path} or @${path} to its of.`,
          start: at
        });
  }
  return problems;
}
