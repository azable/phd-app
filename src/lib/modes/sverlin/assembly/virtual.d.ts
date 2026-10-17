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

/** The view's typed components and the domain types of their parameters, in order. */
declare module 'virtual:components' {
  const components: Record<string, string[]>;
  export default components;
}
