/**
 * A step's markup as plain data: elements with their attributes, inline style and children, and
 * text. It is what the layout model reads (see layout.ts), from Svelte's string render or from a
 * mounted layer, and nothing about layout or computed style is in it.
 */

export type ModelElement = {
  tag: string;
  attributes: Readonly<Record<string, string>>;
  /** Inline declarations, by property; lengths at full precision. */
  style: Readonly<Record<string, string>>;
  children: readonly ModelNode[];
};

export type ModelNode = ModelElement | string;

export const isElement = (node: ModelNode): node is ModelElement => typeof node !== 'string';

export function classesOf(element: ModelElement): string[] {
  return (element.attributes.class ?? '').split(/\s+/u).filter(Boolean);
}

/**
 * A mounted element as markup: its attributes, its inline declarations and its children, reading
 * nothing laid out. Lengths a script set come back at full precision, as the style attribute rounds
 * them to six digits (a solved layout's 161.9997px reads 162px there).
 */
export function treeOf(
  element: Element,
  deep = true,
  elements?: Map<ModelElement, Element>
): ModelElement {
  const attributes: Record<string, string> = {};
  for (const { name, value } of element.attributes) if (name !== 'style') attributes[name] = value;
  const style: Record<string, string> = {};
  if (element instanceof HTMLElement || element instanceof SVGElement)
    for (const property of element.style) {
      const typed = element.attributeStyleMap.get(property);
      style[property] =
        typed instanceof CSSUnitValue && typed.unit === 'px'
          ? `${typed.value}px`
          : element.style.getPropertyValue(property);
    }
  const children: ModelNode[] = [];
  if (deep)
    for (const child of element.childNodes)
      if (child.nodeType === Node.TEXT_NODE) children.push((child as Text).data);
      else if (child.nodeType === Node.ELEMENT_NODE)
        children.push(treeOf(child as Element, true, elements));
  const tree = { tag: element.localName, attributes, style, children };
  elements?.set(tree, element);
  return tree;
}
