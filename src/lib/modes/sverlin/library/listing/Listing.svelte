<!--
  The algorithm as a listing in the language the variant chose (listing.language), lighting what the
  shown step ran: the text of its latest event in listing.current.fill, of its earlier events in
  listing.earlier.fill. The text is the same at every step, so the box keeps one size; only the
  lighting moves. Each line is a node of its own, which participants can select.
-->
<script lang="ts">
  import { untrack } from 'svelte';

  import { colourCss } from '../node/design';
  import { designContext, keyedRef, listingContext, nodeIdsContext } from '../type-context';

  let { __ref }: { __ref?: string } = $props();

  const design = designContext();
  const listing = listingContext();
  const nodeIds = nodeIdsContext();
  const ref = untrack(() => __ref);
  const id = ref ? nodeIds?.claim(ref) : undefined;

  type Segment = { text: string; lit?: 'current' | 'earlier' };

  // Each step mounts afresh, so the lines are split once: where their lighting changes, current
  // over earlier, each line claiming its id in order.
  const lines = ((): { id?: string; segments: Segment[] }[] => {
    if (!listing) return [];
    const lit = (at: number): Segment['lit'] =>
      listing.current.some(([start, end]) => start <= at && at < end)
        ? 'current'
        : listing.earlier.some(([start, end]) => start <= at && at < end)
          ? 'earlier'
          : undefined;
    let offset = 0;
    return listing.text.split('\n').map((text, index) => {
      const segments: Segment[] = [];
      for (let at = 0; at < text.length; at++) {
        const state = lit(offset + at);
        const last = segments.at(-1);
        if (last && last.lit === state) last.text += text[at];
        else segments.push({ text: text[at], ...(state ? { lit: state } : {}) });
      }
      offset += text.length + 1;
      return {
        id: ref ? nodeIds?.claim(keyedRef(ref, `L${index + 1}`)) : undefined,
        segments
      };
    });
  })();

  const fill = (lit: Segment['lit']) =>
    lit ? colourCss(design[`listing.${lit}.fill`]) : undefined;
</script>

{#if listing}
  <div class="sv-listing" data-sv-node={id} data-sv-kind="listing">
    {#each lines as line, index (index)}
      <div class="sv-listing-line" data-sv-node={line.id} data-sv-kind="listing-line">
        {#each line.segments as segment, at (at)}<span style:background-color={fill(segment.lit)}
            >{segment.text}</span
          >{/each}{#if !line.segments.length}&nbsp;{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .sv-listing {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--sv-ink);
    padding: 0.5rem 0.75rem;
  }
  .sv-listing-line {
    white-space: pre;
  }
  .sv-listing-line span {
    border-radius: 2px;
  }
</style>
