/**
 * Values in braces: in the markup's text, `{key}` draws its value through its type's view, as
 * `{@render Int(key)}` once did, chosen by `views.Int` and at its place, `@key`, as any render of a
 * value; a value without a domain type, as a loop's own index, stays text. The type is the one the
 * value has wherever it is read: a view's parameter by its annotation, an {#each} item by its
 * collection's element type, a field by its record, and a variable or a label by the types the
 * algorithm's trace records for it, a union where they are its members.
 *
 * Each such tag becomes a render in the parsed markup, so everything that reads renders reads it,
 * and the text compiled says `{@render Int(key)}` through two insertions inside its braces, so no
 * offset the view's problems name moves.
 */

import type { DomainRegistry, OperatorType } from './algorithm/structures.server';
import type { MasterStep } from './algorithm/interpret.server';
import type { Insertion } from './components.server';
import { viewThis, type LabelReference } from './label-values';
import type { Label } from './algorithm/labels.server';

type Part = {
  type?: string;
  name?: string;
  start?: number;
  end?: number;
  computed?: boolean;
  object?: Part;
  property?: Part;
  expression?: Part;
  context?: Part;
  index?: string;
  children?: Part[];
  else?: Part;
  parameters?: (Part & { typeAnnotation?: { typeAnnotation?: Part & { typeName?: Part } } })[];
  declaration?: { declarations?: { id?: Part }[] };
  callee?: Part;
  arguments?: Part[];
  implicit?: boolean;
  [key: string]: unknown;
};

/** What the types of values read in the markup are found from: the domain and a first trace. */
export type ViewTyping = {
  domain: DomainRegistry;
  /** Every labelled expression as an operator named by its label (see withLabelOperators in compile.server.ts). */
  labelOperators?: Readonly<Record<string, OperatorType>>;
  steps: readonly MasterStep[];
  labels: readonly Label[];
};

/** A tag in the markup's text drawing a value through its type's view. */
export type ImplicitRender = { start: number; end: number; type: string; argument: Part };

/**
 * The tags in the markup's text whose value has a domain type, each made a render of that type in
 * place (see the file's comment), in the order written.
 */
export function implicitRenders(
  html: unknown,
  typing: ViewTyping,
  references: readonly LabelReference[],
  /** The types drawn as pointers, around what their positions point at. */
  pointerTypes: ReadonlySet<string> = new Set()
): ImplicitRender[] {
  const { domain, steps } = typing;
  const { atoms, structures } = domain;
  const operators = domain.operators ?? {};
  // A label a view is typed by draws through that view, as a type does (see withLabelOperators).
  const isType = (name: string) => name in atoms || name in structures || name in operators;
  const pathTypes = (path: string): Set<string> => {
    const found = new Set<string>();
    for (const step of steps) {
      const type = step.types?.[path];
      if (type) found.add(type);
    }
    return found;
  };
  const labelTypes = (path: string): Set<string> => {
    const found = new Set<string>();
    for (const step of steps)
      for (const [full, runs] of Object.entries(step.labelled ?? {}))
        if (full === path || full.endsWith(`.${path}`))
          for (const run of runs) if (run.types?.value) found.add(run.types.value);
    return found;
  };
  // Several types recorded for one value are members of the union it is declared as.
  const one = (types: Set<string>): string | undefined => {
    if (types.size === 1) return [...types][0];
    if (!types.size) return undefined;
    const unions = Object.values(structures).filter(
      (structure) =>
        structure.kind === 'union' && [...types].every((type) => structure.members.includes(type))
    );
    return unions.length === 1 ? unions[0].name : undefined;
  };
  const record = (type: string | undefined) => {
    const operator = type ? operators[type] : undefined;
    if (operator)
      return {
        kind: 'record' as const,
        name: operator.name,
        fields: {
          ...Object.fromEntries(
            operator.parameters.map((parameter, index) => [parameter, operator.operands[index]])
          ),
          value: operator.result
        }
      };
    let structure = type ? structures[type] : undefined;
    if (structure?.kind === 'ref') structure = structures[structure.element];
    return structure?.kind === 'record' ? structure : undefined;
  };
  const labelPaths = new Map(
    references.flatMap((reference) =>
      reference.kind === 'value' ? [[reference.key, reference.path] as const] : []
    )
  );
  // spans(@check.at), written ϟcheckˑat by then: every value the label has given, of its type.
  const runsPaths = new Map(
    references.flatMap((reference) =>
      reference.kind === 'runs' ? [[reference.key, reference.path] as const] : []
    )
  );
  type Scope = ReadonlyMap<string, string | undefined>;
  const typeOf = (expression: Part | undefined, scope: Scope): string | undefined => {
    if (!expression) return undefined;
    if (expression.type === 'Identifier' && typeof expression.name === 'string') {
      if (scope.has(expression.name)) return scope.get(expression.name);
      if (expression.name in operators) return expression.name;
      const label = labelPaths.get(expression.name);
      return one(label !== undefined ? labelTypes(label) : pathTypes(expression.name));
    }
    // at(p), the element a position points at.
    if (
      expression.type === 'CallExpression' &&
      expression.callee?.type === 'Identifier' &&
      expression.callee.name === 'at'
    ) {
      const position = atoms[typeOf(expression.arguments?.[0], scope) ?? ''];
      const list = position?.index ? structures[position.index] : undefined;
      return list?.kind === 'collection' ? list.element : undefined;
    }
    if (expression.type === 'MemberExpression') {
      const base = typeOf(expression.object, scope);
      if (!base) return undefined;
      if (expression.computed) {
        const structure = structures[base];
        return structure?.kind === 'collection' ? structure.element : undefined;
      }
      const property = expression.property?.name ?? '';
      // An application's operands are its fields, by the operator's parameters.
      const operator = domain.operators?.[base];
      if (operator) {
        const at = operator.parameters.indexOf(property);
        return at >= 0 ? operator.operands[at] : undefined;
      }
      return record(base)?.fields[property];
    }
    return undefined;
  };
  // A union with one member drawn as a pointer, as a position or the end, marks where it points.
  const pointed = (type: string | undefined) => {
    const structure = type ? structures[type] : undefined;
    if (structure?.kind !== 'union') return type;
    const pointers = structure.members.filter((member) => pointerTypes.has(member));
    return pointers.length === 1 ? pointers[0] : type;
  };
  const found: ImplicitRender[] = [];
  const visit = (parts: readonly Part[] | undefined, scope: Scope) => {
    let local = new Map(scope);
    for (const part of parts ?? []) {
      if (part.type === 'MustacheTag' || part.type === 'ExpressionTag') {
        const type = pointed(typeOf(part.expression, local));
        if (type && isType(type) && part.expression)
          found.push({
            start: part.start ?? 0,
            end: part.end ?? 0,
            type,
            argument: part.expression
          });
        continue;
      }
      if (part.type === 'ConstTag')
        for (const declaration of part.declaration?.declarations ?? [])
          if (declaration.id?.name) local = new Map(local).set(declaration.id.name, undefined);
      const inner = new Map(local);
      if (part.type === 'SnippetBlock')
        for (const parameter of part.parameters ?? []) {
          const annotation = parameter.typeAnnotation?.typeAnnotation;
          if (parameter.name)
            inner.set(
              parameter.name,
              annotation?.type === 'TSTypeReference' ? annotation.typeName?.name : undefined
            );
        }
      if (part.type === 'EachBlock') {
        const name = part.expression?.type === 'Identifier' ? (part.expression.name ?? '') : '';
        const list = structures[typeOf(part.expression, local) ?? ''];
        const ran = runsPaths.get(name);
        const element =
          ran !== undefined
            ? one(labelTypes(ran))
            : list?.kind === 'collection'
              ? list.element
              : undefined;
        if (part.context?.type === 'Identifier' && part.context.name)
          inner.set(part.context.name, element);
        if (part.index) inner.set(part.index, undefined);
      }
      visit(part.children, inner);
      if (part.else) visit([part.else], local);
    }
  };
  const root = html as Part | undefined;
  visit(root?.children, new Map());
  return found;
}

/** Each implicit render made a render node in the parsed markup, marked as implicit. */
export function markImplicit(html: unknown, renders: readonly ImplicitRender[]): void {
  const at = new Map(renders.map((render) => [render.start, render]));
  const visit = (part: Part | undefined) => {
    if (!part || typeof part !== 'object') return;
    for (const child of part.children ?? []) {
      const render =
        child.type === 'MustacheTag' || child.type === 'ExpressionTag'
          ? at.get(child.start ?? -1)
          : undefined;
      if (render) {
        child.type = 'RenderTag';
        child.implicit = true;
        child.expression = {
          type: 'CallExpression',
          // The tag's own span: what is keyed by where an expression starts, as an at(p) call,
          // is its argument's.
          start: render.start,
          end: render.end,
          callee: {
            type: 'Identifier',
            name: render.type,
            start: render.start,
            end: render.start
          },
          arguments: [render.argument],
          optional: false
        };
      } else visit(child);
    }
    if (part.else) visit(part.else);
  };
  visit(html as Part);
}

/**
 * The insertions that make each implicit render read `{@render Int(key)}` in the text compiled,
 * leaving the renders a removal takes out of the markup, as a root's pointers, as removed.
 */
export function implicitInsertions(
  renders: readonly ImplicitRender[],
  removals: readonly Insertion[],
  /** The alias of a render at a place drawing its own choice of view, called in place of its type. */
  aliasAt: (start: number) => string | undefined = () => undefined
): Insertion[] {
  const removed = (start: number) =>
    removals.some(({ at, remove = 0 }) => at <= start && start < at + remove);
  return renders
    .filter(({ start }) => !removed(start))
    .flatMap(({ start, end, type }) => [
      { at: start + 1, text: `@render ${aliasAt(start) ?? type}(` },
      { at: end - 1, text: ')' }
    ]);
}

/** How a value of each member of a union is told apart at run time, as the trace holds it. */
function memberTest(type: string, domain: DomainRegistry): { kind: string; test: string } {
  const atom = domain.atoms[type];
  if (atom) {
    if (atom.base === 'text' && atom.values?.length)
      return {
        kind: `text:${atom.values.join('|')}`,
        test: atom.values.map((value) => `${viewThis} === ${JSON.stringify(value)}`).join(' || ')
      };
    if (atom.base === 'text') return { kind: 'text', test: `typeof ${viewThis} === 'string'` };
    if (atom.base === 'boolean')
      return { kind: 'boolean', test: `typeof ${viewThis} === 'boolean'` };
    return { kind: 'number', test: `typeof ${viewThis} === 'number'` };
  }
  const structure = domain.structures[type];
  // A reference is held as its place in its record's heap, a number.
  if (structure?.kind === 'ref') return { kind: 'number', test: `typeof ${viewThis} === 'number'` };
  if (structure?.kind === 'collection') return { kind: 'list', test: `Array.isArray(${viewThis})` };
  return { kind: 'object', test: `typeof ${viewThis} === 'object'` };
}

/** The name of the view drawing a union's values through its members' views (see unionViews). */
export const unionViewName = (union: string): string => `${union}Member`;

/**
 * For each union a value in braces has, a view choosing its member's view by the value at run time,
 * as {#snippet DistMember(this: Dist)}{#if typeof this === 'number'}{@render Steps(this)}…, to
 * add after the view; a problem where two members cannot be told apart.
 */
export function unionViews(
  unions: ReadonlySet<string>,
  domain: DomainRegistry
): { text: string; problems: string[] } {
  let text = '';
  const problems: string[] = [];
  for (const union of unions) {
    const structure = domain.structures[union];
    if (structure?.kind !== 'union') continue;
    const tests = structure.members.map((member) => ({ member, ...memberTest(member, domain) }));
    const kinds = tests.map(({ kind }) => kind);
    const clash = tests.find(
      ({ kind }, index) =>
        kinds.indexOf(kind) !== index ||
        (kind === 'text' && kinds.some((other) => other.startsWith('text:')))
    );
    if (clash) {
      problems.push(
        `${union}'s members ${structure.members.join(' and ')} cannot be told apart as a value is drawn, so {…} cannot choose which member's view draws it: make one member an enumeration, as type(['none']), or a different kind of value.`
      );
      continue;
    }
    const branches = tests
      .map(({ member, test }, index) =>
        index === tests.length - 1
          ? `{:else}{@render ${member}(${viewThis})}`
          : `{${index ? ':else if' : '#if'} ${test}}{@render ${member}(${viewThis})}`
      )
      .join('');
    text += `\n{#snippet ${unionViewName(union)}(${viewThis}: ${union})}${branches}{/if}{/snippet}`;
  }
  return { text, problems };
}
