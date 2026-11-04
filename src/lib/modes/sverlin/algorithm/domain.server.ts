/**
 * The domain block: atomic types built from primitive kinds, refinements, and enumerations, the
 * unions, records, and collections built from them, and the operators on them.
 */

import type { AnyNode, CallExpression, Expression, Pattern } from 'acorn';

import { atomBases, type AtomBase, type AtomType } from './atoms.server';
import { AlgorithmError, domainFunctions } from './block.server';
import { parseBlock } from './parse.server';
import { type DomainRegistry, type OperatorType, type StructureType } from './structures.server';

/**
 * Read the domain block's type definitions. Nothing is predefined: an atomic type is a primitive
 * kind with its range (`type('integer', { min: 0, max: 9 })`), a refinement of a defined type (`type(Int, { unit: 'cm' })`), or an
 * enumeration (`type(['♠', '♥'])`); a union, record, array, or pool is built from other types
 * (`union(Distance, Unreached)`, `record({ from: Vertex, to: Vertex })`, `array(Edge, { max: 8 })`, `pool(Node, { max: 6 })`).
 * Declarations may come in any order: the block is read for its names first, then each definition,
 * so a record can refer to its own kind through a reference declared after it; a type holding
 * itself other than through a reference or an index would be infinite, and is refused.
 */
export function interpretDomain(body: string): DomainRegistry {
  const source = body;
  const { root, offset } = parseBlock(source, 'domain');
  const fail = (node: AnyNode, message: string): never => {
    throw new AlgorithmError(message, offset(node));
  };
  const atoms: Record<string, AtomType> = {};
  const structures: Record<string, StructureType> = {};
  const operators: Record<string, OperatorType> = {};
  /** Each declaration, by name, read first so a definition can name one declared after it. */
  const declared = new Map<string, { kind: string; call: CallExpression; node: AnyNode }>();
  const isType = (name: string) => {
    const kind = declared.get(name)?.kind;
    return kind !== undefined && kind !== 'binop' && kind !== 'unop';
  };
  /** A type declared in the block, named by an identifier. */
  const defined = (node: Expression | undefined, role: string): string => {
    if (node?.type !== 'Identifier')
      return fail(node ?? root, `${role} must name a type defined in the domain block.`);
    if (!isType(node.name))
      fail(
        node,
        declared.has(node.name)
          ? `${node.name} is declared in the domain but is not a type.`
          : `Unknown type ${node.name}; define it in the domain block.`
      );
    return node.name;
  };
  /** What a declared type is: atomic (from type() or index()), or the structure it builds. */
  const kindOf = (name: string): string => {
    const kind = declared.get(name)?.kind ?? '';
    return kind === 'type' || kind === 'index' ? 'atom' : kind;
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
          `Define ${name} with type(...), union(...), record({...}), array(...), pool(...), index(...), or ref(...), as in const ${name} = type('integer', { min: 0, max: 9 });.`
        );
      if (kind === 'binop' || kind === 'unop')
        fail(
          declarator as AnyNode,
          `The domain declares types, not operations: compute in the algorithm as JavaScript does, as a > b or i + 1, and label what a view draws, as @compare[a > b], drawn by a view typed by the label, as <View of="@compare" name="Ask">…</View>.`
        );
      if (kind === 'collection')
        fail(
          declarator as AnyNode,
          `collection(…) is now array(…), elements in order at positions 0, 1, 2, …: write const ${name} = array(${(init as CallExpression).arguments[0]?.type === 'Identifier' ? ((init as CallExpression).arguments[0] as { name: string }).name : 'Int'}, { max: 8 });.`
        );
      if (declared.has(name)) fail(declarator as AnyNode, `"${name}" is already defined.`);
      // An array is a collection type inside, as it is to the interpreter and the view.
      declared.set(name, {
        kind: kind === 'array' ? 'collection' : (kind as string),
        call: init as CallExpression,
        node: declarator as AnyNode
      });
    }
  }
  // Types first, each once, an atom after the type it refines; then the operators on them.
  const defining = new Set<string>();
  const defineType = (name: string): void => {
    if (name in atoms || name in structures) return;
    const { kind, call } = declared.get(name)!;
    if (defining.has(name))
      fail(call, `${name} refines itself; a type() refines a type defined apart from it.`);
    defining.add(name);
    if (kind === 'index') atoms[name] = defineIndex(name, call);
    else if (kind === 'ref') structures[name] = defineRef(name, call);
    else if (kind === 'pool') structures[name] = definePool(name, call);
    else if (kind !== 'type')
      structures[name] = defineStructure(name, kind as StructureType['kind'], call);
    else atoms[name] = defineAtom(name, call);
    defining.delete(name);
  };
  for (const name of declared.keys()) if (isType(name)) defineType(name);
  for (const name of declared.keys()) if (isType(name)) checkFinite(name);
  return { atoms, structures, operators };

  /** An atomic type: a primitive kind with options, a refinement of a defined type, or an enumeration. */
  function defineAtom(name: string, call: CallExpression): AtomType {
    const [definition, options, extra] = call.arguments as Expression[];
    if (!definition || extra)
      fail(
        call,
        'type() takes a kind, a type, or a list of allowed values, then optional options.'
      );
    let type: AtomType;
    if (definition.type === 'Literal' && typeof definition.value === 'string') {
      if (!atomBases.includes(definition.value as AtomBase))
        fail(definition, `Unknown kind "${definition.value}"; use one of ${atomBases.join(', ')}.`);
      type = { name, base: definition.value as AtomBase };
    } else if (definition.type === 'Identifier') {
      type = fail(
        definition,
        `A type is declared on its own, not from another: write ${name} with its kind and range, as type('integer', { min: 0, max: 9 }) or type('number', { min: 0, max: 1, places: 2 }), a unit beside them if it has one, and convert where it meets another type, as ${definition.name}(x).`
      );
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
    return type;
  }

  /**
   * A collection or record holding itself other than through a reference or an index would be
   * infinite: a node of a list or tree refers to its own kind through a reference.
   */
  function checkFinite(name: string): void {
    const structure = structures[name];
    if (structure?.kind !== 'record' && structure?.kind !== 'collection') return;
    const parts = (type: string): string[] => {
      const part = structures[type];
      if (!part) return [];
      if (part.kind === 'record') return Object.values(part.fields);
      if (part.kind === 'collection') return [part.element];
      if (part.kind === 'union') return [...part.members];
      return [];
    };
    const seen = new Set<string>();
    const through: string[] = [];
    const reaches = (type: string): boolean => {
      for (const part of parts(type)) {
        if (part === name) return through.push(part) > 0;
        if (seen.has(part)) continue;
        seen.add(part);
        through.push(part);
        if (reaches(part)) return true;
        through.pop();
      }
      return false;
    };
    if (reaches(name))
      fail(
        declared.get(name)!.call,
        `${name} holds itself (${[name, ...through].join(' → ')}), which would never end: refer to its own kind through a reference, as const ${name}Ref = ref(${name}); and a field of type ${name}Ref.`
      );
  }

  /**
   * A position in a collection type, as in index(Values): a whole number from -1 to its
   * collection's max, each element and one past either end, of which 0 to its collection's
   * length - 1 point at an element.
   */
  function defineIndex(name: string, call: CallExpression): AtomType {
    const args = call.arguments as Expression[];
    if (args.length !== 1) fail(call, 'index() takes one array type, as in index(Values).');
    const collection = defined(args[0], 'An index’s array type');
    if (kindOf(collection) !== 'collection')
      fail(args[0], `index() points into an array type, and ${collection} is not one.`);
    defineType(collection);
    const max = (structures[collection] as { max?: number } | undefined)?.max;
    return { name, base: 'integer', index: collection, min: -1, max };
  }

  /**
   * A reference to an element of a collection type, as in ref(Queue), whose elements are single
   * values, as a record's fields are values of their own, which such a reference would also have
   * to follow; or to a record type, as in ref(Node): a node wherever it is, as a learner's pointer.
   */
  function defineRef(name: string, call: CallExpression): StructureType {
    const args = call.arguments as Expression[];
    if (args.length !== 1)
      fail(call, 'ref() takes one array or record type, as in ref(Queue) or ref(Node).');
    const target = defined(args[0], 'A reference’s type');
    if (kindOf(target) === 'record') {
      const pool = [...declared].find(
        ([, { kind, call: declaration }]) =>
          kind === 'pool' &&
          (declaration.arguments[0] as { name?: string } | undefined)?.name === target
      );
      if (!pool)
        return fail(
          call,
          `A ${name} refers to a ${target} in its pool, so declare the pool, as const ${target}s = pool(${target}, { max: 8 });, the most ${target}s it ever holds.`
        );
      return { kind: 'ref', name, collection: pool[0], element: target, heap: true };
    }
    if (kindOf(target) !== 'collection')
      fail(
        args[0],
        `ref() refers to a node of a record type, or to an element of an array type, and ${target} is neither.`
      );
    const element = (declared.get(target)!.call.arguments as Expression[])[0];
    const elementName = element?.type === 'Identifier' ? element.name : '';
    if (kindOf(elementName) !== 'atom')
      fail(
        args[0],
        `ref() refers to elements that are single values, and ${target} holds ${elementName}s; refer to one of its fields' arrays, use an index(${target}), or refer to a node with ref(${elementName}).`
      );
    return { kind: 'ref', name, collection: target, element: elementName };
  }

  /**
   * A pool of a record type's nodes, as in pool(Node, { max: 6 }): unordered, reached only by
   * reference, holding at most max nodes, which the algorithm adds to it. A record has one pool, so
   * a reference to it always points into that one.
   */
  function definePool(name: string, call: CallExpression): StructureType {
    const args = call.arguments as Expression[];
    const record = args[0]?.type === 'Identifier' ? args[0].name : 'Node';
    const form = `pool(${record}, { max: 8 })`;
    if (args.length !== 2 || args[1].type !== 'ObjectExpression')
      fail(call, `pool() takes one record type and its most nodes, as in ${form}.`);
    const element = defined(args[0], 'A pool’s record type');
    if (kindOf(element) !== 'record')
      fail(
        args[0],
        `A pool holds the nodes of a record type, and ${element} is not one; keep values in an array, as array(${element}, { max: 8 }).`
      );
    const [first] = [...declared].find(
      ([, { kind, call: declaration }]) =>
        kind === 'pool' &&
        (declaration.arguments[0] as { name?: string } | undefined)?.name === element
    )!;
    if (first !== name)
      fail(
        call,
        `${element} already has a pool, ${first}: a record has one pool, so a reference to a ${element} always points into it.`
      );
    const properties = (args[1] as { properties: AnyNode[] }).properties;
    const property = properties.find(
      (each) =>
        each.type === 'Property' &&
        each.key.type === 'Identifier' &&
        (each.key as { name: string }).name === 'max'
    );
    for (const each of properties)
      if (each !== property)
        fail(each, `A pool's only option is max, its most nodes, as in ${form}.`);
    const max = property
      ? literalValue((property as unknown as { value: Expression }).value)
      : undefined;
    if (typeof max !== 'number' || !Number.isInteger(max) || max < 1)
      fail(
        property ?? args[1],
        `A pool's max is a whole number of at least 1, the most nodes it ever holds, as in ${form}.`
      );
    return { kind: 'collection', name, element, max: max as number, pool: true };
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
      if (members.some((member) => kindOf(member) === 'union'))
        fail(call, 'A union lists types directly, not other unions.');
      return { kind, name, members };
    }
    if (kind === 'collection') {
      const form = `array(${args[0]?.type === 'Identifier' ? args[0].name : 'Edge'}, { max: 8 })`;
      if (args.length < 1 || args.length > 2 || (args[1] && args[1].type !== 'ObjectExpression'))
        fail(call, `array() takes one element type and its most elements, as in ${form}.`);
      const element = defined(args[0], 'An array’s element type');
      const options = args[1] as Expression | undefined;
      const property =
        options?.type === 'ObjectExpression'
          ? (options.properties as AnyNode[]).find(
              (each) =>
                each.type === 'Property' &&
                each.key.type === 'Identifier' &&
                (each.key as { name: string }).name === 'max'
            )
          : undefined;
      if (options?.type === 'ObjectExpression')
        for (const each of options.properties as AnyNode[])
          if (each !== property)
            fail(each, `An array's only option is max, its most elements, as in ${form}.`);
      const max = property
        ? literalValue((property as unknown as { value: Expression }).value)
        : undefined;
      if (!property)
        fail(
          options ?? call,
          `Give ${name} its max, the most elements it ever holds, as in const ${name} = ${form};. Every type must have a known, finite set of values, so the view keeps room for the longest ${name}: choose the least max that fits the largest input you mean to show.`
        );
      if (typeof max !== 'number' || !Number.isInteger(max) || max < 1)
        fail(property!, `An array's max is a whole number of at least 1, as in ${form}.`);
      return { kind, name, element, max: max as number };
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
    } else if (key.name === 'places') {
      if (type.base !== 'number') fail(property, 'places only applies to number types.');
      if (typeof literal !== 'number' || !Number.isInteger(literal) || literal < 0 || literal > 6)
        fail(value, 'places is a whole number from 0 to 6.');
      type.places = literal as number;
    } else if (key.name === 'min' || key.name === 'max') {
      if (type.base !== 'integer' && type.base !== 'number')
        fail(property, `${key.name} only applies to integer and number types.`);
      if (typeof literal !== 'number' || !Number.isFinite(literal))
        fail(value, `${key.name} must be a number.`);
      type[key.name] = literal as number;
    } else {
      fail(property, `Unknown type() option "${key.name}"; use unit, min, max, or places.`);
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
  if (
    type.base === 'number' &&
    type.places === undefined &&
    type.min !== undefined &&
    type.max !== undefined
  )
    return `Give ${type.name} its places, the decimal places its values have and show, as in const ${type.name} = type('number', { min: ${type.min}, max: ${type.max}, places: 2 });. ${reason}`;
  if (type.min !== undefined && type.max !== undefined) return undefined;
  const missing =
    type.min === undefined && type.max === undefined
      ? 'a min and a max'
      : type.min === undefined
        ? 'a min'
        : 'a max';
  const min = type.min ?? (type.max === undefined ? 0 : Math.min(0, type.max - 9));
  const max = type.max ?? min + 9;
  return `Give ${type.name} ${missing}, as in const ${type.name} = type('${type.base}', { min: ${min}, max: ${max}${type.base === 'number' ? ', places: 2' : ''} });. ${reason}`;
}

/** A literal's value, including negative numbers; undefined for anything else. */
function literalValue(node: Expression): unknown {
  if (node.type === 'Literal') return node.value;
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal')
    return typeof node.argument.value === 'number' ? -node.argument.value : undefined;
  return undefined;
}
