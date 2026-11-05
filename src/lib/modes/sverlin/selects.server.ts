/**
 * Queries, `<Select name="stack" from="@sort" where="started <= now and now < ended" max="4" />`:
 * each a list of the records of a label's spans (see SpanRecord), filtered by a condition in SQL's
 * words, in an order, perhaps in groups, given at every step as a variable the scenes pass to
 * layouts. A record holds the variables in scope at its span's latest stop so far, its :before while
 * it goes on and its :after once it has ended. `now` is the stop of the step. Selects are read from
 * the text before Svelte sees the view, and then blanked.
 */

import type { MasterStep, SpanRecord } from './algorithm/interpret.server';
import type { DomainRegistry } from './algorithm/structures.server';

/** One query as written. */
export type WrittenSelect = {
  name: string;
  /** The label whose spans it reads, by full name, without its @. */
  from: string;
  where?: Condition;
  order: { field: string; descending: boolean }[];
  group?: string;
  max: number;
  start: number;
  end: number;
};

type Problem = { message: string; start: number };

/** How a query is written, for messages. */
export const selectAdvice =
  'a query is written <Select name="stack" from="@sort" where="started <= now and now < ended" order="depth" max="4" />, naming the label whose spans it reads, and a scene gives its result to a layout as any input, as <Stack stack={stack} />';

const selectName = /^[A-Za-z_$][\w$]*$/u;
const attribute = /^\s*([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{[^}]*\}))/u;
const known = new Set(['name', 'from', 'where', 'order', 'group', 'max']);

/** The queries written in a whole source, its comments and scripts not counting. */
export function selectsOf(source: string): {
  selects: WrittenSelect[];
  problems: Problem[];
  tags: { start: number; end: number }[];
} {
  const scanned = source.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>/gu, (text) =>
    text.replace(/[^\n]/gu, ' ')
  );
  const selects: WrittenSelect[] = [];
  const problems: Problem[] = [];
  const tags: { start: number; end: number }[] = [];
  for (const match of scanned.matchAll(/<Select\b/gu)) {
    const start = match.index ?? 0;
    const closing = scanned.indexOf('/>', start);
    const end = closing < 0 ? start + '<Select'.length : closing + 2;
    tags.push({ start, end });
    const problem = (message: string) => problems.push({ message, start });
    if (closing < 0) {
      problem(`A <Select> closes itself, as <Select … />: ${selectAdvice}.`);
      continue;
    }
    const given = new Map<string, string>();
    let rest = scanned.slice(start + '<Select'.length, closing);
    let bad: string | undefined;
    while (rest.trim() && !bad) {
      const found = attribute.exec(rest);
      if (!found) bad = `<Select> is written with attributes in quotes: ${selectAdvice}.`;
      else if (!known.has(found[1]))
        bad = `A <Select> takes name, from, where, order, group and max: ${found[1]} is none of them.`;
      else if (found[4] !== undefined)
        bad = `A <Select>'s ${found[1]} is written as it is, not computed, as where="ended <= now": every query is known before the algorithm runs.`;
      else {
        given.set(found[1], (found[2] ?? found[3]).trim());
        rest = rest.slice(found[0].length);
      }
    }
    if (bad) {
      problem(bad);
      continue;
    }
    const name = given.get('name') ?? '';
    const from = given.get('from') ?? '';
    if (!selectName.test(name)) {
      problem(`A <Select> needs a name, one word, as name="stack": ${selectAdvice}.`);
      continue;
    }
    if (!/^@[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u.test(from)) {
      problem(`The query ${name} reads the spans of one label, as from="@sort": ${selectAdvice}.`);
      continue;
    }
    const max = Number(given.get('max'));
    if (!Number.isInteger(max) || max < 1) {
      problem(
        `The query ${name} needs a bound on its rows for every input, as max="8": the layout keeps room for that many, so nothing moves as rows come and go.`
      );
      continue;
    }
    const where = given.has('where') ? parseCondition(given.get('where')!) : undefined;
    if (where && 'problem' in where) {
      problem(`In the query ${name}, where="${given.get('where')}": ${where.problem}`);
      continue;
    }
    const order = (given.get('order') ?? '')
      .split(',')
      .map((each) => each.trim())
      .filter(Boolean)
      .map((each) => {
        const [field, way] = each.split(/\s+/u);
        return { field, descending: way?.toLowerCase() === 'desc' };
      });
    if (selects.some((each) => each.name === name)) {
      problem(`Two queries are named ${name}: give each its own name.`);
      continue;
    }
    selects.push({
      name,
      from: from.slice(1),
      ...(where ? { where: where.condition } : {}),
      order,
      ...(given.get('group') ? { group: given.get('group')! } : {}),
      max,
      start,
      end
    });
  }
  return { selects, problems, tags };
}

// ---------------------------------------------------------------------------------------------
// Conditions, in SQL's words and operators.

type Operand =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'name'; path: string[] };
export type Condition =
  | { kind: 'and' | 'or'; left: Condition; right: Condition }
  | { kind: 'not'; operand: Condition }
  | {
      kind: 'compare';
      operator: '=' | '<>' | '<' | '<=' | '>' | '>=';
      left: Operand;
      right: Operand;
    }
  | { kind: 'truth'; operand: Operand };

const javascript: [RegExp, string][] = [
  [/===|==/u, '='],
  [/!==|!=/u, '<>'],
  [/&&/u, 'and'],
  [/\|\|/u, 'or'],
  [/!(?!=)/u, 'not']
];

/** A condition from its text, or what is wrong with it. */
export function parseCondition(text: string): { condition: Condition } | { problem: string } {
  for (const [pattern, word] of javascript)
    if (pattern.test(text))
      return {
        problem: `a query is written in SQL's words, not JavaScript's: write ${word} for ${pattern.exec(text)![0]}, as started <= now and now < ended.`
      };
  const tokens = text.match(
    /\s*(<=|>=|<>|[<>=()]|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|\d+(?:\.\d+)?|'[^']*')/guy
  );
  const joined = (tokens ?? []).join('');
  if (joined.trim() !== text.trim())
    return { problem: `it cannot be read past "${text.slice(joined.length).trim()}".` };
  const list = (tokens ?? []).map((token) => token.trim()).filter(Boolean);
  let at = 0;
  const peek = () => list[at]?.toLowerCase();
  const fail = (message: string): never => {
    throw new Error(message);
  };
  const operand = (): Operand => {
    const token = list[at++];
    if (token === undefined) return fail('it ends where a value should come.');
    if (/^\d/u.test(token)) return { kind: 'number', value: Number(token) };
    if (token.startsWith("'")) return { kind: 'string', value: token.slice(1, -1) };
    if (/^[A-Za-z_$]/u.test(token)) return { kind: 'name', path: token.split('.') };
    return fail(`"${token}" is no value.`);
  };
  const comparison = (): Condition => {
    if (peek() === '(') {
      at++;
      const inner = or();
      if (list[at++] !== ')') fail('a "(" is never closed.');
      return inner;
    }
    const left = operand();
    const operator = list[at];
    if (operator && ['=', '<>', '<', '<=', '>', '>='].includes(operator)) {
      at++;
      return { kind: 'compare', operator: operator as '=', left, right: operand() };
    }
    return { kind: 'truth', operand: left };
  };
  const not = (): Condition => {
    if (peek() === 'not') {
      at++;
      return { kind: 'not', operand: not() };
    }
    return comparison();
  };
  const and = (): Condition => {
    let left = not();
    while (peek() === 'and') {
      at++;
      left = { kind: 'and', left, right: not() };
    }
    return left;
  };
  const or = (): Condition => {
    let left = and();
    while (peek() === 'or') {
      at++;
      left = { kind: 'or', left, right: and() };
    }
    return left;
  };
  try {
    const condition = or();
    if (at < list.length) fail(`"${list[at]}" does not belong where it is.`);
    return { condition };
  } catch (cause) {
    return { problem: (cause as Error).message };
  }
}

// ---------------------------------------------------------------------------------------------
// Rows at each step.

/** A row of a query at a step: the record's fields as of its latest stop, with their types. */
type Row = { record: SpanRecord; state: Record<string, unknown>; types: Record<string, string> };

/** The rows of a query at a step whose stop is `now`, in its order, before any grouping. */
export function rowsAt(select: WrittenSelect, records: readonly SpanRecord[], now: number): Row[] {
  const calls = new Map(records.map((record) => [`${record.label}#${record.ordinal}`, record]));
  const rows = records
    .filter((record) => record.label === select.from && record.started <= now)
    .map((record): Row => {
      const stop = record.ended <= now ? (record.after ?? record.before) : record.before;
      return { record, state: { ...(stop?.state ?? {}) }, types: { ...(stop?.types ?? {}) } };
    });
  const valueOf = (row: Row, operand: Operand): unknown => {
    if (operand.kind !== 'name') return operand.value;
    const [first, second] = operand.path;
    const timing = (record: SpanRecord | undefined, field: string | undefined) =>
      field === 'started'
        ? record?.started
        : field === 'ended'
          ? record?.ended
          : field === 'depth'
            ? record?.depth
            : undefined;
    if (first === 'now') return now;
    if (first === 'call')
      return timing(row.record.call ? calls.get(row.record.call) : undefined, second);
    if (first === 'started' || first === 'ended' || first === 'depth')
      return timing(row.record, first);
    const value = row.state[first];
    return second === undefined ? value : (value as Record<string, unknown> | undefined)?.[second];
  };
  const holds = (row: Row, condition: Condition): boolean => {
    switch (condition.kind) {
      case 'and':
        return holds(row, condition.left) && holds(row, condition.right);
      case 'or':
        return holds(row, condition.left) || holds(row, condition.right);
      case 'not':
        return !holds(row, condition.operand);
      case 'truth':
        return Boolean(valueOf(row, condition.operand));
      case 'compare': {
        const left = valueOf(row, condition.left) as number;
        const right = valueOf(row, condition.right) as number;
        if (left === undefined || right === undefined) return false;
        return {
          '=': left === right,
          '<>': left !== right,
          '<': left < right,
          '<=': left <= right,
          '>': left > right,
          '>=': left >= right
        }[condition.operator];
      }
    }
  };
  const kept = select.where ? rows.filter((row) => holds(row, select.where!)) : rows;
  const key = (row: Row, field: string) => valueOf(row, { kind: 'name', path: field.split('.') });
  return kept.sort((a, b) => {
    for (const { field, descending } of select.order) {
      const left = key(a, field) as number;
      const right = key(b, field) as number;
      if (left !== right) return (left < right ? -1 : 1) * (descending ? -1 : 1);
    }
    return a.record.started - b.record.started;
  });
}

/** The name of a query's list type, its group type, and its groups' rows type. */
export const selectType = (name: string): string => `⁎${name}`;
const groupType = (name: string) => `⁎${name}ˑgroup`;
const rowsType = (name: string) => `⁎${name}ˑrows`;
/** The type of a row's parent: its position in the list, as an index into it. */
const parentType = (name: string) => `⁎${name}ˑparent`;

/** The label's record type, as a view typed by the label names it (see labelApplication). */
const recordType = (label: string) => `ℓ${label.replaceAll('.', 'ˑ')}`;

/** The domain with each query's list types: of the label's records, or of groups of them. */
export function withSelectTypes(
  domain: DomainRegistry,
  selects: readonly WrittenSelect[]
): DomainRegistry {
  if (!selects.length) return domain;
  const structures = { ...domain.structures };
  const atoms = { ...domain.atoms };
  for (const { name, from, group, max } of selects) {
    if (group === undefined) {
      atoms[parentType(name)] = {
        name: parentType(name),
        base: 'integer',
        index: selectType(name),
        min: -1,
        max
      };
      structures[selectType(name)] = {
        kind: 'collection',
        name: selectType(name),
        element: recordType(from),
        max
      };
      continue;
    }
    structures[rowsType(name)] = {
      kind: 'collection',
      name: rowsType(name),
      element: recordType(from),
      max
    };
    structures[groupType(name)] = {
      kind: 'record',
      name: groupType(name),
      fields: { key: '', rows: rowsType(name) }
    };
    structures[selectType(name)] = {
      kind: 'collection',
      name: selectType(name),
      element: groupType(name),
      max
    };
  }
  return { ...domain, atoms, structures };
}

/** Each step with each query's rows at it, as a variable of its name. */
export function withSelectRows(
  steps: readonly MasterStep[],
  records: readonly SpanRecord[],
  selects: readonly WrittenSelect[]
): MasterStep[] {
  if (!selects.length) return [...steps];
  return steps.map((step) => {
    const now = step.stop ?? 0;
    const state = { ...step.state } as Record<string, unknown>;
    const types = { ...step.types } as Record<string, string>;
    const targets = { ...step.targets };
    for (const select of selects) {
      // The bound holds for the list: its rows, or its groups and each group's rows.
      const all = rowsAt(select, records, now);
      const rows = select.group === undefined ? all.slice(0, select.max) : all;
      const element = (row: Row, path: string) => {
        types[path] = recordType(select.from);
        for (const [field, type] of Object.entries(row.types)) types[`${path}.${field}`] = type;
        return row.state;
      };
      types[select.name] = selectType(select.name);
      if (select.group === undefined) {
        // Each row whose call's caller is listed too names it as parent, its position in the list,
        // so a link can join a call to the calls it makes.
        const at = new Map(rows.map((row, k) => [`${row.record.label}#${row.record.ordinal}`, k]));
        state[select.name] = rows.map((row, k) => {
          const path = `${select.name}[${k}]`;
          const fields = element(row, path);
          const parent = row.record.parent === undefined ? undefined : at.get(row.record.parent);
          if (parent === undefined) return fields;
          types[`${path}.parent`] = parentType(select.name);
          targets[`${path}.parent`] = select.name;
          return { ...fields, parent };
        });
        continue;
      }
      const groups: { key: unknown; rows: Row[] }[] = [];
      for (const row of rows) {
        const key = row.record[select.group as 'depth'] ?? row.state[select.group];
        const found = groups.find((each) => each.key === key);
        if (found) found.rows.push(row);
        else groups.push({ key, rows: [row] });
      }
      state[select.name] = groups.slice(0, select.max).map((group, g) => {
        const at = `${select.name}[${g}]`;
        types[at] = groupType(select.name);
        types[`${at}.rows`] = rowsType(select.name);
        return {
          key: group.key,
          rows: group.rows.slice(0, select.max).map((row, k) => element(row, `${at}.rows[${k}]`))
        };
      });
    }
    return {
      ...step,
      state: state as MasterStep['state'],
      types: types as MasterStep['types'],
      ...(Object.keys(targets).length ? { targets } : {})
    };
  });
}

/** The lists scenes step over, and the name each calls its rows, as written in a whole source. */
export function oversOf(source: string): { list: string; item: string }[] {
  const overs: { list: string; item: string }[] = [];
  for (const [tag] of source.matchAll(/<Scene\b(?:[^>{"']|"[^"]*"|'[^']*'|\{[^}]*\})*>/gu)) {
    const list = /\bover\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/u.exec(tag)?.[1];
    const item = /\bas\s*=\s*"([A-Za-z_$][\w$]*)"/u.exec(tag)?.[1];
    if (list && item) overs.push({ list, item });
  }
  return overs;
}

/**
 * A step's state and types with `item` holding row `k` of `list`, its types copied to it; for a list
 * of groups, the group's rows.
 */
function withItem(step: MasterStep, list: string, item: string, k: number): MasterStep {
  const listed = step.state[list] as unknown[] | undefined;
  const grouped = step.types[`${list}[${k}].rows`] !== undefined;
  const rows = grouped ? listed?.map((group) => (group as { rows: unknown[] }).rows) : listed;
  const types = { ...step.types } as Record<string, string>;
  const from = grouped ? `${list}[${k}].rows` : `${list}[${k}]`;
  for (const [path, type] of Object.entries(step.types))
    if (path === from || path.startsWith(`${from}.`) || path.startsWith(`${from}[`))
      types[item + path.slice(from.length)] = type;
  return {
    ...step,
    state: { ...step.state, [item]: rows?.[k] ?? null } as MasterStep['state'],
    types: types as MasterStep['types']
  };
}

/**
 * The steps of a scene over a list: one for each of its rows or groups, as the case ends, each
 * holding the row as `item`. They are no moments of the case, so they show only the list.
 */
export function overSteps(steps: readonly MasterStep[], list: string, item: string): MasterStep[] {
  const last = steps.at(-1);
  const rows = (last?.state[list] as unknown[] | undefined) ?? [];
  if (!last || !rows.length) return last ? [withItem(last, list, item, 0)] : [];
  return rows.map((_, k) => ({
    ...withItem(last, list, item, k),
    name: `${item}#${k + 1}`,
    edge: undefined,
    applied: undefined,
    labelled: undefined,
    held: undefined,
    trail: []
  }));
}

/** The steps with each list a scene steps over typed through its rows, at the last step. */
export function withOverItems(
  steps: readonly MasterStep[],
  overs: readonly { list: string; item: string }[]
): MasterStep[] {
  if (!overs.length || !steps.length) return [...steps];
  let last = steps.at(-1)!;
  for (const { list, item } of overs) last = withItem(last, list, item, 0);
  return [...steps.slice(0, -1), last];
}
