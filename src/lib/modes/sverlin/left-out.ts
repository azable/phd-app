/**
 * What a presentation leaves out: drawn nowhere and keeping no room, as a node whose kind has
 * `shown: false` is. A render is left out where its type's view is none, the view it draws is left
 * out, or it reads a value out of scope at every step of the presentation; a node, where its kind
 * is not shown or it holds renders and every one is left out, its text with them. Decided once a
 * presentation's variant and frames are known, by the site of each <Node> and render (its
 * line:column, as tags record their kinds).
 */

import type { MasterStep } from './algorithm/interpret.server';

type Part = Record<string, unknown> & {
  type?: string;
  name?: string;
  start?: number;
  attributes?: { name?: string }[];
  expression?: Part & { callee?: Part; arguments?: unknown[] };
};

/** A <Node> of the view: the node around it, the snippet it is in, and its base kind. */
type ModelNode = {
  parent?: string;
  view: string;
  kind: string;
  /** Whether it draws something of its own beside renders: a value, a pointer, a link, a listing. */
  own: boolean;
};

/** A render of a view or type: the node around it, the snippet it is in, what it renders. */
type ModelRender = { parent?: string; view: string; callee: string; reads: string[] };

/** The view's nodes and renders, by site, with what each snippet holds at its top. */
export type LeftOutModel = {
  nodes: Record<string, ModelNode>;
  renders: Record<string, ModelRender>;
  /** The snippets drawing something at their top that is neither a node nor a render. */
  ownTops: string[];
};

/** A site as tags record it: the line and column (both from 1) of where it starts. */
export function siteOf(source: string, offset: number): string {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  return `${before.split('\n').length}:${offset - lineStart + 1}`;
}

/**
 * The model of the view's markup: every <Node> by its site with its base kind (`kinds`, by where
 * the tag starts), and every render the page draws in a slot (`reads`, by where the render starts,
 * the variables it is drawn from).
 */
export function leftOutModel(
  markup: unknown,
  source: string,
  kinds: ReadonlyMap<number, string>,
  reads: ReadonlyMap<number, string[]>
): LeftOutModel {
  const model: LeftOutModel = { nodes: {}, renders: {}, ownTops: [] };
  const own = (parent: string | undefined, view: string) => {
    if (parent) model.nodes[parent].own = true;
    else if (!model.ownTops.includes(view)) model.ownTops.push(view);
  };
  const walk = (node: unknown, view: string, parent: string | undefined): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, view, parent);
      return;
    }
    const part = node as Part;
    if (part.type === 'SnippetBlock') {
      walk(part.children, part.expression?.name ?? view, undefined);
      return;
    }
    if (part.type === 'InlineComponent' && part.name === 'Node' && part.start !== undefined) {
      const site = siteOf(source, part.start);
      const attributes = part.attributes ?? [];
      model.nodes[site] = {
        ...(parent ? { parent } : {}),
        view,
        kind: kinds.get(part.start) ?? '',
        own: attributes.some((attribute) => attribute.name === 'value')
      };
      walk(part.children, view, site);
      return;
    }
    if (part.type === 'InlineComponent') {
      own(parent, view);
      return;
    }
    if (part.type === 'RenderTag' && part.start !== undefined) {
      const callee = part.expression?.callee?.name;
      const read = reads.get(part.start);
      // Only renders the page draws in a slot; a pointer's is drawn at the element it points at.
      if (typeof callee === 'string' && read)
        model.renders[siteOf(source, part.start)] = {
          ...(parent ? { parent } : {}),
          view,
          callee,
          reads: read
        };
      return;
    }
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'expression' && key !== 'attributes')
        walk(child, view, parent);
  };
  walk(markup, 'root', undefined);
  return model;
}

/**
 * The sites a presentation leaves out: nodes and renders. `views` gives each type rendered by name
 * the view the variant chose, `components` the snippets that are views, and `phases` the
 * presentation's states, each step's before and after, whose applications count at its after.
 */
export function leftOutSites(
  model: LeftOutModel,
  design: Readonly<Record<string, unknown>>,
  views: Readonly<Record<string, unknown>>,
  components: ReadonlySet<string>,
  phases: readonly MasterStep[]
): { nodes: string[]; renders: string[] } {
  const present = new Map<string, boolean>();
  const isPresent = (name: string): boolean => {
    let known = present.get(name);
    if (known === undefined) {
      const operator = name.startsWith('__applied_') ? name.slice('__applied_'.length) : undefined;
      known = phases.some((phase, index) =>
        operator === undefined
          ? name in phase.state
          : index % 2 === 1 && phase.applied?.[operator]?.length === 1
      );
      present.set(name, known);
    }
    return known;
  };
  const nodesIn = (parent: string | undefined, view: string) =>
    Object.entries(model.nodes).filter(([, node]) => node.parent === parent && node.view === view);
  const rendersIn = (parent: string | undefined, view: string) =>
    Object.entries(model.renders).filter(
      ([, render]) => render.parent === parent && render.view === view
    );
  const holds = new Map<string, boolean>();
  const holdsRenders = (site: string): boolean => {
    let known = holds.get(site);
    if (known === undefined) {
      const { view } = model.nodes[site];
      known =
        rendersIn(site, view).length > 0 ||
        nodesIn(site, view).some(([child]) => holdsRenders(child));
      holds.set(site, known);
    }
    return known;
  };
  const decided = new Map<string, boolean>();
  // A view drawing itself, through a type's fields, is drawn while it is being decided.
  const deciding = new Set<string>();
  const once = (key: string, decide: () => boolean): boolean => {
    const known = decided.get(key);
    if (known !== undefined) return known;
    if (deciding.has(key)) return false;
    deciding.add(key);
    const result = decide();
    deciding.delete(key);
    decided.set(key, result);
    return result;
  };
  const viewLeftOut = (view: string): boolean =>
    once(`view ${view}`, () => {
      if (model.ownTops.includes(view)) return false;
      const tops = [
        ...nodesIn(undefined, view).map(
          ([site]) =>
            () =>
              nodeLeftOut(site)
        ),
        ...rendersIn(undefined, view).map(
          ([site]) =>
            () =>
              renderLeftOut(site)
        )
      ];
      return tops.length > 0 && tops.every((gone) => gone());
    });
  const renderLeftOut = (site: string): boolean =>
    once(`render ${site}`, () => {
      const { callee, reads } = model.renders[site];
      if (reads.some((name) => !isPresent(name))) return true;
      if (components.has(callee)) return viewLeftOut(callee);
      const chosen = views[callee];
      if (chosen === 'none') return true;
      return typeof chosen === 'string' && viewLeftOut(chosen);
    });
  const nodeLeftOut = (site: string): boolean =>
    once(`node ${site}`, () => {
      const node = model.nodes[site];
      if (design[`${node.kind}.shown`] === false) return true;
      if (node.own) return false;
      const items = [
        ...rendersIn(site, node.view).map(
          ([child]) =>
            () =>
              renderLeftOut(child)
        ),
        ...nodesIn(site, node.view)
          .filter(([child]) => holdsRenders(child))
          .map(
            ([child]) =>
              () =>
                nodeLeftOut(child)
          )
      ];
      return items.length > 0 && items.every((gone) => gone());
    });
  return {
    nodes: Object.keys(model.nodes).filter(nodeLeftOut),
    renders: Object.keys(model.renders).filter(renderLeftOut)
  };
}
