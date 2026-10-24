/** Static subset check: everything outside this list is rejected before any statement of a block runs. */

import type { AnyNode, BlockStatement } from 'acorn';

import {
  AlgorithmError,
  arrayMethods,
  describe,
  domainFunctions,
  forbiddenProperties,
  reservedNames,
  type BlockKind,
  type Span
} from './block.server';

const allowedBinary = new Set(['+', '-', '*', '/', '%', '**', '<', '<=', '>', '>=', '===', '!==']);
const allowedAssignment = new Set(['=', '+=', '-=', '*=', '/=', '%=']);

/**
 * `constructors` names the types the block may call, and `operators` the operators the algorithm
 * may. An operator's function, in the domain block, is held to the algorithm's subset.
 */
export function checkSubset(
  root: BlockStatement,
  offset: (node: AnyNode) => Span,
  blockKind: BlockKind,
  constructors: ReadonlySet<string>,
  operators: ReadonlySet<string> = new Set()
): void {
  const functionNames = new Set(
    root.body.flatMap((statement) =>
      statement.type === 'FunctionDeclaration' ? [statement.id.name] : []
    )
  );
  const reject = (node: AnyNode, message: string): never => {
    throw new AlgorithmError(message, offset(node));
  };
  const visit = (node: AnyNode, ancestors: readonly AnyNode[]): void => {
    const parent = ancestors.at(-1);
    const inFunction = ancestors.some((ancestor) => ancestor.type === 'FunctionDeclaration');
    const inOperator = ancestors.some((ancestor) => ancestor.type === 'ArrowFunctionExpression');
    const kind: BlockKind = inOperator ? 'algorithm' : blockKind;
    switch (node.type) {
      case 'BlockStatement':
      case 'ExpressionStatement':
      case 'IfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'ForStatement':
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
        // where a type is known for it: given to a type or an operator, or written into an element
        // or field.
        if ((kind === 'input' || kind === 'algorithm') && !typedContext(node, ancestors))
          reject(
            node,
            node.type === 'ArrayExpression'
              ? 'Arrays are made by a collection type: define one in the domain block, such as const Queue = collection(Vertex);, and write Queue([...]). A literal can also be given to an operator, whose types it takes, or written into an element or field, as in cell.items = [...].'
              : 'Objects are made by a record type: define one in the domain block, such as const Edge = record({ from: Vertex, to: Vertex });, and write Edge({ ... }). A literal can also be given to an operator, whose types it takes, or written into an element or field, as in edges[0] = { ... }.'
          );
        break;
      case 'CallExpression':
        if (node.callee.type === 'Identifier') checkBuiltin(node, node.callee.name, kind);
        // An operator is one step a learner takes as a single action, never a library algorithm.
        if (
          inOperator &&
          node.callee.type === 'MemberExpression' &&
          !node.callee.computed &&
          node.callee.property.type === 'Identifier' &&
          !(node.callee.object.type === 'Identifier' && node.callee.object.name === 'Math') &&
          !arrayMethods.has(node.callee.property.name)
        )
          reject(
            node,
            `An operator is one primitive step; ${node.callee.property.name} is an algorithm, so write it out in the algorithm block.`
          );
        break;
      case 'ArrowFunctionExpression':
        if (
          blockKind === 'domain' &&
          parent?.type === 'CallExpression' &&
          parent.callee.type === 'Identifier' &&
          (parent.callee.name === 'binop' || parent.callee.name === 'unop') &&
          parent.arguments.at(-1) === node
        ) {
          if (node.body.type === 'BlockStatement')
            reject(
              node.body,
              'An operator’s function is one expression, without braces, as in binop(Int, Int, (a, b) => Flag(a > b)).'
            );
          break;
        }
        if (inOperator)
          reject(
            node,
            'An operator is one primitive step, and a function inside it, as for sort, map, or filter, makes it an algorithm: write that out in the algorithm block.'
          );
        reject(
          node,
          'Arrow functions are only an operator’s function, in binop(...) or unop(...) in the domain block; declare function name(...) { … } at the top level of the algorithm block.'
        );
        break;
      case 'FunctionDeclaration': {
        const name = node.id?.name ?? '';
        if (blockKind !== 'algorithm' || parent !== root)
          reject(node, 'Functions are declared at the top level of the algorithm block.');
        if (node.async || node.generator)
          reject(node, `Write function ${name}(...), without * or async.`);
        if (constructors.has(name) || reservedNames.has(name) || name === 'Math')
          reject(node, `"${name}" is taken; give the function another name.`);
        for (const param of node.params)
          if (param.type !== 'Identifier')
            reject(param, `${name}'s parameters are plain names, given a value by each call.`);
        break;
      }
      case 'ObjectPattern':
        reject(node, 'Destructuring is not supported.');
        break;
      case 'ReturnStatement':
        if (node.argument && !inFunction)
          reject(
            node,
            'return stops the algorithm and cannot return a value; a function can, as in return i;.'
          );
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
        // A type or an operator gives a literal its type.
        return (
          callee.type === 'Identifier' &&
          (constructors.has(callee.name) || operators.has(callee.name))
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
  const checkBuiltin = (node: AnyNode, name: string, kind: BlockKind): void => {
    if (functionNames.has(name)) {
      if (kind !== 'algorithm') reject(node, `${name}(...) is a function of the algorithm block.`);
    } else if (domainFunctions.has(name)) {
      if (kind !== 'domain')
        reject(node, `${name}() defines a type and belongs in the domain block.`);
    } else if (operators.has(name)) {
      if (kind !== 'algorithm')
        reject(node, `${name}(...) is an operator, which the algorithm applies.`);
    } else if (constructors.has(name)) {
      if (kind !== 'input' && kind !== 'algorithm')
        reject(node, `${name}(...) creates a typed value in the input or algorithm block.`);
    } else {
      reject(
        node,
        `${name}() is not available; only the algorithm’s functions, the domain’s types and operators, and collection methods can be called.`
      );
    }
  };
  root.body.forEach((statement) => visit(statement, [root]));
}
