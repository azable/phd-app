/**
 * The page's states as the bundle embeds them. Each step is two states (see phasesOf), and most of
 * what each carries is the same at every step, as the variant (__design) and the frame, or repeats
 * from step to step, as the atomic types by path: a value the same in every state is kept once, in
 * `shared`, and each other object-valued property the page adds to a state (named with __, as
 * __types) once per distinct value, in `tables`, a state holding its index; the values of the
 * algorithm's own variables stay as they are. Unpacked, every state is as it was built.
 */

type State = Record<string, unknown>;

export type PackedStates = {
  shared: State;
  tables: Record<string, unknown[]>;
  states: State[];
};

export function packStates(states: readonly State[]): PackedStates {
  const keys = new Set(states.flatMap((state) => Object.keys(state)));
  const shared: State = {};
  const tables: Record<string, unknown[]> = {};
  const indexes: Record<string, Map<string, number>> = {};
  for (const key of keys) {
    const texts = states.map((state) => (key in state ? JSON.stringify(state[key]) : undefined));
    if (texts.every((text) => text !== undefined && text === texts[0]))
      shared[key] = states[0][key];
    else if (
      key.startsWith('__') &&
      states.some((state) => typeof state[key] === 'object' && state[key] !== null)
    ) {
      tables[key] = [];
      indexes[key] = new Map();
    }
  }
  return {
    shared,
    tables,
    states: states.map((state) =>
      Object.fromEntries(
        Object.entries(state).flatMap(([key, value]): [string, unknown][] => {
          if (key in shared) return [];
          const index = indexes[key];
          if (!index) return [[key, value]];
          const text = JSON.stringify(value);
          let at = index.get(text);
          if (at === undefined) {
            at = tables[key].push(value) - 1;
            index.set(text, at);
          }
          return [[key, at]];
        })
      )
    )
  };
}

export function unpackStates({ shared, tables, states }: PackedStates): State[] {
  return states.map((state) => {
    const unpacked: State = { ...shared };
    for (const [key, value] of Object.entries(state))
      unpacked[key] = key in tables ? tables[key][value as number] : value;
    return unpacked;
  });
}
