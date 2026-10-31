import type { Reader } from './reader';

/**
 * What is seen of the node drawing an element, which an arrow to it meets: the node itself where it
 * draws a box of its own, a stroke or a fill (data-sv-framed, from its own look, so a pointer
 * painting it at some steps does not move the arrow); else the outermost such boxes inside it, as a
 * vertex's name cell rather than the column holding it and its caption; else the node itself.
 */
export function seenParts<E>(read: Reader<E>, node: E): E[] {
  if (read.attribute(node, 'data-sv-framed')) return [node];
  const found: E[] = [];
  const walk = (parent: E) => {
    for (const child of read.children(parent)) {
      if (read.attribute(child, 'data-sv-hidden') === 'true') continue;
      if (
        read.attribute(child, 'data-sv-node') !== undefined &&
        read.attribute(child, 'data-sv-framed')
      )
        found.push(child);
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
