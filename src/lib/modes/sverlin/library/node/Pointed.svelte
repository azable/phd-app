<!--
  In a view of an index type, the element the position points at: the element's own node, drawn
  in this pointer's kind (its view and tags) over its own, inside whatever layout the view wraps it
  in. Paint (fill, stroke, colour, opacity) shows only where the pointer is; the rest also applies
  where it only keeps its room, so every slot has the same size. In an end slot it is a hidden copy
  of the neighbouring element, with no identity of its own; drawn alone, as when the view is
  measured, it is empty.
-->
<script lang="ts">
  import { activeTags, kindKey } from './design';
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
    tags,
    __view = 'root'
  }: {
    /** Names saying what the pointed element is while pointed at, as on a <Node>. */
    tags?: string | readonly (string | false | null | undefined)[];
    /** Internal: the view this tag is in, added by the compiler. */
    __view?: string;
  } = $props();

  const pointed = pointedContext();
  // This pointer's kind, under those of the pointers outside it: the pointer written last wins.
  const merged = {
    __over: {
      kind: kindKey(__view, activeTags(tags, 'pointed')),
      active: pointed?.active ?? false
    },
    ...pointed?.outer,
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
