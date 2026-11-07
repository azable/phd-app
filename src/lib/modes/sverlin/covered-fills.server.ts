/**
 * Fills nobody sees, told to the assistant: a node's fill, its kind's or the paint a link's end
 * gives it, that opaque fills of the nodes inside it, drawn over it, cover at every step it shows.
 * The design's value then changes nothing in the picture, so it is a look only and sends no version
 * back (see designOnlyWarning).
 */

import { cssColour } from './library/colour';
import type { SceneBox, SceneNode, SceneStep } from './library';
import { designOnlyWarning, named } from './padding-warnings.server';

/**
 * The share of a fill's area that may show past the fills over it while it still counts as unseen:
 * 5%. A child's rounded corners leave (4 − π)r² of a square box uncovered, 2.2% for the starter's
 * 80-pixel value with its 12.8-pixel radius, and 5% for a radius 0.24 of the box's side, so such
 * corners stay under it; a circle in a square leaves 21.5%, and padding of 1/16 of the side all round
 * leaves 23%, which read as the fill round the child and stay over it.
 */
const seenShare = 0.05;

/** Points sampled along each side of a covered box: 1/2304 of its area each, well under 5%. */
const samples = 48;

/** Whether a point lies inside a box whose corners are rounded by a radius. */
function inside(box: SceneBox, radius: number, x: number, y: number): boolean {
  if (x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height) return false;
  const r = Math.min(radius, box.width / 2, box.height / 2);
  const dx = Math.max(box.x + r - x, 0, x - (box.x + box.width - r));
  const dy = Math.max(box.y + r - y, 0, y - (box.y + box.height - r));
  return dx * dx + dy * dy <= r * r;
}

/** Whether a node paints its box solid: a fill at full opacity, of a colour with no transparency. */
const opaque = ({ look }: SceneNode) =>
  look.fill !== undefined && look.opacity === undefined && cssColour(look.fill)[3] === 1;

/**
 * The opaque nodes drawn over a node's box: those inside it, at any depth, except under a node
 * drawn at less than full opacity, which lets what is under it show.
 */
function opaqueInside(node: SceneNode, children: Map<string, SceneNode[]>): SceneNode[] {
  return (children.get(node.id) ?? []).flatMap((child) =>
    child.look.opacity !== undefined
      ? []
      : [...(opaque(child) ? [child] : []), ...opaqueInside(child, children)]
  );
}

/** The share of a node's rounded box that none of the boxes over it covers. */
function shownShare(node: SceneNode, over: readonly SceneNode[]): number {
  const { box } = node;
  let within = 0;
  let shown = 0;
  for (let i = 0; i < samples; i++)
    for (let j = 0; j < samples; j++) {
      const x = box.x + ((i + 0.5) * box.width) / samples;
      const y = box.y + ((j + 0.5) * box.height) / samples;
      if (!inside(box, node.look.radius ?? 0, x, y)) continue;
      within++;
      if (!over.some((each) => inside(each.box, each.look.radius ?? 0, x, y))) shown++;
    }
  return within ? shown / within : 1;
}

type Covered = { value: string; by?: string; colour: string };

/**
 * The covered-fill warnings of a build's drawn steps: for each fill's design key (`Kind.fill`, or a
 * link's end's, `Arrow.<Link>.<To>.fill`, where one paints the node), where at every step it shows
 * the opaque fills inside its node leave no more than seenShare of it showing; one warning for each
 * kind and colour covering them, naming up to kindsTold keys as the padding warnings do.
 */
export function coveredFillWarnings(steps: readonly SceneStep[]): string[] {
  const covered = new Map<string, Covered | undefined>();
  for (const step of steps) {
    const children = new Map<string, SceneNode[]>();
    for (const node of step.nodes)
      if (node.parent) children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
    const byId = new Map(step.nodes.map((node) => [node.id, node]));
    // Under a node drawn at less than full opacity, the nodes inside it let its fill show too.
    const translucent = (node: SceneNode | undefined): boolean =>
      !!node && (node.look.opacity !== undefined || translucent(byId.get(node.parent ?? '')));
    for (const node of step.nodes) {
      const owner = node.paintedBy ?? node.kind;
      if (!node.look.fill || !owner) continue;
      const key = `${owner}.fill`;
      if (covered.has(key) && !covered.get(key)) continue;
      const over = opaqueInside(node, children);
      // A glow with no stroke shows the fill's colour round the box.
      const glowing = !node.look.stroke && node.look.glow === node.look.fill;
      if (!over.length || glowing || translucent(node) || shownShare(node, over) > seenShare) {
        covered.set(key, undefined);
        continue;
      }
      if (covered.has(key)) continue;
      const area = ({ box }: SceneNode) => box.width * box.height;
      const cover = over.reduce((most, each) => (area(each) > area(most) ? each : most));
      covered.set(key, {
        value: node.colours?.fill ?? node.look.fill,
        by: cover.paintedBy ?? cover.kind,
        colour: cover.colours?.fill ?? (cover.look.fill as string)
      });
    }
  }

  const byCover = new Map<string, { by?: string; colour: string; keys: string[] }>();
  for (const [key, each] of covered) {
    if (!each) continue;
    const group = `${each.by}|${each.colour}`;
    const told = byCover.get(group) ?? { by: each.by, colour: each.colour, keys: [] };
    told.keys.push(`\`${key}\` (${each.value})`);
    byCover.set(group, told);
  }
  return [...byCover.values()].map(({ by, colour, keys }) => {
    const one = keys.length === 1;
    const cover = by ? `\`${by}\`` : 'a node inside it';
    const advice = by
      ? ` Give ${cover} no fill, or put the colour${one ? '' : 's'} on ${cover}.`
      : ' Give the nodes inside no fill, or put the colour on them.';
    return `${named(keys)} ${one ? 'is' : 'are'} never seen: ${cover} fills the whole box over ${one ? 'it' : 'each'}, in ${colour}.${advice} ${designOnlyWarning}`;
  });
}
