/** Compile one untrusted Svelte component without executing its code on the server. */

import { posix } from 'node:path';

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
  type TraceState,
  type TypedState
} from './algorithm/interpret.server';
import { parseBlock } from './algorithm/parse.server';
import { lightSteps, type Lit } from './listing/light.server';
import {
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
  noDomain,
  operatorNames,
  typeNames,
  type DomainRegistry,
  type RecordType
} from './algorithm/structures.server';
import {
  componentProbes,
  findComponents,
  probeMarkup,
  pointerCalls,
  probeValues,
  readsOf,
  rootPlacements,
  scopedReadsOf,
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
  starterVariant,
  type DesignKind,
  type DesignOrigin,
  type DesignSpace,
  type DesignValue,
  type VariantRequest
} from './design.server';
import { hiddenAt, leftOutModel, leftOutSites, type LeftOutModel } from './left-out';
import { kindKey, type KindRole } from './library/node/design';
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
  /** Labels of the steps this presentation keeps: their numbers in the master trace. */
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
  /** The steps of the frame rule the source starts with. */
  master: MasterStep[];
  /** The names of the source's own listings (see listing/mapped.server.ts). */
  ownListings: string[];
  /** The steps of every frame rule the source can step by, by its name (see stepLabels). */
  masters: Record<string, MasterStep[]>;
  /** The source's identity, shared by its presentations whichever events they step by. */
  signature: string;
  atoms: AtomRegistry;
  /** The view's typed components, each after those it renders, as the page enumerates them. */
  components: ComponentProbe[];
  /**
   * Values the root reads for placement, measured with every value of their types, by frame rule,
   * as each names a step of its own.
   */
  placements: Record<string, Placement[]>;
  /**
   * The design space, the views each type rendered by name chooses among, the kinds each tag can
   * be (by its line:column), and the first variant.
   */
  design: {
    views: Record<string, string[]>;
    tags: Record<string, string[]>;
    space: DesignSpace;
    starter: Record<string, DesignValue>;
  };
  /** Where the view places a <Listing />, the algorithm in each language, and what each step lights. */
  listings?: Record<string, LitListing>;
  /**
   * The operators the root renders by name, as {@render Greater()}, each with an application from
   * some step, which stands in hidden where a step has none or several of them.
   */
  applied?: Record<string, Application>;
  /** Of those, the renders taking only applications made inside a label, as {@render Greater(@inner)}. */
  appliedIn?: Record<string, { operator: string; start: number; end: number }>;
  /**
   * The labels the root reads, by key (see label-values.ts): a label's value at a step, or its
   * values so far; each with its full name and a value from some step to stand in.
   */
  labelled?: Record<string, { label: string; sample?: LabelRun }>;
  /** The operators whose applications so far the root draws, by key, some only inside a label. */
  histories?: Record<string, { operator: string; start?: number; end?: number }>;
  /** The view's nodes and renders, and its views, for what each presentation leaves out. */
  leftOut?: { model: LeftOutModel; components: string[] };
};

/** A listing's text and what each step lights in it, by frame rule. */
export type LitListing = { text: string; lit: Record<string, Lit[]> };

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

/**
 * The steps a component's algorithm records, run without its view, so they can be read whether
 * or not the view builds, as by the assistant checking what its algorithm does. Throws the
 * domain, input, or algorithm's problem.
 */
export function recordedTrace(source: string): MasterStep[] {
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
  // By the frame rule the source starts with.
  const runs = framings(source, blocks.algorithm, blocks, input, domain);
  return Object.values(runs)[0].steps;
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

/**
 * The algorithm's steps by every frame rule it can step by (see stepLabels), the one it starts
 * with first, leaving out one whose code never runs or runs more often than the step limit.
 */
function framings(
  source: string,
  algorithm: Block,
  blocks: Partial<Record<BlockKind, Block>>,
  input: TypedState,
  domain: DomainRegistry,
  keep: Parameters<typeof traceAlgorithm>[4] = {}
): Record<string, ReturnType<typeof traceAlgorithm>> {
  // A presentation's steps open on step 0, the input as given, whichever rule they step by.
  const trace = (label?: string) => {
    const run = interpretBlock(source, algorithm, (body) =>
      traceAlgorithm(body, input, domain, label, keep)
    );
    return { ...run, steps: [run.opening, ...run.steps] };
  };
  // The rule it starts with; any problem here is the algorithm's or its labels'.
  const first = trace();
  const runs: Record<string, ReturnType<typeof traceAlgorithm>> = { [first.options[0]]: first };
  for (const label of first.options.slice(1))
    try {
      runs[label] = trace(label);
    } catch {
      // A label whose code never runs, or runs too often, is no option.
    }
  return runs;
}

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
 * What each region of the source's own listings is mapped to, and whether a step of the starting
 * frame rule lights it, for the assistant to check its labels against; none without such a listing.
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
  const traced = Object.values(framings(source, blocks.algorithm, blocks, input, domain))[0];
  const { listings, maps } = listingsFrom(source, traced, blocks.algorithm, listingBlocks);
  return Object.fromEntries(
    Object.entries(maps).map(([name, regions]) => {
      const lit = lightSteps(listings[name], traced.steps).flatMap(({ current, earlier }) => [
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
    const { source: svelteSource, references } = markLabels(extracted.svelteSource);
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
        'Sources have no design block: the design space is made from the view, every look a variable of a kind of node, every type a choice of its views. Remove the block, and say what nodes are with tags, as <Node tags="current">.',
        { code: 'sverlin_block', start: sourcePosition(source, blocks.design.offset) }
      );
    const { insertions, problems, kinds, tagKinds, nodeKinds, listing, listingAt } = withNodeRefs(
      svelteSource,
      ast,
      source,
      found.roots,
      found.valueTypes
    );
    viewProblems = [
      ...problems,
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
    const rendered = renderedNames(ast.html).filter(({ name }) => definesType(viewing, name));
    const appliedRenders = operatorRendersOf(ast.html, operators);
    const wrongRender = appliedRenders.find(({ argued, inView }) => argued || inView);
    if (wrongRender)
      throw new InvalidSvelteSourceError(
        wrongRender.argued
          ? `{@render ${wrongRender.name}(…)} draws a value of ${wrongRender.name}, an operator, whose values are its applications: {@render ${wrongRender.name}()}, with nothing between the brackets, draws the one a step's own code makes; {@render ${wrongRender.name}(@inner)} the one made inside @inner; and in {#each applied(${wrongRender.name}) as a}, {@render ${wrongRender.name}(a)} each so far.`
          : `{@render ${wrongRender.name}()} draws the application of ${wrongRender.name} a step makes, which only the root knows: render it there, outside any view.`,
        { code: 'view_component', start: sourcePosition(source, wrongRender.start) }
      );
    // Each render of an applied operator by its key: the operator's name, and the label it is
    // narrowed to (see appliedKey); one in {#each applied(…)} draws a value, as a type is rendered.
    const appliedNames = [
      ...new Set(
        appliedRenders.flatMap(({ name, filter, fromHistory }) =>
          fromHistory ? [] : [filter ? `${name}_${filter}` : name]
        )
      )
    ];
    const undrawn = rendered.find(({ name }) => !views[name]?.length);
    if (undrawn)
      throw new InvalidSvelteSourceError(
        `${undrawn.name} is a type, and nothing draws it: add a view of it, as {#snippet ${undrawn.name}Cell(value: ${undrawn.name})}<Node {value} />{/snippet}.`,
        { code: 'view_component', start: sourcePosition(source, undrawn.start) }
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
    const optionsOf = (type: string) => {
      const drawable = views[type].filter((view) => !drawsItself(view, type));
      const plain = drawable.filter((view) => !found.pointers.has(view));
      return plain.length ? plain : drawable;
    };
    const chosen: Record<string, string[]> = Object.fromEntries(
      [...new Set(rendered.map(({ name }) => name))].map((name) => [name, optionsOf(name)])
    );
    const endless = rendered.find(({ name }) => !chosen[name].length);
    if (endless)
      throw new InvalidSvelteSourceError(
        `Every view of ${endless.name} draws ${endless.name} itself, without end: add a view that draws its value with nodes, as {#snippet ${endless.name}Cell(value: ${endless.name})}<Node {value} />{/snippet}.`,
        { code: 'view_component', start: sourcePosition(source, endless.start) }
      );
    const input = blocks.input
      ? interpretBlock(source, blocks.input, (body) => interpretInput(body, domain))
      : { state: {}, types: {} };
    const algorithm = blocks.algorithm;
    // The labels the markup reads, each resolved to one of the algorithm's; their problems wait for
    // the labels' own, which the first trace reports.
    const algorithmLabels = interpretBlock(source, algorithm, (body) =>
      stepLabels(parseBlock(body, 'algorithm', domain))
    );
    const filters = new Set(appliedRenders.flatMap(({ filter }) => (filter ? [filter] : [])));
    const snippets = snippetRangesOf(ast.html);
    const labelled: Record<string, { label: string; sample?: LabelRun }> = {};
    const histories: Record<string, { operator: string; start?: number; end?: number }> = {};
    const narrowed = new Map<string, { start: number; end: number }>();
    const labelProblems: InvalidSvelteSourceError[] = [];
    if (!algorithmLabels.problems.length)
      for (const reference of references) {
        const at = { code: 'view_label', start: sourcePosition(source, reference.start) };
        const problem = (message: string) =>
          labelProblems.push(new InvalidSvelteSourceError(message, at));
        if (snippets.some(({ start, end }) => start <= reference.start && reference.start < end)) {
          problem(
            `${asWritten(reference.key)} is read in a view, which sees only its value; labels are read in the root, which passes what a view draws, as {@render Int(@swap.a)}.`
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
          histories[reference.key] = { operator: (reference as { operator: string }).operator };
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
    if (labelProblems.length) throw InvalidSvelteSourceError.combine(labelProblems);
    const appliedIn: Record<string, { operator: string; start: number; end: number }> = {};
    for (const { name, filter } of appliedRenders) {
      const span = filter ? narrowed.get(filter) : undefined;
      if (span) appliedIn[`${name}_${filter}`] = { operator: name, ...span };
    }
    const runs = framings(source, algorithm, blocks, input, domain, {
      labels: new Set(Object.values(labelled).map(({ label }) => label)),
      history: new Set(Object.values(histories).map(({ operator }) => operator))
    });
    const primary = Object.keys(runs)[0];
    const traced = runs[primary];
    const master = traced.steps;
    const masters = Object.fromEntries(
      Object.entries(runs).map(([rule, run]) => [rule, run.steps])
    );
    // Every state a presentation shows: each step's before and after, by every label.
    const everyStep = Object.values(masters).flatMap(phasesOf);
    // An application of each operator the root renders, from any step, to stand in hidden; for one
    // no step applies, as a branch this input never takes, its widest value, drawn hidden throughout.
    const applied: Record<string, Application> = {};
    const widest = probeValues(viewing, everyStep);
    for (const name of appliedNames) {
      const operator = appliedIn[name]?.operator ?? name;
      const made = Object.values(masters)
        .flat()
        .flatMap((step) => step.applied?.[operator] ?? [])
        .find((application) => within(application, appliedIn[name]));
      const value = made ? undefined : (widest(name)?.widest[0] as TraceState | undefined);
      applied[name] = made ?? {
        state: value ?? {},
        types: typesOf(viewing, operator, value)
      };
    }
    // A value of each label the root reads, from any step, to stand in hidden where a step gave
    // none or several.
    for (const entry of Object.values(labelled))
      entry.sample = Object.values(masters)
        .flat()
        .flatMap((step) => [
          ...(step.labelled?.[entry.label] ?? []),
          ...(step.led?.labelled?.[entry.label] ?? [])
        ])[0];
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
          Object.entries(written.listings).map(([name, written]) => [
            name,
            {
              text: written.text,
              lit: Object.fromEntries(
                Object.entries(masters).map(([rule, steps]) => [rule, lightSteps(written, steps)])
              )
            }
          ])
        )
      : undefined;
    // Variables out of scope at some step, of any frame rule: what the view draws from one is
    // hidden there.
    const scoped = new Set([
      ...stateNames.filter((name) => everyStep.some(({ state }) => !(name in state))),
      ...Object.keys(labelled).filter(isLabelKey)
    ]);
    // What the root reads besides the state: labels' values, their values so far, and operators'
    // applications so far, each a prop of its key.
    const viewState = new Set([...stateNames, ...Object.keys(labelled), ...Object.keys(histories)]);
    if (viewProblems.length) throw InvalidSvelteSourceError.combine(viewProblems);
    const viewNames = new Set([...Object.keys(components), ...Object.keys(chosen)]);
    // A pointer is a view with a <Pointed>, or a type whose views are pointers.
    const pointerViews = new Set(found.pointers);
    for (const [name, options] of Object.entries(chosen))
      if (options.some((option) => found.pointers.has(option))) pointerViews.add(name);
    // A pointer's kind, for a position, as code: a link it points at takes its look.
    const paints = [...found.pointed].map(([name, { tag, parameter }]) => {
      const tags = (tag as { attributes?: Attribute[] }).attributes?.find(
        (attribute) => attribute.name === 'tags'
      );
      const [part] = Array.isArray(tags?.value) ? tags.value : [];
      const value =
        part?.type === 'Text'
          ? JSON.stringify((part as { data?: string }).data ?? '')
          : (part?.type === 'MustacheTag' || part?.type === 'ExpressionTag') &&
              part.expression?.start !== undefined
            ? svelteSource.slice(part.expression.start, part.expression.end)
            : 'undefined';
      return `const __paint_${name} = (${parameter}: any) => ({ __kind: __sverlinKind(${JSON.stringify(name)}, __sverlinTags(${value}, 'pointed')) });`;
    });
    // A pointer view's base kinds: those of the nodes around its <Pointed>, one of which a variant
    // leaving out would take the element drawn inside it along, so the pointer is then not drawn
    // at all; and its <Pointed>'s own, which says whether it is drawn past its collection's ends.
    const pointerKinds = (view: string) => {
      const pointed = found.pointed.get(view)?.tag as { attributes?: Attribute[] } | undefined;
      const root = found.components.find((component) => component.name === view)?.node;
      const base = (node: { attributes?: Attribute[] } | undefined, untagged: string[]) => {
        const read = tagSets(
          node?.attributes?.find((attribute) => attribute.name === 'tags'),
          svelteSource
        );
        return 'problem' in read
          ? undefined
          : kindKey(view, read.fixed.length ? read.fixed : untagged);
      };
      return {
        around: nodesAround(root, pointed).flatMap((node) => base(node, []) ?? []),
        pointed: base(pointed, ['pointed']) ?? kindKey(view, ['pointed'])
      };
    };
    const pointers = pointerCalls(
      ast.html,
      svelteSource,
      viewState,
      new Map(
        [...pointerViews].map((name) => {
          const type = components[name] ?? components[chosen[name]?.[0] ?? ''];
          const paint = found.pointers.has(name)
            ? `__paint_${name}`
            : `(position: number) => (({ ${chosen[name].map((option) => `${option}: __paint_${option}`).join(', ')} }) as Record<string, (position: number) => object>)[__choice_${name}]?.(position) ?? {}`;
          // The scoped variables its view reads, or any view its type chooses among reads.
          const reads = (found.pointers.has(name) ? [name] : chosen[name]).flatMap((option) =>
            [...readsOf(found.components.find((view) => view.name === option)!.node)].filter(
              (read) => scoped.has(read)
            )
          );
          return [
            name,
            {
              ...(domain.structures[type]?.kind === 'ref'
                ? {
                    into: (domain.structures[type] as { collection: string }).collection,
                    ref: true
                  }
                : { into: domain.atoms[type]?.index ?? '' }),
              paint,
              kinds: found.pointers.has(name)
                ? `() => (${JSON.stringify(pointerKinds(name))})`
                : `() => (${JSON.stringify(Object.fromEntries(chosen[name].map((option) => [option, pointerKinds(option)])))} as Record<string, { around: string[]; pointed: string }>)[__choice_${name}]`,
              ...(reads.length ? { reads: [...new Set(reads)] } : {})
            }
          ];
        })
      ),
      scoped
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
    const phased = Object.values(masters).map(phasesOf);
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
              `The view reads ${asWritten(name)} itself, but ${asWritten(name)} is out of scope at some steps, where there is no value to show. Draw it through a view or a pointer, as in {@render Int(${asWritten(name)})}, which draw nothing where it is out of scope.`,
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
        new Set([...viewNames].filter((name) => !pointerViews.has(name))),
        new Set(Object.keys(components)),
        scoped,
        operators,
        slotted
      )
    ]);
    const leftOut = leftOutModel(ast.html, source, nodeKinds, slotted, openingReads);
    const component = compile(
      withGeneratedScripts(
        `${tagged}${probeMarkup(components)}{#snippet __sverlinNone()}{/snippet}`,
        [
          ...stateNames,
          ...appliedNames.map(appliedKey),
          ...Object.keys(labelled),
          ...Object.keys(histories),
          ...Object.keys(chosen)
        ],
        chosen,
        pointerViews,
        pointers.calls,
        paints
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
    // By the page's states, each step's before and after (see phasesOf).
    const placements = Object.fromEntries(
      Object.entries(masters).map(([rule, steps]) => [
        rule,
        rootPlacements(rootMarkup, stateNames, viewNames, viewing, phasesOf(steps))
      ])
    );
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
    const rules = Object.keys(masters);
    return {
      source,
      component,
      master,
      masters,
      ownListings,
      // Steps line up by their moments, so the identity tells presentations aligned that way from
      // those that number steps by their place.
      signature: stepSignature([
        'moments',
        ...master.map(({ state, types, targets }) => JSON.stringify({ state, types, targets }))
      ]),
      atoms,
      components: probes,
      placements,
      design: {
        views: chosen,
        tags: tagKinds,
        space: designSpace(kinds, chosen, listing, rules, ownListings),
        starter: starterVariant(kinds, chosen, listing, rules, ownListings)
      },
      ...(listings ? { listings } : {}),
      ...(appliedNames.length ? { applied } : {}),
      ...(Object.keys(appliedIn).length ? { appliedIn } : {}),
      ...(Object.keys(labelled).length ? { labelled } : {}),
      ...(Object.keys(histories).length ? { histories } : {}),
      leftOut: { model: leftOut, components: Object.keys(components) }
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
    variant = buildVariant(design.space, design.starter, request, seed);
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
  const views = Object.fromEntries(
    Object.keys(design.views).map((type) => [type, values[`views.${type}`]])
  );
  // The steps of the label the variant chose, each placed by its moment.
  const rule = typeof values.frames === 'string' ? values.frames : Object.keys(prepared.masters)[0];
  const master = prepared.masters[rule] ?? prepared.master;
  const masterSteps = master.map((_, index) => index);
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
    }
    // Each label the root reads: the value its expression gave in the step's own code, at its
    // after, where it gave one; else one from another step stands in hidden. Each label's values
    // so far, and each operator's applications so far, are lists, there at every step.
    const ownTargets: Record<string, string> = {};
    const step = Math.floor(index / 2);
    const sofar = master.slice(0, step + 1);
    const at = (path: string, key: string) => key + path.slice('value'.length);
    for (const [key, { label, sample }] of Object.entries(prepared.labelled ?? {})) {
      if (isRunsKey(key)) {
        const list = sofar.flatMap((past, which) => [
          ...(past.led?.labelled?.[label] ?? []),
          ...(which < step || index % 2 === 1 || index === 0 ? (past.labelled?.[label] ?? []) : [])
        ]);
        ownApplied[key] = list.map((run) => run.state.value);
        list.forEach((run, k) => {
          for (const [path, type] of Object.entries(run.types))
            ownTypes[at(path, `${key}[${k}]`)] = type;
          for (const [path, target] of Object.entries(run.targets))
            ownTargets[at(path, `${key}[${k}]`)] = target;
        });
        continue;
      }
      const given = index % 2 === 1 ? phase.labelled?.[label] : undefined;
      const run = given?.length === 1 ? given[0] : sample;
      if (!run) continue;
      const own = given?.length === 1;
      (own ? ownApplied : standIn.state)[key] = run.state.value;
      for (const [path, type] of Object.entries(run.types))
        (own ? ownTypes : standIn.types)[at(path, key)] = type;
      for (const [path, target] of Object.entries(run.targets))
        (own ? ownTargets : standIn.targets)[at(path, key)] = target;
    }
    for (const [key, history] of Object.entries(prepared.histories ?? {})) {
      const span =
        history.start === undefined ? undefined : { start: history.start, end: history.end ?? 0 };
      const list = sofar.flatMap((past, which) =>
        [
          ...(past.led?.applied?.[history.operator] ?? []),
          ...(which < step || index % 2 === 1 || index === 0
            ? (past.applied?.[history.operator] ?? [])
            : [])
        ].filter((application) => within(application, span))
      );
      ownApplied[key] = list.map((application) => application.state);
      list.forEach((application, k) => {
        for (const [path, type] of Object.entries(application.types))
          ownTypes[`${key}[${k}].${path}`] = type;
      });
    }
    return {
      ...standIn.state,
      ...phase.state,
      ...ownApplied,
      ...views,
      __types: { ...standIn.types, ...phase.types, ...ownTypes },
      __targets: { ...standIn.targets, ...phase.targets, ...ownTargets },
      __absent: Object.keys(standIn.state),
      __identities: phase.identities?.ids ?? {},
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
  const listing = listed ? { text: listed.text, lit: listed.lit[rule] } : null;
  const result = await bundle(
    prepared.component,
    JSON.stringify(states),
    JSON.stringify(prepared.atoms),
    JSON.stringify({
      components: prepared.components,
      placements: prepared.placements[rule] ?? [],
      listing
    })
  );
  const output = result.outputFiles[0];
  if (output.contents.byteLength > maximumBundleBytes) {
    throw new InvalidSvelteSourceError('The compiled Svelte presentation is too large.');
  }
  return {
    javascript: output.text,
    labels: masterSteps.map((index) => `Step ${index + 1}`),
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
  pointerTypes: ReadonlySet<string>,
  pointers: readonly string[],
  paints: readonly string[]
): string {
  // A type rendered by name arrives as the name of the view the variant chose, and the view uses
  // that view under the type's name; none draws nothing, and a pointer drawn as none is no pointer.
  const names = [
    ...props.map((name) => (choices[name] ? `${name}: __choice_${name}` : name)),
    'step',
    'seed',
    '__probe'
  ].join(', ');
  const chosen = Object.entries(choices)
    .map(
      ([name, options]) =>
        `const ${name} = $derived(({ ${options.join(', ')} } as Record<string, any>)[__choice_${name}]${pointerTypes.has(name) ? '' : ' ?? __sverlinNone'});`
    )
    .join(' ');
  // The root's pointers are drawn around what they point at, from the start (see pointerCalls).
  const pointing = pointers.length
    ? `import { providePointers as __sverlinPointers, kindKey as __sverlinKind, activeTags as __sverlinTags } from 'sverlin'; ${paints.join(' ')} __sverlinPointers([${pointers.join(', ')}]);`
    : '';
  // TypeScript, so the types of components' parameters are read and removed.
  return `<script module>${prelude}</script><script lang="ts">let { ${names} }: Record<string, any> = $props(); ${chosen} ${pointing}</script>${source}`;
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
 * The props each library component takes in markup: what is drawn and how it is arranged, and the
 * tags that make its kind. How it looks is the design's (see design.server.ts), so none are props.
 */
export const libraryProps: Record<'Node' | 'Link' | 'Pointed', PropNames> = {
  Node: {
    value: null,
    layout: named(Object.fromEntries(layouts.map((name) => [name, name])), false),
    tags: null,
    children: null,
    key: null,
    constraints: null,
    flow: named({ x: 0, y: 0 }, false),
    form: named(Object.fromEntries(forms.map((name) => [name, name])), false),
    curve: named({ straight: 0, curved: 0 }, false),
    layoutSeed: null
  },
  Pointed: { tags: null },
  Link: {
    from: null,
    to: null,
    directed: null,
    label: null,
    tags: null,
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
      problems.push(
        new InvalidSvelteSourceError(
          designProps.has(attribute.name)
            ? `<${component}> ${attribute.name} is a look, which the design gives every kind of node, not the markup. Say what the node is with tags, as tags="current", and its look is a variable of that kind.`
            : `<${component}> has no prop ${attribute.name}. Its props are ${Object.keys(props)
                .filter((name) => name !== 'children')
                .join(', ')}.`,
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

/** The most kinds one tag may make, as each tag that depends on the state doubles them. */
const maximumKindsPerTag = 16;

/** The <Node> tags enclosing a tag in some markup, outermost first. */
function nodesAround(markup: unknown, target: unknown): { attributes?: Attribute[] }[] {
  const around: { attributes?: Attribute[] }[] = [];
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (node === target) return true;
    if (Array.isArray(node)) return node.some(walk);
    const part = node as { type?: string; name?: string; attributes?: Attribute[] };
    const isNode = part.type === 'InlineComponent' && part.name === 'Node';
    if (isNode) around.push(part);
    if (Object.values(part).some(walk)) return true;
    if (isNode) around.pop();
    return false;
  };
  walk(markup);
  return around;
}

/**
 * The sets of tags a tags prop can give, in order: a name, names separated by spaces, or a list
 * whose items are names, `condition && 'name'`, or `condition ? 'name' : 'other'` (either may be
 * null). Any other expression is a problem, as the design needs every kind before the view runs.
 */
function tagSets(
  attribute: Attribute | undefined,
  source: string
): { sets: string[][]; fixed: string[] } | { problem: string } {
  if (!attribute) return { sets: [[]], fixed: [] };
  const parts = Array.isArray(attribute.value) ? attribute.value : [];
  const [part] = parts;
  const literal = (expression: Expression | undefined): string | null | undefined =>
    expression?.type === 'Literal'
      ? typeof expression.value === 'string'
        ? expression.value
        : expression.value === null || expression.value === false
          ? null
          : undefined
      : expression?.type === 'Identifier' && expression.name === 'undefined'
        ? null
        : undefined;
  const words = (text: string) => text.split(/\s+/u).filter(Boolean);
  if (parts.length === 1 && part.type === 'Text') {
    const fixed = words(part.data ?? '');
    return { sets: [fixed], fixed };
  }
  const expression =
    parts.length === 1 && (part.type === 'MustacheTag' || part.type === 'ExpressionTag')
      ? part.expression
      : undefined;
  const items =
    expression?.type === 'ArrayExpression'
      ? ((expression as { elements?: Expression[] }).elements ?? [])
      : expression
        ? [expression]
        : [];
  // Each item's alternatives: one name, a name or none, or one of several.
  const alternatives: (string | null)[][] = [];
  // The names every set has, written as literals: with the view, the base kind.
  const fixed: string[] = [];
  for (const item of items) {
    const literalTag = literal(item);
    if (typeof literalTag === 'string') {
      fixed.push(...words(literalTag));
      alternatives.push(...words(literalTag).map((word) => [word]));
    } else if (item?.type === 'LogicalExpression' && typeof literal(item.right) === 'string')
      alternatives.push([null, literal(item.right) as string]);
    else if (
      item?.type === 'ConditionalExpression' &&
      literal(item.consequent) !== undefined &&
      literal(item.alternate) !== undefined
    )
      alternatives.push([literal(item.consequent) ?? null, literal(item.alternate) ?? null]);
    else
      return {
        problem: `tags={${source.slice(item?.start ?? 0, item?.end ?? 0)}} cannot be read before the view runs: write each tag as a name, as 'current', a name the state decides on, as found && 'found', or a choice, as found ? 'found' : 'searching'.`
      };
  }
  let sets: string[][] = [[]];
  for (const options of alternatives)
    sets = sets.flatMap((set) =>
      options.map((option) => (option === null ? set : [...set, option]))
    );
  if (sets.length > maximumKindsPerTag)
    return {
      problem: `These tags make ${sets.length} kinds of node, more than ${maximumKindsPerTag}: give fewer tags that depend on the state.`
    };
  return { sets, fixed };
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
 * Tag every <Node>, <Pointed>, and <Link> in the view with the view it is in (root outside one), as
 * the hidden prop __view, which with its tags gives its kind; and every <Node> and <Link> with the
 * line and column (both from 1) of its tag in the authored source, as __ref, so a rendered node or
 * link can be traced back to the markup that drew it when a participant selects it for feedback. A
 * <Node> with links among its children is also marked __links, so it lays them out. The props go
 * on the tag's own line, so line numbers are unchanged. Gives every kind of node the view has.
 */
function withNodeRefs(
  svelteSource: string,
  ast: { html?: unknown; css?: { start: number } | null },
  source: string,
  /** The root <Node> tags of components, by where they start, with the component each roots. */
  roots: ReadonlyMap<number, string>,
  /** The <Node> tags showing their component's own value, by where they start, with its type. */
  valueTypes: ReadonlyMap<number, string>
): {
  insertions: Insertion[];
  problems: InvalidSvelteSourceError[];
  kinds: DesignKind[];
  tagKinds: Record<string, string[]>;
  /** Each <Node> tag's base kind, by where it starts, for what a presentation leaves out. */
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
    expression?: { name?: string };
  };
  type Entry = { start: number; name: string; links: boolean; view: string; tag: Tag };
  const tags: Entry[] = [];
  const reject = (message: string, code: string, start: number | undefined) =>
    problems.push(
      new InvalidSvelteSourceError(message, { code, start: sourcePosition(source, start ?? 0) })
    );
  // Each <Link> belongs to the nearest <Node> around it, which then lays out with links. Text
  // belongs inside a node or a snippet, where a node draws it, so participants can select it.
  const walk = (
    value: unknown,
    around: { links: boolean } | undefined,
    inNode: boolean,
    view: string
  ): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const part of value) walk(part, around, inNode, view);
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
      else if (view !== 'root')
        reject(
          'A view draws only its value, so place <Listing /> outside views, in the markup at the top level or in a node there.',
          'view_markup',
          tag.start
        );
      else if (tag.start !== undefined) listings.push(tag.start);
      return;
    }
    const library =
      tag.type === 'InlineComponent' &&
      (tag.name === 'Node' || tag.name === 'Link' || tag.name === 'Pointed');
    const element = tag.type === 'Element' || (tag.type === 'InlineComponent' && !library);
    const special = typeof tag.type === 'string' && Object.hasOwn(unsupportedMarkup, tag.type);
    if (element || special) {
      reject(
        element
          ? `<${tag.name}> is not allowed: draw everything with <Node> and <Link>, giving a node tags to say what it is, such as <Node tags="caption">…</Node>, and the design gives each kind its look.`
          : `${unsupportedMarkup[tag.type as string]} is not allowed: draw everything with <Node> and <Link>.`,
        'view_markup',
        tag.start
      );
      return;
    }
    if (!inNode && ((tag.type === 'Text' && tag.data?.trim()) || tag.type === 'MustacheTag')) {
      reject(
        'Text outside a <Node> cannot be selected or given a look; put it in a node, such as <Node>Linear search</Node>.',
        'view_text',
        // Point at the text itself, not the whitespace before it.
        (tag.start ?? 0) + (tag.data ? tag.data.length - tag.data.trimStart().length : 0)
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
      if (tag.name === 'Link') {
        if (around) around.links = true;
        // In a view, as of an edge, it joins the children of the node the view is rendered in.
        else if (!inNode)
          reject(
            'A <Link> joins children of the node around it: put it, with the nodes it joins, in a <Node layout="free">.',
            'link_placement',
            tag.start
          );
      }
      walk(tag.children, tag.name === 'Node' ? entry : around, true, view);
      return;
    }
    const snippet = tag.type === 'SnippetBlock' ? tag.expression?.name : undefined;
    const nested = inNode || tag.type === 'SnippetBlock';
    for (const [key, child] of Object.entries(tag))
      if (key !== 'attributes' && key !== 'parent' && key !== 'metadata')
        walk(child, around, nested, snippet ?? view);
  };
  if (ast.css)
    reject(
      'Views cannot have a <style>: give nodes tags to say what they are, and the design gives each kind of node its look.',
      'view_style',
      ast.css.start
    );
  walk(ast.html, undefined, false, 'root');
  // What a node is says which props its kind has: one that arranges its children has a layout's.
  const roleOf = ({ name, links, tag }: Entry): KindRole => {
    if (name === 'Pointed') return 'pointed';
    if (name === 'Link') return 'link';
    const attributes = tag.attributes ?? [];
    const has = (prop: string) => attributes.some((attribute) => attribute.name === prop);
    const children = (tag.children ?? []).filter(
      (child) => !(child.type === 'Text' && !child.data?.trim())
    );
    if (has('layout') || links || (children.length === 1 && children[0].type === 'EachBlock'))
      return 'container';
    if (has('value') || !children.length) return 'value';
    return 'text';
  };
  // An untagged <Pointed> or <Link> is of its own kind, apart from the untagged nodes around it.
  const untagged = (role: KindRole): string[] =>
    role === 'pointed' ? ['pointed'] : role === 'link' ? ['link'] : [];
  // A kind several roles share takes the plainest look, and every prop any of them has.
  const plainest: KindRole[] = ['container', 'text', 'value', 'pointed', 'link'];
  const kinds = new Map<string, KindRole>();
  // Kinds some tag draws a node as at every step; the rest only some steps, by a conditional tag.
  const based = new Set<string>();
  // The kinds each tag can be, by its line and column (both from 1), for the editor to show.
  const tagKinds: Record<string, string[]> = {};
  // A tag with conditional tags: its base tags, and every kind it can be, by where it starts.
  const sites = new Map<number, { base: string[]; keys: string[] }>();
  const nodeKinds = new Map<number, string>();
  const apart = (of: KindRole) => (of === 'pointed' || of === 'link' ? of : 'node');
  const add = (key: string, role: KindRole, start: number) => {
    const known = kinds.get(key);
    if (known && apart(known) !== apart(role))
      reject(
        `${key} is drawn by a <${role === 'pointed' ? 'Pointed' : role === 'link' ? 'Link' : 'Node'}> and by another kind of tag; give one of them a tag of its own.`,
        'view_tags',
        start
      );
    kinds.set(key, known && plainest.indexOf(known) < plainest.indexOf(role) ? known : role);
  };
  for (const entry of tags) {
    const read = tagSets(
      entry.tag.attributes?.find((attribute) => attribute.name === 'tags'),
      source
    );
    if ('problem' in read) {
      reject(read.problem, 'view_tags', entry.start);
      continue;
    }
    const role = roleOf(entry);
    const keyOf = (set: string[]) => kindKey(entry.view, set.length ? set : untagged(role));
    const base = keyOf(read.fixed);
    const keys = read.sets.map(keyOf);
    // The base kind holds the layout of every kind the tag can be, so it is a kind even where no
    // step draws it alone, as with cond ? 'a' : 'b'.
    add(base, role, entry.start);
    based.add(base);
    if (entry.name === 'Node') nodeKinds.set(entry.start, base);
    for (const key of keys) add(key, role, entry.start);
    if (keys.some((key) => key !== base)) sites.set(entry.start, { base: read.fixed, keys });
    const { line, column } = sourcePosition(source, entry.start);
    tagKinds[`${line}:${column + 1}`] = keys;
  }
  const insertions = tags.map(({ start, name, links, view }): Insertion => {
    const { line, column } = sourcePosition(source, start);
    const root = roots.get(start);
    const type = valueTypes.get(start);
    const ref = name === 'Pointed' ? '' : ` __ref="${line}:${column + 1}"`;
    const site = sites.get(start);
    // A tag that can be several kinds lays out as its base kind, with the largest inset of them all.
    const conditional = site
      ? ` __base="${site.base.join(' ')}" __site={${JSON.stringify(site.keys)}}`
      : '';
    return {
      at: start + name.length + 1,
      text: ` __view="${view}"${ref}${links ? ' __links' : ''}${root ? ` __component="${root}"` : ''}${type ? ` __type="${type}"` : ''}${conditional}`
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
    kinds: [...kinds].map(([key, role]) => ({
      key,
      role,
      ...(based.has(key) ? {} : { conditional: true })
    })),
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

/** The names {@render} tags call, as in {@render Int(value)}, and where each tag starts. */
function renderedNames(markup: unknown): { name: string; start: number }[] {
  const names: { name: string; start: number }[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const part = node as {
      type?: string;
      start?: number;
      expression?: { callee?: { name?: string } };
    };
    const name = part.type === 'RenderTag' ? part.expression?.callee?.name : undefined;
    if (name) names.push({ name, start: part.start ?? 0 });
    for (const [key, child] of Object.entries(part)) if (key !== 'parent') walk(child);
  };
  walk(markup);
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

/** Where each snippet is in the markup, where labels are not read. */
function snippetRangesOf(markup: unknown): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const part = node as { type?: string; start?: number; end?: number };
    if (part.type === 'SnippetBlock') ranges.push({ start: part.start ?? 0, end: part.end ?? 0 });
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

/**
 * Each render of an operator by name: the label it is narrowed to (as {@render Greater(@inner)}),
 * whether it draws an item of {#each applied(…)}, whether it is otherwise given a value, and
 * whether it is in a view.
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
    const within = inView || part.type === 'SnippetBlock';
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
