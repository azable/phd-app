<!--
  A value of a union, drawn by its member's view (see unionViews in implicit-renders.server.ts): the
  member's view takes the box its union's members share here, and its own box elsewhere.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import { provideUnion } from '../type-context';

  let { name, children }: { name: string; children: Snippet } = $props();
  untrack(() => provideUnion(name));
</script>

{@render children()}
