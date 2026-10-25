/**
 * What a presentation leaves out: drawn nowhere and keeping no room, as a node whose kind has
 * `shown: false` is. A render is left out where its type's view is none, the view or part of the
 * page it draws is left out, or it reads a value out of scope at every step of the presentation; a
 * node, where its kind is not shown; or, holding no node or part, one of its renders is left out
 * (its renders and text are one statement); or, holding nodes, every part is, each node and each
 * render in it, a part's render counting as the nodes it draws. Decided once a presentation's
 * variant and steps are known, by the site of each <Node> and render (its line:column, as tags
 * record their kinds).
 */

import type { MasterStep } from './algorithm/interpret.server';

type Part = Record<string, unknown> & {
  type?: string;
  name?: string;
  start?: number;
  end?: number;
  attributes?: { name?: string }[];
  expression?: Part & { callee?: Part; arguments?: unknown[] };
};

/** A <Node> of the view: the node around it, the snippet it is in, by its path, and its kind. */
type ModelNode = {
  parent?: string;
  view: string;
  kind: string;
  /** Whether it draws something of its own beside renders: a value, a pointer, a link, a listing. */
  own: boolean;
};

/**
 * A render of a view, type, or part: the node around it, the snippet it is in, what it renders,
 * and whether it is a part's, whose nodes are the node's parts as its child nodes are.
 */
type ModelRender = {
  parent?: string;
  view: string;
  callee: string;
  reads: string[];
  part?: boolean;
};

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
 * The model of the view's markup: every <Node> by its site with its kind (`kinds`, by where the
 * tag starts), every render the page draws in a slot (`reads`, by where the render starts, the
 * variables it is drawn from), and every render of a snippet without parameters, a part, by its
 * path (`paths`, by name), drawn as a view is.
 */
export function leftOutModel(
  markup: unknown,
  source: string,
  kinds: ReadonlyMap<number, string>,
  reads: ReadonlyMap<number, string[]>,
  paths: ReadonlyMap<string, string>,
  /**
   * Variables the root's markup reads itself, by where each read starts: each counts as a render of
   * its node, so the node hides where the variable is absent, as at step 0.
   */
  direct: readonly { name: string; start: number }[] = []
): LeftOutModel {
  const model: LeftOutModel = { nodes: {}, renders: {}, ownTops: [] };
  const spans: { site: string; view: string; start: number; end: number }[] = [];
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
      const name = part.expression?.name ?? '';
      walk(part.children, paths.get(name) ?? name, undefined);
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
      spans.push({ site, view, start: part.start, end: part.end ?? part.start });
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
      const ofPart = typeof callee === 'string' && !part.expression?.arguments?.length;
      // Only renders the page draws in a slot, and parts; a pointer's is drawn where it points.
      if (typeof callee === 'string' && (read || (ofPart && paths.has(callee))))
        model.renders[siteOf(source, part.start)] = {
          ...(parent ? { parent } : {}),
          view,
          callee: read ? callee : (paths.get(callee) ?? callee),
          reads: read ?? [],
          ...(read ? {} : { part: true })
        };
      return;
    }
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'expression' && key !== 'attributes')
        walk(child, view, parent);
  };
  walk(markup, 'root', undefined);
  for (const { name, start } of direct) {
    const around = spans
      .filter((span) => span.start <= start && start < span.end)
      .sort((a, b) => b.start - a.start)[0];
    if (!around) continue;
    model.renders[`read ${siteOf(source, start)}`] = {
      parent: around.site,
      view: around.view,
      callee: '',
      reads: [name]
    };
  }
  return model;
}

/** The reads among `reads` in no <Node>, which no node can hide where their variable is absent. */
export function outsideNodes<Read extends { start: number }>(
  markup: unknown,
  reads: readonly Read[]
): Read[] {
  const spans: { start: number; end: number }[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const part = node as Part;
    if (part.type === 'InlineComponent' && part.name === 'Node' && part.start !== undefined)
      spans.push({ start: part.start, end: part.end ?? part.start });
    for (const [key, child] of Object.entries(part)) if (key !== 'parent') walk(child);
  };
  walk(markup);
  return reads.filter(
    ({ start }) => !spans.some((span) => span.start <= start && start < span.end)
  );
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
  phases: readonly MasterStep[],
  /** Whether what a render reads besides the state is drawn at some step, as a label's value. */
  drawn: (name: string) => boolean | undefined = () => undefined
): { nodes: string[]; renders: string[] } {
  const present = new Map<string, boolean>();
  const isPresent = (name: string): boolean => {
    let known = present.get(name);
    if (known === undefined) {
      const operator = name.startsWith('__applied_') ? name.slice('__applied_'.length) : undefined;
      known =
        drawn(name) ??
        phases.some((phase, index) =>
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
      const direct = rendersIn(site, node.view);
      const children = nodesIn(site, node.view);
      // A part of the page drawn inside draws nodes of its own, so it counts as they would.
      const parts = direct.filter(([, render]) => render.part);
      // Holding no node, its renders and text are one statement: one missing takes the node.
      if (!children.length && !parts.length) return direct.some(([child]) => renderLeftOut(child));
      // Holding nodes, each node and each render in it is a part: it goes only with every one, and
      // a node holding no render, as a label, never goes.
      return (
        children.every(([child]) => holdsRenders(child)) &&
        direct.every(([child]) => renderLeftOut(child)) &&
        children.every(([child]) => nodeLeftOut(child))
      );
    });
  return {
    nodes: Object.keys(model.nodes).filter(nodeLeftOut),
    renders: Object.keys(model.renders).filter(renderLeftOut)
  };
}

/**
 * The nodes hidden at one step, keeping their room: those whose renders are each hidden there, as
 * one reading a value `absent` at that step (a variable out of scope, a label or an operator that
 * gave none there), or left out. By the same rule as left out: a node holding no node hides with one
 * render missing, a node holding nodes only with all its parts; it takes every child with it.
 * Nodes the presentation leaves out are not among them.
 */
export function hiddenAt(
  model: LeftOutModel,
  design: Readonly<Record<string, unknown>>,
  views: Readonly<Record<string, unknown>>,
  components: ReadonlySet<string>,
  absent: ReadonlySet<string>,
  leftOut: readonly string[]
): string[] {
  const gone = new Set(leftOut);
  return leftOutSites(
    model,
    design,
    views,
    components,
    [],
    (name) => !absent.has(name)
  ).nodes.filter((site) => !gone.has(site));
}
