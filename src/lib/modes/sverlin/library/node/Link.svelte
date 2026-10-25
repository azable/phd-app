<!--
  A link between two children of the node it sits in, drawn as a line or an arrow between the nodes
  its keys name. It takes no space itself: the arranging node reads it, lays its children out with
  it, and draws it over them. Each link has an id from its place in the source and its ends, so a
  participant can select it and refer to it in feedback, and a link whose ends change between steps
  is a different link rather than the same one drawn to its old ends. One with no `from`, in a view
  of an element, starts at the node drawing that element, as a node's `next` does, and is laid out
  by the free layout around the elements.
-->
<script lang="ts">
  import { untrack } from 'svelte';

  import {
    drawnContext,
    provideSlot,
    elementOf,
    elementSlot,
    endsContext,
    keyedRef,
    linkEnd,
    nodeIdsContext,
    placeContext,
    pointersContext,
    pointsInto,
    slotContext,
    typeContext
  } from '../type-context';
  import { colourCss, kindKey, lookUp, placedKind, strokeStyleCss } from './design';
  import { designContext } from '../type-context';

  let {
    from,
    to,
    directed = true,
    label,
    curve,
    bend,
    __view = 'root',
    __ref,
    __component,
    __fromPath,
    __fromOf,
    __fromAt,
    __toPath,
    __toOf,
    __toAt
  }: {
    /** The key of the node the link starts from, or a position, as edge.from; none, the element its view draws. */
    from?: string | number;
    /** The key of the node the link goes to, or a position, as edge.to. */
    to: string | number;
    /** An arrow (true, the default) or a plain line. */
    directed?: boolean;
    /** Text shown along the link, at its middle. */
    label?: string;
    /** Whether this link runs straight or curves, whatever its arrangement prefers. */
    curve?: 'straight' | 'curved';
    /**
     * An exact curve: how far the link bows to one side, as a fraction of its length (0 is straight,
     * 0.3 a clear arc, negative the other side). Selections report the bend a link drew, so a curve
     * the participant liked can be kept.
     */
    bend?: number;
    /** Internal: the view this link is in, added by the compiler. */
    __view?: string;
    /** Internal: the source position of this link's tag, added by the compiler. */
    __ref?: string;
    /** Internal: set by the compiler on a typed component's root, naming the component. */
    __component?: string;
    /** Internal: where a position at an end comes from, as a slot's (see Slot.svelte). */
    __fromPath?: string;
    __fromOf?: unknown;
    __fromAt?: string | number;
    __toPath?: string;
    __toOf?: unknown;
    __toAt?: string | number;
  } = $props();

  const types = typeContext();
  // A link to an end, as a list's last next, draws the end where it is, with the end's view.
  const end = untrack(() => {
    const path = __toPath ?? (__toAt === undefined ? undefined : elementOf(types, __toOf, __toAt));
    const type = path === undefined ? undefined : types?.typeAt(path);
    return type === undefined ? undefined : endsContext()?.[type]?.();
  });
  // An end given a position names the node drawing the element it points at.
  const ends = untrack(() => ({
    from:
      from === undefined
        ? (drawnContext() ?? '')
        : linkEnd(types, from, { path: __fromPath, of: __fromOf, at: __fromAt }),
    to: linkEnd(types, to, { path: __toPath, of: __toOf, at: __toAt })
  }));
  // The link's look is the variant's values for its kind; one a component draws for an element, as
  // an edge, takes the stroke of the kind of the root's pointer at it, as for the current edge, the
  // pointer written last winning.
  const design = designContext();
  // Each step mounts afresh, so the props are read once.
  const kind = untrack(() => kindKey(__view, 'Link'));
  const placed = untrack(() => placedKind(placeContext(), kind));
  const pointer = untrack(() => {
    const element = __component ? elementSlot(slotContext()) : undefined;
    if (!element) return undefined;
    return Object.assign(
      {},
      ...pointersContext()
        .filter(
          (pointer) =>
            pointsInto(types, pointer, element.collection) && pointer.position === element.index
        )
        .toSorted((a, b) => a.order - b.order)
        .map((pointer) => {
          const own = pointer.paint?.(pointer.position) as { __kind?: string } | undefined;
          return own?.__kind
            ? { __kind: own.__kind, __placed: placedKind(pointer.place, own.__kind) }
            : {};
        })
    ) as { __kind?: string; __placed?: string };
  });
  const look = (prop: string, over = true) =>
    (over && pointer?.__kind
      ? lookUp(design, pointer.__kind, pointer.__placed, prop)
      : undefined) ?? lookUp(design, kind, placed, prop);
  const nodeIds = nodeIdsContext();
  // A link from a node's field is known by the nodes it joins, not their places in the heap, which
  // shift as nodes come and go: so another node's link never takes over its route.
  const named = (end: string) => (from === undefined ? types?.identityOf(end) : undefined) ?? end;
  const id = untrack(() =>
    __ref ? nodeIds?.claim(keyedRef(__ref, `${named(ends.from)}->${named(ends.to)}`)) : undefined
  );
  // The end it draws is no element of the state, so it draws none.
  provideSlot(undefined);
</script>

{#if end}
  {@render end(to)}
{:else}
  <span
    class="sv-link"
    hidden
    data-sv-link={id ?? ''}
    data-sv-hoist={from === undefined ? 'true' : undefined}
    data-from={ends.from}
    data-to={ends.to}
    data-directed={directed ? 'true' : 'false'}
    data-stroke-style={strokeStyleCss(look('strokeStyle', false))}
    data-label={label}
    data-label-colour={colourCss(look('color', false))}
    data-stroke={colourCss(look('stroke'))}
    data-stroke-width={look('strokeWidth')}
    data-shown={look('shown', false) === false ? 'false' : undefined}
    data-opacity={look('opacity', false)}
    data-curve={curve}
    data-bend={typeof bend === 'number' && Number.isFinite(bend)
      ? Math.min(Math.max(bend, -1), 1)
      : undefined}
  ></span>
{/if}

<style>
  .sv-link {
    display: none;
  }
</style>
