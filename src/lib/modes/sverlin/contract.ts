/** Authored source starter and editor identity for the Svelte-backed mode. */

export const sverlinStarter = {
  path: 'Main.svelte',
  language: 'svelte',
  mediaType: 'text/x-svelte',
  source:
    '<script lang="sverlin">\n</script>\n{#snippet Title()}<Node>Start your visualization</Node>{/snippet}\n{@render Title()}\n'
} as const;

/** A small self-contained algorithm example for administrator projects. */
export const linearSearchSource = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');

  // walking the collection
  const Length = unop((v: Values) => Index(v.length));
  const Before = binop((a: Index, b: Index) => Flag(a < b));
  const Next = unop((p: Index) => Index(p + 1));

  // what the algorithm does
  const Equal = binop((a: Int, b: Int) => Flag(a === b));
</script>
<script lang="sverlin" input>
  const values = Values([3, 8, 5, 2, 7]);
  const target = Int(2);
</script>
<script lang="sverlin">
  function search(a, target) {
    for (let i = Index(0); Before(i, Length(a)); i = Next(i)) @check{
      if (Equal(a[i], target)) return i;
    }
    @missing[return Index(-1);]
  }
  const found = search(values, target);
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet IntTally(value: Int)}
  {#snippet Tally()}<Node>{'•'.repeat(value)}</Node>{/snippet}
  <Node layout="column">
    <Node {value} />
    {@render Tally()}
  </Node>
{/snippet}
{#snippet IndexText(i: Index)}<Node value={i} />{/snippet}
{#snippet Row(list: Values)}
  <Node layout="row">
    {#each list as value, k}
      {#snippet Under()}<Node>{k}</Node>{/snippet}
      <Node layout="column">
        {@render Int(value)}
        {@render Under()}
      </Node>
    {/each}
  </Node>
{/snippet}
{#snippet Highlight(p: Index)}<Pointed />{/snippet}
{#snippet Title()}<Node>Linear search</Node>{/snippet}
{#snippet Caption()}<Node>Find {@render Int(target)} by checking each cell in order.</Node>{/snippet}
{#snippet Ask(e: Equal)}<Node>is {@render Int(e.a)} equal to {@render Int(e.b)}?</Node>{/snippet}
{#snippet Checking()}<Node>Checking index {@render Index(i)}: {@render Equal(@check)}</Node>{/snippet}
{#snippet Result()}<Node>Found {@render Int(target)} at index {@render Index(found)}.</Node>{/snippet}
{@render Title()}
{@render Caption()}
{@render Values(values)}
{@render Index(i)}
{@render Index(found)}
{@render Checking()}
{@render Result()}`;
