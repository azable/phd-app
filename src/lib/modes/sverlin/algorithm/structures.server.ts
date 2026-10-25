/**
 * Domain types built from other types: a union holds a value of one of its members, a record has
 * named fields of given types, and a collection holds elements of one type. With the atomic types
 * they make up a component's domain; every input and algorithm value belongs to one of them.
 */

import type { Expression } from 'acorn';

import { noAtoms, type AtomRegistry } from './atoms.server';

export type UnionType = { kind: 'union'; name: string; members: readonly string[] };
export type RecordType = { kind: 'record'; name: string; fields: Readonly<Record<string, string>> };
export type CollectionType = { kind: 'collection'; name: string; element: string };
/**
 * A reference to an element of a collection type, as in ref(Queue): it reads as the element, and
 * stays with it wherever it moves, pointing at nothing once it is gone. A reference to a record
 * type, as in ref(Node), refers to a node wherever it is (`heap`): its collection is the record's
 * heap, every live node of it (see heapKey).
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

/**
 * The name of a record's heap, every live node of it in the order they were made, as a step records
 * it and the view reads it, written `all(Node)`; it is also the heap's collection type.
 */
export const heapKey = (record: string): string => `ȟ${record}`;
export const isHeapKey = (name: string): boolean => name.startsWith('ȟ');

/** The records a reference refers to as nodes, each with the first such reference type. */
export function heapRecords(domain: DomainRegistry): Map<string, string> {
  const records = new Map<string, string>();
  for (const structure of Object.values(domain.structures))
    if (structure.kind === 'ref' && structure.heap && !records.has(structure.element))
      records.set(structure.element, structure.name);
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
  return [...Object.keys(domain.atoms), ...Object.keys(domain.structures)].filter(
    (name) => !isHeapKey(name)
  );
}

/** Whether a domain defines a type by this name. */
export function definesType(domain: DomainRegistry, name: string): boolean {
  return Object.hasOwn(domain.atoms, name) || Object.hasOwn(domain.structures, name);
}
