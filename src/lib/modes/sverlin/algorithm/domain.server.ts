/**
 * The domain block: atomic types built from primitive kinds, refinements, and enumerations, the
 * unions, records, and collections built from them, and the operators on them.
 */

import type { AnyNode, ArrowFunctionExpression, CallExpression, Expression, Pattern } from 'acorn';

import { atomBases, type AtomBase, type AtomType } from './atoms.server';
import { AlgorithmError, domainFunctions } from './block.server';
import { parseBlock } from './parse.server';
import type { DomainRegistry, OperatorType, StructureType } from './structures.server';

/**
 * Read the domain block's type definitions. Nothing is predefined: an atomic type is a primitive
 * kind with its range (`type('integer', { min: 0, max: 9 })`), a refinement of a defined type (`type(Int, { unit: 'cm' })`), or an
 * enumeration (`type(['♠', '♥'])`); a union, record, or collection is built from types defined
 * before it (`union(Distance, Unreached)`, `record({ from: Vertex, to: Vertex })`,
 * `collection(Edge)`).
 */
export function interpretDomain(body: string): DomainRegistry {
  const source = body;
  const { root, offset, parameterTypes } = parseBlock(source, 'domain');
  const fail = (node: AnyNode, message: string): never => {
    throw new AlgorithmError(message, offset(node));
  };
  const atoms: Record<string, AtomType> = {};
  const structures: Record<string, StructureType> = {};
  const operators: Record<string, OperatorType> = {};
  /** A type defined earlier in the block, named by an identifier. */
  const defined = (node: Expression | undefined, role: string): string => {
    if (node?.type !== 'Identifier')
      return fail(node ?? root, `${role} must name a type defined earlier in the domain block.`);
    if (!Object.hasOwn(atoms, node.name) && !Object.hasOwn(structures, node.name))
      fail(
        node,
        Object.hasOwn(operators, node.name)
          ? `${node.name} is an operator, not a type.`
          : `Unknown type ${node.name}; define it earlier in the domain block.`
      );
    return node.name;
  };
  for (const statement of root.body) {
    // The parsing wrapper's 'use strict' directive is not part of the authored block.
    if (statement.type === 'ExpressionStatement' && 'directive' in statement) continue;
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const')
      fail(statement, 'The domain block only defines types, as in const Height = type(Int);');
    for (const declarator of (statement as { declarations: { id: Pattern; init?: unknown }[] })
      .declarations) {
      const name = (declarator.id as { name: string }).name;
      const init = declarator.init as Expression | undefined | null;
      const kind =
        init?.type === 'CallExpression' && init.callee.type === 'Identifier'
          ? init.callee.name
          : undefined;
      if (!kind || !domainFunctions.has(kind))
        fail(
          declarator as AnyNode,
          `Define ${name} with type(...), union(...), record({...}), collection(...), index(...), or ref(...), as in const ${name} = type('integer', { min: 0, max: 9 });, or an operator with binop(...) or unop(...), as in const Greater = binop((a: Int, b: Int) => Flag(a > b));`
        );
      const call = init as CallExpression;
      if (name in atoms || name in structures || name in operators)
        fail(declarator as AnyNode, `"${name}" is already defined.`);
      if (kind === 'binop' || kind === 'unop') {
        operators[name] = defineOperator(name, kind, call);
        continue;
      }
      if (kind === 'index') {
        atoms[name] = defineIndex(name, call);
        continue;
      }
      if (kind === 'ref') {
        structures[name] = defineRef(name, call);
        continue;
      }
      if (kind !== 'type') {
        structures[name] = defineStructure(name, kind as StructureType['kind'], call);
        continue;
      }
      const [definition, options, extra] = call.arguments as Expression[];
      if (!definition || extra)
        fail(
          call,
          'type() takes a kind, a type, or a list of allowed values, then optional options.'
        );
      let type: AtomType;
      if (definition.type === 'Literal' && typeof definition.value === 'string') {
        if (!atomBases.includes(definition.value as AtomBase))
          fail(
            definition,
            `Unknown kind "${definition.value}"; use one of ${atomBases.join(', ')}.`
          );
        type = { name, base: definition.value as AtomBase };
      } else if (definition.type === 'Identifier') {
        const parent = atoms[definition.name];
        if (!parent && Object.hasOwn(structures, definition.name))
          fail(
            definition,
            `type() refines an atomic type, and ${definition.name} is a ${structures[definition.name].kind}.`
          );
        if (!parent)
          fail(
            definition,
            `Unknown type ${definition.name}; define it first, as in const ${definition.name} = type('integer', { min: 0, max: 9 });`
          );
        type = { ...parent, name, parent: parent.name };
      } else if (definition.type === 'ArrayExpression') {
        const values = definition.elements.map((element) => {
          const value = element ? literalValue(element as Expression) : undefined;
          if (typeof value !== 'string' && typeof value !== 'number')
            fail(element ?? definition, 'Enumeration values must be text or number literals.');
          return value as string | number;
        });
        if (values.length === 0 || new Set(values).size !== values.length)
          fail(definition, 'An enumeration needs at least one value, each listed once.');
        const base: AtomBase = values.every((value) => typeof value === 'string')
          ? 'text'
          : values.every((value) => typeof value === 'number')
            ? values.every(Number.isInteger)
              ? 'integer'
              : 'number'
            : fail(definition, 'Enumeration values must be all text or all numbers.');
        type = { name, base, values };
      } else {
        type = fail(
          definition,
          `type() takes a kind such as 'integer', a defined type, or a list of allowed values.`
        );
      }
      if (options) applyAtomOptions(type, options, fail);
      const unbounded = unboundedProblem(type);
      if (unbounded) fail(call, unbounded);
      atoms[name] = type;
    }
  }
  return { atoms, structures, operators };

  /**
   * A position in a collection type, as in index(Values): any whole number, of which 0 to its
   * collection's length - 1 point at an element.
   */
  function defineIndex(name: string, call: CallExpression): AtomType {
    const args = call.arguments as Expression[];
    if (args.length !== 1) fail(call, 'index() takes one collection type, as in index(Values).');
    const collection = defined(args[0], 'An index’s collection type');
    if (structures[collection]?.kind !== 'collection')
      fail(args[0], `index() points into a collection type, and ${collection} is not one.`);
    return { name, base: 'integer', index: collection };
  }

  /**
   * A reference to an element of a collection type, as in ref(Queue). Its elements are single
   * values: a record's fields are values of their own, which a reference would also have to follow.
   */
  function defineRef(name: string, call: CallExpression): StructureType {
    const args = call.arguments as Expression[];
    if (args.length !== 1) fail(call, 'ref() takes one collection type, as in ref(Queue).');
    const collection = defined(args[0], 'A reference’s collection type');
    const structure = structures[collection];
    if (structure?.kind !== 'collection')
      fail(args[0], `ref() refers to elements of a collection type, and ${collection} is not one.`);
    const { element } = structure as { element: string };
    if (!Object.hasOwn(atoms, element))
      fail(
        args[0],
        `ref() refers to elements that are single values, and ${collection} holds ${element}s; refer to one of its fields' collections, or use an index(${collection}).`
      );
    return { kind: 'ref', name, collection, element };
  }

  /**
   * An operator, as in binop((a: Int, b: Int) => Flag(a > b)) or unop((p: Index) => Index(p + 1)):
   * a function of its operands, each typed on its parameter, that is one expression, reading only
   * its parameters and Math, and giving a typed value, the call of a type, which is its result's
   * type.
   */
  function defineOperator(
    name: string,
    kind: 'binop' | 'unop',
    call: CallExpression
  ): OperatorType {
    const arity = kind === 'binop' ? 2 : 1;
    const example =
      kind === 'binop'
        ? 'binop((a: Int, b: Int) => Flag(a > b))'
        : 'unop((p: Index) => Index(p + 1))';
    const args = call.arguments as Expression[];
    const lambda = args.at(-1);
    const textOf = (node: AnyNode) => {
      const { start, end } = offset(node);
      return source.slice(start, end);
    };
    // The earlier form gave the operands' types before the function.
    if (
      args.length === arity + 1 &&
      lambda?.type === 'ArrowFunctionExpression' &&
      lambda.params.length === arity &&
      lambda.params.every((parameter) => parameter.type === 'Identifier') &&
      args.slice(0, arity).every((argument) => argument.type === 'Identifier')
    ) {
      const typed = lambda.params.map(
        (parameter, index) =>
          `${(parameter as { name: string }).name}: ${(args[index] as { name: string }).name}`
      );
      fail(
        call,
        `An operator's operand types are written on its parameters: const ${name} = ${kind}((${typed.join(', ')}) => ${textOf(lambda.body)});`
      );
    }
    if (args.length !== 1 || lambda?.type !== 'ArrowFunctionExpression')
      fail(
        call,
        `${kind}() takes a function of ${arity === 2 ? 'two operands' : 'one operand'}, each typed, as in ${example}.`
      );
    const arrow = lambda as ArrowFunctionExpression;
    if (
      arrow.async ||
      arrow.params.length !== arity ||
      arrow.params.some((p) => p.type !== 'Identifier')
    )
      fail(
        arrow,
        `${name}'s function takes ${arity} typed name${arity === 2 ? 's' : ''}, one per operand, as in ${example}.`
      );
    const parameters = arrow.params.map((parameter) => (parameter as { name: string }).name);
    if (new Set(parameters).size !== parameters.length)
      fail(arrow, `${name}'s operands need names of their own.`);
    const named = arrow.params.find(
      (parameter) => (parameter as { name: string }).name === 'value'
    );
    if (named)
      fail(
        named,
        `value names an application's result, as a view of ${name} reads it; call the operand something else.`
      );
    const operands = arrow.params.map((parameter) => {
      const written = parameterTypes.get(offset(parameter).end);
      if (!written)
        return fail(
          parameter,
          `Give ${(parameter as { name: string }).name} its type, as in ${example}.`
        );
      const type = written.type;
      if (!Object.hasOwn(atoms, type) && !Object.hasOwn(structures, type))
        throw new AlgorithmError(
          Object.hasOwn(operators, type)
            ? `${type} is an operator, not a type.`
            : `Unknown type ${type}; define it earlier in the domain block.`,
          { start: written.at, end: written.at + type.length }
        );
      return type;
    });
    if (arrow.body.type === 'BlockStatement')
      fail(arrow.body, `${name}'s function is one expression, without braces, as in ${example}.`);
    const body = arrow.body as Expression;
    const result =
      body.type === 'CallExpression' && body.callee.type === 'Identifier'
        ? body.callee.name
        : undefined;
    if (!result || (!Object.hasOwn(atoms, result) && !Object.hasOwn(structures, result)))
      fail(
        body,
        `${name} gives a typed value: wrap what it computes in a type defined above, as in ${example}.`
      );
    // The function reads its operands and Math only, and makes values of the types above.
    const visit = (node: unknown, parent?: AnyNode): void => {
      if (Array.isArray(node)) return node.forEach((child) => visit(child, parent));
      if (node === null || typeof node !== 'object' || typeof (node as AnyNode).type !== 'string')
        return;
      const part = node as AnyNode;
      if (part.type === 'AssignmentExpression' || part.type === 'UpdateExpression')
        fail(part, `${name} computes a value and changes nothing.`);
      if (part.type === 'Identifier') {
        const property =
          (parent?.type === 'MemberExpression' && parent.property === part && !parent.computed) ||
          (parent?.type === 'Property' &&
            parent.key === part &&
            !parent.computed &&
            !parent.shorthand);
        const typeCall =
          parent?.type === 'CallExpression' &&
          parent.callee === part &&
          (Object.hasOwn(atoms, part.name) || Object.hasOwn(structures, part.name));
        if (!property && !typeCall && part.name !== 'Math' && !parameters.includes(part.name))
          fail(
            part,
            Object.hasOwn(operators, part.name)
              ? `${name} cannot use the operator ${part.name}: an operator computes from its operands alone.`
              : `${name} reads only its operands (${parameters.join(', ')}) and Math, not ${part.name}.`
          );
      }
      for (const [key, child] of Object.entries(part)) if (key !== 'loc') visit(child, part);
    };
    visit(body);
    checkStructural(name, result as string, body as CallExpression, parameters, textOf);
    return { name, operands, parameters, result: result as string, body };
  }

  /**
   * An operator giving a collection or record only rearranges its operands: each element or field
   * of what it builds is an operand, a read of one or of its parts, or a spread of one or of a
   * slice of one; the whole may be a slice of an operand or empty. A new element, computed or
   * literal, is a value operator's to make, so every new value is an application of its own.
   */
  function checkStructural(
    name: string,
    result: string,
    body: CallExpression,
    parameters: readonly string[],
    textOf: (node: AnyNode) => string
  ): void {
    const structure = structures[result];
    if (structure?.kind !== 'collection' && structure?.kind !== 'record') return;
    const what = structure.kind;
    const article = /^[AEIOU]/u.test(result) ? 'an' : 'a';
    /** An operand, or a read of one or of its parts. */
    const part = (node: AnyNode): boolean =>
      (node.type === 'Identifier' && parameters.includes(node.name)) ||
      (node.type === 'MemberExpression' && part(node.object as AnyNode));
    const method = (node: AnyNode, name: string): AnyNode | undefined =>
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      !node.callee.computed &&
      node.callee.property.type === 'Identifier' &&
      node.callee.property.name === name
        ? (node.callee.object as AnyNode)
        : undefined;
    /** A slice of a part, or a slice of one reversed: its elements, rearranged. */
    const slice = (node: AnyNode): boolean => {
      const sliced = method(node, 'slice');
      if (sliced) return part(sliced) || slice(sliced);
      const reversed = method(node, 'reverse');
      return Boolean(reversed && method(reversed, 'slice') && slice(reversed));
    };
    const literal = (node: AnyNode): boolean =>
      node.type === 'Literal' ||
      node.type === 'TemplateLiteral' ||
      (node.type === 'UnaryExpression' && literal(node.argument as AnyNode)) ||
      (node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        node.arguments.length > 0 &&
        node.arguments.every((argument) => literal(argument as AnyNode)));
    const refuse = (node: AnyNode, type: string | undefined): never => {
      const shown = textOf(node);
      const kind = what === 'collection' ? 'element' : 'field';
      const lead = `${name} builds ${article} ${result} with a new ${kind}, ${shown}; an operator building a ${what} only rearranges its operands.`;
      if (literal(node))
        return fail(
          node,
          what === 'collection'
            ? `${lead} Pass it in as an operand, as binop((v: ${result}, x: ${type ?? 'Int'}) => ${result}([x, ...v])).`
            : `${lead} Pass it in as an operand.`
        );
      return fail(
        node,
        what === 'collection'
          ? `${lead} Compute the value with an operator and write it into its place, as values[p] = Inc(values[p]).`
          : `${lead} Compute the value with an operator, and pass it in or write it into its place.`
      );
    };
    const [argument, ...rest] = body.arguments as AnyNode[];
    if (!argument || rest.length) return;
    if (what === 'collection') {
      const element = (structure as { element: string }).element;
      if (part(argument) || slice(argument)) return;
      if (argument.type !== 'ArrayExpression') return refuse(argument, element);
      for (const item of argument.elements) {
        if (!item) continue;
        if (item.type === 'SpreadElement') {
          const spread = item.argument as AnyNode;
          if (!part(spread) && !slice(spread)) refuse(spread, element);
        } else if (!part(item as AnyNode)) refuse(item as AnyNode, element);
      }
      return;
    }
    const fields = (structure as { fields: Readonly<Record<string, string>> }).fields;
    if (part(argument)) return;
    if (argument.type !== 'ObjectExpression') return refuse(argument, undefined);
    for (const property of argument.properties) {
      if (property.type === 'SpreadElement') {
        if (!part(property.argument as AnyNode)) refuse(property.argument as AnyNode, undefined);
        continue;
      }
      const key =
        property.key.type === 'Identifier'
          ? property.key.name
          : String((property.key as { value?: unknown }).value);
      if (!part(property.value as AnyNode)) refuse(property.value as AnyNode, fields[key]);
    }
  }

  function defineStructure(
    name: string,
    kind: StructureType['kind'],
    call: CallExpression
  ): StructureType {
    const args = call.arguments as Expression[];
    if (kind === 'union') {
      if (args.length < 2) fail(call, 'union() takes two or more types, as in union(A, B).');
      const members = args.map((argument) => defined(argument, 'Each union member'));
      if (new Set(members).size !== members.length)
        fail(call, 'A union lists each member type once.');
      if (members.some((member) => structures[member]?.kind === 'union'))
        fail(call, 'A union lists types directly, not other unions.');
      return { kind, name, members };
    }
    if (kind === 'collection') {
      if (args.length !== 1)
        fail(call, 'collection() takes one element type, as in collection(Edge).');
      return { kind, name, element: defined(args[0], 'A collection’s element type') };
    }
    const [shape] = args;
    if (args.length !== 1 || shape.type !== 'ObjectExpression')
      fail(
        call,
        'record() takes its fields and their types, as in record({ from: Vertex, to: Vertex }).'
      );
    const fields: Record<string, string> = {};
    for (const property of (shape as { properties: AnyNode[] }).properties) {
      if (property.type !== 'Property' || property.key.type !== 'Identifier')
        fail(property, 'Record fields are plain name: Type pairs.');
      const { key, value } = property as unknown as { key: { name: string }; value: Expression };
      if (Object.hasOwn(fields, key.name)) fail(property, `The field ${key.name} is listed twice.`);
      fields[key.name] = defined(value, `The field ${key.name}`);
    }
    if (Object.keys(fields).length === 0) fail(call, 'A record needs at least one field.');
    return { kind: 'record', name, fields };
  }
}

function applyAtomOptions(
  type: AtomType,
  options: Expression,
  fail: (node: AnyNode, message: string) => never
): void {
  if (options.type !== 'ObjectExpression')
    fail(options, 'type() options are an object such as { unit: "cm", min: 0 }.');
  for (const property of (options as { properties: AnyNode[] }).properties) {
    if (property.type !== 'Property' || property.key.type !== 'Identifier')
      fail(property, 'type() options are plain name: value pairs.');
    const { key, value } = property as unknown as { key: { name: string }; value: Expression };
    const literal = literalValue(value);
    if (key.name === 'unit') {
      if (typeof literal !== 'string' || !literal.trim()) fail(value, 'unit must be text.');
      type.unit = literal as string;
    } else if (key.name === 'min' || key.name === 'max') {
      if (type.base !== 'integer' && type.base !== 'number')
        fail(property, `${key.name} only applies to integer and number types.`);
      if (typeof literal !== 'number' || !Number.isFinite(literal))
        fail(value, `${key.name} must be a number.`);
      type[key.name] = literal as number;
    } else {
      fail(property, `Unknown type() option "${key.name}"; use unit, min, or max.`);
    }
  }
  if (type.min !== undefined && type.max !== undefined && type.min > type.max)
    fail(options, 'min must not exceed max.');
}

/** Why an atomic type's values are not a known, finite set, or undefined when they are. */
function unboundedProblem(type: AtomType): string | undefined {
  if (type.index) return undefined;
  const reason =
    'Every type must have a known, finite set of values, so the view can be drawn for each of them.';
  if (type.values || type.base === 'boolean') return undefined;
  if (type.base === 'text')
    return `List the values of ${type.name}, as in const ${type.name} = type(['start', 'done']);. ${reason}`;
  if (type.min !== undefined && type.max !== undefined) return undefined;
  const missing =
    type.min === undefined && type.max === undefined
      ? 'a min and a max'
      : type.min === undefined
        ? 'a min'
        : 'a max';
  const min = type.min ?? (type.max === undefined ? 0 : Math.min(0, type.max - 9));
  const max = type.max ?? min + 9;
  return `Give ${type.name} ${missing}, as in const ${type.name} = type('${type.base}', { min: ${min}, max: ${max} });. ${reason}`;
}

/** A literal's value, including negative numbers; undefined for anything else. */
function literalValue(node: Expression): unknown {
  if (node.type === 'Literal') return node.value;
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal')
    return typeof node.argument.value === 'number' ? -node.argument.value : undefined;
  return undefined;
}
