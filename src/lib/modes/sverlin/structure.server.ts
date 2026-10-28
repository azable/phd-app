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
 */

import type { MasterStep } from './algorithm/interpret.server';
import type { DomainRegistry } from './algorithm/structures.server';
import { findStructure, type StructureKind } from './library/node/forms';

/** A free layout's structure, or none where its data makes none the layout can take. */
export type LayoutStructure = StructureKind | 'none';

type Node = {
  type?: string;
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

/**
 * Each free layout kind's structure: its free layouts' nodes (by kind), the view's components, the
 * state's names, the domain, and the trace's steps.
 */
export function layoutStructures(options: {
  free: ReadonlyMap<string, readonly unknown[]>;
  views: readonly { type: string; node: unknown }[];
  stateNames: readonly string[];
  domain: DomainRegistry;
  steps: readonly MasterStep[];
}): Record<string, LayoutStructure> {
  // Parsed Svelte markup (svelte/compiler's legacy AST), read only for the parts named in Node.
  const fields = linkedFields(
    options.views as readonly { type: string; node: Node }[],
    options.domain
  );
  const state = new Set(options.stateNames);
  let evaluations = 0;
  return Object.fromEntries(
    [...(options.free as ReadonlyMap<string, readonly Node[]>)].map(([kind, nodes]) => {
      const links = nodes.flatMap((node) => writtenLinks(node.children ?? [], []));
      const walked = new Set(
        nodes.flatMap((node) => walkedCollections(node.children ?? [], state))
      );
      const present = new Map<string, boolean[]>();
      for (const [index, step] of options.steps.entries()) {
        const edges = new Set<string>();
        for (const { from, to, scopes } of links)
          for (const env of bindings(scopes, new Map(), step, state)) {
            if (++evaluations > evaluationLimit) return [kind, 'none'];
            const ends = [read(from, env, step, state), read(to, env, step, state)].map((end) =>
              end ? endOf(end, step) : undefined
            );
            if (ends[0] && ends[1]) edges.add(`${ends[0]} -> ${ends[1]}`);
          }
        for (const [path, target] of Object.entries(step.targets ?? {})) {
          const field = /^(.+)\[(\d+)\]\.([A-Za-z_$][\w$]*)$/u.exec(path);
          if (!field || !walked.has(field[1])) continue;
          const record = step.types?.[`${field[1]}[${field[2]}]`];
          const value = valueAt(step.state, path);
          if (record && fields.has(`${record}.${field[3]}`) && typeof value === 'number')
            edges.add(`${field[1]}[${field[2]}] -> ${target}[${value}]`);
        }
        for (const edge of edges) {
          const seen = present.get(edge) ?? [];
          seen[index] = true;
          present.set(edge, seen);
        }
      }
      const lasting = [...present].flatMap(([edge, seen]) => {
        const [from, to] = edge.split(' -> ');
        const always = options.steps.every(
          (step, index) => seen[index] || !exists(step, from) || !exists(step, to)
        );
        return always ? [[from, to] as const] : [];
      });
      const ids = [...new Set(lasting.flat())].sort(byElement);
      const structure = findStructure(
        ids.length,
        lasting.map(([from, to]) => ({ source: ids.indexOf(from), target: ids.indexOf(to) }))
      );
      return [kind, structure?.kind ?? 'none'];
    })
  );
}

/**
 * The record fields whose references views draw as links with no from: `<Link to={node.next} />`
 * in a view of a record draws its next field; `<Link to={value} />` in a view of a type draws every
 * record field of that type, or of a union holding it.
 */
function linkedFields(
  views: readonly { type: string; node: Node }[],
  domain: DomainRegistry
): Set<string> {
  const fields = new Set<string>();
  const records = Object.values(domain.structures).flatMap((structure) =>
    structure.kind === 'record' ? [structure] : []
  );
  const holds = (declared: string, type: string) => {
    const structure = domain.structures[declared];
    return declared === type || (structure?.kind === 'union' && structure.members.includes(type));
  };
  for (const { type, node } of views) {
    const parameter = node.parameters?.[0]?.name;
    for (const to of fromlessEnds(node.children ?? [])) {
      if (to.type === 'Identifier' && to.name === parameter)
        for (const record of records)
          for (const [field, declared] of Object.entries(record.fields))
            if (holds(declared, type)) fields.add(`${record.name}.${field}`);
      if (
        to.type === 'MemberExpression' &&
        !to.computed &&
        to.object?.type === 'Identifier' &&
        to.object.name === parameter &&
        to.property?.type === 'Identifier'
      )
        fields.add(`${type}.${to.property.name}`);
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
): { from: Expression; to: Expression; scopes: readonly Scope[] }[] {
  return nodes.flatMap((node) => {
    if (node.type === 'IfBlock' || node.type === 'SnippetBlock') return [];
    if (isLink(node)) {
      const [from, to] = [attribute(node, 'from'), attribute(node, 'to')];
      return from && to ? [{ from, to, scopes }] : [];
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
