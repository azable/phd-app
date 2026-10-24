/** Authored source starter and editor identity for the Svelte-backed mode. */

export const sverlinStarter = {
  path: 'Main.svelte',
  language: 'svelte',
  mediaType: 'text/x-svelte',
  source:
    '<script lang="sverlin">\n</script>\n<Node tags="title">Start your visualization</Node>\n<Node tags="caption">Step {step + 1} · seed {seed}</Node>\n'
} as const;

/** A small self-contained algorithm example for administrator projects. */
export const linearSearchSource = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');

  // walking the collection
  const Length = unop(Values, (v) => Index(v.length));
  const Before = binop(Index, Index, (a, b) => Flag(a < b));
  const Next = unop(Index, (p) => Index(p + 1));

  // what the algorithm does
  const Equal = binop(Int, Int, (a, b) => Flag(a === b));
</script>
<script lang="sverlin" input>
  const values = Values([3, 8, 5, 2, 7]);
  const target = Int(2);
</script>
<script lang="sverlin">
  @start[let found = Flag(false);
  let searching = Flag(true);]
  for (let i = Index(0); Before(i, Length(values)); i = Next(i)) @check{
    found = Equal(values[i], target);
    if (found) break;
  }
  @finish[searching = false;]
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet IntTally(value: Int)}
  <Node layout="column">
    <Node {value} />
    <Node tags="tally">{'•'.repeat(value)}</Node>
  </Node>
{/snippet}
{#snippet IndexText(i: Index)}<Node value={i} />{/snippet}
{#snippet Row(list: Values)}
  <Node layout="row">
    {#each list as value, k}
      <Node layout="column">
        {@render Int(value)}
        <Node tags="index">{k}</Node>
      </Node>
    {/each}
  </Node>
{/snippet}
{#snippet Current(i: Index)}
  <Node layout="column">
    <Pointed tags={['current', found && 'found']} />
    <Node tags="label">i</Node>
  </Node>
{/snippet}
<Node tags="title">Linear search</Node>
<Node tags="caption">Find {@render Int(target)} by checking each cell in order.</Node>
{@render Row(values)}
{@render Current(i)}
<Node tags="status">
  {#if found}Found {@render Int(target)} at index {@render Index(i)}.{:else if !searching}{@render Int(target)} is not in the array.{:else if step === 0}Start at the first cell.{:else}Checking index {@render Index(i)}.{/if}
</Node>`;
