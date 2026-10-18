/**
 * Typed view components: top-level snippets whose parameters are domain types, as in
 * {#snippet Cell(value: Int, current: Flag)}. A component reads only its parameters, design
 * values, and other components, so its size can be found by rendering it for every value of its
 * parameters (see assembly/entry.ts), and a design value can choose among components that take the
 * same types, as in const Number = pick([NumberText, NumberDots]);.
 */

import type { TraceState, TypeMap } from './algorithm/interpret.server';
import type { DomainRegistry } from './algorithm/structures.server';

/** Each component's parameter types, in order, by name. */
export type ComponentSignatures = Record<string, string[]>;

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
 * types some parameters but not all, or that is typed but not at the top level.
 */
export function findComponents(html: { children?: SvelteNode[] } | undefined): {
  components: { name: string; start: number; types: string[]; node: SvelteNode }[];
  roots: Map<number, string>;
  problems: ComponentProblem[];
} {
  const components: { name: string; start: number; types: string[]; node: SvelteNode }[] = [];
  const roots = new Map<number, string>();
  const problems: ComponentProblem[] = [];
  const typesOf = (snippet: SvelteNode): string[] | undefined => {
    const parameters = snippet.parameters ?? [];
    const types = parameters.map((parameter) => {
      const annotation = parameter.typeAnnotation?.typeAnnotation;
      return annotation?.type === 'TSTypeReference' && annotation.typeName?.type === 'Identifier'
        ? annotation.typeName.name
        : undefined;
    });
    if (types.every((type) => type === undefined)) return undefined;
    if (types.some((type) => type === undefined)) {
      // Reported once, and not taken as a component, so nothing else is said about it.
      problems.push({
        message: `Type every parameter of ${snippet.expression?.name}, or none: a component's parameters are domain types, as in (value: Int, current: Flag).`,
        start: snippet.start ?? 0
      });
      return undefined;
    }
    return types as string[];
  };
  for (const node of html?.children ?? []) {
    if (node.type !== 'SnippetBlock' || !node.expression?.name) continue;
    const types = typesOf(node);
    if (!types) continue;
    components.push({ name: node.expression.name, start: node.start ?? 0, types, node });
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
    if (part.type === 'SnippetBlock' && depth > 0 && typesOf(part))
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
 * Markup appended to the view so the page can render a component for given arguments: under the
 * reserved prop __probe, every case of one component, each a list of arguments.
 */
export function probeMarkup(signatures: ComponentSignatures): string {
  return Object.entries(signatures)
    .map(([name, types]) => {
      const args = types.map((_, index) => `__case[${index}]`).join(', ');
      return `{#if __probe?.component === '${name}'}{#each __probe.cases as __case}{@render ${name}(${args})}{/each}{/if}`;
    })
    .join('');
}

/**
 * A parameter as the page enumerates it: an atomic type, by name, or a collection of one, filled
 * to the longest such collection the trace holds. Other types are named and left unenumerated.
 */
export type ProbeParameter = string | { element: string; length: number };

/** A component and its parameters, as the page draws it for every value of them. */
export type ComponentProbe = { name: string; parameters: ProbeParameter[] };

/**
 * The view's components in an order where each comes after the components it renders, directly or
 * through a design value choosing among them, so their boxes are known when it is drawn.
 */
export function componentProbes(
  found: { name: string; node: SvelteNode }[],
  signatures: ComponentSignatures,
  choices: Record<string, readonly string[]>,
  domain: DomainRegistry,
  steps: readonly { state: TraceState; types: TypeMap }[]
): ComponentProbe[] {
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
  const parameter = (type: string): ProbeParameter => {
    const structure = domain.structures[type];
    return structure?.kind === 'collection' && Object.hasOwn(domain.atoms, structure.element)
      ? { element: structure.element, length: longestOf(type, steps) }
      : type;
  };
  return ordered.map((name) => ({ name, parameters: signatures[name].map(parameter) }));
}

/** The most elements any value of a collection type holds at any step. */
function longestOf(type: string, steps: readonly { state: TraceState; types: TypeMap }[]): number {
  let longest = 0;
  const walk = (value: unknown, path: string, types: TypeMap): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      if (types[path] === type) longest = Math.max(longest, value.length);
      value.forEach((item, index) => walk(item, `${path}[${index}]`, types));
    } else for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`, types);
  };
  for (const { state, types } of steps)
    for (const [name, value] of Object.entries(state)) walk(value, name, types);
  return longest;
}
