/** Authored source starter and editor identity for the Svelte-backed mode. */

export const sverlinStarter = {
  path: 'Main.svelte',
  language: 'svelte',
  mediaType: 'text/x-svelte',
  source:
    '<script lang="sverlin">\n  yield;\n</script>\n<Node size="xlarge" weight="bold">Start your visualization</Node>\n<Node color="neutral">Step {step + 1} · seed {seed}</Node>\n'
} as const;

/** A small self-contained algorithm example for administrator projects. */
export const linearSearchSource = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');
</script>
<script lang="sverlin" input>
  const values = Values([3, 8, 5, 2, 7]);
  const target = Int(2);
</script>
<script lang="sverlin">
  let found = Flag(false);
  let searching = Flag(true);
  yield;
  for (let i = Index(0); i < values.length; i++) {
    found = values[i] === target;
    yield;
    if (found) break;
  }
  searching = false;
  if (!found) yield;
</script>
<script lang="sverlin" design>
  // How every Int is drawn: one of its views, drawn per presentation.
  const Int = pick([IntCell, IntCard, IntCircle]);
  const Index = IndexText;
  // Whether each cell shows its index.
  const showIndices = chance(0.5);
  // What the colour means stays fixed; which colour shows it is drawn.
  const currentColour = pick(['amber', 'red']);
  const pointerName = pick(['i', 'index', '↑']);
  const titleSize = pick(['large', 'xlarge']);
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet IntCard(value: Int)}<Node {value} shape="card" />{/snippet}
{#snippet IntCircle(value: Int)}<Node {value} radius="full" />{/snippet}
{#snippet IndexText(i: Index)}<Node value={i} weight="bold" />{/snippet}
{#snippet Row(list: Values)}
  <Node layout="row">
    {#each list as value, k}
      <Node layout="column" gap="small">
        {@render Int(value)}
        {#if showIndices}<Node size="small" color="neutral">{k}</Node>{/if}
      </Node>
    {/each}
  </Node>
{/snippet}
{#snippet Current(i: Index)}
  <Node layout="column" gap="small">
    <Pointed fill={currentColour} stroke={currentColour} />
    <Node size="small" color="neutral" weight="bold">{pointerName}</Node>
  </Node>
{/snippet}
<Node size={titleSize} weight="bold">Linear search</Node>
<Node color="neutral">Find {@render Int(target)} by checking each cell in order.</Node>
{@render Row(values)}
{@render Current(i)}
<Node>
  {#if found}Found {@render Int(target)} at index {@render Index(i)}.{:else if !searching}{@render Int(target)} is not in the array.{:else if step === 0}Start at the first cell.{:else}Checking index {@render Index(i)}.{/if}
</Node>`;
