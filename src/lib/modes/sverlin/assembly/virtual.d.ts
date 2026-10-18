/** The authored Main.svelte after prelude injection, as the bundler supplies it to entry.ts. */
declare module 'virtual:component' {
  import type { Component } from 'svelte';

  const Main: Component<Record<string, unknown> & { step: number; seed: number }>;
  export default Main;
}

/** Each step's recorded values and design values, with atomic types by path under __types. */
declare module 'virtual:trace' {
  const states: Record<string, unknown>[];
  export default states;
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
 * The view's typed components, each after those it renders, with their parameters: an atomic type
 * by name, or a collection of one filled to the longest the trace holds.
 */
declare module 'virtual:components' {
  const components: {
    name: string;
    parameters: (string | { element: string; length: number })[];
  }[];
  export default components;
}
