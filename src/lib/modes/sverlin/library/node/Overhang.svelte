<!--
  A collection's end slots on one side of it. Where its overflow is excluded, they hang outside its
  box, beside its first element or its last, so the box holds only the elements and centring it
  centres them; otherwise they are tracks of the collection like its elements.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import type { Overhang } from '../type-context';

  let {
    overhang,
    side,
    children
  }: { overhang?: Overhang; side: 'before' | 'after'; children: Snippet } = $props();
</script>

{#if overhang}
  <div
    class="sv-overhang {overhang.layout} {side}"
    style:gap={`${overhang.gap}em`}
    style:--overhang-gap={`${overhang.gap}em`}
  >
    {@render children()}
  </div>
{:else}
  {@render children()}
{/if}

<style>
  .sv-overhang {
    position: absolute;
    display: flex;
    align-items: center;
  }
  .row {
    top: 0;
    bottom: 0;
    flex-direction: row;
  }
  .row.before {
    right: 100%;
    padding-right: var(--overhang-gap);
  }
  .row.after {
    left: 100%;
    padding-left: var(--overhang-gap);
  }
  .column {
    left: 0;
    right: 0;
    flex-direction: column;
  }
  .column.before {
    bottom: 100%;
    padding-bottom: var(--overhang-gap);
  }
  .column.after {
    top: 100%;
    padding-top: var(--overhang-gap);
  }
</style>
