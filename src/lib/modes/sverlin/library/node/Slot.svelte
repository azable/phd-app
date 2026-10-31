<!--
  Names the element of the state a component call draws, for the component's root nodes: the
  compiler wraps every {@render} of a view in one. `path` is a variable's name, `of` with `at` an
  element of an array or object from the props, and `inherit` keeps the slot of the component this
  call is in, for a component passing its own value on. With none of them, the value is no element.
  `reads` are the state variables the value comes from: at a step where one is out of scope, the
  value stands in from another step, drawn hidden as a copy, so it keeps its room. `site` is the
  render's line:column: one the presentation leaves out draws nothing and keeps no room. `place` is
  the render's place, whose own variables the kinds of the view it draws take (see placedKind).
  `through` marks a value read through at(p), drawn inside a slot naming p: its nodes move as p,
  not as the element, which is drawn where it is held too (see movingIdentity).
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import {
    copyContext,
    elementOf,
    leftOutContext,
    movingIdentity,
    provideCopy,
    providePlace,
    provideHidden,
    provideSlot,
    provideThrough,
    slotContext,
    throughContext,
    typeContext
  } from '../type-context';
  import type { Place } from './design';

  let {
    path,
    of,
    at,
    inherit = false,
    reads = [],
    missing = false,
    through = false,
    site,
    place,
    children
  }: {
    path?: string;
    of?: unknown;
    at?: string | number;
    inherit?: boolean;
    reads?: readonly string[];
    /** Whether the value reads past an end through at(p), where it is nothing and draws nothing. */
    missing?: boolean;
    /** Whether the value is read through at(p): its nodes move as the slot around, naming p. */
    through?: boolean;
    site?: string;
    place?: Place;
    /** None where the render it wraps draws nothing here, as one the compiler leaves empty. */
    children?: Snippet;
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
  const enclosing = slotContext();
  const slot = untrack(() =>
    absent || copyContext()
      ? undefined
      : inherit
        ? enclosing
        : (path ?? (at === undefined ? undefined : elementOf(types, of, at)))
  );
  provideSlot(slot);
  if (untrack(() => through) && slot)
    provideThrough({
      element: slot,
      identity: enclosing && movingIdentity(types, throughContext(), enclosing)
    });
</script>

{#if !leftOut && !missing}
  {@render children?.()}
{/if}
