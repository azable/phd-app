/**
 * Which recorded values are the same from one step to the next, so the view can move a value
 * where the algorithm moved it. A collection or record is one object wherever it is held, so it
 * keeps one id. A typed value is an immutable object that assignment passes on and arithmetic or
 * a literal makes anew, so the same value can sit in two places, as after values[j] = values[j - 1];
 * the place that held it at the previous step keeps its id, and the other is a copy.
 */

/** A recorded value's place, and whether it is a typed value that can be copied. */
export type Placed = readonly [path: string, value: object, copyable: boolean];

/** The id of each recorded place, and the id each copy was made from. */
export type StepIdentities = { ids: Record<string, number>; copies: Record<number, number> };

export class Identities {
  #next = 1;
  readonly #structures = new WeakMap<object, number>();
  /** The id each value last had, so one that only a variable held for a while keeps it. */
  readonly #last = new WeakMap<object, number>();
  #previous = new Map<string, { value: object; id: number }>();

  /**
   * Ids for one step's places. A value keeps the id of its place at the previous step; one that
   * moved takes the id it had there, or before, if no other place claimed it; otherwise it is a
   * copy, or new.
   */
  step(placed: readonly Placed[]): StepIdentities {
    const ids: Record<string, number> = {};
    const copies: Record<number, number> = {};
    const values = placed.filter(([, , copyable]) => copyable);
    for (const [path, value, copyable] of placed)
      if (!copyable) ids[path] = this.#structureId(value);

    const claimed = new Set<number>();
    const moved: (readonly [string, object])[] = [];
    for (const [path, value] of values) {
      const before = this.#previous.get(path);
      if (before?.value === value) {
        ids[path] = before.id;
        claimed.add(before.id);
      } else moved.push([path, value]);
    }
    const earlier = new Map<object, number[]>();
    for (const { value, id } of this.#previous.values())
      earlier.set(value, [...(earlier.get(value) ?? []), id]);
    for (const [path, value] of moved) {
      const last = this.#last.get(value);
      const known = [...(earlier.get(value) ?? []), ...(last === undefined ? [] : [last])];
      const free = known.find((id) => !claimed.has(id));
      const id = free ?? this.#next++;
      if (free === undefined && known.length) copies[id] = known[0];
      ids[path] = id;
      claimed.add(id);
    }

    for (const [path, value] of values)
      if (!(ids[path] in copies)) this.#last.set(value, ids[path]);
    this.#previous = new Map(values.map(([path, value]) => [path, { value, id: ids[path] }]));
    return { ids, copies };
  }

  #structureId(value: object): number {
    let id = this.#structures.get(value);
    if (id === undefined) this.#structures.set(value, (id = this.#next++));
    return id;
  }
}
