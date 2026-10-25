<!--
  Names the element of the state a component call draws, for the component's root nodes: the
  compiler wraps every {@render} of a view in one. `path` is a variable's name, `of` with `at` an
  element of an array or object from the props, and `inherit` keeps the slot of the component this
  call is in, for a component passing its own value on. With none of them, the value is no element.
  `reads` are the state variables the value comes from: at a step where one is out of scope, the
  value stands in from another step, drawn hidden as a copy, so it keeps its room. `site` is the
  render's line:column: one the presentation leaves out draws nothing and keeps no room. `place` is
  the render's place, whose own variables the kinds of the view it draws take (see placedKind).
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import {
    copyContext,
    elementOf,
    leftOutContext,
    provideCopy,
    providePlace,
    provideHidden,
    provideSlot,
    slotContext,
    typeContext
  } from '../type-context';
  import type { Place } from './design';

  let {
    path,
    of,
    at,
    inherit = false,
    reads = [],
    site,
    place,
    children
  }: {
    path?: string;
    of?: unknown;
    at?: string | number;
    inherit?: boolean;
    reads?: readonly string[];
    site?: string;
    place?: Place;
    children: Snippet;
  } = $props();
  const leftOut = untrack(() => site !== undefined && (leftOutContext()?.has(site) ?? false));
  untrack(() => providePlace(place));

  // Each step mounts afresh, so the props are read once. A hidden copy names no element.
  const types = typeContext();
  const absent = untrack(() => reads.some((name) => types?.absent(name)));
  if (absent) {
    provideHidden(true);
    provideCopy();
  }
  provideSlot(
    untrack(() =>
      absent || copyContext()
        ? undefined
        : inherit
          ? slotContext()
          : (path ?? (at === undefined ? undefined : elementOf(types, of, at)))
    )
  );
</script>

{#if !leftOut}
  {@render children()}
{/if}
