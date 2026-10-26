<!--
  One branch of a {#when} chain (see Chain.svelte), drawn only at a step inside a run of its label:
  `key` is the label's key, absent where the step is inside none.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import { typeContext } from '../type-context';

  let { key, children }: { key: string; children: Snippet } = $props();
  // Each step mounts afresh, so the key is read once.
  const inside = untrack(() => !(typeContext()?.absent(key) ?? true));
</script>

{#if inside}{@render children()}{/if}
