/** Static subset check: everything outside this list is rejected before any statement of a block runs. */

import type { AnyNode, BlockStatement } from 'acorn';

import {
  AlgorithmError,
  describe,
  domainFunctions,
  forbiddenProperties,
  reservedNames,
  type BlockKind,
  type Span
} from './block.server';
import { drawFunctions } from './random.server';

const allowedBinary = new Set(['+', '-', '*', '/', '%', '**', '<', '<=', '>', '>=', '===', '!==']);
const allowedAssignment = new Set(['=', '+=', '-=', '*=', '/=', '%=']);

export function checkSubset(
  root: BlockStatement,
  offset: (node: AnyNode) => Span,
  kind: BlockKind,
  constructors: ReadonlySet<string>
): void {
  const reject = (node: AnyNode, message: string): never => {
    throw new AlgorithmError(message, offset(node));
  };
  const visit = (node: AnyNode, ancestors: readonly AnyNode[]): void => {
    const parent = ancestors.at(-1);
    switch (node.type) {
      case 'BlockStatement':
      case 'ExpressionStatement':
      case 'IfStatement':
      case 'ForStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'EmptyStatement':
      case 'SpreadElement':
      case 'ConditionalExpression':
      case 'LogicalExpression':
      case 'SequenceExpression':
      case 'TemplateLiteral':
      case 'TemplateElement':
      case 'VariableDeclarator':
        break;
      case 'ArrayExpression':
      case 'ObjectExpression':
        // Input and algorithm values all come from domain types, so a literal is only written
        // where a type is known for it: given to a type, or stored into a collection or record.
        if ((kind === 'input' || kind === 'algorithm') && !typedContext(node, ancestors))
          reject(
            node,
            node.type === 'ArrayExpression'
              ? 'Arrays are made by a collection type: define one in the domain block, such as const Queue = collection(Vertex);, and write Queue([...]). A literal can also be stored into a typed collection or record, as in queue.push(...) or cell.items = [...].'
              : 'Objects are made by a record type: define one in the domain block, such as const Edge = record({ from: Vertex, to: Vertex });, and write Edge({ ... }). A literal can also be stored into a typed collection or record, as in edges.push({ ... }).'
          );
        break;
      case 'CallExpression':
        if (node.callee.type === 'Identifier') checkBuiltin(node, node.callee.name, ancestors);
        break;
      case 'ReturnStatement':
        if (node.argument) reject(node, 'return stops the algorithm and cannot return a value.');
        break;
      case 'BreakStatement':
      case 'ContinueStatement':
        if (node.label) reject(node, 'Labelled break and continue are not supported.');
        break;
      case 'VariableDeclaration':
        if (node.kind === 'var') reject(node, 'Use let or const instead of var.');
        for (const declarator of node.declarations) {
          if (declarator.id.type !== 'Identifier')
            reject(declarator, 'Destructuring declarations are not supported.');
          else if (reservedNames.has(declarator.id.name))
            reject(declarator, `"${declarator.id.name}" is reserved for the view.`);
        }
        break;
      case 'ForOfStatement':
        if (
          node.await ||
          node.left.type !== 'VariableDeclaration' ||
          node.left.declarations[0]?.id.type !== 'Identifier'
        )
          reject(node, 'for...of must declare one variable, as in for (const x of items).');
        break;
      case 'Identifier':
        break;
      case 'Literal':
        if ('regex' in node || 'bigint' in node)
          reject(node, 'Regular expressions and BigInt are not supported.');
        if (node.value === null && (kind === 'input' || kind === 'algorithm'))
          reject(
            node,
            `There is no null: every value has a domain type. For "nothing yet", use a value of a type that says so, such as Index(-1), or Unreached('unreached') in a union.`
          );
        break;
      case 'Property':
        if (node.kind !== 'init' || node.method || node.computed)
          reject(node, 'Object properties must be plain name: value pairs.');
        if (
          (node.key.type === 'Identifier' && forbiddenProperties.has(node.key.name)) ||
          (node.key.type === 'Literal' && forbiddenProperties.has(String(node.key.value)))
        )
          reject(node, 'That property name is not allowed.');
        break;
      case 'MemberExpression':
        if (node.optional) reject(node, 'Optional chaining is not supported.');
        if (node.object.type === 'Super') reject(node, 'super is not supported.');
        if (!node.computed && node.property.type === 'Identifier') {
          if (forbiddenProperties.has(node.property.name))
            reject(node, 'That property name is not allowed.');
        }
        break;
      case 'UnaryExpression':
        if (!['!', '-', '+'].includes(node.operator))
          reject(node, `The ${node.operator} operator is not supported.`);
        break;
      case 'BinaryExpression':
        if (node.operator === '==' || node.operator === '!=')
          reject(node, `Use ${node.operator}= instead of ${node.operator}.`);
        if (!allowedBinary.has(node.operator))
          reject(node, `The ${node.operator} operator is not supported.`);
        break;
      case 'AssignmentExpression':
        if (!allowedAssignment.has(node.operator))
          reject(node, `The ${node.operator} operator is not supported.`);
        if (node.left.type !== 'Identifier' && node.left.type !== 'MemberExpression')
          reject(node, 'Only variables, elements, and properties can be assigned.');
        break;
      case 'UpdateExpression':
        if (node.argument.type !== 'Identifier' && node.argument.type !== 'MemberExpression')
          reject(node, 'Only variables, elements, and properties can be incremented.');
        break;
      case 'YieldExpression':
        if (kind !== 'algorithm')
          reject(node, `yield belongs in the algorithm block, not the ${kind} block.`);
        if (node.delegate) reject(node, 'yield* is not supported.');
        if (parent?.type !== 'ExpressionStatement')
          reject(node, 'yield must be a statement of its own, as in yield "label";');
        break;
      default:
        reject(node, `${describe(node.type)} is not supported in ${kind} blocks.`);
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'loc') continue;
      for (const item of Array.isArray(child) ? child : [child]) {
        if (item && typeof item === 'object' && typeof (item as AnyNode).type === 'string')
          visit(item as AnyNode, [...ancestors, node]);
      }
    }
  };
  /**
   * Whether a literal sits where a domain type is known for it: as an argument of a type, of
   * .push() or .unshift(), or as the value assigned to an element or property, directly or inside
   * other literals there. The type itself is checked when the value is made.
   */
  const typedContext = (node: AnyNode, ancestors: readonly AnyNode[]): boolean => {
    let child = node;
    for (let index = ancestors.length - 1; index >= 0; index--) {
      const ancestor = ancestors[index];
      if (['ArrayExpression', 'ObjectExpression', 'Property'].includes(ancestor.type)) {
        child = ancestor;
        continue;
      }
      if (ancestor.type === 'CallExpression') {
        if (!(ancestor.arguments as AnyNode[]).includes(child)) return false;
        const callee = ancestor.callee;
        if (callee.type === 'Identifier') return constructors.has(callee.name);
        return (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          (callee.property.name === 'push' || callee.property.name === 'unshift')
        );
      }
      return (
        ancestor.type === 'AssignmentExpression' &&
        ancestor.operator === '=' &&
        ancestor.right === child &&
        ancestor.left.type === 'MemberExpression'
      );
    }
    return false;
  };
  const checkBuiltin = (node: AnyNode, name: string, ancestors: readonly AnyNode[]): void => {
    if (domainFunctions.has(name)) {
      if (kind !== 'domain')
        reject(node, `${name}() defines a type and belongs in the domain block.`);
    } else if (constructors.has(name)) {
      if (kind !== 'input' && kind !== 'algorithm')
        reject(node, `${name}(...) creates a typed value in the input or algorithm block.`);
    } else if (drawFunctions.has(name)) {
      // A draw is the value of a top-level const, or sits inside object and array literals that
      // make up that value, such as const look = { cells: pick([...]) }.
      const [, topDeclaration, topDeclarator, ...within] = ancestors;
      if (
        kind !== 'design' ||
        topDeclaration?.type !== 'VariableDeclaration' ||
        topDeclaration.kind !== 'const' ||
        topDeclarator?.type !== 'VariableDeclarator' ||
        !within.every((ancestor) =>
          ['ObjectExpression', 'Property', 'ArrayExpression'].includes(ancestor.type)
        )
      )
        reject(
          node,
          `${name}() is a design draw; use it only in the value of a top-level const in the design block, such as const layout = ${name}(...).`
        );
    } else {
      reject(
        node,
        `${name}() is not available; only Math functions and array methods can be called.`
      );
    }
  };
  root.body.forEach((statement) => visit(statement, [root]));
}
