<!--
  A link's label: its <Link>'s children, which the node drawing the link places on the link's middle
  (see Arranged.svelte and LinkOverlay.svelte). Hidden with its link, it is a hidden copy keeping
  its room, as a value out of scope is.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';

  import { provideCopy, provideHidden } from '../type-context';

  let { link, hidden, children }: { link: string; hidden: boolean; children: Snippet } = $props();
  // Each step mounts afresh, so the props are read once.
  if (untrack(() => hidden)) {
    provideHidden(true);
    provideCopy();
  }
</script>

<div class="sv-link-label" data-sv-link-label={link} data-sv-hidden={hidden ? 'true' : undefined}>
  {@render children()}
</div>

<style>
  /* Over the lines, which are drawn over the nodes. */
  .sv-link-label {
    position: absolute;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
    font-size: 0.75em;
    color: var(--sv-muted);
  }
  .sv-link-label:not([data-sv-placed]),
  .sv-link-label[data-sv-hidden='true'] {
    visibility: hidden;
  }
</style>
