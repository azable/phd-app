/**
 * Which recorded values are the same from one step to the next, so the view can move a value
 * where the algorithm moved it. A collection or record is one object wherever it is held, so it
 * keeps one id. A typed value is an immutable object that assignment passes on and arithmetic or
 * a literal makes anew, so the same value can sit in two places, as after values[j] = values[j - 1];
 * the place that held it at the previous step keeps its id, and the other is a copy. Collections
 * and records hold values first: a variable holding a value one of them holds is a copy of it, so
 * a swap through a temporary moves both values, and a variable has the value's own id only while
 * it alone holds it, as insertion sort's key.
 */

/**
 * A recorded value's place: a collection or record (`shared`, one id wherever held), a typed value
 * a collection or record holds (`held`), or a typed value a variable holds (`variable`). A
 * reference (`ref`) is no place: it names the element it refers to, as queue[0], if it is there.
 */
export type Placed = readonly [
  path: string,
  value: object,
  kind: 'shared' | 'held' | 'variable' | 'ref',
  element?: string
];

/**
 * The id of each recorded place, the id each copy was made from, and the element each reference
 * refers to, by id; a reference whose element is gone has none.
 */
export type StepIdentities = {
  ids: Record<string, number>;
  copies: Record<number, number>;
  refs: Record<string, number>;
};

type Claiming = {
  ids: Record<string, number>;
  copies: Record<number, number>;
  claimed: Set<number>;
};

export class Identities {
  #next = 1;
  readonly #structures = new WeakMap<object, number>();
  /** The id each value last had, so one that was out of every place for a while keeps it. */
  readonly #last = new WeakMap<object, number>();
  #previous = new Map<string, { value: object; id: number }>();

  /**
   * Ids for one step's places: collections and records, then the values they hold, then variables.
   * A step's before is placed against the after before it without being kept (`keep` false), so
   * each after is still matched with the after before it, as a value parked in a temporary and put
   * back stays one value; new ids are still new.
   */
  step(placed: readonly Placed[], keep = true): StepIdentities {
    const claiming: Claiming = { ids: {}, copies: {}, claimed: new Set() };
    const { ids, copies, claimed } = claiming;
    for (const [path, value, kind] of placed)
      if (kind === 'shared') ids[path] = this.#structureId(value);

    const held = placed.filter(([, , kind]) => kind === 'held');
    this.#claim(held, claiming);
    const holder = new Map(held.map(([path, value]) => [value, ids[path]]));
    // A reference has the identity of the element it refers to.
    const refs: Record<string, number> = {};
    for (const [path, , kind, element] of placed)
      if (kind === 'ref' && element !== undefined && ids[element] !== undefined)
        refs[path] = ids[element];
    const alone: Placed[] = [];
    for (const place of placed) {
      const [path, value, kind] = place;
      if (kind !== 'variable') continue;
      const source = holder.get(value);
      if (source === undefined) {
        alone.push(place);
        continue;
      }
      // A copy it already was at the previous step stays the same copy.
      const before = this.#previous.get(path);
      if (before?.value === value && !claimed.has(before.id)) ids[path] = before.id;
      else copies[(ids[path] = this.#next++)] = source;
      claimed.add(ids[path]);
    }
    this.#claim(alone, claiming);

    if (keep) {
      const values = placed.filter(([, , kind]) => kind === 'held' || kind === 'variable');
      for (const [path, value] of values)
        if (!(ids[path] in copies)) this.#last.set(value, ids[path]);
      this.#previous = new Map(values.map(([path, value]) => [path, { value, id: ids[path] }]));
    }
    return { ids, copies, refs };
  }

  /**
   * Give typed values their ids: one that stayed in its place keeps the place's id; one that moved
   * takes the id it had elsewhere at the previous step, or last had, if no place claimed it yet;
   * otherwise it is a copy of that id, or new.
   */
  #claim(places: readonly Placed[], { ids, copies, claimed }: Claiming): void {
    const moved: Placed[] = [];
    for (const place of places) {
      const [path, value] = place;
      const before = this.#previous.get(path);
      if (before?.value === value && !claimed.has(before.id)) {
        ids[path] = before.id;
        claimed.add(before.id);
      } else moved.push(place);
    }
    // The ids each value had at the previous step, taken in order, so a value in many places is
    // matched in one pass.
    const earlier = new Map<object, number[]>();
    for (const { value, id } of this.#previous.values()) {
      const list = earlier.get(value);
      if (list) list.push(id);
      else earlier.set(value, [id]);
    }
    const taken = new Map<object, number>();
    for (const [path, value] of moved) {
      const list = earlier.get(value) ?? [];
      let at = taken.get(value) ?? 0;
      while (at < list.length && claimed.has(list[at])) at++;
      taken.set(value, at);
      const last = this.#last.get(value);
      const free = list[at] ?? (last !== undefined && !claimed.has(last) ? last : undefined);
      const id = free ?? this.#next++;
      const source = list[0] ?? last;
      if (free === undefined && source !== undefined) copies[id] = source;
      ids[path] = id;
      claimed.add(id);
    }
  }

  #structureId(value: object): number {
    let id = this.#structures.get(value);
    if (id === undefined) this.#structures.set(value, (id = this.#next++));
    return id;
  }
}
