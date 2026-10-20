<!--
  The hidden copy of an {#each} item's node keeping one of its collection's end slots, before the
  first item or after the last, so the pointers there line up with the rest (see Node.svelte).
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import { provideEndSlot, provideHidden } from '../type-context';

  let { collection, position, draw }: { collection: string; position: number; draw: Snippet } =
    $props();

  // Each step mounts afresh, so the props are read once.
  untrack(() => provideEndSlot({ collection, position }));
  provideHidden(true);
</script>

{@render draw()}
