/**
 * Typed view components: top-level snippets that view one domain type, as in
 * {#snippet IntText(value: Int)}, optionally taking the props of the node they draw, as in
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
import { isDuringKey } from './label-values';
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
  /** The components that are pointers: views of an index type drawn around what they point at. */
  pointers: Set<string>;
  /** Each pointer's <Pointed>, and the name its snippet gives its position. */
  pointed: Map<string, { tag: SvelteNode; parameter: string }>;
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
        message: `${name} takes one value, its type given, as in (value: Int): a component views one domain type.`,
        start: snippet.start ?? 0
      });
    else return typed[0];
    return undefined;
  };
  const pointers = new Set<string>();
  const pointedTags = new Map<string, { tag: SvelteNode; parameter: string }>();
  const pointedIn = (node: SvelteNode): SvelteNode[] =>
    (node.children ?? []).flatMap((child) => [
      ...(child.type === 'InlineComponent' && child.name === 'Pointed' ? [child] : []),
      ...pointedIn(child),
      ...((child as { else?: SvelteNode }).else
        ? pointedIn((child as { else: SvelteNode }).else)
        : [])
    ]);
  for (const node of html?.children ?? []) {
    const pointed = pointedIn(node);
    const type = node.type === 'SnippetBlock' && node.expression?.name ? typeOf(node) : undefined;
    if (!type) {
      for (const tag of pointed)
        problems.push({
          message:
            '<Pointed> stands for the element a position points at, so it belongs in a view of an index type, as in {#snippet Arrow(i: Position)}<Node layout="column"><Pointed /><Node>i</Node></Node>{/snippet}.',
          start: tag.start ?? 0
        });
      continue;
    }
    const name = node.expression?.name as string;
    if (pointed.length > 1)
      problems.push({
        message: `${name} has ${pointed.length} <Pointed>; a pointer draws the element it points at once, so it has one.`,
        start: pointed[1].start ?? 0
      });
    else if (pointed.length) {
      pointers.add(name);
      pointedTags.set(name, { tag: pointed[0], parameter: node.parameters?.[0]?.name ?? '_' });
    }
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
  const named = new Set<string>();
  const snippets = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(snippets);
    const part = node as SvelteNode;
    const name = part.type === 'SnippetBlock' ? part.expression?.name : undefined;
    if (name && named.has(name))
      problems.push({
        message: `Two snippets are named ${name}: a snippet's name is the kind of the nodes it draws, so give each its own.`,
        start: part.start ?? 0
      });
    else if (name) named.add(name);
    if (name && part.parameters?.length && !typeOf(part))
      problems.push({
        message: `${name} takes a parameter without a type: a view takes one value, its type given, as in (value: Int), and a snippet without parameters is a part of the page, as {#snippet Title()}<Node>…</Node>{/snippet}.`,
        start: part.start ?? 0
      });
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'expression') snippets(child);
  };
  snippets(html?.children);
  return { components, roots, valueTypes, pointers, pointed: pointedTags, problems };
}

/** The starts of the <Node> tags in a component that show its value, as `<Node {value} />` does. */
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
  scoped: ReadonlySet<string>
): { name: string; start: number }[] {
  const found: { name: string; start: number }[] = [];
  const walk = (value: unknown, parent?: Record<string, unknown>, key?: string): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item) => walk(item, parent, key));
    const node = value as Record<string, unknown> & { type?: string; name?: string };
    if (node.type === 'RenderTag' || (node.type === 'SnippetBlock' && !isPart(node))) return;
    if (node.type === 'EachBlock') {
      walk(node.body ?? node.children, node, 'body');
      walk(node.fallback ?? node.else, node, 'fallback');
      return;
    }
    // A link's end read straight from a variable or label is drawn hidden where it is absent.
    if (node.type === 'Attribute' && (node.name === 'from' || node.name === 'to')) {
      const [only] = Array.isArray(node.value) ? (node.value as { expression?: unknown }[]) : [];
      if ((only?.expression as { type?: string } | undefined)?.type === 'Identifier') return;
    }
    const member = parent?.type === 'MemberExpression' && key === 'property' && !parent.computed;
    const property = parent?.type === 'Property' && key === 'key' && !parent.computed;
    if (node.type === 'Identifier' && scoped.has(node.name ?? '') && !member && !property)
      found.push({ name: node.name ?? '', start: (node.start as number | undefined) ?? 0 });
    for (const [childKey, child] of Object.entries(node))
      if (childKey !== 'parent' && childKey !== 'loc') walk(child, node, childKey);
  };
  walk(markup);
  return found;
}

/**
 * The variables a component reads that it does not declare: identifiers in its expressions, less
 * member and key names, and less its parameters and the names its blocks and {@const} tags declare.
 */
export function readsOf(snippet: SvelteNode): Set<string> {
  const declared = new Set((snippet.parameters ?? []).map(({ name }) => name ?? ''));
  const read = new Set<string>();
  const walk = (value: unknown, parent?: Record<string, unknown>, key?: string): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, parent, key);
      return;
    }
    const node = value as Record<string, unknown> & { type?: string; name?: string };
    if (node.type === 'Identifier' && typeof node.name === 'string') {
      const member = parent?.type === 'MemberExpression' && key === 'property' && !parent.computed;
      const property = parent?.type === 'Property' && key === 'key' && !parent.computed;
      if (!member && !property) read.add(node.name);
    }
    // Names an {#each} or {@const} declares, and declarators anywhere.
    if (node.type === 'EachBlock') {
      collectPattern(node.context, declared);
      if (typeof node.index === 'string') declared.add(node.index);
    }
    if (node.type === 'VariableDeclarator') collectPattern(node.id, declared);
    for (const [childKey, child] of Object.entries(node))
      if (childKey !== 'parent' && childKey !== 'typeAnnotation') walk(child, node, childKey);
  };
  walk(snippet.children);
  for (const name of declared) read.delete(name);
  return read;
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

/** The view's source with insertions made, each at its position in the original source. */
export function withInsertions(source: string, insertions: readonly Insertion[]): string {
  // From the end, so earlier positions hold; at one position, the last given first, so they read
  // in the order given, as a slot closing before the next one opens.
  const ordered = insertions.map((insertion, order) => ({ ...insertion, order }));
  ordered.sort((a, b) => b.at - a.at || b.order - a.order);
  let result = source;
  for (const { at, text, remove = 0 } of ordered)
    result = `${result.slice(0, at)}${text}${result.slice(at + remove)}`;
  return result;
}

/**
 * The root's pointers, as in {@render Index(i)}: drawn around the element the position points at,
 * not where they are written, so each call is removed from the markup and registered in the root's
 * script (see providePointers in library/type-context.ts). A pointer is rendered at the top of the
 * root, outside blocks other than {#if}, with a position from the state: a variable, an element, or
 * a field. Inside {#if}, it points nowhere at steps where its branch is not taken.
 */
export function pointerCalls(
  markup: unknown,
  source: string,
  stateNames: ReadonlySet<string>,
  /**
   * Each pointer view, with the collection type its index type points into, the code of a
   * function giving its <Pointed>'s props for a position, which links it points at take, the code of
   * a function giving its base kinds (see providePointers), and the scoped variables its view reads;
   * for a position type rendered by name, the code naming the pointer view its variant chose, and
   * whether a render of it inside a <Node> draws its number instead.
   */
  pointers: ReadonlyMap<
    string,
    {
      into: string;
      ref?: boolean;
      paint: string;
      kinds?: string;
      reads?: readonly string[];
      view?: string;
      plainInNode?: boolean;
    }
  >,
  /** The state variables out of scope at some step, which a pointer reading one names. */
  scoped: ReadonlySet<string> = new Set(),
  /**
   * The renders at a place, by where each starts: the code of its place (see Place), and, where it
   * has a choice of its own, of the pointer view it draws and of the choice, which its paint and
   * kinds then follow in place of its type's.
   */
  places: ReadonlyMap<number, { view?: string; choice?: string; place: string }> = new Map()
): { removals: Insertion[]; calls: string[]; problems: ComponentProblem[] } {
  type Part = Record<string, unknown> & {
    type?: string;
    name?: string;
    start?: number;
    end?: number;
  };
  const removals: Insertion[] = [];
  const calls: string[] = [];
  const problems: ComponentProblem[] = [];
  const text = (node: Part) => source.slice(node.start, node.end);
  const visit = (
    node: unknown,
    where: 'top' | 'block' | 'component',
    conditions: readonly string[] = [],
    inNode = false
  ): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, where, conditions, inNode);
      return;
    }
    const part = node as Part;
    if (part.type === 'RenderTag') {
      const call = part.expression as Part;
      const name = (call?.callee as Part | undefined)?.name;
      if (typeof name !== 'string' || !pointers.has(name)) return;
      if (inNode && pointers.get(name)?.plainInNode) return;
      const [argument] = (call.arguments as Part[] | undefined) ?? [];
      const position =
        argument?.type === 'Identifier' && stateNames.has(argument.name ?? '')
          ? `path: ${JSON.stringify(argument.name)}`
          : argument?.type === 'MemberExpression'
            ? `of: () => ${text(argument.object as Part)}, at: () => ${
                argument.computed
                  ? text(argument.property as Part)
                  : JSON.stringify((argument.property as Part).name)
              }`
            : undefined;
      const start = part.start ?? 0;
      if (where !== 'top' || inNode)
        problems.push({
          message: `${name} is a pointer, drawn around the element its position points at, so it is rendered at the top of the view, outside blocks other than {#if} and outside snippets, as in {@render ${name}(i)}${
            inNode && pointers.get(name)?.view
              ? `; or, to show the position as a number here, add a view that draws it, as {#snippet ${name}Text(p: ${name})}<Node value={p} />{/snippet}`
              : ''
          }.`,
          start
        });
      else if (!position)
        problems.push({
          message: `${name} is a pointer, and points at the element its position names, so it is given a position from the state, such as i or edges[e].to.`,
          start
        });
      else {
        const found = pointers.get(name);
        const place = places.get(start);
        const own = (code: string | undefined) =>
          code && place?.choice
            ? code.replaceAll(`[__pointer_${name}]`, `[${place.choice}]`)
            : code;
        const pointer = found && { ...found, paint: own(found.paint)!, kinds: own(found.kinds) };
        const reads = [...new Set([...stateReadsOf(argument, scoped), ...(pointer?.reads ?? [])])];
        calls.push(
          `{ view: () => ${place?.view ?? pointer?.view ?? name}, value: () => ${text(argument)}, ${position}, ${reads.length ? `reads: ${JSON.stringify(reads)}, ` : ''}${conditions.length ? `shown: () => ${conditions.join(' && ')}, ` : ''}${pointer?.ref ? 'ref: true, ' : ''}${place ? `place: ${place.place}, ` : ''}into: ${JSON.stringify(pointer?.into)}, paint: ${pointer?.paint}${pointer?.kinds ? `, kinds: ${pointer.kinds}` : ''} }`
        );
        removals.push({ at: start, text: '', remove: (part.end ?? start) - start });
      }
      return;
    }
    // A pointer at each position a label has given so far, as {#each runs(@check.at) as p}
    // {@render Checked(p)}{/each}, written {#each ϟcheckˑat as p} by then (see label-values.ts).
    const listed = part.type === 'EachBlock' && where === 'top' ? listPointer(part) : undefined;
    if (listed) {
      const pointer = pointers.get(listed.view);
      calls.push(
        `{ view: () => ${pointer?.view ?? listed.view}, value: () => undefined, path: ${JSON.stringify(listed.list)}, list: () => ${listed.list}, ${conditions.length ? `shown: () => ${conditions.join(' && ')}, ` : ''}into: ${JSON.stringify(pointer?.into)}, paint: ${pointer?.paint}${pointer?.kinds ? `, kinds: ${pointer.kinds}` : ''} }`
      );
      const start = part.start ?? 0;
      removals.push({ at: start, text: '', remove: (part.end ?? start) - start });
      return;
    }
    if (part.type === 'IfBlock' && where === 'top') {
      const test = `(${text(part.expression as Part)})`;
      visit(part.children, where, [...conditions, test], inNode);
      visit(part.else, where, [...conditions, `!${test}`], inNode);
      return;
    }
    const inner =
      part.type === 'SnippetBlock'
        ? 'component'
        : where === 'top' &&
            typeof part.type === 'string' &&
            part.type.endsWith('Block') &&
            part.type !== 'ElseBlock' &&
            part.type !== 'Fragment'
          ? 'block'
          : where;
    const inside = inNode || (part.type === 'InlineComponent' && part.name === 'Node');
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'expression') visit(child, inner, conditions, inside);
  };
  /** An {#each} over a label's values so far whose only content is a pointer at each. */
  const listPointer = (each: Part): { view: string; list: string } | undefined => {
    const list = each.expression as Part | undefined;
    const item = each.context as Part | undefined;
    if (list?.type !== 'Identifier' || !list.name?.startsWith('ϟ') || item?.type !== 'Identifier')
      return undefined;
    const content =
      ((each.body as Part | undefined)?.nodes as Part[] | undefined) ??
      (each.children as Part[] | undefined) ??
      [];
    const parts = content.filter(
      (child) => !(child.type === 'Text' && !String(child.data ?? '').trim())
    );
    const [only] = parts;
    const call = only?.type === 'RenderTag' ? (only.expression as Part) : undefined;
    const view = (call?.callee as Part | undefined)?.name;
    const [argument] = (call?.arguments as Part[] | undefined) ?? [];
    return parts.length === 1 &&
      typeof view === 'string' &&
      pointers.has(view) &&
      argument?.type === 'Identifier' &&
      argument.name === item.name
      ? { view, list: list.name }
      : undefined;
  };
  visit(markup, 'top');
  return { removals, calls, problems };
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
  /** Spans of the source drawn as pointers instead, and removed (see pointerCalls). */
  removed: readonly Insertion[] = [],
  /** The code of the place of each render at one, by where it starts (see Place). */
  places: ReadonlyMap<number, string> = new Map()
): Insertion[] {
  type Part = Record<string, unknown> & {
    type?: string;
    name?: string;
    start?: number;
    end?: number;
  };
  type Local =
    | { kind: 'item'; of: Part; each: Part & { index?: string }; index?: string }
    | { kind: 'value' }
    | { kind: 'other' };
  const insertions: Insertion[] = [];
  const indexed = new Map<Part, string>();
  const text = (node: Part) => source.slice(node.start, node.end);
  // The {:when} branch after a {#when} block or branch: an {:else if} on a key by now.
  const whenBranchOf = (part: Part): Part | undefined => {
    const children = ((part.else as Part | undefined)?.children as Part[] | undefined) ?? [];
    const [next, ...rest] = children.filter(
      (child) => child.type !== 'Text' || String(child.data ?? '').trim()
    );
    const test = next?.expression as Part | undefined;
    return !rest.length &&
      next?.type === 'IfBlock' &&
      next.elseif &&
      test?.type === 'Identifier' &&
      isDuringKey(String(test.name ?? ''))
      ? next
      : undefined;
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
      if (local?.kind === 'item') return ` of={${text(local.of)}} at={${indexOf(local)}}`;
      if (local?.kind === 'other') return ` of={${argument.name}}`;
      return stateNames.has(argument.name) ? ` path="${argument.name}"` : '';
    }
    if (argument?.type === 'MemberExpression') {
      const object = text(argument.object as Part);
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
    if (part.type === 'RenderTag') {
      const start = part.start ?? 0;
      if (removed.some(({ at, remove = 0 }) => at <= start && start < at + remove)) return;
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
        insertions.push(
          {
            at: part.start ?? 0,
            text: `<SverlinSlot${slotOf(argument, locals)}${reads.length ? ` reads={${JSON.stringify(reads)}}` : ''} site="${siteOf(source, part.start ?? 0)}"${placeOf(part)}>`
          },
          { at: part.end ?? 0, text: '</SverlinSlot>' }
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
        if (!/ (path|at)=/u.test(slot)) continue;
        const end = attribute.name;
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
      return;
    }
    // A {#when @label} block, an {#if} on the label's key by now (see label-values.ts): its
    // contents in a slot hidden where the step is inside no run of the label, keeping their room.
    // A chain, its branches {:else if} on their keys by now, is one box, a node keeping the largest
    // size it reaches, drawing only the branch the step is inside (see Chain.svelte).
    const test = part.type === 'IfBlock' ? (part.expression as Part | undefined) : undefined;
    if (test?.type === 'Identifier' && isDuringKey(String(test.name ?? ''))) {
      const start = part.start ?? 0;
      const opened = source.indexOf('}', test.end ?? start) + 1;
      const branches = [part];
      for (let next = whenBranchOf(part); next; next = whenBranchOf(next)) branches.push(next);
      const chained = branches.length > 1;
      const branch = (key: unknown) => `<SverlinBranch key="${String(key)}">`;
      insertions.push({
        at: start,
        text: chained
          ? `<SverlinChain ref="${siteOf(source, start)}">${branch(test.name)}`
          : `<SverlinSlot inherit reads={["${String(test.name)}"]}>`,
        remove: opened - start
      });
      // Each branch's own insertions first, so at a position both mark, what they open closes
      // before the branch does (see withInsertions).
      branches.forEach((each, which) => {
        walk(each.children, locals);
        const next = branches[which + 1]?.expression as Part | undefined;
        if (!next) return;
        const tag = source.lastIndexOf('{:else', next.start ?? 0);
        insertions.push({
          at: tag,
          text: `</SverlinBranch>${branch(next.name)}`,
          remove: source.indexOf('}', next.end ?? tag) + 1 - tag
        });
      });
      insertions.push({
        at: (part.end ?? 0) - '{/if}'.length,
        text: chained ? '</SverlinBranch></SverlinChain>' : '</SverlinSlot>',
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
        // item declares for its parts draws nothing there.
        const roots = ((part.children as Part[] | undefined) ?? []).filter(
          (child) =>
            child.type !== 'SnippetBlock' &&
            !(child.type === 'Text' && String(child.data ?? '').trim() === '')
        );
        const [root] = roots;
        if (roots.length === 1 && root.type === 'InlineComponent' && root.name === 'Node')
          insertions.push({
            at: (root.start ?? 0) + '<Node'.length,
            text: ` __itemOf={${text(local.of)}} __itemAt={${indexOf(local)}}`
          });
      } else for (const name of patternNames(context)) inner.set(name, { kind: 'other' });
      if (typeof part.index === 'string') inner.set(part.index, { kind: 'other' });
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
            text: ` __items={${source.slice(over.start, over.end)}}`
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
 * reserved prop __probe, every case of one component, each a list of arguments.
 */
export function probeMarkup(signatures: ComponentSignatures): string {
  return Object.entries(signatures)
    .map(
      ([name]) =>
        `{#if __probe?.component === '${name}'}{#each __probe.cases as __case}{@render ${name}(__case)}{/each}{/if}`
    )
    .join('');
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
  range?: { min: number; max: number };
};

// A component's cases are drawn in one pass of the page; this bounds them, so a pass stays about as
// quick as a step's.
const maximumCases = 256;

/** The values a parameter is drawn with: every value, when there are few enough, and the widest. */
type ProbeValues = { every?: unknown[]; widest: unknown[] };

type Steps = readonly { state: TraceState; types: TypeMap }[];

/**
 * The view's components, each after the components it renders, directly or through a type's name
 * choosing among them, so their boxes are known when it is drawn; with the values to draw it with.
 * A component with more cases than a pass can draw is a problem.
 */
export function componentProbes(
  found: { name: string; start: number; node: SvelteNode }[],
  signatures: ComponentSignatures,
  choices: Record<string, readonly string[]>,
  domain: DomainRegistry,
  steps: Steps
): { probes: ComponentProbe[]; problems: ComponentProblem[] } {
  const renders = new Map(
    found.map(({ name, node }) => [
      name,
      [...readsOf(node)].flatMap((read) =>
        Object.hasOwn(signatures, read) ? [read] : (choices[read] ?? [])
      )
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
  const probes: ComponentProbe[] = [];
  const problems: ComponentProblem[] = [];
  for (const name of ordered) {
    const type = signatures[name];
    const { node } = found.find((component) => component.name === name)!;
    const parameter = node.parameters?.[0]?.name ?? '';
    const single = onlyViewed(valueUses(node.children, new Set([parameter]), views));
    const values = valuesOf(type, parameter, single);
    const cases =
      values && (values.every?.length ?? Infinity) <= maximumCases ? values.every : values?.widest;
    const atom = domain.atoms[type];
    const range =
      atom?.base === 'integer' &&
      !atom.values &&
      atom.min !== undefined &&
      atom.max !== undefined &&
      cases === values?.widest &&
      !single(parameter)
        ? { min: atom.min, max: atom.max }
        : undefined;
    if (cases && cases.length <= maximumCases)
      probes.push({ name, cases, ...(range ? { range } : {}) });
    else
      problems.push({
        message: `${name} would be drawn with ${cases?.length ?? 'too many'} values of ${type} to size it, more than the ${maximumCases} a component can take. Give ${type} fewer values, or draw its parts with components of their own.`,
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
 * The values of each domain type. A collection is filled to the longest of its type in the trace,
 * with each value of its element type in turn: rows and columns are widest when full, and
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
    const atom = domain.atoms[type];
    // A position runs over the longest collection of its type in the trace, and as far past its
    // ends as the trace records one.
    if (atom) {
      const values = [...(seen.get(type) ?? [])];
      if (!atom.index) return atomValues(atom, values);
      const ends = (values as number[]).concat(0, (longest.get(atom.index) ?? 1) - 1);
      return atomValues({ ...atom, min: Math.min(...ends), max: Math.max(...ends) }, values);
    }
    const structure = domain.structures[type];
    switch (structure?.kind) {
      case 'collection': {
        const element = valuesOf(structure.element, `${path}[]`, single);
        const length = longest.get(type) ?? 0;
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
        const fields = names.map((name) =>
          valuesOf(structure.fields[name], path ? `${path}.${name}` : name, single)
        );
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
