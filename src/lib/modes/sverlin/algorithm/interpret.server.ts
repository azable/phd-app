/** Interpret Sverlin input and algorithm blocks into recorded state and steps. */

import type {
  AnyNode,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  Expression,
  FunctionDeclaration,
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
import {
  AlgorithmError,
  describe,
  forbiddenProperties,
  type BlockKind,
  type Span
} from './block.server';
import { EventLog, type EventCounts, type EventKind, type TraceEvent } from './events.server';
import { Identities, type Placed, type StepIdentities } from './identities.server';
import { parseBlock } from './parse.server';
import {
  noDomain,
  operationNames,
  type CollectionType,
  type DomainRegistry,
  type Operation,
  type RecordType,
  type RefType,
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

/**
 * One step of the master trace that every presentation of a source shares, with the events since
 * the step before (see events.server.ts).
 */
export type MasterStep = {
  state: TraceState;
  types: TypeMap;
  targets?: Record<string, string>;
  identities?: StepIdentities;
  events?: TraceEvent[];
  dropped?: number;
  counts?: EventCounts;
};

// Bounds keep interpretation short, memory small, and the embedded trace well inside the bundle limit.
export const algorithmLimits = {
  maximumSteps: 200,
  maximumOperations: 1_000_000,
  maximumCallDepth: 100,
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
 * Names a block declares, read without running it: at its top level, and in the algorithm in any
 * block and as a function's parameters, as a step records every variable in scope.
 */
export function declaredNames(body: string, kind: BlockKind, domain?: DomainRegistry): string[] {
  const { root } = parseBlock(body, kind, domain);
  const names = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== 'object') return;
    const part = node as {
      type?: string;
      declarations?: { id: { name: string } }[];
      params?: { name: string }[];
    };
    if (part.type === 'VariableDeclaration')
      for (const declarator of part.declarations ?? []) names.add(declarator.id.name);
    if (part.type === 'FunctionDeclaration')
      for (const param of part.params ?? []) names.add(param.name);
    if (kind === 'algorithm')
      for (const [key, child] of Object.entries(node)) if (key !== 'loc') visit(child);
  };
  root.body.forEach(visit);
  return [...names];
}

/**
 * Interpret the algorithm from the input state; the variables in scope are recorded at each yield,
 * and where the domain declares operations, by operation, the calls since the last yield (event)
 * and every call so far (history).
 */
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
type OperationType = RecordType & { operation: Operation };

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
  readonly #domain: DomainRegistry;
  readonly #atoms: AtomRegistry;
  /** The record or collection type of every array and object an input or algorithm made. */
  readonly #shapes = new WeakMap<object, RecordType | CollectionType>();
  readonly #trace: MasterStep[] = [];
  readonly #identities = new Identities();
  #operations = 0;
  #traceValues = 0;
  /** By operation, the calls since the last yield and every call so far, each a record of its operands. */
  #event = Object.create(null) as Record<string, ObjectValue[]>;
  readonly #history = Object.create(null) as Record<string, ObjectValue[]>;
  /** How many operations' bodies are running, and the algorithm's scope at the outermost call. */
  #bodies = 0;
  #callSite: Scope | undefined;
  /** The value a running body's return statement gave. */
  #returned: Value;
  /** The algorithm's functions by name, and each parameter's type, fixed by the first call. */
  readonly #functions = new Map<string, FunctionDeclaration>();
  readonly #parameterTypes = new Map<string, (string | undefined)[]>();
  /** The scope of the running call's parameters, or the top level outside every call. */
  #frame: Scope = this.#topLevel;
  #depth = 0;
  readonly #log = new EventLog();
  /** The place each collection and record was last reached by, as values or edges[2]. */
  readonly #places = new WeakMap<object, string>();
  /** What the last element or field read read from, and by which key. */
  #readFrom: Value;
  #readKey: string | number = '';

  constructor(
    root: BlockStatement,
    offset: (node: AnyNode) => Span,
    options: {
      kind: BlockKind;
      initial?: TypedState;
      domain?: DomainRegistry;
    }
  ) {
    this.#root = root;
    this.#offset = offset;
    this.#kind = options.kind;
    this.#domain = options.domain ?? noDomain;
    this.#atoms = this.#domain.atoms;
    if (this.#kind === 'algorithm')
      for (const name of operationNames(this.#domain)) {
        this.#event[name] = [];
        this.#history[name] = [];
      }
    this.#globals.bindings.set('Math', { value: mathMarker, constant: true });
    this.#globals.bindings.set('Infinity', { value: Infinity, constant: true });
    this.#globals.bindings.set('NaN', { value: NaN, constant: true });
    // Input values become ordinary top-level variables the algorithm may update, keeping types.
    const initial = Object.entries(options.initial?.state ?? {});
    const initialTypes = options.initial?.types ?? {};
    const initialTargets = options.initial?.targets ?? {};
    for (const [name, value] of initial)
      this.#topLevel.bindings.set(name, {
        value: this.#fromTrace(value, name, initialTypes, initialTargets),
        constant: false,
        type: options.initial?.declared?.[name] ?? initialTypes[name],
        ...(initialTargets[name] ? { target: initialTargets[name] } : {})
      });
    for (const statement of root.body)
      if (statement.type === 'FunctionDeclaration')
        this.#functions.set(statement.id.name, statement);
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

  /** Run an input block and return its top-level bindings, with their declared types. */
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
   * enclosing block's, outermost first, up to the running call's parameters, which hide top-level
   * variables of the same name. One not declared yet, or whose block has ended, is not.
   */
  #inScope(scope: Scope): [string, Binding][] {
    const blocks: Scope[] = [];
    for (
      let block: Scope | undefined = scope;
      block && block !== this.#topLevel && block !== this.#globals;
      block = block.parent
    )
      blocks.unshift(block);
    const hidden = new Set(blocks.flatMap((block) => [...block.bindings.keys()]));
    return [
      ...this.#topLevelNames.flatMap((name): [string, Binding][] => {
        const binding = this.#topLevel.bindings.get(name);
        return binding && !hidden.has(name) ? [[name, binding]] : [];
      }),
      ...blocks.flatMap((block) => [...block.bindings])
    ];
  }

  #state(
    node: AnyNode,
    scope: Scope = this.#topLevel,
    recorded: [string, Binding][] = []
  ): TypedState {
    const state: TraceState = {};
    const types: TypeMap = {};
    const targets: Record<string, string> = {};
    const placed: Placed[] = [];
    const inScope = this.#inScope(scope);
    for (const [name, binding] of [...inScope, ...recorded]) {
      state[name] = this.#snapshot(binding.value, node, name, {
        types,
        targets,
        placed
      });
      if (binding.target) targets[name] = binding.target;
      // A reference is no place of its own: it records which element of a collection of its
      // type it refers to, as the same value can also be a field elsewhere, as an edge's end.
      const ref = this.#domain.structures[binding.type ?? ''];
      if (ref?.kind === 'ref') {
        types[name] = ref.name;
        const at = placed.findIndex(([path]) => path === name);
        if (at >= 0) placed.splice(at, 1);
        const element = inScope.flatMap(([collection, { value }]) => {
          const index =
            Array.isArray(value) && this.#shapes.get(value)?.name === ref.collection
              ? value.indexOf(binding.value)
              : -1;
          return index >= 0 ? [`${collection}[${index}]`] : [];
        })[0];
        placed.push([name, binding.value as object, 'ref', element]);
      }
    }
    if (this.#frame !== this.#topLevel)
      for (const [path, name] of Object.entries(targets)) targets[path] = this.#shown(name, scope);
    return {
      state,
      types,
      ...(Object.keys(targets).length ? { targets } : {}),
      ...(this.#kind === 'algorithm' ? { identities: this.#identities.step(placed) } : {})
    };
  }

  /**
   * Inside a call, the name a step records a collection under: the top-level variable holding the
   * same collection, as the view draws it, if any; otherwise the call's own name for it.
   */
  #shown(name: string, scope: Scope): string {
    const collection = scope.lookup(name)?.value;
    if (!Array.isArray(collection)) return name;
    return (
      this.#topLevelNames.find(
        (topLevel) => this.#topLevel.bindings.get(topLevel)?.value === collection
      ) ?? name
    );
  }

  /** Log an event of the algorithm, at a node of its block or of an operation's body. */
  #emit(
    kind: EventKind,
    node: AnyNode,
    details?: Pick<TraceEvent, 'place' | 'name' | 'index' | 'held' | 'method'> & {
      value?: Value;
    }
  ): void {
    if (this.#kind === 'algorithm')
      this.#log.add(kind, node, this.#bodies > 0, details?.place, details?.value, details);
  }

  /** Log a read or write, the events the algorithm logs most. */
  #access(kind: 'read' | 'write', node: AnyNode, place: string | undefined, value: Value): void {
    if (this.#kind === 'algorithm') this.#log.add(kind, node, this.#bodies > 0, place, value);
  }

  /** The place a collection or record holds, by the name a step records it under. */
  #placed(object: Value, place: string | undefined): void {
    if (
      place &&
      object !== null &&
      typeof object === 'object' &&
      !(object instanceof Atom) &&
      this.#places.get(object) !== place
    )
      this.#places.set(object, place);
  }

  /** The place of an element or field of a value whose place is known, as values[3]. */
  #within(object: Value, key: string | number): string | undefined {
    const place =
      object !== null && typeof object === 'object' ? this.#places.get(object) : undefined;
    if (place === undefined) return undefined;
    return typeof key === 'number' ? `${place}[${key}]` : `${place}.${key}`;
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
    const made = this.#construct({ ...node, arguments: [number] }, type.name, scope) as Atom;
    return new Atom(made.type, made.value, name);
  }

  /** A position as one pointing into the given collection; any other value as it is. */
  #pointingInto(value: Value, collection: string): Value {
    if (!(value instanceof Atom) || !value.type.index || value.collection === collection)
      return value;
    return new Atom(value.type, value.value, collection);
  }

  #holdsCollection(name: string, type: AtomType, scope: Scope = this.#topLevel): boolean {
    const value = scope.lookup(name)?.value;
    return Array.isArray(value) && this.#shapes.get(value)?.name === type.index;
  }

  /**
   * The variables holding a collection a position type points into: the top level's, or inside a
   * call, its parameters and the variables at the top of its body.
   */
  #collectionsOf(type: AtomType): string[] {
    return [...this.#frame.bindings.keys()].filter((name) =>
      this.#holdsCollection(name, type, this.#frame)
    );
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
   * A value as the domain type a place expects. A literal or plain value becomes that type; a typed
   * value must already be it, or refine it. Records and collections are made field by field and
   * element by element. There is no null: every place holds a value of its type.
   */
  #convert(value: Value, typeName: string, node: AnyNode, path: string, target?: string): Value {
    if (value === null || value === undefined) return this.#noValue(node, path, typeName);
    const atom = this.#atoms[typeName];
    if (atom) {
      const made = this.#asAtom(value, atom, node, path);
      if (!atom.index) return made;
      // A position a variable holds points into the variable's collection; one an element or field
      // holds keeps the collection it came from, as a variable's or Position(left, 0)'s, and a
      // number stored there points into the only collection of its type.
      const collection = target ?? made.collection ?? this.#onlyCollection(atom, node, path);
      return this.#pointingInto(made, collection);
    }
    const structure = this.#domain.structures[typeName];
    if (structure.kind === 'union') return this.#asMember(value, structure, node, path);
    if (structure.kind === 'record') return this.#asRecord(value, structure, node, path);
    if (structure.kind === 'ref') return this.#asRef(value, structure, node);
    return this.#asCollection(value, structure, node, path);
  }

  /**
   * A reference is the element itself, taken from a collection of its type: the snapshot records
   * which element it is (identities.server.ts), so it stays with it as it moves.
   */
  #asRef(value: Value, ref: RefType, node: AnyNode): Value {
    const held = [...this.#topLevel.bindings.values()].some(
      ({ value: collection }) =>
        Array.isArray(collection) &&
        this.#shapes.get(collection)?.name === ref.collection &&
        collection.includes(value)
    );
    if (!held)
      this.#fail(
        node,
        `A ${ref.name} refers to an element of a ${ref.collection}, so make it from one, as in ${ref.name}(${this.#collectionsOf({ name: ref.name, base: 'integer', index: ref.collection })[0] ?? 'queue'}[0]).`
      );
    return value;
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
   * The collection a position variable points into, fixed at its declaration: its starting value's,
   * as Position(left, 0)'s, a bound variable's, or a field's, or else the only one of its type.
   */
  #targetOf(init: Expression, type: AtomType, name: string, value: Value): string {
    return (
      (value instanceof Atom ? value.collection : undefined) ??
      this.#onlyCollection(type, init, name)
    );
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
   * property holds is a typed value, or null for nothing yet.
   */
  /** A place that would hold no value, such as .pop() of an empty collection, or null. */
  #noValue(node: AnyNode, path: string, typeName?: string): never {
    return this.#fail(
      node,
      `${path} would have no value: it was taken from an empty collection, or past its end. There is no null: ${typeName ? `a ${typeName} is needed here; ` : ''}for "nothing yet", use a value of a type that says so, such as Index(-1), or Unreached('unreached') in a union.`
    );
  }

  #typed(value: Value, node: AnyNode, name: string): void {
    if (
      value === undefined &&
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      this.#functions.has(node.callee.name)
    )
      this.#fail(
        node,
        `${node.callee.name}(...) gave no value here: give it one with return, as in return i;.`
      );
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
    throw new AlgorithmError(message, this.#offset(node), this.#bodies ? 'domain' : undefined);
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
          if (!declarator.init)
            this.#fail(
              declarator,
              `Give ${name} a starting value of its type, as in let ${name} = Index(-1);`
            );
          const value = this.#expression(declarator.init, scope);
          this.#typed(value, declarator.init, name);
          const type = this.#declaredType(declarator.init, value);
          const target =
            type && this.#atoms[type]?.index
              ? this.#targetOf(declarator.init, this.#atoms[type], name, value)
              : undefined;
          scope.bindings.set(name, {
            value: target ? this.#pointingInto(value, target) : value,
            constant: node.kind === 'const',
            ...(type ? { type } : {}),
            ...(target ? { target } : {})
          });
          this.#access('write', declarator, name, value);
        }
        return 'normal';
      case 'IfStatement':
        if (this.#test(node.test, scope)) return this.#statement(node.consequent, scope);
        return node.alternate ? this.#statement(node.alternate, scope) : 'normal';
      case 'WhileStatement':
        return this.#loop(node, (index) =>
          this.#test(node.test, scope) ? this.#pass(node, index, scope) : 'break'
        );
      case 'FunctionDeclaration':
        return 'normal';
      case 'ForStatement': {
        // The subset allows only counted loops: let i = a; i < b (or <=, >, >=); i++ (or the like).
        const loopScope = new Scope(scope);
        this.#statement(node.init as Statement, loopScope);
        const test = node.test as BinaryExpression;
        const counter = (test.left as { name: string }).name;
        let bound: number | undefined;
        return this.#loop(node, (index) => {
          if (index > 0) {
            this.#expression(node.update as Expression, loopScope);
            this.#charge(node);
          }
          const limit = this.#expression(test.right, loopScope);
          const value = this.#number(limit, test.right);
          if (bound !== undefined && value !== bound)
            this.#fail(
              test.right,
              `The bound of the ${counter} loop changed from ${bound} to ${value}, but a counted loop's bound is fixed when it starts; write the loop as a while loop.`
            );
          bound = value;
          const counted = loopScope.lookup(counter)?.value as Value;
          this.#access('read', test.left, counter, counted);
          const held = this.#truthy(this.#binary(test.operator, counted, limit, test));
          this.#emit('test', test, { held });
          return held ? this.#pass(node, index, loopScope) : 'break';
        });
      }
      case 'ForOfStatement': {
        const items = this.#expression(node.right as Expression, scope);
        if (!Array.isArray(items)) this.#fail(node.right, 'for...of can only iterate over arrays.');
        const declaration = node.left as { kind: string; declarations: { id: Pattern }[] };
        const name = (declaration.declarations[0].id as { name: string }).name;
        this.#checkUnique(name, scope, node.left);
        // The loop variable has the collection's element type, which can be a union.
        const element = (this.#shapes.get(items) as CollectionType | undefined)?.element;
        const place = this.#places.get(items);
        return this.#loop(node, (index) => {
          if (index >= items.length) return 'break';
          const loopScope = new Scope(scope);
          loopScope.bindings.set(name, {
            value: items[index],
            constant: declaration.kind === 'const',
            ...(element ? { type: element } : {})
          });
          this.#placed(items[index], place && `${place}[${index}]`);
          this.#access('write', node.left, name, items[index]);
          return this.#pass(node, index, loopScope);
        });
      }
      case 'ReturnStatement':
        if (node.argument) this.#returned = this.#expression(node.argument, scope);
        this.#emit('return', node, { value: node.argument ? this.#returned : undefined });
        return 'return';
      case 'BreakStatement':
        this.#emit('break', node);
        return 'break';
      case 'ContinueStatement':
        this.#emit('continue', node);
        return 'continue';
      default:
        return this.#fail(node, `${describe(node.type)} is not supported in algorithm blocks.`);
    }
  }

  /** A condition, logged with whether it held. */
  #test(node: Expression, scope: Scope): boolean {
    const held = this.#truthy(this.#expression(node, scope));
    this.#emit('test', node, { held });
    return held;
  }

  /**
   * Run a loop, logged as entered and left: each pass, numbered from 0, gives what the loop does
   * next, 'break' once it ends.
   */
  #loop(node: Statement, pass: (index: number) => Completion): Completion {
    this.#emit('enter', node);
    let completion: Completion = 'normal';
    for (let index = 0; ; index++) {
      const next = pass(index);
      if (next === 'return') completion = 'return';
      if (next === 'return' || next === 'break') break;
    }
    this.#emit('exit', node);
    return completion;
  }

  /** One iteration of a loop's body: 'normal' to go on, also after continue. */
  #pass(node: Statement & { body: Statement }, index: number, scope: Scope): Completion {
    this.#emit('iteration', node, { index });
    const completion = this.#statement(node.body, scope);
    return completion === 'continue' ? 'normal' : completion;
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
    const recorded: [string, Binding][] = Object.keys(this.#history).length
      ? [
          ['event', { value: this.#event, constant: true }],
          ['history', { value: this.#history, constant: true }]
        ]
      : [];
    this.#emit('yield', node);
    this.#trace.push({
      ...this.#state(node, scope, recorded),
      ...this.#log.step(this.#offset, (value) => {
        const single = unwrap(value as Value);
        return typeof single === 'number' ||
          typeof single === 'string' ||
          typeof single === 'boolean'
          ? single
          : undefined;
      })
    });
    for (const name of Object.keys(this.#event)) this.#event[name] = [];
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
    }
  ): TraceValue {
    const { types, targets, placed } = into;
    this.#traceValues += 1;
    if (this.#traceValues > algorithmLimits.maximumTraceValues)
      this.#fail(node, 'The recorded steps are too large; use smaller state or fewer steps.');
    if (value === undefined) return null;
    if (value instanceof Atom) {
      types[path] = value.type.name;
      // A position points into the collection it was bound to where it was made or stored, or
      // else the only collection of its type.
      const [only, ...others] =
        value.type.index && !value.collection ? this.#collectionsOf(value.type) : [];
      const collection = value.collection ?? (others.length ? undefined : only);
      if (collection) targets[path] = collection;
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
        if (binding === this.#globals.bindings.get(node.name)) return binding.value;
        // Inside a call, a collection is named as the top level holds it.
        const place =
          this.#frame !== this.#topLevel && Array.isArray(binding.value)
            ? this.#shown(node.name, scope)
            : node.name;
        this.#placed(binding.value, place);
        this.#access('read', node, place, binding.value);
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
          ? this.#numeric(
              value instanceof Atom ? value.type : undefined,
              -number,
              node,
              collectionOf(value)
            )
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
        if (node.operator !== '=') this.#access('read', node.left, target.place, target.get());
        const value = target.prepare(
          node.operator === '='
            ? right
            : this.#binary(node.operator.slice(0, -1), target.get(), right, node)
        );
        this.#typed(value, node.right, targetName(node.left as Expression));
        target.set(value);
        this.#access('write', node, target.place, value);
        return value;
      }
      case 'UpdateExpression': {
        const target = this.#reference(node.argument, scope);
        const current = target.get();
        this.#access('read', node.argument, target.place, current);
        const before = this.#number(current, node);
        const after = target.prepare(
          this.#numeric(
            current instanceof Atom ? current.type : undefined,
            node.operator === '++' ? before + 1 : before - 1,
            node,
            collectionOf(current)
          )
        );
        this.#typed(after, node, targetName(node.argument));
        target.set(after);
        this.#access('write', node, target.place, after);
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
  ): {
    get(): Value;
    prepare(value: Value): Value;
    set(value: Value): void;
    place?: string;
  } {
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
          this.#placed(value, target.name);
        },
        place: target.name
      };
    }
    if (target.type !== 'MemberExpression') this.#fail(target, 'Invalid assignment target.');
    let object = this.#expression(target.object as Expression, scope);
    let key = this.#key(target, scope);
    if (object instanceof Atom && object.type.index && key === 'value')
      [object, key] = this.#pointedAt(object, target, scope);
    const place = this.#within(object, key as string | number);
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
          this.#placed(value, place);
        },
        place
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
        this.#placed(value, place);
      },
      place
    };
  }

  /**
   * The collection a position points into and its index there, for its value: in an operation's
   * body, the collection in scope where the algorithm called it.
   */
  #pointedAt(position: Atom, node: MemberExpression, scope: Scope): [Value[], number] {
    const name =
      position.collection ??
      this.#onlyCollection(position.type, node, targetName(node.object as Expression));
    const site = this.#callSite ?? scope;
    const collection = site.lookup(name)?.value;
    if (!Array.isArray(collection))
      this.#fail(node, `${targetName(node)} reads ${name}, which is out of scope here.`);
    this.#placed(collection, this.#shown(name, site));
    return [collection, position.value as number];
  }

  #key(node: MemberExpression, scope: Scope): Value {
    if (!node.computed) return (node.property as { name: string }).name;
    const key = unwrap(this.#expression(node.property as Expression, scope));
    if (typeof key !== 'number' && typeof key !== 'string')
      this.#fail(node.property, 'Indexes must be numbers or strings.');
    return key;
  }

  /** An element or field read, logged with its place, which its value holds if it is a part. */
  #read(target: Value, node: MemberExpression, scope: Scope): Value {
    const value = this.#readValue(target, node, scope);
    const place =
      this.#readFrom === mathMarker ? undefined : this.#within(this.#readFrom, this.#readKey);
    if (place === undefined) return value;
    this.#placed(value, place);
    this.#access('read', node, place, value);
    return value;
  }

  /** The value an element or field read gives, noting what it was read from and by which key. */
  #readValue(target: Value, node: MemberExpression, scope: Scope): Value {
    let key = this.#key(node, scope) as string | number;
    // Typed text reads like text; other atoms have no properties, but a position's value is the
    // element it points at.
    let object = target instanceof Atom && target.type.base === 'text' ? target.value : target;
    if (object instanceof Atom && object.type.index && key === 'value')
      [object, key] = this.#pointedAt(object, node, scope);
    if (object instanceof Atom)
      this.#fail(node, `A ${object.type.name} value has no "${String(key)}".`);
    if (object === mathMarker) {
      if (typeof key === 'string' && key in mathConstants)
        return this.#readAt(mathConstants[key], object, key);
      return this.#fail(node, `Math.${String(key)} can only be called, or does not exist.`);
    }
    if (Array.isArray(object) || typeof object === 'string') {
      if (key === 'length') return this.#readAt(object.length, object, key);
      if (typeof key === 'number' && Number.isInteger(key) && Array.isArray(object)) {
        if (key >= 0 && key < object.length) return this.#readAt(object[key], object, key);
        return this.#fail(
          node,
          `${targetName(node)} is outside the collection: it has ${object.length} element${object.length === 1 ? '' : 's'}${object.length ? `, at 0 to ${object.length - 1}` : ''}.`
        );
      }
      if (typeof key === 'number' && Number.isInteger(key) && key >= 0)
        return this.#readAt(object[key], object, key);
      return this.#fail(node, `Unsupported element or property "${String(key)}".`);
    }
    if (object !== null && typeof object === 'object') {
      const name = String(key);
      if (forbiddenProperties.has(name)) this.#fail(node, 'That property name is not allowed.');
      // Reading a field a record does not have is a mistake, not a missing value.
      this.#slotType(object, name, node);
      return this.#readAt(object[name], object, name);
    }
    return this.#fail(node, `Cannot read "${String(key)}" of ${String(object)}.`);
  }

  #readAt(value: Value, object: Value, key: string | number): Value {
    this.#readFrom = object;
    this.#readKey = key;
    return value;
  }

  #call(node: CallExpression, scope: Scope): Value {
    const callee = node.callee;
    const operation =
      callee.type === 'Identifier' ? this.#domain.structures[callee.name] : undefined;
    if (operation?.kind === 'record' && operation.operation)
      return this.#operate(node, operation as OperationType, scope);
    const declared = callee.type === 'Identifier' ? this.#functions.get(callee.name) : undefined;
    if (declared) return this.#invoke(node, declared, scope);
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
    const place = this.#places.get(object);
    if (place !== undefined) {
      const changes = ['push', 'pop', 'shift', 'unshift', 'reverse'].includes(name);
      this.#emit(changes ? 'write' : 'read', node, { place, method: name });
    }
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

  /**
   * Call an operation: the one object it is given becomes a record of its operands, all its body
   * sees, recorded for the step's event and the operation's history before the body runs; its
   * value is the body's.
   */
  #operate(node: CallExpression, operation: OperationType, scope: Scope): Value {
    const [argument, ...others] = node.arguments;
    const given =
      argument && argument.type !== 'SpreadElement' && !others.length
        ? this.#expression(argument, scope)
        : undefined;
    if (!isPlainObject(given) || this.#shapes.has(given))
      this.#fail(
        node,
        `${operation.name}(...) takes its operands as one object, as in ${operation.name}({ ${Object.keys(operation.fields).join(', ')} }).`
      );
    const operands = this.#asRecord(
      Object.assign(Object.create(null) as ObjectValue, given),
      operation,
      argument,
      operation.name
    );
    this.#event[operation.name].push(operands);
    this.#history[operation.name].push(operands);
    const body = new Scope(this.#globals);
    for (const [name, type] of Object.entries(operation.fields)) {
      const target = collectionOf(operands[name]);
      body.bindings.set(name, {
        value: operands[name],
        constant: true,
        type,
        ...(target ? { target } : {})
      });
    }
    const callSite = this.#callSite;
    this.#callSite ??= scope;
    this.#emit('open', node, { name: operation.name });
    this.#bodies += 1;
    let result: Value;
    try {
      const arrow = operation.operation.body;
      if (arrow.body.type !== 'BlockStatement') result = this.#expression(arrow.body, body);
      else {
        this.#returned = undefined;
        this.#block(arrow.body.body, body);
        result = this.#returned as Value;
      }
    } finally {
      this.#returned = undefined;
      this.#bodies -= 1;
      this.#callSite = callSite;
    }
    this.#emit('close', node, { name: operation.name, value: result });
    return result;
  }

  /**
   * A call of one of the algorithm's functions. Its body sees only its parameters, each declared
   * from its argument as a variable is from its starting value, with the type the first call gave
   * it. A position given with the collection it points into points into that parameter in the
   * body, and one returned into a collection given points back into the caller's.
   */
  #invoke(node: CallExpression, declared: FunctionDeclaration, scope: Scope): Value {
    const name = declared.id.name;
    const parameters = declared.params.map((param) => (param as { name: string }).name);
    if (node.arguments.length !== parameters.length)
      this.#fail(
        node,
        `${name} takes ${parameters.length === 1 ? 'one argument' : `${parameters.length} arguments`}${parameters.length ? `: ${parameters.join(', ')}` : ''}.`
      );
    if (this.#depth >= algorithmLimits.maximumCallDepth)
      this.#fail(node, `Calls nest more than ${algorithmLimits.maximumCallDepth} deep.`);
    const types = this.#parameterTypes.get(name);
    const frame = new Scope(this.#globals);
    // A collection given by its variable's name, by the parameter that names it in the body.
    const renamed = new Map<string, string>();
    node.arguments.forEach((argument, index) => {
      if (argument.type === 'Identifier' && Array.isArray(scope.lookup(argument.name)?.value))
        renamed.set(argument.name, parameters[index]);
    });
    const given = node.arguments.map((argument, index) => {
      if (argument.type === 'SpreadElement')
        this.#fail(argument, 'Spread arguments are not supported.');
      const parameter = parameters[index];
      let value = this.#expression(argument, scope);
      this.#typed(value, argument, parameter);
      const type = this.#declaredType(argument, value);
      if (types && types[index] !== type)
        this.#fail(
          argument,
          `${name}'s ${parameter} is a ${types[index] ?? 'plain value'}, as its first call gave it, so it cannot be given a ${type ?? 'plain value'}.`
        );
      if (value instanceof Atom && value.collection && renamed.has(value.collection))
        value = this.#pointingInto(value, renamed.get(value.collection) as string);
      const target = value instanceof Atom && value.type.index ? value.collection : undefined;
      frame.bindings.set(parameter, {
        value,
        constant: false,
        ...(type ? { type } : {}),
        ...(target ? { target } : {})
      });
      return type;
    });
    if (!types) this.#parameterTypes.set(name, given);
    this.#emit('call', node, { name });
    declared.params.forEach((param, index) => {
      const { value } = frame.bindings.get(parameters[index]) as Binding;
      this.#placed(
        value,
        Array.isArray(value) ? this.#shown(parameters[index], frame) : parameters[index]
      );
      this.#access('write', param, parameters[index], value);
    });
    const outer = this.#frame;
    const returned = this.#returned;
    this.#frame = frame;
    this.#depth += 1;
    this.#returned = undefined;
    try {
      const completion = this.#block(declared.body.body, frame);
      const end = declared.body.end;
      if (completion !== 'return') this.#emit('return', { ...declared.body, start: end - 1, end });
      const result = this.#returned as Value;
      const back = new Map([...renamed].map(([argument, parameter]) => [parameter, argument]));
      return result instanceof Atom && result.collection && back.has(result.collection)
        ? this.#pointingInto(result, back.get(result.collection) as string)
        : result;
    } finally {
      this.#frame = outer;
      this.#depth -= 1;
      this.#returned = returned;
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
    // A position moved by a number keeps its collection, as i + 1 does.
    return this.#numeric(type, result, node, collectionOf(left) ?? collectionOf(right));
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
  #numeric(type: AtomType | undefined, value: number, node: AnyNode, collection?: string): Value {
    try {
      return numericResult(type, value, collection);
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
  #fromTrace(
    value: TraceValue,
    path: string,
    types: TypeMap,
    targets: Record<string, string>
  ): Value {
    const typeName = types[path];
    if (typeName && this.#atoms[typeName] && (value === null || typeof value !== 'object'))
      return value === null ? null : new Atom(this.#atoms[typeName], value, targets[path]);
    let made: Value[] | ObjectValue | undefined;
    if (Array.isArray(value))
      made = value.map((item, index) => this.#fromTrace(item, `${path}[${index}]`, types, targets));
    else if (value !== null && typeof value === 'object') {
      const object = Object.create(null) as ObjectValue;
      for (const [key, item] of Object.entries(value))
        object[key] = this.#fromTrace(item, `${path}.${key}`, types, targets);
      made = object;
    }
    if (!made) return value as Value;
    const shape = typeName ? this.#domain.structures[typeName] : undefined;
    if (shape && (shape.kind === 'record' || shape.kind === 'collection'))
      this.#shapes.set(made, shape);
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

/** The collection a position points into, if the value is one bound to a collection. */
function collectionOf(value: Value): string | undefined {
  return value instanceof Atom ? value.collection : undefined;
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
