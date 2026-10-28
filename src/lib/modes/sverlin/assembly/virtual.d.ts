/** The authored Main.svelte after prelude injection, as the bundler supplies it to entry.ts. */
declare module 'virtual:component' {
  import type { Component } from 'svelte';

  const Main: Component<Record<string, unknown>>;
  export default Main;
}

/** Each step's recorded values and the view each type draws, packed (see library/trace-pack.ts). */
declare module 'virtual:trace' {
  import type { PackedStates } from 'sverlin';

  const packed: PackedStates;
  export default packed;
}

/** The component's atomic types by name, as its domain block defines them. */
declare module 'virtual:atoms' {
  const atoms: Record<
    string,
    {
      name: string;
      base: string;
      parent?: string;
      unit?: string;
      min?: number;
      max?: number;
      values?: (string | number)[];
    }
  >;
  export default atoms;
}

/**
 * The view's typed components, each after those it renders, with the values to draw it with; and
 * the values its root reads for placement, by path, with the step they are measured at and the
 * values of their types.
 */
declare module 'virtual:components' {
  export const components: {
    name: string;
    cases: unknown[];
    range?: { min: number; max: number };
  }[];
  export const placements: { path: string; step: number; values: unknown[] }[];
  /** The listing in the variant's language, and what each step lights, if the view places one. */
  export const listing: {
    text: string;
    /** Its regions, by their labels' full names, each painted as its place says. */
    regions: { label: string; start: number; end: number }[];
    /** What each step lights: the code it finished and the code it keeps as run, alike. */
    lit: [number, number][][];
  } | null;
}
