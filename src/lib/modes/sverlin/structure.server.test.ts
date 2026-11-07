import { describe, expect, it } from 'vitest';

import { prepareSvelteComponent } from './compile.server';
import bfs from './fixtures/bfs-visit-order.sverlin?raw';
import bst from './fixtures/bst.sverlin?raw';
import undirected from './fixtures/bfs-undirected.sverlin?raw';
import reversal from './fixtures/list-markers.sverlin?raw';
import { propOptions } from './library/node/design';

const list = `<script domain>
  const Name = type(['A', 'B', 'C']);
  const End = type(['end']);
  const ListNode = record({ name: Name, next: Next });
  const ListNodes = pool(ListNode, { max: 3 });
  const NodeRef = ref(ListNode);
  const Next = union(NodeRef, End);
</script>
<script input>
  const nodes = ListNodes;
  const head = NodeRef;
</script><Case name="main" head={nodes.add(ListNode({ name: 'A', next:
    nodes.add(ListNode({ name: 'B', next: nodes.add(ListNode({ name: 'C', next: End('end') })) }))
  }))} />
<script algorithm>
  @run[let cur = Next(head);]
  while (@guard[cur !== 'end']) @visit{
    cur = cur.next;
  }
</script>
<View of="Name" name="NameCell"><Node value={this} /></View>
<View of="End" name="EndMark"><Node>∅</Node></View>
<View of="ListNode" name="NodeBox">
  <Node layout="row">{this.name}<Node kind="NextField"><Link to={this.next} /></Node></Node>
</View>
<Layout name="List">
  <Node layout="free">{#each nodes as node}{node}{/each}</Node>
</Layout>

<Layout name="Main">
  <Node>
    <List />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main /></Scene>
</Storyboard>`;

const ring = `<script domain>
  const Name = type(['A', 'B', 'C', 'D']);
  const Names = array(Name, { max: 8 });
  const Position = index(Names);
  const Nexts = array(Position, { max: 8 });
</script>
<script input>
  const names = Names;
  const next = Nexts;
</script><Case name="main" names={['A', 'B', 'C', 'D']} next={[1, 2, 3, 0]} />
<script algorithm>
  @run[let at = Position(0);]
  @first[at = next[at];]
  @second[at = next[at];]
</script>
<View of="Name" name="NameCell"><Node value={this} /></View>
<Layout name="Ring">
  <Node layout="free">
    {#each names as name, k}{name}<Link from={k} to={next[k]} />{/each}
  </Node>
</Layout>

<Layout name="Main">
  <Node>
    <Ring />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main /></Scene>
</Storyboard>`;

const unlinked = `<script domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Position = index(Values);
</script>
<script input>
  const values = Values;
</script><Case name="main" values={[3, 1, 2]} />
<script algorithm>
  @run[let i = Position(0);]
  @move[i = Position(1);]
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
<Layout name="Cells"><Node layout="free">{#each values as v}{v}{/each}</Node></Layout>

<Layout name="Main">
  <Node>
    <Cells />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main /></Scene>
</Storyboard>`;

const designOf = (source: string) => prepareSvelteComponent(source).design;

describe('free layout structures', () => {
  it('follow a record’s reference field, as a linked list’s next', () => {
    expect(designOf(list).structures).toEqual({ List: 'path' });
  });

  it('follow every field a view of a reference draws, as a tree’s left and right', () => {
    expect(designOf(bst).structures).toEqual({ Tree: 'tree' });
  });

  it('follow a position each element’s link reads, closing a ring', () => {
    expect(designOf(ring).structures).toEqual({ Ring: 'cycle' });
  });

  it('follow neighbour lists an {#each} inside the layout walks, making layers', () => {
    expect(designOf(bfs).structures).toEqual({ Graph: 'layers' });
  });

  it('read neighbour lists naming each other as undirected, a tree or layers from the first', () => {
    expect(designOf(undirected).structures).toEqual({ Graph: 'layers' });
    const edges = (lists: string) =>
      designOf(undirected.replace('[[1, 2], [0, 3], [0, 3], [1, 2, 4], [3]]', lists)).structures;
    // Directed, B and C both lead to D, in layers; both ways, A to B, C, D and B to E make a tree.
    expect(edges('[[1, 2], [3], [3], [4], []]')).toEqual({ Graph: 'layers' });
    expect(edges('[[1, 2, 3], [0, 4], [0], [0], [1]]')).toEqual({ Graph: 'tree' });
    expect(edges('[[1], [0, 2], [1, 3], [2, 4], [3]]')).toEqual({ Graph: 'path' });
    expect(edges('[[1, 4], [0, 2], [1, 3], [2, 4], [3, 0]]')).toEqual({ Graph: 'cycle' });
  });

  it('pair links into two-way lines only within one <Link>', () => {
    // Each edge listed from its source alone, drawn forward by one <Link> and back by another:
    // two arrows each way, so no undirected structure, and arrows to start.
    const twoTags = undirected
      .replace('[[1, 2], [0, 3], [0, 3], [1, 2, 4], [3]]', '[[1, 2], [3], [3], [4], []]')
      .replace('<Link from={k} to={w} />', '<Link from={k} to={w} /><Link from={w} to={k} />');
    const design = designOf(twoTags);
    expect(design.structures).not.toEqual(designOf(undirected).structures);
    expect(design.starter).toMatchObject({ 'Graph.<Link>.head': 'arrow' });
    expect(designOf(undirected).starter).toMatchObject({ 'Graph.<Link>.head': 'none' });
  });

  it('are none where nothing links the elements, or the links change from step to step', () => {
    expect(designOf(unlinked).structures).toEqual({ Cells: 'none' });
    expect(designOf(reversal).structures).toEqual({ Nodes: 'none' });
  });

  it('start each layout natural, running the way its structure does, with every form it takes', () => {
    const starts = [list, bst, ring, bfs].map((source) => {
      const { space, starter, structures } = designOf(source);
      const [kind] = Object.keys(space)
        .filter((key) => key.endsWith('.form'))
        .map((key) => key.slice(0, -'.form'.length));
      return {
        form: starter[`${kind}.form`],
        direction: starter[`${kind}.direction`],
        curve: starter[`${kind}.curve`],
        forms: space[`${kind}.form`],
        structure: structures[kind],
        directions: space[`${kind}.direction`]
      };
    });
    expect(starts.every(({ form, curve }) => form === 'natural' && curve === 'straight')).toBe(
      true
    );
    // Every form, but layered only where the links make layers.
    for (const { forms, structure } of starts)
      expect(forms).toEqual(
        propOptions.form.filter((form) => form !== 'layered' || structure === 'layers')
      );
    // Every structure starts running right, across the wide stage, a tree too.
    expect(starts.map(({ direction }) => direction)).toEqual(['right', 'right', 'right', 'right']);
    expect(starts.map(({ directions }) => directions?.join())).toEqual([
      'down,right',
      'down,right',
      'down,right',
      'down,right'
    ]);
    // A layout whose data makes no structure has no form, as the page lays it out freely.
    const free = designOf(unlinked).space;
    expect(Object.keys(free).some((key) => /\.(form|direction)$/u.test(key))).toBe(false);
    expect(Object.keys(free).some((key) => key.endsWith('.layoutSeed'))).toBe(true);
  });
});
