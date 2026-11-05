<!--
  Where the links of a node laid out in a row, column or grid are drawn: over it, taking no part in
  placing its children. The server routes them from the boxes of the elements their ends name, as
  arcs that clear the boxes between and around them, or as wires, their labels on their middles,
  and draws them in each step's scene (see routeOverlay in overlay.ts and model/scene-of.ts); the
  node's padding grows to hold what they draw past its children. Links in a free layout are placed
  with their nodes instead (see Arranged.svelte).
-->
<script lang="ts">
  import LinkLines from './LinkLines.svelte';

  // Node ids hold : and #, which an SVG fragment reference cannot, so each overlay's arrowheads
  // are named apart.
  const instance = $props.id();
  const markerId = `sv-overlay-arrow-${instance}`;
</script>

<svg class="links" aria-hidden="true">
  <LinkLines prefix={markerId} lines={[]} />
</svg>

<style>
  .links {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
</style>
