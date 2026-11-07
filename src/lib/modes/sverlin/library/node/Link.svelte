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
    endsContext,
    hiddenContext,
    keyedRef,
    layoutMemoryContext,
    linkEnd,
    nodeIdsContext,
    placeContext,
    slotContext,
    typeContext
  } from '../type-context';
  import {
    colourCss,
    kindKey,
    lookUp,
    placedKind,
    strokeStyleCss,
    linkEnd as endTag
  } from './design';
  import { byPlace, pairOf } from './lines';
  import LinkLabel from './LinkLabel.svelte';
  import { designContext } from '../type-context';

  let {
    from,
    to,
    children,
    __view = 'root',
    __ref,
    __fromPath,
    __fromOf,
    __fromAt,
    __toPath,
    __toOf,
    __toAt,
    __fromIn,
    __toIn,
    __fromInherit = false,
    __toInherit = false,
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
    /**
     * Internal: an end that is the value a view draws, as to={this} in a view of a reference type:
     * its place is the slot the view is drawn in, as nodes[0].left.
     */
    __fromInherit?: boolean;
    __toInherit?: boolean;
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
  const enclosing = slotContext();
  const fromPath = untrack(() => __fromPath ?? (__fromInherit ? enclosing : undefined));
  const toPath = untrack(() => __toPath ?? (__toInherit ? enclosing : undefined));
  const end = untrack(() => {
    const path = toPath ?? (__toAt === undefined ? undefined : elementOf(types, __toOf, __toAt));
    const type = path === undefined ? undefined : types?.typeAt(path);
    return type === undefined ? undefined : endsContext()?.[type]?.();
  });
  // A link from a variable: to={this}, with no from, in a view of a reference or position drawn at a
  // variable, a label or a {@const}, as {cur} in a panel or {i} in a grid's lane, no element of the
  // state round it. It starts at the node drawing that value and reaches the element wherever that
  // is drawn, and is routed by the page across layouts (see linksFromVariables in
  // model/scene-of.ts), unless a free layout holding both its ends lays it out as one of its own.
  const drawn = drawnContext();
  const reach = untrack(() => from === undefined && __toInherit && !drawn && !!enclosing);
  // An end given a position names the node drawing the element it points at.
  const ends = untrack(() => ({
    from:
      from === undefined
        ? (drawn ?? (reach ? enclosing : undefined) ?? '')
        : linkEnd(types, from, { path: fromPath, of: __fromOf, at: __fromAt, in: __fromIn }),
    to: linkEnd(types, to, { path: toPath, of: __toOf, at: __toAt, in: __toIn })
  }));
  // The link's look is the variant's values for its kind, a render at a place giving its own.
  const design = designContext();
  // Each step mounts afresh, so the props are read once.
  const kind = untrack(() => kindKey(__view, 'Link'));
  const placed = untrack(() => placedKind(placeContext(), kind));
  const look = (prop: string) => lookUp(design, kind, placed, prop);
  // Its end, as Arrow.<Link>.<To>: the head drawn there and the paint it gives what it reaches, a
  // render at a place giving its own.
  const endKind = untrack(() => `${kind}.${endTag}`);
  const endPlaced = untrack(() => placedKind(placeContext(), endKind));
  const endLook = (prop: string) => lookUp(design, endKind, endPlaced, prop);
  // How it runs is its kind's: as its layout's arrows run, a curve of its own, or a wire; and its
  // heads, drawn at the ends it points to, its end's shape at its kind's size.
  const route = $derived(look('route'));
  const head = $derived(endLook('head') as string | undefined);
  const headSize = $derived(look('headSize') as number | undefined);
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
  const unseen = untrack(() => hidden || look('shown') === false);
  // The paint a link from a variable gives the element it reaches, its end's, as `name|css`, so the
  // scene keeps the colour's name as a place's paint does; none where its end leaves the element as
  // it is.
  const target = (prop: string) => {
    const name = endLook(prop);
    const css = typeof name === 'string' && name !== 'none' ? colourCss(name) : undefined;
    return css ? `${name}|${css}` : undefined;
  };
  // An end computed from an {#each} index, as to={2 * k + 1}, past its collection's ends at this
  // step names no element there, so the link is not drawn at this step.
  const beyond = untrack(() =>
    [
      [from, __fromIn],
      [to, __toIn]
    ].some(([end, walks]) => {
      if (walks === undefined || typeof end !== 'number') return false;
      const path = types?.pathOf(walks);
      const length = path === undefined ? undefined : types?.lengthOf(path);
      return length !== undefined && (end < 0 || end >= length);
    })
  );
  // A link with a from in a view of an element, as an edge's, draws that element (data-sv-draws), so
  // a link from a variable holding its position reaches the link. The end it draws is no element of
  // the state, so it draws none.
  provideSlot(undefined);
</script>

{#if beyond}
  <!-- An end past its collection at this step: no link here. -->
{:else if end}
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
    data-stroke-style={strokeStyleCss(look('strokeStyle'))}
    data-stroke={colourCss(look('stroke'))}
    data-stroke-width={look('strokeWidth')}
    data-shown={unseen ? 'false' : undefined}
    data-opacity={look('opacity')}
    data-route={route === 'layout' ? undefined : route}
    data-head={head}
    data-head-size={headSize}
    data-sv-reach={reach ? 'true' : undefined}
    data-sv-draws={from !== undefined && !drawn && enclosing ? enclosing : undefined}
    data-target-fill={reach ? target('fill') : undefined}
    data-target-stroke={reach ? target('stroke') : undefined}
    data-target-color={reach ? target('color') : undefined}
    data-target-stroke-width={reach ? endLook('strokeWidth') : undefined}
    data-target-layer={reach ? endLook('layer') : undefined}
  ></span>
  {#if children}<LinkLabel link={id ?? ''} hidden={unseen}>{@render children()}</LinkLabel>{/if}
{/if}

<style>
  .sv-link {
    display: none;
  }
</style>
