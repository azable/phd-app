<!--
  A link between two children of the node it sits in, drawn as a line between the nodes its keys
  name, with heads at the ends it points to; its children, if any, are its label. It takes no space
  itself: the arranging node reads it, lays its children out with it, and draws it and places its
  label over them. Each link has an id from its place in the source and its ends, so a
  participant can select it and refer to it in feedback, and a link whose ends change between steps
  is a different link rather than the same one drawn to its old ends. One with no `from`, in a view
  of an element, starts at the node drawing that element, as a node's `next` does, and is laid out
  by the free layout around the elements.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import {
    drawnContext,
    provideSlot,
    elementOf,
    elementSlot,
    endsContext,
    hiddenContext,
    keyedRef,
    layoutMemoryContext,
    linkEnd,
    nodeIdsContext,
    placeContext,
    pointersContext,
    pointsInto,
    slotContext,
    typeContext
  } from '../type-context';
  import { colourCss, kindKey, lookUp, placedKind, strokeStyleCss } from './design';
  import { byPlace, pairOf } from './lines';
  import LinkLabel from './LinkLabel.svelte';
  import { designContext } from '../type-context';

  let {
    from,
    to,
    children,
    __view = 'root',
    __ref,
    __component,
    __fromPath,
    __fromOf,
    __fromAt,
    __toPath,
    __toOf,
    __toAt,
    __fromIn,
    __toIn,
    __reads = []
  }: {
    /** The key of the node the link starts from, or a position, as edge.from; none, the element its view draws. */
    from?: string | number;
    /** The key of the node the link goes to, or a position, as edge.to. */
    to: string | number;
    /** Its label: text, views of values, or nodes, drawn at the link's middle over its line. */
    children?: Snippet;
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
    /** Internal: the collection an end that is an {#each} index points into. */
    __fromIn?: unknown;
    __toIn?: unknown;
    /** Internal: the variables and labels its ends read, as a slot's (see Slot.svelte). */
    __reads?: readonly string[];
  } = $props();

  const types = typeContext();
  // Hidden where an end reads a value absent, as a label that gave none, or its view is hidden, as an
  // operator's at a step with no application: laid out, so nothing moves when it shows.
  const hidden = untrack(
    () => (hiddenContext() ?? false) || __reads.some((name) => types?.absent(name))
  );
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
        : linkEnd(types, from, { path: __fromPath, of: __fromOf, at: __fromAt, in: __fromIn }),
    to: linkEnd(types, to, { path: __toPath, of: __toOf, at: __toAt, in: __toIn })
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
  // How it runs is its kind's: as its layout's arrows run, a curve of its own, or a wire; and its
  // heads, drawn at the ends it points to, its kind's shape and size.
  const route = $derived(look('route', false));
  const head = $derived(look('head', false) as string | undefined);
  const headSize = $derived(look('headSize', false) as number | undefined);
  const nodeIds = nodeIdsContext();
  // A link from a node's field is known by the nodes it joins, not their places in the heap, which
  // shift as nodes come and go: so another node's link never takes over its route.
  const named = (end: string) => (from === undefined ? types?.identityOf(end) : undefined) ?? end;
  const id = untrack(() =>
    __ref ? nodeIds?.claim(keyedRef(__ref, `${named(ends.from)}->${named(ends.to)}`)) : undefined
  );
  // One with no from, in a view a record's fields render, is told apart by the field it draws, so
  // a doubly linked list's next and prev drawn by one view of a reference stay two links.
  const field = untrack(() =>
    from === undefined
      ? typeof __toAt === 'string'
        ? __toAt
        : /\.([A-Za-z_$][\w$]*)$/u.exec(slotContext() ?? '')?.[1]
      : undefined
  );
  // An arrow, unless this <Link> also joins its ends the other way at exactly the same steps, as an
  // undirected graph lists each edge from both its ends: then the pair is one line, drawn by the
  // link from the end first in order, and the other draws nothing (see lines.ts).
  const joined = untrack(() => ({
    pair:
      __ref &&
      pairOf(field ? `${__ref}.${field}` : __ref, String(named(ends.from)), String(named(ends.to))),
    forward: byPlace(String(named(ends.from)), String(named(ends.to))) < 0
  }));
  const line = untrack(
    () => !!joined.pair && (layoutMemoryContext()?.lines.has(joined.pair) ?? false)
  );
  const unseen = untrack(() => hidden || look('shown', false) === false);
  // The end it draws is no element of the state, so it draws none.
  provideSlot(undefined);
</script>

{#if end}
  {@render end(to)}
{:else if !line || joined.forward}
  <span
    class="sv-link"
    hidden
    data-sv-link={id ?? ''}
    data-sv-hoist={from === undefined ? 'true' : undefined}
    data-from={ends.from}
    data-to={ends.to}
    data-directed={line ? 'false' : 'true'}
    data-sv-pair={joined.pair || undefined}
    data-sv-way={joined.forward ? 'forward' : 'back'}
    data-stroke-style={strokeStyleCss(look('strokeStyle', false))}
    data-stroke={colourCss(look('stroke'))}
    data-stroke-width={look('strokeWidth')}
    data-shown={unseen ? 'false' : undefined}
    data-opacity={look('opacity', false)}
    data-route={route === 'layout' ? undefined : route}
    data-head={head}
    data-head-size={headSize}
  ></span>
  {#if children}<LinkLabel link={id ?? ''} hidden={unseen}>{@render children()}</LinkLabel>{/if}
{/if}

<style>
  .sv-link {
    display: none;
  }
</style>
