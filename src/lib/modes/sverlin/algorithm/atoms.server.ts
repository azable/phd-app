/** Atomic domain types, all defined by the domain block from primitive kinds, refinements, and enumerations. */

/** The primitive kind every atomic type ultimately stores. */
export type AtomBase = 'integer' | 'number' | 'boolean' | 'text';

export const atomBases: readonly AtomBase[] = ['integer', 'number', 'boolean', 'text'];

/** One atomic type; refinements name the type they refine as their parent. */
export type AtomType = {
  name: string;
  base: AtomBase;
  parent?: string;
  /** Shown after the value, such as "cm". */
  unit?: string;
  min?: number;
  max?: number;
  /** The only values an enumeration allows. */
  values?: readonly (string | number)[];
  /**
   * For a position, the collection type it points into: its values run from -1 to the length of
   * the collection a variable is bound to, and only 0 to length - 1 point at an element.
   */
  index?: string;
};

/** Every atomic type available to a component, by name. */
export type AtomRegistry = Readonly<Record<string, AtomType>>;

/** No types are predefined; a component without a domain block has none. */
export const noAtoms: AtomRegistry = {};

/** A typed primitive inside the interpreter; it travels with its value through the algorithm. */
export class Atom {
  constructor(
    readonly type: AtomType,
    readonly value: string | number | boolean
  ) {}
}

/** Why a value cannot belong to a type, or undefined when it can. */
export function atomProblem(type: AtomType, value: unknown): string | undefined {
  const shown = typeof value === 'string' ? JSON.stringify(value) : String(value);
  if (type.values && !type.values.includes(value as string | number))
    return `${shown} is not a ${type.name}; allowed values are ${type.values.map((item) => JSON.stringify(item)).join(', ')}.`;
  switch (type.base) {
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value))
        return `${type.name} values must be whole numbers, not ${shown}.`;
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value))
        return `${type.name} values must be finite numbers, not ${shown}.`;
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return `${type.name} values must be true or false.`;
      break;
    case 'text':
      if (typeof value !== 'string') return `${type.name} values must be text, not ${shown}.`;
      break;
  }
  if (type.min !== undefined && (value as number) < type.min)
    return `${type.name} values must be at least ${type.min}, not ${shown}.`;
  if (type.max !== undefined && (value as number) > type.max)
    return `${type.name} values must be at most ${type.max}, not ${shown}.`;
  return undefined;
}

/** Whether `type` is `ancestor` or refines it, directly or indirectly. */
export function refines(type: AtomType, ancestor: AtomType, atoms: AtomRegistry): boolean {
  for (let current: AtomType | undefined = type; current; ) {
    if (current.name === ancestor.name) return true;
    current = current.parent ? atoms[current.parent] : undefined;
  }
  return false;
}

/**
 * The type of a result combining two operands. An untyped operand adopts the other's type, and
 * related types give the more specific one; unrelated types cannot be combined.
 */
export function combinedType(
  left: AtomType | undefined,
  right: AtomType | undefined,
  atoms: AtomRegistry
): AtomType | undefined {
  if (!left || !right) return left ?? right;
  if (refines(left, right, atoms)) return left;
  if (refines(right, left, atoms)) return right;
  throw new Error(`${left.name} and ${right.name} cannot be combined.`);
}

/**
 * Wrap a computed number in a numeric type. A result that is no longer whole leaves an integer
 * type and stays untyped; a result outside the type's range is an error.
 */
export function numericResult(type: AtomType | undefined, value: number): Atom | number {
  if (!type) return value;
  if (type.base === 'integer' && !Number.isInteger(value)) return value;
  const problem = atomProblem(type, value);
  if (problem) throw new Error(problem);
  return new Atom(type, value);
}
