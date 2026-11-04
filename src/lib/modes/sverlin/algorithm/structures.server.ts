/**
 * Domain types built from other types: a union holds a value of one of its members, a record has
 * named fields of given types, and an array or a pool holds elements of one type. With the atomic
 * types they make up a component's domain; every input and algorithm value belongs to one of them.
 */

import type { Expression } from 'acorn';

import { noAtoms, type AtomRegistry } from './atoms.server';

export type UnionType = { kind: 'union'; name: string; members: readonly string[] };
export type RecordType = { kind: 'record'; name: string; fields: Readonly<Record<string, string>> };
/**
 * A collection of one element type: an array, its elements in order at positions, holding at most
 * `max`, as array(Int, { max: 8 }); or a pool (`pool`), pool(Node, { max: 6 }): the nodes of a
 * record type, unordered, reached only by reference, which the algorithm adds to it.
 */
export type CollectionType = {
  kind: 'collection';
  name: string;
  element: string;
  max?: number;
  pool?: true;
};
/**
 * A reference to an element of a collection type, as in ref(Queue): it reads as the element, and
 * stays with it wherever it moves, pointing at nothing once it is gone. A reference to a record
 * type, as in ref(Node), refers to a node of that record's pool (`heap`), its collection.
 */
export type RefType = {
  kind: 'ref';
  name: string;
  collection: string;
  element: string;
  heap?: boolean;
};
export type StructureType = UnionType | RecordType | CollectionType | RefType;

/**
 * An operator on domain values, unary or binary, as in binop((a: Int, b: Int) => Flag(a > b)): its
 * operands' types, written on its parameters; its parameters' names, which name an application's
 * parts; its body, one expression of its parameters; and the type of the value it gives, the
 * body's constructor.
 */
export type OperatorType = {
  name: string;
  operands: readonly string[];
  parameters: readonly string[];
  result: string;
  body: Expression;
};

/**
 * Every type a component defines, by name: atomic types and the structures built from them; and
 * the operators on them.
 */
export type DomainRegistry = {
  atoms: AtomRegistry;
  structures: Readonly<Record<string, StructureType>>;
  operators?: Readonly<Record<string, OperatorType>>;
};

/** Whether a type is a pool, as Nodes for const Nodes = pool(Node, { max: 6 }). */
export function isPool(domain: DomainRegistry, type: string | undefined): boolean {
  const structure = type ? domain.structures[type] : undefined;
  return structure?.kind === 'collection' && !!structure.pool;
}

/** Each record that has a pool, with that pool's type. */
export function pooledRecords(domain: DomainRegistry): Map<string, CollectionType> {
  const records = new Map<string, CollectionType>();
  for (const structure of Object.values(domain.structures))
    if (structure.kind === 'collection' && structure.pool)
      records.set(structure.element, structure);
  return records;
}

/** A component without a domain block defines no types. */
export const noDomain: DomainRegistry = { atoms: noAtoms, structures: {} };

/** The operators a domain declares, by name. */
export function operatorNames(domain: DomainRegistry): string[] {
  return Object.keys(domain.operators ?? {});
}

/** Every type name a domain defines. */
export function typeNames(domain: DomainRegistry): string[] {
  return [...Object.keys(domain.atoms), ...Object.keys(domain.structures)];
}

/** Whether a domain defines a type by this name. */
export function definesType(domain: DomainRegistry, name: string): boolean {
  return Object.hasOwn(domain.atoms, name) || Object.hasOwn(domain.structures, name);
}
