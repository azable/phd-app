/**
 * Props a view binds to its value, as `<Node stroke={this.visited} />` (see library/node/bound.ts):
 * the values each expression can take, worked out from the view's type before the algorithm runs,
 * and the variables saying which option each value takes, or for a length, its unit and where its
 * kind's boxes start in their slots.
 */

import type { AtomType } from './algorithm/atoms.server';
import type { DomainRegistry } from './algorithm/structures.server';
import type { DesignSpace, DesignValue } from './design.server';
import { isLabelKey, untypedBoolean, viewThis, written as writtenName } from './label-values';
import {
  anchorKey,
  boundAnchor,
  boundCapacity,
  boundHues,
  boundOptions,
  colourProps,
  lengthProps,
  lengthUnits,
  orderKeys,
  orderedProps,
  orders,
  unitKey,
  valueKey,
  valueOnlyProps,
  type BoundDomain,
  type BoundValue
} from './library/node/bound';

/** A prop a view binds: the kind of the node, the prop, and the values its expression takes. */
export type Binding = { kind: string; prop: string; domain: BoundDomain };

/**
 * The names a bound expression reads, with their types: the view's value, `this`, and the names
 * {#each} blocks and {@const} tags inside the view declare, as v for each vertex.
 */
export type Scope = ReadonlyMap<string, string>;

/** More values than this make no domain a prop could tell apart, so working them out stops. */
const largest = 1000;

type Node = Record<string, unknown> & { type?: string };

/** The values of a type, in order, or undefined where they are not few and known. */
function valuesOfType(domain: DomainRegistry, type: string): BoundValue[] | undefined {
  if (type === untypedBoolean) return [false, true];
  const atom: AtomType | undefined = domain.atoms[type];
  if (atom) {
    if (atom.values) return [...atom.values];
    if (atom.base === 'boolean') return [false, true];
    if (atom.min === undefined || atom.max === undefined) return undefined;
    const scale = atom.base === 'integer' ? 1 : 10 ** (atom.places ?? 0);
    if (atom.base === 'number' && atom.places === undefined) return undefined;
    const [low, high] = [Math.ceil(atom.min * scale), Math.floor(atom.max * scale)];
    if (high - low + 1 > largest) return undefined;
    return Array.from({ length: high - low + 1 }, (_, index) => (low + index) / scale);
  }
  const structure = domain.structures[type];
  if (structure?.kind !== 'union') return undefined;
  const members = structure.members.map((member) => valuesOfType(domain, member));
  return members.every((values) => values !== undefined) ? unique(members.flat()) : undefined;
}

const unique = (values: readonly BoundValue[]) => [...new Set(values)];

/**
 * The type a path from a name in scope reads, as this.dist or v.seen: a record's field, through
 * references; a collection's element, as this.cells[0]; and a label's operand or result, as
 * this.left in a view typed by the label, typed as the run gave it, '' where it gave no type.
 */
export function typeOfPath(node: Node, scope: Scope, domain: DomainRegistry): string | undefined {
  if (node.type === 'Identifier') return scope.get(node.name as string);
  if (node.type !== 'MemberExpression') return undefined;
  const owner = typeOfPath(node.object as Node, scope, domain);
  if (owner === undefined) return undefined;
  let structure = domain.structures[owner];
  if (node.computed) return structure?.kind === 'collection' ? structure.element : undefined;
  const field = (node.property as { name?: string }).name ?? '';
  const operator = domain.operators?.[owner];
  if (operator)
    return field === 'value'
      ? operator.result
      : operator.operands[operator.parameters.indexOf(field)];
  if (structure?.kind === 'ref') structure = domain.structures[structure.element];
  return structure?.kind === 'record' ? structure.fields[field] : undefined;
}

const comparisons = new Set(['===', '!==', '==', '!=', '<', '<=', '>', '>=']);
const arithmetic: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b
};
const maths: Record<string, (...args: number[]) => number> = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  sign: Math.sign,
  min: Math.min,
  max: Math.max
};

/** Every combination of the operands' values, or undefined where there would be too many. */
function combinations(lists: readonly (readonly BoundValue[])[]): BoundValue[][] | undefined {
  let all: BoundValue[][] = [[]];
  for (const list of lists) {
    if (all.length * list.length > largest * largest) return undefined;
    all = all.flatMap((done) => list.map((value) => [...done, value]));
  }
  return all;
}

/** The values an expression can take, or undefined where they cannot be worked out. */
function valuesOf(node: Node, scope: Scope, domain: DomainRegistry): BoundValue[] | undefined {
  switch (node.type) {
    case 'Literal':
      return ['string', 'number', 'boolean'].includes(typeof node.value)
        ? [node.value as BoundValue]
        : undefined;
    case 'Identifier':
    case 'MemberExpression': {
      const type = typeOfPath(node, scope, domain);
      return type === undefined ? undefined : valuesOfType(domain, type);
    }
    case 'UnaryExpression': {
      if (node.operator === '!') return [false, true];
      const values = valuesOf(node.argument as Node, scope, domain);
      return node.operator === '-' && values?.every((value) => typeof value === 'number')
        ? values.map((value) => -value)
        : undefined;
    }
    case 'BinaryExpression': {
      if (comparisons.has(node.operator as string)) return [false, true];
      const apply = arithmetic[node.operator as string];
      const operands = [node.left, node.right].map((side) => valuesOf(side as Node, scope, domain));
      if (!apply || operands.some((values) => !values)) return undefined;
      const all = combinations(operands as BoundValue[][]);
      if (!all?.every((pair) => pair.every((value) => typeof value === 'number'))) return undefined;
      const results = all.map(([a, b]) => apply(a as number, b as number));
      return results.every(Number.isFinite) ? results : undefined;
    }
    case 'LogicalExpression': {
      const operands = [node.left, node.right].map((side) => valuesOf(side as Node, scope, domain));
      if (operands.some((values) => !values)) return undefined;
      const all = combinations(operands as BoundValue[][]);
      return all?.map(([a, b]) =>
        node.operator === '&&' ? a && b : node.operator === '||' ? a || b : (a ?? b)
      );
    }
    case 'ConditionalExpression': {
      const branches = [node.consequent, node.alternate].map((side) =>
        valuesOf(side as Node, scope, domain)
      );
      return branches.some((values) => !values) ? undefined : (branches.flat() as BoundValue[]);
    }
    case 'CallExpression': {
      const callee = node.callee as Node;
      const object = callee.object as Node | undefined;
      const name = (callee.property as { name?: string } | undefined)?.name ?? '';
      if (callee.type !== 'MemberExpression' || object?.name !== 'Math' || !maths[name])
        return undefined;
      const args = (node.arguments as Node[]).map((arg) => valuesOf(arg, scope, domain));
      if (args.some((values) => !values?.every((value) => typeof value === 'number')))
        return undefined;
      return combinations(args as BoundValue[][])?.map((list) =>
        maths[name](...(list as number[]))
      );
    }
    default:
      return undefined;
  }
}

/** Whether an expression reads the view's value, or a name read from it, so it is no constant look. */
function readsValue(node: unknown, scope: Scope): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((item) => readsValue(item, scope));
  const part = node as Node;
  if (part.type === 'Identifier' && scope.has(part.name as string)) return true;
  return Object.entries(part).some(
    ([key, child]) => key !== 'parent' && key !== 'loc' && readsValue(child, scope)
  );
}

/** The first path the expression reads that its run gave no type, as this.left for hi - lo. */
function untypedPath(node: unknown, scope: Scope, domain: DomainRegistry): Node | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = untypedPath(item, scope, domain);
      if (found) return found;
    }
    return undefined;
  }
  const part = node as Node;
  if (part.type === 'MemberExpression' && typeOfPath(part, scope, domain) === '') return part;
  for (const [key, child] of Object.entries(part))
    if (key !== 'parent' && key !== 'loc') {
      const found = untypedPath(child, scope, domain);
      if (found) return found;
    }
  return undefined;
}

/**
 * The values of an enumeration of words a path reads, as this.state, in their declared order; a
 * union of such enumerations runs through its members in order. Undefined for anything else.
 */
function declaredOrder(node: Node, scope: Scope, domain: DomainRegistry): string[] | undefined {
  const type = typeOfPath(node, scope, domain);
  if (type === undefined) return undefined;
  const structure = domain.structures[type];
  const members = structure?.kind === 'union' ? structure.members : [type];
  const lists = members.map((member) => domain.atoms[member]?.values);
  if (
    !lists.every((values) => values?.length && values.every((value) => typeof value === 'string'))
  )
    return undefined;
  return unique(lists.flat() as string[]) as string[];
}

/** Why a prop cannot be bound to a label's operand the run gave no type, as hi - lo in @base[hi - lo < 2]. */
function untypedProblem(prop: string, written: string, path: Node, scope: Scope): string {
  const name = (path.property as { name?: string }).name ?? '';
  const label = [...scope.values()].find(isLabelKey);
  const shown = label ? writtenName(label) : 'the label';
  return `${prop}={${written}} reads this.${name}, which ${shown} gives no type: a plain number has no known values, so give it one where the algorithm computes it, with a constructor, as Int(…).`;
}

/** A value of an unordered domain names its own variable, as Card=visited.stroke, so it is one word. */
const nameable = (value: BoundValue) =>
  typeof value === 'boolean' || /^[A-Za-z0-9_-]+$/u.test(String(value));

/** A path as written from a name, as this.next, or undefined for anything else. */
function pathKey(node: unknown): string | undefined {
  const part = node as Node | undefined;
  if (part?.type === 'Identifier') return part.name as string;
  if (part?.type !== 'MemberExpression' || part.computed) return undefined;
  const owner = pathKey(part.object);
  return owner && `${owner}.${(part.property as { name?: string }).name}`;
}

/**
 * Where an {#if} tests which member a union holds, by comparing it with a value, as
 * `this.next !== 'end'`, and reads inside it in a branch, as `this.next.name`: measured, each
 * branch is drawn whatever the test says (see branchInsertions in components.server.ts), so the
 * read would meet the member the test kept out. The tested path and its union's members.
 */
export function memberTestRead(
  ifBlock: Node,
  scope: Scope,
  domain: DomainRegistry
): { tested: Node; members: readonly string[] } | undefined {
  const tests: Node[] = [];
  const collect = (node: unknown) => {
    const part = node as Node | undefined;
    if (part?.type === 'LogicalExpression') [part.left, part.right].forEach(collect);
    else if (part?.type === 'UnaryExpression' && part.operator === '!') collect(part.argument);
    else if (
      part?.type === 'BinaryExpression' &&
      ['===', '!==', '==', '!='].includes(part.operator as string)
    )
      tests.push(
        ...([part.left, part.right] as Node[]).filter(
          (side, index, both) => both[1 - index].type === 'Literal'
        )
      );
  };
  collect(ifBlock.expression);
  const reads = (node: unknown, key: string): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some((item) => reads(item, key));
    const part = node as Node;
    if (part.type === 'MemberExpression' && pathKey(part.object) === key) return true;
    return Object.entries(part).some(
      ([name, child]) => name !== 'parent' && name !== 'metadata' && reads(child, key)
    );
  };
  for (const tested of tests) {
    const type = typeOfPath(tested, scope, domain);
    const union = type === undefined ? undefined : domain.structures[type];
    const key = pathKey(tested);
    if (union?.kind === 'union' && key && reads([ifBlock.children, ifBlock.else], key))
      return { tested, members: union.members };
  }
  return undefined;
}

/**
 * The values a prop bound to `expression`, reading names in `scope`, can take, in order, or why it
 * cannot be bound: numbers, and an enumeration's words in their declared order, keep their order
 * and map onto an ordered prop in order; true and false, and words from anywhere else, are unordered
 * and map onto any prop, each its own option.
 */
export function boundDomain(
  prop: string,
  expression: unknown,
  written: string,
  scope: Scope,
  domain: DomainRegistry | undefined
): BoundDomain | { problem: string } {
  if (!readsValue(expression, scope))
    return {
      problem: `${prop}={${written}} reads nothing of the view's value: a constant look is the design's, a variable of the node's kind, so a bound prop reads this, as ${prop}={this.visited}.`
    };
  const found = domain && valuesOf(expression as Node, scope, domain);
  const untyped = !found && domain ? untypedPath(expression, scope, domain) : undefined;
  if (untyped) return { problem: untypedProblem(prop, written, untyped, scope) };
  if (!found)
    return {
      problem: `${prop}={${written}} takes values that cannot be known before the algorithm runs: a bound prop reads this, its fields, and comparisons and arithmetic of them, as ${prop}={this.visited} or ${prop}={this.level}, each of a type with few values, as type('integer', { min: 0, max: 3 }) or an enumeration.`
    };
  const numbers = found.every((value) => typeof value === 'number');
  const declared = numbers ? undefined : declaredOrder(expression as Node, scope, domain);
  const values = numbers
    ? unique(found).toSorted((a, b) => (a as number) - (b as number))
    : (declared ??
      (found.every((value) => typeof value === 'boolean') ? [false, true] : unique(found)));
  const ordered = !valueOnlyProps.has(prop) && (numbers || declared !== undefined);
  const capacity = boundCapacity(prop, ordered);
  if (ordered && !orderedProps.has(prop) && !colourProps.has(prop))
    return {
      problem: `${prop}={${written}} is ${numbers ? 'a number, whose values run in order' : 'an enumeration, whose values run in its declared order'}, and ${prop}'s options do not: bind it to a prop that runs in order, as ${[...orderedProps].join(', ')}, or a colour, which takes one hue's shades.`
    };
  if (values.length > capacity)
    return {
      problem: `${prop}={${written}} can take ${values.length} values, and ${prop} tells apart ${capacity}${ordered && colourProps.has(prop) ? ', the shades of one hue' : ''}: bind it to a type with fewer values, or group them in the expression, as ${prop}={this > 50} or ${prop}={Math.floor(this / 25)}.`
    };
  if (!ordered && !values.every(nameable))
    return {
      problem: `${prop}={${written}} can be ${JSON.stringify(values.find((value) => !nameable(value)))}, and each value names the variable giving its option, so values are one word.`
    };
  return { values, ordered };
}

/**
 * The least and largest values a length bound to `expression`, reading names in `scope`, can take, or
 * why it cannot be bound: numbers, none below zero, as many as the type has. A type with too many
 * values to list is read by its range.
 */
export function boundLengthDomain(
  prop: string,
  expression: unknown,
  written: string,
  scope: Scope,
  domain: DomainRegistry | undefined
): BoundDomain | { problem: string } {
  if (!readsValue(expression, scope))
    return {
      problem: `${prop}={${written}} reads nothing of the view's value: a length is the value times a unit, so it reads this, as ${prop}={this} or ${prop}={this.dist}; a box not bound sizes to its contents.`
    };
  const node = expression as Node;
  const type =
    domain && (node.type === 'Identifier' || node.type === 'MemberExpression')
      ? typeOfPath(node, scope, domain)
      : undefined;
  const atom = type === undefined ? undefined : domain?.atoms[type];
  const found =
    (domain && valuesOf(node, scope, domain)) ??
    (atom && atom.base !== 'boolean' && atom.min !== undefined && atom.max !== undefined
      ? [atom.min, atom.max]
      : undefined);
  const untyped = !found && domain ? untypedPath(node, scope, domain) : undefined;
  if (untyped) return { problem: untypedProblem(prop, written, untyped, scope) };
  if (!found)
    return {
      problem: `${prop}={${written}} takes values that cannot be known before the algorithm runs: a length reads this, its fields, and arithmetic of them, each of a number type with a least and largest value, as type('integer', { min: 0, max: 99 }).`
    };
  if (!found.every((value) => typeof value === 'number'))
    return {
      problem: `${prop}={${written}} is not a number: a length is a number, the value times a unit, as ${prop}={this} for a view of an integer type.`
    };
  const numbers = found as number[];
  const [least, largest] = [Math.min(...numbers), Math.max(...numbers)];
  if (least < 0)
    return {
      problem: `${prop}={${written}} can be ${least}, below zero: a length runs from zero, so bind it to a type that is never negative, as type('integer', { min: 0, max: 99 }).`
    };
  return { values: [least, largest], ordered: true };
}

/** The unit a length starts with: the largest that keeps the largest value within 200 pixels. */
function starterUnit(largest: number): number {
  const fitting = lengthUnits.filter((unit) => largest * unit <= 200);
  return fitting.at(-1) ?? lengthUnits[0];
}

/** The starting option of each value of an unordered domain: distinct, and false the plainest. */
function starterOptions(prop: string, values: readonly BoundValue[]): DesignValue[] {
  if (colourProps.has(prop)) {
    const shade = prop === 'fill' ? 200 : prop === 'stroke' ? 600 : 700;
    const palette = ['blue', 'amber', 'emerald', 'rose', 'violet', 'cyan', 'orange', 'lime'];
    const named = palette.concat(boundHues.filter((hue) => !palette.includes(hue)));
    const coloured = values.filter((value) => value !== false);
    return values.map((value) =>
      value === false
        ? `neutral-${shade}`
        : `${named[coloured.indexOf(value) % named.length]}-${shade}`
    );
  }
  const options = boundOptions(prop);
  const from = orderedProps.has(prop) ? Math.floor((options.length - values.length) / 2) : 0;
  return values.map((_, index) => options[from + index]);
}

/** Each binding's variables and their starting values. */
export function boundDesign(bindings: readonly Binding[]): {
  space: DesignSpace;
  starter: Record<string, DesignValue>;
} {
  const space: Record<string, readonly DesignValue[]> = {};
  const starter: Record<string, DesignValue> = {};
  for (const { kind, prop, domain } of bindings) {
    if (lengthProps.has(prop)) {
      const key = unitKey(kind, prop);
      space[key] = lengthUnits;
      starter[key] = starterUnit(Math.max(...(domain.values as number[])));
      // The kind's anchor along it, a variable every kind has, starts where a length stands.
      const { axis, anchor } = boundAnchor(prop);
      starter[anchorKey(kind, axis)] = anchor;
      continue;
    }
    const options = boundOptions(prop);
    if (!domain.ordered) {
      const starting = starterOptions(prop, domain.values);
      domain.values.forEach((value, index) => {
        const key = valueKey(kind, prop, value);
        space[key] = options;
        starter[key] = starting[index];
      });
      continue;
    }
    const keys = orderKeys(kind, prop);
    space[keys.order] = orders;
    starter[keys.order] = 'up';
    if (colourProps.has(prop)) {
      space[keys.hue] = boundHues;
      starter[keys.hue] = 'blue';
      continue;
    }
    const firsts = options.slice(0, options.length - domain.values.length + 1);
    space[keys.from] = firsts;
    starter[keys.from] = firsts[Math.floor((firsts.length - 1) / 2)];
  }
  return { space, starter };
}

/**
 * The most a view's `{#each count(n) as k}` may draw. A view is drawn with every value of its
 * type to size it (see probeComponents in components.server.ts), up to 256 cases, so a count up to
 * this many is sized at its largest; past it the view would grow huge and slow to size, and a value
 * that large reads better as a length, drawn as a bar.
 */
export const countLimit = 100;

/** A `count(n)` call's argument, where the expression is one. */
export function countArgument(node: unknown): Node | undefined {
  const call = node as Node | undefined;
  const callee = call?.callee as Node | undefined;
  return call?.type === 'CallExpression' && callee?.type === 'Identifier' && callee.name === 'count'
    ? ((call.arguments as Node[] | undefined) ?? [])[0]
    : undefined;
}

/** The largest count a `count(…)` call can give, or why it can be no count. */
function countOf(
  call: Node,
  scope: Scope,
  domain: DomainRegistry
): { max: number } | { problem: string } {
  const args = (call.arguments as Node[] | undefined) ?? [];
  const type = args.length === 1 ? typeOfPath(args[0], scope, domain) : undefined;
  const atom = type === undefined ? undefined : domain.atoms[type];
  if (!atom || atom.base !== 'integer' || atom.values || atom.max === undefined)
    return {
      problem:
        "count(…) takes one value of an integer type with a largest value, as count(this) in a view of type('integer', { min: 0, max: 10 }): every count up to the largest is drawn to size the view."
    };
  if (atom.max > countLimit)
    return {
      problem: `count(…) goes up to ${atom.max}, more than the ${countLimit} a view can draw one by one: draw a value this large as a length, as a bar with height={this}.`
    };
  return { max: atom.max };
}

/** Each `count(…)` in the markup, by where it is, with why it cannot be drawn, if it cannot. */
export function countCalls(
  markup: unknown,
  domain: DomainRegistry,
  variables: Scope,
  views: Scope
): { start: number; end: number; problem?: string }[] {
  const calls: { start: number; end: number; problem?: string }[] = [];
  const heads = new Set<unknown>();
  const visit = (node: unknown, scope: Scope): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => visit(child, scope));
    const part = node as Node;
    if (part.type === 'SnippetBlock') {
      const view = views.get((part.expression as Node | undefined)?.name as string);
      return visit(part.children, view === undefined ? scope : new Map([[viewThis, view]]));
    }
    if (part.type === 'EachBlock' && countArgument(part.expression)) heads.add(part.expression);
    const callee = part.callee as Node | undefined;
    if (
      part.type === 'CallExpression' &&
      callee?.type === 'Identifier' &&
      callee.name === 'count'
    ) {
      const counted = countOf(part, scope, domain);
      const problem =
        'problem' in counted
          ? counted.problem
          : heads.has(part)
            ? undefined
            : 'count(…) is only the list an {#each} walks, as {#each count(this) as k}…{/each}: it draws one copy for each of 0, 1, … up to the value.';
      calls.push({
        start: part.start as number,
        end: part.end as number,
        ...(problem ? { problem } : {})
      });
    }
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'metadata') visit(child, scope);
  };
  visit(markup, variables);
  return calls;
}

/**
 * Each `place()` in the markup, by where its name is, with the view it is in and why it cannot be
 * given, if it cannot: it names the place the view is rendered at (see sverlinPlace in
 * library/type-context.ts), so it is called with nothing, only in a view.
 */
export function placeCalls(
  markup: unknown,
  views: ReadonlySet<string>
): { start: number; view?: string; problem?: string }[] {
  const calls: { start: number; view?: string; problem?: string }[] = [];
  const visit = (node: unknown, view: string | undefined): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => visit(child, view));
    const part = node as Node;
    if (part.type === 'SnippetBlock') {
      const name = (part.expression as Node | undefined)?.name as string | undefined;
      return visit(part.children, name);
    }
    if (part.type === 'CallExpression' && (part.callee as Node | undefined)?.name === 'place') {
      const args = (part.arguments as unknown[] | undefined) ?? [];
      const problem = args.length
        ? 'place() takes nothing: it gives the name of the place the view is rendered at.'
        : view === undefined || !views.has(view)
          ? 'place() names the place a view is rendered at, so it is written only in a <View>: to write a name elsewhere, write it as text.'
          : undefined;
      calls.push({
        start: (part.callee as Node).start as number,
        ...(view ? { view } : {}),
        ...(problem ? { problem } : {})
      });
      return;
    }
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'metadata') visit(child, view);
  };
  visit(markup, undefined);
  return calls;
}

/**
 * Each grid's rows and columns for any input, by where its tag starts: every row and every col its
 * cells can take, from the types of what their coordinates read, an {#each} index running from 0 to
 * its collection's max - 1, a position (index(...)) from −1 to its array's max, and an expression
 * over them. Null where a coordinate's values cannot be worked out, so that grid keeps only the
 * tracks the run's cells reach; each such coordinate is added to `unknown`, to be warned of.
 */
export function gridExtents(
  markup: unknown,
  domain: DomainRegistry,
  variables: Scope,
  views: Scope,
  unknown: { axis: string; start: number; end: number }[] = []
): Map<number, [number[] | null, number[] | null]> {
  const atoms: Record<string, AtomType> = { ...domain.atoms };
  const extended: DomainRegistry = { ...domain, atoms };
  const extents = new Map<number, [number[] | null, number[] | null]>();
  const inEach = (each: Node, scope: Scope): Scope => {
    const inner = new Map(scope);
    // count(n) walks 0, 1, … up to n − 1, the most its type allows.
    if (countArgument(each.expression)) {
      const counted = countOf(each.expression as Node, scope, extended);
      if ('max' in counted && counted.max > 0) {
        const index = `count to ${counted.max}`;
        atoms[index] ??= { name: index, base: 'integer', min: 0, max: counted.max - 1 };
        const context = each.context as Node | undefined;
        if (context?.type === 'Identifier') inner.set(context.name as string, index);
        if (typeof each.index === 'string') inner.set(each.index, index);
      }
      return inner;
    }
    const collection = typeOfPath(each.expression as Node, scope, extended);
    const structure = collection === undefined ? undefined : extended.structures[collection];
    if (structure?.kind !== 'collection') return inner;
    const context = each.context as Node | undefined;
    if (context?.type === 'Identifier') inner.set(context.name as string, structure.element);
    if (typeof each.index === 'string' && structure.max !== undefined) {
      const index = `${structure.name} index`;
      atoms[index] ??= { name: index, base: 'integer', min: 0, max: structure.max - 1 };
      inner.set(each.index, index);
    }
    return inner;
  };
  const coordinate = (cell: Node, name: string, scope: Scope): number[] | undefined => {
    const attribute = (cell.attributes as Node[] | undefined)?.find((each) => each.name === name);
    const [part] = Array.isArray(attribute?.value) ? (attribute.value as Node[]) : [];
    const expression =
      part?.type === 'MustacheTag'
        ? (part.expression as Node)
        : part?.type === 'Text'
          ? { type: 'Literal', value: Number(part.data) }
          : undefined;
    const values = expression && valuesOf(expression, scope, extended);
    const known = values?.length && values.every((value) => typeof value === 'number');
    if (!known && part?.type === 'MustacheTag')
      unknown.push({
        axis: name,
        start: (part.expression as Node).start as number,
        end: (part.expression as Node).end as number
      });
    return known ? (values as number[]) : undefined;
  };
  const isGrid = (node: Node) =>
    node.type === 'InlineComponent' &&
    node.name === 'Node' &&
    (node.attributes as Node[] | undefined)?.some(
      (attribute) =>
        attribute.name === 'layout' &&
        Array.isArray(attribute.value) &&
        (attribute.value as Node[])[0]?.data === 'grid'
    );
  // {@const before = j - 1}: the name takes its expression's values.
  const constant = (tag: Node, scope: Map<string, string>): void => {
    const { left, right } = (tag.expression ?? {}) as { left?: Node; right?: Node };
    if (left?.type !== 'Identifier') return;
    scope.delete(left.name as string);
    const values = right ? valuesOf(right, scope, extended) : undefined;
    if (!values?.length || !values.every(Number.isInteger)) return;
    const name = `{@const ${left.name as string}} at ${tag.start as number}`;
    atoms[name] = { name, base: 'integer', values: values as number[] };
    scope.set(left.name as string, name);
  };
  // The most items a grid's child can place on the grid's tracks as a subgrid (see subgrid in
  // Node.svelte): one for each node, and a collection's max for an {#each} over it or a value of it
  // drawn by its view; none where it holds text or a block whose items cannot be counted.
  const itemCount = (node: Node, scope: Scope): number | undefined => {
    const maxOf = (expression: unknown) => {
      const type = typeOfPath(expression as Node, scope, extended);
      const structure = type === undefined ? undefined : extended.structures[type];
      return structure?.kind === 'collection' ? structure.max : undefined;
    };
    let count = 0;
    for (const child of (node.children as Node[] | undefined) ?? []) {
      if (child.type === 'Text' && !String(child.data ?? '').trim()) continue;
      if (child.type === 'InlineComponent' && child.name === 'Node') count += 1;
      else if (child.type === 'MustacheTag') count += maxOf(child.expression) ?? 1;
      else if (child.type === 'EachBlock') {
        const max = maxOf(child.expression);
        if (max === undefined) return undefined;
        count += max;
      } else return undefined;
    }
    return count || undefined;
  };
  // The rows and cols a grid's cells can take, through the blocks between it and them.
  const cells = (
    node: unknown,
    scope: Scope,
    found: { row?: number[]; col?: number[] }[]
  ): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      const local = new Map(scope);
      for (const child of node) {
        if ((child as Node).type === 'ConstTag') constant(child as Node, local);
        cells(child, local, found);
      }
      return;
    }
    const part = node as Node;
    if (part.type === 'EachBlock') {
      cells(part.children, inEach(part, scope), found);
      return cells(part.else, scope, found);
    }
    if (part.type === 'IfBlock' || part.type === 'ElseBlock') {
      cells(part.children, scope, found);
      return cells(part.else, scope, found);
    }
    if (part.type === 'InlineComponent' && part.name === 'Node') {
      const given = (name: string) =>
        (part.attributes as Node[] | undefined)?.some((each) => each.name === name);
      // An axis left out spans every track, reaching none of its own, unless its items are placed
      // on them as a subgrid's, item k at k, where they can be counted; both left out, (0, 0). A
      // span reaches the tracks after its coordinate too.
      const reached = (axis: 'row' | 'col', other: 'row' | 'col') => {
        if (!given(axis)) {
          if (!given(other)) return [0];
          const count = itemCount(part, scope);
          return Array.from({ length: count ?? 0 }, (_, k) => k);
        }
        const at = coordinate(part, axis, scope);
        const span = given(`${axis}Span`) ? coordinate(part, `${axis}Span`, scope) : [1];
        if (!at || !span) return undefined;
        return at.flatMap((start) =>
          Array.from({ length: Math.max(1, ...span) }, (_, k) => start + k)
        );
      };
      found.push({ row: reached('row', 'col'), col: reached('col', 'row') });
    }
  };
  const every = (found: { row?: number[]; col?: number[] }[], axis: 'row' | 'col') =>
    found.length && found.every((cell) => cell[axis] !== undefined)
      ? [...new Set(found.flatMap((cell) => cell[axis]!))].sort((a, b) => a - b)
      : null;
  const walk = (node: unknown, scope: Scope): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => walk(child, scope));
    const part = node as Node;
    if (part.type === 'SnippetBlock') {
      const view = views.get((part.expression as Node | undefined)?.name as string);
      return walk(part.children, view === undefined ? scope : new Map([[viewThis, view]]));
    }
    if (part.type === 'EachBlock') {
      walk(part.children, inEach(part, scope));
      return walk(part.else, scope);
    }
    if (isGrid(part)) {
      const found: { row?: number[]; col?: number[] }[] = [];
      cells(part.children, scope, found);
      extents.set(part.start as number, [every(found, 'row'), every(found, 'col')]);
    }
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'metadata') walk(child, scope);
  };
  walk(markup, variables);
  return extents;
}
