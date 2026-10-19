/**
 * Typed view components: top-level snippets that view one domain type, as in
 * {#snippet IntText(value: Int)}, optionally taking the props of the node they draw, as in
 * (value: Int, node). A component reads only its value, design values, and other components, so its
 * size can be found by rendering it for every value of its type (see assembly/entry.ts). A design
 * value named after a type chooses among its views, as in const Int = pick([IntText, IntDots]);,
 * and renders as the type's name, as in {@render Int(value)}.
 */

import type { TraceState, TypeMap } from './algorithm/interpret.server';
import type { AtomType } from './algorithm/atoms.server';
import type { DomainRegistry } from './algorithm/structures.server';

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
};
type TypeNode = { type?: string; typeName?: { type?: string; name?: string } };

/** A problem with a component, at a position in the view. */
export type ComponentProblem = { message: string; start: number };

/**
 * The view's components, the start of each one's root <Node> tags, and problems: a snippet that
 * types more than one parameter, or types one other than its first, or that is typed but not at the
 * top level.
 */
export function findComponents(html: { children?: SvelteNode[] } | undefined): {
  components: { name: string; start: number; type: string; node: SvelteNode }[];
  roots: Map<number, string>;
  problems: ComponentProblem[];
} {
  const components: { name: string; start: number; type: string; node: SvelteNode }[] = [];
  const roots = new Map<number, string>();
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
    else if (types[0] === undefined || parameters.length > 2)
      problems.push({
        message: `${name} takes its value first and at most the node's props after it, as in (value: Int, node): a component views one domain type.`,
        start: snippet.start ?? 0
      });
    else return typed[0];
    return undefined;
  };
  for (const node of html?.children ?? []) {
    if (node.type !== 'SnippetBlock' || !node.expression?.name) continue;
    const type = typeOf(node);
    if (!type) continue;
    components.push({ name: node.expression.name, start: node.start ?? 0, type, node });
    for (const child of node.children ?? [])
      if (child.type === 'InlineComponent' && child.name === 'Node' && child.start !== undefined)
        roots.set(child.start, node.expression.name);
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
  return { components, roots, problems };
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
 * The view's components, each after the components it renders, directly or through a design value
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
 * with each value of its element type in turn: rows, columns, and grids are widest when full, and
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
    if (atom) return atomValues(atom, [...(seen.get(type) ?? [])]);
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
