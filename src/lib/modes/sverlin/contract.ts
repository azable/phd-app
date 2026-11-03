/** Authored source starter and editor identity for the Svelte-backed mode. */

export const sverlinStarter = {
  path: 'Main.svelte',
  language: 'svelte',
  mediaType: 'text/x-svelte',
  source:
    '<script algorithm>\n</script>\n{#snippet Title()}<Node>Start your visualization</Node>{/snippet}\n<Layout name="Stacked">\n  <Node>{@render Title()}</Node>\n</Layout>\n'
} as const;

/** A small self-contained algorithm example for administrator projects. */
export const linearSearchSource = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
</script>
<script input>
  const values = Values([3, 8, 5, 2, 7]);
  const target = Int(2);
</script>
<script algorithm>
  function search(a, target) {
    for (@first[let i = Index(0)]; @more[i < a.length]; @next[i++]) @check{
      if (@equal[a[i] === target]) return i;
    }
    @missing[return Index(-1);]
  }
  @run[const found = search(values, target);]
</script>
{#snippet IntCell(this: Int)}<Node value={this} />{/snippet}
{#snippet IntTally(this: Int)}
  {#snippet Tally()}<Node>{'•'.repeat(this)}</Node>{/snippet}
  <Node layout="column">
    <Node value={this} />
    {@render Tally()}
  </Node>
{/snippet}
{#snippet IndexText(this: Index)}<Node value={this} />{/snippet}
{#snippet Row(this: Values)}
  <Node layout="row">
    {#each this as value, k}
      {#snippet Under()}<Node>{k}</Node>{/snippet}
      <Node layout="column">
        {value}
        {@render Under()}
      </Node>
    {/each}
  </Node>
{/snippet}
{#snippet Highlight(this: Index)}<Pointed />{/snippet}
{#snippet Title()}<Node>Linear search</Node>{/snippet}
{#snippet Caption()}<Node>Find {target} by checking each cell in order.</Node>{/snippet}
{#snippet Ask(this: @check.equal)}<Node>is {this.left} equal to {this.right}?</Node>{/snippet}
{#snippet Checking()}<Node>Checking index {i}: {@check.equal}</Node>{/snippet}
{#snippet Result()}<Node>Found {target} at index {found}.</Node>{/snippet}

<Layout name="Main">
  <Node>
    {@render Title()}
    {@render Caption()}
    {values}
    {i}
    {found}
    {@render Checking()}
    {@render Result()}
  </Node>
</Layout>`;
