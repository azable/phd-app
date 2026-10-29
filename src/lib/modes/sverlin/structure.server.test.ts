import { describe, expect, it } from 'vitest';

import { prepareSvelteComponent } from './compile.server';
import bfs from './fixtures/bfs-visit-order.sverlin?raw';
import bst from './fixtures/bst.sverlin?raw';
import undirected from './fixtures/bfs-undirected.sverlin?raw';
import reversal from './fixtures/list-markers.sverlin?raw';

const list = `<script lang="sverlin" domain>
  const Name = type(['A', 'B', 'C']);
  const End = type(['end']);
  const Flag = type('boolean');
  const ListNode = record({ name: Name, next: Next });
  const NodeRef = ref(ListNode);
  const Next = union(NodeRef, End);
  const IsNode = unop((p: Next) => Flag(p !== 'end'));
</script>
<script lang="sverlin" input>
  const head = NodeRef(ListNode({ name: 'A', next:
    NodeRef(ListNode({ name: 'B', next: NodeRef(ListNode({ name: 'C', next: End('end') })) }))
  }));
</script>
<script lang="sverlin">
  let cur = Next(head);
  while (IsNode(cur)) @visit{
    cur = cur.next;
  }
</script>
{#snippet NameCell(value: Name)}<Node {value} />{/snippet}
{#snippet EndMark(value: End)}<Node>∅</Node>{/snippet}
{#snippet NodeBox(node: ListNode)}
  {#snippet NextField()}<Node><Link to={node.next} /></Node>{/snippet}
  <Node layout="row">{@render Name(node.name)}{@render NextField()}</Node>
{/snippet}
{#snippet Heap()}
  <Node layout="free">{#each all(ListNode) as node}{@render ListNode(node)}{/each}</Node>
{/snippet}
{@render Heap()}`;

const ring = `<script lang="sverlin" domain>
  const Name = type(['A', 'B', 'C', 'D']);
  const Names = collection(Name);
  const Position = index(Names);
  const Nexts = collection(Position);
</script>
<script lang="sverlin" input>
  const names = Names(['A', 'B', 'C', 'D']);
  const next = Nexts([1, 2, 3, 0]);
</script>
<script lang="sverlin">
  let at = Position(0);
  @first[at = next[at];]
  @second[at = next[at];]
</script>
{#snippet NameCell(value: Name)}<Node {value} />{/snippet}
{#snippet Ring()}
  <Node layout="free">
    {#each names as name, k}{@render Name(name)}<Link from={k} to={next[k]} />{/each}
  </Node>
{/snippet}
{@render Ring()}`;

const unlinked = `<script lang="sverlin" domain>
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Position = index(Values);
</script>
<script lang="sverlin" input>
  const values = Values([3, 1, 2]);
</script>
<script lang="sverlin">
  let i = Position(0);
  @move[i = Position(1);]
</script>
{#snippet IntCell(value: Int)}<Node {value} />{/snippet}
{#snippet Cells()}<Node layout="free">{#each values as v}{@render Int(v)}{/each}</Node>{/snippet}
{@render Cells()}`;

const designOf = (source: string) => prepareSvelteComponent(source).design;

describe('free layout structures', () => {
  it('follow a record’s reference field, as a linked list’s next', () => {
    expect(designOf(list).structures).toEqual({ Heap: 'path' });
  });

  it('follow every field a view of a reference draws, as a tree’s left and right', () => {
    expect(designOf(bst).structures).toEqual({ Heap: 'tree' });
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
    expect(design.starter).toMatchObject({ 'Graph.Link.head': 'arrow' });
    expect(designOf(undirected).starter).toMatchObject({ 'Graph.Link.head': 'none' });
  });

  it('are none where nothing links the elements, or the links change from step to step', () => {
    expect(designOf(unlinked).structures).toEqual({ Cells: 'none' });
    expect(designOf(reversal).structures).toEqual({ Heap: 'none' });
  });

  it('start each layout in its structure’s natural form, offering the forms it can take', () => {
    const starts = [list, bst, ring, bfs].map((source) => {
      const { space, starter } = designOf(source);
      const [kind] = Object.keys(space)
        .filter((key) => key.endsWith('.form'))
        .map((key) => key.slice(0, -'.form'.length));
      return {
        form: starter[`${kind}.form`],
        curve: starter[`${kind}.curve`],
        offers: space[`${kind}.form`].includes(starter[`${kind}.form`])
      };
    });
    expect(starts.map(({ form }) => form)).toEqual(['line', 'tree-down', 'ring', 'layers-down']);
    expect(starts.every(({ curve, offers }) => curve === 'straight' && offers)).toBe(true);
    // The tree runs downwards (flow="y"), so forms running across are not offered.
    expect(designOf(bst).space['Heap.form']).not.toContain('tree-right');
    expect(designOf(ring).space['Ring.form']).toContain('ring');
    expect(designOf(list).space['Heap.form']).not.toContain('ring');
    // A layout whose data makes no structure has no form, as the page lays it out freely.
    const free = designOf(unlinked).space;
    expect(Object.keys(free).some((key) => key.endsWith('.form'))).toBe(false);
    expect(Object.keys(free).some((key) => key.endsWith('.layoutSeed'))).toBe(true);
  });
});
