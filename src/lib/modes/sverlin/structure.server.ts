/**
 * The structure each free layout's data makes, found on the server from the trace, without running
 * the view: the links a free layout draws are read statically from its markup, and followed through
 * the values the trace records at every step.
 *
 * Two kinds of link are read. A <Link from={…} to={…}> in the free layout's node, inside {#each}
 * blocks over the state, as `<Link from={k} to={neighbour} />` in `{#each vertices as v, k}` and
 * `{#each adjacency[k] as neighbour}`: its ends are evaluated from the trace's values, a position
 * standing for the element of the collection it walks or refers into. And a <Link to={…}> with no
 * from in a view of a type, as `<Link to={node.next} />` in a view of a record or `<Link to={value} />`
 * in a view of a reference: every record field it draws joins the record holding it to the element
 * it refers to, wherever the free layout walks those records.
 *
 * Only links present at every step where both their ends exist count, as on the page (see
 * library/node/span.ts), and findStructure classifies them. Links inside {#if} are left out, and a
 * variant may draw no links where the data has them; there the page finds its own structure, and a
 * form it cannot take falls back to that structure's natural one.
 *
 * The same reading, over every node holding links, row and column alike, tells which kinds of link
 * are all two-way lines, as an undirected graph's edges are, whose heads start as none.
 */

import type { MasterStep } from './algorithm/interpret.server';
import type { DomainRegistry } from './algorithm/structures.server';
import { findStructure, type StructureKind } from './library/node/forms';

/** A free layout's structure, or none where its data makes none the layout can take. */
export type LayoutStructure = StructureKind | 'none';

type Node = {
  type?: string;
  start?: number;
  name?: string;
  children?: Node[];
  else?: Node;
  attributes?: { type?: string; name?: string; value?: unknown }[];
  expression?: Expression;
  context?: { type?: string; name?: string };
  index?: string;
  parameters?: { name?: string }[];
};

type Expression = {
  type?: string;
  name?: string;
  value?: unknown;
  computed?: boolean;
  object?: Expression;
  property?: Expression;
  callee?: Expression;
  arguments?: Expression[];
};

/** A value read from the trace, with the path it was read at, or the collection a position walks. */
type Read = { value: unknown; path?: string; walks?: string };

/** An {#each} around a link: what it walks, and the names it binds for an item and its position. */
type Scope = { over: Expression; item?: string; position?: string };

/** The work one source may take, in link ends evaluated, before its structures are given up. */
const evaluationLimit = 200_000;

/** A link a step draws: the <Link> that draws it (its tag, or the field it draws), and its ends. */
type Drawn = { tag: string; from: string; to: string };

const drawnKey = ({ tag, from, to }: Drawn) => `${tag}|${from} -> ${to}`;

/**
 * What the links make: each free layout kind's structure, and the kinds of link every one of whose
 * links is a two-way line, as the page draws one (see library/node/lines.ts): its <Link> joins
 * the same two elements the other way at exactly the same steps. Read from the free layouts' nodes
 * (by kind), every node holding written links (by the kind of those links), the view's components,
 * the state's names, the domain, and the trace's steps.
 */
export function linkFacts(options: {
  free: ReadonlyMap<string, readonly unknown[]>;
  linked: readonly { kind: string; node: unknown }[];
  views: readonly { name: string; type: string; node: unknown }[];
  stateNames: readonly string[];
  domain: DomainRegistry;
  steps: readonly MasterStep[];
}): { structures: Record<string, LayoutStructure>; lines: Set<string> } {
  // Parsed Svelte markup (svelte/compiler's legacy AST), read only for the parts named in Node.
  const fields = linkedFields(
    options.views as readonly { name: string; type: string; node: Node }[],
    options.domain
  );
  const state = new Set(options.stateNames);
  let evaluations = 0;
  // Each link drawn at some step, with the steps it is drawn at; undefined past the work allowed.
  const presence = (nodes: readonly Node[]) => {
    const links = nodes.flatMap((node) => writtenLinks(node.children ?? [], []));
    const walked = new Set(nodes.flatMap((node) => walkedCollections(node.children ?? [], state)));
    const present = new Map<string, { drawn: Drawn; seen: boolean[] }>();
    for (const [index, step] of options.steps.entries()) {
      const drawn: Drawn[] = [];
      for (const { tag, from, to, scopes } of links)
        for (const env of bindings(scopes, new Map(), step, state)) {
          if (++evaluations > evaluationLimit) return undefined;
          const ends = [read(from, env, step, state), read(to, env, step, state)].map((end) =>
            end ? endOf(end, step) : undefined
          );
          if (ends[0] && ends[1]) drawn.push({ tag, from: ends[0], to: ends[1] });
        }
      for (const [path, target] of Object.entries(step.targets ?? {})) {
        const field = /^(.+)\[(\d+)\]\.([A-Za-z_$][\w$]*)$/u.exec(path);
        if (!field || !walked.has(field[1])) continue;
        const record = step.types?.[`${field[1]}[${field[2]}]`];
        const value = valueAt(step.state, path);
        const drawnBy = record ? fields.get(`${record}.${field[3]}`) : undefined;
        if (drawnBy && typeof value === 'number')
          drawn.push({
            tag: `${record}.${field[3]}`,
            from: `${field[1]}[${field[2]}]`,
            to: `${target}[${value}]`
          });
      }
      for (const each of drawn) {
        const key = drawnKey(each);
        const entry = present.get(key) ?? { drawn: each, seen: [] };
        entry.seen[index] = true;
        present.set(key, entry);
      }
    }
    return present;
  };
  // A link is one of a two-way line where its <Link> draws it the other way at the same steps.
  const twoWay = (present: ReadonlyMap<string, { drawn: Drawn; seen: boolean[] }>, key: string) => {
    const { drawn, seen } = present.get(key) as { drawn: Drawn; seen: boolean[] };
    const back = present.get(drawnKey({ ...drawn, from: drawn.to, to: drawn.from }));
    return (
      drawn.from !== drawn.to &&
      !!back &&
      options.steps.every((_, index) => !!seen[index] === !!back.seen[index])
    );
  };

  const structures = Object.fromEntries(
    [...(options.free as ReadonlyMap<string, readonly Node[]>)].map(([kind, nodes]) => {
      const present = presence(nodes);
      if (!present) return [kind, 'none'];
      const lasting = [...present].flatMap(([key, { drawn, seen }]) => {
        const always = options.steps.every(
          (step, index) => seen[index] || !exists(step, drawn.from) || !exists(step, drawn.to)
        );
        return always ? [{ key, ...drawn }] : [];
      });
      const ids = [...new Set(lasting.flatMap(({ from, to }) => [from, to]))].sort(byElement);
      // A link lasting both ways by one <Link> is present at the same steps both ways, as both
      // ends are: one undirected link, as the page draws it.
      const kept = new Set(lasting.map(({ key }) => key));
      const structure = findStructure(
        ids.length,
        lasting.flatMap((link) => {
          const back = drawnKey({ ...link, from: link.to, to: link.from });
          return !kept.has(back)
            ? [{ source: ids.indexOf(link.from), target: ids.indexOf(link.to) }]
            : byElement(link.from, link.to) < 0
              ? [{ source: ids.indexOf(link.from), target: ids.indexOf(link.to), directed: false }]
              : [];
        })
      );
      return [kind, structure?.kind ?? 'none'];
    })
  ) as Record<string, LayoutStructure>;

  // Each kind of link's links, from the nodes holding them and the fields its views draw; a kind
  // with any link drawn one way only, or past the work allowed, is not all lines.
  const kinds = new Map<string, boolean>();
  const note = (kind: string, isLine: boolean) =>
    kinds.set(kind, (kinds.get(kind) ?? true) && isLine);
  for (const { kind, node } of options.linked as readonly { kind: string; node: Node }[]) {
    const present = presence([node]);
    if (!present) {
      note(kind, false);
      continue;
    }
    for (const [key, { drawn }] of present)
      note(fields.get(drawn.tag) ?? kind, twoWay(present, key));
  }
  return {
    structures,
    lines: new Set([...kinds].flatMap(([kind, isLine]) => (isLine ? [kind] : [])))
  };
}

/**
 * The record fields whose references views draw as links with no from, each with the kind of the
 * link drawing it: `<Link to={node.next} />` in a view of a record draws its next field;
 * `<Link to={value} />` in a view of a type draws every record field of that type, or of a union
 * holding it.
 */
function linkedFields(
  views: readonly { name: string; type: string; node: Node }[],
  domain: DomainRegistry
): Map<string, string> {
  const fields = new Map<string, string>();
  const records = Object.values(domain.structures).flatMap((structure) =>
    structure.kind === 'record' ? [structure] : []
  );
  const holds = (declared: string, type: string) => {
    const structure = domain.structures[declared];
    return declared === type || (structure?.kind === 'union' && structure.members.includes(type));
  };
  for (const { name, type, node } of views) {
    const parameter = node.parameters?.[0]?.name;
    const kind = `${name}.Link`;
    for (const to of fromlessEnds(node.children ?? [])) {
      if (to.type === 'Identifier' && to.name === parameter)
        for (const record of records)
          for (const [field, declared] of Object.entries(record.fields))
            if (holds(declared, type)) fields.set(`${record.name}.${field}`, kind);
      if (
        to.type === 'MemberExpression' &&
        !to.computed &&
        to.object?.type === 'Identifier' &&
        to.object.name === parameter &&
        to.property?.type === 'Identifier'
      )
        fields.set(`${type}.${to.property.name}`, kind);
    }
  }
  return fields;
}

const attribute = (node: Node, name: string): Expression | undefined => {
  const value = node.attributes?.find((attribute) => attribute.name === name)?.value;
  const [part] = Array.isArray(value)
    ? (value as { type?: string; expression?: Expression }[])
    : [];
  return part?.type === 'MustacheTag' || part?.type === 'ExpressionTag'
    ? part.expression
    : undefined;
};

const isLink = (node: Node) => node.type === 'InlineComponent' && node.name === 'Link';

/** The to of every <Link> with no from in some markup, {#if} branches included. */
function fromlessEnds(nodes: readonly Node[]): Expression[] {
  return nodes.flatMap((node) => [
    ...(isLink(node) && !attribute(node, 'from') && attribute(node, 'to')
      ? [attribute(node, 'to') as Expression]
      : []),
    ...fromlessEnds(node.children ?? []),
    ...(node.else ? fromlessEnds([node.else]) : [])
  ]);
}

/**
 * Every <Link> with both ends in a free layout's node, with the {#each} blocks around it; one in an
 * {#if}, present only some of the time, or in a snippet defined there, is left out.
 */
function writtenLinks(
  nodes: readonly Node[],
  scopes: readonly Scope[]
): { tag: string; from: Expression; to: Expression; scopes: readonly Scope[] }[] {
  return nodes.flatMap((node) => {
    if (node.type === 'IfBlock' || node.type === 'SnippetBlock') return [];
    if (isLink(node)) {
      const [from, to] = [attribute(node, 'from'), attribute(node, 'to')];
      return from && to ? [{ tag: `${node.start ?? ''}`, from, to, scopes }] : [];
    }
    const inner =
      node.type === 'EachBlock' && node.expression
        ? [
            ...scopes,
            {
              over: node.expression,
              ...(node.context?.type === 'Identifier' ? { item: node.context.name } : {}),
              ...(node.index ? { position: node.index } : {})
            }
          ]
        : scopes;
    return writtenLinks(node.children ?? [], inner);
  });
}

/** The collections a free layout's {#each} blocks walk by name, as `vertices` or `all(Node)`. */
function walkedCollections(nodes: readonly Node[], state: ReadonlySet<string>): string[] {
  return nodes.flatMap((node) => {
    if (node.type === 'SnippetBlock') return [];
    const over = node.type === 'EachBlock' ? node.expression : undefined;
    const walked =
      over?.type === 'Identifier' && over.name && state.has(over.name)
        ? [over.name]
        : over && heapOf(over)
          ? [heapOf(over) as string]
          : [];
    return [
      ...walked,
      ...walkedCollections(node.children ?? [], state),
      ...(node.else ? walkedCollections([node.else], state) : [])
    ];
  });
}

/** The heap `all(Node)` walks, ȟNode, as the state holds it. */
const heapOf = (expression: Expression): string | undefined =>
  expression.type === 'CallExpression' &&
  expression.callee?.type === 'Identifier' &&
  expression.callee.name === 'all' &&
  expression.arguments?.[0]?.type === 'Identifier'
    ? `ȟ${expression.arguments[0].name}`
    : undefined;

/** Every way the {#each} blocks around a link bind their names at a step. */
function* bindings(
  scopes: readonly Scope[],
  env: ReadonlyMap<string, Read>,
  step: MasterStep,
  state: ReadonlySet<string>
): Generator<ReadonlyMap<string, Read>> {
  if (!scopes.length) {
    yield env;
    return;
  }
  const [scope, ...rest] = scopes;
  const over = read(scope.over, env, step, state);
  if (!over || !Array.isArray(over.value)) return;
  for (const [index, value] of over.value.entries()) {
    const inner = new Map(env);
    if (scope.item)
      inner.set(scope.item, { value, ...(over.path ? { path: `${over.path}[${index}]` } : {}) });
    if (scope.position && over.path) inner.set(scope.position, { value: index, walks: over.path });
    yield* bindings(rest, inner, step, state);
  }
}

/** A value of the markup read from the trace: names, fields, elements, numbers, and all(Node). */
function read(
  expression: Expression,
  env: ReadonlyMap<string, Read>,
  step: MasterStep,
  state: ReadonlySet<string>
): Read | undefined {
  switch (expression.type) {
    case 'Identifier':
      if (!expression.name) return undefined;
      if (env.has(expression.name)) return env.get(expression.name);
      return state.has(expression.name)
        ? { value: step.state[expression.name], path: expression.name }
        : undefined;
    case 'Literal':
      return typeof expression.value === 'number' ? { value: expression.value } : undefined;
    case 'CallExpression': {
      const heap = heapOf(expression);
      return heap ? { value: step.state[heap], path: heap } : undefined;
    }
    case 'MemberExpression': {
      const object = expression.object && read(expression.object, env, step, state);
      const key = expression.computed
        ? expression.property && read(expression.property, env, step, state)?.value
        : expression.property?.name;
      if (!object || (typeof key !== 'number' && typeof key !== 'string')) return undefined;
      const value = (object.value as Record<string | number, unknown> | undefined)?.[key];
      const path =
        object.path &&
        (typeof key === 'number' ? `${object.path}[${key}]` : `${object.path}.${key}`);
      return { value, ...(path ? { path } : {}) };
    }
    default:
      return undefined;
  }
}

/** The element a link's end stands for, as `vertices[2]`: a position, or a value referring to one. */
function endOf(end: Read, step: MasterStep): string | undefined {
  if (typeof end.value !== 'number') return undefined;
  if (end.walks) return `${end.walks}[${end.value}]`;
  const target = end.path ? step.targets?.[end.path] : undefined;
  return target ? `${target}[${end.value}]` : undefined;
}

/** The value at a path such as `ȟNode[2].next` or `adjacency[0][1]` in a step's state. */
function valueAt(state: Readonly<Record<string, unknown>>, path: string): unknown {
  const parts = path.match(/[^.[\]]+/gu) ?? [];
  let value: unknown = state;
  for (const part of parts)
    value = (value as Record<string, unknown> | undefined)?.[
      /^\d+$/u.test(part) ? Number(part) : part
    ];
  return value;
}

/** Whether an element, as `vertices[2]`, exists at a step. */
function exists(step: MasterStep, element: string): boolean {
  const [, collection, index] = /^(.+)\[(\d+)\]$/u.exec(element) ?? [];
  const value = collection ? valueAt(step.state, collection) : undefined;
  return Array.isArray(value) && Number(index) < value.length;
}

/** Elements in collection order, then by position. */
function byElement(a: string, b: string): number {
  const [, ca, ia] = /^(.+)\[(\d+)\]$/u.exec(a) ?? [];
  const [, cb, ib] = /^(.+)\[(\d+)\]$/u.exec(b) ?? [];
  return (ca ?? '').localeCompare(cb ?? '') || Number(ia) - Number(ib);
}
