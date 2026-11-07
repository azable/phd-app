/**
 * Nodes and references in the scenes the server draws: a node's next as an arrow from the node its
 * view draws, the end drawn by its own view, and a node nothing refers to staying in its pool.
 */

import { expect, it } from 'vitest';

import { pausingEveryLabel } from './testing/every-pause';
import { drawnSteps, endsOf, isInside, ofKind, textOf, within } from './testing/scenes';

const list = (algorithm: string) => `<script domain>
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
    nodes.add(ListNode({ name: 'B', next: nodes.add(ListNode({ name: 'C', next: End('end') })) })) }))} />
<script algorithm>${algorithm}</script>
<View of="Name" name="NameCell"><Node value={this} /></View>
<View of="End" name="EndMark"><Node>∅</Node></View>
<View of="ListNode" name="NodeBox">
  <Node layout="row">{this.name}<Node kind="NextField"><Link to={this.next} /></Node></Node>
</View>
<Layout name="List"><Node layout="free">{#each nodes as n}{n}{/each}</Node></Layout>

<Layout name="Main">
  <Node>
    <List />
  </Node>
</Layout>

<Storyboard>
  <Scene name="main" case="main"><Main /></Scene>
</Storyboard>`;

/**
 * Each step's arrows, between the names of the nodes they join, as written and as drawn (from the
 * next field it leaves to the name cell its tip meets), and its nodes' text.
 */
async function play(source: string, count: number) {
  // Each name, next field and end framed, as the template's $cell draws a value: the end is a
  // member of next's union, drawn as the node it stands beside is.
  const { steps } = await drawnSteps(pausingEveryLabel(source), {
    chosen: {
      'NameCell.inherit': '$cell',
      'NodeBox.NextField.inherit': '$cell',
      'EndMark.inherit': '$cell'
    }
  });
  return steps.slice(0, count).map((step) => {
    const boxes = ofKind(step, 'NodeBox');
    const nameOf = (box: (typeof boxes)[number] | undefined) =>
      textOf(
        step,
        ofKind(step, 'NameCell').find((cell) => isInside(step, cell, box))
      );
    // Links name their ends by slot, nodes[k], and the pool draws its nodes in that order.
    const byKey = (key: string) => boxes[Number(/\[(\d+)\]$/u.exec(key)?.[1])];
    const near = (point: { x: number; y: number }, kind: string) =>
      ofKind(step, kind).find(({ box }) => within(point, box, 4));
    const attached = step.links.map((link) => {
      const [start, end] = endsOf(link);
      const field = near(start, 'NodeBox.NextField');
      const from = boxes.find((box) => field && isInside(step, field, box));
      return `${nameOf(from) || '?'}→${textOf(step, near(end, 'NameCell')) || '?'}`;
    });
    return {
      arrows: step.links
        .map(({ from, to }) => `${nameOf(byKey(from))}→${nameOf(byKey(to))}`)
        .sort(),
      attached: attached.sort(),
      nodes: boxes.map((box) => textOf(step, box)).sort()
    };
  });
}

it(
  "draws each node's next as an arrow, and the end with its view, as a list is reversed",
  { timeout: 60_000 },
  async () => {
    const steps = await play(
      list(`
  @start[let prev = Next(End('end'));
  let cur = Next(head);]
  while (@more[cur !== 'end']) @rewire{
    const after = cur.next;
    cur.next = prev;
    prev = cur;
    cur = after;
  }`),
      4
    );
    expect(steps.map(({ arrows }) => arrows)).toEqual([
      ['A→B', 'B→C'],
      ['B→C'],
      ['B→A'],
      ['B→A', 'C→B']
    ]);
    // Each arrow leaves its node's next field and meets the name of the node it points at.
    expect(steps.map(({ attached }) => attached)).toEqual(steps.map(({ arrows }) => arrows));
    // The end is drawn by its view where a node's next is the end.
    expect(steps[0].nodes).toEqual(['A', 'B', 'C ∅']);
    expect(steps[3].nodes).toEqual(['A ∅', 'B', 'C']);
  }
);

it(
  'keeps a node nothing refers to any more in its pool, its own link still drawn',
  { timeout: 60_000 },
  async () => {
    const steps = await play(list(`@unlink[head.next = head.next.next;]`), 2);
    expect(steps[0].nodes).toEqual(['A', 'B', 'C ∅']);
    expect(steps[1].nodes).toEqual(['A', 'B', 'C ∅']);
    expect(steps[1].arrows).toEqual(['A→C', 'B→C']);
    // Drawn from A's field to C, not along the route B's link to C had.
    expect(steps[1].attached).toEqual(['A→C', 'B→C']);
  }
);
