<!--
  Names the element of the state a component call draws, for the component's root nodes: the
  compiler wraps every {@render} of a view in one. `path` is a variable's name, `of` with `at` an
  element of an array or object from the props, and `inherit` keeps the slot of the component this
  call is in, for a component passing its own value on. With none of them, the value is no element.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import { copyContext, elementOf, provideSlot, slotContext, typeContext } from '../type-context';

  let {
    path,
    of,
    at,
    inherit = false,
    children
  }: {
    path?: string;
    of?: unknown;
    at?: string | number;
    inherit?: boolean;
    children: Snippet;
  } = $props();

  // Each step mounts afresh, so the slot is read once. A hidden copy names no element.
  provideSlot(
    untrack(() =>
      copyContext()
        ? undefined
        : inherit
          ? slotContext()
          : (path ?? (at === undefined ? undefined : elementOf(typeContext(), of, at)))
    )
  );
</script>

{@render children()}
