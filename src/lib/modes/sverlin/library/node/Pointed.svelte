<!--
  In a view of an index type, the element the position points at: the element's own node, drawn
  in this pointer's kind (its view and tags) over its own, inside whatever layout the view wraps it
  in. Paint (fill, stroke, colour, opacity) shows only where the pointer is; the rest also applies
  where it only keeps its room, so every slot has the same size. In an end slot it is a hidden copy
  of the neighbouring element, with no identity of its own; drawn alone, as when the view is
  measured, it is empty.
-->
<script lang="ts">
  import { untrack } from 'svelte';

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
    __view = 'root',
    __base,
    __site
  }: {
    /** Names saying what the pointed element is while pointed at, as on a <Node>. */
    tags?: string | readonly (string | false | null | undefined)[];
    /** Internal: the view this tag is in, added by the compiler. */
    __view?: string;
    /** Internal, where its tags depend on the state: its literal tags, and every kind it can be. */
    __base?: string;
    __site?: readonly string[];
  } = $props();

  const pointed = pointedContext();
  // This pointer's kind, under those of the pointers outside it: of those at the element, the
  // pointer written last wins, so one elsewhere never hides one here. Each step mounts afresh, so
  // the props are read once.
  const own = untrack(() => ({
    kind: kindKey(__view, activeTags(tags, 'pointed')),
    base: kindKey(__view, activeTags(__base ?? tags, 'pointed')),
    site: __site,
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
