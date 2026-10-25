/**
 * Labels read in the view's markup (labels as values): `@swap.a` is the value the expression
 * labelled `swap.a` gave in a step's own code; `runs(@check.at)` every value it has given so far;
 * `applied(Equal)` every application of `Equal` so far, `applied(Equal, @inner)` those made inside
 * `@inner`; and `{@render Greater(@inner)}` the application a step's own code made inside `@inner`.
 * Beside them, `all(Node)` is every live node of a record a reference refers to, its heap.
 *
 * Before Svelte parses the markup, each is rewritten as an identifier of the same length, so every
 * offset holds: `@swap.a` as `ℓswapˑa`, `runs(@check.at)` as `ϟcheckˑat` and spaces, `applied(Equal,
 * @inner)` as `ǂEqualˑˑinner` and spaces, `all(Node)` as `ȟNode` and spaces. The page is given
 * each as a prop of that name.
 */

import { spanOf } from './algorithm/parse.server';
import { heapKey, isHeapKey } from './algorithm/structures.server';
import type { Label } from './algorithm/labels.server';

const label = 'ℓ';
const runs = 'ϟ';
const history = 'ǂ';
const dot = 'ˑ';

/** A label read in the markup, a label's values so far, or an operator's applications so far. */
export type LabelReference =
  | { kind: 'value'; key: string; path: string; start: number }
  | { kind: 'runs'; key: string; path: string; start: number }
  | { kind: 'applied'; key: string; operator: string; path?: string; start: number };

export const labelKey = (path: string): string => `${label}${path.replaceAll('.', dot)}`;
export const isLabelKey = (name: string): boolean => name.startsWith(label);
export const isRunsKey = (name: string): boolean => name.startsWith(runs);
export const isHistoryKey = (name: string): boolean => name.startsWith(history);
/** A key as its author wrote it, for messages. */
export function written(name: string): string {
  if (isLabelKey(name)) return `@${name.slice(1).replaceAll(dot, '.')}`;
  if (isRunsKey(name)) return `runs(@${name.slice(1).replaceAll(dot, '.')})`;
  if (isHistoryKey(name)) {
    const [operator, path] = name.slice(1).split(dot + dot);
    return `applied(${operator}${path ? `, @${path.replaceAll(dot, '.')}` : ''})`;
  }
  if (isHeapKey(name)) return `all(${name.slice(1)})`;
  return name;
}

const path = /^@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/u;
const runsCall = /^runs\(\s*@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)/u;
const allCall = /^all\(\s*([A-Za-z_$][\w$]*)\s*\)/u;
const appliedCall =
  /^applied\(\s*([A-Za-z_$][\w$]*)\s*(?:,\s*@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*)?\)/u;

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
      const read = char === '@' && before !== '{' && !word ? path.exec(rest) : null;
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
 * The label a written path names: the one whose full name is it, else the one whose full name ends
 * with it. Problems name the labels it could be, or the fix for a label on code that is no
 * expression.
 */
export function resolveLabel(
  written: string,
  labels: readonly Label[],
  asValue: boolean
): { label: Label } | { problem: string } {
  const exact = labels.filter(({ full }) => full === written);
  const candidates = exact.length
    ? exact
    : labels.filter(({ full }) => full.endsWith(`.${written}`));
  if (!candidates.length)
    return {
      problem: `@${written} names no label of the algorithm${labels.length ? `; its labels are ${labels.map(({ full }) => `@${full}`).join(', ')}` : ''}.`
    };
  if (candidates.length > 1)
    return {
      problem: `@${written} could be ${candidates.map(({ full }) => `@${full}`).join(' or ')}; write more of its name.`
    };
  const [found] = candidates;
  if (asValue && (found.statement || found.nodes.length !== 1))
    return {
      problem: `@${found.full} labels a statement, which gives no value; label its expression, as const key = @${found.name}[values[i]].`
    };
  return { label: found };
}
