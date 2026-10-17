/**
 * Domain types built from other types: a union holds a value of one of its members, a record has
 * named fields of given types, and a collection holds elements of one type. With the atomic types
 * they make up a component's domain; every input and algorithm value belongs to one of them.
 */

import { noAtoms, type AtomRegistry } from './atoms.server';

export type UnionType = { kind: 'union'; name: string; members: readonly string[] };
export type RecordType = { kind: 'record'; name: string; fields: Readonly<Record<string, string>> };
export type CollectionType = { kind: 'collection'; name: string; element: string };
export type StructureType = UnionType | RecordType | CollectionType;

/** Every type a component defines, by name: atomic types and the structures built from them. */
export type DomainRegistry = {
  atoms: AtomRegistry;
  structures: Readonly<Record<string, StructureType>>;
};

/** A component without a domain block defines no types. */
export const noDomain: DomainRegistry = { atoms: noAtoms, structures: {} };

/** Every type name a domain defines. */
export function typeNames(domain: DomainRegistry): string[] {
  return [...Object.keys(domain.atoms), ...Object.keys(domain.structures)];
}

/** Whether a domain defines a type by this name. */
export function definesType(domain: DomainRegistry, name: string): boolean {
  return Object.hasOwn(domain.atoms, name) || Object.hasOwn(domain.structures, name);
}
