import { describe, expect, it } from 'vitest';
import { drawnSteps } from './testing/scenes';

/**
 * A breadth-first search whose graph is a free layout, with two pointers that are never at one
 * vertex together, the vertex taken and the neighbour checked: they share one slot round each
 * vertex, and their labels differ in width.
 */
const bfs = `<script domain>
  const Name = type(['A', 'B', 'C', 'D', 'E']);
  const Seen = type('boolean');
  const Vertex = record({ name: Name, seen: Seen });
  const Vertices = array(Vertex, { max: 5 });
  const VertexRef = index(Vertices);
  const Neighbours = array(VertexRef, { max: 2 });
  const Slot = index(Neighbours);
  const Adjacency = array(Neighbours, { max: 5 });
  const Queue = array(VertexRef, { max: 3 });
</script>

<script input>
  const vertices = Vertices;
  const out = Adjacency;
</script>

<script algorithm>
  @init[let queue = Queue([0]);
  vertices[0].seen = true;]
  while (@more[queue.length > 0]) @visit{
    @take[const current = queue.shift();
    const around = out[current];]
    for (@first[let slot = Slot(around, 0)]; @another[slot < around.length]; @step[slot++]) @look{
      const w = around[slot];
      if (@check[vertices[@next[w]].seen === false]) @add{
        vertices[w].seen = true;
        queue.push(w);
      }
    }
  }
</script>

<View of="Name" name="NameText"><Node value={this} /></View>
<View of="Vertex" name="VertexCard">
  <Node layout="row">{this.name}<Node kind="Discovery" icon={this.seen} /></Node>
</View>
<View of="VertexRef" name="Mark">
  <Node layout="column"><Pointed /><Node kind="PointerLabel">{place()}</Node></Node>
</View>

<Layout name="Graph">
  <Node layout="free">
    {#each vertices as v, k}
      {v}
      {#each out[k] as w}<Link from={k} to={w} />{/each}
    {/each}
  </Node>
</Layout>
<Layout name="Main">
  <Node layout="column">
    <Graph />
    {current}
    {@visit.look.check.next}
  </Node>
</Layout>

<Case name="main" vertices={[
  { name: 'A', seen: false },
  { name: 'B', seen: false },
  { name: 'C', seen: false },
  { name: 'D', seen: false },
  { name: 'E', seen: false }
]} out={[[1, 2], [3], [3, 4], [], []]} />

<Storyboard>
  <Scene name="bfs" case="main" pause="@init, @visit.take, @visit.look.check"><Main /></Scene>
</Storyboard>`;

const views = {
  'a label below':
    '<Node layout="column"><Pointed /><Node kind="PointerLabel">{place()}</Node></Node>',
  'a label beside':
    '<Node layout="row"><Pointed /><Node kind="PointerLabel">{place()}</Node></Node>',
  'a bracket': '<Node layout="row"><Node kind="PointerLabel">[</Node><Pointed /></Node>'
};
const graphs = {
  'a free layout': '<Node layout="free">',
  'a row': '<Node layout="row">'
};
const variants = Object.entries(views).flatMap(([view, markup]) =>
  Object.entries(graphs).map(([graph, opening]) => [view, graph, markup, opening] as const)
);

describe('pointers sharing a slot', () => {
  it.each(variants)(
    'draw a vertex where it is, whichever of them is at it, or none: %s, in %s',
    async (_, __, markup, opening) => {
      const source = bfs
        .replace(
          '<Node layout="column"><Pointed /><Node kind="PointerLabel">{place()}</Node></Node>',
          markup
        )
        .replace('  <Node layout="free">', `  ${opening}`);
      const { steps } = await drawnSteps(source, {
        chosen: { ':visit.look.check.next.label': 'neighbour checked' }
      });
      const cards = steps.flatMap((step) =>
        step.nodes.filter((node) => node.kind === 'VertexCard' || node.kind === 'Mark.Pointed')
      );
      expect(cards.some((node) => node.kind === 'Mark.Pointed')).toBe(true);
      const boxes = new Map<string, Set<string>>();
      for (const { id, box } of cards)
        boxes.set(
          id,
          (boxes.get(id) ?? new Set()).add(
            [box.x, box.y, box.width, box.height].map((value) => Math.round(value)).join(',')
          )
        );
      expect([...boxes].filter(([, each]) => each.size > 1)).toEqual([]);
    }
  );
});
