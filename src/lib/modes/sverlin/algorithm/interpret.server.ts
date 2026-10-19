/** Interpret Sverlin input, design, and algorithm blocks into recorded state and steps. */

import type {
  AnyNode,
  BlockStatement,
  CallExpression,
  Expression,
  MemberExpression,
  Pattern,
  SpreadElement,
  Statement
} from 'acorn';

import {
  Atom,
  atomProblem,
  combinedType,
  numericResult,
  refines,
  type AtomBase,
  type AtomRegistry,
  type AtomType
} from './atoms.server';
import { drawFunctions, drawValue, keyedDraws } from './random.server';
import {
  AlgorithmError,
  describe,
  forbiddenProperties,
  type BlockKind,
  type Span
} from './block.server';
import { Identities, type Placed, type StepIdentities } from './identities.server';
import { parseBlock } from './parse.server';
import {
  noDomain,
  type CollectionType,
  type DomainRegistry,
  type RecordType,
  type UnionType
} from './structures.server';

// The domain block and the shared block vocabulary, for callers of this module.
export { interpretDomain } from './domain.server';
export { AlgorithmError, type BlockKind } from './block.server';

/** JSON-compatible state recorded for one step and passed to the view as props. */
export type TraceValue =
  | null
  | boolean
  | number
  | string
  | TraceValue[]
  | { [key: string]: TraceValue };

export type TraceState = Record<string, TraceValue>;

/**
 * Domain type names by value path, such as { "edges": "Edges", "edges[2]": "Edge",
 * "edges[2].weight": "Weight" }; values stay plain.
 */
export type TypeMap = Record<string, string>;

/**
 * Plain recorded values with the domain types of the typed ones, the collection each position
 * points into, by path, as in { i: 'left', 'edges[0].from': 'vertices' }, and from the input the
 * type each variable was declared with, which can be a union its value is one member of.
 */
export type TypedState = {
  state: TraceState;
  types: TypeMap;
  targets?: Record<string, string>;
  /** In the algorithm, which values are the same across steps (see identities.server.ts). */
  identities?: StepIdentities;
  declared?: Record<string, string>;
};

/** One step of the master trace that every presentation of a source shares. */
export type MasterStep = {
  state: TraceState;
  types: TypeMap;
  targets?: Record<string, string>;
  identities?: StepIdentities;
};

/**
 * How far past an end a recorded position can be. The view keeps room for every place one reaches,
 * as an empty slot, so striding by a few needs only a few; further is no example to draw.
 */
const maximumPastEnd = 4;

// Bounds keep interpretation short, memory small, and the embedded trace well inside the bundle limit.
export const algorithmLimits = {
  maximumSteps: 200,
  maximumOperations: 1_000_000,
  maximumCollectionLength: 10_000,
  maximumStringLength: 10_000,
  maximumTraceValues: 200_000
} as const;

/** Interpret the input block into the fixed initial state shared by every presentation. */
export function interpretInput(body: string, domain: DomainRegistry = noDomain): TypedState {
  const { root, offset } = parseBlock(body, 'input', domain);
  return new Interpreter(root, offset, { kind: 'input', domain }).bindings();
}

/**
 * Interpret the design block with keyed draws from the presentation seed (see random.server.ts).
 * The view's components are in scope by name, so a design value can choose one, as in
 * const Number = pick([NumberText, NumberDots]); the value is the chosen component's name.
 */
export function interpretDesign(
  body: string,
  seed: number,
  components: readonly string[] = []
): TraceState {
  const { root, offset } = parseBlock(body, 'design');
  return new Interpreter(root, offset, {
    kind: 'design',
    random: keyedDraws(root, seed),
    names: components
  }).bindings().state;
}

/**
 * Design values that choose among components, read without drawing: each const whose value is a
 * pick over component names, with those names.
 */
export function componentChoices(
  body: string,
  components: ReadonlySet<string>
): Record<string, { options: string[]; start: number }> {
  const { root, offset } = parseBlock(body, 'design');
  const choices: Record<string, { options: string[]; start: number }> = {};
  for (const statement of root.body)
    if (statement.type === 'VariableDeclaration' && statement.kind === 'const')
      for (const declarator of statement.declarations) {
        const init = declarator.init;
        // One component, fixed, as in const Int = IntDots;.
        if (
          declarator.id.type === 'Identifier' &&
          init?.type === 'Identifier' &&
          components.has(init.name)
        ) {
          choices[declarator.id.name] = { options: [init.name], start: offset(declarator).start };
          continue;
        }
        if (
          declarator.id.type !== 'Identifier' ||
          init?.type !== 'CallExpression' ||
          init.callee.type !== 'Identifier' ||
          init.callee.name !== 'pick' ||
          init.arguments[0]?.type !== 'ArrayExpression'
        )
          continue;
        const options = init.arguments[0].elements.flatMap((element) =>
          element?.type === 'Identifier' && components.has(element.name) ? [element.name] : []
        );
        if (options.length)
          choices[declarator.id.name] = { options, start: offset(declarator).start };
      }
  return choices;
}

/**
 * The values a design constant can take, read without drawing: a literal, or every option of a
 * pick over literals, and the same for each field of an object. Anything else is left out.
 */
export type DesignChoices =
  | { values: readonly (string | number)[] }
  | { fields: Record<string, DesignChoices> };

/** Every design constant's possible values, so the view's props can be checked for every seed. */
export function designChoices(body: string): Record<string, DesignChoices> {
  const { root } = parseBlock(body, 'design');
  const known: Record<string, DesignChoices> = {};
  const literal = (node: AnyNode): string | number | undefined => {
    if (
      node.type === 'Literal' &&
      (typeof node.value === 'string' || typeof node.value === 'number')
    )
      return node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
      return node.quasis[0]?.value.cooked ?? undefined;
    return undefined;
  };
  const choicesOf = (node: AnyNode): DesignChoices | undefined => {
    const value = literal(node);
    if (value !== undefined) return { values: [value] };
    if (node.type === 'Identifier') return known[node.name];
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'pick' &&
      node.arguments[0]?.type === 'ArrayExpression'
    ) {
      const options = node.arguments[0].elements.map((element) =>
        element && element.type !== 'SpreadElement' ? literal(element) : undefined
      );
      const values = options.filter((option) => option !== undefined);
      return values.length ? { values } : undefined;
    }
    if (node.type === 'ObjectExpression') {
      const fields: Record<string, DesignChoices> = {};
      for (const property of node.properties) {
        if (property.type !== 'Property' || property.computed) continue;
        const key = property.key.type === 'Identifier' ? property.key.name : literal(property.key);
        const choices = key === undefined ? undefined : choicesOf(property.value);
        if (choices) fields[String(key)] = choices;
      }
      return { fields };
    }
    return undefined;
  };
  for (const statement of root.body)
    if (statement.type === 'VariableDeclaration' && statement.kind === 'const')
      for (const declarator of statement.declarations) {
        const choices = declarator.init ? choicesOf(declarator.init) : undefined;
        if (choices && declarator.id.type === 'Identifier') known[declarator.id.name] = choices;
      }
  return known;
}

/**
 * Names a block declares, read without running it: at its top level, and in the algorithm in any
 * block, as a step records every variable in scope.
 */
export function declaredNames(body: string, kind: BlockKind, domain?: DomainRegistry): string[] {
  const { root } = parseBlock(body, kind, domain);
  const names = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== 'object') return;
    const part = node as { type?: string; declarations?: { id: { name: string } }[] };
    if (part.type === 'VariableDeclaration')
      for (const declarator of part.declarations ?? []) names.add(declarator.id.name);
    if (kind === 'algorithm')
      for (const [key, child] of Object.entries(node)) if (key !== 'loc') visit(child);
  };
  root.body.forEach(visit);
  return [...names];
}

/** Interpret the algorithm from the input state; the variables in scope are recorded at each yield. */
export function interpretAlgorithm(
  body: string,
  input: TypedState = { state: {}, types: {} },
  domain: DomainRegistry = noDomain
): MasterStep[] {
  const { root, offset } = parseBlock(body, 'algorithm', domain);
  return new Interpreter(root, offset, { kind: 'algorithm', initial: input, domain }).run();
}

// ---------------------------------------------------------------------------------------------
// Interpreter: values are primitives, typed atoms, plain arrays, and null-prototype objects.

type ObjectValue = { [key: string]: Value };
type Value = undefined | null | boolean | number | string | Atom | Value[] | ObjectValue;
/** A variable: its value, and in the input and algorithm the type it was made with. */
/**
 * A variable: its value, and in the input and algorithm the type it was made with; a position also
 * names the collection it points into.
 */
type Binding = { value: Value; constant: boolean; type?: string; target?: string };
type Completion = 'normal' | 'break' | 'continue' | 'return';

const mathFunctions: Record<string, (...values: number[]) => number> = {
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sign: Math.sign,
  sqrt: Math.sqrt,
  trunc: Math.trunc
};
const mathConstants: Record<string, number> = { PI: Math.PI, E: Math.E };
const mathMarker = Object.freeze(Object.create(null)) as ObjectValue;

class Scope {
  readonly bindings = new Map<string, Binding>();
  constructor(readonly parent?: Scope) {}

  lookup(name: string): Binding | undefined {
    return this.bindings.get(name) ?? this.parent?.lookup(name);
  }
}

class Interpreter {
  readonly #root: BlockStatement;
  readonly #offset: (node: AnyNode) => Span;
  readonly #globals = new Scope();
  readonly #topLevel = new Scope(this.#globals);
  readonly #topLevelNames: string[];
  readonly #kind: BlockKind;
  /** The random number for one design draw. */
  readonly #random?: (draw: AnyNode) => number;
  readonly #domain: DomainRegistry;
  readonly #atoms: AtomRegistry;
  /** The record or collection type of every array and object an input or algorithm made. */
  readonly #shapes = new WeakMap<object, RecordType | CollectionType>();
  readonly #trace: MasterStep[] = [];
  readonly #identities = new Identities();
  #operations = 0;
  #traceValues = 0;

  constructor(
    root: BlockStatement,
    offset: (node: AnyNode) => Span,
    options: {
      kind: BlockKind;
      initial?: TypedState;
      random?: (draw: AnyNode) => number;
      domain?: DomainRegistry;
      /** Names in scope whose values are themselves, such as the view's components in the design. */
      names?: readonly string[];
    }
  ) {
    this.#root = root;
    this.#offset = offset;
    this.#kind = options.kind;
    this.#random = options.random;
    this.#domain = options.domain ?? noDomain;
    this.#atoms = this.#domain.atoms;
    for (const name of options.names ?? [])
      this.#globals.bindings.set(name, { value: name, constant: true });
    this.#globals.bindings.set('Math', { value: mathMarker, constant: true });
    // Input and algorithm values all have a domain type, so there is nothing without a value there.
    if (this.#kind === 'design')
      this.#globals.bindings.set('undefined', { value: undefined, constant: true });
    this.#globals.bindings.set('Infinity', { value: Infinity, constant: true });
    this.#globals.bindings.set('NaN', { value: NaN, constant: true });
    // Input values become ordinary top-level variables the algorithm may update, keeping types.
    const initial = Object.entries(options.initial?.state ?? {});
    const initialTypes = options.initial?.types ?? {};
    const initialTargets = options.initial?.targets ?? {};
    for (const [name, value] of initial)
      this.#topLevel.bindings.set(name, {
        value: this.#fromTrace(value, name, initialTypes),
        constant: false,
        type: options.initial?.declared?.[name] ?? initialTypes[name],
        ...(initialTargets[name] ? { target: initialTargets[name] } : {})
      });
    this.#topLevelNames = [
      ...initial.map(([name]) => name),
      ...root.body.flatMap((statement) =>
        statement.type === 'VariableDeclaration'
          ? statement.declarations.map((declarator) => (declarator.id as { name: string }).name)
          : []
      )
    ];
  }

  /** Run the algorithm block and return its master trace. */
  run(): MasterStep[] {
    this.#execute();
    if (this.#trace.length === 0)
      throw new AlgorithmError('The algorithm must yield at least one step, as in yield;');
    return this.#trace;
  }

  /** Run an input or design block and return its top-level bindings, with their declared types. */
  bindings(): TypedState {
    this.#execute();
    const declared: Record<string, string> = {};
    for (const [name, binding] of this.#topLevel.bindings)
      if (binding.type) declared[name] = binding.type;
    return { ...this.#state(this.#root), ...(Object.keys(declared).length ? { declared } : {}) };
  }

  #execute(): void {
    const completion = this.#block(this.#root.body, this.#topLevel);
    if (completion === 'break' || completion === 'continue')
      throw new AlgorithmError(
        `${completion} must be inside a loop.`,
        this.#offset(this.#root).start
      );
    if (completion === 'return' && this.#kind !== 'algorithm')
      throw new AlgorithmError(
        `return belongs in the algorithm block.`,
        this.#offset(this.#root).start
      );
  }

  /**
   * The variables in scope, by name: the top level's in the order of their declarations, then each
   * enclosing block's, outermost first. One not declared yet, or whose block has ended, is not.
   */
  #inScope(scope: Scope): [string, Binding][] {
    const blocks: Scope[] = [];
    for (
      let block: Scope | undefined = scope;
      block && block !== this.#topLevel;
      block = block.parent
    )
      blocks.unshift(block);
    return [
      ...this.#topLevelNames.flatMap((name): [string, Binding][] => {
        const binding = this.#topLevel.bindings.get(name);
        return binding ? [[name, binding]] : [];
      }),
      ...blocks.flatMap((block) => [...block.bindings])
    ];
  }

  #state(node: AnyNode, scope: Scope = this.#topLevel): TypedState {
    const state: TraceState = {};
    const types: TypeMap = {};
    const targets: Record<string, string> = {};
    const placed: Placed[] = [];
    const positions: [string, number][] = [];
    for (const [name, binding] of this.#inScope(scope)) {
      state[name] = this.#snapshot(binding.value, node, name, {
        types,
        targets,
        placed,
        positions
      });
      if (binding.target) targets[name] = binding.target;
    }
    if (this.#kind === 'algorithm')
      for (const [path, value] of positions)
        if (targets[path]) this.#checkDrawable(path, value, targets[path], node, scope);
    return {
      state,
      types,
      ...(Object.keys(targets).length ? { targets } : {}),
      ...(this.#kind === 'algorithm' ? { identities: this.#identities.step(placed) } : {})
    };
  }

  /** Conditions read an atom's underlying value, so Bool(false) is false. */
  #truthy(value: Value): boolean {
    return value instanceof Atom ? Boolean(value.value) : Boolean(value);
  }

  /**
   * Create a typed value from a constructor call: an atom such as Int(3), converting a value of
   * another type of the same kind, as in Distance(e.weight); or a union, record, or collection
   * from a literal, as in Edges([{ from: 0, to: 1 }]).
   */
  #construct(node: CallExpression, typeName: string, scope: Scope): Value {
    if (this.#atoms[typeName]?.index && node.arguments.length === 2)
      return this.#position(node, this.#atoms[typeName], scope);
    if (node.arguments.length !== 1 || node.arguments[0].type === 'SpreadElement')
      this.#fail(node, `${typeName}(...) takes exactly one value.`);
    const argument = this.#expression(node.arguments[0] as Expression, scope);
    const type = this.#atoms[typeName];
    if (!type) return this.#convert(argument, typeName, node, typeName);
    if (argument instanceof Atom && atomBase(argument.type) !== atomBase(type))
      this.#fail(node, `A ${argument.type.name} cannot become a ${type.name}.`);
    if (argument !== null && typeof argument === 'object' && !(argument instanceof Atom))
      this.#fail(node, `${type.name}(...) takes one value, not ${kind(argument)}.`);
    const value = argument instanceof Atom ? argument.value : argument;
    const problem = atomProblem(type, value);
    if (problem) this.#fail(node, problem);
    return new Atom(type, value as string | number | boolean);
  }

  /**
   * A position bound to a collection, as in Position(left, 0): its first argument names a variable
   * in scope holding a collection of the type it points into.
   */
  #position(node: CallExpression, type: AtomType, scope: Scope): Atom {
    const [collection, number] = node.arguments as Expression[];
    const name = collection.type === 'Identifier' ? collection.name : undefined;
    if (!name || !this.#holdsCollection(name, type, scope))
      this.#fail(
        collection,
        `${type.name}(…, …) names the ${type.index} it points into first, as in ${type.name}(${this.#collectionsOf(type)[0] ?? 'values'}, 0).`
      );
    return this.#construct({ ...node, arguments: [number] }, type.name, scope) as Atom;
  }

  #holdsCollection(name: string, type: AtomType, scope: Scope = this.#topLevel): boolean {
    const value = scope.lookup(name)?.value;
    return Array.isArray(value) && this.#shapes.get(value)?.name === type.index;
  }

  /** The top-level variables holding a collection a position type points into. */
  #collectionsOf(type: AtomType): string[] {
    return [...this.#topLevel.bindings.keys()].filter((name) => this.#holdsCollection(name, type));
  }

  /** The one collection a position can point into, when it does not name one. */
  #onlyCollection(type: AtomType, node: AnyNode, path: string): string {
    const names = this.#collectionsOf(type);
    if (names.length === 1) return names[0];
    return this.#fail(
      node,
      names.length
        ? `${path} could point into ${names.join(' or ')}; say which, as in ${type.name}(${names[0]}, 0).`
        : `${path} is a ${type.name}, which points into a ${type.index}, and there is none yet; declare one first.`
    );
  }

  /**
   * A position a step records is drawn at its place, past an end too, where room is kept for it;
   * one far past an end would keep that much empty room, so it is no example to draw.
   */
  #checkDrawable(path: string, value: number, target: string, node: AnyNode, scope: Scope): void {
    const collection = scope.lookup(target)?.value;
    const length = Array.isArray(collection) ? collection.length : 0;
    const past = value < 0 ? -value : value - (length - 1);
    if (past <= maximumPastEnd) return;
    this.#fail(
      node,
      `${path} is ${value}, ${past} past the ${value < 0 ? 'start' : 'end'} of ${target}, too far to draw: a step can show a position at most ${maximumPastEnd} places past either end.`
    );
  }

  /**
   * A value as the domain type a place expects. A literal or plain value becomes that type; a typed
   * value must already be it, or refine it. Records and collections are made field by field and
   * element by element. There is no null: every place holds a value of its type.
   */
  #convert(value: Value, typeName: string, node: AnyNode, path: string, target?: string): Value {
    if (value === null || value === undefined) return this.#noValue(node, path, typeName);
    const atom = this.#atoms[typeName];
    if (atom) {
      const made = this.#asAtom(value, atom, node, path);
      // A position a variable holds points into the variable's collection; one an element or field
      // holds, into the only collection of its type.
      if (atom.index && this.#kind !== 'design' && target === undefined)
        this.#onlyCollection(atom, node, path);
      return made;
    }
    const structure = this.#domain.structures[typeName];
    if (structure.kind === 'union') return this.#asMember(value, structure, node, path);
    if (structure.kind === 'record') return this.#asRecord(value, structure, node, path);
    return this.#asCollection(value, structure, node, path);
  }

  #asAtom(value: Value, type: AtomType, node: AnyNode, path: string): Atom {
    if (value instanceof Atom) {
      if (refines(value.type, type, this.#atoms)) return value;
      return this.#fail(
        node,
        `${path} must be a ${type.name}, not a ${value.type.name}; convert it, as in ${type.name}(…).`
      );
    }
    if (value !== null && typeof value === 'object')
      this.#fail(node, `${path} must be a ${type.name}, not ${kind(value)}.`);
    const problem = atomProblem(type, value);
    if (problem) this.#fail(node, `${path}: ${problem}`);
    return new Atom(type, value as string | number | boolean);
  }

  /** A typed value keeps its own member type; a literal becomes the one member it fits. */
  #asMember(value: Value, union: UnionType, node: AnyNode, path: string): Value {
    const members = union.members.join(' or ');
    const shape = value !== null && typeof value === 'object' ? this.#shapes.get(value) : undefined;
    if (value instanceof Atom || shape) {
      const fits = union.members.some((member) =>
        value instanceof Atom
          ? !!this.#atoms[member] && refines(value.type, this.#atoms[member], this.#atoms)
          : shape?.name === member
      );
      if (fits) return value;
      return this.#fail(node, `${path} must be a ${members}, not ${kind(value)}.`);
    }
    const candidates = union.members.filter((member) => this.#accepts(member, value));
    if (candidates.length === 1) return this.#convert(value, candidates[0], node, path);
    return this.#fail(
      node,
      candidates.length
        ? `${path} could be a ${candidates.join(' or a ')}; say which, as in ${candidates[0]}(…).`
        : `${path} must be a ${members}, not ${kind(value)}.`
    );
  }

  /** Whether a plain value could become a type: the right kind of primitive, array, or object. */
  #accepts(typeName: string, value: Value): boolean {
    const atom = this.#atoms[typeName];
    if (atom) return (value === null || typeof value !== 'object') && !atomProblem(atom, value);
    const structure = this.#domain.structures[typeName];
    if (structure.kind === 'collection') return Array.isArray(value);
    if (structure.kind !== 'record' || !isPlainObject(value)) return false;
    const fields = Object.keys(structure.fields);
    const keys = Object.keys(value);
    return keys.length === fields.length && keys.every((key) => fields.includes(key));
  }

  #asRecord(value: Value, record: RecordType, node: AnyNode, path: string): ObjectValue {
    if (!isPlainObject(value))
      return this.#fail(node, `${path} must be a ${record.name}, not ${kind(value)}.`);
    const shape = this.#shapes.get(value);
    if (shape === record) return value;
    if (shape) return this.#fail(node, `${path} must be a ${record.name}, not a ${shape.name}.`);
    const fields = Object.keys(record.fields);
    const extra = Object.keys(value).find((key) => !Object.hasOwn(record.fields, key));
    if (extra)
      this.#fail(
        node,
        `A ${record.name} has no field ${extra}; its fields are ${fields.join(', ')}.`
      );
    const made = Object.create(null) as ObjectValue;
    for (const field of fields) {
      if (!Object.hasOwn(value, field))
        this.#fail(node, `${path} needs ${field}, a ${record.fields[field]}.`);
      made[field] = this.#convert(value[field], record.fields[field], node, `${path}.${field}`);
    }
    this.#shapes.set(made, record);
    return made;
  }

  #asCollection(value: Value, collection: CollectionType, node: AnyNode, path: string): Value[] {
    if (!Array.isArray(value))
      return this.#fail(node, `${path} must be a ${collection.name}, not ${kind(value)}.`);
    const shape = this.#shapes.get(value);
    if (shape === collection) return value;
    if (shape)
      return this.#fail(node, `${path} must be a ${collection.name}, not a ${shape.name}.`);
    const made = value.map((item, index) =>
      this.#convert(item, collection.element, node, `${path}[${index}]`)
    );
    this.#shapes.set(made, collection);
    return made;
  }

  /**
   * The type a variable is declared with: the type that made its first value, as in
   * let d = Dist(0), which declares a union even though its value is one member; otherwise its
   * first value's own type.
   */
  #declaredType(init: Expression, value: Value): string | undefined {
    if (
      init.type === 'CallExpression' &&
      init.callee.type === 'Identifier' &&
      (Object.hasOwn(this.#atoms, init.callee.name) ||
        Object.hasOwn(this.#domain.structures, init.callee.name))
    )
      return init.callee.name;
    if (value instanceof Atom) return value.type.name;
    return value !== null && typeof value === 'object' ? this.#shapes.get(value)?.name : undefined;
  }

  /**
   * The collection a position variable points into, fixed at its declaration: the one its
   * constructor names, as in Position(left, 0), or the only one of its type.
   */
  #targetOf(init: Expression, type: AtomType, name: string): string {
    const named =
      init.type === 'CallExpression' &&
      init.arguments.length === 2 &&
      init.arguments[0].type === 'Identifier'
        ? init.arguments[0].name
        : undefined;
    return named ?? this.#onlyCollection(type, init, name);
  }

  /** The type a stored element or field must have: a collection's element or a record's field. */
  #slotType(container: object, key: string | number, node: AnyNode): string | undefined {
    const shape = this.#shapes.get(container);
    if (!shape) return undefined;
    if (shape.kind === 'collection') return shape.element;
    if (forbiddenProperties.has(String(key)))
      this.#fail(node, 'That property name is not allowed.');
    if (!Object.hasOwn(shape.fields, String(key)))
      this.#fail(
        node,
        `A ${shape.name} has no field ${String(key)}; its fields are ${Object.keys(shape.fields).join(', ')}.`
      );
    return shape.fields[String(key)];
  }

  /**
   * Input and algorithm values all have domain types: every primitive a variable, element, or
   * property holds is a typed value, or null for nothing yet. Design values are plain.
   */
  /** A place that would hold no value, such as .pop() of an empty collection, or null. */
  #noValue(node: AnyNode, path: string, typeName?: string): never {
    return this.#fail(
      node,
      `${path} would have no value: it was taken from an empty collection, or past its end. There is no null: ${typeName ? `a ${typeName} is needed here; ` : ''}for "nothing yet", use a value of a type that says so, such as Index(-1), or Unreached('unreached') in a union.`
    );
  }

  #typed(value: Value, node: AnyNode, name: string): void {
    if (this.#kind === 'design') return;
    if (value === null || value === undefined) this.#noValue(node, name);
    const plain = untypedPart(value, name, (object) => this.#shapes.has(object));
    if (!plain) return;
    if (typeof plain.value === 'object')
      this.#fail(
        node,
        `${plain.path} would be a plain ${Array.isArray(plain.value) ? 'array' : 'object'}, but input and algorithm values must have a domain type. Make it with a collection or record type defined in the domain block, as in Queue([...]) with const Queue = collection(Vertex);, or Edge({ ... }) with const Edge = record({ from: Vertex, to: Vertex });.`
      );
    const shown =
      typeof plain.value === 'string' ? JSON.stringify(plain.value) : String(plain.value);
    const fitting = Object.values(this.#atoms).filter(
      (type) => !type.values?.length && atomProblem(type, plain.value) === undefined
    );
    const base: AtomBase =
      typeof plain.value === 'boolean'
        ? 'boolean'
        : typeof plain.value === 'string'
          ? 'text'
          : Number.isInteger(plain.value)
            ? 'integer'
            : 'number';
    const example = { integer: 'Count', number: 'Amount', boolean: 'Flag', text: 'Label' }[base];
    const definition =
      base === 'boolean'
        ? "type('boolean')"
        : base === 'text'
          ? `type([${shown}])`
          : `type('${base}', { min: ${Math.min(0, plain.value as number)}, max: ${Math.max(9, plain.value as number)} })`;
    const fix = fitting.length
      ? `Write it as ${fitting
          .slice(0, 3)
          .map((type) => `${type.name}(${shown})`)
          .join(' or ')}, or declare a type that says what it means in the domain block.`
      : `Declare a type that says what it means in the domain block, such as const ${example} = ${definition};, and write ${example}(${shown}).`;
    const computed =
      node.type === 'Literal' || node.type === 'ArrayExpression' || node.type === 'ObjectExpression'
        ? ''
        : ' Comparisons, .length, .indexOf(), and Math functions give plain values; wrap the result, as in Flag(a < b) or Count(items.length).';
    this.#fail(
      node,
      `${plain.path} would be the plain ${typeof plain.value} ${shown}, but input and algorithm values must have a domain type. ${fix}${computed}`
    );
  }

  #fail(node: AnyNode, message: string): never {
    throw new AlgorithmError(message, this.#offset(node));
  }

  #charge(node: AnyNode, amount = 1): void {
    this.#operations += amount;
    if (this.#operations > algorithmLimits.maximumOperations)
      this.#fail(
        node,
        `The algorithm exceeded ${algorithmLimits.maximumOperations} operations; check for an endless loop or reduce the input.`
      );
  }

  #block(statements: readonly Statement[], scope: Scope): Completion {
    for (const statement of statements) {
      const completion = this.#statement(statement, scope);
      if (completion !== 'normal') return completion;
    }
    return 'normal';
  }

  #statement(node: Statement, scope: Scope): Completion {
    this.#charge(node);
    switch (node.type) {
      case 'BlockStatement':
        return this.#block(node.body, new Scope(scope));
      case 'EmptyStatement':
        return 'normal';
      case 'ExpressionStatement':
        if (node.expression.type === 'YieldExpression') {
          this.#yield(node, scope);
        } else {
          this.#expression(node.expression, scope);
        }
        return 'normal';
      case 'VariableDeclaration':
        for (const declarator of node.declarations) {
          const name = (declarator.id as { name: string }).name;
          if (scope.bindings.has(name))
            this.#fail(
              declarator,
              this.#kind === 'algorithm' && scope === this.#topLevel
                ? `"${name}" is already declared here or in the input block.`
                : `"${name}" is already declared.`
            );
          this.#checkUnique(name, scope.parent, declarator);
          if (!declarator.init) {
            if (this.#kind !== 'design')
              this.#fail(
                declarator,
                `Give ${name} a starting value of its type, as in let ${name} = Index(-1);`
              );
            scope.bindings.set(name, { value: undefined, constant: node.kind === 'const' });
            continue;
          }
          const value = this.#expression(declarator.init, scope);
          this.#typed(value, declarator.init, name);
          const type =
            this.#kind === 'design' ? undefined : this.#declaredType(declarator.init, value);
          scope.bindings.set(name, {
            value,
            constant: node.kind === 'const',
            ...(type ? { type } : {}),
            ...(type && this.#atoms[type]?.index
              ? { target: this.#targetOf(declarator.init, this.#atoms[type], name) }
              : {})
          });
        }
        return 'normal';
      case 'IfStatement':
        if (this.#truthy(this.#expression(node.test, scope)))
          return this.#statement(node.consequent, scope);
        return node.alternate ? this.#statement(node.alternate, scope) : 'normal';
      case 'WhileStatement':
        while (this.#truthy(this.#expression(node.test, scope))) {
          const completion = this.#statement(node.body, scope);
          if (completion === 'return') return completion;
          if (completion === 'break') break;
        }
        return 'normal';
      case 'DoWhileStatement':
        do {
          const completion = this.#statement(node.body, scope);
          if (completion === 'return') return completion;
          if (completion === 'break') break;
        } while (this.#truthy(this.#expression(node.test, scope)));
        return 'normal';
      case 'ForStatement': {
        const loopScope = new Scope(scope);
        if (node.init) {
          if (node.init.type === 'VariableDeclaration') this.#statement(node.init, loopScope);
          else this.#expression(node.init, loopScope);
        }
        while (!node.test || this.#truthy(this.#expression(node.test, loopScope))) {
          const completion = this.#statement(node.body, loopScope);
          if (completion === 'return') return completion;
          if (completion === 'break') break;
          if (node.update) this.#expression(node.update, loopScope);
          this.#charge(node);
        }
        return 'normal';
      }
      case 'ForOfStatement': {
        const items = this.#expression(node.right as Expression, scope);
        if (!Array.isArray(items)) this.#fail(node.right, 'for...of can only iterate over arrays.');
        const declaration = node.left as { kind: string; declarations: { id: Pattern }[] };
        const name = (declaration.declarations[0].id as { name: string }).name;
        this.#checkUnique(name, scope, node.left);
        // The loop variable has the collection's element type, which can be a union.
        const element = (this.#shapes.get(items) as CollectionType | undefined)?.element;
        for (let index = 0; index < items.length; index++) {
          const loopScope = new Scope(scope);
          loopScope.bindings.set(name, {
            value: items[index],
            constant: declaration.kind === 'const',
            ...(element ? { type: element } : {})
          });
          const completion = this.#statement(node.body, loopScope);
          if (completion === 'return') return completion;
          if (completion === 'break') break;
        }
        return 'normal';
      }
      case 'ReturnStatement':
        return 'return';
      case 'BreakStatement':
        return 'break';
      case 'ContinueStatement':
        return 'continue';
      default:
        return this.#fail(node, `${describe(node.type)} is not supported in algorithm blocks.`);
    }
  }

  /**
   * In the algorithm, a name is declared once among the blocks in scope: steps record every
   * variable in scope by its name, so an inner j hiding an outer one could not both be drawn.
   * Loops one after another can each declare their own j. `enclosing` is the innermost block
   * outside the one the name is declared in.
   */
  #checkUnique(name: string, enclosing: Scope | undefined, node: AnyNode): void {
    if (this.#kind !== 'algorithm') return;
    for (let block = enclosing; block && block !== this.#globals; block = block.parent)
      if (block.bindings.has(name))
        this.#fail(
          node,
          `"${name}" is already declared in ${block === this.#topLevel ? 'the top level or the input block' : 'an enclosing block or loop'}; give this one another name, as each step records the variables in scope by name.`
        );
  }

  #yield(node: AnyNode, scope: Scope): void {
    if (this.#trace.length >= algorithmLimits.maximumSteps)
      this.#fail(node, `The algorithm yielded more than ${algorithmLimits.maximumSteps} steps.`);
    this.#trace.push(this.#state(node, scope));
  }

  /**
   * Deep copy with a total node budget, which also stops shared structure from multiplying. Atoms
   * become plain values, with their type recorded by path; every collection, record, and atom is
   * placed for its identity.
   */
  #snapshot(
    value: Value,
    node: AnyNode,
    path: string,
    into: {
      types: TypeMap;
      targets: Record<string, string>;
      placed: Placed[];
      positions: [string, number][];
    }
  ): TraceValue {
    const { types, targets, placed, positions } = into;
    this.#traceValues += 1;
    if (this.#traceValues > algorithmLimits.maximumTraceValues)
      this.#fail(node, 'The recorded steps are too large; use smaller state or fewer steps.');
    if (value === undefined) return null;
    if (value instanceof Atom) {
      types[path] = value.type.name;
      // A position an element or field holds points into the only collection of its type.
      const [only, ...others] = value.type.index ? this.#collectionsOf(value.type) : [];
      if (only && !others.length) targets[path] = only;
      if (value.type.index) positions.push([path, value.value as number]);
      // A collection or record holds it, or a variable, after them (see identities.server.ts).
      placed.push([path, value, path.includes('[') || path.includes('.') ? 'held' : 'variable']);
      return value.value;
    }
    const shape = value !== null && typeof value === 'object' ? this.#shapes.get(value) : undefined;
    if (shape) {
      types[path] = shape.name;
      placed.push([path, value as object, 'shared']);
    }
    if (Array.isArray(value))
      return Array.from(value, (item, index) =>
        this.#snapshot(item, node, `${path}[${index}]`, into)
      );
    if (value === mathMarker) return null;
    if (value !== null && typeof value === 'object') {
      const copy: Record<string, TraceValue> = {};
      for (const [key, item] of Object.entries(value))
        copy[key] = this.#snapshot(item, node, `${path}.${key}`, into);
      return copy;
    }
    return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  }

  #expression(node: Expression | SpreadElement, scope: Scope): Value {
    this.#charge(node);
    switch (node.type) {
      case 'Literal':
        return node.value as Value;
      case 'Identifier': {
        const binding = scope.lookup(node.name);
        if (!binding) this.#fail(node, `"${node.name}" is not defined.`);
        return binding.value;
      }
      case 'TemplateLiteral': {
        let text = node.quasis[0].value.cooked ?? '';
        node.expressions.forEach((expression, index) => {
          text += this.#text(this.#expression(expression, scope), expression);
          text += node.quasis[index + 1].value.cooked ?? '';
        });
        return this.#checkString(text, node);
      }
      case 'ArrayExpression': {
        const items: Value[] = [];
        for (const element of node.elements) {
          if (element === null) this.#fail(node, 'Array holes are not supported.');
          if (element.type === 'SpreadElement') {
            const spread = this.#expression(element.argument, scope);
            if (!Array.isArray(spread)) this.#fail(element, 'Only arrays can be spread.');
            this.#charge(element, spread.length);
            items.push(...spread);
          } else {
            items.push(this.#expression(element, scope));
          }
          this.#checkLength(items.length, node);
        }
        return items;
      }
      case 'ObjectExpression': {
        const object = Object.create(null) as ObjectValue;
        for (const property of node.properties) {
          if (property.type !== 'Property') this.#fail(property, 'Object spread is not supported.');
          const key =
            property.key.type === 'Identifier'
              ? property.key.name
              : String((property.key as { value?: unknown }).value);
          object[key] = this.#expression(property.value as Expression, scope);
        }
        return object;
      }
      case 'MemberExpression':
        return this.#read(this.#expression(node.object as Expression, scope), node, scope);
      case 'CallExpression':
        return this.#call(node, scope);
      case 'UnaryExpression': {
        const value = this.#expression(node.argument, scope);
        if (node.operator === '!') return !this.#truthy(value);
        const number = this.#number(value, node);
        return node.operator === '-'
          ? this.#numeric(value instanceof Atom ? value.type : undefined, -number, node)
          : value;
      }
      case 'BinaryExpression':
        return this.#binary(
          node.operator,
          this.#expression(node.left as Expression, scope),
          this.#expression(node.right, scope),
          node
        );
      case 'LogicalExpression': {
        const left = this.#expression(node.left, scope);
        if (node.operator === '&&')
          return this.#truthy(left) ? this.#expression(node.right, scope) : left;
        if (node.operator === '||')
          return this.#truthy(left) ? left : this.#expression(node.right, scope);
        return left ?? this.#expression(node.right, scope);
      }
      case 'ConditionalExpression':
        return this.#truthy(this.#expression(node.test, scope))
          ? this.#expression(node.consequent, scope)
          : this.#expression(node.alternate, scope);
      case 'SequenceExpression': {
        let value: Value;
        for (const expression of node.expressions) value = this.#expression(expression, scope);
        return value;
      }
      case 'AssignmentExpression': {
        // Resolve the target once so a[i++] += 1 evaluates i++ a single time, as in JavaScript.
        const target = this.#reference(node.left as Expression, scope);
        const right = this.#expression(node.right, scope);
        const value = target.prepare(
          node.operator === '='
            ? right
            : this.#binary(node.operator.slice(0, -1), target.get(), right, node)
        );
        this.#typed(value, node.right, targetName(node.left as Expression));
        target.set(value);
        return value;
      }
      case 'UpdateExpression': {
        const target = this.#reference(node.argument, scope);
        const current = target.get();
        const before = this.#number(current, node);
        const after = target.prepare(
          this.#numeric(
            current instanceof Atom ? current.type : undefined,
            node.operator === '++' ? before + 1 : before - 1,
            node
          )
        );
        this.#typed(after, node, targetName(node.argument));
        target.set(after);
        return node.prefix ? after : current;
      }
      default:
        return this.#fail(node, `${describe(node.type)} is not supported in algorithm blocks.`);
    }
  }

  /**
   * What an assignment writes to: its current value, the value as the place stores it (converted
   * to a collection's element type or a record's field type), and the write itself.
   */
  #reference(
    target: Expression,
    scope: Scope
  ): { get(): Value; prepare(value: Value): Value; set(value: Value): void } {
    if (target.type === 'Identifier') {
      const binding = scope.lookup(target.name);
      if (!binding || binding === this.#globals.bindings.get(target.name))
        this.#fail(target, `"${target.name}" must be declared with let before it is assigned.`);
      if (binding.constant) this.#fail(target, `"${target.name}" is a constant.`);
      return {
        get: () => binding.value,
        // A variable keeps the type it was made with, as an element or field does.
        prepare: (value) =>
          binding.type
            ? this.#convert(value, binding.type, target, target.name, binding.target)
            : value,
        set: (value) => {
          binding.value = value;
        }
      };
    }
    if (target.type !== 'MemberExpression') this.#fail(target, 'Invalid assignment target.');
    const object = this.#expression(target.object as Expression, scope);
    const key = this.#key(target, scope);
    const slot =
      object !== null && typeof object === 'object' && !(object instanceof Atom)
        ? this.#slotType(object, key as string | number, target)
        : undefined;
    const prepare = (value: Value) =>
      slot ? this.#convert(value, slot, target, targetName(target)) : value;
    if (Array.isArray(object)) {
      if (typeof key !== 'number' || !Number.isInteger(key))
        this.#fail(target, 'Array elements are assigned by whole-number index.');
      // Writing at the length adds an element; any further would leave a gap with no value.
      if (key < 0 || key > object.length)
        this.#fail(
          target,
          `${targetName(target)} is outside the collection: it has ${object.length} element${object.length === 1 ? '' : 's'}, so write at 0 to ${object.length}, where ${object.length} adds one.`
        );
      return {
        get: () => object[key],
        prepare,
        set: (value) => {
          this.#checkLength(key + 1, target);
          object[key] = value;
        }
      };
    }
    if (
      object === null ||
      typeof object !== 'object' ||
      object === mathMarker ||
      object instanceof Atom
    )
      this.#fail(target, 'Only arrays and objects can have elements or properties assigned.');
    const name = String(key);
    if (forbiddenProperties.has(name)) this.#fail(target, 'That property name is not allowed.');
    return {
      get: () => object[name],
      prepare,
      set: (value) => {
        if (!(name in object)) this.#checkLength(Object.keys(object).length + 1, target);
        object[name] = value;
      }
    };
  }

  #key(node: MemberExpression, scope: Scope): Value {
    if (!node.computed) return (node.property as { name: string }).name;
    const key = unwrap(this.#expression(node.property as Expression, scope));
    if (typeof key !== 'number' && typeof key !== 'string')
      this.#fail(node.property, 'Indexes must be numbers or strings.');
    return key;
  }

  #read(target: Value, node: MemberExpression, scope: Scope): Value {
    const key = this.#key(node, scope);
    // Typed text reads like text; other atoms have no properties.
    const object = target instanceof Atom && target.type.base === 'text' ? target.value : target;
    if (object instanceof Atom)
      this.#fail(node, `A ${object.type.name} value has no "${String(key)}".`);
    if (object === mathMarker) {
      if (typeof key === 'string' && key in mathConstants) return mathConstants[key];
      return this.#fail(node, `Math.${String(key)} can only be called, or does not exist.`);
    }
    if (Array.isArray(object) || typeof object === 'string') {
      if (key === 'length') return object.length;
      if (typeof key === 'number' && Number.isInteger(key) && Array.isArray(object)) {
        if (key >= 0 && key < object.length) return object[key];
        return this.#fail(
          node,
          `${targetName(node)} is outside the collection: it has ${object.length} element${object.length === 1 ? '' : 's'}${object.length ? `, at 0 to ${object.length - 1}` : ''}.`
        );
      }
      if (typeof key === 'number' && Number.isInteger(key) && key >= 0) return object[key];
      return this.#fail(node, `Unsupported element or property "${String(key)}".`);
    }
    if (object !== null && typeof object === 'object') {
      const name = String(key);
      if (forbiddenProperties.has(name)) this.#fail(node, 'That property name is not allowed.');
      // Reading a field a record does not have is a mistake, not a missing value.
      this.#slotType(object, name, node);
      return object[name];
    }
    return this.#fail(node, `Cannot read "${String(key)}" of ${String(object)}.`);
  }

  #call(node: CallExpression, scope: Scope): Value {
    const callee = node.callee;
    if (callee.type === 'Identifier' && this.#random && drawFunctions.has(callee.name))
      return this.#draw(callee.name, node, scope);
    if (
      callee.type === 'Identifier' &&
      (Object.hasOwn(this.#atoms, callee.name) ||
        Object.hasOwn(this.#domain.structures, callee.name))
    )
      return this.#construct(node, callee.name, scope);
    if (callee.type !== 'MemberExpression' || callee.computed || node.optional)
      this.#fail(node, 'Only Math functions and array methods can be called.');
    const object = this.#expression(callee.object as Expression, scope);
    const name = (callee.property as { name: string }).name;
    let args = node.arguments.map((argument) => {
      if (argument.type === 'SpreadElement')
        this.#fail(argument, 'Spread arguments are not supported.');
      return this.#expression(argument, scope);
    });
    if (object === mathMarker) {
      const fn = mathFunctions[name];
      if (!fn) this.#fail(callee, `Math.${name} is not available.`);
      return fn(...args.map((argument) => this.#number(argument, node)));
    }
    if (!Array.isArray(object)) this.#fail(callee, `.${name}() is only available on arrays.`);
    const collection = this.#shapes.get(object) as CollectionType | undefined;
    if (name === 'push' || name === 'unshift') {
      const added = `an item added by ${targetName(callee.object as Expression)}.${name}()`;
      // Items take the collection's element type, as an element assigned by index does.
      if (collection)
        args = args.map((argument, index) =>
          this.#convert(argument, collection.element, node.arguments[index], added)
        );
      args.forEach((argument, index) => this.#typed(argument, node.arguments[index], added));
    }
    this.#charge(node, object.length);
    switch (name) {
      case 'push':
        this.#checkLength(object.length + args.length, node);
        return object.push(...args);
      case 'pop':
        return object.pop();
      case 'shift':
        return object.shift();
      case 'unshift':
        this.#checkLength(object.length + args.length, node);
        return object.unshift(...args);
      case 'slice': {
        const part = object.slice(
          args[0] === undefined ? undefined : this.#number(args[0], node),
          args[1] === undefined ? undefined : this.#number(args[1], node)
        );
        // A part of a collection is a collection of the same type.
        if (collection) this.#shapes.set(part, collection);
        return part;
      }
      // Typed values are found by value, as === compares them.
      case 'indexOf':
        return object.findIndex((item) => this.#equal(item, args[0], node));
      case 'includes':
        return object.some((item) => this.#equal(item, args[0], node));
      case 'reverse':
        return object.reverse();
      case 'join': {
        const separator = args[0] === undefined ? ',' : this.#text(args[0], node);
        return this.#checkString(
          object.map((item) => this.#text(item, node)).join(separator),
          node
        );
      }
      default:
        return this.#fail(callee, `Array method .${name}() is not available.`);
    }
  }

  /** A design draw: its arguments, and exactly one number from its own keyed stream. */
  #draw(name: string, node: CallExpression, scope: Scope): Value {
    const args = node.arguments.map((argument) => {
      if (argument.type === 'SpreadElement')
        this.#fail(argument, 'Spread arguments are not supported.');
      return unwrap(this.#expression(argument, scope));
    });
    try {
      return drawValue(name, args, () =>
        (this.#random as (draw: AnyNode) => number)(node)
      ) as Value;
    } catch (cause) {
      return this.#fail(node, cause instanceof Error ? cause.message : String(cause));
    }
  }

  /**
   * Operators on typed values: results keep the more specific of two related types, an untyped
   * operand adopts the other's type, and unrelated types cannot be combined or compared.
   */
  #binary(operator: string, left: Value, right: Value, node: AnyNode): Value {
    switch (operator) {
      case '===':
        return this.#equal(left, right, node);
      case '!==':
        return !this.#equal(left, right, node);
      case '+': {
        const a = unwrap(left);
        const b = unwrap(right);
        if (typeof a === 'string' || typeof b === 'string') {
          const text = this.#checkString(this.#text(left, node) + this.#text(right, node), node);
          // Joining text keeps a text type, unless the result is outside an enumeration.
          const [leftType, rightType] = [left, right].map((value) =>
            value instanceof Atom && value.type.base === 'text' ? value : undefined
          );
          const type = this.#combined(leftType, rightType, node);
          return type && !atomProblem(type, text) ? new Atom(type, text) : text;
        }
        return this.#arithmetic(operator, left, right, node);
      }
      case '<':
      case '<=':
      case '>':
      case '>=': {
        this.#combined(left, right, node);
        const plainLeft = unwrap(left);
        const plainRight = unwrap(right);
        const bothStrings = typeof plainLeft === 'string' && typeof plainRight === 'string';
        const a = bothStrings ? plainLeft : this.#number(left, node);
        const b = bothStrings ? plainRight : this.#number(right, node);
        if (operator === '<') return a < b;
        if (operator === '<=') return a <= b;
        return operator === '>' ? a > b : a >= b;
      }
      default:
        return this.#arithmetic(operator, left, right, node);
    }
  }

  /**
   * Arithmetic keeps its operands' type, numeric enumerations included, so a result outside the
   * type, such as Weight(5) + Weight(4) when Weight allows 4, 5, and 7, is an error.
   */
  #arithmetic(operator: string, left: Value, right: Value, node: AnyNode): Value {
    const type = this.#combined(left, right, node);
    if (type && type.base !== 'integer' && type.base !== 'number')
      this.#fail(node, `${type.name} values cannot be used in arithmetic.`);
    const a = this.#number(left, node);
    const b = this.#number(right, node);
    let result: number;
    if (operator === '+') result = a + b;
    else if (operator === '-') result = a - b;
    else if (operator === '*') result = a * b;
    else if (operator === '/') result = a / b;
    else if (operator === '%') result = a % b;
    else if (operator === '**') result = a ** b;
    else return this.#fail(node, `The ${operator} operator is not supported.`);
    return this.#numeric(type, result, node);
  }

  /** The result type of two operands, failing for unrelated types. */
  #combined(left: Value, right: Value, node: AnyNode): AtomType | undefined {
    try {
      return combinedType(
        left instanceof Atom ? left.type : undefined,
        right instanceof Atom ? right.type : undefined,
        this.#atoms
      );
    } catch (cause) {
      return this.#fail(node, cause instanceof Error ? cause.message : String(cause));
    }
  }

  /** Wrap a computed number in a type, failing when it leaves the type's range. */
  #numeric(type: AtomType | undefined, value: number, node: AnyNode): Value {
    try {
      return numericResult(type, value);
    } catch (cause) {
      return this.#fail(node, cause instanceof Error ? cause.message : String(cause));
    }
  }

  /**
   * Atoms compare by value; unrelated types are an error rather than silently unequal, except
   * members of one union, which a place can hold either of: values of different members are unequal.
   */
  #equal(left: Value, right: Value, node: AnyNode): boolean {
    if (left instanceof Atom && right instanceof Atom && this.#unionMembers(left.type, right.type))
      return (
        (refines(left.type, right.type, this.#atoms) ||
          refines(right.type, left.type, this.#atoms)) &&
        left.value === right.value
      );
    if (left instanceof Atom || right instanceof Atom) this.#combined(left, right, node);
    return unwrap(left) === unwrap(right);
  }

  /** Whether two atomic types are both members (or refine members) of one union. */
  #unionMembers(a: AtomType, b: AtomType): boolean {
    const memberOf = (union: UnionType, type: AtomType) =>
      union.members.some(
        (member) => !!this.#atoms[member] && refines(type, this.#atoms[member], this.#atoms)
      );
    return Object.values(this.#domain.structures).some(
      (structure) => structure.kind === 'union' && memberOf(structure, a) && memberOf(structure, b)
    );
  }

  #number(value: Value, node: AnyNode): number {
    const plain = value instanceof Atom ? value.value : value;
    if (typeof plain !== 'number')
      this.#fail(
        node,
        value instanceof Atom
          ? `Expected a number but found a ${value.type.name} value.`
          : `Expected a number but found ${kind(value)}.`
      );
    return plain;
  }

  #text(value: Value, node: AnyNode): string {
    if (value instanceof Atom) return String(value.value);
    if (value !== null && typeof value === 'object')
      this.#fail(node, `Cannot turn ${kind(value)} into text; use .join() for arrays.`);
    return String(value);
  }

  #checkString(text: string, node: AnyNode): string {
    if (text.length > algorithmLimits.maximumStringLength)
      this.#fail(node, `Strings are limited to ${algorithmLimits.maximumStringLength} characters.`);
    return text;
  }

  /**
   * Rebuild interpreter values from recorded input state: null-prototype objects, atoms wherever
   * the recorded types name one, and records and collections wherever they name one of those.
   */
  #fromTrace(value: TraceValue, path: string, types: TypeMap): Value {
    const typeName = types[path];
    if (typeName && this.#atoms[typeName] && (value === null || typeof value !== 'object'))
      return value === null ? null : new Atom(this.#atoms[typeName], value);
    let made: Value[] | ObjectValue | undefined;
    if (Array.isArray(value))
      made = value.map((item, index) => this.#fromTrace(item, `${path}[${index}]`, types));
    else if (value !== null && typeof value === 'object') {
      const object = Object.create(null) as ObjectValue;
      for (const [key, item] of Object.entries(value))
        object[key] = this.#fromTrace(item, `${path}.${key}`, types);
      made = object;
    }
    if (!made) return value as Value;
    const shape = typeName ? this.#domain.structures[typeName] : undefined;
    if (shape && shape.kind !== 'union') this.#shapes.set(made, shape);
    return made;
  }

  #checkLength(length: number, node: AnyNode): void {
    if (length > algorithmLimits.maximumCollectionLength)
      this.#fail(
        node,
        `Arrays and objects are limited to ${algorithmLimits.maximumCollectionLength} entries.`
      );
  }
}

/**
 * The first part of a value that has no domain type, and where it is: a primitive, or an array or
 * object no collection or record type made. Each array or object is checked once, however often it
 * is shared, so a value that repeats itself stays cheap to check.
 */
function untypedPart(
  value: Value,
  path: string,
  typed: (object: object) => boolean,
  checked = new Set<object>()
): { path: string; value: string | number | boolean | object } | undefined {
  if (value === null || value === undefined || value instanceof Atom) return undefined;
  if (typeof value === 'object') {
    if (value === mathMarker || checked.has(value)) return undefined;
    if (!typed(value)) return { path, value };
    checked.add(value);
    const entries: [string, Value][] = Array.isArray(value)
      ? value.map((item, index) => [`[${index}]`, item])
      : Object.entries(value).map(([key, item]) => [`.${key}`, item]);
    for (const [step, item] of entries) {
      const found = untypedPart(item, path + step, typed, checked);
      if (found) return found;
    }
    return undefined;
  }
  return { path, value };
}

/** An object made by the input or algorithm (a record, or a plain object before it becomes one). */
function isPlainObject(value: Value): value is ObjectValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Atom) &&
    value !== mathMarker
  );
}

/** How an assignment target reads in the source, such as distances[neighbor]. */
function targetName(target: Expression | Pattern): string {
  if (target.type === 'Identifier') return target.name;
  if (target.type === 'MemberExpression') {
    const property = target.property;
    const inner = targetName(target.object as Expression);
    if (!target.computed && property.type === 'Identifier') return `${inner}.${property.name}`;
    if (property.type === 'Identifier') return `${inner}[${property.name}]`;
    if (property.type === 'Literal') return `${inner}[${JSON.stringify(property.value)}]`;
    return `${inner}[…]`;
  }
  return 'the value';
}

function kind(value: Value): string {
  if (value === null) return 'null';
  if (value instanceof Atom) return `a ${value.type.name} value`;
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : typeof value;
}

/** The plain value of an atom; other values unchanged. */
function unwrap(value: Value): Value {
  return value instanceof Atom ? value.value : value;
}

function atomBase(type: AtomType): AtomBase {
  return type.base;
}
