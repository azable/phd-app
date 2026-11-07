/**
 * Typed view components: top-level snippets that view one domain type, as a view written
 * <View of="Int" name="IntText"> is by now {#snippet IntText(this: Int)} (see viewTags), optionally taking the props of the node they draw, as in
 * (value: Int, node). A component reads only its value and other components, so its size can be
 * found by rendering it for every value of its type (see assembly/entry.ts). A type renders by its
 * name, as in {@render Int(value)}, drawing the view of it its variant chooses (views.Int). A
 * snippet without parameters is a part: of the page at the top level, reading what the root reads,
 * or of the view it is inside. Every snippet's name, with those of the snippets around it, is the
 * kind of the nodes it draws.
 */

import type { TraceState, TypeMap } from './algorithm/interpret.server';
import type { AtomType } from './algorithm/atoms.server';
import type { DomainRegistry } from './algorithm/structures.server';
import { isDuringKey, viewThis } from './label-values';
import { layoutNameOf } from './layouts.server';
import { countArgument } from './bound-props.server';
import { siteOf } from './left-out';

/** Each component's type, by name. */
export type ComponentSignatures = Record<string, string>;

type SvelteNode = {
  type?: string;
  name?: string;
  start?: number;
  expression?: { name?: string };
  parameters?: { name?: string; typeAnnotation?: { typeAnnotation?: TypeNode } }[];
  children?: SvelteNode[];
  data?: string;
  attributes?: { type?: string; name?: string; value?: unknown }[];
  else?: SvelteNode;
};
type TypeNode = { type?: string; typeName?: { type?: string; name?: string } };

/** A problem with a component, at a position in the view. */
export type ComponentProblem = { message: string; start: number };

/** Whether markup is a snippet without parameters: a part of the page, or of the view it is in. */
export function isPart(node: unknown): boolean {
  const part = node as { type?: string; parameters?: unknown[] } | undefined;
  return part?.type === 'SnippetBlock' && !part.parameters?.length;
}

/**
 * Every snippet's kind, by its name: the names of the snippets it is inside and its own, as
 * Row.Under for Under inside Row. Names are unique (see findComponents), so a render names one.
 */
export function snippetPaths(markup: unknown): Map<string, string> {
  const paths = new Map<string, string>();
  const walk = (node: unknown, around: string | undefined): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => walk(child, around));
    const part = node as { type?: string; expression?: { name?: string } };
    const name = part.type === 'SnippetBlock' ? part.expression?.name : undefined;
    const path = name ? (around ? `${around}.${name}` : name) : around;
    if (name && path && !paths.has(name)) paths.set(name, path);
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'expression') walk(child, path);
  };
  walk(markup, undefined);
  return paths;
}

/**
 * The view's components, the start of each one's root <Node> tags, the <Node> tags that show a
 * component's own value with its type, and problems: a snippet that types more than one parameter,
 * takes more than its value, takes a parameter without a type, is typed but not at the top level,
 * or has the name of another snippet.
 */
export function findComponents(html: { children?: SvelteNode[] } | undefined): {
  components: { name: string; start: number; type: string; node: SvelteNode }[];
  roots: Map<number, string>;
  /** The <Node> tags whose value is their component's own, by where they start, with its type. */
  valueTypes: Map<number, string>;
  problems: ComponentProblem[];
} {
  const components: { name: string; start: number; type: string; node: SvelteNode }[] = [];
  const roots = new Map<number, string>();
  const valueTypes = new Map<number, string>();
  const problems: ComponentProblem[] = [];
  const typeOf = (snippet: SvelteNode): string | undefined => {
    const parameters = snippet.parameters ?? [];
    const types = parameters.map((parameter) => {
      const annotation = parameter.typeAnnotation?.typeAnnotation;
      return annotation?.type === 'TSTypeReference' && annotation.typeName?.type === 'Identifier'
        ? annotation.typeName.name
        : undefined;
    });
    const typed = types.filter((type) => type !== undefined);
    if (!typed.length) return undefined;
    // Reported once, and not taken as a component, so nothing else is said about it.
    const name = snippet.expression?.name;
    if (typed.length > 1)
      problems.push({
        message: `${name} takes ${typed.length} domain types, ${typed.join(', ')}; a component views one type. Give each value its own component, or define one type that holds them, such as a record, and draw how they relate where both values are in scope.`,
        start: snippet.start ?? 0
      });
    else if (types[0] === undefined || parameters.length > 1)
      problems.push({
        message: `${name} takes one value, its type given, as a view written <View of="Int" name="${name}">…</View> does: a component views one domain type.`,
        start: snippet.start ?? 0
      });
    else if (parameters[0].name !== viewThis)
      problems.push({
        message: `${name} names its value ${parameters[0].name}; a view's value is always this, as in <View of="${typed[0].startsWith('ℓ') ? `@${typed[0].slice(1).replaceAll('ˑ', '.')}` : typed[0]}" name="${name}">, read as {this}, {this.name} or <Node value={this} />.`,
        start: snippet.start ?? 0
      });
    else return typed[0];
    return undefined;
  };
  for (const node of html?.children ?? []) {
    const type = node.type === 'SnippetBlock' && node.expression?.name ? typeOf(node) : undefined;
    if (!type) continue;
    const name = node.expression?.name as string;
    components.push({ name, start: node.start ?? 0, type, node });
    const parameter = node.parameters?.[0]?.name;
    if (parameter) for (const start of ownValueNodes(node, parameter)) valueTypes.set(start, type);
    for (const child of node.children ?? [])
      if (
        child.type === 'InlineComponent' &&
        (child.name === 'Node' || child.name === 'Link') &&
        child.start !== undefined
      )
        roots.set(child.start, name);
  }
  // Components are defined at the top level, so every definition is reusable.
  const nested = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const part of node) nested(part, depth);
      return;
    }
    const part = node as SvelteNode;
    if (part.type === 'SnippetBlock' && depth > 0 && typeOf(part))
      problems.push({
        message: `${part.expression?.name} has typed parameters, so it is a component, and components are defined at the top level of the view, not inside other markup.`,
        start: part.start ?? 0
      });
    for (const child of part.children ?? []) nested(child, depth + 1);
  };
  for (const node of html?.children ?? []) nested(node.children ?? [], 1);
  // A snippet's name is its kind, so each names one snippet; one without a type takes nothing.
  // A snippet with a parameter is a view, one without a layout drawn by its tag.
  const named = new Map<string, string>();
  const snippets = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(snippets);
    const part = node as SvelteNode;
    const name = part.type === 'SnippetBlock' ? part.expression?.name : undefined;
    const written = part.parameters?.length ? 'view' : 'layout';
    const earlier = name === undefined ? undefined : named.get(name);
    if (name && earlier)
      problems.push({
        message: `${earlier === written ? `Two ${written}s are` : 'A view and a layout are both'} named ${name}: a name is the kind of the nodes drawn by it, so give each its own.`,
        start: part.start ?? 0
      });
    else if (name) named.set(name, written);
    if (name && part.parameters?.length && !typeOf(part))
      problems.push({
        message: `${name} takes a parameter without a type: a view takes one value, written <View of="Int" name="${name}">…</View>, and a layout takes none, as <Layout name="Title">…</Layout>.`,
        start: part.start ?? 0
      });
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'expression') snippets(child);
  };
  snippets(html?.children);
  return { components, roots, valueTypes, problems };
}

/** The starts of the <Node> tags in a component that show its value, as `<Node value={this} />` does. */
function ownValueNodes(node: SvelteNode, parameter: string): number[] {
  return [...(node.children ?? []), ...(node.else ? [node.else] : [])].flatMap((child) => {
    const value = child.attributes?.find(
      (attribute) => attribute.name === 'value' && attribute.type === 'Attribute'
    )?.value;
    const [part] = Array.isArray(value) ? value : [value];
    const expression = (part as { expression?: { type?: string; name?: string } } | undefined)
      ?.expression;
    const own =
      child.type === 'InlineComponent' &&
      child.name === 'Node' &&
      expression?.type === 'Identifier' &&
      expression.name === parameter;
    return [
      ...(own && child.start !== undefined ? [child.start] : []),
      ...ownValueNodes(child, parameter)
    ];
  });
}

/**
 * The state variables an expression reads, as values and i in values[i], less names declared
 * around it: what it draws nothing without, at a step where one is out of scope.
 */
export function stateReadsOf(
  expression: unknown,
  stateNames: ReadonlySet<string>,
  locals: { has(name: string): boolean } = new Set()
): string[] {
  const read = new Set<string>();
  const walk = (value: unknown, parent?: Record<string, unknown>, key?: string): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item) => walk(item, parent, key));
    const node = value as Record<string, unknown> & { type?: string; name?: string };
    const member = parent?.type === 'MemberExpression' && key === 'property' && !parent.computed;
    const property = parent?.type === 'Property' && key === 'key' && !parent.computed;
    if (node.type === 'Identifier' && typeof node.name === 'string' && !member && !property)
      read.add(node.name);
    for (const [childKey, child] of Object.entries(node))
      if (childKey !== 'parent' && childKey !== 'loc') walk(child, node, childKey);
  };
  walk(expression);
  return [...read].filter((name) => stateNames.has(name) && !locals.has(name));
}

/**
 * Where markup calls a view other than as {@render View(value)}, as Index(position) for a typed
 * value: a view is a snippet, which only draws, and called as a function it fails as it draws.
 */
export function viewCallsOf(
  markup: unknown,
  views: ReadonlySet<string>
): { name: string; start: number }[] {
  const found: { name: string; start: number }[] = [];
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(walk);
    const node = value as Record<string, unknown> & { type?: string };
    if (node.type === 'RenderTag') {
      // The rendered view itself is called as it should be; its arguments are checked.
      const call = node.expression as { arguments?: unknown[] } | undefined;
      return walk(call?.arguments);
    }
    const callee = node.callee as { type?: string; name?: string } | undefined;
    if (
      node.type === 'CallExpression' &&
      callee?.type === 'Identifier' &&
      views.has(callee.name ?? '')
    )
      found.push({ name: callee.name ?? '', start: (node.start as number | undefined) ?? 0 });
    for (const [key, child] of Object.entries(node))
      if (key !== 'parent' && key !== 'loc') walk(child);
  };
  walk(markup);
  return found;
}

/**
 * Where the root, or a part of the page, reads a variable out of scope at some step other than
 * through a view or pointer: there it would read the value standing in from another step.
 * {@render} arguments and {#each} collections are drawn through views, which draw nothing at such
 * steps.
 */
export function scopedReadsOf(
  markup: unknown,
  scoped: ReadonlySet<string>,
  { inKinds = true }: { inKinds?: boolean } = {}
): { name: string; start: number }[] {
  const found: { name: string; start: number }[] = [];
  // Only reads of the variable itself: not a name an {#each}, {@const} or function declares there.
  const free = new Set(freeReads(markup).map(({ start }) => start));
  // A {@const} name read counts as a read of each variable its value reads, where the name is
  // read, so the node using it hides, not the one holding the {@const}.
  const throughConsts = new Map(
    constNameReads(markup).map(({ start, held }) => [
      start,
      held.filter((name) => scoped.has(name))
    ])
  );
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item) => walk(item));
    const node = value as Record<string, unknown> & { type?: string; name?: string };
    if (node.type === 'RenderTag' || (node.type === 'SnippetBlock' && !isPart(node))) return;
    if (node.type === 'ConstTag') return;
    if (node.type === 'EachBlock') {
      walk(node.body ?? node.children);
      walk(node.fallback ?? node.else);
      return;
    }
    // Where a kind expression reads an absent variable, its node takes its base kind (see kindChoice).
    if (!inKinds && node.type === 'Attribute' && node.name === 'kind') return;
    // A link's end read straight from a variable or label is drawn hidden where it is absent.
    if (node.type === 'Attribute' && (node.name === 'from' || node.name === 'to')) {
      const [only] = Array.isArray(node.value) ? (node.value as { expression?: unknown }[]) : [];
      if ((only?.expression as { type?: string } | undefined)?.type === 'Identifier') return;
    }
    if (node.type === 'Identifier' && scoped.has(node.name ?? '') && free.has(node.start as number))
      found.push({ name: node.name ?? '', start: (node.start as number | undefined) ?? 0 });
    if (node.type === 'Identifier')
      for (const name of throughConsts.get(node.start as number) ?? [])
        found.push({ name, start: (node.start as number | undefined) ?? 0 });
    for (const [childKey, child] of Object.entries(node))
      if (childKey !== 'parent' && childKey !== 'loc') walk(child);
  };
  walk(markup);
  return found;
}

/**
 * Each {#if}, {#key} or {#each} whose test reads a variable of `absent`, which some step lacks,
 * wrapped in a slot reading it: at such a step everything inside is drawn hidden, keeping its room,
 * as the test reads that variable's stand-in from another step (see standInsFor). An {#if}'s
 * {:else if} tests count as its own.
 */
export function guardInsertions(markup: unknown, absent: ReadonlySet<string>): Insertion[] {
  type Part = Record<string, unknown> & { type?: string; start?: number; end?: number };
  const free = new Set(
    freeReads(markup)
      .filter(({ name }) => absent.has(name))
      .map(({ start }) => start)
  );
  const throughConsts = new Map(
    constNameReads(markup).map(({ start, held }) => [
      start,
      held.filter((name) => absent.has(name))
    ])
  );
  const readsIn = (value: unknown, into: Set<string>): Set<string> => {
    if (!value || typeof value !== 'object') return into;
    if (Array.isArray(value)) value.forEach((item) => readsIn(item, into));
    else {
      const node = value as Part & { name?: string };
      if (node.type === 'Identifier' && free.has(node.start ?? -1)) into.add(node.name ?? '');
      if (node.type === 'Identifier')
        for (const name of throughConsts.get(node.start ?? -1) ?? []) into.add(name);
      for (const [key, child] of Object.entries(node))
        if (key !== 'parent' && key !== 'loc') readsIn(child, into);
    }
    return into;
  };
  // The tests of an {#if} and of each {:else if} after it.
  const chainTests = (block: Part): unknown[] => {
    const children = ((block.else as Part | undefined)?.children as Part[] | undefined) ?? [];
    const next = children.find((child) => child.type === 'IfBlock' && child.elseif);
    return [block.expression, ...(next ? chainTests(next) : [])];
  };
  const insertions: Insertion[] = [];
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(walk);
    const node = value as Part;
    const tests =
      node.type === 'IfBlock' && !node.elseif
        ? chainTests(node)
        : node.type === 'KeyBlock' || node.type === 'EachBlock'
          ? [node.expression]
          : [];
    const reads = [...readsIn(tests, new Set())];
    if (reads.length && node.start !== undefined && node.end !== undefined)
      insertions.push(
        { at: node.start, text: `<SverlinSlot inherit reads={${JSON.stringify(reads)}}>` },
        { at: node.end, text: '</SverlinSlot>' }
      );
    for (const [key, child] of Object.entries(node))
      if (key !== 'parent' && key !== 'loc') walk(child);
  };
  walk(markup);
  return insertions;
}

/**
 * The variables a component reads that it does not declare: identifiers in its expressions, less
 * member and key names, and less its parameters and the names its blocks and {@const} tags declare.
 */
export function readsOf(snippet: SvelteNode): Set<string> {
  const parameters = (snippet.parameters ?? []).map(({ name }) => name ?? '');
  return new Set(freeReads(snippet.children, parameters).map(({ name }) => name));
}

/**
 * The first name the markup reads that nothing in it declares and `known` does not give, with where
 * it is: a name the page would not have, failing only in the browser.
 */
export function unknownReadOf(
  markup: unknown,
  known: (name: string, start: number) => boolean
): { name: string; start: number } | undefined {
  return freeReads(markup).find(({ name, start }) => !known(name, start));
}

/**
 * The identifiers markup reads, with where each is, less member and key names and the names
 * declared where they are read: snippet and {@const} names in their fragment, a snippet's
 * parameters in its body, an {#each} block's names in its body, and a function's parameters and
 * variables in the function.
 */
export function freeReads(
  markup: unknown,
  given: readonly string[] = [],
  { constsDeclare = true }: { constsDeclare?: boolean } = {}
): { name: string; start: number }[] {
  type Part = Record<string, unknown> & { type?: string; name?: string };
  const read: { name: string; start: number }[] = [];
  const declaring = (scope: ReadonlySet<string>, patterns: unknown[]) => {
    const inner = new Set(scope);
    for (const pattern of patterns) collectPattern(pattern, inner);
    return inner;
  };
  // The variables a function body declares, not counting those of functions inside it.
  const declarators = (value: unknown, into: unknown[] = []): unknown[] => {
    if (!value || typeof value !== 'object') return into;
    if (Array.isArray(value)) value.forEach((item) => declarators(item, into));
    else if ((value as Part).type === 'VariableDeclarator') into.push((value as Part).id);
    else if (!/Function/.test((value as Part).type ?? ''))
      for (const [key, child] of Object.entries(value))
        if (key !== 'parent' && key !== 'loc' && key !== 'typeAnnotation') declarators(child, into);
    return into;
  };
  const walk = (
    value: unknown,
    scope: ReadonlySet<string>,
    parent?: Record<string, unknown>,
    key?: string
  ): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      const declared = (value as (Part | null)[]).flatMap((item) =>
        item?.type === 'SnippetBlock'
          ? [item.expression]
          : item?.type === 'ConstTag' && constsDeclare
            ? [(item.expression as { left?: unknown } | undefined)?.left]
            : []
      );
      const fragment = declared.length ? declaring(scope, declared) : scope;
      for (const item of value) walk(item, fragment, parent, key);
      return;
    }
    const node = value as Part;
    if (node.type === 'Identifier' && typeof node.name === 'string') {
      const member = parent?.type === 'MemberExpression' && key === 'property' && !parent.computed;
      const property = parent?.type === 'Property' && key === 'key' && !parent.computed;
      if (!member && !property && !scope.has(node.name))
        read.push({ name: node.name, start: (node.start as number | undefined) ?? 0 });
    }
    if (node.type === 'SnippetBlock')
      return walk(node.children, declaring(scope, (node.parameters as unknown[]) ?? []));
    if (node.type === 'EachBlock') {
      const body = declaring(scope, [node.context]);
      if (typeof node.index === 'string') body.add(node.index);
      walk(node.expression, scope);
      walk(node.key, body);
      walk(node.children, body);
      return walk(node.else, scope);
    }
    // {@const x = …} parses as an assignment to x, declared in its fragment.
    if (node.type === 'ConstTag')
      return walk((node.expression as { right?: unknown } | undefined)?.right, scope);
    if (/Function/.test(node.type ?? '')) {
      const params = (node.params as unknown[] | undefined) ?? [];
      return walk(node.body, declaring(scope, [node.id, ...params, ...declarators(node.body)]));
    }
    if (node.type === 'VariableDeclarator') return walk(node.init, scope);
    for (const [childKey, child] of Object.entries(node))
      if (childKey !== 'parent' && childKey !== 'loc' && childKey !== 'typeAnnotation')
        walk(child, scope, node, childKey);
  };
  walk(markup, new Set(given));
  return read;
}

/**
 * What each {@const} name holds: the names its value reads, a {@const} name among them replaced by
 * what that one holds, so `{@const next = j + 1}` holds `j`. {@const} tags in different fragments
 * declaring one name hold what all of them read.
 */
export function constValues(markup: unknown): Map<string, string[]> {
  const direct = new Map<string, Set<string>>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(walk);
    const node = value as Record<string, unknown> & { type?: string };
    if (node.type === 'ConstTag') {
      const { left, right } = (node.expression ?? {}) as { left?: unknown; right?: unknown };
      const names = new Set<string>();
      collectPattern(left, names);
      const reads = freeReads(right).map(({ name }) => name);
      for (const name of names) direct.set(name, new Set([...(direct.get(name) ?? []), ...reads]));
    }
    for (const [key, child] of Object.entries(node))
      if (key !== 'parent' && key !== 'loc') walk(child);
  };
  walk(markup);
  const held = new Map<string, string[]>();
  const resolve = (name: string, seen: ReadonlySet<string>): string[] => {
    const known = held.get(name);
    if (known) return known;
    const out = new Set<string>();
    for (const read of direct.get(name) ?? [])
      if (!direct.has(read)) out.add(read);
      else if (!seen.has(read))
        for (const inner of resolve(read, new Set([...seen, read]))) out.add(inner);
    held.set(name, [...out]);
    return [...out];
  };
  for (const name of direct.keys()) resolve(name, new Set([name]));
  return held;
}

/**
 * Each read of a {@const} name in the markup, with where it is and what the name holds (see
 * constValues): the reads freeReads leaves out as declared where they are.
 */
export function constNameReads(markup: unknown): { name: string; start: number; held: string[] }[] {
  const values = constValues(markup);
  if (!values.size) return [];
  const free = new Set(freeReads(markup).map(({ start }) => start));
  return freeReads(markup, [], { constsDeclare: false })
    .filter(({ name, start }) => values.has(name) && !free.has(start))
    .map((read) => ({ ...read, held: values.get(read.name) ?? [] }));
}

/**
 * The scope inside an {#each} block: its item named with its collection's element type, as v for
 * each Vertex of this.vertices, and with `index`, its index named with the collection's position
 * type, where the domain declares one.
 */
export function eachScope(
  each: Readonly<Record<string, unknown>>,
  scope: ReadonlyMap<string, string>,
  typeOf: (node: unknown) => string | undefined,
  domain: DomainRegistry,
  { index = false } = {}
): Map<string, string> {
  const inner = new Map(scope);
  const collection = typeOf(each.expression);
  const structure = collection === undefined ? undefined : domain.structures[collection];
  if (structure?.kind !== 'collection') return inner;
  const context = each.context as { type?: string; name?: unknown } | undefined;
  if (context?.type === 'Identifier' && typeof context.name === 'string')
    inner.set(context.name, structure.element);
  const positions = Object.values(domain.atoms).filter((atom) => atom.index === collection);
  if (index && typeof each.index === 'string' && positions.length === 1)
    inner.set(each.index, positions[0].name);
  return inner;
}

/**
 * Every `at(p)` in the markup, by where it starts, with the variable holding the collection the
 * position `p` points into, as vertices for a VertexRef; and each read through a position written
 * another way, or that the domain does not allow, with why. Types come from the domain: a view's
 * parameter has the type it is written with, an {#each} item its collection's element, a variable
 * the type the steps record, a field its record's, and `at(p)` the element of the collection p's
 * type is an index into. The collection is the one variable of that collection type, or else the
 * one the steps record positions of p's type pointing into.
 */
export function positionReads(
  markup: unknown,
  source: string,
  domain: DomainRegistry,
  variables: ReadonlyMap<string, string>,
  pointed: ReadonlyMap<string, ReadonlySet<string>>
): { targets: Map<number, string>; problems: { message: string; start: number }[] } {
  type Part = Record<string, unknown> & {
    type?: string;
    name?: string;
    start?: number;
    end?: number;
  };
  const targets = new Map<number, string>();
  const problems: { message: string; start: number }[] = [];
  const text = (node: Part) => source.slice(node.start, node.end);
  const collectionOf = (type: string | undefined) => {
    const structure = type === undefined ? undefined : domain.structures[type];
    return structure?.kind === 'collection' ? structure : undefined;
  };
  const recordOf = (type: string | undefined) => {
    let structure = type === undefined ? undefined : domain.structures[type];
    if (structure?.kind === 'ref') structure = domain.structures[structure.element];
    return structure?.kind === 'record' ? structure : undefined;
  };
  const indexInto = (type: string | undefined) =>
    type === undefined ? undefined : domain.atoms[type]?.index;
  // The variable holding the collection a position of a type points into, or why there is none.
  const holder = (position: string, collection: string): string | { problem: string } => {
    const holding = [...variables].filter(([, type]) => type === collection).map(([name]) => name);
    if (holding.length === 1) return holding[0];
    const recorded = [...(pointed.get(position) ?? [])];
    if (recorded.length === 1) return recorded[0];
    return {
      problem: holding.length
        ? `at() reads the ${collection} a ${position} points into, and ${holding.join(' and ')} each hold one: read the element in a layout, as ${holding[0]}[p].`
        : `at() reads the ${collection} a ${position} points into, and no variable holds one.`
    };
  };
  const isAt = (node: Part | undefined) =>
    node?.type === 'CallExpression' &&
    (node.callee as Part | undefined)?.type === 'Identifier' &&
    (node.callee as Part).name === 'at';
  // Each expression is typed once, so a problem is told once however often it is asked about.
  const typed = new Map<Part, string | undefined>();
  const typeOf = (
    node: Part | undefined,
    scope: ReadonlyMap<string, string>
  ): string | undefined => {
    if (!node) return undefined;
    if (!typed.has(node)) typed.set(node, typeNow(node, scope));
    return typed.get(node);
  };
  const typeNow = (node: Part, scope: ReadonlyMap<string, string>): string | undefined => {
    if (node.type === 'Identifier' && typeof node.name === 'string')
      return scope.get(node.name) ?? variables.get(node.name);
    if (node.type === 'MemberExpression') {
      const object = node.object as Part;
      const type = typeOf(object, scope);
      if (node.computed) return collectionOf(type)?.element;
      const property = node.property as Part;
      const field = String(property.name ?? '');
      const index = indexInto(type);
      if (index !== undefined) {
        problems.push({
          message: `${text(object)} is a ${type}, a position into a ${index}, with no field ${field}: read the element it points at with at(), as at(${text(object)}).${field}.`,
          start: property.start ?? 0
        });
        return undefined;
      }
      const record = recordOf(type);
      if (!record) return undefined;
      if (isAt(object) && !(field in record.fields))
        problems.push({
          message: `A ${record.name} has no field ${field}; its fields are ${Object.keys(record.fields).join(', ')}.`,
          start: property.start ?? 0
        });
      return record.fields[field];
    }
    if (!isAt(node)) return undefined;
    const [argument, ...more] = (node.arguments as Part[] | undefined) ?? [];
    const type = typeOf(argument, scope);
    const index = indexInto(type);
    const start = node.start ?? 0;
    if (!argument || more.length || index === undefined || type === undefined) {
      problems.push({
        message:
          argument && !more.length
            ? `at(${text(argument)}) reads through a position, and ${text(argument)} is ${type ? `of type ${type}` : 'no value whose type is known'}: give it a position, as at(p) in a view of a position type or at(queue[0]) for a queue of them.`
            : 'at() takes one position, as at(p), and is the element it points at.',
        start
      });
      return undefined;
    }
    const found = holder(type, index);
    if (typeof found === 'string') targets.set(start, found);
    else problems.push({ message: found.problem, start });
    return collectionOf(index)?.element;
  };
  const visit = (value: unknown, scope: ReadonlyMap<string, string>): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item) => visit(item, scope));
    const part = value as Part;
    if (part.type === 'MemberExpression' || isAt(part)) typeOf(part, scope);
    if (part.type === 'SnippetBlock') {
      const inner = new Map(scope);
      for (const parameter of (part.parameters as Part[] | undefined) ?? []) {
        const annotation = (parameter.typeAnnotation as Part | undefined)?.typeAnnotation as
          | Part
          | undefined;
        const written = (annotation?.typeName as Part | undefined)?.name;
        if (typeof parameter.name === 'string' && typeof written === 'string')
          inner.set(parameter.name, written);
      }
      return visit(part.children, inner);
    }
    if (part.type === 'EachBlock') {
      visit(part.expression, scope);
      const inner = eachScope(part, scope, (node) => typeOf(node as Part, scope), domain);
      visit(part.children, inner);
      return visit(part.else, scope);
    }
    if (part.type === 'ConstTag') {
      const assigned = part.expression as Part | undefined;
      visit(assigned?.right, scope);
      const left = assigned?.left as Part | undefined;
      const type = typeOf(assigned?.right as Part | undefined, scope);
      if (left?.type === 'Identifier' && typeof left.name === 'string' && type)
        (scope as Map<string, string>).set(left.name, type);
      return;
    }
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'typeAnnotation') visit(child, scope);
  };
  visit(markup, new Map());
  return { targets, problems };
}

function collectPattern(pattern: unknown, into: Set<string>): void {
  if (!pattern || typeof pattern !== 'object') return;
  const node = pattern as Record<string, unknown> & { type?: string; name?: string };
  if (node.type === 'Identifier' && typeof node.name === 'string') into.add(node.name);
  for (const [key, child] of Object.entries(node))
    if (key !== 'typeAnnotation') {
      if (Array.isArray(child)) for (const item of child) collectPattern(item, into);
      else if (key === 'value' || key === 'left' || key === 'argument' || key === 'elements')
        collectPattern(child, into);
    }
}

/**
 * How markup uses values, by path from the names in `roots`, such as `i`, `edge.from`, or
 * `values[]` for any element: `viewed` paths are passed straight to a view, as in
 * {@render Int(value)}; `placed` paths are read for anything else, such as showing them or
 * deciding where something goes (k === i). An {#each} over a path reads its elements through the
 * loop's name.
 */
export function valueUses(
  markup: unknown,
  roots: ReadonlySet<string>,
  views: ReadonlySet<string>
): { viewed: Set<string>; placed: Set<string> } {
  const viewed = new Set<string>();
  const placed = new Set<string>();
  type Part = Record<string, unknown> & { type?: string; name?: string };
  const pathOf = (node: unknown, aliases: ReadonlyMap<string, string>): string | undefined => {
    const part = node as Part | undefined;
    if (part?.type === 'Identifier' && typeof part.name === 'string')
      return aliases.get(part.name) ?? (roots.has(part.name) ? part.name : undefined);
    if (part?.type !== 'MemberExpression') return undefined;
    const base = pathOf(part.object, aliases);
    const property = part.property as Part;
    if (!base) return undefined;
    if (!part.computed && typeof property.name === 'string') return `${base}.${property.name}`;
    return property.type === 'Literal' ? `${base}[]` : undefined;
  };
  const walk = (node: unknown, aliases: ReadonlyMap<string, string>): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, aliases);
      return;
    }
    const part = node as Part;
    const path = pathOf(part, aliases);
    if (path) {
      placed.add(path);
      return;
    }
    if (part.type === 'EachBlock') {
      const source = pathOf(part.expression, aliases);
      const context = part.context as Part | undefined;
      if (!source) walk(part.expression, aliases);
      const inner = new Map(aliases);
      if (source && context?.type === 'Identifier' && typeof context.name === 'string')
        inner.set(context.name, `${source}[]`);
      walk(part.children, inner);
      walk(part.else, aliases);
      return;
    }
    if (part.type === 'RenderTag') {
      const call = part.expression as Part;
      const callee = call?.callee as Part | undefined;
      const toView = typeof callee?.name === 'string' && views.has(callee.name);
      for (const argument of (call?.arguments as unknown[]) ?? []) {
        const argumentPath = toView ? pathOf(argument, aliases) : undefined;
        if (argumentPath) viewed.add(argumentPath);
        else walk(argument, aliases);
      }
      return;
    }
    for (const [key, child] of Object.entries(part)) {
      if (key === 'parent' || key === 'typeAnnotation') continue;
      // A non-computed member or key names a property, not a value.
      if (part.type === 'MemberExpression' && key === 'property' && !part.computed) continue;
      if (part.type === 'Property' && key === 'key' && !part.computed) continue;
      walk(child, aliases);
    }
  };
  walk(markup, new Map());
  return { viewed, placed };
}

/** Text to insert into the view's source at a position in it, replacing `remove` characters there. */
export type Insertion = { at: number; text: string; remove?: number };

/**
 * The view's source with insertions made, each at its position in the original source. The texts
 * at one position read in the order given, as a slot closing before the next one opens, and what
 * is removed there is only the original source, never a text inserted at the same position, as a
 * pointer render removed right after the slot closing around the render before it.
 */
export function withInsertions(source: string, insertions: readonly Insertion[]): string {
  const byPosition = new Map<number, { text: string; remove: number }>();
  for (const { at, text, remove = 0 } of insertions) {
    const there = byPosition.get(at) ?? { text: '', remove: 0 };
    byPosition.set(at, { text: there.text + text, remove: Math.max(there.remove, remove) });
  }
  // From the end, so earlier positions hold.
  let result = source;
  for (const [at, { text, remove }] of [...byPosition].sort(([a], [b]) => b - a))
    result = `${result.slice(0, at)}${text}${result.slice(at + remove)}`;
  return result;
}

/**
 * A warning for each node with no layout holding two blocks and no words of its own: its children
 * flow as text, wrapping against each other with no gap (as a goal and its cells did on 5
 * November). A block is a layout drawn by tag, a collection drawn by its type or a view of it, an
 * {#each}, or a node with a layout.
 */
export function flowWarnings(
  markup: unknown,
  source: string,
  /** The renders drawing a collection, by name: its type's and its views'. */
  collections: ReadonlySet<string> = new Set()
): string[] {
  type Part = Record<string, unknown> & { type?: string; name?: string; start?: number; end?: number };
  const warnings: string[] = [];
  const text = (node: Part) => source.slice(node.start, node.end);
  // The layouts drawn by tag, each a snippet rendered with no arguments by now.
  const parts = new Set<string>();
  const gather = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(gather);
    const part = node as Part;
    if (isPart(part)) parts.add(String((part.expression as Part | undefined)?.name));
    for (const [key, child] of Object.entries(part)) if (key !== 'parent') gather(child);
  };
  gather(markup);
  // The page layout, or the layout drawn by tag, the node is in, for the warning to name.
  let layout: string | undefined;
  let drawnByTag: string | undefined;
  const blocksFlowing = (node: Part) => {
    const attributes = (node.attributes as Part[] | undefined) ?? [];
    if (attributes.some((attribute) => attribute.name === 'layout')) return;
    const words = ((node.children as Part[] | undefined) ?? []).some(
      (child) => child.type === 'Text' && String(child.data ?? '').trim()
    );
    if (words) return;
    const blocks = ((node.children as Part[] | undefined) ?? []).flatMap((child) => {
      const callee = ((child.expression as Part | undefined)?.callee as Part | undefined)?.name;
      if (child.type === 'RenderTag' && typeof callee === 'string')
        return parts.has(callee)
          ? [`<${callee} />`]
          : collections.has(callee)
            ? [`{${text(((child.expression as Part).arguments as Part[])[0] ?? child)}}`]
            : [];
      if (child.type === 'EachBlock') return [`{#each ${text(child.expression as Part)}}`];
      const laid =
        child.type === 'InlineComponent' &&
        child.name === 'Node' &&
        ((child.attributes as Part[] | undefined) ?? []).some(({ name }) => name === 'layout');
      return laid ? ['a node with a layout'] : [];
    });
    if (blocks.length < 2) return;
    const kind = attributes.find((attribute) => attribute.name === 'kind');
    const written = Array.isArray(kind?.value) ? (kind.value[0] as Part | undefined)?.data : '';
    const where = written
      ? `<Node kind="${written}">`
      : `A node with no layout in ${drawnByTag ?? layout ?? 'a view'}`;
    warnings.push(
      `${written ? `${where}, a node with no layout,` : where} holds ${blocks.join(', ')} and no words of its own: with no layout its children flow as text, wrapping against each other with no gap. Give it a layout, as layout="column" to stack them or layout="row" to set them side by side.`
    );
  };
  const visit = (node: unknown, top: boolean): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => visit(child, top));
    const part = node as Part;
    const named = top ? layoutNameOf(part) : undefined;
    if (named !== undefined) {
      layout = named;
      visit(part.children, top);
      layout = undefined;
      return;
    }
    if (
      part.type === 'SnippetBlock' &&
      top &&
      !(part.parameters as unknown[] | undefined)?.length
    ) {
      drawnByTag = (part.expression as Part | undefined)?.name;
      for (const [key, child] of Object.entries(part))
        if (key !== 'parent' && key !== 'expression') visit(child, false);
      drawnByTag = undefined;
      return;
    }
    if (part.type === 'InlineComponent' && part.name === 'Node') blocksFlowing(part);
    const inner = top && part.type !== 'SnippetBlock';
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'expression') visit(child, inner);
  };
  visit(markup, true);
  return warnings;
}

/**
 * Wrap every {@render} of a view in a SverlinSlot naming the element of the state it draws, so the
 * view's root nodes are known by it, such as values[2], whichever view the presentation drew:
 * a variable by its name, an element by the array or object it is taken from and its index or
 * field (adding an index to an {#each} that has none), and a component's own value by the slot its
 * call was given. Anything else, such as i + 1, is no element.
 */
export function slotInsertions(
  markup: unknown,
  source: string,
  stateNames: ReadonlySet<string>,
  views: ReadonlySet<string>,
  componentNames: ReadonlySet<string>,
  /** The state variables out of scope at some step, which a slot reading one names. */
  scoped: ReadonlySet<string> = new Set(),
  /**
   * The operators: rendered by name with nothing between the brackets, one draws the application a
   * step made, given as the prop __applied_Name, hidden where that step made none or several.
   */
  operators: ReadonlySet<string> = new Set(),
  /** Filled with each slotted render's variables, by where it starts, for what is left out. */
  rendered: Map<number, string[]> = new Map(),
  /** The code of the place of each render at one, by where it starts (see Place). */
  places: ReadonlyMap<number, string> = new Map(),
  /**
   * The pool each reference refers into, by the path of the value (its indices as []), as
   * `queue[]` into `vertices`: a field read through one in the markup reads its node.
   */
  references: ReadonlyMap<string, string> = new Map(),
  /**
   * The variable holding the collection each at(p) reads into, by where the call starts (see
   * positionReads): at(p) reads its element, as vertices[p], and draws nothing past either end.
   */
  atTargets: ReadonlyMap<number, string> = new Map(),
  /** Filled with each link end that names no element, with where it is written. */
  unresolvedEnds: { end: string; written: string; start: number }[] = []
): Insertion[] {
  type Part = Record<string, unknown> & {
    type?: string;
    name?: string;
    start?: number;
    end?: number;
  };
  type Local =
    | { kind: 'item'; of: Part; each: Part & { index?: string }; index?: string }
    | { kind: 'position'; of: Part }
    | { kind: 'value' }
    | { kind: 'other' };
  const insertions: Insertion[] = [];
  const indexed = new Map<Part, string>();
  const text = (node: Part) => source.slice(node.start, node.end);
  // An at(p) call, by the collection it reads into, and what it reads through.
  const atCall = (node: Part | undefined) => {
    const target = node?.type === 'CallExpression' ? atTargets.get(node.start ?? -1) : undefined;
    const [argument] = (node?.arguments as Part[] | undefined) ?? [];
    return target === undefined || !argument ? undefined : { target, argument };
  };
  // The at(p) a value is read through, as at(p).name.
  const readThrough = (node: Part | undefined): ReturnType<typeof atCall> =>
    node?.type === 'MemberExpression' ? readThrough(node.object as Part) : atCall(node);
  // The path of the value an expression reads, its indices as [], through a reference its node's
  // place in its pool, as `vertices[].name` for q.name with q an item of a queue of references.
  const patternOf = (
    node: Part | undefined,
    locals: ReadonlyMap<string, Local>
  ): string | undefined => {
    if (node?.type === 'Identifier' && typeof node.name === 'string') {
      const local = locals.get(node.name);
      if (local?.kind === 'item') {
        const of = patternOf(local.of, locals);
        return of === undefined ? undefined : `${followed(of)}[]`;
      }
      return local || !stateNames.has(node.name) ? undefined : node.name;
    }
    const read = atCall(node);
    if (read) return `${followed(read.target)}[]`;
    if (node?.type !== 'MemberExpression') return undefined;
    const object = patternOf(node.object as Part, locals);
    if (object === undefined) return undefined;
    const property = node.property as Part;
    return node.computed ? `${followed(object)}[]` : `${followed(object)}.${property.name}`;
  };
  // A reference's path read as its node's, any other as it is.
  const followed = (pattern: string) => {
    const heap = references.get(pattern);
    return heap === undefined ? pattern : `${heap}[]`;
  };
  // The heap an expression's value refers into, where it is a reference.
  const heapOf = (node: Part | undefined, locals: ReadonlyMap<string, Local>) => {
    const pattern = patternOf(node, locals);
    return pattern === undefined ? undefined : references.get(pattern);
  };
  // An expression's text with each field read through a reference reading its node, as
  // vertices[q].name for q.name.
  const followedText = (node: Part, locals: ReadonlyMap<string, Local>): string => {
    const read = atCall(node);
    if (read) return `${read.target}[${followedText(read.argument, locals)}]`;
    // count(n) is the list 0, 1, … up to n − 1 (see countCalls in bound-props.server.ts).
    const counted = countArgument(node) as Part | undefined;
    if (counted)
      return `Array.from({ length: Math.max(0, ${followedText(counted, locals)}) }, (_, k) => k)`;
    if (node.type !== 'MemberExpression') return text(node);
    const object = node.object as Part;
    const heap = heapOf(object, locals);
    const inner = followedText(object, locals);
    // Past either end at(p) is nothing, so what is read from it is nothing too.
    const past = atCall(object) ? '?' + (node.computed ? '.' : '') : '';
    return `${heap === undefined ? inner : `${heap}[${inner}]`}${past}${source.slice(object.end, node.end)}`;
  };
  // The test that an expression reads past an end through an at(p) in it, if one does.
  const pastEnd = (node: unknown, locals: ReadonlyMap<string, Local>): string[] => {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap((child) => pastEnd(child, locals));
    const part = node as Part;
    const read = atCall(part);
    const own = read
      ? [`${read.target}[${followedText(read.argument, locals)}] === undefined`]
      : [];
    return [
      ...own,
      ...Object.entries(part).flatMap(([key, child]) =>
        key === 'parent' || key === 'metadata' ? [] : pastEnd(child, locals)
      )
    ];
  };
  // Each field read through a reference in an expression reads its node instead.
  const follow = (node: unknown, locals: ReadonlyMap<string, Local>, chained = ''): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => follow(child, locals));
    const part = node as Part;
    // at(p) reads its element, as vertices[p]; past either end it is nothing, and so is what is
    // read from it.
    const read = atCall(part);
    if (read) {
      insertions.push(
        {
          at: part.start ?? 0,
          text: `${read.target}[`,
          remove: (read.argument.start ?? 0) - (part.start ?? 0)
        },
        {
          at: read.argument.end ?? 0,
          text: `]${chained}`,
          remove: (part.end ?? 0) - (read.argument.end ?? 0)
        }
      );
      follow(read.argument, locals);
      return;
    }
    if (part.type === 'MemberExpression') {
      const object = part.object as Part;
      if (atCall(object)) {
        follow(object, locals, part.computed ? '?.' : '?');
        follow(part.property, locals);
        return;
      }
      const heap = heapOf(object, locals);
      if (heap !== undefined)
        insertions.push(
          { at: object.start ?? 0, text: `${heap}[` },
          { at: object.end ?? 0, text: ']' }
        );
    }
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'metadata') follow(child, locals);
  };
  const indexOf = (local: Extract<Local, { kind: 'item' }>): string => {
    if (local.each.index) return local.each.index;
    let added = indexed.get(local.each);
    if (!added) {
      added = `__k${indexed.size + 1}`;
      indexed.set(local.each, added);
      insertions.push({ at: (local.each.context as Part).end ?? 0, text: `, ${added}` });
    }
    return added;
  };
  const slotOf = (argument: Part | undefined, locals: ReadonlyMap<string, Local>): string => {
    if (argument?.type === 'Identifier' && typeof argument.name === 'string') {
      const local = locals.get(argument.name);
      if (local?.kind === 'value') return ' inherit';
      if (local?.kind === 'item')
        return ` of={${followedText(local.of, locals)}} at={${indexOf(local)}}`;
      if (local?.kind === 'other') return ` of={${argument.name}}`;
      return stateNames.has(argument.name) ? ` path="${argument.name}"` : '';
    }
    const read = atCall(argument);
    if (read) return ` of={${read.target}} at={${followedText(read.argument, locals)}}`;
    if (argument?.type === 'MemberExpression') {
      const object = followedText(argument.object as Part, locals);
      const property = argument.property as Part;
      return argument.computed
        ? ` of={${object}} at={${text(property)}}`
        : ` of={${object}} at="${property.name}"`;
    }
    return '';
  };
  const placeOf = (render: Part): string => {
    const place = places.get(render.start ?? 0);
    return place ? ` place={${place}}` : '';
  };
  const walk = (node: unknown, locals: ReadonlyMap<string, Local>): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, locals);
      return;
    }
    const part = node as Part;
    // A field read through a reference, in what this part reads, reads its node.
    if (references.size || atTargets.size) follow(part.expression, locals);
    if (part.type === 'RenderTag') {
      const call = part.expression as Part;
      const callee = call?.callee as Part | undefined;
      const given = (call?.arguments as Part[] | undefined) ?? [];
      // Narrowed to a label, as {@render Greater(@inner)}, written Greater(ℓinner) by then (see
      // label-values.ts): the application made inside that label's code.
      const narrowed =
        given.length === 1 &&
        given[0].type === 'Identifier' &&
        typeof given[0].name === 'string' &&
        given[0].name.startsWith('ℓ')
          ? given[0]
          : undefined;
      if (
        typeof callee?.name === 'string' &&
        operators.has(callee.name) &&
        (!given.length || narrowed)
      ) {
        const key = `__applied_${callee.name}${narrowed ? `_${narrowed.name}` : ''}`;
        rendered.set(part.start ?? 0, [key]);
        insertions.push(
          {
            at: part.start ?? 0,
            text: `<SverlinSlot path="${key}" reads={["${key}"]} site="${siteOf(source, part.start ?? 0)}"${placeOf(part)}>`
          },
          narrowed
            ? {
                at: narrowed.start ?? 0,
                text: key,
                remove: (narrowed.end ?? 0) - (narrowed.start ?? 0)
              }
            : { at: (call.end ?? 1) - 1, text: key },
          { at: part.end ?? 0, text: '</SverlinSlot>' }
        );
        return;
      }
      if (typeof callee?.name === 'string' && views.has(callee.name)) {
        const [argument] = (call.arguments as Part[] | undefined) ?? [];
        // The state variables the value comes from, through an {#each} item too: it is drawn
        // hidden at a step where one is out of scope.
        const local = argument?.type === 'Identifier' ? locals.get(argument.name ?? '') : undefined;
        const reads = [
          ...new Set([
            ...stateReadsOf(argument, scoped, locals),
            ...(local?.kind === 'item' ? stateReadsOf(local.of, scoped, locals) : [])
          ])
        ];
        rendered.set(part.start ?? 0, reads);
        const past = pastEnd(argument, locals);
        // A value read through at(p) is drawn inside a slot naming p, the place its nodes move as.
        const through = readThrough(argument);
        insertions.push(
          {
            at: part.start ?? 0,
            text: `${through ? `<SverlinSlot${slotOf(through.argument, locals)}>` : ''}<SverlinSlot${slotOf(argument, locals)}${through ? ' through' : ''}${reads.length ? ` reads={${JSON.stringify(reads)}}` : ''}${past.length ? ` missing={${past.join(' || ')}}` : ''} site="${siteOf(source, part.start ?? 0)}"${placeOf(part)}>`
          },
          { at: part.end ?? 0, text: `</SverlinSlot>${through ? '</SverlinSlot>' : ''}` }
        );
      }
      return;
    }
    if (part.type === 'InlineComponent' && part.name === 'Link') {
      // A link's end given a position, as in from={edge.from}, joins the node drawing the element
      // it points at; the link is told where the position comes from, as a slot is.
      const reads: string[] = [];
      for (const attribute of (part.attributes as Part[] | undefined) ?? []) {
        if (
          attribute.type !== 'Attribute' ||
          (attribute.name !== 'from' && attribute.name !== 'to')
        )
          continue;
        const [value] = Array.isArray(attribute.value) ? (attribute.value as Part[]) : [];
        const expression =
          value?.type === 'MustacheTag' || value?.type === 'ExpressionTag'
            ? (value.expression as Part)
            : undefined;
        const slot = slotOf(expression, locals);
        reads.push(...stateReadsOf(expression, scoped, locals));
        const end = attribute.name;
        // An {#each} index, as from={k} in {#each vertices as v, k}: a position into what it walks.
        // Or arithmetic of one index and numbers, as to={2 * k + 1}: a position into the same.
        const indexIn = (node: Part | undefined): string[] | undefined => {
          if (node?.type === 'Literal' && typeof node.value === 'number') return [];
          if (node?.type === 'Identifier') {
            const found = locals.get(String(node.name ?? ''));
            return found?.kind === 'position' ? [String(node.name)] : undefined;
          }
          if (node?.type === 'BinaryExpression' || node?.type === 'UnaryExpression') {
            const parts = [node.left, node.right, node.argument].filter(Boolean) as Part[];
            const names = parts.map(indexIn);
            return names.every(Boolean) ? (names as string[][]).flat() : undefined;
          }
          return undefined;
        };
        const names = indexIn(expression);
        const local =
          names && names.length > 0 && new Set(names).size === 1 ? locals.get(names[0]) : undefined;
        if (local?.kind === 'position') {
          insertions.push({
            at: (part.start ?? 0) + '<Link'.length,
            text: ` __${end}In={${followedText(local.of, locals)}}`
          });
          continue;
        }
        // The value the view draws, as to={this} in a view of a reference type: its place is the
        // slot the view is drawn in.
        if (slot === ' inherit') {
          insertions.push({ at: (part.start ?? 0) + '<Link'.length, text: ` __${end}Inherit` });
          continue;
        }
        if (!/ (path|at)=/u.test(slot)) {
          // Neither an index nor a position the state holds: it would name no element.
          if (expression && slot === '')
            unresolvedEnds.push({
              end,
              written: source.slice(expression.start ?? 0, expression.end ?? 0),
              start: expression.start ?? 0
            });
          continue;
        }
        insertions.push({
          at: (part.start ?? 0) + '<Link'.length,
          text: slot
            .replace(' path=', ` __${end}Path=`)
            .replace(' of=', ` __${end}Of=`)
            .replace(' at=', ` __${end}At=`)
        });
      }
      // An end read from a variable out of scope or a label that gave no value draws the link hidden.
      if (reads.length)
        insertions.push({
          at: (part.start ?? 0) + '<Link'.length,
          text: ` __reads={${JSON.stringify([...new Set(reads)])}}`
        });
      // Its label, its children, draws views as any node does.
      walk(part.children as Part[] | undefined, locals);
      return;
    }
    // A <When of="@label">, an {#if} on the label's key by now (see label-values.ts): its
    // contents in a slot hidden where the step is inside no run of the label, keeping their room.
    const test = part.type === 'IfBlock' ? (part.expression as Part | undefined) : undefined;
    if (test?.type === 'Identifier' && isDuringKey(String(test.name ?? ''))) {
      const start = part.start ?? 0;
      const opened = source.indexOf('}', test.end ?? start) + 1;
      insertions.push({
        at: start,
        text: `<SverlinSlot inherit reads={["${String(test.name)}"]}>`,
        remove: opened - start
      });
      // The contents' own insertions first, so at a position both mark, what they open closes
      // before the slot does (see withInsertions).
      walk(part.children, locals);
      insertions.push({
        at: (part.end ?? 0) - '{/if}'.length,
        text: '</SverlinSlot>',
        remove: '{/if}'.length
      });
      return;
    }
    if (part.type === 'EachBlock') {
      const context = part.context as Part | undefined;
      const inner = new Map(locals);
      if (context?.type === 'Identifier' && typeof context.name === 'string') {
        const local = { kind: 'item', of: part.expression as Part, each: part } as const;
        inner.set(context.name, local);
        // A node holding all of an item, as its value and the labels under it, keeps the item's
        // end slots in the sequence the items are arranged in (see Node.svelte); a snippet the
        // item declares for its parts draws nothing there. An item drawn by one node in each
        // branch of an {#if}, as a sorted cell or an unsorted one, has that node at every step,
        // so each branch's node is the item's; else the element inside would keep the end slots
        // within the branch's node, stacked against its own box.
        const rootsOf = (children: Part[] | undefined) =>
          (children ?? []).filter(
            (child) =>
              child.type !== 'SnippetBlock' &&
              !(child.type === 'Text' && String(child.data ?? '').trim() === '')
          );
        const isNode = (child: Part | undefined) =>
          child?.type === 'InlineComponent' && child.name === 'Node';
        const branchNodes = (block: Part): Part[] | undefined => {
          const own = rootsOf(block.children as Part[] | undefined);
          if (own.length !== 1 || !isNode(own[0])) return undefined;
          const otherwise = block.else as Part | undefined;
          if (!otherwise) return own;
          const rest = rootsOf(otherwise.children as Part[] | undefined);
          const chained = rest.length === 1 && rest[0].type === 'IfBlock' && rest[0].elseif;
          const after = chained
            ? branchNodes(rest[0])
            : rest.length === 1 && isNode(rest[0])
              ? rest
              : undefined;
          return after ? [...own, ...after] : undefined;
        };
        const roots = rootsOf(part.children as Part[] | undefined);
        const [root] = roots;
        const itemNodes =
          roots.length !== 1
            ? []
            : isNode(root)
              ? [root]
              : root.type === 'IfBlock'
                ? (branchNodes(root) ?? [])
                : [];
        for (const node of itemNodes)
          insertions.push({
            at: (node.start ?? 0) + '<Node'.length,
            text: ` __itemOf={${followedText(local.of, locals)}} __itemAt={${indexOf(local)}}`
          });
      } else for (const name of patternNames(context)) inner.set(name, { kind: 'other' });
      // The index of an {#each} over a collection is a position into it, as a link's end.
      if (typeof part.index === 'string')
        inner.set(part.index, { kind: 'position', of: part.expression as Part });
      walk(part.children, inner);
      walk(part.else, locals);
      return;
    }
    if (part.type === 'SnippetBlock') {
      const inner = new Map(locals);
      const parameters = (part.parameters as Part[] | undefined) ?? [];
      const component = componentNames.has((part.expression as Part | undefined)?.name ?? '');
      parameters.forEach((parameter, index) => {
        for (const name of patternNames(parameter))
          inner.set(name, component && index === 0 ? { kind: 'value' } : { kind: 'other' });
      });
      walk(part.children, inner);
      return;
    }
    // A node writing text around views reads as a line of text, its views set inline in it, the
    // branches of its blocks included, as a sentence chosen by {#if}.
    if (part.type === 'InlineComponent' && part.name === 'Node') {
      const attributes = (part.attributes as Part[] | undefined) ?? [];
      const inline = (nodes: Part[]): Part[] =>
        nodes.flatMap((child) =>
          ['IfBlock', 'ElseBlock', 'EachBlock', 'KeyBlock'].includes(child.type ?? '')
            ? inline([
                ...((child.children as Part[] | undefined) ?? []),
                ...(child.else ? [child.else as Part] : [])
              ])
            : [child]
        );
      const children = inline((part.children as Part[] | undefined) ?? []);
      const text = children.some(
        (child) =>
          (child.type === 'Text' && String(child.data ?? '').trim() !== '') ||
          child.type === 'MustacheTag' ||
          child.type === 'ExpressionTag'
      );
      const views = children.some(
        (child) => child.type === 'RenderTag' || child.type === 'InlineComponent'
      );
      // A grid's child holding only nodes can place them on the grid's tracks (see subgrid in
      // Node.svelte).
      const placed = attributes.some((attribute) =>
        ['row', 'col', 'rowSpan', 'colSpan'].includes(attribute.name ?? '')
      );
      if (placed && views && !text)
        insertions.push({ at: (part.start ?? 0) + '<Node'.length, text: ' __nodes' });
      if (text && views && !attributes.some((attribute) => attribute.name === 'layout'))
        insertions.push({ at: (part.start ?? 0) + '<Node'.length, text: ' __text' });
      // A node holding one {#each} and nothing else but links between its items is a collection:
      // told what the {#each} goes over, it arranges its items alike (see Node.svelte).
      else {
        const [each, ...others] = ((part.children as Part[] | undefined) ?? []).filter(
          (child) =>
            !(child.type === 'Text' && String(child.data ?? '').trim() === '') &&
            !(child.type === 'InlineComponent' && child.name === 'Link')
        );
        const over = each?.expression as Part | undefined;
        if (each?.type === 'EachBlock' && !others.length && over)
          insertions.push({
            at: (part.start ?? 0) + '<Node'.length,
            text: ` __items={${followedText(over, locals)}}`
          });
      }
    }
    if (part.type === 'ConstTag') {
      // A {@const} names a value of its own, which is an element only if it is an array or object.
      const assigned = (part.expression as Part | undefined)?.left;
      const declaration = part.declaration as { declarations?: { id?: unknown }[] } | undefined;
      for (const id of [assigned, ...(declaration?.declarations ?? []).map(({ id }) => id)])
        for (const name of patternNames(id))
          (locals as Map<string, Local>).set(name, { kind: 'other' });
      return;
    }
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'expression' && key !== 'attributes') walk(child, locals);
    for (const attribute of (part.attributes as unknown[] | undefined) ?? [])
      walk(attribute, locals);
  };
  walk(markup, new Map());
  return insertions;
}

/** The names a parameter or declaration pattern binds. */
function patternNames(pattern: unknown): string[] {
  const names = new Set<string>();
  collectPattern(pattern, names);
  return [...names];
}

/**
 * Markup appended to the view so the page can render a component for given arguments: under the
 * reserved prop __probe, every case of one component, each a list of arguments, with the way each
 * of its tests goes (see branchInsertions).
 */
export function probeMarkup(signatures: ComponentSignatures): string {
  return Object.entries(signatures)
    .map(
      ([name]) =>
        `{#if __probe?.component === '${name}'}{#each __probe.cases as __case}{@render ${name}(__case, __probe.branches)}{/each}{/if}`
    )
    .join('');
}

/** The test of each {#if} and {:else if} in a view, a node's when among them, in source order. */
function branchTests(view: SvelteNode): { start: number; end: number }[] {
  const tests: { start: number; end: number }[] = [];
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(walk);
    const node = value as Record<string, unknown> & { type?: string };
    const test = node.expression as { start?: number; end?: number } | undefined;
    if (node.type === 'IfBlock' && test?.start !== undefined && test.end !== undefined)
      tests.push({ start: test.start, end: test.end });
    for (const [key, child] of Object.entries(node))
      if (key !== 'parent' && key !== 'expression') walk(child);
  };
  walk(view.children);
  return tests.sort((a, b) => a.start - b.start);
}

/**
 * A view sized for every input, not only the one run: while it is measured, each of its tests is
 * made to go each way, whatever its values say, so every branch it could draw is measured (see
 * componentProbes); shown, each test reads its values. The view takes the ways as a second
 * argument, which only measuring gives; a test inside an {#each} goes one way for every item at
 * once, as the items share their tracks.
 */
export function branchInsertions(views: readonly { node: SvelteNode }[]): Insertion[] {
  return views.flatMap(({ node }) => {
    const parameter = node.parameters?.[0] as { end?: number } | undefined;
    const tests = branchTests(node);
    if (parameter?.end === undefined || !tests.length) return [];
    return [
      { at: parameter.end, text: ', __b' },
      ...tests.flatMap(({ start, end }, index) => [
        { at: start, text: `(__b ? __b[${index}] : (` },
        { at: end, text: '))' }
      ])
    ];
  });
}

/** The components that view each type, in source order. */
export function viewsOf(signatures: ComponentSignatures): Record<string, string[]> {
  const views: Record<string, string[]> = {};
  for (const [name, type] of Object.entries(signatures)) (views[type] ??= []).push(name);
  return views;
}

/** A component and the values of its type the page draws it with. */
export type ComponentProbe = {
  name: string;
  cases: unknown[];
  /**
   * An integer range too large to draw whole, for a component that shows its value: the page also
   * draws it with the integer in the range that prints widest in the font the value is drawn in.
   */
  range?: { min: number; max: number; places?: number };
  /** Its tests, each drawn going each way, so every branch it could draw is measured. */
  branches?: number;
  /**
   * The unions its type is a member of: a value of a union is drawn by its member's view, so the
   * views of a union's members share the largest box among them, and whatever holds the union has
   * room for every member, not only the ones a step reaches.
   */
  unions?: string[];
};

// A component's cases are drawn in one pass of the page for each way its tests can go; this bounds
// them all together, so sizing a component stays about as quick as a step (a case costs about a
// millisecond of server layout, measured on 4 November 2026).
const maximumCases = 256;

/** The values a parameter is drawn with: every value, when there are few enough, and the widest. */
type ProbeValues = { every?: unknown[]; widest: unknown[] };

type Steps = readonly { state: TraceState; types: TypeMap }[];

/**
 * The view's components, each after the components it renders, directly or through a type's name
 * choosing among them, so their boxes are known when it is drawn; with the values to draw it with
 * and its tests (see branchInsertions). Every value is drawn where every value with every way its
 * tests go stays within the limit, and otherwise the widest: each test going each way covers what
 * else a value could change. A component with more cases than that is a problem.
 */
export function componentProbes(
  found: { name: string; start: number; node: SvelteNode }[],
  signatures: ComponentSignatures,
  choices: Record<string, readonly string[]>,
  domain: DomainRegistry,
  steps: Steps
): { probes: ComponentProbe[]; problems: ComponentProblem[] } {
  // Each union with its members; a value of a union draws its member's view.
  const unions = Object.values(domain.structures).flatMap((structure) =>
    structure.kind === 'union' ? [structure] : []
  );
  const viewsOfType = (type: string) => [
    ...Object.keys(signatures).filter((name) => signatures[name] === type),
    ...(choices[type] ?? [])
  ];
  const renders = new Map(
    found.map(({ name, node }) => [
      name,
      [...readsOf(node)].flatMap((read) => {
        const union = unions.find((each) => each.name === read);
        if (union) return union.members.flatMap(viewsOfType);
        return Object.hasOwn(signatures, read) ? [read] : (choices[read] ?? []);
      })
    ])
  );
  const ordered: string[] = [];
  const visit = (name: string, visiting: Set<string>): void => {
    if (ordered.includes(name) || visiting.has(name)) return;
    visiting.add(name);
    for (const rendered of renders.get(name) ?? []) visit(rendered, visiting);
    ordered.push(name);
  };
  for (const name of Object.keys(signatures)) visit(name, new Set());
  const valuesOf = probeValues(domain, steps);
  const views = new Set([...Object.keys(signatures), ...Object.keys(choices)]);
  // A query's rows are spans, each its own call or pass rather than places alike, so a view of
  // them takes no box shared by every row: each row keeps the largest size it reaches, as any node
  // does, and a leaf of a tree of calls is not given room for the whole array.
  const rows = new Set(
    Object.values(domain.structures).flatMap((structure) =>
      structure.kind === 'collection' && structure.name.startsWith('⁎') ? [structure.element] : []
    )
  );
  const probes: ComponentProbe[] = [];
  const problems: ComponentProblem[] = [];
  for (const name of ordered) {
    const type = signatures[name];
    const { node } = found.find((component) => component.name === name)!;
    const parameter = node.parameters?.[0]?.name ?? '';
    // A part the component never reads is drawn with one value too: a record of a label's span
    // holds every variable in scope, most of which its view never draws.
    const uses = valueUses(node.children, new Set([parameter]), views);
    const single = onlyViewedOrUnread(uses);
    const spanProblem = spanFieldProblem(type, parameter, uses, domain);
    if (spanProblem) {
      problems.push({ message: spanProblem, start: node.start ?? 0 });
      continue;
    }
    if (rows.has(type)) continue;
    const values = valuesOf(type, parameter, single);
    const branches = branchTests(node).length;
    const ways = 2 ** branches;
    const cases =
      values && (values.every?.length ?? Infinity) * ways <= maximumCases
        ? values.every
        : values?.widest;
    const atom = domain.atoms[type];
    const range =
      (atom?.base === 'integer' || (atom?.base === 'number' && atom.places !== undefined)) &&
      !atom.values &&
      atom.min !== undefined &&
      atom.max !== undefined &&
      cases === values?.widest &&
      !single(parameter)
        ? { min: atom.min!, max: atom.max!, ...(atom.places ? { places: atom.places } : {}) }
        : undefined;
    const memberOf = unions.filter(({ members }) => members.includes(type)).map((u) => u.name);
    if (cases && cases.length * ways <= maximumCases)
      probes.push({
        name,
        cases,
        ...(range ? { range } : {}),
        ...(branches ? { branches } : {}),
        ...(memberOf.length ? { unions: memberOf } : {})
      });
    else
      problems.push({
        message: branches
          ? `${name} would be drawn ${cases ? cases.length * ways : 'too many'} times to size it, with ${cases?.length ?? 'too many'} values of ${type} each way its ${branches} tests can go, more than the ${maximumCases} a component can take. Give ${type} fewer values, or draw the parts its tests decide with components of their own.`
          : `${name} would be drawn with ${cases?.length ?? 'too many'} values of ${type} to size it, more than the ${maximumCases} a component can take. Give ${type} fewer values, or draw its parts with components of their own.`,
        start: found.find((component) => component.name === name)?.start ?? 0
      });
  }
  return { probes, problems };
}

/**
 * Every combination of a record's field values: every value of each, while the cases fit, and only
 * the widest values of the fields with the most values otherwise.
 */
function combinations(fields: (ProbeValues | undefined)[]): unknown[][] | undefined {
  if (!fields.every((values) => values !== undefined)) return undefined;
  const chosen = fields.map((values) => values.every ?? values.widest);
  const count = () => chosen.reduce((total, values) => total * values.length, 1);
  const largestFirst = chosen
    .map((_, index) => index)
    .sort((a, b) => chosen[b].length - chosen[a].length);
  for (const index of largestFirst) {
    if (count() <= maximumCases) break;
    chosen[index] = fields[index].widest;
  }
  if (count() > maximumCases) return undefined;
  return chosen.reduce<unknown[][]>(
    (cases, values) => cases.flatMap((before) => values.map((value) => [...before, value])),
    [[]]
  );
}

/**
 * The values of each domain type. A collection is filled to its type's max, or a record's heap to
 * the longest of it in the trace, with each value of its element type in turn: rows and columns are widest when full, and
 * the items in them keep their components' boxes, so which value is where does not change the size.
 * A part of the value at a path that `single` names is drawn with one value: it is passed only to
 * views, which keep their boxes whichever value they show.
 */
export function probeValues(
  domain: DomainRegistry,
  steps: Steps
): (type: string, path?: string, single?: (path: string) => boolean) => ProbeValues | undefined {
  const { longest, seen } = traceExtents(steps);
  const valuesOf = (
    type: string,
    path = '',
    single: (path: string) => boolean = () => false
  ): ProbeValues | undefined => {
    const values = allValuesOf(type, path, single);
    return values && single(path)
      ? { every: [values.widest[0]], widest: [values.widest[0]] }
      : values;
  };
  const allValuesOf = (
    type: string,
    path: string,
    single: (path: string) => boolean
  ): ProbeValues | undefined => {
    // A comparison's true or false, which no domain type holds, drawn as text.
    if (type === 'boolean' && !domain.atoms[type])
      return { every: [true, false], widest: [true, false] };
    const atom = domain.atoms[type];
    // A position runs from -1 to its collection's max, as its type does; one into a heap, over
    // the longest of it in the trace, and as far past its ends as the trace records one.
    if (atom) {
      const values = [...(seen.get(type) ?? [])];
      if (!atom.index || atom.max !== undefined) return atomValues(atom, values);
      const ends = (values as number[]).concat(0, (longest.get(atom.index) ?? 1) - 1);
      return atomValues({ ...atom, min: Math.min(...ends), max: Math.max(...ends) }, values);
    }
    const structure = domain.structures[type];
    switch (structure?.kind) {
      case 'collection': {
        const element = valuesOf(structure.element, `${path}[]`, single);
        const length = structure.max ?? longest.get(type) ?? 0;
        const fill = (values: unknown[]) =>
          values.map((value) => Array.from({ length }, () => value));
        return (
          element && { every: element.every && fill(element.every), widest: fill(element.widest) }
        );
      }
      case 'union': {
        const members = structure.members.map((member) => valuesOf(member, path, single));
        if (!members.every((values) => values !== undefined)) return undefined;
        const every = members.every((values) => values.every)
          ? members.flatMap((values) => values.every!)
          : undefined;
        return {
          every: every && every.length <= maximumCases ? every : undefined,
          widest: members.flatMap((values) => values.widest)
        };
      }
      // A reference is drawn as the element it refers to.
      case 'ref':
        return valuesOf(structure.element, path, single);
      case 'record': {
        const names = Object.keys(structure.fields);
        // A field the view never reads, of no type it can measure, is drawn as nothing.
        const fields = names.map((name) => {
          const at = path ? `${path}.${name}` : name;
          return (
            valuesOf(structure.fields[name], at, single) ??
            (single(at) ? { every: [null], widest: [null] } : undefined)
          );
        });
        const records = (cases: unknown[][] | undefined) =>
          cases?.map((values) =>
            Object.fromEntries(names.map((name, index) => [name, values[index]]))
          );
        const widest = records(
          combinations(fields.map((values) => values && { widest: values.widest }))
        );
        return widest && { every: records(combinations(fields)), widest };
      }
    }
    return undefined;
  };
  return valuesOf;
}

/**
 * An atomic type's values. A number prints widest at an end of its range, or at the value in the
 * trace with the most digits, as a fraction can be; text, at its longest values.
 */
function atomValues(atom: AtomType, seen: readonly unknown[]): ProbeValues | undefined {
  if (atom.base === 'boolean') return { every: [true, false], widest: [true, false] };
  const { min, max } = atom;
  const listed =
    atom.values ??
    (atom.base === 'integer' && min !== undefined && max !== undefined && max - min < maximumCases
      ? Array.from({ length: max - min + 1 }, (_, index) => min + index)
      : atom.base === 'number' &&
          atom.places !== undefined &&
          min !== undefined &&
          max !== undefined &&
          (max - min) * 10 ** atom.places < maximumCases
        ? Array.from(
            { length: Math.round((max - min) * 10 ** atom.places) + 1 },
            (_, index) =>
              Math.round((min + index / 10 ** atom.places!) * 10 ** atom.places!) /
              10 ** atom.places!
          )
        : undefined);
  if (atom.base === 'text')
    return listed && { every: [...listed], widest: longestPrinted(listed, 2) };
  const ends = listed
    ? [Math.min(...(listed as number[])), Math.max(...(listed as number[]))]
    : min !== undefined && max !== undefined
      ? [min, max]
      : undefined;
  if (!ends) return undefined;
  return {
    every: listed && [...listed],
    widest: [...new Set([...ends, ...longestPrinted(listed ?? seen, 1)])]
  };
}

function longestPrinted(values: readonly unknown[], count: number): unknown[] {
  return [...values].sort((a, b) => String(b).length - String(a).length).slice(0, count);
}

/** The most elements each collection type holds, and the values each atomic type takes, at any step. */
function traceExtents(steps: Steps) {
  const longest = new Map<string, number>();
  const seen = new Map<string, Set<unknown>>();
  const walk = (value: unknown, path: string, types: TypeMap): void => {
    const type = types[path];
    if (value === null || typeof value !== 'object') {
      if (type) seen.set(type, (seen.get(type) ?? new Set()).add(value));
    } else if (Array.isArray(value)) {
      if (type) longest.set(type, Math.max(longest.get(type) ?? 0, value.length));
      value.forEach((item, index) => walk(item, `${path}[${index}]`, types));
    } else for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`, types);
  };
  for (const { state, types } of steps)
    for (const [name, value] of Object.entries(state)) walk(value, name, types);
  return { longest, seen };
}

/**
 * The collection types whose length is the same at every step of the run: every value of the type,
 * by its path, keeps one length wherever it is recorded.
 */
export function steadyLengths(steps: Steps): Set<string> {
  const lengths = new Map<string, number>();
  const types = new Map<string, string>();
  const varying = new Set<string>();
  const walk = (value: unknown, path: string, typed: TypeMap): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      const type = typed[path];
      if (type) {
        const known = lengths.get(path);
        if (known !== undefined && known !== value.length) varying.add(type);
        lengths.set(path, value.length);
        types.set(path, type);
      }
      value.forEach((item, index) => walk(item, `${path}[${index}]`, typed));
    } else for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`, typed);
  };
  for (const { state, types: typed } of steps)
    for (const [name, value] of Object.entries(state)) walk(value, name, typed);
  return new Set([...types.values()].filter((type) => !varying.has(type)));
}

/**
 * Whether a path's value is passed only to views: it, or a value holding it, is passed to one, and
 * neither it nor anything holding or held by it is read for anything else.
 */
export function onlyViewed({
  viewed,
  placed
}: {
  viewed: ReadonlySet<string>;
  placed: ReadonlySet<string>;
}): (path: string) => boolean {
  const within = (path: string, outer: string) =>
    path === outer || path.startsWith(`${outer}.`) || path.startsWith(`${outer}[`);
  return (path) =>
    [...viewed].some((view) => within(path, view)) &&
    ![...placed].some((read) => within(path, read) || within(read, path));
}

/**
 * What is wrong with a view of a label's span reading its record: a field no variable in scope at
 * its stops has, or one with no type to measure it by.
 */
function spanFieldProblem(
  type: string,
  parameter: string,
  uses: { viewed: ReadonlySet<string>; placed: ReadonlySet<string> },
  domain: DomainRegistry
): string | undefined {
  const record = domain.structures[type];
  if (!type.startsWith('ℓ') || record?.kind !== 'record') return undefined;
  const label = `@${type.slice(1).replaceAll('ˑ', '.')}`;
  for (const path of [...uses.viewed, ...uses.placed]) {
    if (!path.startsWith(`${parameter}.`)) continue;
    const field = path.slice(parameter.length + 1).split(/[.[]/u)[0];
    if (!(field in record.fields))
      return `A view of ${label} reads this.${field}, but ${field} is not in scope where its code runs; it reads the variables in scope there: ${Object.keys(record.fields).join(', ')}.`;
    if (!record.fields[field])
      return `A view of ${label} reads this.${field}, which has no type to measure it by: give it a type where the algorithm computes it, as Int(…).`;
  }
  return undefined;
}

/** As onlyViewed, and also true of a part neither passed to views nor read for placement. */
function onlyViewedOrUnread(uses: {
  viewed: ReadonlySet<string>;
  placed: ReadonlySet<string>;
}): (path: string) => boolean {
  const viewedOnly = onlyViewed(uses);
  const within = (path: string, outer: string) =>
    path === outer || path.startsWith(`${outer}.`) || path.startsWith(`${outer}[`);
  const used = [...uses.viewed, ...uses.placed];
  return (path) =>
    viewedOnly(path) || !used.some((read) => within(path, read) || within(read, path));
}

/**
 * A value the root reads for placement: its path, the step it is first recorded at, and the values
 * of its type it is measured with.
 */
export type Placement = { path: string; step: number; values: unknown[] };

/**
 * The atomic values the root reads for anything but passing to views, such as i in k === i, each
 * with the values of its type: the page measures the view with each in place of the trace's, so
 * the root has room for every value its types allow, not just those the trace reaches.
 */
export function rootPlacements(
  markup: unknown,
  stateNames: readonly string[],
  views: ReadonlySet<string>,
  domain: DomainRegistry,
  steps: Steps
): Placement[] {
  const { placed } = valueUses(markup, new Set(stateNames), views);
  const valuesOf = probeValues(domain, steps);
  return [...placed].flatMap((path) => {
    if (path.includes('[')) return [];
    const step = steps.findIndex(({ types }) => Object.hasOwn(types, path));
    const type = step < 0 ? undefined : steps[step].types[path];
    const values = type && Object.hasOwn(domain.atoms, type) ? valuesOf(type) : undefined;
    if (!values) return [];
    const every = values.every && values.every.length <= maximumCases ? values.every : undefined;
    return [{ path, step, values: every ?? values.widest }];
  });
}
