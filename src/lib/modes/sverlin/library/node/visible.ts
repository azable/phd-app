/**
 * What is seen of the node drawing an element, which an arrow to it meets: the node itself where it
 * draws a box of its own, a stroke or a fill (data-sv-framed, from its own look, so a pointer
 * painting it at some steps does not move the arrow); else the outermost such boxes inside it, as a
 * vertex's name cell rather than the column holding it and its caption; else the node itself.
 */
export function seenParts(node: HTMLElement): HTMLElement[] {
  if (node.dataset.svFramed) return [node];
  const found: HTMLElement[] = [];
  const walk = (parent: Element) => {
    for (const child of parent.children) {
      if (!(child instanceof HTMLElement) || child.dataset.svHidden === 'true') continue;
      if (child.dataset.svNode !== undefined && child.dataset.svFramed) found.push(child);
      else walk(child);
    }
  };
  walk(node);
  return found.length ? found : [node];
}

/** The box around boxes given by their edges. */
export function unionOf<T extends { left: number; top: number; right: number; bottom: number }>(
  boxes: readonly T[]
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.min(...boxes.map(({ left }) => left)),
    top: Math.min(...boxes.map(({ top }) => top)),
    right: Math.max(...boxes.map(({ right }) => right)),
    bottom: Math.max(...boxes.map(({ bottom }) => bottom))
  };
}
