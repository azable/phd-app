/** Authored source starter and editor identity for the Svelte-backed mode. */

export const sverlinStarter = {
  path: 'Main.svelte',
  language: 'svelte',
  mediaType: 'text/x-svelte',
  source:
    '<script lang="sverlin">\n  yield "Start";\n</script>\n<Node size="xlarge" weight="bold">Start your visualization</Node>\n<Node color="neutral">Step {step + 1} · seed {seed}</Node>\n'
} as const;

/** A small self-contained algorithm example for administrator projects. */
export const linearSearchSource = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Found = type('boolean');
  const Values = collection(Int);
  const Index = index(Values);
</script>
<script lang="sverlin" input>
  const values = Values([3, 8, 5, 2, 7]);
  const target = Int(2);
</script>
<script lang="sverlin">
  let i = Index(-1);
  let found = Found(false);
  yield 'Start';
  for (i = Index(0); i < values.length; i++) {
    if (values[i] === target) {
      found = Found(true);
      yield \`Found \${target} at index \${i}\`;
      break;
    }
    yield \`Compare index \${i}\`;
  }
  if (!found) yield 'Not found';
</script>
<script lang="sverlin" design>
  // Layout of the array.
  const flow = pick(['row', 'column']);
  const spacing = pick(['small', 'medium', 'large']);
  // How every Int cell is drawn, through the Int renderer below.
  const cellRadius = pick(['small', 'medium', 'full']);
  const cellStroke = pick(['none', 'thin', 'thick']);
  const cellPadding = pick(['small', 'medium']);
  const cellFont = pick(['sans', 'mono']);
  // What the colours mean stays fixed; which colours show it is drawn.
  const visitedColour = pick(['blue', 'purple']);
  const currentColour = pick(['amber', 'red']);
  const fadeUnchecked = chance(0.5);
  // Annotations.
  const showIndices = chance(0.5);
  const pointerName = pick(['i', 'index', '↑']);
  // Text.
  const titleSize = pick(['large', 'xlarge']);
  const textFont = pick(['sans', 'serif']);
  const noteShape = pick(['card', 'plain']);
  const textSize = real(0.95, 1.2);
</script>
{#snippet Int(value, node)}
  <Node
    radius={cellRadius}
    strokeWidth={cellStroke}
    padding={cellPadding}
    font={cellFont}
    {value}
    {...node}
  />
{/snippet}
<Node size={titleSize} weight="bold" font={textFont}>Linear search</Node>
<Node color="neutral" font={textFont}>Find {target} by checking each cell in order.</Node>
<Node items={values} layout={flow} gap={spacing}>
  {#snippet item(value, index, type)}
    <Node layout="column" gap="small">
      {@const colour =
        index === i ? (found ? 'green' : currentColour) : index < i ? visitedColour : undefined}
      {#if showIndices}<Node size="small" color="neutral">{index}</Node>{/if}
      <Node
        {value}
        {type}
        fill={colour}
        stroke={colour}
        opacity={fadeUnchecked && i >= 0 && index > i ? 0.45 : undefined}
      />
      {#if index === i}<Node size="small" color="neutral" weight="bold">{pointerName}</Node>{/if}
    </Node>
  {/snippet}
</Node>
<Node
  shape={noteShape}
  fill={found ? 'green' : undefined}
  stroke={found ? 'green' : undefined}
  font={textFont}
  size={textSize}
>
  {#if i < 0}Start at the first cell.{:else if found}Found {target} at index {i}.{:else if i < values.length}{values[i]} is not {target}; move right.{:else}{target} is not in the array.{/if}
</Node>`;
