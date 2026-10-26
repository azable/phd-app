<!--
  A {#when} chain (see components.server.ts): one box drawing the branch the step is inside, a
  node as a listing is, so it keeps the largest size it reaches at any step (see LayoutMemory) and
  taking turns moves nothing around it. `ref` is the chain's line:column, the id it claims.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import { insideComponentBox, layoutMemoryContext, nodeIdsContext } from '../type-context';

  let { ref, children }: { ref: string; children: Snippet } = $props();
  const id = untrack(() => nodeIdsContext()?.claim(ref));
  const memory = layoutMemoryContext();
  const reserved = untrack(() =>
    !memory || memory.measuring || insideComponentBox() || !id ? undefined : memory.reserved.get(id)
  );
</script>

<div
  class="sv-chain"
  data-sv-node={id}
  data-sv-kind="chain"
  style:min-width={reserved ? `${reserved.width}px` : undefined}
  style:min-height={reserved ? `${reserved.height}px` : undefined}
>
  {@render children()}
</div>

<style>
  .sv-chain {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
</style>
