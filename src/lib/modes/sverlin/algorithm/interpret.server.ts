/** Interpret Sverlin input and algorithm blocks into recorded state and steps. */

import type {
  AnyNode,
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
  entering,
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
import { readLabels, type Label, type LabelProblem } from './labels.server';
import { parseBlock, spanOf } from './parse.server';
import { rawOperation, hiddenProblem, unwrappedNumber, type RawContext } from './raw.server';
import {
  noDomain,
  pooledRecords,
  type CollectionType,
  type DomainRegistry,
  type RecordType,
  type RefType,
  type UnionType
} from './structures.server';

// The domain block and the shared block vocabulary, for callers of this module.

// Names of the host, never variables: a read of one is told only that it is not defined.
const hostNames = new Set([
  ...['undefined', 'globalThis', 'window', 'self', 'document', 'require', 'process', 'eval']
]);
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

/** The variables in scope at one moment, as a step records them before and after its code. */
export type StepSnapshot = {
  state: TraceState;
  types: TypeMap;
  targets?: Record<string, string>;
  identities?: StepIdentities;
};

/**
 * One step of a source's trace: where a label it pauses at finishes (see Pacing), as the state
 * just before its code and just after it. Its events are those since the step before, the first
 * `gap` of them leading up to its code and the rest its code's own. Its moment is how many events
 * the algorithm had logged by its end, the same however the steps are paced, so presentations
 * pacing them differently line up by it. What runs after the last step is a step of its own, with
 * no code of its own.
 */
/** Events logged from one count to another, lighting the code of the labels named. */
export type Stretch = [from: number, to: number, labels: readonly string[]];

export type MasterStep = {
  moment?: number;
  before?: StepSnapshot;
  gap?: number;
  /** The code the step is a run of, a label's, where it is not the end. */
  unit?: Span;
  /**
   * The step's name, the same however the steps pause: the label whose run it ends, by its full
   * name, and which run of it that is, the nth of that label's runs to begin over the whole
   * algorithm, as @insert.swap#1; `start` for the input as given and `end` for the algorithm's end.
   */
  name?: string;
  state: TraceState;
  types: TypeMap;
  targets?: Record<string, string>;
  identities?: StepIdentities;
  events?: TraceEvent[];
  dropped?: number;
  counts?: EventCounts;
  /**
   * The applications made since the step before inside the labels the view renders their operators
   * at (see Pacing), by operator, each in order.
   */
  applied?: Record<string, Application[]>;
  /** The values each labelled expression gave since the step before, by the label's full name. */
  labelled?: Record<string, LabelRun[]>;
  /**
   * The stop the step is at, numbered in the order the algorithm reaches the starts and ends of
   * every span, the same however the steps pause: a span's record started at the stop its
   * :before is, and ended at its :after's.
   */
  stop?: number;
  /** The labels whose runs the step is inside, by full name: the run it ends and those around it. */
  inside?: string[];
  /** The same runs, each as its label and which run of it it is, as insert#2. */
  runs?: string[];
  /**
   * Where the step is a scene's edge, a stop of the runs it is within: their :before, the input as
   * given or the state just before such a run begins; their :after, the state the algorithm ends
   * on or just after such a run ends.
   */
  edge?: Stop;
  /**
   * The values labelled expressions gave at earlier steps inside the run the step ends, which it
   * shows whole, drawn from its before on.
   */
  held?: Record<string, LabelRun[]>;
  /** How many events the algorithm had logged by the step's end; its events are the last of them. */
  seen?: number;
  /**
   * The stretches of the events logged whose code the step lights, each from the count logged
   * before its first to that before the one after its last, with the labels of its run, by full
   * name, whose code alone it lights: its own run.
   */
  trail?: Stretch[];
};

/**
 * A span of a label kept as a record (see design "Records"): when it started and ended, as stops
 * numbered in the order the algorithm reaches them (see MasterStep.stop), the call it is in and the call around that, how many calls
 * are around its call, and the variables in scope at its two stops. A function's own span is its
 * call.
 */
export type SpanRecord = {
  label: string;
  ordinal: number;
  started: number;
  ended: number;
  /** The call it is in, as sort#3, and the call around that; none outside every call. */
  call?: string;
  parent?: string;
  depth: number;
  before?: StepSnapshot;
  after?: StepSnapshot;
};

/**
 * An application of an operator, its operands named by the operator's parameters and its result as
 * `value`, each copied when it was made, with the types of their parts by path.
 */
export type Application = {
  state: TraceState;
  types: TypeMap;
  /** The collection each position in it points into, by path, as a step's targets. */
  targets?: Record<string, string>;
  at?: number;
  /** In the step's own code, the id of each typed operand and the result, by path, as copies. */
  identities?: Record<string, number>;
};

/**
 * A value a labelled expression gave, copied when it was given, with the types of its parts and the
 * collection each position in it points into, by path from `value`.
 */
export type LabelRun = {
  state: { value: TraceValue };
  types: TypeMap;
  targets: Record<string, string>;
};

// Bounds keep interpretation short, memory small, and the embedded trace well inside the bundle limit.
// maximumSteps bounds what one presentation shows, the steps of the labels a variant pauses at.
// maximumSourceSteps bounds the trace pausing at every label, which only names and orders the
// steps any variant can show (PreparedComponent.steps): each presentation carries its names, 20 to
// 25 bytes a step in the Dijkstra and BST fixtures, so 2,000 keep that list near 50 KB; the trace
// values stay bounded by maximumTraceValues, and each step keeps at most maximumStepEvents events
// (events.server.ts).
export const algorithmLimits = {
  maximumSteps: 200,
  maximumSourceSteps: 2_000,
  maximumOperations: 1_000_000,
  maximumCallDepth: 100,
  maximumCollectionLength: 10_000,
  maximumStringLength: 10_000,
  maximumTraceValues: 200_000
} as const;

/**
 * Why the trace grew past its bound, with numbers: each step records every variable in scope, so
 * its size is the state times the steps (project c0dc2b85's 10-vertex search hit it, and the
 * repair had only "too large" to go on).
 */
function tooLargeMessage(steps: number): string {
  const each = Math.round(algorithmLimits.maximumTraceValues / Math.max(steps, 1));
  return `The recorded steps are too large: ${steps} steps so far, about ${each} values each, past ${algorithmLimits.maximumTraceValues.toLocaleString('en')} in all. Each step records every variable in scope, so keep less state (adjacency lists rather than a matrix, no copies of arrays, fewer fields in a record), label fewer statements, or give a smaller input.`;
}

/** The name a label's applications are kept under, as the view reads the label: `@insert.compare` as `ℓinsertˑcompare`. */
export const labelApplication = (full: string): string => `ℓ${full.replaceAll('.', 'ˑ')}`;

/** Interpret an input block, as one case gives it (see cases.server.ts), into the state it starts from. */
export function interpretInput(body: string, domain: DomainRegistry = noDomain): TypedState {
  const { root, offset } = parseBlock(body, 'input', domain);
  return new Interpreter(root, offset, { kind: 'input', domain, code: body }).bindings();
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
 * The names a block's code refers to, its declarations' own names left out: an identifier read,
 * written or called, never a member's property name or an object's key.
 */
export function referencedNames(
  body: string,
  kind: BlockKind,
  domain?: DomainRegistry
): Set<string> {
  const { root } = parseBlock(body, kind, domain);
  const names = new Set<string>();
  const visit = (node: unknown, parent?: { type?: string; computed?: boolean }, key?: string) => {
    if (Array.isArray(node)) return node.forEach((child) => visit(child, parent, key));
    if (node === null || typeof node !== 'object') return;
    const part = node as { type?: string; name?: string; computed?: boolean };
    if (part.type === 'Identifier') {
      const named =
        (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
        (parent?.type === 'Property' && key === 'key' && !parent.computed) ||
        (parent?.type === 'VariableDeclarator' && key === 'id') ||
        (parent?.type === 'FunctionDeclaration' && (key === 'id' || key === 'params'));
      if (!named && part.name) names.add(part.name);
      return;
    }
    for (const [childKey, child] of Object.entries(node))
      if (childKey !== 'loc') visit(child, part, childKey);
  };
  root.body.forEach((node) => visit(node));
  return names;
}

/** Interpret the algorithm from the input state; the variables in scope are recorded at each step. */
export function interpretAlgorithm(
  body: string,
  input: TypedState = { state: {}, types: {} },
  domain: DomainRegistry = noDomain
): MasterStep[] {
  return traceAlgorithm(body, input, domain).steps;
}

/** A node's place in the algorithm, as a key: "12:30". */
export function spanKey({ start, end }: Span): string {
  return `${start}:${end}`;
}

/** Statements in a row one label marks, each run of it from the first to the last. */
export type Row = { first: AnyNode; last: AnyNode };

/** The code one label marks: a single node, or statements in a row. */
type Unit = AnyNode | Row;

/**
 * The code labels mark, each run of which can be a step: single nodes (a statement, a block, an
 * expression, a call; a loop at each pass), and statements in a row, by the statement each starts
 * at, outermost first where rows inside one another start together.
 */
export type FrameUnits = {
  nodes: ReadonlySet<AnyNode>;
  ranges: ReadonlyMap<AnyNode, readonly Row[]>;
};

/**
 * The stops the page pauses at, by full name: a label, a step at the end of each of its runs (its
 * :after), showing its own run whole; a label with :before, a step just before each of its runs
 * begins. A label not paused at is passed through.
 */
export type Pauses = ReadonlySet<string>;

/** The two stops of a run: just before its code begins, and just after it ends. */
export type Stop = 'before' | 'after';

/** The pause at a label's :before, in Pauses. */
export const beforeStop = (label: string): string => `${label}:before`;

/** The label a step's name is for, as insert.swap for @insert.swap#2.end or @insert.swap#2.start. */
export const labelOfStep = (name = ''): string => name.replace(/^@|#\d+\.(?:start|end)$/gu, '');

/**
 * Where the page pauses, which makes the steps: the end of each run of each label in `pauses`, by
 * full name, every label 'on' without them; code outside them joins the next step. `shown`: the
 * operators the view renders at labels, with the labels' spans, whose applications there are kept.
 */
export type Pacing = {
  shown?: ReadonlyMap<string, readonly Span[]>;
  pauses?: Pauses;
  /** The runs a scene is within, every run of the label or its nth, each opening and closing on a step (see Edge). */
  edges?: Edges;
};

/** The runs of one label, all of them or the nth to begin, as a scene is within. */
export type Edges = { label: string; run?: number };

/**
 * The source's labels (see labels.server.ts), the code they mark, each label's unit, and the
 * problems with them, among them two labels on the same code, which could never pause or draw apart.
 */
export function stepLabels(
  parsed: Pick<ReturnType<typeof parseBlock>, 'root' | 'markers' | 'code'>,
  /** Whether no code may run outside a label, as in an authored source (see readLabels). */
  complete = false
): {
  units: FrameUnits;
  unitOf: ReadonlyMap<Label, Unit>;
  labels: Label[];
  problems: LabelProblem[];
} {
  const { root, markers, code } = parsed;
  const read = readLabels(root, markers, code, complete);
  const problems = [...read.problems];
  const nodes = new Set<AnyNode>();
  const ranges = new Map<AnyNode, Row[]>();
  const unitOf = new Map<Label, Unit>();
  for (const label of read.labels) {
    const marked = label.nodes;
    const first = marked[0];
    const last = marked[marked.length - 1];
    const same = read.labels.find(
      (other) => unitOf.has(other) && other.nodes[0] === first && other.nodes.at(-1) === last
    );
    if (same) {
      problems.push({
        message: `@${label.full} marks the same code as @${same.full}, so the two can never pause or draw apart: keep one name.`,
        at: label.at
      });
      continue;
    }
    if (marked.length === 1) {
      nodes.add(first);
      unitOf.set(label, first);
      continue;
    }
    const row = { first, last };
    unitOf.set(label, row);
    const rows = [...(ranges.get(first) ?? []), row];
    ranges.set(
      first,
      rows.sort((a, b) => spanOf(b.last).end - spanOf(a.last).end)
    );
  }
  return { units: { nodes, ranges }, unitOf, labels: read.labels, problems };
}

/**
 * Interpret the algorithm, pausing at the labels given or else at every label (see Pacing), and
 * record the steps. Keeps its tree, labels, and code as parsed, which its listings are mapped by.
 */
export function traceAlgorithm(
  body: string,
  input: TypedState = { state: {}, types: {} },
  domain: DomainRegistry = noDomain,
  pacing: Pacing = {},
  /** What views draw beyond the state: the labels whose values are kept, by full name. */
  keep: {
    labels?: ReadonlySet<string>;
    /** The labels a view typed by the label draws, whose operands and result are kept as applications. */
    applications?: ReadonlySet<string>;
    /** The labels whose spans are kept as records, for queries over them (see SpanRecord). */
    records?: ReadonlySet<string>;
  } = {},
  /** Whether no code may run outside a label, as in an authored source (see readLabels). */
  complete = false
): {
  steps: MasterStep[];
  /** Step 0: the input as given, before any of the algorithm runs (see run). */
  opening: MasterStep;
  root: BlockStatement;
  labels: Label[];
  code: string;
  /** The spans of the labels kept as records, and of every call, in the order they ended. */
  records: SpanRecord[];
  /** The variables outside every function and block, which every step holds (see topLevel). */
  topLevel: readonly string[];
} {
  const parsed = parseBlock(body, 'algorithm', domain);
  const { root, offset, code } = parsed;
  const labelled = stepLabels(parsed, complete);
  const [problem] = labelled.problems;
  if (problem) throw new AlgorithmError(problem.message, problem.at, true);
  // The values each labelled expression gives are kept, for views drawing them (labels as values).
  const captured = new Map<AnyNode, string[]>();
  for (const { full, nodes, statement } of labelled.labels)
    if (!statement && nodes.length === 1 && keep.labels?.has(full))
      captured.set(nodes[0], [...(captured.get(nodes[0]) ?? []), full]);
  // A labelled expression a view typed by its label draws: its operands and result, kept as an
  // application; a label around a whole expression statement, as @compare[a < b];, marks its
  // expression.
  const applying = new Map<AnyNode, string[]>();
  for (const { full, nodes, statement } of labelled.labels) {
    if (nodes.length !== 1 || !keep.applications?.has(full)) continue;
    const [node] = nodes;
    const expression = !statement
      ? node
      : node.type === 'ExpressionStatement'
        ? (node as AnyNode & { expression: AnyNode }).expression
        : undefined;
    if (expression) applying.set(expression, [...(applying.get(expression) ?? []), full]);
  }
  // A block or statement label a view is typed by draws its span's record, the variables in scope
  // when the span ends; a label a query reads keeps every span's record.
  const recording = new Set<string>(keep.records ?? []);
  for (const { full, nodes, statement } of labelled.labels)
    if (keep.applications?.has(full) && (statement || nodes.length !== 1)) recording.add(full);
  const named = new Map<Unit, string>();
  const holding = new Map<string, Unit>();
  for (const label of labelled.labels) {
    named.set(labelled.unitOf.get(label)!, label.full);
    if (label.parent) holding.set(label.full, labelled.unitOf.get(label.parent)!);
  }
  const interpreter = new Interpreter(root, offset, {
    kind: 'algorithm',
    initial: input,
    domain,
    code,
    captured,
    applying,
    recording,
    drawnRecords: keep.applications ?? new Set(),
    units: labelled.units,
    named,
    holding,
    pacing,
    pauses: pacing.pauses ?? new Set(labelled.labels.map(({ full }) => full))
  });
  const steps = interpreter.run();
  return {
    steps,
    opening: interpreter.opening!,
    root,
    labels: labelled.labels,
    code,
    records: interpreter.records,
    topLevel: interpreter.topLevel
  };
}

// ---------------------------------------------------------------------------------------------
// Interpreter: values are primitives, typed atoms, plain arrays, and null-prototype objects.

type ObjectValue = { [key: string]: Value };
type Value = undefined | null | boolean | number | string | Atom | Value[] | ObjectValue;
/**
 * A variable: its value, and in the input and algorithm the type it was made with; a position also
 * names the collection it points into; a `for … of` variable, the collection type it walks, whose
 * element it refers to as a reference would.
 */
type Binding = { value: Value; constant: boolean; type?: string; target?: string; of?: string };
type Completion = 'normal' | 'break' | 'continue' | 'return';
/** Where a step's code starts: the state then, and how many events led up to it. */
type Since = { before: StepSnapshot; gap: number };
/**
 * A run of labelled code going on: its unit and the node it starts at, numbered in the order runs
 * start, and among its label's runs (`ordinal`, from 1), the scope it runs in, and, where it is a
 * step, since. It starts after `start` events.
 */
type Run = {
  unit: Unit;
  node: AnyNode;
  number: number;
  ordinal: number;
  scope: Scope;
  start: number;
  /** The stop it started at (see MasterStep.stop). */
  started: number;
  since?: Since;
  /** The variables in scope as it started, where its label's spans are kept as records. */
  before?: StepSnapshot;
};
/**
 * A value a labelled expression gave, by the label's full name, with the run of the label around it
 * and the runs going on as it was given; recorded once a step has come after it.
 */
type Given = {
  name: string;
  run: LabelRun;
  around: Run;
  inside: readonly Run[];
  recorded: boolean;
};

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
  /** The records that have a pool, each with its pool type. */
  readonly #heaps: ReadonlyMap<string, CollectionType>;
  /** Each record's pool, its nodes in the order added: the one array the pool's variable holds. */
  readonly #made = new Map<string, ObjectValue[]>();
  /** The node whose fields a step is recording, as its pool's element, not as a reference. */
  #expanding: object | undefined;
  /** While an input's pools are rebuilt, each pool's nodes by their place in it. */
  #restoring: Map<string, ObjectValue[]> | undefined;
  readonly #trace: MasterStep[] = [];
  /** The state just after the input, before any of the algorithm runs, which a page opens on. */
  opening: MasterStep | undefined;
  readonly #identities = new Identities();
  #operations = 0;
  #traceValues = 0;
  /** The value a running body's return statement gave. */
  #returned: Value;
  /** How many operators' functions are running, which compute as JavaScript does and log nothing. */
  #inOperator = 0;
  /** The collections and records operators computed, written into a place in place (see #store). */
  readonly #computed = new WeakSet<object>();
  /** What a raw operation's problem names: the block's code, and the domain's types. */
  readonly #raw: RawContext;
  /** The algorithm's functions by name, and each parameter's type, fixed by the first call. */
  readonly #functions = new Map<string, FunctionDeclaration>();
  readonly #parameterTypes = new Map<string, (string | undefined)[]>();
  /** The scope of the running call's parameters, or the top level outside every call. */
  #frame: Scope = this.#topLevel;
  #depth = 0;
  /** The scope each running call was made from, outermost first: its variables keep nodes live. */
  readonly #callers: Scope[] = [];
  readonly #log = new EventLog();
  /** The code labels mark, and the full name of the label on each unit. */
  readonly #units: FrameUnits;
  readonly #named: ReadonlyMap<Unit, string>;
  /** The unit of the label around each label, by its full name. */
  readonly #holding: ReadonlyMap<string, Unit>;
  /** What the view shows applied, kept for it. */
  readonly #pacing: Pacing;
  /** The labels to pause at, by full name. */
  readonly #pauses: Pauses;
  /** The values labelled expressions gave inside runs of the labels around them going on. */
  #labelGiven: Given[] = [];
  /** How many runs have started, numbering each. */
  #runCount = 0;
  /** The state after the last step recorded, which the code run since then leads up from. */
  #since: Since | undefined;
  /** How many runs of each label have begun, by full name, which numbers each run as it begins. */
  readonly #begun = new Map<string, number>();
  /** How many steps end at each label paused at, by full name, for advice on pausing at fewer. */
  readonly #stepsAt = new Map<string, number>();
  /** The label runs going on, outermost first. */
  readonly #runs: Run[] = [];
  /** The applications the step being recorded made, by operator. */
  #applied: Record<string, Application[]> = {};
  /** The labels whose spans are kept as records, and those a view draws a span's record of. */
  readonly #recording: ReadonlySet<string>;
  readonly #drawnRecords: ReadonlySet<string>;
  /** The bodies of the functions called, whose spans are calls. */
  readonly #functionBodies = new WeakSet<object>();
  /** The records kept, in the order their spans ended (see SpanRecord). */
  readonly records: SpanRecord[] = [];

  /** The input's variables and those the algorithm declares outside every function and block. */
  get topLevel(): readonly string[] {
    return this.#topLevelNames;
  }
  /** How many starts and ends of spans the algorithm has reached (see MasterStep.stop). */
  #stops = 0;
  /**
   * The typed operands and result of each application, and the variable each operand was read
   * through, if any, so its copy starts there (see identities).
   */
  readonly #operands = new WeakMap<Application, { path: string; value: Atom; from?: string }[]>();
  /** The values the step being recorded gave each labelled expression, by full name. */
  #labelled: Record<string, LabelRun[]> = {};
  /** The applications and labelled values since the last step, in order. */
  #pendingApplied: [string, Application][] = [];
  #pendingLabelled: [string, LabelRun][] = [];
  /** Each labelled expression's node, with the full names of the labels on it. */
  readonly #captured: ReadonlyMap<AnyNode, readonly string[]>;
  /** Each labelled expression a view typed by its label draws, with its labels' full names. */
  readonly #applying: ReadonlyMap<AnyNode, readonly string[]>;
  /** The operands each expression was last evaluated with, by name, for its label's application. */
  readonly #operandsOf = new WeakMap<AnyNode, [string, Value][]>();
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
      units?: FrameUnits;
      named?: ReadonlyMap<Unit, string>;
      holding?: ReadonlyMap<string, Unit>;
      pacing?: Pacing;
      pauses?: Pauses;
      code?: string;
      captured?: ReadonlyMap<AnyNode, readonly string[]>;
      applying?: ReadonlyMap<AnyNode, readonly string[]>;
      recording?: ReadonlySet<string>;
      drawnRecords?: ReadonlySet<string>;
    }
  ) {
    this.#recording = options.recording ?? new Set();
    this.#drawnRecords = options.drawnRecords ?? new Set();
    this.#root = root;
    this.#captured = options.captured ?? new Map();
    this.#applying = options.applying ?? new Map();
    this.#units = options.units ?? { nodes: new Set(), ranges: new Map() };
    this.#named = options.named ?? new Map();
    this.#holding = options.holding ?? new Map();
    this.#pacing = options.pacing ?? {};
    this.#pauses = options.pauses ?? new Set();
    this.#offset = offset;
    this.#kind = options.kind;
    this.#domain = options.domain ?? noDomain;
    this.#atoms = this.#domain.atoms;
    this.#heaps = pooledRecords(this.#domain);
    const atomTypes = Object.values(this.#atoms);
    this.#raw = {
      text: (node) => {
        const { start, end } = offset(node);
        return (options.code ?? '')
          .slice(start, end)
          .replace(/\s+/gu, ' ')
          .replace(/([[(]) | ([\])])/gu, '$1$2')
          .trim();
      },
      indexOf: (collection) => atomTypes.find((type) => type.index === collection)?.name
    };
    this.#globals.bindings.set('Math', { value: mathMarker, constant: true });
    this.#globals.bindings.set('Infinity', { value: Infinity, constant: true });
    this.#globals.bindings.set('NaN', { value: NaN, constant: true });
    // Input values become ordinary top-level variables the algorithm may update, keeping types.
    const initialTypes = options.initial?.types ?? {};
    const initialTargets = options.initial?.targets ?? {};
    // An input's pools come as their nodes, the references to them as places in them.
    this.#restoring = new Map();
    const pools = new Map<string, string>();
    for (const [record, pool] of this.#heaps) {
      const name = Object.keys(options.initial?.state ?? {}).find(
        (each) => initialTypes[each] === pool.name
      );
      const recorded = name ? options.initial?.state?.[name] : undefined;
      if (!name || !Array.isArray(recorded)) continue;
      const nodes = recorded.map(() => {
        const node = Object.create(null) as ObjectValue;
        this.#shapes.set(node, this.#domain.structures[record] as RecordType);
        return node;
      });
      this.#shapes.set(nodes, pool);
      this.#restoring.set(record, nodes);
      this.#made.set(record, nodes);
      pools.set(name, record);
    }
    for (const [name, record] of pools) {
      const recorded = options.initial?.state?.[name] as Record<string, TraceValue>[];
      this.#restoring.get(record)!.forEach((node, index) => {
        for (const [field, item] of Object.entries(recorded[index] ?? {}))
          node[field] = this.#fromTrace(
            item,
            `${name}[${index}].${field}`,
            initialTypes,
            initialTargets
          );
      });
    }
    const initial = Object.entries(options.initial?.state ?? {});
    for (const [name, value] of initial)
      this.#topLevel.bindings.set(name, {
        value: pools.has(name)
          ? this.#made.get(pools.get(name)!)!
          : this.#fromTrace(value, name, initialTypes, initialTargets),
        constant: false,
        type: options.initial?.declared?.[name] ?? initialTypes[name],
        ...(initialTargets[name] ? { target: initialTargets[name] } : {})
      });
    this.#restoring = undefined;
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
    // Every presentation opens on the input as given, before any of the algorithm runs.
    const opening = this.#state(this.#root, this.#topLevel);
    this.#since = this.#sinceNow(this.#root, this.#topLevel);
    this.#execute();
    // The end is a step of its own, :after; a scene leaves it out where it draws what the step
    // before drew (see sceneSteps in storyboard.server.ts).
    this.#record(
      this.#root,
      this.#root,
      this.#topLevel,
      {
        before: this.#snapshotOf(this.#root, this.#topLevel),
        gap: this.#log.pending
      },
      undefined,
      { name: '@case.end', at: 'after' }
    );
    if ((this.#trace[0]?.moment ?? 0) <= 0)
      for (const step of this.#trace) step.moment = (step.moment ?? 0) + 1;
    this.opening = {
      moment: 0,
      name: '@case.start',
      edge: 'before',
      ...opening,
      before: opening,
      gap: 0,
      events: []
    };
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
    const unwrapped = unwrappedNumber(
      this.#root,
      (name) => Object.hasOwn(this.#atoms, name),
      this.#raw.text
    );
    if (unwrapped) this.#fail(unwrapped.node, unwrapped.message);
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
    recorded: [string, Binding][] = [],
    operands: readonly Placed[] = []
  ): TypedState {
    const state: TraceState = {};
    const types: TypeMap = {};
    const targets: Record<string, string> = {};
    const placed: Placed[] = [];
    const inScope = this.#inScope(scope);
    const live = this.#pools();
    for (const [name, binding] of [...inScope, ...recorded]) {
      // A pool is recorded below, under the variable that holds it, wherever a step is.
      if (this.#isPool(binding.value)) continue;
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
      } else if (binding.of && binding.value !== null && typeof binding.value === 'object') {
        // A for … of variable refers to the element it is at, as a reference does, beside being
        // a variable holding its value, so a pointer of a reference type can point at that cell.
        const element = inScope.flatMap(([collection, { value }]) => {
          const index =
            Array.isArray(value) && this.#shapes.get(value)?.name === binding.of
              ? value.indexOf(binding.value)
              : -1;
          return index >= 0 ? [`${collection}[${index}]`] : [];
        })[0];
        if (element) placed.push([name, binding.value as object, 'ref', element]);
      }
    }
    // Each pool, its nodes in the order they were added, each drawn whole; a node a field or
    // variable refers to is recorded as its place in it.
    for (const [key, nodes] of live) {
      types[key] = this.#shapes.get(nodes)!.name;
      placed.push([key, nodes, 'shared']);
      state[key] = nodes.map((each, index) => {
        this.#expanding = each;
        try {
          return this.#snapshot(each as Value, node, `${key}[${index}]`, {
            types,
            targets,
            placed
          });
        } finally {
          this.#expanding = undefined;
        }
      });
    }
    if (this.#frame !== this.#topLevel)
      for (const [path, name] of Object.entries(targets)) targets[path] = this.#shown(name, scope);
    placed.push(...operands);
    return {
      state,
      types,
      ...(Object.keys(targets).length ? { targets } : {}),
      ...(this.#kind === 'algorithm' ? { identities: this.#identities.step(placed) } : {})
    };
  }

  /** Each pool by the top-level variable holding it, as the scenes give it to layouts. */
  #pools(): Map<string, ObjectValue[]> {
    const pools = new Map<string, ObjectValue[]>();
    for (const nodes of this.#made.values()) {
      const name = this.#poolName(nodes);
      if (name) pools.set(name, nodes);
    }
    return pools;
  }

  #poolName(nodes: ObjectValue[]): string | undefined {
    for (const [name, binding] of this.#topLevel.bindings) if (binding.value === nodes) return name;
  }

  /** The first reference type to a record, which a step records a reference to its node as. */
  #refTo(record: string): string | undefined {
    return Object.values(this.#domain.structures).find(
      (structure) => structure.kind === 'ref' && structure.heap && structure.element === record
    )?.name;
  }

  /** Why a pool has no element at a place, and how its nodes are reached instead. */
  #unordered(nodes: ObjectValue[]): string {
    const pool = this.#shapes.get(nodes) as CollectionType;
    return `A ${pool.name} has no order, so it has no places to read or write: add a node with .add(${pool.element}({ … })), which gives a reference to it, and reach its nodes through references.`;
  }

  #isPool(value: Value): value is ObjectValue[] {
    return Array.isArray(value) && !!(this.#shapes.get(value) as CollectionType | undefined)?.pool;
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

  /** Log an event of the algorithm, at a node of its block. */
  #emit(
    kind: EventKind,
    node: AnyNode,
    details?: Pick<TraceEvent, 'place' | 'name' | 'index' | 'held' | 'method' | 'operands'> & {
      value?: Value;
    }
  ): void {
    if (this.#kind === 'algorithm' && !this.#inOperator)
      this.#log.add(kind, node, details?.place, details?.value, details);
  }

  /** Log a read or write, the events the algorithm logs most. */
  #access(kind: 'read' | 'write', node: AnyNode, place: string | undefined, value: Value): void {
    if (this.#kind === 'algorithm' && !this.#inOperator) this.#log.add(kind, node, place, value);
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

  /**
   * A collection's length, as a position into it where the domain declares exactly one position type
   * for its kind, as values.length is the Index just past values' last element; else a plain number.
   */
  #lengthOf(object: Value[] | string, node: MemberExpression): Value {
    const shape = Array.isArray(object) ? this.#shapes.get(object) : undefined;
    const indexes = shape
      ? Object.values(this.#atoms).filter((type) => type.index === shape.name)
      : [];
    if (indexes.length !== 1) return object.length;
    const owner = node.object;
    return new Atom(
      indexes[0],
      object.length,
      owner.type === 'Identifier' ? owner.name : undefined
    );
  }

  /**
   * A comparison's plain true or false declared into a variable takes the domain's one boolean type,
   * as const found = values[i] === target; with several, it is written in the one it means.
   */
  #asFlag(value: Value): Value {
    if (typeof value !== 'boolean') return value;
    const flags = Object.values(this.#atoms).filter((type) => type.base === 'boolean');
    return flags.length === 1 ? new Atom(flags[0], value) : value;
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
  /**
   * A new collection of a given length, every element the given value, as Values.ofLength(n, Int(0)):
   * how an algorithm makes a scratch collection, as merge sort's, which it then fills.
   */
  #ofLength(node: CallExpression, typeName: string, scope: Scope): Value {
    const structure = this.#domain.structures[typeName] as CollectionType;
    if (
      node.arguments.length !== 2 ||
      node.arguments.some((argument) => argument.type === 'SpreadElement')
    )
      this.#fail(
        node,
        `${typeName}.ofLength(…) takes a length and the value every element starts as, as ${typeName}.ofLength(n, ${structure.element}(0)).`
      );
    const [length, fill] = node.arguments.map((argument) =>
      this.#expression(argument as Expression, scope)
    );
    const count = this.#number(length, node);
    if (!Number.isInteger(count) || count < 0)
      this.#fail(node, `${typeName}.ofLength(…) takes a whole length, not ${count}.`);
    this.#checkLength(count, node);
    this.#withinMax(structure, count, node, `${typeName}.ofLength(${count}, …)`);
    this.#charge(node, count);
    return this.#convert(
      Array.from({ length: count }, () => fill),
      typeName,
      node,
      typeName
    );
  }

  #construct(node: CallExpression, typeName: string, scope: Scope): Value {
    if (this.#atoms[typeName]?.index && node.arguments.length === 2)
      return this.#position(node, this.#atoms[typeName], scope);
    const pool = this.#domain.structures[typeName];
    if (pool?.kind === 'collection' && pool.pool) return this.#newPool(node, pool);
    if (node.arguments.length !== 1 || node.arguments[0].type === 'SpreadElement')
      this.#fail(node, `${typeName}(...) takes exactly one value.`);
    let argument = this.#expression(node.arguments[0] as Expression, scope);
    const type = this.#atoms[typeName];
    // In the input, a word of a collection of characters is written as text: Word('GATTACA').
    const structure = this.#domain.structures[typeName];
    if (
      !type &&
      this.#kind === 'input' &&
      typeof argument === 'string' &&
      structure?.kind === 'collection' &&
      this.#atoms[structure.element]?.base === 'text'
    )
      argument = [...argument];
    if (!type) return this.#convert(argument, typeName, node, typeName);
    if (
      argument instanceof Atom &&
      atomBase(argument.type) !== atomBase(type) &&
      !(atomBase(argument.type) === 'integer' && atomBase(type) === 'number')
    )
      this.#fail(node, `A ${argument.type.name} cannot become a ${type.name}.`);
    if (argument !== null && typeof argument === 'object' && !(argument instanceof Atom))
      this.#fail(node, `${type.name}(...) takes one value, not ${kind(argument)}.`);
    const value = entering(type, argument instanceof Atom ? argument.value : argument);
    const problem = atomProblem(type, value);
    if (problem) this.#fail(node, problem);
    return new Atom(type, value as string | number | boolean);
  }

  /**
   * A record's one pool, empty, as const nodes = Nodes; in the input declares it: the algorithm adds its
   * nodes with nodes.add(Node({ … })).
   */
  #newPool(node: CallExpression, pool: CollectionType): ObjectValue[] {
    if (node.arguments.length)
      this.#fail(
        node,
        `${pool.name}() takes nothing: a pool starts empty, and nodes.add(${pool.element}({ … })) adds a node to it.`
      );
    if (this.#kind !== 'input')
      this.#fail(
        node,
        `Declare the ${pool.name} in the input, as const nodes = ${pool.name};, so every step draws it.`
      );
    if (this.#made.has(pool.element))
      this.#fail(
        node,
        `There is one ${pool.name}, ${this.#poolName(this.#made.get(pool.element)!) ?? 'made already'}: a record has one pool.`
      );
    const nodes: ObjectValue[] = [];
    this.#shapes.set(nodes, pool);
    this.#made.set(pool.element, nodes);
    return nodes;
  }

  /** nodes.add(Node({ … })): adds a node to its pool, at most the pool's max, and gives it. */
  #add(node: CallExpression, nodes: ObjectValue[], pool: CollectionType, args: Value[]): Value {
    if (args.length !== 1)
      this.#fail(node, `.add(…) takes one ${pool.element}, as in .add(${pool.element}({ … })).`);
    const record = this.#domain.structures[pool.element] as RecordType;
    const added = this.#asRecord(args[0], record, node.arguments[0] ?? node, `An added node`);
    if (nodes.includes(added)) return added;
    this.#withinMax(pool, nodes.length + 1, node, `another .add(…)`);
    nodes.push(added);
    const place = this.#places.get(nodes);
    if (place !== undefined) this.#emit('write', node, { place, method: 'push' });
    return added;
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
    if (ref.heap) {
      const record = this.#domain.structures[ref.element] as RecordType;
      return this.#inPool(this.#asRecord(value, record, node, `A ${ref.name}`), ref, node);
    }
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

  /** A reference to a node refers to one its pool holds, which the algorithm added to it. */
  #inPool(value: ObjectValue, ref: RefType, node: AnyNode): ObjectValue {
    if (this.#made.get(ref.element)?.includes(value)) return value;
    const pool = this.#made.get(ref.element);
    const name = (pool && this.#poolName(pool)) ?? 'nodes';
    return this.#fail(
      node,
      `A ${ref.name} refers to a ${ref.element} in its pool, ${ref.collection}: add the ${ref.element} to the pool first, which gives the reference, as ${name}.add(${ref.element}({ … })).`
    );
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
    const entered = entering(type, value);
    const problem = atomProblem(type, entered);
    if (problem) this.#fail(node, `${path}: ${problem}`);
    return new Atom(type, entered as string | number | boolean);
  }

  /** A typed value keeps its own member type; a literal becomes the one member it fits. */
  #asMember(value: Value, union: UnionType, node: AnyNode, path: string): Value {
    const members = union.members.join(' or ');
    const shape = value !== null && typeof value === 'object' ? this.#shapes.get(value) : undefined;
    if (value instanceof Atom || shape) {
      const fits = union.members.some((member) => {
        if (value instanceof Atom)
          return !!this.#atoms[member] && refines(value.type, this.#atoms[member], this.#atoms);
        const ref = this.#domain.structures[member];
        return (
          shape?.name === member ||
          (ref?.kind === 'ref' && !!ref.heap && shape?.name === ref.element)
        );
      });
      const ref = union.members
        .map((member) => this.#domain.structures[member])
        .find(
          (each): each is RefType =>
            each?.kind === 'ref' && !!each.heap && shape?.name === each.element
        );
      if (fits && ref) return this.#inPool(value as ObjectValue, ref, node);
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
    let structure = this.#domain.structures[typeName];
    if (structure.kind === 'collection') return Array.isArray(value);
    if (structure.kind === 'ref' && structure.heap)
      structure = this.#domain.structures[structure.element];
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
    this.#withinMax(
      collection,
      value.length,
      node,
      path === collection.name ? `${path}([…])` : path
    );
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
      `${path} would have no value: it was taken from an empty array, or past its end. There is no null: ${typeName ? `a ${typeName} is needed here; ` : ''}for "nothing yet", use a value of a type that says so, such as Index(-1), or Unreached('unreached') in a union.`
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
        `${plain.path} would be a plain ${Array.isArray(plain.value) ? 'array' : 'object'}, but input and algorithm values must have a domain type. Make it with an array or record type defined in the domain block, as in Queue([...]) with const Queue = array(Vertex, { max: 8 });, or Edge({ ... }) with const Edge = record({ from: Vertex, to: Vertex });.`
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
        : ' Math and division give plain numbers; write the type around them, as Index(Math.floor(x)).';
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
    return this.#statements(statements, 0, statements.length, scope);
  }

  /**
   * Statements `from` up to `to`, statements in a row marked together each one run, the labels
   * inside it included; `begun` rows starting at the first are already running, outermost first.
   */
  #statements(
    statements: readonly Statement[],
    from: number,
    to: number,
    scope: Scope,
    begun = 0
  ): Completion {
    for (let index = from; index < to; index++) {
      const statement = statements[index];
      const open = index === from ? begun : 0;
      const row = this.#units.ranges.get(statement)?.[open];
      if (!row) {
        const completion = this.#statement(statement, scope);
        if (completion !== 'normal') return completion;
        continue;
      }
      const end = statements.indexOf(row.last as Statement) + 1;
      this.#begin(row, scope);
      const completion = this.#statements(statements, index, end, scope, open + 1);
      this.#end(row.last, scope);
      if (completion !== 'normal') return completion;
      index = end - 1;
    }
    return 'normal';
  }

  /** A statement, as a label run where a label marks it (a loop's runs are its passes). */
  #statement(node: Statement, scope: Scope): Completion {
    if (!this.#units.nodes.has(node) || isLoop(node)) return this.#run(node, scope);
    this.#begin(node, scope);
    const completion = this.#run(node, scope);
    this.#end(node, scope);
    return completion;
  }

  #run(node: Statement, scope: Scope): Completion {
    this.#charge(node);
    switch (node.type) {
      case 'BlockStatement':
        return this.#block(node.body, new Scope(scope));
      case 'EmptyStatement':
        return 'normal';
      case 'ExpressionStatement':
        this.#expression(node.expression, scope);
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
          const value = this.#asFlag(this.#expression(declarator.init, scope));
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
      case 'DoWhileStatement':
        // The body first, then the test before each pass after it.
        return this.#loop(node, (index) =>
          index > 0 && !this.#test(node.test, scope) ? 'break' : this.#pass(node, index, scope)
        );
      case 'ForStatement': {
        const loopScope = new Scope(scope);
        if (node.init?.type === 'VariableDeclaration') this.#statement(node.init, loopScope);
        else if (node.init) this.#expression(node.init, loopScope);
        return this.#loop(node, (index) => {
          if (index > 0 && node.update) {
            this.#expression(node.update, loopScope);
            this.#charge(node);
          }
          if (node.test && !this.#test(node.test, loopScope)) return 'break';
          return this.#pass(node, index, loopScope);
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
            ...(element ? { type: element } : {}),
            ...(this.#shapes.get(items) ? { of: this.#shapes.get(items)!.name } : {})
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

  /** A condition, logged with whether it held, inside its label's run where it has one. */
  #test(node: Expression, scope: Scope): boolean {
    const labelled = this.#units.nodes.has(node);
    if (labelled) this.#begin(node, scope);
    const value = this.#evaluate(node, scope);
    this.#capture(node, value);
    const held = this.#truthy(value);
    this.#emit('test', node, { held });
    if (labelled) this.#end(node, scope);
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
    // A labelled loop's runs are its passes.
    const stepping = this.#units.nodes.has(node);
    if (stepping) this.#begin(node, scope);
    const completion = this.#statement(node.body, scope);
    if (stepping) this.#end(node, scope);
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

  /** The state at a moment, as a step records it before its code. */
  #snapshotOf(node: AnyNode, scope: Scope): StepSnapshot {
    const { state, types, targets, identities } = this.#state(node, scope);
    return { state, types, ...(targets ? { targets } : {}), ...(identities ? { identities } : {}) };
  }

  /** Start a run of labelled code; where its label is paused at, the state before it. */
  #begin(unit: Unit, scope: Scope): void {
    const number = this.#runCount++;
    const node = 'type' in unit ? unit : unit.first;
    const label = this.#named.get(unit);
    const step = label !== undefined && this.#pauses.has(label);
    const ordinal = (this.#begun.get(label ?? '') ?? 0) + 1;
    if (label !== undefined) this.#begun.set(label, ordinal);
    const started = ++this.#stops;
    // Its :before, where the scene is within its runs or pauses there.
    const edge = this.#isEdge(label, ordinal);
    if (label !== undefined && (edge || this.#pauses.has(beforeStop(label))))
      this.#record(node, node, scope, this.#since ?? this.#sinceNow(node, scope), undefined, {
        name: `@${label}#${ordinal}.start`,
        ...(edge ? { at: 'before' as const } : {})
      });
    this.#runs.push({
      unit,
      node,
      number,
      ordinal,
      scope,
      start: this.#log.seen,
      started,
      ...(label !== undefined && this.#recording.has(label)
        ? { before: this.#snapshotOf(node, scope) }
        : {}),
      ...(step
        ? {
            since: {
              before: this.#snapshotOf(node, scope),
              gap: this.#log.pending
            }
          }
        : {})
    });
  }

  /** End a run of labelled code, recording a step where its label is paused at. */
  #end(node: AnyNode, scope: Scope): void {
    const ending = this.#runs.at(-1);
    this.#stops += 1;
    if (ending) this.#keepRecord(ending, node, scope);
    const run = this.#runs.pop();
    if (!run) return;
    const edge = this.#isEdge(this.#named.get(run.unit), run.ordinal)
      ? { name: this.#nameOf(run), at: 'after' as const }
      : undefined;
    const since = run.since ?? (edge && (this.#since ?? this.#sinceNow(node, scope)));
    if (since) this.#record(run.node, node, scope, since, run, edge);
    // A value no longer inside a run of the label around it is never kept again.
    this.#labelGiven = this.#labelGiven.filter(({ around }) => this.#runs.includes(around));
  }

  /**
   * Keep the record of a span ending, where its label's spans are kept or it is a call: the
   * variables in scope now, at its :after, and the call it is in. A block or statement label a view
   * is typed by also draws it, as an application made at this step.
   */
  #keepRecord(run: Run, node: AnyNode, scope: Scope): void {
    const label = this.#named.get(run.unit);
    const isCall = (each: Run) => 'type' in each.unit && this.#functionBodies.has(each.unit);
    if (label === undefined || (!isCall(run) && !this.#recording.has(label))) return;
    const calls = this.#runs.filter((each) => isCall(each) && this.#named.has(each.unit));
    const id = (each: Run) => `${this.#named.get(each.unit)}#${each.ordinal}`;
    const inner = calls.at(-1);
    const parent = calls.at(-2);
    const kept = this.#recording.has(label);
    const after = kept ? this.#snapshotOf(node, scope) : undefined;
    // A call's record holds what it returned as result, once it has.
    if (after && isCall(run) && this.#returned !== undefined) {
      const targets = (after.targets ??= {});
      after.state.result = this.#snapshot(this.#returned, node, 'result', {
        types: after.types,
        targets,
        placed: []
      });
    }
    this.records.push({
      label,
      ordinal: run.ordinal,
      started: run.started,
      ended: this.#stops,
      ...(inner ? { call: id(inner) } : {}),
      ...(parent ? { parent: id(parent) } : {}),
      depth: Math.max(calls.length - 1, 0),
      ...(run.before ? { before: run.before } : {}),
      ...(after ? { after } : {})
    });
    if (after && this.#drawnRecords.has(label) && !this.#applyingLabel(label))
      this.#pendingApplied.push([
        labelApplication(label),
        {
          state: after.state,
          types: after.types,
          ...(after.targets ? { targets: after.targets } : {}),
          at: this.#offset(node).start
        }
      ]);
  }

  /** Whether a label marks an expression whose operands and result are kept as its application. */
  #applyingLabel(label: string): boolean {
    for (const names of this.#applying.values()) if (names.includes(label)) return true;
    return false;
  }

  /** Whether a run of a label is one the scene is within, which opens and closes on a step. */
  #isEdge(label: string | undefined, ordinal: number): boolean {
    const edges = this.#pacing.edges;
    return (
      edges !== undefined &&
      label === edges.label &&
      (edges.run === undefined || edges.run === ordinal)
    );
  }

  /** The state now, as the code before a step leads up from it. */
  #sinceNow(node: AnyNode, scope: Scope): Since {
    return { before: this.#snapshotOf(node, scope), gap: this.#log.pending };
  }

  /** A step's name, ending a run: its label and which run of it this is, counted as runs begin. */
  #nameOf(run: Run): string {
    return `@${this.#named.get(run.unit)}#${run.ordinal}.end`;
  }

  /** The label on a run's code, as a list, empty where none is. */
  #labelsOf(run: Run): string[] {
    const label = this.#named.get(run.unit);
    return label === undefined ? [] : [label];
  }

  /** Why a scene shows too many steps: the labels most of them end at, to pause at less. */
  #tooManySteps(): string {
    const most = [...this.#stepsAt]
      .filter(([label]) => label !== '@case.end')
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);
    const counts = most.map(([label, count]) => `@${label} (${count})`).join(', ');
    const off = most.length ? `, leaving @${most[0][0]} out of the scene's pause` : '';
    return `A scene shows more than ${algorithmLimits.maximumSteps} steps, most at the end of ${counts || 'its labels'}; stop pausing at some of them${off}, pause at the labels around them instead, or give a smaller input.`;
  }

  /**
   * Record a step whose code has just run: the state after it, and the events since the last. Its
   * applications and labelled values are all those made since the step before; those given at
   * earlier steps inside the run it ends are held, as it shows its own run whole, and it lights
   * that run's code. The runs going on start their code again after it.
   */
  #record(
    unit: AnyNode,
    node: AnyNode,
    scope: Scope,
    since: Since,
    ending?: Run,
    stop?: { name: string; at?: Stop }
  ): void {
    // A scene's own pauses bound what it shows; pausing at every label only names the steps.
    if (!this.#pacing.pauses && this.#trace.length >= algorithmLimits.maximumSourceSteps)
      this.#fail(
        unit,
        `The algorithm's labels end more than ${algorithmLimits.maximumSourceSteps} times; give a smaller input, or label less of the code.`
      );
    if (this.#pacing.pauses && this.#trace.length >= algorithmLimits.maximumSteps)
      this.#fail(unit, this.#tooManySteps());
    const trail: Stretch[] = ending ? [[ending.start, this.#log.seen, this.#labelsOf(ending)]] : [];
    const held: Record<string, LabelRun[]> = {};
    for (const given of this.#labelGiven) {
      const going = given.around === ending || this.#runs.includes(given.around);
      if (given.recorded && going && ending && given.inside.includes(ending))
        (held[given.name] ??= []).push(given.run);
      given.recorded = true;
    }
    const byName = <T>(entries: readonly [string, T][]) => {
      const grouped: Record<string, T[]> = {};
      for (const [name, item] of entries) (grouped[name] ??= []).push(item);
      return grouped;
    };
    this.#applied = byName(this.#pendingApplied);
    this.#labelled = byName(this.#pendingLabelled);
    const around = [...this.#runs, ...(ending ? [ending] : [])];
    const inside = [...new Set(around.flatMap((run) => this.#labelsOf(run)))];
    const runs = around.flatMap((run) =>
      this.#labelsOf(run).map((label) => `${label}#${run.ordinal}`)
    );
    const after = this.#state(node, scope, [], this.#operandPlaces(scope));
    this.#nameOperands(after.identities?.ids);
    const logged = this.#log.step(this.#offset, (value) => {
      const single = unwrap(value as Value);
      return typeof single === 'number' || typeof single === 'string' || typeof single === 'boolean'
        ? single
        : undefined;
    });
    const name = stop?.name ?? (ending ? this.#nameOf(ending) : '@case.end');
    const label = labelOfStep(name);
    this.#stepsAt.set(label, (this.#stepsAt.get(label) ?? 0) + 1);
    this.#trace.push({
      // Strictly later than the step before, though no event came between them.
      moment: Math.max(this.#log.seen, (this.#trace.at(-1)?.moment ?? -1) + 1),
      before: since.before,
      gap: Math.max(since.gap - (logged.dropped ?? 0), 0),
      ...(unit === this.#root ? {} : { unit: this.#offset(unit) }),
      name,
      ...(stop?.at ? { edge: stop.at } : {}),
      stop: this.#stops,
      ...(inside.length ? { inside, runs } : {}),
      ...after,
      ...logged,
      ...(Object.keys(this.#applied).length ? { applied: this.#applied } : {}),
      ...(Object.keys(this.#labelled).length ? { labelled: this.#labelled } : {}),
      ...(Object.keys(held).length ? { held } : {}),
      seen: this.#log.seen,
      trail
    });
    this.#applied = {};
    this.#labelled = {};
    this.#pendingApplied = [];
    this.#pendingLabelled = [];
    const { state, types, targets, identities } = after;
    const again: Since = {
      before: {
        state,
        types,
        ...(targets ? { targets } : {}),
        ...(identities ? { identities } : {})
      },
      gap: this.#log.pending
    };
    for (const run of this.#runs) if (run.since) run.since = again;
    this.#since = again;
  }

  /**
   * The step's applications' operands and results as copies (see Placed), each by a path no
   * variable can have, named back on its application once the step's ids are made. An operand read
   * through a variable is a copy of that variable's value, or of the cell a for … of variable is at.
   */
  #operandPlaces(scope: Scope): Placed[] {
    const inScope = this.#inScope(scope);
    const bindings = new Map(inScope);
    const cellOf = (binding: Binding) =>
      inScope.flatMap(([collection, { value }]) => {
        const index =
          Array.isArray(value) && this.#shapes.get(value)?.name === binding.of
            ? value.indexOf(binding.value)
            : -1;
        return index >= 0 ? [`${collection}[${index}]`] : [];
      })[0];
    return Object.entries(this.#applied).flatMap(([name, applications]) =>
      applications.flatMap((application, at) =>
        (this.#operands.get(application) ?? []).map(({ path, value, from }): Placed => {
          const binding = from === undefined ? undefined : bindings.get(from);
          const element = binding?.of ? cellOf(binding) : binding ? from : undefined;
          return [operandPath(name, at, path), value, 'copy', element];
        })
      )
    );
  }

  /** Name each application's operand copies by their paths, out of the step's own ids. */
  #nameOperands(ids: Record<string, number> | undefined): void {
    if (!ids) return;
    for (const [name, applications] of Object.entries(this.#applied))
      applications.forEach((application, at) => {
        for (const { path } of this.#operands.get(application) ?? []) {
          const key = operandPath(name, at, path);
          if (ids[key] === undefined) continue;
          (application.identities ??= {})[path] = ids[key];
          delete ids[key];
        }
      });
  }

  /**
   * Keep the value a labelled expression gave, for the next step, its own or leading up to it, and
   * for the step ending the run of the label around it.
   */
  #capture(node: AnyNode, value: Value): void {
    for (const name of this.#applying.get(node) ?? []) this.#applyLabel(name, node, value);
    const names = this.#captured.get(node);
    if (!names) return;
    for (const name of names) {
      const run: LabelRun = { state: { value: null }, types: {}, targets: {} };
      run.state.value = this.#snapshot(value, node, 'value', {
        types: run.types,
        targets: run.targets,
        placed: []
      });
      this.#pendingLabelled.push([name, run]);
      const parent = this.#holding.get(name);
      const around = parent && this.#runs.findLast((each) => each.unit === parent);
      if (around)
        this.#labelGiven.push({ name, run, around, inside: [...this.#runs], recorded: false });
    }
  }

  /**
   * Keep what a labelled expression computed, for a view typed by its label: its operands by name
   * (left and right of a comparison, arithmetic, or && and ||, argument of ! or -, a function's
   * parameters) and its result as value, copied as an operator's application was, named by the label.
   */
  #applyLabel(name: string, node: AnyNode, value: Value): void {
    const application: Application = { state: {}, types: {}, at: this.#offset(node).start };
    const into = { types: application.types, targets: {} as Record<string, string>, placed: [] };
    const operands = this.#operandsOf.get(node) ?? [];
    for (const [parameter, operand] of operands)
      application.state[parameter] = this.#snapshot(operand, node, parameter, into);
    application.state.value = this.#snapshot(value, node, 'value', into);
    if (Object.keys(into.targets).length) application.targets = into.targets;
    this.#pendingApplied.push([labelApplication(name), application]);
    this.#operands.set(application, [
      ...operands.flatMap(([path, operand]) =>
        operand instanceof Atom ? [{ path, value: operand }] : []
      ),
      ...(value instanceof Atom ? [{ path: 'value', value }] : [])
    ]);
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
      this.#fail(node, tooLargeMessage(this.#trace.length));
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
    // A node is drawn in its pool; anywhere else, as a reference, it is its place there.
    const pool = shape?.kind === 'record' ? this.#made.get(shape.name) : undefined;
    if (pool && value !== this.#expanding) {
      const ref = this.#refTo(shape!.name);
      if (ref) types[path] = ref;
      const name = this.#poolName(pool);
      if (name) targets[path] = name;
      const index = pool.indexOf(value as ObjectValue);
      return index >= 0 ? index : null;
    }
    // Only the pool's element itself is drawn whole; a field referring back to it is a reference.
    if (value === this.#expanding) this.#expanding = undefined;
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

  /** An expression, as a step of its own where the label steps are by marks it. */
  #expression(node: Expression | SpreadElement, scope: Scope): Value {
    if (!this.#units.nodes.has(node)) {
      const value = this.#evaluate(node, scope);
      this.#capture(node, value);
      return value;
    }
    this.#begin(node, scope);
    const value = this.#evaluate(node, scope);
    this.#capture(node, value);
    this.#end(node, scope);
    return value;
  }

  #evaluate(node: Expression | SpreadElement, scope: Scope): Value {
    this.#charge(node);
    switch (node.type) {
      case 'Literal':
        return node.value as Value;
      case 'Identifier': {
        const binding = scope.lookup(node.name);
        if (!binding)
          this.#fail(
            node,
            hostNames.has(node.name)
              ? `"${node.name}" is not defined.`
              : `"${node.name}" is not defined: the algorithm uses it, and neither it nor the input declares it; declare it, as let ${node.name} = …, before it is used.`
          );
        if (binding.value === mathMarker) this.#rawCheck(node, []);
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
        this.#rawCheck(node, []);
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
            if (!this.#inOperator)
              this.#fail(
                element,
                `${this.#raw.text(element)} copies every element in one step, which nothing can show or count; add elements one at a time, as c.push(x), or copy in a labelled loop.`
              );
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
      case 'MemberExpression': {
        const object = this.#expression(node.object as Expression, scope);
        if (rawOperation(node)) this.#rawCheck(node, [object]);
        return this.#read(object, node, scope);
      }
      case 'CallExpression':
        return this.#call(node, scope);
      case 'UnaryExpression': {
        const value = this.#expression(node.argument, scope);
        if (rawOperation(node)) this.#rawCheck(node, [value]);
        if (this.#applying.has(node)) this.#operandsOf.set(node, [['argument', value]]);
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
      case 'BinaryExpression': {
        const left = this.#expression(node.left as Expression, scope);
        const right = this.#expression(node.right, scope);
        this.#rawCheck(node, [left, right]);
        if (this.#applying.has(node))
          this.#operandsOf.set(node, [
            ['left', left],
            ['right', right]
          ]);
        return this.#binary(node.operator, left, right, node);
      }
      case 'LogicalExpression': {
        const left = this.#expression(node.left, scope);
        if (this.#applying.has(node)) {
          const decided =
            node.operator === '&&'
              ? !this.#truthy(left)
              : node.operator === '||'
                ? this.#truthy(left)
                : left !== null && left !== undefined;
          const right = decided ? undefined : this.#expression(node.right, scope);
          this.#operandsOf.set(
            node,
            decided
              ? [['left', left]]
              : [
                  ['left', left],
                  ['right', right as Value]
                ]
          );
          return decided ? left : (right as Value);
        }
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
        if (node.operator !== '=') this.#rawCheck(node, [target.get(), right], target.type);
        if (node.operator !== '=') this.#access('read', node.left, target.place, target.get());
        const value = target.prepare(
          node.operator === '='
            ? right
            : this.#binary(node.operator.slice(0, -1), target.get(), right, node)
        );
        this.#typed(value, node.right, targetName(node.left as Expression));
        this.#store(target, value, node);
        const stored = target.get();
        this.#access('write', node, target.place, stored);
        return stored;
      }
      case 'UpdateExpression': {
        const target = this.#reference(node.argument, scope);
        const current = target.get();
        this.#rawCheck(node, [current]);
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
    type?: string;
  } {
    if (target.type === 'Identifier') {
      const binding = scope.lookup(target.name);
      if (!binding || binding === this.#globals.bindings.get(target.name))
        this.#fail(target, `"${target.name}" must be declared with let before it is assigned.`);
      if (binding.constant)
        this.#fail(target, `"${target.name}" is a constant; declare it with let to change it.`);
      if (this.#isPool(binding.value)) this.#fail(target, this.#unordered(binding.value));
      return {
        type: binding.type,
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
    const object = this.#expression(target.object as Expression, scope);
    const key = this.#key(target, scope);
    const place = this.#within(object, key as string | number);
    const slot =
      object !== null && typeof object === 'object' && !(object instanceof Atom)
        ? this.#slotType(object, key as string | number, target)
        : undefined;
    const prepare = (value: Value) =>
      slot ? this.#convert(value, slot, target, targetName(target)) : value;
    if (this.#isPool(object)) this.#fail(target, this.#unordered(object));
    if (Array.isArray(object)) {
      const type = slot;
      if (typeof key !== 'number' || !Number.isInteger(key))
        this.#fail(target, 'Array elements are assigned by whole-number index.');
      // Writing at the length adds an element; any further would leave a gap with no value.
      if (key < 0 || key > object.length)
        this.#fail(
          target,
          `${targetName(target)} is outside the array: it has ${object.length} element${object.length === 1 ? '' : 's'}, so write at 0 to ${object.length}, where ${object.length} adds one.`
        );
      return {
        type,
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
    if (object instanceof Atom && typeof key === 'string')
      this.#fail(target, this.#noField(object, target, key));
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
      type: slot,
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
    const key = this.#key(node, scope) as string | number;
    // A field read through a value that is no record, as the end of a list, is a mistake.
    if (target instanceof Atom && typeof key === 'string' && key !== 'length')
      this.#fail(node, this.#noField(target, node, key));
    // Typed text reads like text; other atoms have no properties.
    const object = target instanceof Atom && target.type.base === 'text' ? target.value : target;
    if (object instanceof Atom)
      this.#fail(node, `A ${object.type.name} value has no "${String(key)}".`);
    if (object === mathMarker) {
      if (typeof key === 'string' && key in mathConstants)
        return this.#readAt(mathConstants[key], object, key);
      return this.#fail(node, `Math.${String(key)} can only be called, or does not exist.`);
    }
    if (Array.isArray(object) || typeof object === 'string') {
      if (key === 'length') return this.#readAt(this.#lengthOf(object, node), object, key);
      if (this.#isPool(object)) this.#fail(node, this.#unordered(object));
      if (typeof key === 'number' && Number.isInteger(key) && Array.isArray(object)) {
        if (key >= 0 && key < object.length) return this.#readAt(object[key], object, key);
        return this.#fail(
          node,
          `${targetName(node)} is outside the array: it has ${object.length} element${object.length === 1 ? '' : 's'}${object.length ? `, at 0 to ${object.length - 1}` : ''}.`
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

  /** Why a field cannot be read or written through a value that is no record, as the end. */
  #noField(value: Atom, node: MemberExpression, key: string): string {
    const holder = this.#raw.text(node.object);
    const article = /^[AEIOU]/u.test(value.type.name) ? 'an' : 'a';
    return `${holder} is ${article} ${value.type.name} (${JSON.stringify(value.value)}), so it has no ${key}.`;
  }

  #readAt(value: Value, object: Value, key: string | number): Value {
    this.#readFrom = object;
    this.#readKey = key;
    return value;
  }

  #call(node: CallExpression, scope: Scope): Value {
    const callee = node.callee;
    const declared = callee.type === 'Identifier' ? this.#functions.get(callee.name) : undefined;
    if (declared) return this.#invoke(node, declared, scope);
    if (
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      callee.object.type === 'Identifier' &&
      this.#domain.structures[callee.object.name]?.kind === 'collection' &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'ofLength'
    )
      return this.#ofLength(node, callee.object.name, scope);
    if (
      callee.type === 'Identifier' &&
      (Object.hasOwn(this.#atoms, callee.name) ||
        Object.hasOwn(this.#domain.structures, callee.name))
    )
      return this.#construct(node, callee.name, scope);
    if (callee.type !== 'MemberExpression' || callee.computed || node.optional)
      this.#fail(
        node,
        'Only the algorithm’s functions, the domain’s types, Math, and push, pop, shift and unshift on an array can be called.'
      );
    const object = this.#expression(callee.object as Expression, scope);
    const name = (callee.property as { name: string }).name;
    let args = node.arguments.map((argument) => {
      if (argument.type === 'SpreadElement')
        this.#fail(argument, 'Spread arguments are not supported.');
      return this.#expression(argument, scope);
    });
    this.#rawCheck(node, [object, ...args]);
    if (object === mathMarker) {
      const fn = mathFunctions[name];
      if (!fn) this.#fail(callee, `Math.${name} is not available.`);
      return fn(...args.map((argument) => this.#number(argument, node)));
    }
    if (!Array.isArray(object)) this.#fail(callee, `.${name}() is only available on arrays.`);
    const collection = this.#shapes.get(object) as CollectionType | undefined;
    if (collection?.pool) {
      if (name !== 'add')
        this.#fail(
          callee,
          `A pool has no order, so it has no .${name}(): add a node with .add(${collection.element}({ … })), and reach its nodes through references.`
        );
      return this.#add(node, object as ObjectValue[], collection, args);
    }
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
        this.#withinMax(
          collection,
          object.length + args.length,
          node,
          targetName(callee.object as Expression)
        );
        return object.push(...args);
      case 'pop':
        return object.pop();
      case 'shift':
        return object.shift();
      case 'unshift':
        this.#checkLength(object.length + args.length, node);
        this.#withinMax(
          collection,
          object.length + args.length,
          node,
          targetName(callee.object as Expression)
        );
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
   * The operations the input and algorithm may not write, as each hides a loop or a step the view
   * cannot show: a search or a whole-collection method, a template string or text joined with +,
   * and === between two collections, which compares their identities rather than their elements.
   */
  #rawCheck(node: AnyNode, operands: Value[], _placeType?: string): void {
    if (this.#inOperator) return;
    const operation = rawOperation(node);
    if (!operation) return;
    const problem = hiddenProblem(node, operation, operands, this.#raw.text);
    if (problem) this.#fail(node, problem);
  }

  /**
   * Write a value into a place. A collection or record an operator computed is written into the one
   * the place holds, its elements or fields replaced in place, so it and the elements the new value
   * carries over keep their identities; any other value, as another row of a grid, is the place's
   * new value itself.
   */
  #store(target: { get(): Value; set(value: Value): void }, value: Value, node: AnyNode): void {
    const old = target.get();
    const fresh = value !== null && typeof value === 'object' && this.#computed.has(value);
    if (fresh && Array.isArray(old) && Array.isArray(value)) {
      this.#checkLength(value.length, node);
      old.splice(0, old.length, ...value);
    } else if (fresh && isPlainObject(old) && isPlainObject(value) && !this.#isNode(old)) {
      for (const field of Object.keys(old)) old[field] = value[field];
    } else target.set(value);
  }

  /** Whether a value is a node, which a reference refers to and so is never written over. */
  #isNode(value: Value): boolean {
    const shape = value !== null && typeof value === 'object' ? this.#shapes.get(value) : undefined;
    return shape?.kind === 'record' && this.#heaps.has(shape.name);
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
      if (this.#applying.has(node))
        this.#operandsOf.set(node, [
          ...(index ? (this.#operandsOf.get(node) ?? []) : []),
          [parameter, value]
        ]);
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
    this.#callers.push(scope);
    this.#returned = undefined;
    try {
      const stepping = this.#units.nodes.has(declared.body);
      this.#functionBodies.add(declared.body);
      if (stepping) this.#begin(declared.body, frame);
      const completion = this.#block(declared.body.body, frame);
      if (stepping) this.#end(declared.body, frame);
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
      this.#callers.pop();
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
        // Values of a text enumeration compare in the order it lists them, as 'low' < 'high'.
        const listed =
          bothStrings && left instanceof Atom && left.type.values ? left.type.values : undefined;
        const a = listed
          ? listed.indexOf(plainLeft as string)
          : bothStrings
            ? plainLeft
            : this.#number(left, node);
        const b = listed
          ? listed.indexOf(plainRight as string)
          : bothStrings
            ? plainRight
            : this.#number(right, node);
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
    const ref = typeName ? this.#domain.structures[typeName] : undefined;
    if (ref?.kind === 'ref' && ref.heap && typeof value === 'number')
      return this.#restoring?.get(ref.element)?.[value] ?? null;
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

  /** A collection may hold at most its type's max elements, as a number may not pass its type's. */
  #withinMax(
    collection: CollectionType | undefined,
    length: number,
    node: AnyNode,
    what: string
  ): void {
    if (collection?.max !== undefined && length > collection.max)
      this.#fail(
        node,
        `${collection.name} holds at most ${collection.max} elements, and ${what} would hold ${length}: give ${collection.name} a larger max, as ${collection.pool ? 'pool' : 'array'}(${collection.element}, { max: ${length} }).`
      );
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

function isLoop(node: AnyNode): boolean {
  return ['ForStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'].includes(
    node.type
  );
}

/** The path an application's operand copy has among a step's places, which no variable can have. */
function operandPath(operator: string, at: number, path: string): string {
  return `ȧ${operator}#${at}.${path}`;
}
