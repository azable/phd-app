/**
 * Boxes read in layout pixels, whatever the frame's scale. Rects come back through the frame's and
 * the root's scale transforms, with rounding that depends on the scale, so a layout recorded from
 * them would differ with the window's size and with whether the root was fitted yet. Each is
 * divided by the scale and snapped back to the 64ths of a pixel the browser lays out in (Chrome and
 * Safari; Firefox lays out in 60ths, where this leaves under a 128th of a pixel).
 */

const layoutUnit = 64;

/** How much an element is scaled on screen: its and its ancestors' scale transforms together. */
export function screenScale(element: Element): number {
  let scale = 1;
  for (let at: Element | null = element; at; at = at.parentElement) {
    const transform = getComputedStyle(at).transform;
    if (transform !== 'none') scale *= new DOMMatrixReadOnly(transform).a;
  }
  return scale;
}

/** Screen pixels at a scale, as the layout pixels they were laid out in. */
export function unscaled(pixels: number, scale: number): number {
  return Math.round((pixels / scale) * layoutUnit) / layoutUnit;
}

/** Where `inner` sits in `outer`, in layout pixels, both scaled by `scale` on screen. */
export function unscaledBox(
  inner: Element,
  outer: DOMRect,
  scale: number
): { x: number; y: number; width: number; height: number } {
  const rect = inner.getBoundingClientRect();
  return {
    x: unscaled(rect.left - outer.left, scale),
    y: unscaled(rect.top - outer.top, scale),
    width: unscaled(rect.width, scale),
    height: unscaled(rect.height, scale)
  };
}
