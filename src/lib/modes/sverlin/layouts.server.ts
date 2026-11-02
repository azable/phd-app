/**
 * Layout blocks, `{#layout Name}…{/layout}`: each an arrangement of the whole page, its body one root
 * <Node>, the frame. Svelte has no such block, so before the view is parsed each becomes
 * `{#if __L.Name}…{/if}`, as long, drawn only where the variant's layout is Name (the prop __L holds
 * it), and its root's tags are blanked, so what the root holds is the page's top level, and every
 * check of the top level holds for it. Every source declares at least one layout.
 */

import type { FrameLayout } from './library/node/props';

/** The prop holding the layout shown, as { Stacked: true }. */
export const layoutProp = '__L';

/** One layout of the page: its name, and its root's row or column and tag, by its offset. */
export type PageLayout = { name: string; direction: FrameLayout; root: number };

type Part = {
  type?: string;
  name?: string;
  start?: number;
  end?: number;
  data?: string;
  expression?: { type?: string; object?: { name?: string }; property?: { name?: string } };
  attributes?: { type?: string; name?: string; start?: number; value?: unknown }[];
  children?: Part[];
  else?: unknown;
};

type Problem = { message: string; start: number };

/** The layout an {#if} stands for, as rewritten, or undefined for any other block. */
export function layoutNameOf(block: unknown): string | undefined {
  const { type, expression } = (block ?? {}) as Part;
  return type === 'IfBlock' &&
    expression?.type === 'MemberExpression' &&
    expression.object?.name === layoutProp
    ? expression.property?.name
    : undefined;
}

/** Where each opening or closing of a layout starts, written well or not. */
const layoutTag = /\{([#/])layout\b/gu;
const wellOpened = /^\{#layout([ \t]+)([A-Za-z_$][\w$]*)([ \t]*)\}/u;
const wellClosed = /^\{\/layout[ \t]*\}/u;

/** What is wrong with an opening that is not {#layout Name}, and its fix. */
function openingProblem(line: string): string {
  const named = /^\{#layout[ \t]+([A-Za-z_$][\w$]*)[ \t]*(>?)/u.exec(line);
  if (named?.[2])
    return `${named[0]} ends with >: close the opening with }, as {#layout ${named[1]}}.`;
  if (named && /^(<|$)/u.test(line.slice(named[0].length)))
    return `${named[0]} is never closed: close the opening with }, as {#layout ${named[1]}}.`;
  const written = /^\{#layout[^}]*\}?/u.exec(line)![0];
  return `${written} is no layout: write {#layout Name}, its name one word naming the arrangement, as {#layout Side}, on one line.`;
}

/**
 * Each layout block as an {#if} of the same length, keeping every offset and line in place; any
 * opening or closing written otherwise, or left unpaired, is a problem naming its fix.
 */
function rewritten(text: string): { text: string; problems: Problem[] } {
  const problems: Problem[] = [];
  const open: { name: string; start: number }[] = [];
  let replaced = text;
  const replace = (start: number, written: string, tag: string) => {
    replaced =
      replaced.slice(0, start) +
      tag.padEnd(written.length) +
      replaced.slice(start + written.length);
  };
  for (const { 1: kind, index: start } of text.matchAll(layoutTag)) {
    const line = text.slice(start).split('\n', 1)[0];
    if (kind === '#') {
      const named = wellOpened.exec(line);
      open.push({ name: named?.[2] ?? 'opened here', start });
      if (!named) {
        problems.push({ message: openingProblem(line), start });
        continue;
      }
      const [whole, before, name, after] = named;
      replace(
        start,
        whole,
        `{#if ${layoutProp}.${name}${' '.repeat(before.length + after.length - 1)}}`
      );
      continue;
    }
    if (!open.pop())
      problems.push({
        message:
          'This {/layout} closes no layout: open each layout with {#layout Name} before its root <Node>, or remove the extra {/layout}.',
        start
      });
    // A close written with an HTML tag's >, as {/layout>, is a slip taken as meant.
    const closed = wellClosed.exec(line) ?? /^\{\/layout[ \t]*>/u.exec(line);
    if (closed) replace(start, closed[0], '{/if}');
    else
      problems.push({
        message: `${/^\{\/layout[ \t]*>?/u.exec(line)![0]} does not close the layout: close the layout with {/layout}.`,
        start
      });
  }
  for (const { name, start } of open)
    problems.push({
      message: `The layout ${name} is never closed: close the layout with {/layout} after its root <Node>.`,
      start
    });
  return { text: replaced, problems };
}

/** Where a tag starting at `from` ends, after its > (quotes and braces skipped). */
function tagEnd(text: string, from: number): number {
  let depth = 0;
  let quote = '';
  for (let at = from + 1; at < text.length; at++) {
    const character = text[at];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '{') depth++;
    else if (character === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (character === '"' || character === "'")) quote = character;
    else if (depth === 0 && character === '>') return at + 1;
  }
  return text.length;
}

const blank = (text: string, from: number, to: number) =>
  text.slice(0, from) + text.slice(from, to).replace(/[^\n]/gu, ' ') + text.slice(to);

const significant = (part: Part) =>
  part.type !== 'Comment' && !(part.type === 'Text' && !part.data?.trim());

/** What the compiler says of a source without layouts. */
export const noLayoutMessage =
  'The view declares no layout: put what the page draws in {#layout Main}<Node>…</Node>{/layout}, one root <Node> holding the parts, and a second layout for another arrangement.';

/**
 * The page's layouts, and the view as Svelte parses it: each layout block an {#if}, its root's tags
 * blanked. `parse` gives the markup's top-level parts, from Svelte's parser. A view without layout
 * blocks has none, which the compiler refuses (see noLayoutMessage), with the view's other problems.
 */
export function pageLayouts(
  text: string,
  parse: (text: string) => Part[]
): { text: string; layouts: PageLayout[]; problems: Problem[] } {
  if (!/\{[#/]layout\b/u.test(text)) return { text, layouts: [], problems: [] };
  const { text: blocks, problems } = rewritten(text);
  // A block left as written would only fail to parse.
  if (problems.length) return { text: blocks, layouts: [], problems };
  const top = parse(blocks);
  let view = blocks;
  const layouts: PageLayout[] = [];
  const names = new Set<string>();
  for (const part of top) {
    const name = layoutNameOf(part);
    if (name === undefined) {
      if (part.type !== 'SnippetBlock' && significant(part))
        problems.push({
          message:
            'With layouts, the top level holds only parts, views, and layouts: render this in a layout, inside its root <Node>, as {#layout Side}<Node layout="row">{@render Board()}{@render Table()}</Node>{/layout}.',
          start: part.start ?? 0
        });
      continue;
    }
    const start = part.start ?? 0;
    if (names.has(name))
      problems.push({
        message: `Two layouts are named ${name}; each layout's name is its kind, so give each its own.`,
        start
      });
    names.add(name);
    if (part.else)
      problems.push({
        message: `A layout has no {:else}: the variant shows one layout at a time, so write another arrangement as a layout of its own, {#layout Other}…{/layout}.`,
        start
      });
    const body = (part.children ?? []).filter(significant);
    const [root] = body;
    if (body.length !== 1 || root.type !== 'InlineComponent' || root.name !== 'Node') {
      problems.push({
        message: `The layout ${name}'s body is one root <Node>, the frame, holding what the page shows, as {#layout ${name}}<Node layout="row">{@render Board()}{@render Table()}</Node>{/layout}; every other part goes inside it.`,
        start: (root ?? part).start ?? start
      });
      continue;
    }
    const rootStart = root.start ?? start;
    let direction: FrameLayout = 'column';
    for (const attribute of root.attributes ?? []) {
      const [value] = Array.isArray(attribute.value) ? (attribute.value as Part[]) : [];
      if (
        attribute.type === 'Attribute' &&
        attribute.name === 'layout' &&
        value?.type === 'Text' &&
        (value.data === 'row' || value.data === 'column')
      )
        direction = value.data;
      else
        problems.push({
          message: `The root <Node> of the layout ${name} is the frame: its only prop is layout, "row" or "column", how it arranges what it holds, and its looks are the layout's, as ${name}.gap. Put a free layout, or anything else, in a node inside it.`,
          start: attribute.start ?? rootStart
        });
    }
    layouts.push({ name, direction, root: rootStart });
    // The root's children are the page's top level; the root itself is the frame.
    const openEnd = tagEnd(blocks, rootStart);
    const end = root.end ?? openEnd;
    const selfClosing = blocks.slice(openEnd - 2, openEnd) === '/>';
    view = blank(view, rootStart, openEnd);
    if (!selfClosing) view = blank(view, blocks.lastIndexOf('</', end - 1), end);
  }
  // A layout inside a block or snippet would arrange only part of the page.
  const nested = (parts: unknown, depth: number): void => {
    if (!parts || typeof parts !== 'object') return;
    if (Array.isArray(parts)) {
      for (const part of parts) nested(part, depth);
      return;
    }
    const part = parts as Part & Record<string, unknown>;
    if (depth > 0 && layoutNameOf(part) !== undefined)
      problems.push({
        message:
          'A layout arranges the whole page, so it is declared at the top level, beside the parts and views, never inside a block, a node, or a snippet.',
        start: part.start ?? 0
      });
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'expression' && key !== 'attributes')
        nested(child, depth + (typeof part.type === 'string' ? 1 : 0));
  };
  for (const part of top) nested(part.children ?? [], 1);
  for (const part of top) nested(part.else, 1);
  return { text: view, layouts, problems };
}
