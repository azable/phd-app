/**
 * Props a view binds to its value, as `<Node stroke={this.visited} />` (see library/node/bound.ts):
 * the values each expression can take, worked out from the view's type before the algorithm runs,
 * and the variables saying which option each value takes, or for a length, its unit and anchor.
 */

import type { AtomType } from './algorithm/atoms.server';
import type { DomainRegistry } from './algorithm/structures.server';
import type { DesignSpace, DesignValue } from './design.server';
import { viewThis } from './label-values';
import {
  anchorKey,
  anchors,
  boundCapacity,
  boundHues,
  boundOptions,
  colourProps,
  lengthProps,
  lengthUnits,
  orderKeys,
  orderedProps,
  orders,
  starterAnchor,
  unitKey,
  valueKey,
  type BoundDomain,
  type BoundValue
} from './library/node/bound';

/** A prop a view binds: the kind of the node, the prop, and the values its expression takes. */
export type Binding = { kind: string; prop: string; domain: BoundDomain };

/** More values than this make no domain a prop could tell apart, so working them out stops. */
const largest = 1000;

type Node = Record<string, unknown> & { type?: string };

/** The values of a type, in order, or undefined where they are not few and known. */
function valuesOfType(domain: DomainRegistry, type: string): BoundValue[] | undefined {
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

/** The type a path from the view's value reads, as this.dist, through records and references. */
function typeOf(node: Node, thisType: string, domain: DomainRegistry): string | undefined {
  if (node.type === 'Identifier') return node.name === viewThis ? thisType : undefined;
  if (node.type !== 'MemberExpression' || node.computed) return undefined;
  const owner = typeOf(node.object as Node, thisType, domain);
  let structure = owner === undefined ? undefined : domain.structures[owner];
  if (structure?.kind === 'ref') structure = domain.structures[structure.element];
  return structure?.kind === 'record'
    ? structure.fields[(node.property as { name?: string }).name ?? '']
    : undefined;
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
function valuesOf(node: Node, thisType: string, domain: DomainRegistry): BoundValue[] | undefined {
  switch (node.type) {
    case 'Literal':
      return ['string', 'number', 'boolean'].includes(typeof node.value)
        ? [node.value as BoundValue]
        : undefined;
    case 'Identifier':
    case 'MemberExpression': {
      const type = typeOf(node, thisType, domain);
      return type === undefined ? undefined : valuesOfType(domain, type);
    }
    case 'UnaryExpression': {
      if (node.operator === '!') return [false, true];
      const values = valuesOf(node.argument as Node, thisType, domain);
      return node.operator === '-' && values?.every((value) => typeof value === 'number')
        ? values.map((value) => -value)
        : undefined;
    }
    case 'BinaryExpression': {
      if (comparisons.has(node.operator as string)) return [false, true];
      const apply = arithmetic[node.operator as string];
      const operands = [node.left, node.right].map((side) =>
        valuesOf(side as Node, thisType, domain)
      );
      if (!apply || operands.some((values) => !values)) return undefined;
      const all = combinations(operands as BoundValue[][]);
      if (!all?.every((pair) => pair.every((value) => typeof value === 'number'))) return undefined;
      const results = all.map(([a, b]) => apply(a as number, b as number));
      return results.every(Number.isFinite) ? results : undefined;
    }
    case 'LogicalExpression': {
      const operands = [node.left, node.right].map((side) =>
        valuesOf(side as Node, thisType, domain)
      );
      if (operands.some((values) => !values)) return undefined;
      const all = combinations(operands as BoundValue[][]);
      return all?.map(([a, b]) =>
        node.operator === '&&' ? a && b : node.operator === '||' ? a || b : (a ?? b)
      );
    }
    case 'ConditionalExpression': {
      const branches = [node.consequent, node.alternate].map((side) =>
        valuesOf(side as Node, thisType, domain)
      );
      return branches.some((values) => !values) ? undefined : (branches.flat() as BoundValue[]);
    }
    case 'CallExpression': {
      const callee = node.callee as Node;
      const object = callee.object as Node | undefined;
      const name = (callee.property as { name?: string } | undefined)?.name ?? '';
      if (callee.type !== 'MemberExpression' || object?.name !== 'Math' || !maths[name])
        return undefined;
      const args = (node.arguments as Node[]).map((arg) => valuesOf(arg, thisType, domain));
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

/** Whether an expression reads the view's value, so it is no constant look. */
function readsThis(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(readsThis);
  const part = node as Node;
  if (part.type === 'Identifier' && part.name === viewThis) return true;
  return Object.entries(part).some(
    ([key, child]) => key !== 'parent' && key !== 'loc' && readsThis(child)
  );
}

/** A value names its own variable, as Card.stroke@visited, so it is one word. */
const nameable = (value: BoundValue) =>
  typeof value === 'boolean' || /^[A-Za-z0-9_-]+$/u.test(String(value));

/**
 * The values a prop bound to `expression` in a view of `thisType` can take, in order, or why it
 * cannot be bound: numbers keep their order and map onto an ordered prop in order; true and false
 * and words are unordered and map onto any prop, each its own option.
 */
export function boundDomain(
  prop: string,
  expression: unknown,
  written: string,
  thisType: string,
  domain: DomainRegistry | undefined
): BoundDomain | { problem: string } {
  if (!readsThis(expression))
    return {
      problem: `${prop}={${written}} reads nothing of the view's value: a constant look is the design's, a variable of the node's kind, so a bound prop reads this, as ${prop}={this.visited}.`
    };
  const found = domain && valuesOf(expression as Node, thisType, domain);
  if (!found)
    return {
      problem: `${prop}={${written}} takes values that cannot be known before the algorithm runs: a bound prop reads this, its fields, and comparisons and arithmetic of them, as ${prop}={this.visited} or ${prop}={this.level}, each of a type with few values, as type('integer', { min: 0, max: 3 }) or an enumeration.`
    };
  const numbers = found.every((value) => typeof value === 'number');
  const values = numbers
    ? unique(found).toSorted((a, b) => (a as number) - (b as number))
    : found.every((value) => typeof value === 'boolean')
      ? [false, true]
      : unique(found);
  const ordered = numbers;
  const capacity = boundCapacity(prop, ordered);
  if (ordered && !orderedProps.has(prop) && !colourProps.has(prop))
    return {
      problem: `${prop}={${written}} is a number, whose values run in order, and ${prop}'s options do not: bind a number to a prop that runs in order, as ${[...orderedProps].join(', ')}, or a colour, which takes one hue's shades.`
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
 * The least and largest values a length bound to `expression` in a view of `thisType` can take, or
 * why it cannot be bound: numbers, none below zero, as many as the type has. A type with too many
 * values to list is read by its range.
 */
export function boundLengthDomain(
  prop: string,
  expression: unknown,
  written: string,
  thisType: string,
  domain: DomainRegistry | undefined
): BoundDomain | { problem: string } {
  if (!readsThis(expression))
    return {
      problem: `${prop}={${written}} reads nothing of the view's value: a length is the value times a unit, so it reads this, as ${prop}={this} or ${prop}={this.dist}; a box not bound sizes to its contents.`
    };
  const node = expression as Node;
  const type =
    domain && (node.type === 'Identifier' || node.type === 'MemberExpression')
      ? typeOf(node, thisType, domain)
      : undefined;
  const atom = type === undefined ? undefined : domain?.atoms[type];
  const found =
    (domain && valuesOf(node, thisType, domain)) ??
    (atom && atom.base !== 'boolean' && atom.min !== undefined && atom.max !== undefined
      ? [atom.min, atom.max]
      : undefined);
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
      space[anchorKey(kind, prop)] = anchors;
      starter[anchorKey(kind, prop)] = starterAnchor(prop);
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
