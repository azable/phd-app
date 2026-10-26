<!--
  The root's pointers into a collection drawn around one of its slots, outermost first: each
  pointer's view, given the slot's position, with its <Pointed> drawing what is inside it, the
  next pointer or, innermost, the element itself. A pointer not at the slot keeps its room hidden,
  so every slot has the same size wherever the pointers are. An end slot, before the first element
  or after the last, keeps a hidden copy of its neighbour, so pointers there line up with the rest.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import Pointing from './Pointing.svelte';
  import {
    providePointed,
    providePlace,
    provideHidden,
    providePointerAround,
    providePointerIdentity,
    provideSlot,
    type Pointer
  } from '../type-context';

  let {
    pointers,
    position,
    name,
    outer = {},
    draw,
    placeholder = false
  }: {
    pointers: readonly Pointer[];
    position: number;
    /** The element, as in values[2], or its collection's end slot. */
    name: string;
    outer?: Record<string, unknown>;
    draw?: Snippet<[Record<string, unknown>]>;
    placeholder?: boolean;
  } = $props();

  // Each step mounts afresh, so the props are read once.
  const { pointer, inside, active } = untrack(() => {
    const [first, ...rest] = pointers;
    return { pointer: first, inside: rest, active: first.position === position };
  });
  untrack(() =>
    providePointed({
      slot: name,
      active,
      placeholder,
      outer,
      render: inside.length ? next : draw
    })
  );
  provideHidden(!active);
  untrack(() => providePointerIdentity(active ? `pointer:${pointer.order}` : undefined));
  untrack(() => providePointerAround(name));
  // The pointer view draws no element of its own; its <Pointed> draws the one it points at.
  provideSlot(undefined);
  untrack(() => providePlace(pointer.place));
</script>

{#snippet next(props: Record<string, unknown>)}
  <Pointing pointers={inside} {position} {name} outer={props} {draw} {placeholder} />
{/snippet}

{@render pointer.view(position)}
