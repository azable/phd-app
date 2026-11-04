/**
 * What the input and algorithm compute themselves, as JavaScript does, and what they may not write:
 * anything that hides a loop or a step the view cannot show (see hiddenProblem), and a plain number
 * from Math or division used without the type it should be (see unwrappedNumber).
 */

import type { AnyNode, BlockStatement } from 'acorn';

/** Collection methods that change the collection in place, one element at a time. */
export const changingMethods: ReadonlySet<string> = new Set(['push', 'pop', 'shift', 'unshift']);
/** Collection methods that hide a loop: a search, a copy, or work across every element. */
const loopingMethods: ReadonlySet<string> = new Set([
  'indexOf',
  'lastIndexOf',
  'includes',
  'find',
  'findIndex',
  'some',
  'every',
  'filter',
  'map',
  'forEach',
  'reduce',
  'sort',
  'reverse',
  'slice',
  'splice',
  'concat',
  'fill',
  'join'
]);

/**
 * The raw operation a node is, if any: its operator (a write with `=` is none), `.length`, `Math`,
 * a template string, or a collection method, as `.push`. A negative number is a literal, not an
 * operation.
 */
export function rawOperation(node: AnyNode): string | undefined {
  switch (node.type) {
    case 'BinaryExpression':
    case 'UpdateExpression':
      return node.operator;
    case 'AssignmentExpression':
      return node.operator === '=' ? undefined : node.operator;
    case 'UnaryExpression':
      return node.operator === '-' &&
        node.argument.type === 'Literal' &&
        typeof node.argument.value === 'number'
        ? undefined
        : node.operator;
    case 'MemberExpression':
      return !node.computed &&
        node.property.type === 'Identifier' &&
        node.property.name === 'length'
        ? '.length'
        : undefined;
    case 'CallExpression': {
      const { callee } = node;
      const name =
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property.type === 'Identifier'
          ? callee.property.name
          : undefined;
      return name && (changingMethods.has(name) || loopingMethods.has(name))
        ? `.${name}`
        : undefined;
    }
    case 'Identifier':
      return node.name === 'Math' ? 'Math' : undefined;
    case 'TemplateLiteral':
      return node.expressions.length ? 'template' : undefined;
    default:
      return undefined;
  }
}

/**
 * Why the input or algorithm may not write an operation, or undefined when it may: a method that
 * hides a loop, a template string or text joined with + (text is an enumeration's values, and a word
 * a collection of its characters), or === between two collections, which compares their identities.
 */
export function hiddenProblem(
  node: AnyNode,
  operation: string,
  operands: readonly unknown[],
  text: (node: AnyNode) => string
): string | undefined {
  if (operation === 'template')
    return `${text(node)}: the algorithm builds no text; a word is a collection of characters, as const Word = collection(Char, { max: 12 });, and a caption joins text in the view.`;
  if (operation.startsWith('.') && loopingMethods.has(operation.slice(1)))
    return `${text(node)}: .${operation.slice(1)}() does a whole loop in one step, which nothing can show or count; write the loop, labelling its steps, as for (@start[let k = Index(values, 0)]; @more[k < values.length]; @next[k++]) @look{ … }.`;
  if ((operation === '+' || operation === '+=') && operands.some((value) => isText(value)))
    return `${text(node)}: the algorithm joins no text; a word is a collection of characters, joined element by element in a loop, and a caption joins text in the view.`;
  if (
    (operation === '===' || operation === '!==') &&
    operands.length === 2 &&
    operands.every((value) => Array.isArray(value))
  )
    return `${text(node)}: === on two collections compares which collection each is, not what they hold; compare them element by element in a loop.`;
  return undefined;
}

function isText(value: unknown): boolean {
  const plain =
    value !== null && typeof value === 'object' && 'value' in value
      ? (value as { value: unknown }).value
      : value;
  return typeof plain === 'string';
}

/**
 * The first Math call or division in a block not inside a call of a type, as Index(Math.floor(…)):
 * either gives a plain number, a whole one or not depending on the values, so the type it should be
 * is written where it is computed, the same on every run.
 */
export function unwrappedNumber(
  root: BlockStatement,
  isType: (name: string) => boolean,
  text: (node: AnyNode) => string
): { node: AnyNode; message: string } | undefined {
  let found: { node: AnyNode; message: string } | undefined;
  const visit = (node: unknown, wrapped: boolean): void => {
    if (found || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => visit(child, wrapped));
    const part = node as AnyNode;
    if (typeof part.type !== 'string') return;
    if (part.type === 'CallExpression') {
      const { callee } = part;
      if (callee.type === 'Identifier' && isType(callee.name)) {
        part.arguments.forEach((argument) => visit(argument, true));
        return;
      }
      const math =
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'Math';
      if (math) {
        if (!wrapped)
          found = {
            node: part,
            message: `${text(part)} gives a plain number: write the type it should be around it, as Index(${text(part)}).`
          };
        else part.arguments.forEach((argument) => visit(argument, true));
        return;
      }
    }
    if (part.type === 'BinaryExpression' && part.operator === '/' && !wrapped) {
      found = {
        node: part,
        message: `${text(part)} gives a plain number, whole or not depending on the values: write the type it should be around it, as Index(Math.floor(${text(part)})).`
      };
      return;
    }
    for (const [key, child] of Object.entries(part))
      if (key !== 'loc') visit(child, wrapped && part.type !== 'CallExpression');
  };
  visit(root.body, false);
  return found;
}

/** What the interpreter needs to know of the domain: a collection's index type. */
export type RawContext = {
  text: (node: AnyNode) => string;
  indexOf: (collection: string) => string | undefined;
};
