/**
 * Where a comment is drawn beside the elements it is on, in the canvas's pixels: its badge just
 * outside the top right corner of the box round them, and its card, once opened, on the side of
 * that box with the most room, joined to it by a leader line, as canvas tools (Figma, Miro) place
 * theirs.
 */

/** A box on the canvas. */
export type CanvasBox = { left: number; top: number; width: number; height: number };
export type CanvasPoint = { x: number; y: number };
export type CardSide = 'right' | 'left' | 'below' | 'above';
export type CardPlace = {
  side: CardSide;
  left: number;
  top: number;
  /** The leader line, from the elements' box to the card. */
  from: CanvasPoint;
  to: CanvasPoint;
};

/** The side of a badge, in pixels: a small mark, as a canvas tool's comment marker is. */
export const badgeSize = 16;
// The space between the elements and a badge or card, so neither touches their outline.
const gap = 4;
const cardGap = 12;

/**
 * What a comment is drawn beside: the boxes of its elements the step draws, and the box round
 * them; on no element, its point; nothing where the step draws none of its elements, though it
 * has a point, as the point was clicked to pick them.
 */
export function commentAnchor(
  on: { elements?: readonly string[]; point?: CanvasPoint },
  boxOf: (id: string) => CanvasBox | undefined
): { boxes: CanvasBox[]; box: CanvasBox } | undefined {
  if (on.elements?.length) {
    const boxes = on.elements.flatMap((id) => boxOf(id) ?? []);
    const box = unionBox(boxes);
    return box && { boxes, box };
  }
  return on.point && { boxes: [], box: { left: on.point.x, top: on.point.y, width: 0, height: 0 } };
}

/** The smallest box round all of these; none round none. */
export function unionBox(boxes: readonly CanvasBox[]): CanvasBox | undefined {
  if (!boxes.length) return undefined;
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.left + box.width));
  const bottom = Math.max(...boxes.map((box) => box.top + box.height));
  return { left, top, width: right - left, height: bottom - top };
}

/** The overlap of two boxes; none where they do not overlap. */
export function overlap(a: CanvasBox, b: CanvasBox): CanvasBox | undefined {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : undefined;
}

/**
 * A badge's top left corner: just outside the box's top right corner, so it covers none of the
 * elements, moved inside the limit where it would leave it.
 */
export function badgeAt(anchor: CanvasBox, limit: CanvasBox): CanvasPoint {
  return {
    x: clamp(anchor.left + anchor.width + gap, limit.left, limit.left + limit.width - badgeSize),
    y: clamp(anchor.top - badgeSize - gap, limit.top, limit.top + limit.height - badgeSize)
  };
}

/**
 * Where a card of this size goes beside the box: on the side with the most room left within the
 * room once the card is there (right first where two have as much), outside the box, aligned
 * with its top or left edge, and kept inside the room where it can be.
 */
export function cardPlacement(
  anchor: CanvasBox,
  card: { width: number; height: number },
  room: CanvasBox
): CardPlace {
  const right = anchor.left + anchor.width;
  const bottom = anchor.top + anchor.height;
  const free: Record<CardSide, number> = {
    right: room.left + room.width - right - cardGap - card.width,
    left: anchor.left - room.left - cardGap - card.width,
    below: room.top + room.height - bottom - cardGap - card.height,
    above: anchor.top - room.top - cardGap - card.height
  };
  const side = (['right', 'left', 'below', 'above'] as const).reduce((best, next) =>
    free[next] > free[best] ? next : best
  );
  const across = (start: number, size: number, from: number, length: number) =>
    clamp(start, from, from + length - size);
  const left =
    side === 'right'
      ? right + cardGap
      : side === 'left'
        ? anchor.left - cardGap - card.width
        : across(anchor.left, card.width, room.left, room.width);
  const top =
    side === 'below'
      ? bottom + cardGap
      : side === 'above'
        ? anchor.top - cardGap - card.height
        : across(anchor.top, card.height, room.top, room.height);
  const placed = { left, top, ...card };
  const from = nearestPoint(anchor, centre(placed));
  return { side, left, top, from, to: nearestPoint(placed, from) };
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, Math.max(low, high)));

const centre = (box: CanvasBox): CanvasPoint => ({
  x: box.left + box.width / 2,
  y: box.top + box.height / 2
});

/** The point of a box nearest to a point. */
function nearestPoint(box: CanvasBox, point: CanvasPoint): CanvasPoint {
  return {
    x: clamp(point.x, box.left, box.left + box.width),
    y: clamp(point.y, box.top, box.top + box.height)
  };
}
