/**
 * Labels read in the view's markup (labels as values): `@swap.a` is the value the expression
 * labelled `swap.a` gave in a step's own code; `runs(@check.at)` every value it has given so far;
 * `applied(Equal, @inner)` every application of `Equal` made inside `@inner` so far; and
 * `{@render Greater(@inner)}` the application a step's own code made inside `@inner`; and
 * `<When of="@swap">…</When>` draws its contents at the steps inside a run of `@swap`, and
 * `<OneOf><When of="@compare">…</When><When of="@swap">…</When></OneOf>` each branch at its label's
 * steps, taking turns in one place; `of="start"` and `of="end"` name the first step, the input as
 * given, and the last. Beside them, `all(Node)` is every live node of a record a reference refers
 * to, its heap.
 *
 * Before Svelte parses the markup, each is rewritten no longer than it is, so every offset holds: a
 * <When> as `{#if when(@swap)}` and `{/if}`, a <OneOf>'s later branches as `{:else` and `if
 * when(@b)}` in place of the tags between them (see whenTags); then `@swap.a` as `ℓswapˑa`,
 * `runs(@check.at)` as `ϟcheckˑat` and spaces, `applied(Equal, @inner)` as `ǂEqualˑˑinner` and
 * spaces, `all(Node)` as `ȟNode` and spaces, and `when(@swap)` as `ʬswap` and spaces. The page is
 * given each as a prop of that name.
 */

import { spanOf } from './algorithm/parse.server';
import { heapKey, isHeapKey } from './algorithm/structures.server';
import type { Label } from './algorithm/labels.server';

const label = 'ℓ';
const runs = 'ϟ';
const history = 'ǂ';
const during = 'ʬ';
const dot = 'ˑ';

/**
 * A label read in the markup, a label's values so far, an operator's applications so far, or a
 * label whose runs an {#if when(…)} draws its contents in (none where `when()` names no label).
 */
export type LabelReference =
  | { kind: 'value'; key: string; path: string; start: number }
  | { kind: 'runs'; key: string; path: string; start: number }
  | { kind: 'applied'; key: string; operator: string; path?: string; start: number }
  | { kind: 'during'; key: string; path?: string; moment?: Moment; start: number };

/** The steps an {#if when(…)} can name besides a label's runs: the first, the input as given, and the last. */
export type Moment = 'start' | 'end';
/** What an {#if when(…)} naming a moment draws in, as a label's full name never is. */
export const momentTarget = (moment: Moment): string => `#${moment}`;

export const labelKey = (path: string): string => `${label}${path.replaceAll('.', dot)}`;
export const isLabelKey = (name: string): boolean => name.startsWith(label);
export const isRunsKey = (name: string): boolean => name.startsWith(runs);
export const isHistoryKey = (name: string): boolean => name.startsWith(history);
export const isDuringKey = (name: string): boolean => name.startsWith(during);
/** A key as its author wrote it, for messages: a <When>'s as its `of`. */
export function written(name: string): string {
  if (isDuringKey(name) && name[1] === dot) return name.slice(2);
  if (isLabelKey(name) || isDuringKey(name)) return `@${name.slice(1).replaceAll(dot, '.')}`;
  if (isRunsKey(name)) return `runs(@${name.slice(1).replaceAll(dot, '.')})`;
  if (isHistoryKey(name)) {
    const [operator, path] = name.slice(1).split(dot + dot);
    return `applied(${operator}${path ? `, @${path.replaceAll(dot, '.')}` : ''})`;
  }
  if (isHeapKey(name)) return `all(${name.slice(1)})`;
  return name.replaceAll(viewThis, 'this');
}

const path = /^@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/u;
const runsCall = /^runs\(\s*@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)/u;
const allCall = /^all\(\s*([A-Za-z_$][\w$]*)\s*\)/u;
const appliedCall =
  /^applied\(\s*([A-Za-z_$][\w$]*)\s*(?:,\s*@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*)?\)/u;
const whenCall = /^when\(\s*(?:@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)|(start|end))\s*\)/u;

/** Each <When>, <OneOf>, and their closings, and any when( written, which only the tags make. */
const whenTag = /<(\/?)(When|OneOf)\b([^>]*)>|\bwhen\(/gu;
const whenOf = /^\s+of="(@[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|start|end)"\s*$/u;
const tagsAdvice =
  'write <When of="@insert.swap">…</When>, drawing its contents at each step inside a run of the label, or of="start" or of="end", and branches taking turns in one place as <OneOf><When of="@a">…</When><When of="@b">…</When></OneOf>';

/**
 * The markup with each <When> as `{#if when(…)}…{/if}` and each <OneOf> as a chain of them, no
 * longer than as written and every line in place: a later branch's opening becomes `if when(…)}`
 * and the closing before it `{:else`, which Svelte reads as one `{:else if when(…)}` across the
 * spaces between them, as a <OneOf> holds only its branches. The problems: a when() written, and a
 * tag written otherwise or left unpaired.
 */
export function whenTags(source: string): {
  source: string;
  problems: { message: string; start: number }[];
} {
  const problems: { message: string; start: number }[] = [];
  const edits = new Map<number, { length: number; text: string }>();
  const edit = (start: number, length: number, text: string) =>
    edits.set(start, { length, text: text.padEnd(length) });
  type Open =
    | { kind: 'When'; start: number; oneOf?: Extract<Open, { kind: 'OneOf' }> }
    | { kind: 'OneOf'; start: number; branches: number; after: number; closed?: number };
  const open: Open[] = [];
  // Only spaces between a <OneOf>'s branches, as each takes the place in turn.
  const between = (oneOf: Extract<Open, { kind: 'OneOf' }>, until: number) => {
    if (source.slice(oneOf.after, until).trim())
      problems.push({
        message: `A <OneOf> holds only its <When> branches, side by side, which take turns in one place; put anything else inside a branch or beside the <OneOf>.`,
        start: oneOf.after
      });
  };
  for (const match of source.matchAll(whenTag)) {
    const start = match.index ?? 0;
    const [whole, closing, kind, props] = match;
    if (whole === 'when(') {
      problems.push({ message: `when() is not written in a view: ${tagsAdvice}.`, start });
      continue;
    }
    const parent = open.at(-1);
    if (kind === 'OneOf' && !closing) {
      if (props.trim())
        problems.push({ message: '<OneOf> takes no props: it holds its <When> branches.', start });
      open.push({ kind: 'OneOf', start, branches: 0, after: start + whole.length });
      edit(start, whole.length, '');
      continue;
    }
    if (kind === 'When' && !closing) {
      const of = whenOf.exec(props)?.[1];
      if (!of || props.trimEnd().endsWith('/')) {
        problems.push({
          message: `${whole} is no <When>: ${props.trimEnd().endsWith('/') ? 'it holds what it draws, so close it with </When>, as' : ''} ${tagsAdvice}.`,
          start
        });
        continue;
      }
      const oneOf = parent?.kind === 'OneOf' ? parent : undefined;
      if (oneOf && oneOf.branches > 0 && oneOf.closed !== undefined) {
        between(oneOf, start);
        // The branch before closes with {:else, and this one opens with if when(…)}.
        edit(oneOf.closed, '</When>'.length, '{:else');
        edit(start, whole.length, `if when(${of})}`);
      } else {
        if (oneOf) between(oneOf, start);
        edit(start, whole.length, `{#if when(${of})}`);
      }
      if (oneOf) oneOf.branches++;
      open.push({ kind: 'When', start, ...(oneOf ? { oneOf } : {}) });
      continue;
    }
    const top = open.pop();
    if (!top || top.kind !== kind) {
      problems.push({
        message: `This </${kind}> closes ${top ? `the <${top.kind}> opened before it` : `no <${kind}>`}: close each tag in the order it opened.`,
        start
      });
      if (top) open.push(top);
      continue;
    }
    if (top.kind === 'When') {
      edit(start, whole.length, '{/if}');
      if (top.oneOf) {
        top.oneOf.closed = start;
        top.oneOf.after = start + whole.length;
      }
      continue;
    }
    if (!top.branches)
      problems.push({ message: `A <OneOf> holds its <When> branches: ${tagsAdvice}.`, start });
    between(top, start);
    edit(start, whole.length, '');
  }
  for (const { kind, start } of open)
    problems.push({ message: `The <${kind}> is never closed: close it with </${kind}>.`, start });
  let out = '';
  let at = 0;
  for (const [start, { length, text }] of [...edits].sort(([a], [b]) => a - b)) {
    out += source.slice(at, start) + text;
    at = start + length;
  }
  return { source: out + source.slice(at), problems };
}

/**
 * The markup with each label reference rewritten as an identifier of the same length, and the
 * references. Only inside `{…}` and outside strings; `{@render …}` and the other tags are no labels.
 */
export function markLabels(source: string): {
  source: string;
  references: LabelReference[];
  heaps: { record: string; start: number }[];
} {
  const references: LabelReference[] = [];
  const heaps: { record: string; start: number }[] = [];
  let out = '';
  let depth = 0;
  let quote: string | undefined;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (depth > 0 && quote) {
      if (char === '\\') {
        out += char + (source[index + 1] ?? '');
        index++;
        continue;
      }
      if (char === quote) quote = undefined;
      out += char;
      continue;
    }
    if (depth > 0 && (char === '"' || char === "'" || char === '`')) {
      quote = char;
      out += char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && depth > 0) depth--;
    else if (depth > 0) {
      const rest = source.slice(index);
      const before = source.slice(0, index).trimEnd().at(-1);
      const word = /[\w$]/u.test(source[index - 1] ?? '');
      const pad = (text: string, length: number) => text + ' '.repeat(length - text.length);
      const ran = !word ? runsCall.exec(rest) : null;
      if (ran) {
        const key = `${runs}${ran[1].replaceAll('.', dot)}`;
        references.push({ kind: 'runs', key, path: ran[1], start: index });
        out += pad(key, ran[0].length);
        index += ran[0].length - 1;
        continue;
      }
      // when(@swap), the test of an {#if} drawing its contents in the label's runs, or when(start) or
      // when(end) at the first or last step; one naming neither is kept as written, refused when compiled.
      const within = !word && rest.startsWith('when(') ? whenCall.exec(rest) : null;
      if (within) {
        const moment = within[2] as Moment | undefined;
        const key = moment
          ? `${during}${dot}${moment}`
          : `${during}${within[1].replaceAll('.', dot)}`;
        references.push(
          moment
            ? { kind: 'during', key, moment, start: index }
            : { kind: 'during', key, path: within[1], start: index }
        );
        out += pad(key, within[0].length);
        index += within[0].length - 1;
        continue;
      }
      if (!word && rest.startsWith('when('))
        references.push({ kind: 'during', key: '', start: index });
      const every = !word ? allCall.exec(rest) : null;
      if (every) {
        heaps.push({ record: every[1], start: index });
        out += pad(heapKey(every[1]), every[0].length);
        index += every[0].length - 1;
        continue;
      }
      const made = !word ? appliedCall.exec(rest) : null;
      if (made) {
        const key = `${history}${made[1]}${made[2] ? dot + dot + made[2].replaceAll('.', dot) : ''}`;
        references.push({
          kind: 'applied',
          key,
          operator: made[1],
          ...(made[2] ? { path: made[2] } : {}),
          start: index
        });
        out += pad(key, made[0].length);
        index += made[0].length - 1;
        continue;
      }
      // A Svelte tag opens with {@, as {@render …}; anything else after {@ is a label: an
      // attribute's value, as from={@a}, or a value drawn in text, as {@swap.from} (see
      // implicit-renders.server.ts).
      const svelteTag = before === '{' && /^@(?:render|html|const|debug|attach)\b/u.test(rest);
      const read = char === '@' && !svelteTag && !word ? path.exec(rest) : null;
      if (read) {
        const key = labelKey(read[1]);
        references.push({ kind: 'value', key, path: read[1], start: index });
        out += key;
        index += read[0].length - 1;
        continue;
      }
    }
    out += char;
  }
  return { source: out, references, heaps };
}

/** Where a label's code is in the algorithm block's body, for applications made inside it. */
export function labelSpan({ nodes }: Label): { start: number; end: number } {
  return { start: spanOf(nodes[0]).start, end: spanOf(nodes[nodes.length - 1]).end };
}

/**
 * The label a written path names: the one whose full name it is, the names of the labels around it
 * first, so adding a label never changes what a path names. Problems give the full names a shorter
 * path could stand for, or the fix for a label on code that is no expression.
 */
export function resolveLabel(
  written: string,
  labels: readonly Label[],
  asValue: boolean
): { label: Label } | { problem: string } {
  const found = labels.find(({ full }) => full === written);
  if (!found) {
    const ending = labels.filter(({ full }) => full.endsWith(`.${written}`));
    return {
      problem: ending.length
        ? `@${written} is not a full name; write its full name, ${ending.map(({ full }) => `@${full}`).join(' or ')}.`
        : `@${written} names no label of the algorithm${labels.length ? `; its labels are ${labels.map(({ full }) => `@${full}`).join(', ')}` : ''}.`
    };
  }
  if (asValue && (found.statement || found.nodes.length !== 1))
    return {
      problem: `@${found.full} labels a statement, which gives no value; label its expression, as const key = @${found.name}[values[i]].`
    };
  return { label: found };
}

/** What a view's `this` becomes before Svelte parses it: a name of the same length, so every offset holds. */
export const viewThis = 'þhis';

/**
 * A view's value is `this`: `{#snippet Card(this: Vertex)}<Node>{this.name}</Node>{/snippet}`.
 * JavaScript takes no parameter named this, so each `this` in a typed snippet's parameter and in the
 * expressions of its markup becomes `þhis`, no longer than written; a `this` read anywhere else, in
 * a part of the page or the root, is a problem, as only a view has a value.
 */
export function viewThisValues(source: string): {
  source: string;
  problems: { message: string; start: number }[];
} {
  const problems: { message: string; start: number }[] = [];
  // HTML comments are not markup: they are read as spaces, so nothing in them counts.
  const scanned = source.replace(/<!--[\s\S]*?-->/gu, (comment) => ' '.repeat(comment.length));
  // Work on UTF-16 offsets: edits replace `this` with `þhis`, both four code units.
  let text = source;
  const replaceAt = (at: number) => {
    text = text.slice(0, at) + viewThis + text.slice(at + 4);
  };
  const typed = /\{#snippet\s+[A-Za-z_$][\w$]*\(\s*this\s*:/gu;
  const views: { start: number; end: number }[] = [];
  for (const match of scanned.matchAll(typed)) {
    const start = match.index ?? 0;
    replaceAt(start + match[0].lastIndexOf('this'));
    // The snippet's body runs to its own {/snippet}, nested snippets inside counted.
    const tags = /\{#snippet\b|\{\/snippet\}/gu;
    tags.lastIndex = start + match[0].length;
    let depth = 1;
    let end = scanned.length;
    for (const tag of scanned.matchAll(tags)) {
      if ((tag.index ?? 0) < tags.lastIndex) continue;
      depth += tag[0] === '{/snippet}' ? -1 : 1;
      if (!depth) {
        end = tag.index ?? scanned.length;
        break;
      }
    }
    views.push({ start: start + match[0].length, end });
  }
  // Each `this` inside braces: a view's becomes its value; any other is a problem.
  const reads = /(?<![\w$.:'"`])this(?![\w$'"`])/gu;
  let depth = 0;
  for (let at = 0; at < scanned.length; at++) {
    const char = scanned[at];
    if (char === '{') depth++;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (depth > 0 && char === 't' && scanned.startsWith('this', at)) {
      reads.lastIndex = at;
      const read = reads.exec(scanned);
      if (!read || read.index !== at) continue;
      if (
        /\(\s*$/u.test(scanned.slice(Math.max(0, at - 40), at)) &&
        /^this\s*:/u.test(scanned.slice(at))
      )
        continue; // a typed snippet's parameter, rewritten above
      if (views.some(({ start, end }) => start <= at && at < end)) replaceAt(at);
      else
        problems.push({
          message:
            'this is the value a view draws, and only a view has one: read it inside a view, as {#snippet Card(this: Vertex)}<Node>{this.name}</Node>{/snippet}, and in a part of the page or the root read the variable itself.',
          start: at
        });
      at += 3;
    }
  }
  return { source: text, problems };
}
