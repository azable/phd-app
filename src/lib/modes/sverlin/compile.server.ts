/** Compile one untrusted Svelte component without executing its code on the server. */

import { posix } from 'node:path';

import type { AnyNode } from 'acorn';
import { build, type BuildFailure, type Plugin } from 'esbuild';
import { compile, parse } from 'svelte/compiler';

import entrySource from './assembly/entry.ts?raw';
import preludeSource from './assembly/prelude.ts?raw';
import {
  AlgorithmError,
  declaredNames,
  interpretDomain,
  interpretInput,
  stepLabels,
  traceAlgorithm,
  type Application,
  type BlockKind,
  type LabelRun,
  type MasterStep,
  type Pacing,
  type PauseMode,
  type Pauses,
  type TraceState,
  type TypedState
} from './algorithm/interpret.server';
import type { Label } from './algorithm/labels.server';
import { parseBlock, spanOf } from './algorithm/parse.server';
import { lightSteps, type Lit } from './listing/light.server';
import {
  isDuringKey,
  isLabelKey,
  isRunsKey,
  labelSpan,
  markLabels,
  resolveLabel,
  written as asWritten
} from './label-values';
import type { Listing } from './listing/listing';
import { mappedListing, type RegionMap } from './listing/mapped.server';
import type { AtomRegistry } from './algorithm/atoms.server';
import {
  definesType,
  heapKey,
  heapRecords,
  noDomain,
  operatorNames,
  typeNames,
  type DomainRegistry,
  type RecordType,
  type RefType
} from './algorithm/structures.server';
import {
  componentProbes,
  findComponents,
  isPart,
  probeMarkup,
  pointerCalls,
  probeValues,
  readsOf,
  rootPlacements,
  scopedReadsOf,
  snippetPaths,
  viewCallsOf,
  slotInsertions,
  viewsOf,
  withInsertions,
  type ComponentProbe,
  type Insertion,
  type Placement,
  type ComponentSignatures
} from './components.server';
import {
  buildVariant,
  DesignValueError,
  designSpace,
  listingRegionFallbacks,
  listingRegionSpace,
  pauseSpace,
  starterPauses,
  starterVariant,
  type DesignKind,
  type DesignOrigin,
  type DesignSpace,
  type DesignValue,
  type Fallback,
  type VariantRequest
} from './design.server';
import {
  hiddenAt,
  leftOutModel,
  leftOutSites,
  outsideNodes,
  siteOf,
  type LeftOutModel
} from './left-out';
import {
  kindKey,
  placeProps,
  roleProps,
  starterListing,
  type KindRole
} from './library/node/design';
import { forms } from './library/node/forms';
import type { FrameSettings } from './library/node/props';
import { stepSignature } from '../signature.server';

// One component should be much smaller; these ceilings bound compilation and inline Timeline storage.
const maximumSourceBytes = 256 * 1024;
const maximumBundleBytes = 2 * 1024 * 1024;

// Library sources are embedded at build time so production needs no source tree.
const librarySources = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['./library/**/*.{svelte,ts}', '!./library/**/*.test.ts'], {
      query: '?raw',
      import: 'default',
      eager: true
    })
  ).map(([path, text]) => [path.slice('./library/'.length), text])
);
const compiledLibrary = new Map<string, string>();

/** The prelude's import statements on one line, so injection keeps authored line numbers. */
const prelude = (preludeSource.match(/^import[\s\S]*?;/gmu) ?? [])
  .map((statement) => statement.replace(/\s+/gu, ' '))
  .join(' ');

/** Component names the prelude brings into scope, which values must not shadow. */
const libraryNames = [...prelude.matchAll(/import\s*\{([^}]*)\}/gu)].flatMap(([, names]) =>
  names
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
);

function libraryPath(path: string): string | undefined {
  return [path, `${path}.ts`, `${path}/index.ts`].find((candidate) => candidate in librarySources);
}

function loadLibraryModule(path: string): { contents: string; loader: 'js' | 'ts' } {
  const source = librarySources[path];
  if (!path.endsWith('.svelte')) return { contents: source, loader: 'ts' };
  let contents = compiledLibrary.get(path);
  if (contents === undefined) {
    contents = compile(source, {
      filename: path,
      generate: 'client',
      css: 'injected',
      dev: false
    }).js.code;
    compiledLibrary.set(path, contents);
  }
  return { contents, loader: 'js' };
}

/** One seeded presentation of a prepared component. */
export type SvelteBundle = {
  javascript: string;
  /** The name of each step this presentation keeps (see MasterStep), the same in every pacing. */
  labels: string[];
  /** Identity of the master trace, from its recorded states, shared by all presentations of the source. */
  masterSignature: string;
  /** Master step index of each kept step. */
  masterSteps: number[];
  /** The presentation's variant: every variable's value, by key. */
  variant: Record<string, DesignValue>;
  /** Where each value came from. */
  origins: Record<string, DesignOrigin>;
  /** The <Node> tags it leaves out, by their line:column. */
  leftOut: string[];
};

type Block = { body: string; offset: number };

/** Seed-independent result of checking, interpreting, and compiling one component. */
export type PreparedComponent = {
  source: string;
  component: string;
  /** The steps pausing at every label, the starter's (see Pacing). */
  master: MasterStep[];
  /** The names of the source's own listings (see listing/mapped.server.ts). */
  ownListings: string[];
  /**
   * Every label of the algorithm, by full name, and those with no labels inside them, which pause
   * only 'on'.
   */
  pauses: { labels: string[]; leaves: string[] };
  /**
   * The steps pausing at the labels given, each as given or, given as a set, as it pauses where its
   * variable is on (see pausing), and what follows from them: the values the root reads for
   * placement, measured with every value of their types, as each names a step of its own, and what
   * each step lights in each listing. Made once per way of pausing.
   */
  paced: (pauses: Pauses | ReadonlySet<string>) => PacedSteps;
  /** The source's identity, shared by its presentations however their steps are paced. */
  signature: string;
  atoms: AtomRegistry;
  /** The view's typed components, each after those it renders, as the page enumerates them. */
  components: ComponentProbe[];
  /**
   * The design space, the views each type rendered by name chooses among (its pointer views apart),
   * the kind of each tag (by its line:column), and the first variant.
   */
  design: {
    views: Record<string, string[]>;
    /** The pointer views each position type rendered by name as a pointer chooses among. */
    pointers: Record<string, string[]>;
    tags: Record<string, string[]>;
    /** The variable each render of a type by name reads, views.Int or pointers.Index, by its line:column. */
    renders: Record<string, string>;
    /**
     * The places with a view choice of their own, by the alias they are drawn through: its variable,
     * as views.Int@swap.held, the type's it falls back to, its options, and whether it is a pointer.
     */
    places: Record<string, { key: string; base: string; options: string[]; pointer: boolean }>;
    /** Each place's variable, by key, and the variable it falls back to until a variant sets it. */
    fallbacks: Record<string, Fallback>;
    space: DesignSpace;
    starter: Record<string, DesignValue>;
  };
  /** Where the view places a <Listing />, the algorithm's text in each language. */
  listings?: Record<
    string,
    { text: string; regions: { label: string; start: number; end: number }[] }
  >;
  /**
   * The operators the root renders at labels, as {@render Greater(@inner)}, by key, each with an
   * application from some step, which stands in hidden where a step has none or several of them.
   */
  applied?: Record<string, Application>;
  /** Each of those renders' operator, and the code of the label it takes applications made in. */
  appliedIn?: Record<string, { operator: string; start: number; end: number }>;
  /**
   * The labels the root reads, by key (see label-values.ts): a label's value at a step, or its
   * values so far; each with its full name and a value from some step to stand in.
   */
  labelled?: Record<string, { label: string; sample?: LabelRun }>;
  /** The operators whose applications so far inside a label the root draws, by key. */
  histories?: Record<string, { operator: string; start: number; end: number }>;
  /** The labels {#when} blocks draw their contents in the runs of, by full name, by key. */
  during?: Record<string, string>;
  /** The view's nodes and renders, and its views, for what each presentation leaves out. */
  leftOut?: { model: LeftOutModel; components: string[] };
};

/** The steps as a set of pauses paces them (see PreparedComponent.paced). */
export type PacedSteps = {
  steps: MasterStep[];
  placements: Placement[];
  /** What each step lights in each listing the view places, by its language. */
  lit: Record<string, Lit[]>;
};

export class InvalidSvelteSourceError extends Error {
  readonly code?: string;
  readonly line?: number;
  readonly column?: number;
  /** Where the code the problem is about ends, when known, so the whole of it can be underlined. */
  readonly endLine?: number;
  readonly endColumn?: number;
  /** Further problems found in the same build, each reported as its own diagnostic. */
  others: InvalidSvelteSourceError[] = [];

  /** One error standing for several, in source order, so a build reports them all at once (up to 20). */
  static combine(problems: readonly InvalidSvelteSourceError[]): InvalidSvelteSourceError {
    const [first, ...others] = [...problems].sort(
      (a, b) => (a.line ?? Infinity) - (b.line ?? Infinity) || (a.column ?? 0) - (b.column ?? 0)
    );
    first.others = others.slice(0, 19);
    return first;
  }

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'InvalidSvelteSourceError';
    const issue = cause as
      | {
          code?: unknown;
          start?: { line?: unknown; column?: unknown };
          end?: { line?: unknown; column?: unknown };
        }
      | undefined;
    if (typeof issue?.code === 'string') this.code = issue.code;
    if (typeof issue?.start?.line === 'number' && issue.start.line >= 1)
      this.line = issue.start.line;
    if (typeof issue?.start?.column === 'number' && issue.start.column >= 0)
      this.column = issue.start.column + 1;
    // An end is kept only with a start it does not come before.
    const { line: endLine, column: endColumn } = issue?.end ?? {};
    if (
      this.line !== undefined &&
      this.column !== undefined &&
      typeof endLine === 'number' &&
      typeof endColumn === 'number' &&
      (endLine > this.line || (endLine === this.line && endColumn + 1 >= this.column))
    ) {
      this.endLine = endLine;
      this.endColumn = endColumn + 1;
    }
  }
}

/** Compile one seeded presentation; batch builds prepare once and bundle per seed instead. */
export async function compileSvelteComponent(source: string, seed = 1): Promise<SvelteBundle> {
  return bundlePresentation(prepareSvelteComponent(source), seed);
}

/** The steps a page of the source starts with, paced by its view; none where the view does not build. */
function viewSteps(source: string): MasterStep[] | undefined {
  try {
    return prepareSvelteComponent(source).master;
  } catch {
    return undefined;
  }
}

/**
 * The steps a component's algorithm records, pausing at every label as the starter does, as the
 * page steps where its view builds, and else run without its view, so they can be read whether or
 * not it builds, as by the assistant checking what its algorithm does.
 * Throws the domain, input, or algorithm's problem.
 */
export function recordedTrace(source: string): MasterStep[] {
  const shown = viewSteps(source);
  if (shown) return shown;
  const { blocks } = extractBlocks(source);
  if (!blocks.algorithm)
    throw new InvalidSvelteSourceError('There is no algorithm block, so there are no steps.', {
      code: 'missing_algorithm'
    });
  const domain = blocks.domain
    ? interpretBlock(source, blocks.domain, (body) => interpretDomain(body))
    : noDomain;
  const input = blocks.input
    ? interpretBlock(source, blocks.input, (body) => interpretInput(body, domain))
    : { state: {}, types: {} };
  return paced(source, blocks.algorithm, input, domain).steps;
}

/**
 * The source's listings (see listing/mapped.server.ts), by name; with the problems with them, and
 * what each of their regions is mapped to.
 */
function listingsFrom(
  source: string,
  traced: ReturnType<typeof traceAlgorithm>,
  algorithm: Block,
  own: readonly ListingBlock[]
): {
  listings: Record<string, Listing>;
  maps: Record<string, RegionMap[]>;
  problems: InvalidSvelteSourceError[];
} {
  const listings: Record<string, Listing> = {};
  const maps: Record<string, RegionMap[]> = {};
  const problems: InvalidSvelteSourceError[] = [];
  for (const block of own) {
    const at = (offset: number) => sourcePosition(source, offset);
    if (block.name === 'none' || Object.hasOwn(listings, block.name)) {
      problems.push(
        new InvalidSvelteSourceError(
          `A listing cannot be named ${block.name}: ${block.name === 'none' ? 'listing.language none shows none' : 'another has that name'}.`,
          { code: 'sverlin_block', start: at(block.start) }
        )
      );
      continue;
    }
    const mapped = mappedListing(block, traced);
    listings[block.name] = mapped.listing;
    maps[block.name] = mapped.maps;
    for (const { message, block: where, at: offset } of mapped.problems)
      problems.push(
        new InvalidSvelteSourceError(message, {
          code: 'listing_label',
          start: at((where === 'listing' ? block.offset : algorithm.offset) + offset)
        })
      );
  }
  return { listings, maps, problems };
}

/** The algorithm's steps paced as given (see Pacing), opening on step 0, the input as given. */
function paced(
  source: string,
  algorithm: Block,
  input: TypedState,
  domain: DomainRegistry,
  pacing: Pacing = {},
  keep: Parameters<typeof traceAlgorithm>[4] = {}
): ReturnType<typeof traceAlgorithm> {
  const run = interpretBlock(source, algorithm, (body) =>
    traceAlgorithm(body, input, domain, pacing, keep)
  );
  return { ...run, steps: [run.opening, ...run.steps] };
}

/** A variant's variable for pausing at a label, by the label's full name, as pause@insert.swap.to. */
export const pauseKey = (label: string): string => `pause@${label}`;

/**
 * Labels paused at, each as a label pauses where its variable is on: a label with labels inside it
 * accumulating, one without, which has no pauses inside it, on.
 */
export function pausing(
  labels: Iterable<string>,
  leaves: ReadonlySet<string>
): Map<string, PauseMode> {
  return new Map([...labels].map((label) => [label, leaves.has(label) ? 'on' : 'accumulate']));
}

/** How a variant pauses at each label: as its pause@ variable says ('off' not at all), else 'on'. */
export function pausesOf(
  pauses: PreparedComponent['pauses'],
  values: Readonly<Record<string, unknown>>
): Map<string, PauseMode> {
  const leaves = new Set(pauses.leaves);
  return new Map(
    pauses.labels.flatMap((label): [string, PauseMode][] => {
      const value = values[pauseKey(label)];
      if (value === 'off') return [];
      return [[label, value === 'accumulate' && !leaves.has(label) ? 'accumulate' : 'on']];
    })
  );
}

/** How a source pauses, as a key, for the steps paced so (see PreparedComponent.paced). */
const pausesKey = (pauses: Pauses) =>
  [...pauses]
    .map(([label, mode]) => `${label}=${mode}`)
    .sort()
    .join(',');

/**
 * Each step as two, the state just before its code and just after it, as the page plays it: the
 * events up to the code, then the code itself. The first, step 0, the input as given, has no code,
 * so its before is its after.
 */
export function phasesOf(steps: readonly MasterStep[]): MasterStep[] {
  return steps.flatMap((step, index) => [
    index === 0 ? step : { ...step, ...(step.before ?? {}) },
    step
  ]);
}

/** The algorithm as a listing in each language. */
export function listingsOf(source: string): Record<string, Listing> {
  const { blocks, listings: listingBlocks } = extractBlocks(source);
  if (!blocks.algorithm)
    throw new InvalidSvelteSourceError('There is no algorithm block, so there is no listing.', {
      code: 'missing_algorithm'
    });
  const domain = blocks.domain
    ? interpretBlock(source, blocks.domain, (body) => interpretDomain(body))
    : noDomain;
  const input = blocks.input
    ? interpretBlock(source, blocks.input, (body) => interpretInput(body, domain))
    : { state: {}, types: {} };
  const algorithm = blocks.algorithm;
  const traced = interpretBlock(source, algorithm, (body) => traceAlgorithm(body, input, domain));
  return listingsFrom(source, traced, algorithm, listingBlocks).listings;
}

/**
 * What each region of the source's own listings is mapped to, and whether the algorithm runs its
 * code, its steps paced as recordedTrace paces them, for the assistant to check its labels against;
 * none without such a listing.
 */
export function listingMapsOf(
  source: string
): Record<string, (RegionMap & { lit: boolean })[]> | undefined {
  const { blocks, listings: listingBlocks } = extractBlocks(source);
  if (!listingBlocks.length || !blocks.algorithm) return undefined;
  const domain = blocks.domain
    ? interpretBlock(source, blocks.domain, (body) => interpretDomain(body))
    : noDomain;
  const input = blocks.input
    ? interpretBlock(source, blocks.input, (body) => interpretInput(body, domain))
    : { state: {}, types: {} };
  const run = paced(source, blocks.algorithm, input, domain);
  const traced = { ...run, steps: viewSteps(source) ?? run.steps };
  const { listings, maps } = listingsFrom(source, traced, blocks.algorithm, listingBlocks);
  return Object.fromEntries(
    Object.entries(maps).map(([name, regions]) => {
      // Lit wherever the algorithm runs its code, however the steps pause.
      const everywhere = traced.steps.map(({ trail: _, ...step }) => step);
      const lit = lightSteps(listings[name], everywhere).flatMap(({ current, earlier }) => [
        ...current,
        ...earlier
      ]);
      // A region lit at some step, or a region inside it lit, which lights within it.
      // Lines in the source, rather than in the algorithm block.
      const before = source.slice(0, blocks.algorithm!.offset).split('\n').length - 1;
      let from = 0;
      const marked = regions.map((region) => {
        const start = listings[name].text.indexOf(region.text, from);
        from = start >= 0 ? start : from;
        return {
          ...region,
          sources: region.sources.map(({ text, line }) => ({ text, line: line + before })),
          lit: lit.some(
            ([litStart, litEnd]) => litStart < start + region.text.length && litEnd > start
          )
        };
      });
      return [name, marked];
    })
  );
}

/**
 * Check, interpret, and compile once per source. Only a single component is accepted; its
 * runtime and the component library are bundled locally, and only the design depends on the seed.
 */
export function prepareSvelteComponent(source: string): PreparedComponent {
  if (Buffer.byteLength(source, 'utf8') > maximumSourceBytes) {
    throw new InvalidSvelteSourceError('The Svelte component is too large.', { code: 'too_large' });
  }
  let viewProblems: InvalidSvelteSourceError[] = [];
  try {
    const extracted = extractBlocks(source);
    const { blocks, listings: listingBlocks } = extracted;
    // Labels the markup reads become identifiers of the same length (see label-values.ts).
    const { source: svelteSource, references, heaps } = markLabels(extracted.svelteSource);
    // Svelte reads typed snippet parameters only in TypeScript; an empty script after the view says
    // so without moving anything the view's positions name. A view with a script of its own is
    // parsed as written, so the script is reported below.
    const scripted = /<script\b/iu.test(svelteSource);
    const ast = parse(scripted ? svelteSource : `${svelteSource}<script lang="ts"></script>`, {
      filename: 'Main.svelte'
    });
    const found = findComponents(ast.html as Parameters<typeof findComponents>[0]);
    visit(ast, (node) => {
      if (
        node.type === 'ImportDeclaration' ||
        node.type === 'ImportExpression' ||
        node.type === 'ExportAllDeclaration' ||
        (node.type === 'ExportNamedDeclaration' && 'source' in node && node.source)
      )
        throw new InvalidSvelteSourceError(
          'Generated components cannot import modules; library components are already in scope.',
          { code: 'import', start: sourcePosition(source, (node as { start?: number }).start ?? 0) }
        );
    });
    const authoredScript = scripted ? (ast.instance ?? ast.module) : undefined;
    if (authoredScript)
      throw new InvalidSvelteSourceError(
        'Views cannot have their own <script>: input and algorithm values, step, seed, and the library components are already in scope. Compute in markup, using {@const} inside a block or component for reuse.',
        { code: 'view_script', start: sourcePosition(source, authoredScript.start) }
      );
    // The view is checked before any block runs, so its problems are reported with theirs.
    if (blocks.design)
      throw new InvalidSvelteSourceError(
        'Sources have no design block: the design space is made from the view, every look a variable of a kind of node, the snippet it is in, and every type a choice of its views. Remove the block, and name nodes by the snippets they are in, as {#snippet Caption()}<Node>…</Node>{/snippet}.',
        { code: 'sverlin_block', start: sourcePosition(source, blocks.design.offset) }
      );
    const paths = snippetPaths(ast.html);
    // A view whose links sit outside its nodes joins the children of the node it is rendered in,
    // which lays them out; a pointer view draws inside the element it marks, so its links join
    // nothing there.
    const linkProblems: InvalidSvelteSourceError[] = [];
    const linkedTypes = new Set<string>();
    for (const { name, type, node } of found.components) {
      const links = outerLinks(node);
      if (!links.length) continue;
      if (found.pointers.has(name))
        linkProblems.push(
          new InvalidSvelteSourceError(
            `${name} is a pointer view, drawn inside the element it marks, so its <Link> joins nothing: write the link among the elements, in the node holding them, with labels at its ends, as <Link from={@insert.swap.from} to={@insert.swap.to} />.`,
            { code: 'link_placement', start: sourcePosition(source, links[0]) }
          )
        );
      else linkedTypes.add(type);
    }
    const { insertions, problems, kinds, tagKinds, nodeKinds, listing, listingAt } = withNodeRefs(
      svelteSource,
      ast,
      source,
      found.roots,
      found.valueTypes,
      paths,
      linkedTypes
    );
    viewProblems = [
      ...problems,
      ...linkProblems,
      ...found.problems.map(
        ({ message, start }) =>
          new InvalidSvelteSourceError(message, {
            code: 'view_component',
            start: sourcePosition(source, start)
          })
      )
    ];
    if (!blocks.algorithm)
      throw new InvalidSvelteSourceError(
        'Add a <script lang="sverlin"> algorithm block, labelling the code its steps are about, as @check[…] (see Steps).',
        { code: 'missing_algorithm' }
      );
    const domain = blocks.domain
      ? interpretBlock(source, blocks.domain, (body) => interpretDomain(body))
      : noDomain;
    const { atoms } = domain;
    // Views see an operator as a record of its operands and its result (see viewDomainOf), unless a
    // view has its name, as a pointer view called Next, which a render of Next then draws.
    const viewNamed = new Set(found.components.map(({ name }) => name));
    const operators = new Set(operatorNames(domain).filter((name) => !viewNamed.has(name)));
    const viewing = viewDomainOf(domain, operators);
    // Where a block declares a name, so a clash points at the declaration.
    const at = (name: string, ...candidates: (Block | undefined)[]) => {
      for (const block of candidates) {
        const found =
          block &&
          new RegExp(`\\b(?:const|let)\\s+${name.replaceAll('$', '\\$')}(?![\\w$])`, 'u').exec(
            block.body
          );
        if (found && block)
          return { code: 'name_clash', start: sourcePosition(source, block.offset + found.index) };
      }
      return { code: 'name_clash' };
    };
    const shadowed = typeNames(domain).find((name) => libraryNames.includes(name));
    if (shadowed)
      throw new InvalidSvelteSourceError(
        `"${shadowed}" names a library component; choose another type name.`,
        at(shadowed, blocks.domain)
      );
    // Names are checked before any block runs, so a clash is reported before what it causes.
    const declared = (block: Block | undefined, kind: 'input' | 'algorithm') =>
      block ? interpretBlock(source, block, (body) => declaredNames(body, kind, domain)) : [];
    const stateNames = [
      ...new Set([...declared(blocks.input, 'input'), ...declared(blocks.algorithm, 'algorithm')])
    ];
    const typeName = stateNames.find((name) => definesType(domain, name));
    if (typeName)
      throw new InvalidSvelteSourceError(
        `"${typeName}" names a type; choose another variable name.`,
        at(typeName, blocks.input, blocks.algorithm)
      );
    const library = stateNames.find((name) => libraryNames.includes(name));
    if (library)
      throw new InvalidSvelteSourceError(
        `"${library}" names a library component; choose another variable name.`,
        at(library, blocks.input, blocks.algorithm)
      );
    // Each record a reference refers to has a heap, its live nodes, which the view reads as all(Node).
    const nodeRecords = heapRecords(domain);
    const unknownHeap = heaps.find(({ record }) => !nodeRecords.has(record));
    if (unknownHeap)
      throw new InvalidSvelteSourceError(
        nodeRecords.size
          ? `all(${unknownHeap.record}) draws every live node of a record a reference refers to, and ${unknownHeap.record} is not one; the domain's are ${[...nodeRecords.keys()].map((record) => `all(${record})`).join(', ')}.`
          : `all(${unknownHeap.record}) draws every live node of a record a reference refers to, as all(Node) for const NodeRef = ref(Node);, and the domain has none.`,
        { code: 'view_component', start: sourcePosition(source, unknownHeap.start) }
      );
    stateNames.push(...[...nodeRecords.keys()].map(heapKey));
    const components = checkComponents(
      found.components,
      found.pointers,
      viewing,
      stateNames,
      stateNames,
      source
    );
    const views = viewsOf(components);
    // A type is rendered by name, as in {@render Int(value)}, and draws the view of it the variant
    // chooses, views.Int; a view named after its type would leave nothing to choose.
    const ownName = found.components.find(({ name, type }) => name === type);
    if (ownName)
      throw new InvalidSvelteSourceError(
        `${ownName.name} is a view named after its type: name it after how it draws, as ${ownName.name}Cell, and {@render ${ownName.name}(…)} draws whichever view of ${ownName.name} the design chooses.`,
        { code: 'view_component', start: sourcePosition(source, ownName.start) }
      );
    // A part is rendered by its name, which a type or operator would take.
    const typeNamed = [...paths.keys()].find(
      (name) => !Object.hasOwn(components, name) && definesType(viewing, name)
    );
    if (typeNamed)
      throw new InvalidSvelteSourceError(
        `The snippet ${typeNamed} has the name of a type, so {@render ${typeNamed}()} would draw a value of it: name the snippet after what it shows, as ${typeNamed}Part.`,
        {
          code: 'view_component',
          start: sourcePosition(
            source,
            Math.max(0, svelteSource.search(new RegExp(`\\{#snippet\\s+${typeNamed}\\b`, 'u')))
          )
        }
      );
    const rendered = renderedNames(ast.html).filter(({ name }) => definesType(viewing, name));
    // A link to no node, as a list's last next, draws the end it gives with the end's view, as if
    // the type were rendered there: the members of a union with a reference to a node that have a
    // view of their own.
    const endTypes = endTypesOf(viewing).filter((name) => views[name]?.length);
    const linked = fromlessLinks(ast.html);
    if (linked.length)
      for (const name of endTypes) rendered.push({ name, start: linked[0], inNode: true });
    const appliedRenders = operatorRendersOf(ast.html, operators);
    const wrongRender = appliedRenders.find(({ argued, inView }) => argued || inView);
    if (wrongRender)
      throw new InvalidSvelteSourceError(
        wrongRender.argued
          ? `{@render ${wrongRender.name}(…)} draws a value of ${wrongRender.name}, an operator, whose values are its applications: {@render ${wrongRender.name}(@compare)} draws the one made inside the code labelled @compare, and in {#each applied(${wrongRender.name}, @compare) as a}, {@render ${wrongRender.name}(a)} each so far.`
          : `{@render ${wrongRender.name}(…)} draws an application of ${wrongRender.name} a step makes, which only the root and its parts know: render it there, outside any view.`,
        { code: 'view_component', start: sourcePosition(source, wrongRender.start) }
      );
    // Each render of an applied operator by its key: the operator's name and the label it is
    // narrowed to (see appliedKey); one in {#each applied(…)} draws a value, as a type is rendered.
    // A render with no label is refused once the labels are known.
    const appliedNames = [
      ...new Set(
        appliedRenders.flatMap(({ name, filter }) => (filter ? [`${name}_${filter}`] : []))
      )
    ];
    const undrawn = rendered.find(({ name }) => !views[name]?.length);
    if (undrawn)
      throw new InvalidSvelteSourceError(
        `${undrawn.name} is a type, and nothing draws it: add a view of it, as {#snippet ${undrawn.name}Cell(value: ${undrawn.name})}<Node {value} />{/snippet}.`,
        { code: 'view_component', start: sourcePosition(source, undrawn.start) }
      );
    const unknown = renderedNames(ast.html).find(
      ({ name }) => !paths.has(name) && !definesType(viewing, name) && !operators.has(name)
    );
    if (unknown)
      throw new InvalidSvelteSourceError(
        `{@render ${unknown.name}(…)} draws ${unknown.name}, which no snippet, type, or operator is named: define it, as {#snippet ${unknown.name}(p: Index)}<Pointed />{/snippet} for a pointer or {#snippet ${unknown.name}()}<Node>…</Node>{/snippet} for a part of the page, or render one that exists.`,
        { code: 'view_component', start: sourcePosition(source, unknown.start) }
      );
    // Each type rendered by name chooses among its views: its plain views, where it also has
    // pointers, which are rendered by their own names.
    // A view that draws its own type by name, itself or through views it renders, would draw
    // itself without end were it chosen, so it is no option for its type.
    const reads = new Map(found.components.map(({ name, node }) => [name, readsOf(node)]));
    const drawsItself = (view: string, type: string, seen = new Set<string>()): boolean =>
      !seen.has(view) &&
      [...(reads.get(view) ?? [])].some(
        (read) => read === type || (reads.has(read) && drawsItself(read, type, seen.add(view)))
      );
    // A position type draws a mark outside a <Node>, through its pointer views (pointers.Index), and
    // its number inside one, through its other views (views.Index): each a choice of its own. A
    // render inside a node of a type with only pointer views is a pointer, refused there.
    const optionsOf = (type: string) => {
      const drawable = views[type].filter((view) => !drawsItself(view, type));
      return {
        plain: drawable.filter((view) => !found.pointers.has(view)),
        marks: drawable.filter((view) => found.pointers.has(view))
      };
    };
    const chosen: Record<string, string[]> = {};
    const pointerChosen: Record<string, string[]> = {};
    const renderVariables: Record<string, string> = {};
    for (const { name, start, inNode } of rendered) {
      const { plain, marks } = optionsOf(name);
      const asMark = marks.length > 0 && (!inNode || !plain.length);
      if (asMark) pointerChosen[name] = marks;
      else chosen[name] = plain;
      const { line, column } = sourcePosition(source, start);
      renderVariables[`${line}:${column + 1}`] = `${asMark ? 'pointers' : 'views'}.${name}`;
    }
    const endless = rendered.find(
      ({ name }) => !(chosen[name]?.length || pointerChosen[name]?.length)
    );
    if (endless)
      throw new InvalidSvelteSourceError(
        `Every view of ${endless.name} draws ${endless.name} itself, without end: add a view that draws its value with nodes, as {#snippet ${endless.name}Cell(value: ${endless.name})}<Node {value} />{/snippet}.`,
        { code: 'view_component', start: sourcePosition(source, endless.start) }
      );
    // Which view draws a value is a look, the variant's: a value is rendered through its type, and
    // a view by its own name is no render.
    const sites = renderSites(ast.html, svelteSource, new Set(Object.keys(components)), paths);
    const named = sites.filter(({ name }) => Object.hasOwn(components, name));
    if (named.length)
      throw InvalidSvelteSourceError.combine(
        named.map(({ name, start }) => {
          const type = components[name];
          const variable = `${found.pointers.has(name) ? 'pointers' : 'views'}.${type}`;
          return new InvalidSvelteSourceError(
            `{@render ${name}(…)} names the view ${name}, but which view draws a value is the variant's: render its type, as {@render ${type}(…)}, which ${variable} chooses the view of, and a place's own choice draws one render apart.`,
            { code: 'view_component', start: sourcePosition(source, start) }
          );
        })
      );
    // Each render with an argument is a place, named by what is written there (see Place): its own
    // choice of view, where its type has more than one of the kind it draws, and its own paint for
    // the kinds of the views it can draw, each falling back to the type's and the kinds' until a
    // variant sets them. A place drawing another view than its type's is drawn through an alias.
    const placeChoices: Record<
      string,
      { key: string; base: string; options: string[]; pointer: boolean }
    > = {};
    const placeKinds = new Map<string, { base: string; role: KindRole }>();
    const placeSlots = new Map<number, string>();
    const pointerPlaces = new Map<number, { view?: string; choice?: string; place: string }>();
    const aliases = new Map<number, { alias: string; callee: { start: number; end: number } }>();
    const aliasOf = new Map<string, string>();
    const placeReaders = new Map<string, Set<boolean>>();
    const labelMarks = new Map<string, { kinds: Record<string, string>; by?: string }>();
    for (const site of sites) {
      const { name, start, inNode, at, label } = site;
      if (!at || !(chosen[name] || pointerChosen[name])) continue;
      const { plain, marks } = optionsOf(name);
      const asMark = marks.length > 0 && (!inNode || !plain.length);
      const options = asMark ? marks : plain;
      const prefix = asMark ? 'pointers' : 'views';
      const within = site.within ? `${site.within}.` : '';
      const readers = placeReaders.get(`${within}${name}${at}`) ?? new Set<boolean>();
      placeReaders.set(`${within}${name}${at}`, readers.add(label));
      let alias: string | undefined;
      if (options.length > 1) {
        const key = `${prefix}.${within}${name}${at}`;
        alias = aliasOf.get(key) ?? `__place${aliasOf.size + 1}`;
        aliasOf.set(key, alias);
        placeChoices[alias] = { key, base: `${prefix}.${name}`, options, pointer: asMark };
        const { line, column } = sourcePosition(source, start);
        renderVariables[`${line}:${column + 1}`] = key;
      }
      const chooser = asMark ? `__pointer_${alias ?? name}` : `__choice_${alias ?? name}`;
      const place = `{ within: ${JSON.stringify(within)}, at: ${JSON.stringify(at)}, view: ${chooser} }`;
      if (asMark)
        pointerPlaces.set(start, {
          ...(alias ? { view: `__pointerOf_${alias}`, choice: `__pointer_${alias}` } : {}),
          place
        });
      else {
        placeSlots.set(start, place);
        if (alias) aliases.set(start, { alias, callee: site.callee });
      }
      for (const view of options)
        for (const kind of kinds)
          if (kind.key === view || kind.key.startsWith(`${view}.`))
            placeKinds.set(`${within}${kind.key}${at}`, { base: kind.key, role: kind.role });
      // A label the root marks: its listing region's paint falls back to the mark's.
      if (asMark && label && !within)
        labelMarks.set(at.slice(1), {
          kinds: Object.fromEntries(
            options
              .filter((view) => kinds.some(({ key }) => key === kindKey(view, 'Pointed')))
              .map((view) => [view, `${kindKey(view, 'Pointed')}${at}`])
          ),
          ...(options.length > 1 ? { by: `pointers.${name}${at}` } : {})
        });
    }
    // One @ names a label or a variable, so a place a label and a variable would share is refused.
    const shared = [...placeReaders].find(([, readers]) => readers.size > 1);
    if (shared)
      throw new InvalidSvelteSourceError(
        `${shared[0]} is rendered at a label and at a variable both named ${shared[0].slice(shared[0].indexOf('@'))}, but a place's name says which: rename the label.`,
        { code: 'view_label' }
      );
    const input = blocks.input
      ? interpretBlock(source, blocks.input, (body) => interpretInput(body, domain))
      : { state: {}, types: {} };
    const algorithm = blocks.algorithm;
    // The labels the markup reads, each resolved to one of the algorithm's; their problems wait for
    // the labels' own, which the first trace reports.
    const algorithmLabels = interpretBlock(source, algorithm, (body) => {
      const parsed = parseBlock(body, 'algorithm', domain);
      return { ...stepLabels(parsed), calls: operatorCalls(parsed.root, operators) };
    });
    const filters = new Set(appliedRenders.flatMap(({ filter }) => (filter ? [filter] : [])));
    const snippets = snippetRangesOf(ast.html);
    const labelled: Record<string, { label: string; sample?: LabelRun }> = {};
    const histories: Record<string, { operator: string; start: number; end: number }> = {};
    const narrowed = new Map<string, { start: number; end: number }>();
    // The labels {#when} blocks draw their contents in the runs of, by key.
    const during: Record<string, string> = {};
    const tested = ifTestsOf(ast.html);
    const labelProblems: InvalidSvelteSourceError[] = [];
    if (!algorithmLabels.problems.length)
      for (const reference of references) {
        const at = { code: 'view_label', start: sourcePosition(source, reference.start) };
        const problem = (message: string) =>
          labelProblems.push(new InvalidSvelteSourceError(message, at));
        if (reference.kind === 'during') {
          const block = reference.branch ? ':when' : '#when';
          if (snippets.some(({ start, end }) => start <= reference.start && reference.start < end))
            problem(
              `{${block} @${reference.path ?? ''}} is in a view, which draws only its value: write it in the root or a part of the page.`
            );
          else if (typeof reference.branch === 'number')
            problem(
              `{:when @${reference.path}} names a label too short to read as a chain's branch: give it a name of ${reference.branch} or more characters.`
            );
          else if (reference.path === undefined)
            problem(
              '{#when …} takes a label by its full name, as {#when @insert.swap}…{/when}, and draws its contents at each step inside a run of that label.'
            );
          else {
            const found = resolveLabel(reference.path, algorithmLabels.labels, false);
            if ('problem' in found) problem(found.problem);
            else during[reference.key] = found.label.full;
          }
          continue;
        }
        if (reference.kind === 'value' && tested.has(reference.start)) {
          problem(
            `{#if ${asWritten(reference.key)}} would choose what to draw by the label's value, which a view never does: {#when ${asWritten(reference.key)}}…{/when} draws its contents at each step inside a run of the label.`
          );
          continue;
        }
        if (snippets.some(({ start, end }) => start <= reference.start && reference.start < end)) {
          problem(
            `${asWritten(reference.key)} is read in a view, which sees only its value; labels are read in the root and its parts, which pass what a view draws, as {@render Int(@swap.a)}.`
          );
          continue;
        }
        if (reference.kind === 'applied' && !operators.has(reference.operator)) {
          problem(
            `applied(${reference.operator}) takes an operator the domain declares, as applied(Equal).`
          );
          continue;
        }
        if (reference.path === undefined) {
          const { operator } = reference as { operator: string };
          problem(
            `applied(${operator}) draws no label's applications: ${labelledForm(operator, algorithmLabels, (path) => `applied(${operator}, ${path})`)}.`
          );
          continue;
        }
        const filter = reference.kind === 'value' && filters.has(reference.key);
        const found = resolveLabel(
          reference.path,
          algorithmLabels.labels,
          reference.kind !== 'applied' && !filter
        );
        if ('problem' in found) {
          problem(found.problem);
          continue;
        }
        if (reference.kind === 'applied')
          histories[reference.key] = {
            operator: reference.operator,
            ...labelSpan(found.label)
          };
        else if (filter) narrowed.set(reference.key, labelSpan(found.label));
        else labelled[reference.key] = { label: found.label.full };
      }
    const whens = whenChainsOf(ast.html);
    for (const start of whens.elses)
      labelProblems.push(
        new InvalidSvelteSourceError(
          "{#when …} has no {:else}: what shows outside the label's runs goes beside the block, where it shows at every step, and another label's steps take a branch of its own, {:when @insert.swap}.",
          { code: 'view_label', start: sourcePosition(source, start) }
        )
      );
    // Operators run in the algorithm: the view reads what a label on an application gave.
    if (!algorithmLabels.problems.length)
      for (const { name, start } of viewOperatorCalls(ast.html, operators)) {
        const on = algorithmLabels.calls
          .filter((call) => call.name === name)
          .flatMap((call) =>
            algorithmLabels.labels.filter((label) => {
              const span = labelSpan(label);
              return span.start === call.start && span.end === call.end;
            })
          );
        const names = [...new Set(on.map(({ full }) => `@${full}`))];
        labelProblems.push(
          new InvalidSvelteSourceError(
            `${name}(…) applies an operator in the view, which only draws what the algorithm computed: ${names.length ? `read ${names.join(' or ')}, a label on an application of ${name}, in the root or a part of the page` : `label an application of ${name} in the algorithm, as @next[${name}(i)], and read that label, by its full name, in the root or a part of the page`}.`,
            { code: 'view_label', start: sourcePosition(source, start) }
          )
        );
      }
    if (!algorithmLabels.problems.length)
      for (const { name, filter, fromHistory, start } of appliedRenders)
        if (!filter && !fromHistory)
          labelProblems.push(
            new InvalidSvelteSourceError(
              `{@render ${name}()} draws no label's application: ${labelledForm(name, algorithmLabels, (path) => `{@render ${name}(${path})}`)}.`,
              { code: 'view_label', start: sourcePosition(source, start) }
            )
          );
    if (labelProblems.length) throw InvalidSvelteSourceError.combine(labelProblems);
    const appliedIn: Record<string, { operator: string; start: number; end: number }> = {};
    for (const { name, filter } of appliedRenders) {
      const span = filter ? narrowed.get(filter) : undefined;
      if (span) appliedIn[`${name}_${filter}`] = { operator: name, ...span };
    }
    // The page pauses where labels finish (see Pacing), at the labels a variant pauses at, else at
    // every label; the applications made inside the labels the root renders an operator at, one at
    // a time or so far, are kept.
    const shown = new Map<string, { start: number; end: number }[]>();
    for (const { operator, start, end } of [
      ...Object.values(appliedIn),
      ...Object.values(histories)
    ])
      shown.set(operator, [...(shown.get(operator) ?? []), { start, end }]);
    const pacing: Pacing = { shown };
    const keep = { labels: new Set(Object.values(labelled).map(({ label }) => label)) };
    const traced = paced(source, algorithm, input, domain, pacing, keep);
    const master = traced.steps;
    // A chain's branches take turns in one place: none may show at a step another shows at. The
    // master pauses at every label, so every step any pacing has is among its steps.
    const overlaps = whens.chains.flatMap(({ start, keys }) => {
      const labels = keys.map((key) => during[key]).filter((label) => label !== undefined);
      const both = master.flatMap((step) => {
        const shown = labels.filter((label) => step.inside?.includes(label));
        return shown.length > 1 ? [{ step: step.name ?? '', shown }] : [];
      });
      if (!both.length) return [];
      const [{ shown }] = both;
      const steps = [...new Set(both.map(({ step }) => step))];
      return [
        new InvalidSvelteSourceError(
          `The {#when} chain's branches @${shown.join(' and @')} would both show at ${steps.slice(0, 3).join(', ')}${steps.length > 3 ? ` and ${steps.length - 3} more` : ''}, inside runs of both; a chain's branches take turns in one place, so give each a label whose runs never meet the others', or write them as {#when} blocks of their own.`,
          { code: 'view_label', start: sourcePosition(source, start) }
        )
      ];
    });
    if (overlaps.length) throw InvalidSvelteSourceError.combine(overlaps);
    const labelNames = traced.labels.map(({ full }) => full);
    const parents = new Set(traced.labels.flatMap(({ parent }) => (parent ? [parent.full] : [])));
    const leaves = new Set(labelNames.filter((label) => !parents.has(label)));
    // Pausing at every label, the finest the steps go, whose states those of any other pauses are
    // among, each accumulating, which holds the most; where that outruns the limit, the starter's.
    let finest: MasterStep[] = [];
    try {
      finest = paced(
        source,
        algorithm,
        input,
        domain,
        { ...pacing, pauses: pausing(labelNames, leaves) },
        keep
      ).steps;
    } catch {
      finest = [];
    }
    const seen = [...master, ...finest];
    // Every state a presentation can show: each step's before and after.
    const everyStep = [...phasesOf(master), ...phasesOf(finest)];
    // An application of each operator the root renders, from any step, to stand in hidden; for one
    // no step applies, as a branch this input never takes, its widest value, drawn hidden throughout.
    const applied: Record<string, Application> = {};
    const widest = probeValues(viewing, everyStep);
    for (const name of appliedNames) {
      const operator = appliedIn[name]?.operator ?? name;
      const made = seen
        .flatMap((step) => step.applied?.[operator] ?? [])
        .find((application) => within(application, appliedIn[name]));
      const value = made ? undefined : (widest(operator)?.widest[0] as TraceState | undefined);
      applied[name] = made ?? {
        state: value ?? {},
        types: typesOf(viewing, operator, value)
      };
    }
    // A value of each label the root reads, from any step, to stand in hidden where a step gave
    // none or several.
    for (const entry of Object.values(labelled))
      entry.sample = seen.flatMap((step) => step.labelled?.[entry.label] ?? [])[0];
    const written = listingsFrom(source, traced, algorithm, listingBlocks);
    if (listing && !listingBlocks.length)
      written.problems.push(
        new InvalidSvelteSourceError(
          'A <Listing /> shows a listing of the source\'s own: add its text in a <script lang="sverlin" listing="code"> block, marking each part to light as @label[text], and label the algorithm\'s code the same way, as @label[…] around it (see Listing).',
          { code: 'view_markup', start: sourcePosition(source, listingAt ?? 0) }
        )
      );
    if (written.problems.length) throw InvalidSvelteSourceError.combine(written.problems);
    const ownListings = listingBlocks.map(({ name }) => name);
    const listings = listing
      ? Object.fromEntries(
          Object.entries(written.listings).map(([name, { text, regions = [] }]) => [
            name,
            { text, regions: regions.map(({ label, start, end }) => ({ label, start, end })) }
          ])
        )
      : undefined;
    // Each region a listing marks is a place, by its label's full name, its paint at each level
    // starting as the level's own.
    const regionLabels = [
      ...new Set(
        Object.values(listings ?? {}).flatMap(({ regions }) => regions.map(({ label }) => label))
      )
    ];
    const regionStarter = Object.fromEntries(
      Object.keys(listingRegionSpace(regionLabels)).map((key) => {
        const prop = key.slice(key.lastIndexOf('.') + 1);
        return [key, starterListing[`listing.lit.${prop}`]];
      })
    );
    // Variables out of scope at some step, however paced: what the view draws from one is hidden
    // there.
    const scoped = new Set([
      ...stateNames.filter((name) => everyStep.some(({ state }) => !(name in state))),
      ...Object.keys(labelled).filter(isLabelKey)
    ]);
    // What the root reads besides the state: labels' values, their values so far, and operators'
    // applications so far, each a prop of its key.
    const viewState = new Set([
      ...stateNames,
      ...Object.keys(labelled),
      ...Object.keys(histories),
      ...Object.keys(during)
    ]);
    if (viewProblems.length) throw InvalidSvelteSourceError.combine(viewProblems);
    const viewNames = new Set([
      ...Object.keys(components),
      ...Object.keys(chosen),
      ...Object.keys(pointerChosen)
    ]);
    // A pointer is a view with a <Pointed>, or a position type rendered by name as one, choosing
    // among its pointer views (see withGeneratedScripts).
    const pointerViews = new Set([...found.pointers, ...Object.keys(pointerChosen)]);
    const choiceOf = (name: string) => ({
      options: pointerChosen[name] ?? [],
      value: `__pointer_${name}`,
      view: `__pointerOf_${name}`
    });
    // A pointer's kind, for a position, as code: a link it points at takes its look.
    const paints = [...found.pointed].map(
      ([name, { parameter }]) =>
        `const __paint_${name} = (${parameter}: any) => ({ __kind: ${JSON.stringify(kindKey(name, 'Pointed'))} });`
    );
    // A pointer view's kinds: its own, where nodes are around its <Pointed>, as a variant leaving
    // it out takes the element drawn inside along, so the pointer is then not drawn at all; and its
    // <Pointed>'s, which says whether it is drawn past its collection's ends.
    const pointerKinds = (view: string) => {
      const pointed = found.pointed.get(view)?.tag;
      const root = found.components.find((component) => component.name === view)?.node;
      return {
        around: nodeAround(root, pointed) ? [view] : [],
        pointed: kindKey(view, 'Pointed')
      };
    };
    const pointers = pointerCalls(
      ast.html,
      svelteSource,
      viewState,
      new Map(
        [...pointerViews].map((name) => {
          const choice = choiceOf(name);
          const type = components[name] ?? components[choice.options[0] ?? ''];
          const paint = found.pointers.has(name)
            ? `__paint_${name}`
            : `(position: number) => (({ ${choice.options.map((option) => `${option}: __paint_${option}`).join(', ')} }) as Record<string, (position: number) => object>)[${choice.value}]?.(position) ?? {}`;
          // The scoped variables its view reads, or any view its type chooses among reads.
          const reads = (found.pointers.has(name) ? [name] : choice.options).flatMap((option) =>
            [...readsOf(found.components.find((view) => view.name === option)!.node)].filter(
              (read) => scoped.has(read)
            )
          );
          return [
            name,
            {
              ...(domain.structures[type]?.kind === 'ref' &&
              !(domain.structures[type] as { heap?: boolean }).heap
                ? {
                    into: (domain.structures[type] as { collection: string }).collection,
                    ref: true
                  }
                : { into: viewing.atoms[type]?.index ?? '' }),
              paint,
              ...(found.pointers.has(name) ? {} : { view: choice.view }),
              ...(chosen[name] ? { plainInNode: true } : {}),
              kinds: found.pointers.has(name)
                ? `() => (${JSON.stringify(pointerKinds(name))})`
                : `() => (${JSON.stringify(Object.fromEntries(choice.options.map((option) => [option, pointerKinds(option)])))} as Record<string, { around: string[]; pointed: string }>)[${choice.value}]`,
              ...(reads.length ? { reads: [...new Set(reads)] } : {})
            }
          ];
        })
      ),
      scoped,
      pointerPlaces
    );
    if (pointers.problems.length)
      throw InvalidSvelteSourceError.combine(
        pointers.problems.map(
          ({ message, start }) =>
            new InvalidSvelteSourceError(message, {
              code: 'view_component',
              start: sourcePosition(source, start)
            })
        )
      );
    const viewCalls = viewCallsOf(ast.html, viewNames);
    if (viewCalls.length)
      throw InvalidSvelteSourceError.combine(
        viewCalls.map(
          ({ name, start }) =>
            new InvalidSvelteSourceError(
              `${name}(…) is a view, which only draws: write {@render ${name}(value)}, with a value from the state. Values are made in the input and algorithm blocks, not in the view; a loop's own index, as k in {#each list as v, k}, is shown as text, {k}.`,
              { code: 'view_component', start: sourcePosition(source, start) }
            )
        )
      );
    // A presentation opens on the input as given, before the algorithm declares anything: the view
    // reading a variable itself is hidden until it is declared (see leftOutModel), and refused only
    // where it is out of scope after that.
    const phased = [master, finest].map(phasesOf);
    const scopedLater = new Set(
      [...scoped].filter(
        (name) =>
          isLabelKey(name) ||
          phased.some((phases) => {
            const first = phases.findIndex(({ state }) => name in state);
            return first >= 0 && phases.slice(first).some(({ state }) => !(name in state));
          })
      )
    );
    const scopedReads = scopedReadsOf(ast.html, scopedLater);
    const openingReads = scopedReadsOf(
      ast.html,
      new Set([...scoped].filter((name) => !scopedLater.has(name)))
    );
    if (scopedReads.length)
      throw InvalidSvelteSourceError.combine(
        scopedReads.map(
          ({ name, start }) =>
            new InvalidSvelteSourceError(
              `The view reads ${asWritten(name)} itself, but ${asWritten(name)} is out of scope at some steps, where there is no value to show. Draw it through a view or a pointer, as in {@render Int(${asWritten(name)})}, which draw nothing where it is out of scope.${isLabelKey(name) ? ` A view cannot choose what to draw by a label's value, as {#if ${asWritten(name)}}: {#when ${asWritten(name)}}…{/when} draws its contents at each step inside a run of the label, and to mark only what a test let through, label the positions the code it guards uses and render the type at those labels (see Views of what a step computed).` : ''}`,
              { code: 'view_component', start: sourcePosition(source, start) }
            )
        )
      );
    const unhidden = outsideNodes(ast.html, openingReads);
    if (unhidden.length)
      throw InvalidSvelteSourceError.combine(
        unhidden.map(
          ({ name, start }) =>
            new InvalidSvelteSourceError(
              `The view reads ${asWritten(name)} itself outside any <Node>, but ${asWritten(name)} is not declared yet at step 0, the input as given, so there is nothing to show there. Put the read inside a <Node>, which hides until ${asWritten(name)} is declared.`,
              { code: 'view_component', start: sourcePosition(source, start) }
            )
        )
      );
    const slotted = new Map<number, string[]>();
    const tagged = withInsertions(svelteSource, [
      ...insertions,
      ...pointers.removals,
      ...slotInsertions(
        ast.html,
        svelteSource,
        viewState,
        new Set([
          ...Object.keys(components).filter((name) => !found.pointers.has(name)),
          ...Object.keys(chosen)
        ]),
        new Set(Object.keys(components)),
        scoped,
        operators,
        slotted,
        pointers.removals,
        placeSlots
      ),
      ...[...aliases.values()].map(({ alias, callee }) => ({
        at: callee.start,
        text: alias,
        remove: callee.end - callee.start
      }))
    ]);
    const leftOut = leftOutModel(ast.html, source, nodeKinds, slotted, paths, openingReads);
    // A place drawing its own choice of view is decided by that choice.
    for (const [start, { alias }] of aliases) {
      const render = leftOut.renders[siteOf(source, start)];
      if (render) render.callee = alias;
    }
    const viewAliases = Object.fromEntries(
      Object.entries(placeChoices).flatMap(([alias, { pointer, options }]) =>
        pointer ? [] : [[alias, options]]
      )
    );
    const pointerAliases = Object.fromEntries(
      Object.entries(placeChoices).flatMap(([alias, { pointer, options }]) =>
        pointer ? [[alias, options]] : []
      )
    );
    const component = compile(
      withGeneratedScripts(
        `${tagged}${probeMarkup(components)}{#snippet __sverlinNone()}{/snippet}`,
        [
          ...stateNames,
          ...appliedNames.map(appliedKey),
          ...Object.keys(labelled),
          ...Object.keys(histories),
          ...Object.keys(during),
          ...Object.keys(chosen),
          ...Object.keys(viewAliases)
        ],
        { ...chosen, ...viewAliases },
        { ...pointerChosen, ...pointerAliases },
        pointers.calls,
        paints,
        linked.length ? endTypes : []
      ),
      { filename: 'Main.svelte', generate: 'client', css: 'injected', dev: false }
    ).js.code;
    const { probes, problems: probeProblems } = componentProbes(
      found.components,
      components,
      chosen,
      viewing,
      everyStep
    );
    const rootMarkup = (ast.html?.children ?? []).filter(
      (node: { type?: string; expression?: { name?: string } }) =>
        !(node.type === 'SnippetBlock' && Object.hasOwn(components, node.expression?.name ?? ''))
    );
    // The steps each way of pausing makes, with what follows from them, made once each; the
    // starter's are the master's.
    const pacedBy = new Map<string, PacedSteps>();
    const pacedSteps = (given: Pauses | ReadonlySet<string>): PacedSteps => {
      const pauses: Pauses = 'get' in given ? given : pausing(given, leaves);
      const key = pausesKey(pauses);
      const made = pacedBy.get(key);
      if (made) return made;
      const steps =
        key === pausesKey(new Map(labelNames.map((label) => [label, 'on'])))
          ? master
          : paced(source, algorithm, input, domain, { ...pacing, pauses }, keep).steps;
      const result: PacedSteps = {
        steps,
        // By the page's states, each step's before and after (see phasesOf).
        placements: rootPlacements(rootMarkup, stateNames, viewNames, viewing, phasesOf(steps)),
        lit: listing
          ? Object.fromEntries(
              Object.entries(written.listings).map(([name, listed]) => [
                name,
                lightSteps(listed, steps)
              ])
            )
          : {}
      };
      pacedBy.set(key, result);
      return result;
    };
    if (probeProblems.length)
      throw InvalidSvelteSourceError.combine(
        probeProblems.map(
          ({ message, start }) =>
            new InvalidSvelteSourceError(message, {
              code: 'view_component',
              start: sourcePosition(source, start)
            })
        )
      );
    return {
      source,
      component,
      master,
      ownListings,
      pauses: { labels: labelNames, leaves: [...leaves] },
      paced: pacedSteps,
      // Steps line up by their moments, so the identity tells presentations aligned that way from
      // those that number steps by their place.
      signature: stepSignature([
        'moments',
        ...master.map(({ state, types, targets }) => JSON.stringify({ state, types, targets }))
      ]),
      atoms,
      components: probes,
      design: {
        views: chosen,
        pointers: pointerChosen,
        tags: tagKinds,
        renders: renderVariables,
        places: placeChoices,
        fallbacks: Object.fromEntries([
          ...Object.values(placeChoices).map(({ key, base }) => [key, base]),
          ...[...placeKinds].flatMap(([key, { base, role }]) =>
            roleProps[role]
              .filter((prop) => placeProps.has(prop))
              .map((prop) => [`${key}.${prop}`, `${base}.${prop}`])
          ),
          // After the marks' places, which the regions' fall back to.
          ...Object.entries(listingRegionFallbacks(regionLabels, labelMarks))
        ]),
        space: {
          ...designSpace(kinds, chosen, listing, ownListings, pointerChosen, {
            kinds: [...placeKinds].map(([key, { role }]) => ({ key, role })),
            choices: Object.values(placeChoices)
          }),
          ...listingRegionSpace(regionLabels),
          ...pauseSpace(labelNames, leaves)
        },
        starter: {
          ...starterVariant(kinds, chosen, listing, ownListings, pointerChosen, {
            kinds: [...placeKinds].map(([key, { role }]) => ({ key, role })),
            choices: Object.values(placeChoices)
          }),
          ...regionStarter,
          ...starterPauses(labelNames)
        }
      },
      ...(listings ? { listings } : {}),
      ...(appliedNames.length ? { applied } : {}),
      ...(Object.keys(appliedIn).length ? { appliedIn } : {}),
      ...(Object.keys(labelled).length ? { labelled } : {}),
      ...(Object.keys(histories).length ? { histories } : {}),
      ...(Object.keys(during).length ? { during } : {}),
      leftOut: {
        model: leftOut,
        components: [...Object.keys(components), ...paths.values()]
      }
    };
  } catch (cause) {
    const error =
      cause instanceof InvalidSvelteSourceError
        ? cause
        : new InvalidSvelteSourceError(
            cause instanceof Error ? cause.message : String(cause),
            cause
          );
    throw viewProblems.length && !viewProblems.includes(error)
      ? InvalidSvelteSourceError.combine([error, ...viewProblems])
      : error;
  }
}

/**
 * The variables out of scope at a step that are in scope at another, each with its value, types,
 * and bindings from the nearest such step, earlier first: drawn hidden, they keep their room, and
 * the view never reads a variable that is not there.
 */
function standInsFor(
  master: readonly MasterStep[],
  index: number
): { state: TraceState; types: Record<string, string>; targets: Record<string, string> } {
  const names = new Set(master.flatMap((step) => Object.keys(step.state)));
  const standIn = { state: {} as TraceState, types: {}, targets: {} };
  const under = (name: string, record: Record<string, string> = {}) =>
    Object.entries(record).filter(
      ([path]) => path === name || path.startsWith(`${name}[`) || path.startsWith(`${name}.`)
    );
  for (const name of names) {
    if (name in master[index].state) continue;
    const nearest = master
      .map((step, at) => ({ step, distance: Math.abs(at - index) + (at > index ? 0.5 : 0) }))
      .filter(({ step }) => name in step.state)
      .sort((a, b) => a.distance - b.distance)[0]?.step;
    if (!nearest) continue;
    standIn.state[name] = nearest.state[name];
    Object.assign(standIn.types, Object.fromEntries(under(name, nearest.types)));
    Object.assign(standIn.targets, Object.fromEntries(under(name, nearest.targets)));
  }
  return standIn;
}

/**
 * Give every variable of the design its value, from the variant the request describes, and bundle
 * the presentation with every step's state.
 */
export async function bundlePresentation(
  prepared: PreparedComponent,
  seed: number,
  request: VariantRequest = {}
): Promise<SvelteBundle> {
  const { design } = prepared;
  let variant: ReturnType<typeof buildVariant>;
  try {
    variant = buildVariant(design.space, design.starter, request, seed, design.fallbacks);
  } catch (cause) {
    if (!(cause instanceof DesignValueError)) throw cause;
    throw new InvalidSvelteSourceError(cause.message, { code: 'design_value' });
  }
  const { values } = variant;
  const frame: FrameSettings = {
    ratio: values['frame.ratio'] as FrameSettings['ratio'],
    justify: values['frame.justify'] as FrameSettings['justify'],
    align: values['frame.align'] as FrameSettings['align'],
    padding: values['frame.padding'] as number,
    gap: values['frame.gap'] as number,
    layout: values['frame.layout'] as FrameSettings['layout']
  };
  // Each type rendered by name draws the view the variant chose for it.
  const views = Object.fromEntries([
    ...Object.keys(design.views).map((type) => [type, values[`views.${type}`]]),
    // A place with a choice of its own draws through its alias (see places).
    ...Object.entries(design.places ?? {}).flatMap(([alias, { key, base, pointer }]) =>
      pointer ? [] : [[alias, values[key] ?? values[base]]]
    )
  ]);
  // Each position type rendered as a pointer, the pointer view the variant chose for it.
  const pointerViews = Object.fromEntries([
    ...Object.keys(design.pointers ?? {}).map((type) => [
      `__pointer_${type}`,
      values[`pointers.${type}`]
    ]),
    ...Object.entries(design.places ?? {}).flatMap(([alias, { key, base, pointer }]) =>
      pointer ? [[`__pointer_${alias}`, values[key] ?? values[base]]] : []
    )
  ]);
  // The steps paced as the variant pauses, each placed by its moment.
  const paced = prepared.paced(pausesOf(prepared.pauses, values));
  const master = paced.steps;
  const moments = master.map(({ moment }, index) => moment ?? index);
  // The page shows each step as two states, before its code and after it (see phasesOf). Each
  // carries its atomic types, the page frame, and the variant for the view, under keys no variable
  // can use; a variable out of scope at one stands in hidden (__absent).
  const phases = phasesOf(master);
  const leftOut = leftOutOf(prepared, values, views, phases);
  const states = phases.map((phase, index) => {
    const standIn = standInsFor(phases, index);
    const ownApplied: TraceState = {};
    const ownTypes: Record<string, string> = {};
    // An application's operands and result are copies made at the step, of where they were read.
    const ownIdentities: Record<string, number> = {};
    const ownTargets: Record<string, string> = {};
    // A step's after holds the one application of each operator rendered its own code made; where
    // it made none or several, as at its before, one from another step stands in hidden.
    for (const [name, sample] of Object.entries(prepared.applied ?? {})) {
      const narrowed = prepared.appliedIn?.[name];
      const made =
        index % 2 === 1
          ? phase.applied?.[narrowed?.operator ?? name]?.filter((application) =>
              within(application, narrowed)
            )
          : undefined;
      const own = made?.length === 1;
      const application = own ? made[0] : sample;
      const key = appliedKey(name);
      (own ? ownApplied : standIn.state)[key] = application.state;
      for (const [path, type] of Object.entries(application.types))
        (own ? ownTypes : standIn.types)[`${key}.${path}`] = type;
      for (const [path, target] of Object.entries(application.targets ?? {}))
        (own ? ownTargets : standIn.targets)[`${key}.${path}`] = target;
      if (own)
        for (const [path, id] of Object.entries(application.identities ?? {}))
          ownIdentities[`${key}.${path}`] = id;
    }
    // Each label the root reads: the value its expression gave in the step's own code, at its
    // after, where it gave one; else one from another step stands in hidden. Each label's values
    // so far, and each operator's applications so far, are lists, there at every step.
    const step = Math.floor(index / 2);
    const sofar = master.slice(0, step + 1);
    const at = (path: string, key: string) => key + path.slice('value'.length);
    for (const [key, { label, sample }] of Object.entries(prepared.labelled ?? {})) {
      if (isRunsKey(key)) {
        const list = sofar.flatMap((past, which) =>
          which < step || index % 2 === 1 || index === 0 ? (past.labelled?.[label] ?? []) : []
        );
        ownApplied[key] = list.map((run) => run.state.value);
        list.forEach((run, k) => {
          for (const [path, type] of Object.entries(run.types))
            ownTypes[at(path, `${key}[${k}]`)] = type;
          for (const [path, target] of Object.entries(run.targets))
            ownTargets[at(path, `${key}[${k}]`)] = target;
        });
        continue;
      }
      // A value given at an earlier step inside a run of the label around it still going on is held,
      // drawn from the step's before on.
      const given = (index % 2 === 1 ? phase.labelled?.[label] : undefined) ?? phase.held?.[label];
      const run = given?.length === 1 ? given[0] : sample;
      if (!run) continue;
      const own = given?.length === 1;
      (own ? ownApplied : standIn.state)[key] = run.state.value;
      for (const [path, type] of Object.entries(run.types))
        (own ? ownTypes : standIn.types)[at(path, key)] = type;
      for (const [path, target] of Object.entries(run.targets))
        (own ? ownTargets : standIn.targets)[at(path, key)] = target;
    }
    // A {#when} block's label: there where the step is inside one of its runs, else hidden, its
    // contents keeping their room.
    for (const [key, label] of Object.entries(prepared.during ?? {}))
      (phase.inside?.includes(label) ? ownApplied : standIn.state)[key] = true;
    for (const [key, history] of Object.entries(prepared.histories ?? {})) {
      const list = sofar.flatMap((past, which) =>
        (which < step || index % 2 === 1 || index === 0
          ? (past.applied?.[history.operator] ?? [])
          : []
        ).filter((application) => within(application, history))
      );
      ownApplied[key] = list.map((application) => application.state);
      list.forEach((application, k) => {
        for (const [path, type] of Object.entries(application.types))
          ownTypes[`${key}[${k}].${path}`] = type;
        for (const [path, target] of Object.entries(application.targets ?? {}))
          ownTargets[`${key}[${k}].${path}`] = target;
      });
    }
    return {
      ...standIn.state,
      ...phase.state,
      ...ownApplied,
      ...views,
      ...pointerViews,
      __types: { ...standIn.types, ...phase.types, ...ownTypes },
      __targets: { ...standIn.targets, ...phase.targets, ...ownTargets },
      __absent: Object.keys(standIn.state),
      __identities: { ...phase.identities?.ids, ...ownIdentities },
      __copies: phase.identities?.copies ?? {},
      __refs: phase.identities?.refs ?? {},
      __frame: frame,
      __design: values,
      __leftOut: [...leftOut.nodes, ...leftOut.renders],
      __hiddenSites: prepared.leftOut
        ? hiddenAt(
            prepared.leftOut.model,
            values,
            views,
            new Set(prepared.leftOut.components),
            new Set(Object.keys(standIn.state)),
            leftOut.nodes
          )
        : []
    };
  });
  const language = values['listing.language'];
  const listed = typeof language === 'string' ? prepared.listings?.[language] : undefined;
  const listing = listed
    ? {
        text: listed.text,
        regions: listed.regions,
        // The code a step finished and the code it keeps as run light alike.
        lit: (paced.lit[language as string] ?? []).map(({ current, earlier }) => [
          ...current,
          ...earlier
        ])
      }
    : null;
  const result = await bundle(
    prepared.component,
    JSON.stringify(states),
    JSON.stringify(prepared.atoms),
    JSON.stringify({
      components: prepared.components,
      placements: paced.placements,
      listing
    })
  );
  const output = result.outputFiles[0];
  if (output.contents.byteLength > maximumBundleBytes) {
    throw new InvalidSvelteSourceError('The compiled Svelte presentation is too large.');
  }
  return {
    javascript: output.text,
    labels: master.map(({ name }, index) => name ?? `Step ${index + 1}`),
    masterSignature: prepared.signature,
    masterSteps: moments,
    variant: values,
    origins: variant.origins,
    leftOut: leftOut.nodes
  };
}

/**
 * What a presentation leaves out (see left-out.ts), from its variant, the view each type rendered by
 * name draws, and its states.
 */
export function leftOutOf(
  prepared: PreparedComponent,
  values: Readonly<Record<string, unknown>>,
  views: Readonly<Record<string, unknown>>,
  phases: readonly MasterStep[]
): { nodes: string[]; renders: string[] } {
  if (!prepared.leftOut) return { nodes: [], renders: [] };
  // A label's value is drawn where a step's own code gave it once, an application narrowed to a
  // label where one was made there, and the lists of what has happened at every step.
  const once = <T>(made: (phase: MasterStep) => T[] | undefined) =>
    phases.some((phase, index) => index % 2 === 1 && made(phase)?.length === 1);
  const drawn = (name: string): boolean | undefined => {
    const label = prepared.labelled?.[name];
    if (label) return isRunsKey(name) || once((phase) => phase.labelled?.[label.label]);
    if (prepared.histories?.[name]) return true;
    const narrowed = prepared.appliedIn?.[name.slice('__applied_'.length)];
    if (narrowed)
      return once((phase) =>
        phase.applied?.[narrowed.operator]?.filter((application) => within(application, narrowed))
      );
    return undefined;
  };
  return leftOutSites(
    prepared.leftOut.model,
    values,
    views,
    new Set(prepared.leftOut.components),
    phases,
    drawn
  );
}

const sverlinBlock =
  /<script\s+lang\s*=\s*(["'])sverlin\1(?:\s+(domain|input|design))?\s*>([\s\S]*?)<\/script\s*>/giu;
const listingBlock =
  /<script\s+lang\s*=\s*(["'])sverlin\1\s+listing\s*=\s*(["'])([\w-]*)\2\s*>([\s\S]*?)<\/script\s*>/giu;

/** A listing of the source's own: its name, its text, where the text starts, and the block. */
type ListingBlock = Block & { name: string; start: number };

/** Remove the Sverlin blocks for Svelte, keeping every offset and line in place. */
function extractBlocks(source: string): {
  svelteSource: string;
  // A design block is found only to say that sources have none.
  blocks: Partial<Record<BlockKind | 'design', Block>>;
  listings: ListingBlock[];
} {
  const blocks: Partial<Record<BlockKind | 'design', Block>> = {};
  let svelteSource = source;
  const listings: ListingBlock[] = [];
  for (const match of source.matchAll(listingBlock)) {
    const start = match.index;
    listings.push({
      name: match[3],
      body: match[4],
      offset: start + match[0].indexOf('>') + 1,
      start
    });
    svelteSource =
      svelteSource.slice(0, start) +
      match[0].replace(/[^\n]/gu, ' ') +
      svelteSource.slice(start + match[0].length);
  }
  for (const match of svelteSource.matchAll(sverlinBlock)) {
    const kind = (match[2] ?? 'algorithm') as BlockKind | 'design';
    if (blocks[kind])
      throw new InvalidSvelteSourceError(`A component can have only one ${kind} block.`, {
        code: 'sverlin_block',
        start: sourcePosition(source, match.index)
      });
    const start = match.index;
    blocks[kind] = { body: match[3], offset: start + match[0].indexOf('>') + 1 };
    svelteSource =
      svelteSource.slice(0, start) +
      match[0].replace(/[^\n]/gu, ' ') +
      svelteSource.slice(start + match[0].length);
  }
  const unrecognized = /<script\b[^>]*\blang\s*=\s*(["'])sverlin\1[^>]*>/iu.exec(svelteSource);
  if (unrecognized)
    throw new InvalidSvelteSourceError(
      `Unrecognized sverlin block ${unrecognized[0]}; use <script lang="sverlin">, or add domain, input, or design, as in <script lang="sverlin" input>.`,
      { code: 'sverlin_block', start: sourcePosition(source, unrecognized.index) }
    );
  return { svelteSource, blocks, listings };
}

/** Interpret one block, reporting failures at their position in the authored source. */
function interpretBlock<T>(source: string, block: Block, run: (body: string) => T): T {
  try {
    return run(block.body);
  } catch (cause) {
    if (!(cause instanceof AlgorithmError)) throw cause;
    const at = (offset: number | undefined) =>
      offset === undefined ? undefined : sourcePosition(source, block.offset + offset);
    throw new InvalidSvelteSourceError(cause.message, {
      code: 'algorithm_error',
      start: at(cause.offset),
      end: at(cause.end)
    });
  }
}

function sourcePosition(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line: before.split('\n').length, column: offset - lineStart };
}

/**
 * Give the script-free view its scripts: the library prelude and every recorded value and the view
 * each type rendered by name draws, plus step and seed, as props. Both share the first line so authored line numbers are unchanged.
 */
function withGeneratedScripts(
  source: string,
  props: readonly string[],
  choices: Record<string, string[]>,
  pointerChoices: Record<string, string[]>,
  pointers: readonly string[],
  paints: readonly string[],
  ends: readonly string[] = []
): string {
  // A type rendered by name arrives as the name of the view the variant chose, and the view uses
  // that view under the type's name; none draws nothing. A position type rendered as a pointer
  // arrives as __pointer_Index, its pointer view under __pointerOf_Index; one drawn as none is no
  // pointer.
  const names = [
    ...props.map((name) => (choices[name] ? `${name}: __choice_${name}` : name)),
    ...Object.keys(pointerChoices).map((name) => `__pointer_${name}`),
    'step',
    'seed',
    '__probe'
  ].join(', ');
  const chosen = [
    ...Object.entries(choices).map(
      ([name, options]) =>
        `const ${name} = $derived(({ ${options.join(', ')} } as Record<string, any>)[__choice_${name}] ?? __sverlinNone);`
    ),
    ...Object.entries(pointerChoices).map(
      ([name, options]) =>
        `const __pointerOf_${name} = $derived(({ ${options.join(', ')} } as Record<string, any>)[__pointer_${name}]);`
    )
  ].join(' ');
  // The root's pointers are drawn around what they point at, from the start (see pointerCalls).
  const pointing = pointers.length
    ? `import { providePointers as __sverlinPointers } from 'sverlin'; ${paints.join(' ')} __sverlinPointers([${pointers.join(', ')}]);`
    : '';
  // A link to an end draws it with the view its type chose (see Link.svelte).
  const ending = ends.length
    ? `import { provideEnds as __sverlinEnds } from 'sverlin'; __sverlinEnds({ ${ends.map((name) => `${name}: () => ${name}`).join(', ')} });`
    : '';
  // TypeScript, so the types of components' parameters are read and removed.
  return `<script module>${prelude}</script><script lang="ts">let { ${names} }: Record<string, any> = $props(); ${chosen} ${pointing} ${ending}</script>${source}`;
}

/** An expression in markup, as Svelte's parser gives it (ESTree). */
type Expression = {
  type?: string;
  start?: number;
  end?: number;
  value?: unknown;
  name?: string;
  computed?: boolean;
  expressions?: unknown[];
  quasis?: { value?: { cooked?: string } }[];
  consequent?: Expression;
  alternate?: Expression;
  left?: Expression;
  right?: Expression;
  object?: Expression;
  property?: Expression;
};

type Attribute = {
  type?: string;
  name?: string;
  start?: number;
  value?: true | { type?: string; data?: string; expression?: Expression }[];
};

const layouts = ['row', 'column', 'free'];
const named = (scale: object, numeric = true) => ({ names: Object.keys(scale), numeric });
type PropNames = Record<string, { names: string[]; numeric: boolean } | null>;

/**
 * The props each library component takes in markup: what is drawn and how it is arranged. Its kind
 * is the snippet it is in, and how it looks the design's (see design.server.ts), so none are props.
 */
export const libraryProps: Record<'Node' | 'Link' | 'Pointed', PropNames> = {
  Node: {
    value: null,
    layout: named(Object.fromEntries(layouts.map((name) => [name, name])), false),
    children: null,
    key: null,
    constraints: null,
    flow: named({ x: 0, y: 0 }, false),
    form: named(Object.fromEntries(forms.map((name) => [name, name])), false),
    curve: named({ straight: 0, curved: 0 }, false),
    layoutSeed: null
  },
  Pointed: {},
  Link: {
    from: null,
    to: null,
    directed: null,
    label: null,
    curve: named({ straight: 0, curved: 0 }, false),
    bend: null
  }
};

/** Props that set a look, which belongs to the design, not the markup. */
const designProps = new Set([
  'shape',
  'fill',
  'stroke',
  'opacity',
  'color',
  'font',
  'size',
  'weight',
  'padding',
  'gap',
  'align',
  'justify',
  'radius',
  'strokeWidth',
  'minSize',
  'strokeStyle'
]);

/**
 * Reject a prop a library component does not take, or a written value it cannot use, such as
 * layout="grid", which would otherwise be ignored without a word.
 */
function checkProps(
  component: 'Node' | 'Link' | 'Pointed',
  attributes: readonly Attribute[],
  start: number,
  source: string,
  problems: InvalidSvelteSourceError[]
): void {
  const props = libraryProps[component];
  for (const attribute of attributes) {
    if (attribute.type !== 'Attribute' || !attribute.name) continue;
    const at = { start: sourcePosition(source, attribute.start ?? start) };
    if (!(attribute.name in props)) {
      const named = Object.keys(props).filter((name) => name !== 'children');
      problems.push(
        new InvalidSvelteSourceError(
          attribute.name === 'tags'
            ? `<${component}> takes no tags: its kind is the snippet it is in, so name the node by a snippet, as {#snippet Caption()}<Node>…</Node>{/snippet}, and its look is a variable of that kind.`
            : designProps.has(attribute.name)
              ? `<${component}> ${attribute.name} is a look, which the design gives every kind of node, not the markup: a node's kind is the snippet it is in, and its look is a variable of that kind.`
              : named.length
                ? `<${component}> has no prop ${attribute.name}. Its props are ${named.join(', ')}.`
                : `<${component}> takes no props.`,
          { code: 'unknown_prop', ...at }
        )
      );
      continue;
    }
    const allowed = props[attribute.name];
    if (!allowed) continue;
    const parts = Array.isArray(attribute.value) ? attribute.value : [];
    const [part] = parts;
    const written = parts.length === 1 && part.type === 'Text';
    const candidates =
      parts.length !== 1
        ? []
        : written
          ? [part.data]
          : part.type === 'MustacheTag' || part.type === 'ExpressionTag'
            ? possibleValues(part.expression)
            : [];
    const bad = candidates.find((value) =>
      typeof value === 'number' ? !allowed.numeric : !allowed.names.includes(value ?? '')
    );
    if (bad === undefined) continue;
    const expression = part.expression;
    const what = written
      ? `${attribute.name}="${bad}" is`
      : `${attribute.name}={${source.slice(expression?.start ?? 0, expression?.end ?? 0)}} can be ${JSON.stringify(bad)}, which is`;
    problems.push(
      new InvalidSvelteSourceError(
        `<${component}> ${what} not a value it takes: use ${allowed.names
          .map((name) => `'${name}'`)
          .join(', ')}${allowed.numeric ? ', or a number in braces' : ''}.`,
        { code: 'invalid_prop', ...at }
      )
    );
  }
}

/**
 * The values an expression in markup can have, where they can be known without running it: a
 * literal, or either branch of a condition.
 */
function possibleValues(expression: Expression | undefined): (string | number)[] {
  if (!expression) return [];
  switch (expression.type) {
    case 'Literal':
      return typeof expression.value === 'string' || typeof expression.value === 'number'
        ? [expression.value]
        : [];
    case 'TemplateLiteral': {
      const cooked = expression.quasis?.[0]?.value?.cooked;
      return expression.expressions?.length === 0 && cooked !== undefined ? [cooked] : [];
    }
    case 'ConditionalExpression':
      return [...possibleValues(expression.consequent), ...possibleValues(expression.alternate)];
    case 'LogicalExpression':
      return [...possibleValues(expression.left), ...possibleValues(expression.right)];
    default:
      return [];
  }
}

/** Whether a <Node> is around a tag in some markup. */
function nodeAround(markup: unknown, target: unknown): boolean {
  const walk = (node: unknown, inNode: boolean): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (node === target) return inNode;
    if (Array.isArray(node)) return node.some((child) => walk(child, inNode));
    const part = node as { type?: string; name?: string };
    const isNode = part.type === 'InlineComponent' && part.name === 'Node';
    return Object.entries(part).some(
      ([key, child]) => key !== 'parent' && walk(child, inNode || isNode)
    );
  };
  return walk(markup, false);
}

/** Template markup other than <Node> and <Link> that a view cannot use, by its parsed type. */
const unsupportedMarkup: Record<string, string> = {
  RawMustacheTag: '{@html}',
  DebugTag: '{@debug}',
  Head: '<svelte:head>',
  Title: '<title>',
  Window: '<svelte:window>',
  Document: '<svelte:document>',
  Body: '<svelte:body>',
  Options: '<svelte:options>',
  Slot: '<slot>',
  SlotTemplate: '<svelte:fragment>'
};

/**
 * Tag every <Node>, <Pointed>, and <Link> in the view with the snippet it is in, by its path (see
 * snippetPaths), as the hidden prop __view, which gives its kind; and every <Node> and <Link> with
 * the line and column (both from 1) of its tag in the authored source, as __ref, so a rendered node
 * or link can be traced back to the markup that drew it when a participant selects it for feedback.
 * A <Node> with links among its children is also marked __links, so it lays them out. The props go
 * on the tag's own line, so line numbers are unchanged. Gives every kind of node the view has. The
 * root holds only renders, so every node is in a snippet; one at the top level is a problem.
 */
function withNodeRefs(
  svelteSource: string,
  ast: { html?: unknown; css?: { start: number } | null },
  source: string,
  /** The root <Node> tags of components, by where they start, with the component each roots. */
  roots: ReadonlyMap<number, string>,
  /** The <Node> tags showing their component's own value, by where they start, with its type. */
  valueTypes: ReadonlyMap<number, string>,
  /** Every snippet's path, by its name (see snippetPaths). */
  paths: ReadonlyMap<string, string>,
  /** The types and operators with a view whose links its nodes leave to the node it is rendered in. */
  linkedTypes: ReadonlySet<string> = new Set()
): {
  insertions: Insertion[];
  problems: InvalidSvelteSourceError[];
  kinds: DesignKind[];
  /** The kind of each <Node>, <Pointed>, and <Link> tag, by its line:column, for the editor to show. */
  tagKinds: Record<string, string[]>;
  /** Each <Node> tag's kind, by where it starts, for what a presentation leaves out. */
  nodeKinds: Map<number, string>;
  /** Whether the view places a <Listing />, and where the first starts. */
  listing: boolean;
  listingAt?: number;
} {
  const problems: InvalidSvelteSourceError[] = [];
  // Where each <Listing /> starts, given its source position as the others are.
  const listings: number[] = [];
  type Tag = {
    type?: string;
    name?: string;
    start?: number;
    attributes?: Attribute[];
    children?: (Tag & { data?: string })[];
    expression?: { type?: string; name?: string; callee?: { type?: string } };
  };
  type Entry = { start: number; name: string; links: boolean; view: string; tag: Tag };
  const tags: Entry[] = [];
  const reject = (message: string, code: string, start: number | undefined) =>
    problems.push(
      new InvalidSvelteSourceError(message, { code, start: sourcePosition(source, start ?? 0) })
    );
  // Each <Link> belongs to the nearest <Node> around it, which then lays out with links. Text
  // belongs inside a node, where it can be selected; a view may also write it beside its nodes.
  // `page`: in the root or a part of the page, rather than in a view.
  const walk = (
    value: unknown,
    around: { links: boolean } | undefined,
    inNode: boolean,
    view: string,
    page: boolean
  ): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const part of value) walk(part, around, inNode, view, page);
      return;
    }
    const tag = value as Tag & Record<string, unknown> & { data?: string };
    if (tag.type === 'InlineComponent' && tag.name === 'Listing') {
      const content = (tag.children ?? []).some(
        (child) => !(child.type === 'Text' && !child.data?.trim())
      );
      if (tag.attributes?.length || content)
        reject(
          "<Listing /> takes no props or children: its language and looks are the design's, as listing.language.",
          'view_markup',
          tag.start
        );
      else if (!page)
        reject(
          'A view draws only its value, so place <Listing /> outside views, at the top level or in a part of the page.',
          'view_markup',
          tag.start
        );
      else if (tag.start !== undefined) listings.push(tag.start);
      return;
    }
    // A render names the snippet it draws, so the kinds of its nodes are known before it runs.
    if (
      tag.type === 'RenderTag' &&
      (tag.expression?.type !== 'CallExpression' || tag.expression.callee?.type !== 'Identifier')
    ) {
      reject(
        '{@render …} names the snippet it draws, as {@render Title()} or {@render Int(value)}, so the kinds of the nodes it draws are known before the view runs.',
        'view_markup',
        tag.start
      );
      return;
    }
    // A view whose links its nodes leave out joins the children of the node it is rendered in.
    const callee = tag.type === 'RenderTag' ? tag.expression?.callee : undefined;
    if (around && callee && linkedTypes.has((callee as { name?: string }).name ?? ''))
      around.links = true;
    const library =
      tag.type === 'InlineComponent' &&
      (tag.name === 'Node' || tag.name === 'Link' || tag.name === 'Pointed');
    const element = tag.type === 'Element' || (tag.type === 'InlineComponent' && !library);
    const special = typeof tag.type === 'string' && Object.hasOwn(unsupportedMarkup, tag.type);
    if (element || special) {
      reject(
        element
          ? `<${tag.name}> is not allowed: draw everything with <Node> and <Link>, each in a snippet whose name is its kind, such as {#snippet Caption()}<Node>…</Node>{/snippet}, and the design gives each kind its look.`
          : `${unsupportedMarkup[tag.type as string]} is not allowed: draw everything with <Node> and <Link>.`,
        'view_markup',
        tag.start
      );
      return;
    }
    if (!inNode && ((tag.type === 'Text' && tag.data?.trim()) || tag.type === 'MustacheTag')) {
      reject(
        view === 'root'
          ? 'Text at the top level cannot be selected or given a look; put it in a node in a snippet, as {#snippet Title()}<Node>Linear search</Node>{/snippet}, and render that, {@render Title()}.'
          : 'Text outside a <Node> cannot be selected or given a look; put it in a node, such as <Node>Linear search</Node>.',
        'view_text',
        // Point at the text itself, not the whitespace before it.
        (tag.start ?? 0) + (tag.data ? tag.data.length - tag.data.trimStart().length : 0)
      );
      return;
    }
    if (library && view === 'root' && tag.name !== 'Pointed') {
      reject(
        `<${tag.name}> at the top level: put it in a snippet without parameters, as {#snippet Title()}<Node>…</Node>{/snippet} and {@render Title()}; the snippet's name is its kind.`,
        'view_markup',
        tag.start
      );
      return;
    }
    if (library && tag.name === 'Pointed' && view.includes('.')) {
      reject(
        "A <Pointed> is written in its pointer view itself, not in a snippet inside it, as the view's kind is the pointer's.",
        'view_markup',
        tag.start
      );
      return;
    }
    if (library && tag.start !== undefined) {
      const reserved = tag.attributes?.find(({ name }) => name?.startsWith('__'));
      if (reserved)
        problems.push(
          new InvalidSvelteSourceError(
            `${tag.name} props starting with __, such as ${reserved.name}, are reserved for the library.`,
            { code: 'reserved_prop', start: sourcePosition(source, reserved.start ?? tag.start) }
          )
        );
      else
        checkProps(
          tag.name as 'Node' | 'Link' | 'Pointed',
          tag.attributes ?? [],
          tag.start,
          source,
          problems
        );
      const entry = { start: tag.start, name: tag.name as string, links: false, view, tag };
      tags.push(entry);
      // A link with no from starts at the element its view draws, laid out by the free layout
      // around the elements rather than by the node it sits in.
      const fromless =
        tag.name === 'Link' &&
        !(tag.attributes ?? []).some(
          (attribute) => (attribute as { name?: string }).name === 'from'
        );
      if (fromless && page)
        reject(
          'A <Link> with no from starts at the element its view draws, so it belongs in a view of an element, as <Link to={n.next} /> in {#snippet NodeBox(n: ListNode)}; elsewhere, give it from={…}.',
          'link_placement',
          tag.start
        );
      if (tag.name === 'Link' && !fromless) {
        if (around) around.links = true;
        // In a view, as of an edge, it joins the children of the node the view is rendered in.
        else if (!inNode)
          reject(
            'A <Link> joins children of the node around it: put it, with the nodes it joins, in a <Node layout="free">.',
            'link_placement',
            tag.start
          );
      }
      walk(tag.children, tag.name === 'Node' ? entry : around, true, view, page);
      return;
    }
    const snippet = tag.type === 'SnippetBlock' ? tag.expression?.name : undefined;
    // A part of the page writes its text in nodes, as the root does; a view may write it beside.
    const nested = inNode || (snippet !== undefined && !isPart(tag));
    for (const [key, child] of Object.entries(tag))
      if (key !== 'attributes' && key !== 'parent' && key !== 'metadata')
        walk(
          child,
          around,
          nested,
          snippet ? (paths.get(snippet) ?? snippet) : view,
          snippet ? page && isPart(tag) : page
        );
  };
  if (ast.css)
    reject(
      'Views cannot have a <style>: the design gives each kind of node, the snippet it is in, its look.',
      'view_style',
      ast.css.start
    );
  walk(ast.html, undefined, false, 'root', true);
  // What a node is says which props its kind has: one that arranges its children has a layout's.
  // A field holds only links that start at it, as a node's next: a box, its content centred.
  const isField = ({ name, tag }: Entry) => {
    const children = (tag.children ?? []).filter(
      (child) => !(child.type === 'Text' && !child.data?.trim())
    );
    return (
      name === 'Node' &&
      children.length > 0 &&
      children.every(
        (child) =>
          child.type === 'InlineComponent' &&
          child.name === 'Link' &&
          !(child.attributes ?? []).some((attribute) => attribute.name === 'from')
      )
    );
  };
  const roleOf = (entry: Entry): KindRole => {
    const { name, links, tag } = entry;
    if (name === 'Pointed') return 'pointed';
    if (name === 'Link') return 'link';
    const attributes = tag.attributes ?? [];
    const has = (prop: string) => attributes.some((attribute) => attribute.name === prop);
    const children = (tag.children ?? []).filter(
      (child) => !(child.type === 'Text' && !child.data?.trim())
    );
    if (has('layout') || links || (children.length === 1 && children[0].type === 'EachBlock'))
      return 'container';
    if (has('value') || !children.length || isField(entry)) return 'value';
    return 'text';
  };
  // A kind several roles share takes the plainest look, and every prop any of them has.
  const plainest: KindRole[] = ['container', 'text', 'value', 'pointed', 'link'];
  const kinds = new Map<string, KindRole>();
  const tagKinds: Record<string, string[]> = {};
  const nodeKinds = new Map<number, string>();
  const apart = (of: KindRole) => (of === 'pointed' || of === 'link' ? of : 'node');
  for (const entry of tags) {
    // A node joining links says how its children are placed: freely, as a linked list or a graph,
    // or in a row or column; one holding a collection's {#each} and links runs as the collection.
    if (entry.name === 'Node' && entry.links) {
      const attributes = entry.tag.attributes ?? [];
      const children = (entry.tag.children ?? []).filter(
        (child) =>
          !(child.type === 'Text' && !child.data?.trim()) &&
          !(child.type === 'InlineComponent' && child.name === 'Link')
      );
      const collection = children.length === 1 && children[0].type === 'EachBlock';
      if (!attributes.some((attribute) => attribute.name === 'layout') && !collection)
        reject(
          'A <Node> joining links needs a layout: layout="free" for a linked structure, as a list, a tree, or a graph, or "row" or "column" for children in a line.',
          'link_placement',
          entry.start
        );
    }
    const role = roleOf(entry);
    const key = kindKey(
      entry.view,
      entry.name === 'Pointed' ? 'Pointed' : entry.name === 'Link' ? 'Link' : undefined
    );
    const known = kinds.get(key);
    if (known && apart(known) !== apart(role))
      reject(
        `${key} is the kind of a <${role === 'pointed' ? 'Pointed' : role === 'link' ? 'Link' : 'Node'}> and of another kind of tag: rename the snippet called ${key.slice(key.lastIndexOf('.') + 1)}.`,
        'view_kinds',
        entry.start
      );
    kinds.set(key, known && plainest.indexOf(known) < plainest.indexOf(role) ? known : role);
    if (entry.name === 'Node') nodeKinds.set(entry.start, key);
    const { line, column } = sourcePosition(source, entry.start);
    tagKinds[`${line}:${column + 1}`] = [key];
  }
  const insertions = tags.map((entry): Insertion => {
    const { start, name, links, view } = entry;
    const { line, column } = sourcePosition(source, start);
    const root = roots.get(start);
    const type = valueTypes.get(start);
    const ref = name === 'Pointed' ? '' : ` __ref="${line}:${column + 1}"`;
    return {
      at: start + name.length + 1,
      text: ` __view="${view}"${ref}${links ? ' __links' : ''}${isField(entry) ? ' __field' : ''}${root ? ` __component="${root}"` : ''}${type ? ` __type="${type}"` : ''}`
    };
  });
  for (const start of listings) {
    const { line, column } = sourcePosition(source, start);
    insertions.push({ at: start + 'Listing'.length + 1, text: ` __ref="${line}:${column + 1}"` });
  }
  return {
    listing: listings.length > 0,
    ...(listings.length ? { listingAt: listings[0] } : {}),
    insertions,
    problems,
    kinds: [...kinds].map(([key, role]) => ({ key, role })),
    tagKinds,
    nodeKinds
  };
}

/**
 * Check the view's components: their types are domain types, their names are free, and they read
 * only their value and other components, never the input or algorithm's variables. Gives each
 * component's type.
 */
function checkComponents(
  found: ReturnType<typeof findComponents>['components'],
  pointers: ReadonlySet<string>,
  domain: DomainRegistry,
  stateNames: readonly string[],
  props: readonly string[],
  source: string
): ComponentSignatures {
  const signatures: ComponentSignatures = {};
  for (const { name, start, type, node } of found) {
    const at = { code: 'view_component', start: sourcePosition(source, start) };
    if (!definesType(domain, type))
      throw new InvalidSvelteSourceError(
        `${name}'s type ${type} is not a type; define it in the domain block, or use one that is.`,
        at
      );
    if (
      props.includes(name) ||
      (definesType(domain, name) && name !== type) ||
      libraryNames.includes(name)
    )
      throw new InvalidSvelteSourceError(
        `${name} names a variable, another type, or a library component; choose another component name.`,
        at
      );
    // A pointer is drawn only from the top of the view, where every variable is known.
    const state = [...readsOf(node)].find((read) => stateNames.includes(read));
    if (state && !pointers.has(name))
      throw new InvalidSvelteSourceError(
        `${name} reads ${state}, an input or algorithm variable; a component reads only its value and other views. Draw what needs ${state} where it is in scope, or make it part of ${type}.`,
        at
      );
    if (pointers.has(name) && !domain.atoms[type]?.index && domain.structures[type]?.kind !== 'ref')
      throw new InvalidSvelteSourceError(
        `${name} has a <Pointed>, which stands for the element a position or reference points at, and ${type} is neither an index nor a reference type; a pointer views one, as in const Position = index(Values); or const Front = ref(Queue);.`,
        at
      );
    signatures[name] = type;
  }
  return signatures;
}

async function bundle(component: string, states: string, atoms: string, components: string) {
  try {
    return await bundleComponent(component, states, atoms, components);
  } catch (cause) {
    // Failures located in the authored component, such as a blocked require(), are source errors.
    const authored = (cause as Partial<BuildFailure>).errors?.find(
      (error) => error.location?.file === 'component:Main.svelte'
    );
    if (authored) throw new InvalidSvelteSourceError(authored.text);
    throw cause;
  }
}

// Svelte runtime entry points only; no relative segments that could leave the package.
const runtime = (path: string) => /^svelte(?:\/[\w-]+)*$/u.test(path);

/** Modules each sandbox namespace may reach; packages inside node_modules resolve normally. */
const allowedImports: Record<string, (path: string) => boolean> = {
  entry: (path) =>
    runtime(path) ||
    [
      'virtual:component',
      'virtual:trace',
      'virtual:atoms',
      'virtual:components',
      'sverlin'
    ].includes(path),
  component: (path) => runtime(path) || path === 'sverlin',
  // The constraint layout engine, by its one module, which needs none of WebCola's d3 adaptor.
  library: (path) => runtime(path) || /^\.\.?\//u.test(path) || path === 'webcola/dist/src/layout'
};

function sandboxModules(
  component: string,
  states: string,
  atoms: string,
  components: string
): Plugin {
  return {
    name: 'sandbox-modules',
    setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, (args) => {
        const allowed = allowedImports[args.namespace];
        if (!allowed) return undefined;
        if (!allowed(args.path))
          return { errors: [{ text: `Presentations cannot load module "${args.path}".` }] };
        if (args.path === 'virtual:component')
          return { path: 'Main.svelte', namespace: 'component' };
        if (args.path === 'virtual:trace') return { path: 'states.json', namespace: 'trace' };
        if (args.path === 'virtual:atoms') return { path: 'atoms.json', namespace: 'atoms' };
        if (args.path === 'virtual:components')
          return { path: 'components.json', namespace: 'components' };
        if (args.path === 'sverlin') return { path: 'index.ts', namespace: 'library' };
        if (args.namespace === 'library' && !runtime(args.path) && /^\.\.?\//u.test(args.path)) {
          const path = libraryPath(posix.join(posix.dirname(args.importer), args.path));
          return path
            ? { path, namespace: 'library' }
            : { errors: [{ text: `Unknown library module ${args.path}.` }] };
        }
        return undefined;
      });
      plugin.onResolve({ filter: /^virtual:entry$/ }, () => ({
        path: 'entry.ts',
        namespace: 'entry'
      }));
      plugin.onLoad({ filter: /.*/, namespace: 'entry' }, () => ({
        contents: entrySource,
        loader: 'ts',
        resolveDir: process.cwd()
      }));
      plugin.onLoad({ filter: /.*/, namespace: 'component' }, () => ({
        contents: component,
        loader: 'js',
        resolveDir: process.cwd()
      }));
      plugin.onLoad({ filter: /.*/, namespace: 'atoms' }, () => ({
        contents: atoms,
        loader: 'json'
      }));
      plugin.onLoad({ filter: /.*/, namespace: 'components' }, () => ({
        contents: components,
        loader: 'json'
      }));
      plugin.onLoad({ filter: /.*/, namespace: 'trace' }, () => ({
        contents: states,
        loader: 'json'
      }));
      plugin.onLoad({ filter: /.*/, namespace: 'library' }, (args) => ({
        ...loadLibraryModule(args.path),
        resolveDir: process.cwd()
      }));
    }
  };
}

function bundleComponent(component: string, states: string, atoms: string, components: string) {
  return build({
    entryPoints: ['virtual:entry'],
    plugins: [sandboxModules(component, states, atoms, components)],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: true,
    logLevel: 'silent'
  });
}

function visit(value: unknown, check: (node: { type: string }) => void): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((part) => visit(part, check));
    return;
  }
  const node = value as Record<string, unknown>;
  if (typeof node.type === 'string') check(node as { type: string });
  for (const [key, child] of Object.entries(node)) {
    if (key !== 'parent' && key !== 'metadata') visit(child, check);
  }
}

/**
 * Every {@render} tag: the name it calls, where it starts, whether it is inside a <Node>, and its
 * place (see Place): what its argument is written as after `@`, a label (`@swap.held`), a variable
 * (`@i`), or a field (`@g.a`), none for another expression or none at all; whether it is a label;
 * and, inside a view, that view's path.
 */
function renderSites(
  markup: unknown,
  source: string,
  views: ReadonlySet<string>,
  paths: ReadonlyMap<string, string>
): {
  name: string;
  start: number;
  callee: { start: number; end: number };
  inNode: boolean;
  at?: string;
  label: boolean;
  within: string;
}[] {
  type Part = Record<string, unknown> & {
    type?: string;
    name?: string;
    start?: number;
    end?: number;
    computed?: boolean;
  };
  const sites: ReturnType<typeof renderSites> = [];
  const chain = (node: Part | undefined): boolean =>
    node?.type === 'Identifier' ||
    (node?.type === 'MemberExpression' && !node.computed && chain(node.object as Part));
  const walk = (node: unknown, inNode: boolean, within: string, inView: boolean): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => walk(child, inNode, within, inView));
    const part = node as Part;
    if (part.type === 'SnippetBlock') {
      const name = (part.expression as Part | undefined)?.name ?? '';
      const view = inView || views.has(name);
      walk(part.children, false, view ? (paths.get(name) ?? name) : '', view);
      return;
    }
    if (part.type === 'RenderTag') {
      const call = part.expression as Part | undefined;
      const callee = call?.callee as Part | undefined;
      const name = callee?.name;
      const [argument] = (call?.arguments as Part[] | undefined) ?? [];
      if (typeof name === 'string') {
        const label = argument?.type === 'Identifier' && isLabelKey(argument.name ?? '');
        const written = label
          ? asWritten(argument.name ?? '')
          : chain(argument)
            ? `@${source.slice(argument.start, argument.end)}`
            : undefined;
        sites.push({
          name,
          start: part.start ?? 0,
          callee: { start: callee?.start ?? 0, end: callee?.end ?? 0 },
          inNode,
          ...(written ? { at: written } : {}),
          label,
          within
        });
      }
      return;
    }
    const inside = inNode || (part.type === 'InlineComponent' && part.name === 'Node');
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent') walk(child, inside, within, inView);
  };
  walk(markup, false, '', false);
  return sites;
}

/** Where each <Link> with no from starts: a link a view of an element draws from that element. */
function fromlessLinks(markup: unknown): number[] {
  const starts: number[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const part = node as {
      type?: string;
      name?: string;
      start?: number;
      attributes?: { name?: string }[];
    };
    if (
      part.type === 'InlineComponent' &&
      part.name === 'Link' &&
      !(part.attributes ?? []).some((attribute) => attribute.name === 'from')
    )
      starts.push(part.start ?? 0);
    for (const [key, child] of Object.entries(part)) if (key !== 'parent') walk(child);
  };
  walk(markup);
  return starts;
}

/** The atomic members of each union that also holds a reference to a node: its ends. */
function endTypesOf(domain: DomainRegistry): string[] {
  const ends = new Set<string>();
  for (const structure of Object.values(domain.structures)) {
    if (structure.kind !== 'union') continue;
    const toNode = structure.members.some((member) => {
      const index = domain.atoms[member]?.index;
      return (
        index !== undefined &&
        domain.structures[index]?.kind === 'collection' &&
        index.startsWith('ȟ')
      );
    });
    if (toNode)
      for (const member of structure.members)
        if (domain.atoms[member] && !domain.atoms[member].index) ends.add(member);
  }
  return [...ends];
}

/**
 * The names {@render} tags call, as in {@render Int(value)}, where each tag starts, and whether it
 * is inside a <Node>, where a position is drawn as its number rather than as a mark.
 */
function renderedNames(markup: unknown): { name: string; start: number; inNode: boolean }[] {
  const names: { name: string; start: number; inNode: boolean }[] = [];
  const walk = (node: unknown, inNode: boolean): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => walk(child, inNode));
    const part = node as {
      type?: string;
      name?: string;
      start?: number;
      expression?: { callee?: { name?: string } };
    };
    const name = part.type === 'RenderTag' ? part.expression?.callee?.name : undefined;
    if (name) names.push({ name, start: part.start ?? 0, inNode });
    const inside = inNode || (part.type === 'InlineComponent' && part.name === 'Node');
    for (const [key, child] of Object.entries(part)) if (key !== 'parent') walk(child, inside);
  };
  walk(markup, false);
  return names;
}

/**
 * The prop holding an operator's application at a step, which no variable can be named: by the
 * operator's name, and the label it is narrowed to, as Greater_ℓinner.
 */
function appliedKey(operator: string): string {
  return `__applied_${operator}`;
}

/** Whether an application was made inside a label's code, where a render is narrowed to one. */
function within(application: Application, span?: { start: number; end: number }): boolean {
  return (
    span === undefined ||
    (application.at !== undefined && span.start <= application.at && application.at < span.end)
  );
}

/** Where each view is in the markup, where labels are not read; parts of the page read them. */
function snippetRangesOf(markup: unknown): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const part = node as { type?: string; start?: number; end?: number };
    if (part.type === 'SnippetBlock' && !isPart(part))
      return void ranges.push({ start: part.start ?? 0, end: part.end ?? 0 });
    for (const [key, child] of Object.entries(part)) if (key !== 'parent') walk(child);
  };
  walk(markup);
  return ranges;
}

/**
 * The domain as views see it: each operator a record of its operands, named by its parameters, and
 * its result as value, so a view of an application is a view of a record.
 */
function viewDomainOf(domain: DomainRegistry, viewed: ReadonlySet<string>): DomainRegistry {
  // A reference to a node is drawn as a position in its record's heap, as a step records it.
  const refs = Object.values(domain.structures).filter(
    (structure): structure is RefType => structure.kind === 'ref' && !!structure.heap
  );
  if (refs.length)
    domain = {
      ...domain,
      atoms: {
        ...domain.atoms,
        ...Object.fromEntries(
          refs.map(({ name, collection }) => [name, { name, base: 'integer', index: collection }])
        )
      },
      structures: Object.fromEntries(
        Object.entries(domain.structures).filter(([name]) => !refs.some((ref) => ref.name === name))
      )
    };
  const operators = Object.values(domain.operators ?? {}).filter(({ name }) => viewed.has(name));
  if (!operators.length) return domain;
  const records = operators.map(({ name, operands, parameters, result }): [string, RecordType] => [
    name,
    {
      kind: 'record',
      name,
      fields: {
        ...Object.fromEntries(parameters.map((parameter, index) => [parameter, operands[index]])),
        value: result
      }
    }
  ]);
  return { ...domain, structures: { ...domain.structures, ...Object.fromEntries(records) } };
}

/** The operators the markup applies itself, as Next(p) in to={Next(p)}, by where each call starts. */
function viewOperatorCalls(
  markup: unknown,
  operators: ReadonlySet<string>
): { name: string; start: number }[] {
  const found: { name: string; start: number }[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const part = node as {
      type?: string;
      start?: number;
      callee?: { type?: string; name?: string };
      expression?: { arguments?: unknown };
    };
    // A render's own call names what it draws; only its arguments are computed.
    if (part.type === 'RenderTag') return walk(part.expression?.arguments);
    if (
      part.type === 'CallExpression' &&
      part.callee?.type === 'Identifier' &&
      operators.has(part.callee.name ?? '')
    )
      found.push({ name: part.callee.name ?? '', start: part.start ?? 0 });
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'metadata' && typeof child === 'object') walk(child);
  };
  walk(markup);
  return found;
}

type IfPart = {
  type?: string;
  start?: number;
  elseif?: boolean;
  expression?: { type?: string; name?: string };
  else?: { start?: number; children?: IfPart[] };
};

/** The {:when} branch following a {#when} block or branch, an {:else if} on a key by now. */
function nextBranch(part: IfPart): IfPart | undefined {
  const [next, ...rest] = (part.else?.children ?? []).filter(
    (child) => child.type !== 'Text' || String((child as { data?: string }).data ?? '').trim()
  );
  return !rest.length &&
    next?.type === 'IfBlock' &&
    next.elseif &&
    next.expression?.type === 'Identifier' &&
    isDuringKey(next.expression.name ?? '')
    ? next
    : undefined;
}

/**
 * Each {#when} block's chain of branches, by where it starts, its keys in order; and where each
 * {:else} of one starts, as no branch (see label-values.ts).
 */
function whenChainsOf(markup: unknown): {
  chains: { start: number; keys: string[] }[];
  elses: number[];
} {
  const chains: { start: number; keys: string[] }[] = [];
  const elses: number[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const part = node as IfPart;
    if (
      part.type === 'IfBlock' &&
      !part.elseif &&
      part.expression?.type === 'Identifier' &&
      isDuringKey(part.expression.name ?? '')
    ) {
      const keys = [part.expression.name ?? ''];
      let last = part;
      for (let next = nextBranch(part); next; next = nextBranch(next)) {
        keys.push(next.expression?.name ?? '');
        last = next;
      }
      chains.push({ start: part.start ?? 0, keys });
      if (last.else) elses.push(last.else.start ?? 0);
    }
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'metadata' && typeof child === 'object') walk(child);
  };
  walk(markup);
  return { chains, elses };
}

/** Where each {#if} whose test is a label read alone starts its test, as {#if @insert.swap}. */
function ifTestsOf(markup: unknown): Set<number> {
  const found = new Set<number>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const part = node as {
      type?: string;
      expression?: { type?: string; name?: string; start?: number };
    };
    if (
      part.type === 'IfBlock' &&
      part.expression?.type === 'Identifier' &&
      isLabelKey(part.expression.name ?? '')
    )
      found.add(part.expression.start ?? -1);
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'metadata' && typeof child === 'object') walk(child);
  };
  walk(markup);
  return found;
}

/** Where each <Link> in a snippet starts that no <Node> in it holds. */
function outerLinks(snippet: unknown): number[] {
  const found: number[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const part = node as { type?: string; name?: string; start?: number };
    if (part.type === 'InlineComponent' && part.name === 'Node') return;
    if (part.type === 'InlineComponent' && part.name === 'Link') found.push(part.start ?? 0);
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'metadata' && typeof child === 'object') walk(child);
  };
  walk((snippet as { body?: unknown; children?: unknown }).children ?? snippet);
  return found;
}

/** Where the algorithm applies each operator, as spans in its block. */
function operatorCalls(
  root: AnyNode,
  operators: ReadonlySet<string>
): { name: string; start: number; end: number }[] {
  const found: { name: string; start: number; end: number }[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const part = node as AnyNode & { callee?: { type?: string; name?: string } };
    if (
      part.type === 'CallExpression' &&
      part.callee?.type === 'Identifier' &&
      operators.has(part.callee.name ?? '')
    )
      found.push({ name: part.callee.name ?? '', ...spanOf(part) });
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && typeof child === 'object') walk(child);
  };
  walk(root);
  return found;
}

/**
 * How to write an operator's render or history at a label: at the labels around its applications,
 * innermost first, or where none is, with a label to add around one.
 */
function labelledForm(
  operator: string,
  {
    labels,
    calls
  }: { labels: readonly Label[]; calls: readonly { name: string; start: number }[] },
  form: (path: string) => string
): string {
  const around = calls
    .filter(({ name }) => name === operator)
    .flatMap(({ start }) =>
      labels
        .filter((label) => {
          const span = labelSpan(label);
          return span.start <= start && start < span.end;
        })
        .sort((a, b) => b.full.length - a.full.length)
        .slice(0, 1)
    );
  const names = [...new Set(around.map(({ full }) => `@${full}`))];
  return names.length
    ? `write ${names.map(form).join(' or ')}, a label around an application of ${operator}`
    : `label an application of ${operator} in the algorithm, as @compare[${operator}(…)], and write ${form('@compare')} with the label's full name`;
}

/**
 * Each render of an operator by name: the label it is narrowed to (as {@render Greater(@inner)}),
 * whether it draws an item of {#each applied(…)}, whether it is otherwise given a value, and
 * whether it is in a view (a part of the page is not one).
 */
function operatorRendersOf(
  markup: unknown,
  operators: ReadonlySet<string>
): {
  name: string;
  start: number;
  filter?: string;
  fromHistory?: boolean;
  argued: boolean;
  inView: boolean;
}[] {
  const found: ReturnType<typeof operatorRendersOf> = [];
  const walk = (node: unknown, inView: boolean, items: ReadonlySet<string>): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => walk(child, inView, items));
    const part = node as {
      type?: string;
      start?: number;
      expression?: {
        type?: string;
        name?: string;
        callee?: { name?: string };
        arguments?: unknown[];
      };
      context?: { type?: string; name?: string };
    };
    const name = part.type === 'RenderTag' ? part.expression?.callee?.name : undefined;
    if (name && operators.has(name)) {
      const given = (part.expression?.arguments ?? []) as { type?: string; name?: string }[];
      const [only] = given.length === 1 && given[0].type === 'Identifier' ? given : [];
      const filter = only && isLabelKey(only.name ?? '') ? only.name : undefined;
      const fromHistory = Boolean(only && items.has(only.name ?? ''));
      found.push({
        name,
        start: part.start ?? 0,
        ...(filter ? { filter } : {}),
        ...(fromHistory ? { fromHistory } : {}),
        argued: given.length > 0 && !filter && !fromHistory,
        inView
      });
    }
    // An {#each applied(…) as a} makes a an application, which an operator's render draws.
    const item =
      part.type === 'EachBlock' &&
      part.expression?.type === 'Identifier' &&
      (part.expression.name ?? '').startsWith('ǂ') &&
      part.context?.type === 'Identifier'
        ? part.context.name
        : undefined;
    const inner = item ? new Set([...items, item]) : items;
    const within = inView || (part.type === 'SnippetBlock' && !isPart(part));
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent') walk(child, within, inner);
  };
  walk(markup, false, new Set());
  return found;
}

/** The types of a value's parts by path, as a step records them, from the type it has. */
function typesOf(
  domain: DomainRegistry,
  type: string,
  value: unknown,
  path = ''
): Record<string, string> {
  const types: Record<string, string> = path ? { [path]: type } : {};
  const structure = domain.structures[type];
  const at = (part: string) => (path ? path + part : part.replace(/^\./u, ''));
  if (structure?.kind === 'record' && value && typeof value === 'object')
    for (const [field, fieldType] of Object.entries(structure.fields))
      Object.assign(
        types,
        typesOf(domain, fieldType, (value as Record<string, unknown>)[field], at('.' + field))
      );
  if (structure?.kind === 'collection' && Array.isArray(value))
    value.forEach((item, index) =>
      Object.assign(types, typesOf(domain, structure.element, item, at('[' + index + ']')))
    );
  return types;
}
