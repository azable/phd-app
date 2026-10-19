<!--
  In a view of an index type, the element the position points at: the element's own node, drawn
  with these props over its own, inside whatever layout the view wraps it in. Paint (fill, stroke,
  colour, opacity) shows only where the pointer is; the rest also applies where it only keeps its
  room, so every slot has the same size. In an end slot it is a hidden copy of the neighbouring
  element, with no identity of its own; drawn alone, as when the view is measured, it is empty.
-->
<script lang="ts">
  import type { NodeProps } from './props';
  import {
    leaveComponentBox,
    pointedContext,
    provideCopy,
    provideHidden,
    providePointed,
    providePointerIdentity,
    provideWrapped
  } from '../type-context';

  let props: Pick<
    NodeProps,
    | 'shape'
    | 'fill'
    | 'stroke'
    | 'opacity'
    | 'color'
    | 'font'
    | 'size'
    | 'weight'
    | 'padding'
    | 'radius'
    | 'strokeWidth'
  > = $props();

  const paint = new Set(['fill', 'stroke', 'opacity', 'color']);
  const pointed = pointedContext();
  // This pointer's props, under those of the pointers outside it: the pointer written last wins.
  const own = Object.fromEntries(
    Object.entries(props).filter(
      ([name, value]) => value !== undefined && (pointed?.active || !paint.has(name))
    )
  );
  const merged = {
    ...own,
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
