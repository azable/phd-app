/** Authored source starter and editor identity for the Svelte-backed mode. */

export const sverlinStarter = {
  path: 'Main.svelte',
  language: 'svelte',
  mediaType: 'text/x-svelte',
  source:
    '<script algorithm>\n</script>\n<Layout name="Title"><Node>Start your visualization</Node></Layout>\n<Layout name="Stacked">\n  <Node><Title /></Node>\n</Layout>\n<Storyboard>\n  <Scene name="main"><Stacked /></Scene>\n</Storyboard>\n'
} as const;

/** A small self-contained algorithm example for administrator projects. */
export const linearSearchSource = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 5 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
  const target = Int;
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
<View of="Int" name="IntCell"><Node value={this} /></View>
<View of="Int" name="IntTally">
  <Node layout="column">
    <Node value={this} />
    <Node kind="Tally">{'•'.repeat(this)}</Node>
  </Node>
</View>
<View of="Values" name="Row">
  <Node layout="row">
    {#each this as value, k}
      <Node layout="column">
        {value}
        <Node kind="Under">{k}</Node>
      </Node>
    {/each}
  </Node>
</View>
<View of="Index" name="Highlight">
  <Node layout="column">
    <Link to={this} />
    <Node kind="Name">{place()}</Node>
  </Node>
</View>
<Layout name="Title"><Node>Linear search</Node></Layout>
<Layout name="Caption"><Node>Find {target} by checking each cell in order.</Node></Layout>
<View of="@check.equal" name="Ask"><Node>is {this.left} equal to {this.right}?</Node></View>
<Layout name="Checking">
  <Node layout="row"><Node>Checking index</Node><Node kind="Number" value={i} />{@check.equal}</Node>
</Layout>
<Layout name="Result">
  <Node layout="row"><Node>Found {target} at index</Node><Node kind="Number" value={found} /></Node>
</Layout>

<Layout name="Main">
  <Node>
    <Title />
    <Caption />
    {values}
    <Node kind="Marks" layout="row"><Node>{i}</Node><Node>{found}</Node></Node>
    <Checking />
    <Node when="@run" layout="column"><Result /></Node>
  </Node>
</Layout>

<Case name="main" values={[3, 8, 5, 2, 7]} target={2} />

<Storyboard>
  <Scene name="search" case="main" pause="@first.end, @check.equal.end, @next.end, @run.end">
    <Main />
  </Scene>
</Storyboard>`;
