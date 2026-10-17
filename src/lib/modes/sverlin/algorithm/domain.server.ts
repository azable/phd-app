/**
 * The domain block: atomic types built from primitive kinds, refinements, and enumerations, and the
 * unions, records, and collections built from them.
 */

import type { AnyNode, CallExpression, Expression, Pattern } from 'acorn';

import { atomBases, type AtomBase, type AtomType } from './atoms.server';
import { AlgorithmError, domainFunctions } from './block.server';
import { parseBlock } from './parse.server';
import type { DomainRegistry, StructureType } from './structures.server';

/**
 * Read the domain block's type definitions. Nothing is predefined: an atomic type is a primitive
 * kind (`type('integer')`), a refinement of a defined type (`type(Int, { unit: 'cm' })`), or an
 * enumeration (`type(['♠', '♥'])`); a union, record, or collection is built from types defined
 * before it (`union(Distance, Unreached)`, `record({ from: Vertex, to: Vertex })`,
 * `collection(Edge)`).
 */
export function interpretDomain(body: string): DomainRegistry {
  const { root, offset } = parseBlock(body, 'domain');
  const fail = (node: AnyNode, message: string): never => {
    throw new AlgorithmError(message, offset(node));
  };
  const atoms: Record<string, AtomType> = {};
  const structures: Record<string, StructureType> = {};
  /** A type defined earlier in the block, named by an identifier. */
  const defined = (node: Expression | undefined, role: string): string => {
    if (node?.type !== 'Identifier')
      return fail(node ?? root, `${role} must name a type defined earlier in the domain block.`);
    if (!Object.hasOwn(atoms, node.name) && !Object.hasOwn(structures, node.name))
      fail(node, `Unknown type ${node.name}; define it earlier in the domain block.`);
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
          `Define ${name} with type(...), union(...), record({...}), or collection(...), as in const ${name} = type('integer');`
        );
      const call = init as CallExpression;
      if (name in atoms || name in structures)
        fail(declarator as AnyNode, `"${name}" is already a type.`);
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
            `Unknown type ${definition.name}; define it first, as in const ${definition.name} = type('integer');`
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
      atoms[name] = type;
    }
  }
  return { atoms, structures };

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
    return { kind, name, fields };
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

/** A literal's value, including negative numbers; undefined for anything else. */
function literalValue(node: Expression): unknown {
  if (node.type === 'Literal') return node.value;
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal')
    return typeof node.argument.value === 'number' ? -node.argument.value : undefined;
  return undefined;
}
