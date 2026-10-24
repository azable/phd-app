<!--
  In a view of an index type, the element the position points at: the element's own node, drawn
  in this pointer's kind (its view's, as Compared.Pointed) over its own, inside whatever layout the view wraps it
  in. Paint (fill, stroke, colour, opacity) shows only where the pointer is; the rest also applies
  where it only keeps its room, so every slot has the same size. In an end slot it is a hidden copy
  of the neighbouring element, with no identity of its own; drawn alone, as when the view is
  measured, it is empty.
-->
<script lang="ts">
  import { untrack } from 'svelte';

  import { kindKey } from './design';
  import {
    leaveComponentBox,
    pointedContext,
    provideCopy,
    provideHidden,
    providePointed,
    providePointerIdentity,
    provideWrapped
  } from '../type-context';

  let {
    __view = 'root'
  }: {
    /** Internal: the view this tag is in, added by the compiler. */
    __view?: string;
  } = $props();

  const pointed = pointedContext();
  // This pointer's kind, under those of the pointers outside it: of those at the element, the
  // pointer written last wins, so one elsewhere never hides one here. Each step mounts afresh, so
  // the props are read once.
  const own = untrack(() => ({
    kind: kindKey(__view, 'Pointed'),
    active: pointed?.active ?? false
  }));
  const outer = pointed?.outer as { __over?: { active?: boolean } } | undefined;
  const merged = {
    ...pointed?.outer,
    __over: outer?.__over && (outer.__over.active || !own.active) ? outer.__over : own,
    ...(pointed?.placeholder ? { __id: undefined, __ref: undefined, __slot: undefined } : {})
  };
  providePointed(undefined);
  providePointerIdentity(undefined);
  provideHidden(pointed?.placeholder ?? false);
  if (pointed?.placeholder) provideCopy();
  leaveComponentBox();
  if (pointed) provideWrapped(pointed.slot);
</script>

{#if pointed?.render}{@render pointed.render(merged)}{/if}
