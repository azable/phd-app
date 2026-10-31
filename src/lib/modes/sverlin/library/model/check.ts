/**
 * How far the layout model (see layout.ts) is from the page's own layout of a mounted step: every
 * element's box as the model gives it from the step's markup, against where the page put it, in
 * layout pixels. Tests and the timing harness ask for it; nothing drawn depends on it.
 */

import { unscaledBox, screenScale } from '../node/unscaled';
import { parseSheet, type Rule } from './css';
import { layOut, type Box } from './layout';
import { canvasMeasure } from './text';
import { treeOf, type ModelElement } from './tree';

export type LayoutDifference = {
  /** The element's classes and node id, to find it by. */
  element: string;
  model: Box;
  page: Box;
};

export type LayoutCheck = {
  /** Elements compared, and those whose box the model gives to the 64th of a pixel. */
  elements: number;
  exact: number;
  /** The largest difference in any edge, in layout pixels. */
  largest: number;
  /** The elements most apart, largest first. */
  differences: LayoutDifference[];
  problems: string[];
};

/** The rules of the page's style sheets, the library's and the theme's, in order. */
export function pageRules(): Rule[] {
  const rules: Rule[] = [];
  for (const sheet of document.querySelectorAll('style'))
    rules.push(...parseSheet(sheet.textContent ?? '', rules.length));
  return rules;
}

/** An element's ancestors as markup alone, outermost first, for what they pass down. */
function ancestorsOf(element: Element): ModelElement[] {
  const chain: ModelElement[] = [];
  for (let at = element.parentElement; at; at = at.parentElement)
    chain.unshift({ ...treeOf(at, false), children: [] });
  return chain;
}

const describe = (element: Element) =>
  [
    element.localName,
    ...(element.getAttribute('class') ?? '')
      .split(/\s+/u)
      .filter((name) => name && !name.startsWith('svelte-')),
    (element as HTMLElement).dataset?.svNode ? `#${(element as HTMLElement).dataset.svNode}` : ''
  ]
    .filter(Boolean)
    .join('.');

/** The model's layout of a mounted step's flow, against the page's. */
export function checkLayout(flow: HTMLElement, rules: readonly Rule[] = pageRules()): LayoutCheck {
  const elements = new Map<ModelElement, Element>();
  const tree = treeOf(flow, true, elements);
  const model = layOut(tree, {
    rules,
    measure: canvasMeasure(),
    ancestors: ancestorsOf(flow),
    devicePixelRatio: window.devicePixelRatio
  });
  const scale = screenScale(flow);
  const origin = flow.getBoundingClientRect();
  const differences: (LayoutDifference & { by: number })[] = [];
  let exact = 0;
  for (const [modelElement, element] of elements) {
    const box = model.boxes.get(modelElement);
    if (!box) continue;
    const page = unscaledBox(element, origin, scale);
    const by = Math.max(
      Math.abs(box.x - page.x),
      Math.abs(box.y - page.y),
      Math.abs(box.x + box.width - page.x - page.width),
      Math.abs(box.y + box.height - page.y - page.height)
    );
    if (by === 0) exact++;
    else differences.push({ element: describe(element), model: box, page, by });
  }
  differences.sort((a, b) => b.by - a.by);
  return {
    elements: exact + differences.length,
    exact,
    largest: differences[0]?.by ?? 0,
    differences: differences.slice(0, 20).map(({ by: _, ...difference }) => difference),
    problems: model.problems
  };
}
