/** Compile one untrusted Svelte component without executing its code on the server. */

import { posix } from 'node:path';
import { createRequire } from 'node:module';

import type { AnyNode } from 'acorn';
import { build, type BuildFailure, type OutputFile, type Plugin } from 'esbuild';
import { compile, parse } from 'svelte/compiler';

import entrySource from './assembly/entry.ts?raw';
import layoutSource from './assembly/layout.ts?raw';
import preludeSource from './assembly/prelude.ts?raw';
import {
  AlgorithmError,
  declaredNames,
  referencedNames,
  interpretDomain,
  interpretInput,
  algorithmLimits,
  stepLabels,
  traceAlgorithm,
  type Application,
  type BlockKind,
  type Edges,
  type LabelRun,
  type MasterStep,
  type Pacing,
  type Pauses,
  type TraceState,
  type TypedState
} from './algorithm/interpret.server';
import type { Label } from './algorithm/labels.server';
import { parseBlock, spanOf } from './algorithm/parse.server';
import { lightSteps, type Lit } from './listing/light.server';
import {
  isDuringKey,
  isHistoryKey,
  isLabelKey,
  isRunsKey,
  labelSpan,
  markLabels,
  momentTarget,
  resolveLabel,
  untypedBoolean,
  viewThis,
  viewTags,
  viewThisValues,
  whenTags,
  written as asWritten
} from './label-values';
import type { Listing, PlaceToken } from './listing/listing';
import { mappedListing, type RegionMap } from './listing/mapped.server';
import { syntaxSpans } from './listing/syntax';
import {
  placePaint,
  tokenProblems,
  touchedPlaces,
  type RenderedPlace
} from './listing/places.server';
import type { AtomRegistry } from './algorithm/atoms.server';
import {
  definesType,
  isPool,
  noDomain,
  operatorNames,
  typeNames,
  type DomainRegistry,
  type OperatorType,
  type RecordType,
  type RefType
} from './algorithm/structures.server';
import {
  componentProbes,
  findComponents,
  isPart,
  eachScope,
  probeMarkup,
  branchInsertions,
  pointerCalls,
  probeValues,
  positionReads,
  readsOf,
  unknownReadOf,
  rootPlacements,
  scopedReadsOf,
  guardInsertions,
  snippetPaths,
  steadyLengths,
  viewCallsOf,
  slotInsertions,
  viewsOf,
  withInsertions,
  type ComponentProbe,
  type Insertion,
  type Placement,
  type ComponentSignatures
} from './components.server';
import { callTypes } from './calls.server';
import {
  overSteps,
  selectsOf,
  withOverItems,
  withSelectRows,
  withSelectTypes
} from './selects.server';
import {
  buildVariant,
  DesignValueError,
  designSpace,
  listingRegionFallbacks,
  listingRegionSpace,
  starterVariant,
  viewKey,
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
  freeLayoutProps,
  kindKey,
  placeProps,
  listingPlacesOptions,
  roleProps,
  starterListing,
  starterListingPlaces,
  type DesignProp,
  type ListingPlacesLook,
  type KindRole
} from './library/node/design';
import type { StepListing } from './library/steps';
import { packStates } from './library/trace-pack';
import { linkFacts, type LayoutStructure } from './structure.server';
import type { FrameSettings } from './library/node/props';
import { stepSignature } from '../signature.server';
import { drawFailureMessage, layOutOnServer, layoutFailureMessage } from './layout.server';
import {
  boundDesign,
  boundDomain,
  boundLengthDomain,
  countCalls,
  gridExtents,
  memberTestRead,
  typeOfPath,
  type Binding,
  type Scope
} from './bound-props.server';
import { bindableProps, lengthProps, valueOnlyProps } from './library/node/bound';
import { iconNames } from './library/fonts';
import { readabilityOf } from './readability.server';
import { drawingText } from './library/drawing';
import type { Readability } from '$lib/shared/readability';
import { layoutNameOf, layoutProp, noLayoutMessage, pageLayouts } from './layouts.server';
import { drawingMarker, drawingProblems } from './drawings.server';
import { layoutReadProblems, layoutTags, type DeclaredLayout } from './layout-tags.server';
import {
  inputDeclarations,
  caseAdvice,
  caseInputBody,
  casesOf,
  type writtenCases
} from './cases.server';
import {
  sceneEdges,
  sceneLabel,
  scenePauses,
  sceneSteps,
  storyboardOf,
  atWhen,
  leftOutWarning,
  type LeftOutStep,
  type Scene,
  type Storyboard
} from './storyboard.server';
import { withColumnShifts, writtenColumn } from './written-columns';
import {
  implicitInsertions,
  implicitRenders,
  markImplicit,
  unionViews,
  type ViewTyping
} from './implicit-renders.server';

// One component should be much smaller; these ceilings bound compilation and inline Timeline storage.
const maximumSourceBytes = 256 * 1024;
const maximumBundleBytes = 2 * 1024 * 1024;

// Library sources are embedded at build time so production needs no source tree, with the embedded
// fonts' manifest, which lists the design's fonts (see library/fonts.ts), by its path from there.
const librarySources = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(
      ['./library/**/*.{svelte,ts}', '!./library/**/*.test.ts', './fonts/faces.json'],
      { query: '?raw', import: 'default', eager: true }
    )
  ).map(([path, text]) => [posix.relative('./library', path), text])
);
const compiledLibrary = new Map<string, string>();

/** How a module is compiled: for the page's DOM, or as strings, to lay out steps without mounting. */
type Generate = 'client' | 'server';

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

function loadLibraryModule(
  path: string,
  generate: Generate
): { contents: string; loader: 'js' | 'ts' | 'json' } {
  const source = librarySources[path];
  if (path.endsWith('.json')) return { contents: source, loader: 'json' };
  if (!path.endsWith('.svelte')) return { contents: source, loader: 'ts' };
  let contents = compiledLibrary.get(`${generate}:${path}`);
  if (contents === undefined) {
    contents = compile(source, { filename: path, generate, css: 'injected', dev: false }).js.code;
    compiledLibrary.set(`${generate}:${path}`, contents);
  }
  return { contents, loader: 'js' };
}

/** One seeded presentation of a prepared component. */
export type SvelteBundle = {
  javascript: string;
  /** The name of each step this presentation keeps (see MasterStep), the same in every pacing. */
  labels: string[];
  /** Every step the source can show, by name, and its identity (see PreparedComponent.steps). */
  steps: string[];
  stepSignature: string;
  /** The presentation's variant: every variable's value, by key. */
  variant: Record<string, DesignValue>;
  /** Where each value came from. */
  origins: Record<string, DesignOrigin>;
  /** The <Node> tags it leaves out, by their line:column. */
  leftOut: string[];
  /** Each step a scene leaves out, drawing what the step before it drew (see sceneSteps). */
  warnings?: string[];
  /**
   * Every step laid out on the server, which the page is given: how long working it out took, the
   * steps the view failed to draw, and what each step draws (see layout.server.ts).
   */
  layout: {
    ms: number;
    cached: boolean;
    errors: string[];
    drawn?: string[];
    /** How large it draws on a typical stage (see readability.server.ts). */
    readability?: Readability;
    /** What it draws, in kinds and links, for the assistant (see library/drawing.ts). */
    drawing?: string;
  };
};

type Block = { body: string; offset: number };

/** Seed-independent result of checking, interpreting, and compiling one component. */
export type PreparedComponent = {
  source: string;
  component: string;
  /** The component compiled to render strings, so steps are laid out without mounting them. */
  serverComponent: string;
  /** The steps pausing at every label (see Pacing). */
  master: MasterStep[];
  /** The names of the source's own listings (see listing/mapped.server.ts). */
  ownListings: string[];
  /** Each label a scene pauses at that a listing marks no region for, told to the assistant. */
  listingWarnings?: string[];
  /** Each input the view draws but neither the algorithm nor another input reads, told to the assistant. */
  inputWarnings?: string[];
  /**
   * Every label of the algorithm, by full name; and for each label, how many runs it has and how
   * many of them change what the view draws, for the assistant to choose scenes' pauses by (see
   * assistant.md).
   */
  pauses: { labels: string[]; runs: Record<string, LabelRuns> };
  /**
   * The steps pausing at the labels given, opening and closing each run of `edges` on a step, and
   * what follows from them: the values the root reads for placement, measured with every value of
   * their types, as each names a step of its own, and what each step lights in each listing. Made
   * once per way of pausing and case shown, `shown` by name.
   */
  paced: (
    pauses: Pauses,
    edges?: Edges,
    shown?: string,
    over?: { list: string; item: string }
  ) => PacedSteps;
  /** The scenes the presentation plays, in order (see storyboard.server.ts). */
  storyboard: Storyboard;
  /**
   * Every step the source shows, in the order its storyboard plays them, by label (see
   * storyboardOf), the same in every variant.
   */
  steps: string[];
  /** The source's identity, from its steps, shared by its presentations however they are paced. */
  signature: string;
  atoms: AtomRegistry;
  /** The most elements each collection type holds, by name, the room its collections keep. */
  lengths: Record<string, number>;
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
    /** Each free layout kind's structure, as its data makes it, for the assistant. */
    structures: Record<string, LayoutStructure>;
    /**
     * The page's layouts, the first shown where a variant names none: each its root's row or column
     * and tag's line:column (see layouts.server.ts).
     */
    layouts: { name: string; direction: FrameSettings['layout']; ref: string }[];
  };
  /** Where the view places a <Listing />, the algorithm's text in each language. */
  listings?: Record<
    string,
    {
      text: string;
      regions: { label: string; start: number; end: number }[];
      tokens?: readonly PlaceToken[];
    }
  >;
  /** What the root renders at each place a listing's token names (see listing/places.server.ts). */
  tokenPlaces?: Record<string, RenderedPlace>;
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
  /** The labels <When>s draw their contents in the runs of, by full name, by key. */
  during?: Record<string, string>;
  /** The variables the view reads, which a step draws from (see sceneSteps). */
  viewReads: string[];
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
 * The steps a component's algorithm records, pausing at every label, as the
 * page steps where its view builds, and else run without its view, so they can be read whether or
 * not it builds, as by the assistant checking what its algorithm does.
 * Throws the domain, input, or algorithm's problem.
 */
export function recordedTrace(written: string): MasterStep[] {
  const source = callTypes(written).source;
  const shown = viewSteps(source);
  if (shown) return shown;
  const { blocks, cases } = extractBlocks(source);
  const algorithm = blocks.algorithm;
  if (!algorithm)
    throw new InvalidSvelteSourceError('There is no algorithm block, so there are no steps.', {
      code: 'missing_algorithm'
    });
  const domain = blocks.domain
    ? interpretBlock(source, blocks.domain, (body) =>
        withSelectTypes(interpretDomain(body), selectsOf(source).selects)
      )
    : noDomain;
  // Each case's steps in turn; with no case yet, the algorithm's from no input.
  const inputs = caseInputs(source, blocks, cases, domain);
  return (inputs.length ? inputs : [{ input: { state: {}, types: {} } }]).flatMap(
    ({ input }) => paced(source, algorithm, input, domain).steps
  );
}

/**
 * The source's listings (see listing/mapped.server.ts), by name; with the problems with them, and
 * what each of their regions is mapped to.
 */
function listingsFrom(
  source: string,
  traced: Pick<ReturnType<typeof traceAlgorithm>, 'root' | 'labels' | 'code'>,
  algorithm: Block,
  own: readonly ListingBlock[],
  places?: readonly string[]
): {
  listings: Record<string, Listing>;
  maps: Record<string, RegionMap[]>;
  problems: InvalidSvelteSourceError[];
  /** The labels a listing marks no region for. */
  unmarked: { full: string; name: string }[];
} {
  const listings: Record<string, Listing> = {};
  const unmarked = new Map<string, { full: string; name: string }>();
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
    for (const label of mapped.unmarked) unmarked.set(label.full, label);
    const tokens = places ? tokenProblems(mapped.tokens, places) : [];
    for (const { message, block: where, at: offset } of [...mapped.problems, ...tokens])
      problems.push(
        new InvalidSvelteSourceError(message, {
          code: 'listing_label',
          start: at((where === 'listing' ? block.offset : algorithm.offset) + offset)
        })
      );
  }
  return { listings, maps, problems, unmarked: [...unmarked.values()] };
}

/**
 * The listings' problems from the algorithm's labels alone, without running it, for a build that
 * fails before it checks them, so they are told together; none where the domain or the algorithm
 * does not parse, as its labels are then unknown.
 */
function listingProblemsAlone(
  source: string,
  blocks: Partial<Record<BlockKind | 'design', Block>>,
  own: readonly ListingBlock[]
): InvalidSvelteSourceError[] {
  const algorithm = blocks.algorithm;
  if (!own.length || !algorithm) return [];
  try {
    const domain = blocks.domain
      ? interpretBlock(source, blocks.domain, (body) =>
          withSelectTypes(interpretDomain(body), selectsOf(source).selects)
        )
      : noDomain;
    const parsed = interpretBlock(source, algorithm, (body) =>
      parseBlock(body, 'algorithm', domain)
    );
    const { labels } = stepLabels(parsed);
    return listingsFrom(source, { ...parsed, labels }, algorithm, own).problems;
  } catch {
    return [];
  }
}

/** What a step paused at a label with no region in the listing lights: nothing. */
const unlitWarning = (full: string, name: string): string =>
  `The step @${full} lights nothing in the listing: mark the text its code shows as @${name}[…]${full.includes('.') ? ` inside @${full.split('.').slice(0, -1).join('.')}` : ''}, as A[@left[j - 1]] marks the j - 1 of A[j - 1].`;

/** What an input the view draws but nothing reads shows: what was typed into the case, not the run. */
const unreadInputWarning = (name: string): string =>
  `The view draws the input ${name}, but the algorithm never reads it, so what it shows was typed into the case and does not come from the run: draw what the algorithm computes instead, its variables or a query of a label or a call type (as a tree of calls), and remove ${name}.`;

/** The algorithm's steps paced as given (see Pacing), opening on step 0, the input as given. */

/**
 * The domain and a first trace, which give the types of the values the markup draws (see
 * implicit-renders.server.ts); where a block fails, why, which the build reports in turn, or at once
 * where a view typed by a label needs the trace.
 */
function earlyTyping(
  source: string,
  blocks: Partial<Record<BlockKind | 'design', Block>>,
  cases: ReturnType<typeof writtenCases>,
  overs: readonly { list: string; item: string }[] = []
):
  | (ViewTyping & { labelOperators: Record<string, OperatorType> })
  | { failure: unknown }
  | undefined {
  if (!blocks.algorithm) return undefined;
  try {
    const domain = blocks.domain
      ? interpretBlock(source, blocks.domain, (body) =>
          withSelectTypes(interpretDomain(body), selectsOf(source).selects)
        )
      : noDomain;
    const input = firstInput(source, blocks, cases, domain);
    // Every label's values are kept, so a label read in the markup has its type.
    const algorithm = blocks.algorithm;
    const labels = interpretBlock(
      source,
      algorithm,
      (body) => stepLabels(parseBlock(body, 'algorithm', domain)).labels
    );
    const kept = new Set(labels.map(({ full }) => full));
    // Every labelled expression's operands and result too, so a view typed by a label has its fields.
    const steps = paced(
      source,
      algorithm,
      input,
      domain,
      {},
      { labels: kept, applications: kept },
      overs
    ).steps;
    return {
      domain,
      labelOperators: withLabelOperators(noDomain, steps).operators ?? {},
      labels,
      steps
    };
  } catch (failure) {
    return { failure };
  }
}

/**
 * The domain with each labelled expression a step recorded as an operator named by its label, as
 * `ℓinsertˑcompare` for @insert.compare: its operands (left and right, argument, a function's
 * parameters) and its result as value, typed as the trace recorded them, so a view typed by the
 * label sees them as a record's fields (see viewDomainOf).
 */
function withLabelOperators(domain: DomainRegistry, steps: readonly MasterStep[]): DomainRegistry {
  const operators: Record<string, OperatorType> = { ...(domain.operators ?? {}) };
  for (const step of steps)
    for (const [name, applications] of Object.entries(step.applied ?? {})) {
      if (!isLabelKey(name)) continue;
      for (const { state, types } of applications) {
        const parameters = Object.keys(state).filter((key) => key !== 'value');
        const known = operators[name];
        if (known && known.parameters.length >= parameters.length && known.result) continue;
        operators[name] = {
          name,
          parameters,
          operands: parameters.map(
            (parameter) =>
              types[parameter] ??
              (typeof state[parameter] === 'boolean' ? untypedBoolean : undefined) ??
              known?.operands[known.parameters.indexOf(parameter)] ??
              ''
          ),
          result:
            types.value ??
            (typeof state.value === 'boolean' ? untypedBoolean : undefined) ??
            known?.result ??
            '',
          body: {
            type: 'Literal',
            value: null,
            raw: 'null',
            start: 0,
            end: 0
          } as unknown as OperatorType['body']
        };
      }
    }
  return { ...domain, operators };
}

/** The full name of the label an operator's name is, as insert.compare for ℓinsertˑcompare. */
const labelOfOperator = (name: string): string => name.slice(1).replaceAll('ˑ', '.');

/** A value's view written as a render of its type, as {@render Int(key)}: a value is written {key}. */
function writtenRenders(
  html: unknown,
  domain: DomainRegistry,
  source: string,
  authored: number
): InvalidSvelteSourceError[] {
  const types = new Set([...Object.keys(domain.atoms), ...Object.keys(domain.structures)]);
  const problems: InvalidSvelteSourceError[] = [];
  visit(html as never, (node) => {
    const part = node as {
      type?: string;
      implicit?: boolean;
      start?: number;
      expression?: {
        callee?: { type?: string; name?: string };
        arguments?: { start?: number; end?: number }[];
      };
    };
    if (part.type !== 'RenderTag' || part.implicit || (part.start ?? 0) >= authored) return;
    const name =
      part.expression?.callee?.type === 'Identifier' ? part.expression.callee.name : undefined;
    const [argument] = part.expression?.arguments ?? [];
    if (!name || !types.has(name) || !argument) return;
    const written = source.slice(argument.start ?? 0, argument.end ?? 0);
    problems.push(
      new InvalidSvelteSourceError(
        `{@render ${name}(${written})} is written {${written}}: a value in braces draws its type's view, the one views.${name} chooses, at its place.`,
        { code: 'view_component', start: sourcePosition(source, part.start ?? 0) }
      )
    );
  });
  return problems;
}

function paced(
  source: string,
  algorithm: Block,
  input: TypedState,
  domain: DomainRegistry,
  pacing: Pacing = {},
  keep: Parameters<typeof traceAlgorithm>[4] = {},
  /** The lists scenes step over, each row typed through its name at the last step. */
  overs: readonly { list: string; item: string }[] = []
): ReturnType<typeof traceAlgorithm> {
  // Each query's rows are a variable at every step, from the records of its label's spans.
  const { selects } = selectsOf(source);
  const records = new Set([...(keep.records ?? []), ...selects.map(({ from }) => from)]);
  const run = interpretBlock(source, algorithm, (body) =>
    traceAlgorithm(body, input, domain, pacing, { ...keep, records }, true)
  );
  const steps = withSelectRows([run.opening, ...run.steps], run.records, selects);
  return { ...run, steps: withOverItems(steps, overs) };
}

/** How a source pauses, as a key, for the steps paced so (see PreparedComponent.paced). */
const pausesKey = (pauses: Pauses, edges?: Edges) =>
  `${[...pauses].sort().join(',')}|${edges ? `${edges.label}#${edges.run ?? ''}` : ''}`;

/**
 * Each step as two, the state just before its code and just after it: the events up to the code,
 * then the code itself. The page shows a step's after, moving there from the step on screen in one
 * motion; the before keeps values matched across the code run between two steps (see Identities).
 * The first, step 0, the input as given, has no code, so its before is its after.
 */
export function phasesOf(steps: readonly MasterStep[]): MasterStep[] {
  return steps.flatMap((step, index) => [
    index === 0 ? step : { ...step, ...(step.before ?? {}) },
    step
  ]);
}

/**
 * The values a step's after copies from the step before's after: those copied in the code run
 * between them, at its before, and those its own code copied, each traced back to a value the step
 * before shows, as key copied at the before and copied again into a place by the step's code.
 */
function copiesSincePrevious(
  gap: Readonly<Record<number, number>> = {},
  own: Readonly<Record<number, number>> = {}
): Record<number, number> {
  const copies: Record<number, number> = { ...gap };
  for (const [copy, source] of Object.entries(own)) copies[Number(copy)] = gap[source] ?? source;
  return copies;
}

/**
 * What each region of the source's own listings is mapped to, and whether the algorithm runs its
 * code, its steps paced as recordedTrace paces them, for the assistant to check its labels against;
 * none without such a listing.
 */
export function listingMapsOf(
  written: string
): Record<string, (RegionMap & { lit: boolean })[]> | undefined {
  const source = callTypes(written).source;
  const { blocks, listings: listingBlocks, cases } = extractBlocks(source);
  if (!listingBlocks.length || !blocks.algorithm) return undefined;
  const domain = blocks.domain
    ? interpretBlock(source, blocks.domain, (body) =>
        withSelectTypes(interpretDomain(body), selectsOf(source).selects)
      )
    : noDomain;
  const input = firstInput(source, blocks, cases, domain);
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
export function prepareSvelteComponent(authored: string): PreparedComponent {
  if (Buffer.byteLength(authored, 'utf8') > maximumSourceBytes) {
    throw new InvalidSvelteSourceError('The Svelte component is too large.', { code: 'too_large' });
  }
  // A call type declared in the domain names its function's body label (see calls.server.ts).
  const called = callTypes(authored);
  if (called.problems.length)
    throw InvalidSvelteSourceError.combine(
      called.problems.map(
        ({ message, start }) =>
          new InvalidSvelteSourceError(message, {
            code: 'view_component',
            start: sourcePosition(authored, start)
          })
      )
    );
  const written = called.source;
  // Layouts rendered by tags become the snippets they stand for, their tags renders, and snippets
  // written by the author are refused (see layout-tags.server.ts).
  const laid = layoutTags(written);
  if (laid.problems.length)
    throw InvalidSvelteSourceError.combine(
      laid.problems.map(
        ({ message, start }) =>
          new InvalidSvelteSourceError(message, {
            code: 'view_layout',
            start: sourcePosition(written, start)
          })
      )
    );
  // Views become the snippets they stand for (see viewTags), every line kept, and every line and
  // column but a closing's own, so positions and sites name the source as written.
  const tags = viewTags(laid.source);
  if (tags.problems.length)
    throw InvalidSvelteSourceError.combine(
      tags.problems.map(
        ({ message, start }) =>
          new InvalidSvelteSourceError(message, {
            code: 'view_component',
            start: sourcePosition(written, start)
          })
      )
    );
  // What no scene shows, and each scene's place, as written, for problems found once it runs.
  const unshown = laid.unshown.map(
    ({ message, start }) =>
      new InvalidSvelteSourceError(message, {
        code: 'view_storyboard',
        start: sourcePosition(written, start)
      })
  );
  const scenes = laid.scenes.map((scene) => ({
    ...scene,
    position: sourcePosition(written, scene.start)
  }));
  return {
    ...withColumnShifts(laid.shifts, () =>
      prepareViews(tags.source, tags.views, laid.layouts, scenes, unshown, {
        places: laid.captions.map(({ place }) => place),
        unrendered: (place, rendered) =>
          new InvalidSvelteSourceError(
            `The token $${place.slice(1)}[…] names ${place}, which the view renders nowhere at its root or in a part: a token names a place a render is written with, as $mid[…] for {mid}${rendered.length ? `, and the places it renders are ${rendered.join(', ')}` : ''}.`,
            {
              code: 'view_markup',
              start: sourcePosition(
                written,
                laid.captions.find((caption) => caption.place === place)?.start ?? 0
              )
            }
          )
      })
    ),
    source: written
  };
}

/** prepareSvelteComponent for a source whose views are snippets, each starting at an offset of `viewStarts`. */
function prepareViews(
  source: string,
  viewStarts: readonly number[],
  declaredLayouts: readonly DeclaredLayout[] = [],
  scenes: readonly Scene[] = [],
  unshown: readonly InvalidSvelteSourceError[] = [],
  captions: {
    places: readonly string[];
    unrendered: (place: string, rendered: readonly string[]) => InvalidSvelteSourceError;
  } = { places: [], unrendered: (place) => new InvalidSvelteSourceError(place) }
): PreparedComponent {
  let viewProblems: InvalidSvelteSourceError[] = [];
  let listingAlone = (): InvalidSvelteSourceError[] => [];
  try {
    const extracted = extractBlocks(source);
    const { blocks, listings: listingBlocks } = extracted;
    listingAlone = () => listingProblemsAlone(source, blocks, listingBlocks);
    // <When> and <OneOf> become {#if when(…)} chains no longer than written, and the labels the
    // markup reads identifiers of the same length (see label-values.ts).
    const asIfs = whenTags(extracted.svelteSource);
    if (asIfs.problems.length)
      throw InvalidSvelteSourceError.combine(
        asIfs.problems.map(
          ({ message, start }) =>
            new InvalidSvelteSourceError(message, {
              code: 'view_label',
              start: sourcePosition(source, start)
            })
        )
      );
    // A view's this becomes a parameter name of the same length (see label-values.ts).
    const viewed = viewThisValues(asIfs.source);
    if (viewed.problems.length)
      throw InvalidSvelteSourceError.combine(
        viewed.problems.map(
          ({ message, start }) =>
            new InvalidSvelteSourceError(message, {
              code: 'view_name',
              start: sourcePosition(source, start)
            })
        )
      );
    const { source: marked, references, allReads, runsReads } = markLabels(viewed.source);
    if (runsReads.length)
      throw InvalidSvelteSourceError.combine(
        runsReads.map(
          ({ label, start }) =>
            new InvalidSvelteSourceError(
              `runs(@${label}) is written spans(@${label}): every value the label has given so far, one for each span of its code.`,
              { code: 'view_component', start: sourcePosition(source, start) }
            )
        )
      );
    if (allReads.length)
      throw InvalidSvelteSourceError.combine(
        allReads.map(
          ({ record, start }) =>
            new InvalidSvelteSourceError(
              `all(${record}) is no more: keep the ${record}s in a pool, as const ${record}s = pool(${record}, { max: 8 }); in the domain and const nodes = ${record}s; in the input, add each with nodes.add(${record}({ … })), and give the pool to a layout as any input, as <Layout name="Nodes" of="nodes">{#each nodes as n}{n}{/each}</Layout>.`,
              { code: 'view_component', start: sourcePosition(source, start) }
            )
        )
      );
    // Svelte reads typed snippet parameters only in TypeScript; an empty script after the view says
    // so without moving anything the view's positions name. A view with a script of its own is
    // parsed as written, so the script is reported below.
    const scripted = /<script\b/iu.test(marked);
    const parseView = (text: string) =>
      parse(scripted ? text : `${text}<script lang="ts"></script>`, { filename: 'Main.svelte' });
    // Layout blocks become {#if} blocks of the same length, their roots the frame (see layouts.server.ts).
    const page = pageLayouts(
      marked,
      (text) => (parseView(text).html as { children?: [] } | undefined)?.children ?? []
    );
    if (page.problems.length)
      throw InvalidSvelteSourceError.combine(
        page.problems.map(
          ({ message, start }) =>
            new InvalidSvelteSourceError(message, {
              code: 'view_layout',
              start: sourcePosition(source, start)
            })
        )
      );
    // Every source declares its layouts; one that does not is refused with the view's other problems.
    if (!page.layouts.length)
      viewProblems = [new InvalidSvelteSourceError(noLayoutMessage, { code: 'view_layout' })];
    let svelteSource = page.text;
    let ast = parseView(svelteSource);
    const topLevel = new Set(
      ((ast.html as { children?: { start?: number }[] }).children ?? []).map(({ start }) => start)
    );
    const nested = viewStarts.filter((start) => !topLevel.has(start));
    if (nested.length)
      throw InvalidSvelteSourceError.combine(
        nested.map(
          (start) =>
            new InvalidSvelteSourceError(
              'A <View> is written at the top level, beside the layouts, never inside a layout or a node: move it out, and draw it where it belongs by writing its value there in braces.',
              { code: 'view_component', start: sourcePosition(source, start) }
            )
        )
      );
    // A value in braces draws its type's view, as a render of that type, and a union's value its
    // member's, through a view added after the authored ones (see implicit-renders.server.ts).
    const typed = earlyTyping(
      source,
      blocks,
      extracted.cases,
      scenes.flatMap(({ over }) => (over ? [over] : []))
    );
    const early = typed && !('failure' in typed) ? typed : undefined;
    // Only the labels a view is typed by draw through a view (see withLabelOperators).
    const typedBy = new Set(
      findComponents(ast.html as Parameters<typeof findComponents>[0])
        .components.map(({ type }) => type)
        .filter(isLabelKey)
    );
    const typing = early && {
      ...early,
      domain: {
        ...early.domain,
        operators: Object.fromEntries(
          Object.entries(early.labelOperators).filter(([name]) => typedBy.has(name))
        )
      }
    };
    const authored = svelteSource.length;
    const pointerTypes = (html: unknown) => {
      const { components, pointers } = findComponents(html as Parameters<typeof findComponents>[0]);
      return new Set(components.filter(({ name }) => pointers.has(name)).map(({ type }) => type));
    };
    let implicit = typing
      ? implicitRenders(ast.html, typing, references, pointerTypes(ast.html))
      : [];
    if (typing) {
      const unions = new Set(
        implicit
          .map(({ type }) => type)
          .filter((type) => typing.domain.structures[type]?.kind === 'union')
      );
      const added = unionViews(unions, typing.domain);
      viewProblems.push(
        ...added.problems.map(
          (message) => new InvalidSvelteSourceError(message, { code: 'view_component' })
        )
      );
      if (added.text) {
        svelteSource += added.text;
        ast = parseView(svelteSource);
        implicit = implicitRenders(ast.html, typing, references, pointerTypes(ast.html));
      }
    }
    markImplicit(ast.html, implicit);
    // A label drawn in text with no type of its own says why, as the name of no label.
    if (typing) {
      const paths = new Map(
        references.flatMap((reference) =>
          reference.kind === 'value' ? [[reference.key, reference.path] as const] : []
        )
      );
      visit(ast.html, (node) => {
        const tag = node as {
          type: string;
          start?: number;
          expression?: { type?: string; name?: string };
        };
        const path =
          tag.type === 'MustacheTag' && tag.expression?.type === 'Identifier'
            ? paths.get(tag.expression.name ?? '')
            : undefined;
        if (path === undefined) return;
        const found = resolveLabel(path, typing.labels, true);
        if (!('problem' in found)) return;
        viewProblems.push(
          new InvalidSvelteSourceError(found.problem, {
            code: 'view_label',
            start: sourcePosition(source, tag.start ?? 0)
          })
        );
        tag.type = 'Comment';
      });
    }
    if (typing) viewProblems.push(...writtenRenders(ast.html, typing.domain, source, authored));
    const found = findComponents(ast.html as Parameters<typeof findComponents>[0]);
    // A union's value is drawn by its member's view, so no view of the union is written.
    if (typing)
      for (const { name, type, start } of found.components)
        if (start < authored && typing.domain.structures[type]?.kind === 'union')
          viewProblems.push(
            new InvalidSvelteSourceError(
              `${name} views ${type}, a union, whose values are drawn by their member's view: {value} picks the view of the member it holds, so remove ${name} and give each member of ${type} a view.`,
              { code: 'view_component', start: sourcePosition(source, start) }
            )
          );
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
        'Views cannot have their own <script>: input and algorithm values and the library components are already in scope. Compute in markup, using {@const} inside a block or component for reuse.',
        { code: 'view_script', start: sourcePosition(source, authoredScript.start) }
      );
    // The view is checked before any block runs, so its problems are reported with theirs.
    if (blocks.design)
      throw new InvalidSvelteSourceError(
        'Sources have no design block: the design space is made from the view, every look a variable of a kind of node, and every type a choice of its views. Remove the block, and give a node a kind of its own where it needs one, as <Node kind="Caption">…</Node>.',
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
    const {
      insertions,
      problems,
      kinds: unlaid,
      freeNodes,
      linkedNodes,
      flows,
      tagKinds,
      nodeKinds,
      collections,
      localKinds,
      listing,
      listingAt,
      bindings
    } = withNodeRefs(
      svelteSource,
      ast,
      source,
      found.roots,
      found.valueTypes,
      paths,
      linkedTypes,
      new Map(found.components.map(({ name, type }) => [name, type])),
      typing?.domain,
      authored
    );
    // Each layout is a kind, its frame's values the variables of its root's tag.
    const kindNames = new Set([...paths.keys(), ...paths.values()]);
    const layoutProblems = page.layouts.flatMap(({ name, root }) => {
      const { line, column } = sourcePosition(source, root);
      tagKinds[`${line}:${column + 1}`] = [name];
      return kindNames.has(name)
        ? [
            new InvalidSvelteSourceError(
              `The layout ${name} has a view's name, but a layout's name is its kind, as is a view's: rename one.`,
              { code: 'view_layout', start: sourcePosition(source, root) }
            )
          ]
        : [];
    });
    const layoutNames = new Set(page.layouts.map(({ name }) => name));
    const kindLayoutProblems = localKinds
      .filter(({ name }) => layoutNames.has(name))
      .map(
        ({ name, start }) =>
          new InvalidSvelteSourceError(
            `kind="${name}" has a layout's name, which is that layout's kind: rename one.`,
            { code: 'view_kinds', start: sourcePosition(source, start) }
          )
      );
    viewProblems = [
      ...viewProblems,
      ...problems,
      ...layoutProblems,
      ...kindLayoutProblems,
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
        'Add a <script algorithm> block, labelling the code its steps are about, as @check[…] (see Steps).',
        { code: 'missing_algorithm' }
      );
    const declaredDomain = blocks.domain
      ? interpretBlock(source, blocks.domain, (body) =>
          withSelectTypes(interpretDomain(body), selectsOf(source).selects)
        )
      : noDomain;
    // A view typed by a label sees the labelled expression as an operator named by it (see
    // withLabelOperators), its operands and result the fields the first trace recorded.
    const labelViews = new Set(found.components.map(({ type }) => type).filter(isLabelKey));
    // Without a trace no label has fields: the algorithm's own problem comes first.
    if (labelViews.size && typed && 'failure' in typed) throw typed.failure;
    const domain: DomainRegistry = {
      ...declaredDomain,
      operators: Object.fromEntries(
        Object.entries(typing?.domain.operators ?? {}).filter(([name]) => labelViews.has(name))
      )
    };
    for (const name of labelViews)
      if (!domain.operators?.[name])
        viewProblems.push(
          new InvalidSvelteSourceError(`A view takes ${labelViewProblem(name, typing?.labels)}`, {
            code: 'view_component'
          })
        );
    const { atoms } = domain;
    // A reference to a node shows as its place in the heap, no value a participant can read.
    for (const [start, type] of found.valueTypes) {
      const structure = domain.structures[type] as {
        kind?: string;
        heap?: boolean;
        element?: string;
      };
      if (structure?.kind === 'ref' && structure.heap)
        viewProblems.push(
          new InvalidSvelteSourceError(
            `A ${type} refers to a ${structure.element ?? 'node'} and has no value of its own to show: read a field of its node through it in a layout, as {q.name} with q a ${type}, or mark its node with a pointer view, as <View of="${type}" name="Here"><Pointed /></View>.`,
            { code: 'view_component', start: sourcePosition(source, start) }
          )
        );
    }
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
    const variableNames = [
      ...new Set([...declared(blocks.input, 'input'), ...declared(blocks.algorithm, 'algorithm')])
    ];
    // A query's result is state too, a variable at every step, and so is the row a scene stepping
    // over a list is at (see selects.server.ts).
    const overs = scenes.flatMap(({ over }) => (over ? [over] : []));
    const queryNames = [
      ...selectsOf(source).selects.map(({ name }) => name),
      ...overs.map(({ item }) => item)
    ];
    const clash = queryNames.find((name) => variableNames.includes(name));
    if (clash)
      throw new InvalidSvelteSourceError(
        `The query ${clash} has the name of a variable of the input or algorithm: give it another name.`,
        { code: 'view_select', start: sourcePosition(source, source.indexOf('<Select')) }
      );
    const stateNames = [...variableNames, ...queryNames];
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
    // Each layout reads only the state it declares (see layout-tags.server.ts).
    const undeclared = layoutReadProblems(
      (ast.html as { children?: unknown[] }).children ?? [],
      declaredLayouts,
      stateNames,
      references.flatMap((reference) =>
        reference.path === undefined ? [] : [{ path: reference.path, start: reference.start }]
      ),
      (node) => readsOf(node as Parameters<typeof readsOf>[0]),
      layoutNameOf
    );
    if (undeclared.length)
      throw InvalidSvelteSourceError.combine(
        undeclared.map(
          ({ message, start }) =>
            new InvalidSvelteSourceError(message, {
              code: 'view_layout',
              start: sourcePosition(source, start)
            })
        )
      );
    const components = checkComponents(
      found.components,
      found.pointers,
      viewing,
      stateNames,
      stateNames,
      source,
      typing?.labels
    );
    const views = viewsOf(components);
    // A type is rendered by name, as in {@render Int(value)}, and draws the view of it the variant
    // chooses, views.Int; a view named after its type would leave nothing to choose.
    const ownName = found.components.find(({ name, type }) => name === type);
    if (ownName)
      throw new InvalidSvelteSourceError(
        `${ownName.name} is a view named after its type: name it after how it draws, as ${ownName.name}Cell, and a value of ${ownName.name} in braces draws whichever of its views the design chooses.`,
        { code: 'view_component', start: sourcePosition(source, ownName.start) }
      );
    const typeKind = localKinds.find(({ name }) => definesType(viewing, name));
    if (typeKind)
      throw new InvalidSvelteSourceError(
        `kind="${typeKind.name}" has the name of a type: name the kind after what the node is, as kind="${typeKind.name}Label".`,
        { code: 'view_kinds', start: sourcePosition(source, typeKind.start) }
      );
    // A part is rendered by its name, which a type or operator would take.
    const typeNamed = [...paths.keys()].find(
      (name) => !Object.hasOwn(components, name) && definesType(viewing, name)
    );
    if (typeNamed)
      throw new InvalidSvelteSourceError(
        `The layout ${typeNamed} has the name of a type, whose values are drawn by its views: name the layout after what it shows, as ${typeNamed}Board.`,
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
    const writtenSelects = selectsOf(source).selects;
    const appliedRenders = operatorRendersOf(ast.html, operators, {
      // A scene over a list of groups is at one group's rows, a list of records too.
      lists: new Set([
        ...writtenSelects.map(({ name }) => name),
        ...overs.flatMap(({ list, item }) =>
          writtenSelects.some((each) => each.name === list && each.group) ? [item] : []
        )
      ]),
      grouped: new Set(writtenSelects.flatMap(({ name, group }) => (group ? [name] : []))),
      rows: new Set(
        overs.flatMap(({ list, item }) =>
          writtenSelects.some((each) => each.name === list && !each.group) ? [item] : []
        )
      )
    });
    const wrongRender = appliedRenders.find(({ argued, inView }) => argued || inView);
    if (wrongRender)
      throw new InvalidSvelteSourceError(
        wrongRender.argued
          ? `{@${labelOfOperator(wrongRender.name)}} draws what the code labelled @${labelOfOperator(wrongRender.name)} gave at a step, written {@${labelOfOperator(wrongRender.name)}} with nothing between the braces; every value it has given so far is {#each runs(@${labelOfOperator(wrongRender.name)}) as r}{r}{/each}.`
          : `{@${labelOfOperator(wrongRender.name)}} draws what a step's code labelled @${labelOfOperator(wrongRender.name)} gave, which only layouts know: write it in a layout, outside any view.`,
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
        `${undrawn.name} is a type, and nothing draws it: add a view of it, as <View of="${undrawn.name}" name="${undrawn.name}Cell"><Node value={this} /></View>.`,
        { code: 'view_component', start: sourcePosition(source, undrawn.start) }
      );
    const unknown = renderedNames(ast.html).find(
      ({ name }) => !paths.has(name) && !definesType(viewing, name) && !operators.has(name)
    );
    if (unknown)
      throw new InvalidSvelteSourceError(
        `${unknown.name} is drawn, but no view, type, layout, or label is named so: define it, as <View of="Index" name="${unknown.name}"><Pointed /></View> for a pointer or <Layout name="${unknown.name}">…</Layout>, or draw one that exists.`,
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
        `Every view of ${endless.name} draws ${endless.name} itself, without end: add a view that draws its value with nodes, as <View of="${endless.name}" name="${endless.name}Cell"><Node value={this} /></View>.`,
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
            `{@render ${name}(…)} names the view ${name}, but which view draws a value is the variant's: write the value in braces, as {…}, drawn by the view ${variable} chooses, and a place's own choice draws one render apart.`,
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
    const placeKinds = new Map<
      string,
      { base: string; role: KindRole; unboxed?: Readonly<Record<string, string>> }
    >();
    // A view of a record whose root arranges its parts is a card: one box, its fields drawn in it
    // unboxed, as parts of one thing rather than things of their own.
    const cards = new Set(
      Object.entries(components)
        .filter(
          ([name, type]) =>
            viewing.structures[type]?.kind === 'record' &&
            unlaid.some(({ key, role }) => key === name && role === 'container')
        )
        .map(([name]) => name)
    );
    const placeSlots = new Map<number, string>();
    const pointerPlaces = new Map<number, { view?: string; choice?: string; place: string }>();
    const aliases = new Map<number, { alias: string; callee: { start: number; end: number } }>();
    const aliasOf = new Map<string, string>();
    const placeReaders = new Map<string, Set<boolean>>();
    const labelMarks = new Map<string, { kinds: Record<string, string>; by?: string }>();
    // The places the root and its parts render at, which a listing's tokens can name.
    const rootPlaces = new Map<string, RenderedPlace>();
    for (const site of sites) {
      const { name, start, inNode, at, label } = site;
      if (!at || !(chosen[name] || pointerChosen[name])) continue;
      const { plain, marks } = optionsOf(name);
      const asMark = marks.length > 0 && (!inNode || !plain.length);
      // A place drawn both as a pointer and as a value, as a caption's number, takes its pointer's
      // paint.
      if (!site.within && (asMark || !rootPlaces.has(at)))
        rootPlaces.set(at, { type: name, pointer: asMark });
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
        for (const kind of unlaid)
          if (kind.key === view || kind.key.startsWith(`${view}.`))
            placeKinds.set(`${within}${kind.key}${at}`, {
              base: kind.key,
              role: kind.role,
              ...(kind.key !== view
                ? {}
                : site.inLink
                  ? { unboxed: linkLabelPaint }
                  : cards.has(site.within) && at.startsWith('@this.')
                    ? { unboxed: cardFieldPaint }
                    : {})
            });
      // A label the root marks: its listing region's paint falls back to the mark's.
      if (asMark && label && !within)
        labelMarks.set(at.slice(1), {
          kinds: Object.fromEntries(
            options
              .filter((view) => unlaid.some(({ key }) => key === kindKey(view, 'Pointed')))
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
    const caseInputsOf = caseInputs(source, blocks, extracted.cases, domain);
    const input = caseInputsOf[0]?.input ?? { state: {}, types: {} };
    // Each scene that steps shows one case, named.
    const caseNames = caseInputsOf.map(({ name }) => name);
    const uncased = scenes.flatMap((scene) => {
      if (scene.frame || (scene.case !== undefined && caseNames.includes(scene.case))) return [];
      const cases = caseNames.length
        ? `; the cases are ${caseNames.join(', ')}`
        : `, and the source has none: ${caseAdvice}`;
      return [
        new InvalidSvelteSourceError(
          scene.case === undefined
            ? `The scene ${scene.name} steps through a case, so it names it, as <Scene name="${scene.name}" case="${caseNames[0] ?? 'present'}">${cases}.`
            : `The scene ${scene.name} shows the case ${scene.case}, and no case is named ${scene.case}${cases}.`,
          { code: 'view_storyboard', start: scene.position }
        )
      ];
    });
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
    // The labels <When>s draw their contents in the runs of, by key.
    const during: Record<string, string> = {};
    const tested = ifTestsOf(ast.html, isLabelKey);
    const duringTests = ifTestsOf(ast.html, isDuringKey);
    const labelProblems: InvalidSvelteSourceError[] = [];
    if (!algorithmLabels.problems.length)
      for (const reference of references) {
        const at = { code: 'view_label', start: sourcePosition(source, reference.start) };
        const problem = (message: string) =>
          labelProblems.push(new InvalidSvelteSourceError(message, at));
        if (reference.kind === 'during') {
          const call = `<When of="${reference.moment ? `:${reference.moment}` : `@${reference.path ?? ''}`}">`;
          if (snippets.some(({ start, end }) => start <= reference.start && reference.start < end))
            problem(`${call} is in a view, which draws only its value: write it in a layout.`);
          else if (reference.path === undefined && !reference.moment)
            problem(
              '<When> takes a label by its full name, as <When of="@insert.swap">…</When>, and draws its contents at each step inside a span of that label; of=":before" and of=":after" draw them at the case\'s first step, the input as given, and its last.'
            );
          else if (!duringTests.has(reference.start))
            problem(
              `${call} says at which steps its contents show, as ${call}…</When>; it is never part of a condition.`
            );
          else if (reference.moment) during[reference.key] = momentTarget(reference.moment);
          else if (reference.path !== undefined) {
            const found = resolveLabel(reference.path, algorithmLabels.labels, false);
            if ('problem' in found) problem(found.problem);
            else during[reference.key] = found.label.full;
          }
          continue;
        }
        // A view typed by a label, as (this: @insert.compare), names the label as its type, reading nothing.
        if (
          reference.kind === 'value' &&
          /:\s*$/u.test(marked.slice(Math.max(0, reference.start - 40), reference.start))
        )
          continue;
        if (reference.kind === 'value' && tested.has(reference.start)) {
          problem(
            `{#if ${asWritten(reference.key)}} would choose what to draw by the label's value, which a view never does: <When of="${asWritten(reference.key)}">…</When> draws its contents at each step inside a span of the label.`
          );
          continue;
        }
        if (snippets.some(({ start, end }) => start <= reference.start && reference.start < end)) {
          problem(
            `${asWritten(reference.key)} is read in a view, which sees only its value; labels are read in layouts, which pass what a view draws, as {@swap.a}.`
          );
          continue;
        }
        if (reference.kind === 'applied') {
          problem(
            `${asWritten(reference.key)} is not written: label the expression whose results it lists, as @check.equal[a === b], and draw what it computed at each step with a view typed by the label, as <View of="@check.equal" name="Ask">…</View> drawn by {@check.equal}; runs(@check.equal) lists its values so far.`
          );
          continue;
        }
        const filter = reference.kind === 'value' && filters.has(reference.key);
        const found = resolveLabel(reference.path, algorithmLabels.labels, !filter);
        if ('problem' in found) {
          problem(found.problem);
          continue;
        }
        if (filter) narrowed.set(reference.key, labelSpan(found.label));
        else labelled[reference.key] = { label: found.label.full };
      }
    const whens = whenChainsOf(ast.html);
    for (const start of whens.elses)
      labelProblems.push(
        new InvalidSvelteSourceError(
          'A <When> has no {:else}: what shows outside the label\'s runs goes beside the <When>, where it shows at every step, and another label\'s steps take a branch of their own, as <OneOf><When of="@insert.compare">…</When><When of="@insert.swap">…</When></OneOf>.',
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
            `${name}(…) is called in the view, which only draws what the algorithm computed: ${names.length ? `read ${names.join(' or ')}, a label on an application of ${name}, in a layout` : `label an application of ${name} in the algorithm, as @next[${name}(i)], and read that label, by its full name, in a layout`}.`,
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
    // The page pauses where labels finish (see Pacing), at the labels a scene pauses at, else at
    // every label; the applications made inside the labels the root renders an operator at, one at
    // a time or so far, are kept.
    const shown = new Map<string, { start: number; end: number }[]>();
    for (const { operator, start, end } of [
      ...Object.values(appliedIn),
      ...Object.values(histories)
    ])
      shown.set(operator, [...(shown.get(operator) ?? []), { start, end }]);
    const pacing: Pacing = { shown };
    const keep = {
      labels: new Set(Object.values(labelled).map(({ label }) => label)),
      // The labels a view typed by the label draws, whose operands and result each step keeps.
      applications: new Set(operatorNames(domain).filter(isLabelKey).map(labelOfOperator))
    };
    // Each case traced pausing at every label; what holds for every step holds over all of them.
    const tracedCases = caseInputsOf.map(({ name, input }) => ({
      name,
      traced: paced(source, algorithm, input, domain, pacing, keep, overs)
    }));
    const traced =
      tracedCases[0]?.traced ?? paced(source, algorithm, input, domain, pacing, keep, overs);
    const master = tracedCases.length
      ? tracedCases.flatMap(({ traced }) => traced.steps)
      : traced.steps;
    const masterOf = (shown?: string) =>
      (tracedCases.find(({ name }) => name === shown) ?? tracedCases[0])?.traced.steps ??
      traced.steps;
    const inputOf = (shown?: string) =>
      caseInputsOf.find(({ name }) => name === shown)?.input ?? input;
    // The variables the view reads: a step draws from these, and from no other.
    const viewReads = [...readsOf(ast.html as Parameters<typeof readsOf>[0])].filter((name) =>
      stateNames.includes(name)
    );
    const runs = labelRuns(master, {
      state: new Set(viewReads),
      labels: new Set(Object.values(labelled).map(({ label }) => label)),
      operators: new Set(shown.keys()),
      during: new Set(Object.values(during))
    });
    // Each free layout's look starts from the structure its data makes, which the assistant is told,
    // and each kind of link's head from whether its links are all two-way lines.
    const { structures, lines } = linkFacts({
      free: freeNodes,
      linked: linkedNodes,
      views: found.components,
      stateNames,
      domain,
      steps: master
    });
    // A collection's kind starts its box and items by its axis and whether its length ever changes.
    const steady = steadyLengths(master);
    const variables = variableTypes(master);
    const kinds = unlaid.map((kind): DesignKind => {
      const structure = structures[kind.key];
      const flow = flows.get(kind.key);
      const items = collections.get(kind.key);
      const itemsType =
        items && (items.type ?? (items.over ? variables.get(items.over) : undefined));
      return structure
        ? { ...kind, free: { structure, ...(flow ? { flow } : {}) } }
        : kind.role === 'link' && lines.has(kind.key)
          ? { ...kind, lines: true }
          : items
            ? {
                ...kind,
                collection: {
                  axis: items.axis,
                  steady: itemsType !== undefined && steady.has(itemsType)
                }
              }
            : kind;
    });
    // A name nothing gives the page would fail only in the browser.
    const unread = unknownReadOf(
      ast.html,
      (name) =>
        stateNames.includes(name) ||
        paths.has(name) ||
        definesType(viewing, name) ||
        operators.has(name) ||
        name === 'Math' ||
        name === 'at' ||
        name === 'count' ||
        name === layoutProp ||
        isLabelKey(name) ||
        isRunsKey(name) ||
        isHistoryKey(name) ||
        isDuringKey(name)
    );
    if (unread)
      throw new InvalidSvelteSourceError(
        `The view reads ${unread.name}, which nothing gives it: a view reads only its own value, this, and types, views, labels (@…), the library's components (Node, Link, Pointed, Listing, Layout, When, OneOf), Math, at(p), count(n) and spans(@label); a layout also reads the input and algorithm variables it declares; and any of them reads the names its {#each} blocks and {@const} tags declare. Browser globals, as window or self, are never in scope.`,
        { code: 'view_name', start: sourcePosition(source, unread.start) }
      );
    // at(p) reads the element a position points at, in the collection the steps say it points into.
    const positions = positionReads(
      ast.html,
      source,
      domain,
      variableTypes(master),
      pointedInto(master, domain)
    );
    if (positions.problems.length)
      throw InvalidSvelteSourceError.combine(
        positions.problems.map(
          ({ message, start }) =>
            new InvalidSvelteSourceError(message, {
              code: 'view_position',
              start: sourcePosition(source, start)
            })
        )
      );
    const labelNames = traced.labels.map(({ full }) => full);
    // The steps each way of pausing makes, traced once each. The master, pausing at every label, is
    // bounded only as the source's (algorithmLimits); a scene pausing so is held to what one
    // presentation shows, by tracing it as a scene.
    const tracedBy = new Map<string, MasterStep[]>();
    const tracedSteps = (
      pauses: Pauses,
      edges?: Edges,
      shown?: string,
      over?: { list: string; item: string }
    ): MasterStep[] => {
      const key = `${shown ?? ''}|${pausesKey(pauses, edges)}|${over ? `${over.list}:${over.item}` : ''}`;
      const made = tracedBy.get(key);
      if (made) return made;
      const steps = over
        ? overSteps(masterOf(shown), over.list, over.item)
        : pausesKey(pauses, edges) === pausesKey(new Set(labelNames)) &&
            masterOf(shown).length <= algorithmLimits.maximumSteps + 1
          ? masterOf(shown)
          : paced(source, algorithm, inputOf(shown), domain, { ...pacing, pauses, edges }, keep)
              .steps;
      tracedBy.set(key, steps);
      return steps;
    };
    const sceneView = { listed: Boolean(listing), whens: Object.values(during), reads: viewReads };
    const { storyboard, problems: sceneProblems } = storyboardOf(
      scenes,
      (scene) => masterOf(scene.case),
      labelNames,
      (scene) => tracedSteps(scenePauses(scene), sceneEdges(scene), scene.case, scene.over),
      sceneView
    );
    // Reported once the view's own problems are cleared, which may be why nothing is shown.
    if ((unshown.length || uncased.length || sceneProblems.length) && !viewProblems.length)
      throw InvalidSvelteSourceError.combine([
        ...unshown,
        ...uncased,
        ...sceneProblems.map(
          ({ message, scene }) =>
            new InvalidSvelteSourceError(message, {
              code: 'view_storyboard',
              start: scene.position
            })
        )
      ]);
    // A chain's branches take turns in one place: none may show at a step another shows at, among
    // the steps each scene plays.
    const overlaps =
      storyboard.scenes.length && !viewProblems.length
        ? whens.chains.flatMap(({ start, keys }) => {
            const labels = keys.map((key) => during[key]).filter((label) => label !== undefined);
            const both = storyboard.scenes.flatMap((scene) => {
              if (scene.frame) return [];
              const own = tracedSteps(scenePauses(scene), sceneEdges(scene), scene.case);
              return sceneSteps(scene, own, sceneView).flatMap((at) => {
                const shown = labels.filter((label) => atWhen(label, own, at));
                return shown.length > 1 ? [{ step: own[at].name ?? '', shown }] : [];
              });
            });
            if (!both.length) return [];
            const [{ shown }] = both;
            const steps = [...new Set(both.map(({ step }) => step))];
            return [
              new InvalidSvelteSourceError(
                `The <OneOf>'s branches ${shown.map(whenText).join(' and ')} would both show at ${steps.slice(0, 3).join(', ')}${steps.length > 3 ? ` and ${steps.length - 3} more` : ''}; a <OneOf>'s branches take turns in one place, so give each a label whose spans never meet the others', give each outcome a label of its own, or write them as <When>s of their own.`,
                { code: 'view_label', start: sourcePosition(source, start) }
              )
            ];
          })
        : [];
    if (overlaps.length) throw InvalidSvelteSourceError.combine(overlaps);
    const steps = storyboard.steps;
    // Pausing at every label, the finest the steps go, whose states those of any other pauses are
    // among.
    const seen = master;
    // Every state a presentation can show: each step's before and after.
    const everyStep = phasesOf(master);
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
    const written = listingsFrom(source, traced, algorithm, listingBlocks, [...rootPlaces.keys()]);
    // A caption's token names a place the root renders, as a listing's does.
    for (const place of new Set(captions.places))
      if (!rootPlaces.has(place))
        written.problems.push(captions.unrendered(place, [...rootPlaces.keys()].sort()));
    if (listing && !listingBlocks.length)
      written.problems.push(
        new InvalidSvelteSourceError(
          'A <Listing /> shows a listing of the source\'s own: add its text in a <script listing="code"> block, marking each part to light as @label[text], and label the algorithm\'s code the same way, as @label[…] around it (see Listing).',
          { code: 'view_markup', start: sourcePosition(source, listingAt ?? 0) }
        )
      );
    if (written.problems.length) throw InvalidSvelteSourceError.combine(written.problems);
    const ownListings = listingBlocks.map(({ name }) => name);
    // A label a scene pauses at lights its region in the listing; one with none lights nothing.
    const paused = new Set(
      scenes.flatMap(({ pause = [] }) => pause.map((each) => each.replace(/:(before|after)$/u, '')))
    );
    const listingWarnings = written.unmarked
      .filter(({ full }) => paused.has(full))
      .map(({ full, name }) => unlitWarning(full, name));
    // An input the view draws but neither the algorithm nor another input reads was typed in, so
    // what it shows does not come from the run.
    const inputWarnings = blocks.algorithm
      ? (() => {
          const read = new Set([
            ...interpretBlock(source, blocks.algorithm, (body) =>
              referencedNames(body, 'algorithm', domain)
            ),
            ...(blocks.input
              ? interpretBlock(source, blocks.input, (body) =>
                  referencedNames(body, 'input', domain)
                )
              : [])
          ]);
          // A pool is read through the references the case gives other inputs, never by its name.
          return inputDeclarations(blocks.input?.body ?? '')
            .inputs.filter(
              ({ name, type }) =>
                !isPool(domain, type) && viewReads.includes(name) && !read.has(name)
            )
            .map(({ name }) => unreadInputWarning(name));
        })()
      : [];
    const listings = listing
      ? Object.fromEntries(
          Object.entries(written.listings).map(([name, { text, regions = [], tokens }]) => [
            name,
            {
              text,
              regions: regions.map(({ label, start, end }) => ({ label, start, end })),
              ...(tokens?.length ? { tokens } : {})
            }
          ])
        )
      : undefined;
    // What the root renders at each place a shown listing's token names, which its paint is read
    // from (see placePaint).
    const tokenPlaces = Object.fromEntries([
      ...Object.values(listings ?? {}).flatMap(({ tokens = [] }) =>
        tokens.map(({ place }) => [place, rootPlaces.get(place) as RenderedPlace])
      ),
      ...captions.places.map((place) => [place, rootPlaces.get(place) as RenderedPlace])
    ]);
    const placesSpace: DesignSpace = Object.keys(tokenPlaces).length
      ? { 'listing.places': [...listingPlacesOptions] }
      : {};
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
    // A query's result, and the row a scene over a list is at, are given at every step they show.
    const scoped = new Set([
      ...variableNames.filter((name) => everyStep.some(({ state }) => !(name in state))),
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
    // A type with a view is drawn, never called, rendered or not: {Index(k)} is refused too.
    const viewCalls = viewCallsOf(
      ast.html,
      new Set([...viewNames, ...found.components.map(({ type }) => type)])
    );
    if (viewCalls.length)
      throw InvalidSvelteSourceError.combine(
        viewCalls.map(
          ({ name, start }) =>
            new InvalidSvelteSourceError(
              `${name}(…) is a view, which only draws: write {value}, the value in braces, with a value from the state. Values are made in the input and algorithm blocks, not in the view; a loop's own index, as k in {#each list as v, k}, is shown as text, {k}.`,
              { code: 'view_component', start: sourcePosition(source, start) }
            )
        )
      );
    // A variable the view reads itself is absent at a step where it is not declared yet, as at a
    // scene's :before, or out of scope: what reads it is drawn hidden there, keeping its room, a
    // node by its own reads (see leftOutModel) and a block by its test (see guardInsertions). A
    // label's value is no variable to test.
    const labelReads = scopedReadsOf(ast.html, new Set([...scoped].filter(isLabelKey)));
    if (labelReads.length)
      throw InvalidSvelteSourceError.combine(
        labelReads.map(
          ({ name, start }) =>
            new InvalidSvelteSourceError(
              `The view reads ${asWritten(name)} itself, but a label's value is drawn only through a view, as {${asWritten(name)}}, never tested or computed with. A view cannot choose what to draw by a label's value, as {#if ${asWritten(name)}}: <When of="${asWritten(name)}">…</When> draws its contents at each step inside a span of the label, and to mark only what a test let through, label the positions the code it guards uses and render the type at those labels (see Views of what a step computed).`,
              { code: 'view_component', start: sourcePosition(source, start) }
            )
        )
      );
    const absentVariables = new Set([...scoped].filter((name) => !isLabelKey(name)));
    const openingReads = scopedReadsOf(ast.html, absentVariables);
    const guards = guardInsertions(ast.html, absentVariables);
    const guarded = guards.flatMap(({ at }, index) =>
      index % 2 ? [] : [{ start: at, end: guards[index + 1].at }]
    );
    const unhidden = outsideNodes(ast.html, openingReads).filter(
      ({ start }) => !guarded.some((span) => span.start <= start && start < span.end)
    );
    if (unhidden.length)
      throw InvalidSvelteSourceError.combine(
        unhidden.map(
          ({ name, start }) =>
            new InvalidSvelteSourceError(
              `The view reads ${asWritten(name)} itself outside any <Node> or block test, where nothing can hide it at a step ${asWritten(name)} does not exist. Put the read inside a <Node>.`,
              { code: 'view_component', start: sourcePosition(source, start) }
            )
        )
      );
    // count(n) is the list 0, 1, … up to n − 1, its type's largest bounding the room (see countCalls).
    const counts = countCalls(
      ast.html,
      domain,
      variableTypes(master),
      new Map(found.components.map(({ name, type }) => [name, type]))
    );
    const countProblems = counts.filter(({ problem }) => problem);
    if (countProblems.length)
      throw InvalidSvelteSourceError.combine(
        countProblems.map(
          ({ problem, start }) =>
            new InvalidSvelteSourceError(problem!, {
              code: 'view_component',
              start: sourcePosition(source, start)
            })
        )
      );
    const slotted = new Map<number, string[]>();
    const unresolvedEnds: { end: string; written: string; start: number }[] = [];
    const tagged = withInsertions(svelteSource, [
      ...counts.flatMap(({ start, end }) => [
        { at: start, text: 'Array.from({ length: Math.max(0, ', remove: 'count('.length },
        { at: end - 1, text: ') }, (_, k) => k)', remove: 1 }
      ]),
      ...guards,
      ...branchInsertions(found.components),
      // A grid's rows and columns for any input, from its coordinates' types (see gridExtents).
      ...[
        ...gridExtents(
          ast.html,
          domain,
          variableTypes(master),
          new Map(found.components.map(({ name, type }) => [name, type]))
        )
      ].map(([start, extent]) => ({
        at: start + '<Node'.length,
        text: ` __extent={${JSON.stringify(extent)}}`
      })),
      ...insertions,
      ...pointers.removals,
      ...implicitInsertions(
        implicit,
        pointers.removals,
        (start) =>
          [...aliases.values()].find(({ callee }) => callee.start === start && callee.end === start)
            ?.alias
      ),
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
        placeSlots,
        referencesOf(master, domain),
        positions.targets,
        unresolvedEnds
      ),
      // A brace render has no type name written to replace: its alias is its callee (see implicitInsertions).
      ...[...aliases.values()]
        .filter(({ callee }) => callee.end > callee.start)
        .map(({ alias, callee }) => ({
          at: callee.start,
          text: alias,
          remove: callee.end - callee.start
        }))
    ]);
    if (unresolvedEnds.length)
      throw InvalidSvelteSourceError.combine(
        unresolvedEnds.map(
          ({ end, written, start }) =>
            new InvalidSvelteSourceError(
              `<Link ${end}={${written}}> names no element: a link's end is a position, as ${end}={k} for an {#each} index or arithmetic of one index and numbers, as ${end}={2 * k + 1}, a position or reference the state holds, as ${end}={edge.${end}} or to={node.next}, or a label, as ${end}={@swap.${end}}.`,
              { code: 'invalid_prop', start: sourcePosition(source, start) }
            )
        )
      );
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
    const generated = withGeneratedScripts(
      `${tagged}${probeMarkup(components)}{#snippet __sverlinNone()}{/snippet}`,
      [
        ...stateNames,
        ...appliedNames.map(appliedKey),
        ...Object.keys(labelled),
        ...Object.keys(histories),
        ...Object.keys(during),
        ...Object.keys(chosen),
        ...Object.keys(viewAliases),
        layoutProp
      ],
      { ...chosen, ...viewAliases },
      { ...pointerChosen, ...pointerAliases },
      pointers.calls,
      paints,
      linked.length ? endTypes : []
    );
    const compiled = (generate: Generate) =>
      compile(generated, { filename: 'Main.svelte', generate, css: 'injected', dev: false }).js
        .code;
    const component = compiled('client');
    const serverComponent = compiled('server');
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
    // The steps each way of pausing makes, with what follows from them, made once each.
    const pacedBy = new Map<string, PacedSteps>();
    const pacedSteps = (
      pauses: Pauses,
      edges?: Edges,
      shown?: string,
      over?: { list: string; item: string }
    ): PacedSteps => {
      const key = `${shown ?? ''}|${pausesKey(pauses, edges)}|${over ? `${over.list}:${over.item}` : ''}`;
      const made = pacedBy.get(key);
      if (made) return made;
      const steps = tracedSteps(pauses, edges, shown, over);
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
    const layoutDesign = page.layouts.map(({ name }) => name);
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
      serverComponent,
      master,
      ownListings,
      ...(listingWarnings.length ? { listingWarnings } : {}),
      ...(inputWarnings.length ? { inputWarnings } : {}),
      pauses: { labels: labelNames, runs },
      paced: pacedSteps,
      storyboard,
      steps,
      signature: stepSignature(steps),
      atoms,
      lengths: Object.fromEntries(
        Object.values(domain.structures).flatMap((structure) =>
          structure.kind === 'collection' && structure.max !== undefined
            ? [[structure.name, structure.max]]
            : []
        )
      ),
      components: probes,
      design: {
        views: chosen,
        pointers: pointerChosen,
        structures,
        tags: tagKinds,
        layouts: page.layouts.map(({ name, direction, root }) => {
          const at = sourcePosition(source, root);
          return { name, direction, ref: `${at.line}:${at.column + 1}` };
        }),
        renders: renderVariables,
        places: placeChoices,
        fallbacks: Object.fromEntries([
          ...Object.values(placeChoices).map(({ key, base }) => [key, base]),
          ...[...placeKinds].flatMap(([key, { base, role, unboxed }]) =>
            roleProps[role]
              .filter((prop) => placeProps.has(prop) && !(unboxed && prop in unboxed))
              .map((prop) => [`${key}.${prop}`, `${base}.${prop}`])
          ),
          // After the marks' places, which the regions' fall back to.
          ...Object.entries(listingRegionFallbacks(regionLabels, labelMarks))
        ]),
        space: withoutBoundSizes(
          {
            ...designSpace(
              kinds,
              chosen,
              listing,
              ownListings,
              pointerChosen,
              {
                kinds: [...placeKinds].map(([key, { role }]) => ({ key, role })),
                choices: Object.values(placeChoices)
              },
              layoutDesign
            ),
            ...listingRegionSpace(regionLabels),
            ...placesSpace,
            ...boundDesign(bindings).space
          },
          bindings
        ),
        starter: withoutBoundSizes(
          {
            ...starterVariant(
              kinds,
              chosen,
              listing,
              ownListings,
              pointerChosen,
              {
                kinds: [...placeKinds].map(([key, { role }]) => ({ key, role })),
                choices: Object.values(placeChoices)
              },
              layoutDesign
            ),
            ...regionStarter,
            // A link's label, as a weight, and a card's fields start unboxed: a box would read as
            // a node of its own. The card is the box.
            ...Object.fromEntries(
              [...placeKinds].flatMap(([key, { unboxed }]) =>
                unboxed
                  ? Object.entries(unboxed).map(([prop, value]) => [`${key}.${prop}`, value])
                  : []
              )
            ),
            ...Object.fromEntries(
              [...cards].flatMap((card) =>
                Object.entries(cardLook).map(([prop, value]) => [`${card}.${prop}`, value])
              )
            ),
            ...(Object.keys(placesSpace).length ? { 'listing.places': starterListingPlaces } : {}),
            ...boundDesign(bindings).starter
          },
          bindings
        )
      },
      ...(listings ? { listings } : {}),
      ...(Object.keys(tokenPlaces).length ? { tokenPlaces } : {}),
      ...(appliedNames.length ? { applied } : {}),
      ...(Object.keys(appliedIn).length ? { appliedIn } : {}),
      ...(Object.keys(labelled).length ? { labelled } : {}),
      ...(Object.keys(histories).length ? { histories } : {}),
      ...(Object.keys(during).length ? { during } : {}),
      viewReads,
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
    const told = new Set([error, ...error.others].map(({ message }) => message));
    const more = [...(viewProblems.includes(error) ? [] : viewProblems), ...listingAlone()].filter(
      ({ message }) => !told.has(message)
    );
    throw more.length ? InvalidSvelteSourceError.combine([error, ...error.others, ...more]) : error;
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
  const { scenes } = prepared.storyboard;
  const frames = scenes.map(({ layout }) => frameSettings(design, values, layout));
  // The presentation keeps one size: the first scene's layout's ratio.
  const frame = frames[0];
  // Each type rendered by name draws the view the variant chose for it.
  const views = Object.fromEntries([
    ...Object.keys(design.views).map((type) => [type, values[viewKey(type)]]),
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
  // Each scene's steps, paced as it pauses, in storyboard order; a frame is the input as given,
  // which its layout does not read. Each step keeps its run and where it is in it, for what its
  // run has given so far.
  // Each step a scene leaves out, drawing what the step before it drew, told to the assistant.
  const warnings: string[] = [
    ...(prepared.listingWarnings ?? []),
    ...(prepared.inputWarnings ?? []),
    ...variant.dropped
  ];
  const entries = scenes.flatMap((scene, sceneIndex) => {
    const run = prepared.paced(scenePauses(scene), sceneEdges(scene), scene.case, scene.over);
    const view = {
      listed: Boolean(prepared.listings),
      whens: Object.values(prepared.during ?? {}),
      reads: prepared.viewReads
    };
    const left: LeftOutStep[] = [];
    const chosen = scene.frame ? [0] : sceneSteps(scene, run.steps, view, left);
    warnings.push(...left.map((each) => leftOutWarning(each, run.steps, scenes.length)));
    return chosen.map((index) => ({
      scene,
      sceneIndex,
      run,
      index
    }));
  });
  const master = entries.map(({ scene, run, index }) =>
    scene.frame
      ? {
          ...run.steps[0],
          name: undefined,
          labelled: undefined,
          applied: undefined,
          held: undefined
        }
      : run.steps[index]
  );
  if (master.length > algorithmLimits.maximumSteps + 1)
    throw new InvalidSvelteSourceError(
      `The storyboard shows ${master.length} steps, more than the ${algorithmLimits.maximumSteps + 1} a presentation can: show fewer scenes, scenes within fewer spans, or pause at fewer labels.`,
      { code: 'too_many_steps' }
    );
  const single = scenes.length === 1 && !scenes[0].frame;
  const labels = entries.map(({ scene, run, index }) => {
    const own = run.steps[index].name ?? '';
    return single ? own : sceneLabel(scene, own);
  });
  // Each step's placements and lit code, from its run's, by the page's states (see phasesOf).
  const placements = entries.flatMap(({ scene, run, index }, at) =>
    scene.frame
      ? []
      : run.placements.flatMap((placement) =>
          Math.floor(placement.step / 2) === index
            ? [{ ...placement, step: at * 2 + (placement.step % 2) }]
            : []
        )
  );
  const lit = Object.fromEntries(
    Object.keys(entries[0]?.run.lit ?? {}).map((language) => [
      language,
      entries.map(({ scene, run, index }) =>
        scene.frame ? { current: [], earlier: [] } : run.lit[language][index]
      )
    ])
  );
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
    const entry = entries[step];
    const position = entry.scene.frame ? 0 : entry.index;
    const sofar = entry.scene.frame ? [master[step]] : entry.run.steps.slice(0, position + 1);
    const at = (path: string, key: string) => key + path.slice('value'.length);
    for (const [key, { label, sample }] of Object.entries(prepared.labelled ?? {})) {
      if (isRunsKey(key)) {
        const list = sofar.flatMap((past, which) =>
          which < position || index % 2 === 1 || position === 0
            ? (past.labelled?.[label] ?? [])
            : []
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
    // A <When>'s label: there where the step is inside one of its runs, else hidden, its
    // contents keeping their room.
    for (const [key, label] of Object.entries(prepared.during ?? {}))
      (!entry.scene.frame && atWhen(label, entry.run.steps, position) ? ownApplied : standIn.state)[
        key
      ] = true;
    for (const [key, history] of Object.entries(prepared.histories ?? {})) {
      const list = sofar.flatMap((past, which) =>
        (which < position || index % 2 === 1 || position === 0
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
      [layoutProp]: { [entry.scene.layout]: true },
      __types: { ...standIn.types, ...phase.types, ...ownTypes },
      __targets: { ...standIn.targets, ...phase.targets, ...ownTargets },
      __absent: Object.keys(standIn.state),
      __identities: { ...phase.identities?.ids, ...ownIdentities },
      __copies:
        index % 2 === 1
          ? copiesSincePrevious(phases[index - 1].identities?.copies, phase.identities?.copies)
          : (phase.identities?.copies ?? {}),
      __refs: phase.identities?.refs ?? {},
      __frame: frames[entry.sceneIndex],
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
  const listing = shownListing(prepared, values, lit);
  const trace = JSON.stringify(packStates(states));
  const result = await bundle(
    prepared.component,
    prepared.serverComponent,
    trace,
    JSON.stringify(prepared.atoms),
    JSON.stringify({
      components: prepared.components,
      placements,
      listing,
      lengths: prepared.lengths
    })
  );
  const output = result.outputFiles.find(({ path }) => path.endsWith('entry.js')) as OutputFile;
  if (output.contents.byteLength > maximumBundleBytes) {
    const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    throw new InvalidSvelteSourceError(
      `The compiled presentation is ${megabytes(output.contents.byteLength)}, over the ${megabytes(maximumBundleBytes)} limit; its ${master.length} steps' values take ${megabytes(trace.length)}. Give a smaller input, or keep less in the variables and labels the view reads at each step; scenes pausing at fewer labels give fewer steps.`
    );
  }
  // Every step laid out on the server, which the page draws with as given: one the server cannot
  // lay out, or whose layout would take the bundle over its limit, cannot be shown.
  const layoutBundle = result.outputFiles.find(({ path }) =>
    path.endsWith('layout.js')
  ) as OutputFile;
  const { geometries, size, failure, drawing, ...laid } = await layOutOnServer(layoutBundle.text);
  // The page reads the layout before its own code runs.
  const javascript =
    geometries && `window.__sverlinGeometry=${JSON.stringify(geometries)};\n${output.text}`;
  const unfit =
    failure ??
    (javascript && Buffer.byteLength(javascript) > maximumBundleBytes
      ? 'its layout would take the bundle over the limit'
      : undefined);
  if (!javascript || unfit) {
    const errors = laid.errors.length ? `; the view failed at ${laid.errors.join('; ')}` : '';
    console.warn(`[sverlin] seed ${seed} not laid out on the server: ${unfit}${errors}`);
    throw new InvalidSvelteSourceError(layoutFailureMessage(unfit, laid.errors), {
      code: 'layout_failed'
    });
  }
  // A step the view fails to draw shows nothing of it, and every such step would seem alike.
  if (laid.errors.length)
    throw new InvalidSvelteSourceError(drawFailureMessage(laid.errors), { code: 'draw_failed' });
  const layout: SvelteBundle['layout'] = {
    ...laid,
    ...(size ? { readability: readabilityOf(size, frame.ratio) } : {}),
    ...(drawing ? { drawing: drawingText(drawing) } : {})
  };
  return {
    javascript,
    layout,
    labels,
    steps: prepared.steps,
    stepSignature: prepared.signature,
    variant: values,
    origins: variant.origins,
    leftOut: leftOut.nodes,
    ...(warnings.length ? { warnings } : {})
  };
}

/**
 * The listing a variant shows, in its language, and what each step lights in it: the code it
 * finished and the code it keeps as run alike; and, where its tokens name places and the variant
 * lights them (listing.places), the places each step touches and the colour each lights in.
 */
export function shownListing(
  prepared: Pick<PreparedComponent, 'listings' | 'tokenPlaces'>,
  values: Readonly<Record<string, DesignValue>>,
  lit: Readonly<Record<string, readonly Lit[]>>
): StepListing {
  const language = values['listing.language'];
  const listed = typeof language === 'string' ? prepared.listings?.[language] : undefined;
  if (!listed) return null;
  const steps = lit[language as string] ?? [];
  const look = values['listing.places'] as ListingPlacesLook | undefined;
  const tokens = listed.tokens ?? [];
  const placed = prepared.tokenPlaces ?? {};
  const syntax = values['listing.syntax'];
  return {
    text: listed.text,
    regions: listed.regions,
    ...(syntax === 'keywords' || syntax === 'colour'
      ? {
          syntax: {
            colour: syntax === 'colour',
            spans: syntaxSpans(
              listed.text,
              language as string,
              syntax === 'colour' ? 'all' : 'keywords'
            )
          }
        }
      : {}),
    lit: steps.map(({ current, earlier }) =>
      [...current, ...earlier].map(([start, end]): [number, number] => [start, end])
    ),
    ...(tokens.length && look && look !== 'none'
      ? {
          places: {
            look,
            tokens: tokens.map(({ place, start, end }) => ({ place, start, end })),
            paints: Object.fromEntries(
              [...new Set(tokens.map(({ place }) => place))].map((place) => [
                place,
                placePaint(place, placed[place], values)
              ])
            ),
            touched: touchedPlaces(tokens, steps)
          }
        }
      : {})
  };
}

/**
 * The frame of a page layout, as a scene shows it: its kind's values in the variant, as
 * Stacked.ratio, its root's row or column, and its name and root's tag; only that layout is drawn.
 */
export function frameSettings(
  design: Pick<PreparedComponent['design'], 'layouts'>,
  values: Readonly<Record<string, DesignValue>>,
  layout: string
): FrameSettings {
  const shown = design.layouts.find(({ name }) => name === layout) ?? design.layouts[0];
  const own = (prop: string) => values[`${shown.name}.${prop}`];
  return {
    ratio: own('ratio') as FrameSettings['ratio'],
    justify: own('justify') as FrameSettings['justify'],
    align: own('align') as FrameSettings['align'],
    padding: own('padding') as number,
    gap: own('gap') as number,
    layout: shown.direction,
    name: shown.name,
    ref: shown.ref
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

const sverlinBlock = /<script\s+(domain|input|algorithm|design)\s*>([\s\S]*?)<\/script\s*>/giu;
const listingBlock = /<script\s+listing\s*=\s*(["'])([\w-]*)\1\s*>([\s\S]*?)<\/script\s*>/giu;
/** A script's own attributes, as Svelte's (`lang="ts"`, `module`) on a view's script by habit. */
const scriptOpening = /<script\b([^>]*)>/giu;
const svelteAttributes =
  /^(?:\s+(?:lang\s*=\s*(["'])(?:ts|js|typescript|javascript)\1|module|context\s*=\s*(["'])module\2))*\s*$/iu;
const blockAdvice =
  '<script domain> for the types, <script input> for the inputs by type, <script algorithm> for the algorithm, and <script listing="name"> for a listing';

/** A listing of the source's own: its name, its text, where the text starts, and the block. */
type ListingBlock = Block & { name: string; start: number };

/** Remove the Sverlin blocks for Svelte, keeping every offset and line in place. */
function extractBlocks(source: string): {
  svelteSource: string;
  // A design block is found only to say that sources have none.
  blocks: Partial<Record<BlockKind | 'design', Block>>;
  listings: ListingBlock[];
  /** The cases written in the markup, which are blanked from it (see cases.server.ts). */
  cases: ReturnType<typeof writtenCases>;
} {
  const blocks: Partial<Record<BlockKind | 'design', Block>> = {};
  let svelteSource = source;
  const listings: ListingBlock[] = [];
  for (const match of source.matchAll(listingBlock)) {
    const start = match.index;
    listings.push({
      name: match[2],
      body: match[3],
      offset: start + match[0].indexOf('>') + 1,
      start
    });
    svelteSource =
      svelteSource.slice(0, start) +
      match[0].replace(/[^\n]/gu, ' ') +
      svelteSource.slice(start + match[0].length);
  }
  for (const match of svelteSource.matchAll(sverlinBlock)) {
    const kind = match[1].toLowerCase() as BlockKind | 'design';
    if (blocks[kind])
      throw new InvalidSvelteSourceError(`A component can have only one ${kind} block.`, {
        code: 'sverlin_block',
        start: sourcePosition(source, match.index)
      });
    const start = match.index;
    blocks[kind] = { body: match[2], offset: start + match[0].indexOf('>') + 1 };
    svelteSource =
      svelteSource.slice(0, start) +
      match[0].replace(/[^\n]/gu, ' ') +
      svelteSource.slice(start + match[0].length);
  }
  // A plain <script>, or one with Svelte's own attributes, is a view's script, refused as such
  // later; any other attributes name no block.
  for (const opening of svelteSource.matchAll(scriptOpening)) {
    if (svelteAttributes.test(opening[1])) continue;
    throw new InvalidSvelteSourceError(
      `Unrecognized block ${opening[0]}; a block is a <script> named by one attribute: ${blockAdvice}.`,
      { code: 'sverlin_block', start: sourcePosition(source, opening.index) }
    );
  }
  const cases = casesOf(svelteSource);
  const selects = selectsOf(svelteSource);
  const [selectProblem] = selects.problems;
  if (selectProblem)
    throw new InvalidSvelteSourceError(selectProblem.message, {
      code: 'view_select',
      start: sourcePosition(source, selectProblem.start)
    });
  for (const { start, end } of [...cases.tags, ...selects.tags])
    svelteSource =
      svelteSource.slice(0, start) +
      svelteSource.slice(start, end).replace(/[^\n]/gu, ' ') +
      svelteSource.slice(end);
  return { svelteSource, blocks, listings, cases };
}

/** One case's name and the input it gives the algorithm. */
type CaseInput = { name: string; input: TypedState };

/**
 * The input each case gives, in the order the cases are written: the input block's types applied to
 * the case's values (see cases.server.ts), each checked against its type. Problems in a case are
 * reported at the case, naming it and the input.
 */
function caseInputs(
  source: string,
  blocks: Partial<Record<BlockKind | 'design', Block>>,
  cases: ReturnType<typeof writtenCases>,
  domain: DomainRegistry
): CaseInput[] {
  const at = (offset: number) => sourcePosition(source, offset);
  const problems = cases.problems.map(
    ({ message, start }) =>
      new InvalidSvelteSourceError(message, { code: 'view_case', start: at(start) })
  );
  const block = blocks.input;
  const declared = block ? inputDeclarations(block.body) : { inputs: [], problems: [] };
  for (const { message, at: offset } of declared.problems)
    problems.push(
      new InvalidSvelteSourceError(message, {
        code: 'algorithm_error',
        start: at((block?.offset ?? 0) + offset)
      })
    );
  if (problems.length) throw InvalidSvelteSourceError.combine(problems);
  const pool = (type: string) => isPool(domain, type);
  const given = declared.inputs.filter(({ type }) => !pool(type));
  const inputs: CaseInput[] = [];
  for (const shown of cases.cases) {
    const fail = (message: string, offset = shown.start) =>
      problems.push(
        new InvalidSvelteSourceError(message, { code: 'view_case', start: at(offset) })
      );
    const missing = given.filter(({ name }) => !shown.values.some(({ input }) => input === name));
    if (missing.length) {
      fail(
        `The case ${shown.name} gives no ${missing.map(({ name }) => name).join(' or ')}: a case gives every input the input block declares, as ${missing.map(({ name }) => `${name}={…}`).join(' ')}.`
      );
      continue;
    }
    const extra = shown.values.find(({ input }) => !given.some(({ name }) => name === input));
    if (extra) {
      const poolInput = declared.inputs.find(({ name }) => name === extra.input);
      fail(
        poolInput
          ? `The case ${shown.name} gives ${extra.input}, a pool, which starts empty in every case: the algorithm adds its nodes, as ${extra.input}.add(…).`
          : `The case ${shown.name} gives ${extra.input}, which the input block does not declare${given.length ? `; its inputs are ${given.map(({ name }) => name).join(', ')}` : ''}.`,
        extra.start
      );
      continue;
    }
    const written = caseInputBody(block?.body ?? '', declared.inputs, shown, pool);
    try {
      inputs.push({ name: shown.name, input: interpretInput(written.body, domain) });
    } catch (cause) {
      if (!(cause instanceof AlgorithmError)) throw cause;
      const span = written.spans.find(
        ({ from, end }) =>
          cause.offset !== undefined && cause.offset >= from && cause.offset <= end + 1
      );
      fail(
        `In the case ${shown.name}${span ? `, ${span.input}` : ''}: ${cause.message}`,
        span ? span.source + Math.max(0, (cause.offset ?? span.start) - span.start) : shown.start
      );
    }
  }
  if (problems.length) throw InvalidSvelteSourceError.combine(problems);
  return inputs;
}

/** The first case's input, for what reads one execution only: the listings and the first typing. */
function firstInput(
  source: string,
  blocks: Partial<Record<BlockKind | 'design', Block>>,
  cases: ReturnType<typeof writtenCases>,
  domain: DomainRegistry
): TypedState {
  return caseInputs(source, blocks, cases, domain)[0]?.input ?? { state: {}, types: {} };
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
      code: cause.written ? 'algorithm_written' : 'algorithm_error',
      start: at(cause.offset),
      end: at(cause.end)
    });
  }
}

function sourcePosition(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  const line = before.split('\n').length;
  return { line, column: writtenColumn(line, offset - lineStart) };
}

/**
 * Give the script-free view its scripts: the library prelude and every recorded value and the view
 * each type rendered by name draws, as props. Both share the first line so authored line numbers are unchanged.
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
  // The root's pointers are drawn around what they point at, from the start (see pointerCalls),
  // those of a layout only where it is shown, the layout prop holding which (see layouts.server.ts).
  const shownLayout = `.filter((pointer: any) => !pointer.layout || ${layoutProp}?.[pointer.layout])`;
  const pointing = pointers.length
    ? `import { providePointers as __sverlinPointers } from 'sverlin'; ${paints.join(' ')} __sverlinPointers([${pointers.join(', ')}]${shownLayout});`
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

const layouts = ['row', 'column', 'grid', 'free', 'stack'];
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
    flow: named({ x: 0, y: 0 }, false),
    kind: null,
    row: null,
    col: null,
    width: null,
    height: null
  },
  Pointed: {},
  Link: {
    from: null,
    to: null,
    children: null
  }
};

/** A link's looks, the variables of its kind, as Graph.Link.route. */
const linkLooks = new Set(['curve', 'route', 'head', 'headSize']);

/**
 * A design without the width or height variable of a kind whose nodes size that axis by their value:
 * there the size is the value, and the kind's anchor places it.
 */
function withoutBoundSizes<T>(
  design: Record<string, T>,
  bindings: readonly { kind: string; prop: string }[]
): Record<string, T> {
  const bound = new Set(
    bindings.filter(({ prop }) => lengthProps.has(prop)).map(({ kind, prop }) => `${kind}.${prop}`)
  );
  return Object.fromEntries(Object.entries(design).filter(([key]) => !bound.has(key)));
}

/** Props that set a look, which belongs to the design, not the markup. */
const designProps = new Set([
  'shape',
  'fill',
  'stroke',
  'opacity',
  'color',
  'font',
  'textSize',
  'weight',
  'padding',
  'gap',
  'align',
  'justify',
  'radius',
  'strokeWidth',
  'minSize',
  'strokeStyle',
  'shadow',
  'glow',
  'fillStyle',
  'decoration',
  'case',
  'xAnchor',
  'yAnchor',
  'spacing',
  'expand',
  'scale',
  'spread',
  'offsetX',
  'offsetY'
]);

/**
 * Reject a prop a library component does not take, or a written value it cannot use, such as
 * layout="table", which would otherwise be ignored without a word. The kind is the snippet the
 * component is in, which a look belongs to.
 */
function checkProps(
  component: 'Node' | 'Link' | 'Pointed',
  attributes: readonly Attribute[],
  start: number,
  source: string,
  problems: InvalidSvelteSourceError[],
  kind: string
): void {
  const props = libraryProps[component];
  for (const attribute of attributes) {
    if (attribute.type !== 'Attribute' || !attribute.name) continue;
    // A caption token's node, which the build writes (see captionTokens in layout-tags).
    if (component === 'Node' && ['__code', '__math', '__mathText'].includes(attribute.name))
      continue;
    // A bare icon draws the one icon its kind's design chooses (see roleOf).
    if (component === 'Node' && attribute.name === 'icon' && attribute.value === true) continue;
    const at = { start: sourcePosition(source, attribute.start ?? start) };
    // A length a view binds is taken out before this (see bind), so one left is written elsewhere.
    if (component === 'Node' && lengthProps.has(attribute.name)) {
      problems.push(
        new InvalidSvelteSourceError(
          `<Node> ${attribute.name} is a length bound to a view's value, the value times a unit, as <View of="Int" name="Bar"><Node ${attribute.name}={this} /></View>: elsewhere a box sizes to its contents, at least its kind's minSize.`,
          { code: 'unknown_prop', ...at }
        )
      );
      continue;
    }
    if (!(attribute.name in props)) {
      const named = Object.keys(props).filter((name) => name !== 'children');
      problems.push(
        new InvalidSvelteSourceError(
          attribute.name === 'tags'
            ? `<${component}> takes no tags: its kind is the view or layout it is in, or one it names, as <Node kind="Caption">…</Node>, and its look is a variable of that kind.`
            : component === 'Node' && freeLayoutProps.includes(attribute.name as DesignProp)
              ? `<Node> ${attribute.name} is a free layout's look, which the variant gives the kind of node arranging it, not the markup: here the variable ${kind}.${attribute.name}.`
              : component === 'Link' && attribute.name === 'directed'
                ? `<Link> takes no directed: a link is an arrow from its from to its to, and its direction follows from the data. Where the same <Link> joins two elements both ways at the same steps, as neighbour lists naming each edge from both its ends, the pair is one two-way line, with its kind's head at both ends.`
                : component === 'Link' && attribute.name === 'label'
                  ? `<Link> takes no label: write its label as its children, drawn at its middle, as <Link from={u} to={v}>{cost}</Link>, or text, as <Link from={u} to={v}>next</Link>.`
                  : attribute.name === 'size'
                    ? `<${component}> takes no size: its text's size is textSize, in pixels, a look the design gives every kind of node, not the markup, as the variable ${kind}.textSize.`
                    : component === 'Node' && attribute.name === 'anchor'
                      ? `<Node> takes no anchor: where a box sits in its slot is a look the design gives its kind, not the markup, as the variables ${kind}.xAnchor and ${kind}.yAnchor (start, center or end).`
                      : component === 'Link' && linkLooks.has(attribute.name)
                        ? `<Link> ${attribute.name} is a look, which the variant gives the link's kind, not the markup: here the variable ${kindKey(kind, 'Link')}.${attribute.name === 'curve' ? 'route' : attribute.name}.`
                        : component === 'Node' && valueOnlyProps.has(attribute.name)
                          ? `<Node> ${attribute.name} stands for a view's value, each value's ${attribute.name} the design's: bind it in a view, as <View of="State" name="StateMark"><Node ${attribute.name}={this} /></View>, and the design picks one of ${iconNames.join(', ')} for each value.`
                          : designProps.has(attribute.name)
                            ? `<${component}> ${attribute.name} is a look, which the design gives every kind of node, not the markup: a node's kind is the view or layout it is in, or the one it names, and its look is a variable of that kind.`
                            : named.length
                              ? `<${component}> has no prop ${attribute.name}. Its props are ${named.join(', ')}.`
                              : `<${component}> takes no props.`,
          { code: 'unknown_prop', ...at }
        )
      );
      continue;
    }
    const allowed = props[attribute.name];
    // A link's ends are what the data points at, never names written in the view.
    if (
      component === 'Link' &&
      (attribute.name === 'from' || attribute.name === 'to') &&
      Array.isArray(attribute.value) &&
      attribute.value.some(
        (part) =>
          part.type === 'Text' ||
          (part.expression?.type === 'Literal' && typeof part.expression.value === 'string')
      )
    ) {
      problems.push(
        new InvalidSvelteSourceError(
          `<Link ${attribute.name}="…"> names an end by text; its ends are what the data points at: a position, as ${attribute.name}={k} for an {#each} index or ${attribute.name}={edge.${attribute.name}}, a reference, as to={node.next}, or a label, as ${attribute.name}={@swap.${attribute.name}}.`,
          { code: 'invalid_prop', ...at }
        )
      );
      continue;
    }
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

/**
 * A grid's children are nodes placed by row and col, through {#each} and {#if} as anywhere, and
 * row and col place only a grid's children.
 */
function gridProblems(markup: unknown, source: string): InvalidSvelteSourceError[] {
  type Tag = {
    type?: string;
    name?: string;
    start?: number;
    data?: string;
    attributes?: Attribute[];
    children?: unknown[];
  };
  const problems: InvalidSvelteSourceError[] = [];
  const reject = (message: string, start: number | undefined) =>
    problems.push(
      new InvalidSvelteSourceError(message, {
        code: 'view_grid',
        start: sourcePosition(source, start ?? 0)
      })
    );
  const walk = (value: unknown, inGrid: boolean): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((part) => walk(part, inGrid));
    const tag = value as Tag & Record<string, unknown>;
    if (tag.type === 'SnippetBlock') return walk(tag.children, false);
    if (tag.type === 'InlineComponent' && tag.name === 'Node') {
      const attribute = (name: string) => tag.attributes?.find((each) => each.name === name);
      const placed = attribute('row') && attribute('col');
      if (inGrid && !placed)
        reject(
          'A node in a grid is placed by its row and col, whole numbers from 0, as <Node row={i} col={j}>: give it both.',
          tag.start
        );
      if (!inGrid && (attribute('row') || attribute('col')))
        reject(
          'row and col place a node in a grid: they go on the nodes a <Node layout="grid"> holds, as <Node row={i} col={j}>.',
          (attribute('row') ?? attribute('col'))?.start ?? tag.start
        );
      const layout = attribute('layout');
      const parts = Array.isArray(layout?.value) ? layout.value : [];
      const written = parts.length === 1 && parts[0].type === 'Text' && parts[0].data === 'grid';
      if (!written && parts.length === 1 && possibleValues(parts[0].expression).includes('grid'))
        reject(
          'A grid is written as layout="grid", not computed: its cells are placed by row and col, which only a grid takes.',
          layout?.start ?? tag.start
        );
      return walk(tag.children, written);
    }
    // A link takes no room, so a grid may hold links among the cells they join.
    if (inGrid && tag.type === 'InlineComponent' && tag.name === 'Link') return;
    if (inGrid) {
      const shown =
        (tag.type === 'Text' && tag.data?.trim()) ||
        tag.type === 'MustacheTag' ||
        tag.type === 'RenderTag' ||
        tag.type === 'InlineComponent';
      if (shown) {
        reject(
          'A grid holds only nodes placed by row and col: put this in one, as <Node row={i} col={j}>…</Node>.',
          (tag.start ?? 0) + (tag.data ? tag.data.length - tag.data.trimStart().length : 0)
        );
        return;
      }
    }
    for (const [key, child] of Object.entries(tag))
      if (key !== 'attributes' && key !== 'parent' && key !== 'metadata') walk(child, inGrid);
  };
  walk(markup, false);
  return problems;
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
 * on the tag's own line, so line numbers are unchanged. Gives every kind of node the view has: every
 * node is in a snippet or a layout, whose name is its kind.
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
  linkedTypes: ReadonlySet<string> = new Set(),
  /** Each view's type, by its name, and the domain, for the props a view binds to its value. */
  viewTypes: ReadonlyMap<string, string> = new Map(),
  domain?: DomainRegistry,
  /** Where the views added after the authored ones begin, as each union's (see unionViews). */
  authored = svelteSource.length
): {
  /** The props views bind to their values (see bound-props.server.ts). */
  bindings: Binding[];
  insertions: Insertion[];
  problems: InvalidSvelteSourceError[];
  kinds: DesignKind[];
  /** The <Node layout="free"> tags of each kind that has one, and the flow the first sets. */
  freeNodes: Map<string, unknown[]>;
  /** Each <Node> holding links, with the kind of the links written in it. */
  linkedNodes: { kind: string; node: unknown }[];
  flows: Map<string, 'x' | 'y'>;
  /** The kind of each <Node>, <Pointed>, and <Link> tag, by its line:column, for the editor to show. */
  tagKinds: Record<string, string[]>;
  /** Each <Node> tag's kind, by where it starts, for what a presentation leaves out. */
  nodeKinds: Map<number, string>;
  /**
   * The kinds of collections' nodes, by key: the axis their items run along, and the type their
   * {#each} goes over where a view gives it, else the variable it goes over.
   */
  collections: Map<string, { axis: 'x' | 'y'; type?: string; over?: string }>;
  /** The kinds nodes name, as kind="Header", with where each kind prop starts. */
  localKinds: { name: string; start: number }[];
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
  // A node naming its kind, as <Node kind="Header"> in Table, is of the kind Table.Header with the
  // nodes inside it, as a snippet Header inside Table would make it; the prop goes before Svelte.
  const kindProps: Insertion[] = [];
  const localKinds: { name: string; start: number }[] = [];
  const ownKind = (tag: Tag, view: string): string => {
    const attribute = tag.attributes?.find(({ name }) => name === 'kind') as
      | (Attribute & { end?: number })
      | undefined;
    if (!attribute) return view;
    const start = attribute.start ?? tag.start ?? 0;
    kindProps.push({ at: start, text: '', remove: (attribute.end ?? start) - start });
    const [part] = Array.isArray(attribute.value) ? attribute.value : [];
    const name = Array.isArray(attribute.value) && attribute.value.length === 1 ? part : undefined;
    if (name?.type !== 'Text') {
      reject(
        'A <Node>\'s kind is written as it is, not computed, as kind="Header": every kind is known before the view runs.',
        'view_kinds',
        start
      );
      return view;
    }
    if (!/^[A-Z][A-Za-z0-9]*$/u.test(name.data ?? '')) {
      reject(
        `kind="${name.data}" is no kind: a kind is named in one capitalised word saying what the node is, as kind="Header", never how it looks.`,
        'view_kinds',
        start
      );
      return view;
    }
    if (paths.has(name.data ?? '')) {
      reject(
        `kind="${name.data}" has the name of a view or a layout, which is its kind too: rename one.`,
        'view_kinds',
        start
      );
      return view;
    }
    if (view === 'root') {
      reject(
        `A <Node> outside any view or layout has no kind to name ${name.data} within.`,
        'view_kinds',
        start
      );
      return view;
    }
    localKinds.push({ name: name.data ?? '', start });
    return `${view}.${name.data}`;
  };
  // A look written as an expression of a view's value, as stroke={this.visited}, is bound to it:
  // the prop is renamed __bound_stroke for the node, which maps the value to an option by the
  // design (see library/node/bound.ts), and the values it can take go with it.
  const bindings: Binding[] = [];
  const boundProps: Insertion[] = [];
  const domains = new Map<number, Record<string, unknown>>();
  // The names a bound expression reads in a view: this, and what {#each} and {@const} declare.
  const scopeIn = (view: string, names: Scope): Scope | undefined => {
    const thisType = viewTypes.get(view.split('.')[0]);
    return thisType === undefined ? undefined : new Map([[viewThis, thisType], ...names]);
  };
  const bind = (tag: Tag, kind: string, names: Scope): Attribute[] => {
    const attributes = tag.attributes ?? [];
    const scope = scopeIn(kind, names);
    if (tag.name !== 'Node' || scope === undefined) return attributes;
    return attributes.filter((attribute) => {
      const [part] = Array.isArray(attribute.value) ? attribute.value : [];
      const expression = part?.type === 'MustacheTag' ? part.expression : undefined;
      const name = attribute.name ?? '';
      const length = lengthProps.has(name);
      if (!(bindableProps.has(name) || length) || !expression) return true;
      const prop = name;
      const start = attribute.start ?? tag.start ?? 0;
      const written = svelteSource
        .slice(expression.start ?? 0, expression.end ?? 0)
        .replaceAll(viewThis, 'this');
      const found = (length ? boundLengthDomain : boundDomain)(
        prop,
        expression,
        written,
        scope,
        domain
      );
      if ('problem' in found) {
        reject(found.problem, 'bound_prop', start);
        return false;
      }
      // A node sized by its value is that length exactly, so nothing inside may make it larger.
      const holds = (tag.children ?? []).some(
        (child) => child.type !== 'Comment' && !(child.type === 'Text' && !child.data?.trim())
      );
      if (length && holds)
        reject(
          `<Node ${prop}={${written}}> holds what it is sized by: a node sized by its value holds nothing, so 0 draws as nothing and 1 as one unit. Put the label beside it, as <Node layout="column"><Node kind="Length" ${prop}={${written}} /><Node value={${written}} /></Node>.`,
          'bound_prop',
          start
        );
      const other = bindings.find((binding) => binding.kind === kind && binding.prop === prop);
      // Lengths of one kind share a unit, whatever their ranges: the unit starts from the widest.
      if (other && length) {
        const values = [...other.domain.values, ...found.values] as number[];
        other.domain = { values: [Math.min(...values), Math.max(...values)], ordered: true };
      } else if (other && JSON.stringify(other.domain) !== JSON.stringify(found))
        reject(
          `${kind} binds ${prop} to values of two kinds: one kind of node takes one option per value, so give the other node a kind of its own, as kind="Visited".`,
          'bound_prop',
          start
        );
      else if (!other) bindings.push({ kind, prop, domain: found });
      boundProps.push({ at: start, text: '__bound_' });
      domains.set(tag.start ?? 0, { ...domains.get(tag.start ?? 0), [prop]: found });
      return false;
    });
  };
  // Each <Link> belongs to the nearest <Node> around it, which then lays out with links. Text
  // belongs inside a node, where it can be selected; a view may also write it beside its nodes.
  // `page`: in the root or a part of the page, rather than in a view.
  // `names`: what {#each} blocks and {@const} tags around declare, with their types (see Scope).
  const walk = (
    value: unknown,
    around: { links: boolean } | undefined,
    inNode: boolean,
    view: string,
    page: boolean,
    names: Map<string, string>
  ): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const part of value) walk(part, around, inNode, view, page, names);
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
          'A view draws only its value, so place <Listing /> outside views, in a layout.',
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
        'A layout is drawn by its tag, as <Title />, so the kinds of the nodes it draws are known before the view runs.',
        'view_markup',
        tag.start
      );
      return;
    }
    // A view whose links its nodes leave out joins the children of the node it is rendered in.
    const callee = tag.type === 'RenderTag' ? tag.expression?.callee : undefined;
    if (around && callee && linkedTypes.has((callee as { name?: string }).name ?? ''))
      around.links = true;
    // A drawing, written <Svg>, holds shapes the page draws as they are (see drawings).
    if (
      tag.type === 'Element' &&
      tag.name === 'svg' &&
      tag.attributes?.some((attribute) => attribute.name === drawingMarker)
    ) {
      if (!inNode)
        reject(
          'A drawing is part of a node, which gives it its place, size and colour: put it in one, as <Node><Svg viewBox="0 0 24 24">…</Svg></Node>.',
          'view_markup',
          tag.start
        );
      for (const { message, start } of drawingProblems(tag as never))
        reject(message, 'view_markup', start);
      return;
    }
    // The wrapper a union's added view draws its member's view in (see unionViews) draws nothing.
    if (
      tag.type === 'InlineComponent' &&
      tag.name === 'SverlinUnion' &&
      (tag.start ?? 0) >= authored
    ) {
      walk(tag.children, around, inNode, view, page, names);
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
          ? `<${tag.name}> is not allowed: draw everything with <Node> and <Link>, in views and layouts, giving a node a kind of its own where it needs one, as <Node kind="Caption">…</Node>, and the design gives each kind its look${/^[A-Z]/u.test(tag.name ?? '') ? `; to draw a layout here, declare it, <Layout name="${tag.name}">…</Layout>` : ''}.`
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
    if (library && tag.name === 'Pointed' && view.includes('.')) {
      reject(
        "A <Pointed> is written in its pointer view itself, not in a snippet or a node of a kind of its own inside it, as the view's kind is the pointer's.",
        'view_markup',
        tag.start
      );
      return;
    }
    if (library && tag.start !== undefined) {
      const kind = tag.name === 'Node' ? ownKind(tag, view) : view;
      // A caption token's node carries the place it names (see captionTokens in layout-tags).
      const reserved = tag.attributes?.find(
        ({ name }) => name?.startsWith('__') && !['__code', '__math', '__mathText'].includes(name)
      );
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
          bind(tag, kind, names),
          tag.start,
          source,
          problems,
          view
        );
      const entry = { start: tag.start, name: tag.name as string, links: false, view: kind, tag };
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
          'A <Link> with no from starts at the element its view draws, so it belongs in a view of an element, as <Link to={this.next} /> in <View of="ListNode" name="NodeBox">; elsewhere, give it from={…}.',
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
      walk(tag.children, tag.name === 'Node' ? entry : around, true, kind, page, names);
      return;
    }
    // What a layout holds is the page's top level, and a node written there is of the layout's kind.
    const layout = view === 'root' ? layoutNameOf(tag) : undefined;
    if (layout !== undefined) {
      walk(tag.children, around, inNode, layout, page, names);
      return;
    }
    const scope = domain && scopeIn(view, names);
    const typed = (node: unknown) => scope && domain && typeOfPath(node as never, scope, domain);
    // An {#each} item in a view has its collection's element type, its index the position type.
    if (tag.type === 'EachBlock' && scope && domain) {
      const inner = eachScope(tag, scope, typed, domain, { index: true });
      inner.delete(viewThis);
      for (const [key, child] of Object.entries(tag))
        if (key !== 'children' && key !== 'parent' && key !== 'metadata')
          walk(child, around, inNode, view, page, names);
      walk(tag.children, around, inNode, view, page, inner);
      return;
    }
    // A test of which member a union holds, read inside in a branch, would meet the member it kept
    // out when every branch is measured; each member's own view draws it instead.
    if (tag.type === 'IfBlock' && scope && domain) {
      const found = memberTestRead(tag as never, scope, domain);
      if (found) {
        const text = (node: { start?: number; end?: number } | undefined) =>
          svelteSource.slice(node?.start ?? 0, node?.end ?? 0).replaceAll(viewThis, 'this');
        const tested = text(found.tested as never);
        const views = found.members.map((member) => `<View of="${member}" name="…">…</View>`);
        reject(
          `{#if ${text(tag.expression as never)}} tests which member ${tested} holds and reads inside it: give each member its own view, as ${views.slice(0, -1).join(', ')} and ${views.at(-1)}, and write {${tested}}, which draws the one it holds.`,
          'view_component',
          tag.start
        );
      }
    }
    // A {@const} name of a path's value has that path's type, for the nodes after it.
    if (tag.type === 'ConstTag' && scope) {
      const assigned = (tag as { expression?: { left?: Tag; right?: unknown } }).expression;
      const type = typed(assigned?.right);
      if (assigned?.left?.type === 'Identifier' && assigned.left.name && type)
        names.set(assigned.left.name, type);
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
          snippet ? page && isPart(tag) : page,
          snippet ? new Map() : names
        );
  };
  if (ast.css)
    reject(
      'Views cannot have a <style>: the design gives each kind of node its look.',
      'view_style',
      ast.css.start
    );
  walk(ast.html, undefined, false, 'root', true, new Map());
  problems.push(...gridProblems(ast.html, source));
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
    if (has('__code')) return 'code';
    if (has('__math')) return 'text';
    const children = (tag.children ?? []).filter(
      (child) => !(child.type === 'Text' && !child.data?.trim())
    );
    if (has('layout') || links || (children.length === 1 && children[0].type === 'EachBlock'))
      return 'container';
    // A bare icon, <Node icon />, draws the one icon its kind chooses.
    if (attributes.some((attribute) => attribute.name === 'icon' && attribute.value === true))
      return 'icon';
    // A node drawing only an icon stands beside other content, as a word does, so it starts unboxed.
    if (has('icon') && !has('value') && !children.length) return 'text';
    if (vertices.has(entry.start)) return 'vertex';
    // A node sized by its value holds nothing (see boundLength): it is a bar.
    if ((has('height') || has('width')) && !has('value') && !children.length) return 'bar';
    if (has('value') || !children.length || isField(entry)) return 'value';
    return 'text';
  };
  // The nodes a free layout's links join, its children inside its blocks: a graph's vertices or a
  // machine's states, which start as circles, so a link meets an edge rather than run into text.
  const vertices = new Set<number>();
  const childNodes = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(childNodes);
    const part = value as Tag;
    if (part.type === 'InlineComponent') {
      if (part.name === 'Node' && part.start !== undefined) vertices.add(part.start);
      return;
    }
    for (const [key, child] of Object.entries(part))
      if (key === 'children' || key === 'else' || key === 'body' || key === 'consequent')
        childNodes(child);
  };
  // A kind several roles share takes the plainest look, and every prop any of them has.
  const plainest: KindRole[] = [
    'container',
    'icon',
    'text',
    'code',
    'bar',
    'value',
    'vertex',
    'pointed',
    'link'
  ];
  const kinds = new Map<string, KindRole>();
  // A kind with a node laid out freely has that layout's look among its props, and the structure
  // its data makes (see structure.server.ts), read from those nodes and the flow they set.
  const freeNodes = new Map<string, Tag[]>();
  const flows = new Map<string, 'x' | 'y'>();
  const laidOutFreely = ({ name, tag }: Entry) =>
    name === 'Node' &&
    (tag.attributes ?? []).some(({ name: prop, value }) => {
      if (prop !== 'layout' || !Array.isArray(value) || value.length !== 1) return false;
      const [part] = value;
      return part.type === 'Text'
        ? part.data === 'free'
        : possibleValues(part.expression).includes('free');
    });
  const tagKinds: Record<string, string[]> = {};
  const nodeKinds = new Map<number, string>();
  const collections = new Map<string, { axis: 'x' | 'y'; type?: string; over?: string }>();
  const apart = (of: KindRole) => (of === 'pointed' || of === 'link' ? of : 'node');
  for (const entry of tags) if (entry.links && laidOutFreely(entry)) childNodes(entry.tag.children);
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
        `${key} is the kind of a <${role === 'pointed' ? 'Pointed' : role === 'link' ? 'Link' : 'Node'}> and of another kind of tag: rename the view, layout, or kind called ${key.slice(key.lastIndexOf('.') + 1)}.`,
        'view_kinds',
        entry.start
      );
    kinds.set(key, known && plainest.indexOf(known) < plainest.indexOf(role) ? known : role);
    if (laidOutFreely(entry)) {
      freeNodes.set(key, [...(freeNodes.get(key) ?? []), entry.tag]);
      const flow = (entry.tag.attributes ?? []).find(({ name }) => name === 'flow')?.value;
      const [part] = Array.isArray(flow) ? flow : [];
      if (!flows.has(key) && part?.type === 'Text' && (part.data === 'x' || part.data === 'y'))
        flows.set(key, part.data);
    }
    if (entry.name === 'Node') nodeKinds.set(entry.start, key);
    // A node holding one {#each} is a collection: its kind's starters depend on its axis and on
    // whether what it goes over keeps one length (see starterLook).
    const items = (entry.tag.children ?? []).filter(
      (child) =>
        !(child.type === 'Text' && !child.data?.trim()) &&
        !(child.type === 'InlineComponent' && child.name === 'Link')
    );
    if (entry.name === 'Node' && items.length === 1 && items[0].type === 'EachBlock') {
      const over = items[0].expression;
      const scope = domain && scopeIn(entry.view, new Map());
      const layout = (entry.tag.attributes ?? []).find(({ name }) => name === 'layout')?.value;
      const [part] = Array.isArray(layout) ? layout : [];
      collections.set(key, {
        axis: part?.type === 'Text' && part.data === 'column' ? 'y' : 'x',
        ...(scope && domain && over ? { type: typeOfPath(over as never, scope, domain) } : {}),
        ...(over?.type === 'Identifier' && over.name ? { over: over.name } : {})
      });
    }
    const { line, column } = sourcePosition(source, entry.start);
    tagKinds[`${line}:${column + 1}`] = [key];
  }
  const insertions = tags.map((entry): Insertion => {
    const { start, name, links, view } = entry;
    const { line, column } = sourcePosition(source, start);
    const root = roots.get(start);
    const type = valueTypes.get(start);
    const ref = name === 'Pointed' ? '' : ` __ref="${line}:${column + 1}"`;
    const bound = domains.get(start);
    return {
      at: start + name.length + 1,
      text: ` __view="${view}"${ref}${bound ? ` __domains={${JSON.stringify(bound)}}` : ''}${links ? ' __links' : ''}${isField(entry) ? ' __field' : ''}${root ? ` __component="${root}"` : ''}${type ? ` __type="${type}"` : ''}`
    };
  });
  // A kind arranging no children has no gap, align, or justify to bind.
  for (const { kind, prop } of bindings) {
    const role = kinds.get(kind);
    if (valueOnlyProps.has(prop)) {
      if (role === 'container')
        reject(
          `${kind} arranges children, and an ${prop} is drawn in a node of a value or of text: put it in a node of its own, as <Node kind="Mark" ${prop}={…} />.`,
          'bound_prop',
          tags.find((entry) => entry.view === kind)?.start
        );
      continue;
    }
    if (role && !lengthProps.has(prop) && !roleProps[role].includes(prop as DesignProp))
      reject(
        `${kind} has no ${prop} to bind: it is a look only of a node arranging children, with a layout.`,
        'bound_prop',
        tags.find((entry) => entry.view === kind)?.start
      );
  }
  // A kind sizes an axis by its value in every node of it or in none: the others would need the
  // width or height variable the bound ones have not.
  for (const { kind, prop } of bindings.filter(({ prop }) => lengthProps.has(prop))) {
    const unbound = tags.find(
      (entry) => entry.view === kind && entry.name === 'Node' && !domains.get(entry.start)?.[prop]
    );
    if (unbound)
      reject(
        `${kind} binds ${prop} in one node and not another: one kind of node either sizes by its value or not, so give the node sized by its value a kind of its own, as <Node kind="Length" ${prop}={…} />.`,
        'bound_prop',
        unbound.start
      );
  }
  for (const start of listings) {
    const { line, column } = sourcePosition(source, start);
    insertions.push({ at: start + 'Listing'.length + 1, text: ` __ref="${line}:${column + 1}"` });
  }
  return {
    listing: listings.length > 0,
    ...(listings.length ? { listingAt: listings[0] } : {}),
    insertions: [...insertions, ...kindProps, ...boundProps],
    bindings,
    localKinds,
    problems,
    kinds: [...kinds].map(([key, role]) => ({ key, role })),
    freeNodes,
    linkedNodes: tags.flatMap(({ name, links, view, tag }) =>
      name === 'Node' && links ? [{ kind: kindKey(view, 'Link'), node: tag }] : []
    ),
    flows,
    tagKinds,
    nodeKinds,
    collections
  };
}

/**
 * Why a label types no view, completing "<View> takes …": no label has its name, or the case never
 * runs its code. A view of an expression label draws its operands and result; one of a block or
 * statement label, the variables in scope when its span ends.
 */
function labelViewProblem(type: string, labels: readonly Label[] | undefined): string {
  const written = asWritten(type);
  const label = labels?.find(({ full }) => `@${full}` === written);
  const expression = 'label an expression, as @compare[a > b], whose operands and result it draws';
  if (labels && !label) {
    const names = labels.map(({ full }) => `@${full}`);
    return `${written}, which no label is named: a label inside another is named by both, as @pair.sum for @sum inside @pair; the labels are ${names.slice(0, 12).join(', ')}${names.length > 12 ? ', …' : ''}.`;
  }
  const marksExpression =
    label &&
    label.nodes.length === 1 &&
    (!label.statement || label.nodes[0].type === 'ExpressionStatement');
  if (label && !marksExpression)
    return `${written}, whose code no step of the case runs, so it has no span to draw: label code the case reaches.`;
  return `${written}, whose expression no step of the case evaluates, so there is nothing to draw: ${expression} that the case reaches.`;
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
  source: string,
  labels?: readonly Label[]
): ComponentSignatures {
  const signatures: ComponentSignatures = {};
  for (const { name, start, type, node } of found) {
    const at = { code: 'view_component', start: sourcePosition(source, start) };
    if (!definesType(domain, type))
      throw new InvalidSvelteSourceError(
        isLabelKey(type)
          ? `${name} takes ${labelViewProblem(type, labels)}`
          : `${name}'s type ${type} is not a type; define it in the domain block, or use one that is.`,
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

async function bundle(
  component: string,
  serverComponent: string,
  states: string,
  atoms: string,
  components: string
) {
  try {
    return await bundleComponent(component, serverComponent, states, atoms, components);
  } catch (cause) {
    // Failures located in the authored component, such as a blocked require(), are source errors.
    const authored = (cause as Partial<BuildFailure>).errors?.find((error) =>
      /^component(?:-server)?:Main\.svelte$/u.test(error.location?.file ?? '')
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
  // The server's entry, laying every step out in an isolate (see layout.server.ts).
  layout: (path) =>
    runtime(path) ||
    [
      'virtual:component-server',
      'virtual:trace',
      'virtual:atoms',
      'virtual:components',
      'sverlin'
    ].includes(path),
  component: (path) => runtime(path) || path === 'sverlin',
  // The constraint layout engine and the grid router wires take (see library/node/wires.ts), by
  // their own modules, which need none of WebCola's d3 adaptor.
  library: (path) => runtime(path) || /^\.\.?\//u.test(path) || webcolaModules.includes(path)
};
// The same, compiled to render strings.
allowedImports['component-server'] = allowedImports.component;
allowedImports['library-server'] = allowedImports.library;

// Svelte's own entry for rendering strings, which a browser bundle would otherwise not resolve to.
const svelteServerIndex = posix.join(
  posix.dirname(createRequire(import.meta.url).resolve('svelte/package.json')),
  'src/index-server.js'
);

const webcolaModules = [
  'webcola/dist/src/layout',
  'webcola/dist/src/gridrouter',
  'webcola/dist/src/rectangle'
];

function sandboxModules(
  component: string,
  serverComponent: string,
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
        if (args.path === 'virtual:component-server')
          return { path: 'Main.svelte', namespace: 'component-server' };
        const server = args.namespace.endsWith('-server') || args.namespace === 'layout';
        if (server && args.path === 'svelte') return { path: svelteServerIndex };
        if (server && args.path === 'sverlin')
          return { path: 'index.ts', namespace: 'library-server' };
        if (args.path === 'virtual:trace') return { path: 'states.json', namespace: 'trace' };
        if (args.path === 'virtual:atoms') return { path: 'atoms.json', namespace: 'atoms' };
        if (args.path === 'virtual:components')
          return { path: 'components.json', namespace: 'components' };
        if (args.path === 'sverlin') return { path: 'index.ts', namespace: 'library' };
        if (
          (args.namespace === 'library' || args.namespace === 'library-server') &&
          !runtime(args.path) &&
          /^\.\.?\//u.test(args.path)
        ) {
          const path = libraryPath(posix.join(posix.dirname(args.importer), args.path));
          return path
            ? { path, namespace: args.namespace }
            : { errors: [{ text: `Unknown library module ${args.path}.` }] };
        }
        return undefined;
      });
      // Svelte's string renderer falls back to Node's crypto only where the page has none; a page
      // always has it, so the import stays as written and never runs.
      plugin.onResolve({ filter: /^node:crypto$/ }, () => ({
        path: 'node:crypto',
        external: true
      }));
      plugin.onResolve({ filter: /^virtual:entry$/ }, () => ({
        path: 'entry.ts',
        namespace: 'entry'
      }));
      plugin.onResolve({ filter: /^virtual:layout$/ }, () => ({
        path: 'layout.ts',
        namespace: 'layout'
      }));
      plugin.onLoad({ filter: /.*/, namespace: 'layout' }, () => ({
        contents: layoutSource,
        loader: 'ts',
        resolveDir: process.cwd()
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
      plugin.onLoad({ filter: /.*/, namespace: 'component-server' }, () => ({
        contents: serverComponent,
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
        ...loadLibraryModule(args.path, 'client'),
        resolveDir: process.cwd()
      }));
      plugin.onLoad({ filter: /.*/, namespace: 'library-server' }, (args) => ({
        ...loadLibraryModule(args.path, 'server'),
        resolveDir: process.cwd()
      }));
    }
  };
}

/**
 * The page's bundle, and the server's, which lays every step out (see layout.server.ts): the same
 * steps, view and library, compiled to render strings.
 */
function bundleComponent(
  component: string,
  serverComponent: string,
  states: string,
  atoms: string,
  components: string
) {
  return build({
    entryPoints: ['virtual:entry', 'virtual:layout'],
    outdir: 'out',
    entryNames: '[name]',
    plugins: [sandboxModules(component, serverComponent, states, atoms, components)],
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
 * The paint a value starts with, its own rather than its kind's, where it is a link's label: no
 * border, and the stage's white behind it, so the line breaks round it rather than crossing it.
 */
const linkLabelPaint: Readonly<Record<string, string>> = { fill: 'white', stroke: 'none' };

/** The paint a value starts with where it is a card's field: none, the card being its box. */
const cardFieldPaint: Readonly<Record<string, string>> = { fill: 'none', stroke: 'none' };

/** A card's starting look: the one box around its parts, which sit close together. */
const cardLook: Readonly<Record<string, string | number>> = {
  fill: 'white',
  stroke: 'neutral-300',
  strokeWidth: 1.5,
  radius: 8,
  padding: 0.375,
  gap: 0.25
};

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
  /** Whether it is a link's label, drawn over the link's line. */
  inLink: boolean;
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
  const walk = (
    node: unknown,
    inNode: boolean,
    within: string,
    inView: boolean,
    inLink = false
  ): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node))
      return node.forEach((child) => walk(child, inNode, within, inView, inLink));
    const part = node as Part;
    if (part.type === 'SnippetBlock') {
      const name = (part.expression as Part | undefined)?.name ?? '';
      const view = inView || views.has(name);
      walk(part.children, false, view ? (paths.get(name) ?? name) : '', view, inLink);
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
            ? `@${source.slice(argument.start, argument.end).replaceAll(viewThis, 'this')}`
            : undefined;
        sites.push({
          name,
          start: part.start ?? 0,
          callee: { start: callee?.start ?? 0, end: callee?.end ?? 0 },
          inNode,
          ...(written ? { at: written } : {}),
          label,
          within,
          inLink
        });
      }
      return;
    }
    const inside = inNode || (part.type === 'InlineComponent' && part.name === 'Node');
    const link = inLink || (part.type === 'InlineComponent' && part.name === 'Link');
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent') walk(child, inside, within, inView, link);
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
      return index !== undefined && isPool(domain, index);
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
        // A span's record of a block label has no value of its own.
        ...(result ? { value: result } : {})
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

/** A <OneOf>'s next branch, an {:else if when(…)} after a <When> as rewritten, on a key by now. */
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
 * Each <When>'s chain of branches, a <OneOf>'s as rewritten, by where it starts, its keys in order; and where each
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

/**
 * Where each {#if} or {:else if} whose test is one key alone starts its test, as {#if @insert.swap}
 * for a label read or <When of="@insert.swap"> for its runs.
 */
function ifTestsOf(markup: unknown, is: (name: string) => boolean): Set<number> {
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
      is(part.expression.name ?? '')
    )
      found.add(part.expression.start ?? -1);
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent' && key !== 'metadata' && typeof child === 'object') walk(child);
  };
  walk(markup);
  return found;
}

/**
 * Where each <Link> in a snippet starts that no <Node> in it holds and that has a from, as an edge's
 * or an operator's view draws. One with no from leaves the element the view draws, as a node's next
 * field, and is laid out by the free layout around the nodes (see Link.svelte's data-sv-hoist), not
 * by the node the view is rendered in.
 */
function outerLinks(snippet: unknown): number[] {
  const found: number[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const part = node as {
      type?: string;
      name?: string;
      start?: number;
      attributes?: { name?: string }[];
    };
    if (part.type === 'InlineComponent' && part.name === 'Node') return;
    if (
      part.type === 'InlineComponent' &&
      part.name === 'Link' &&
      part.attributes?.some((attribute) => attribute.name === 'from')
    )
      found.push(part.start ?? 0);
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
  operators: ReadonlySet<string>,
  /** The queries, whose rows a label's view draws, and those of them in groups of rows. */
  queries: {
    lists: ReadonlySet<string>;
    grouped: ReadonlySet<string>;
    /** The names scenes stepping over a list give its rows, and those of lists of groups. */
    rows?: ReadonlySet<string>;
    groups?: ReadonlySet<string>;
  } = {
    lists: new Set(),
    grouped: new Set()
  }
): {
  name: string;
  start: number;
  filter?: string;
  fromHistory?: boolean;
  argued: boolean;
  inView: boolean;
}[] {
  const found: ReturnType<typeof operatorRendersOf> = [];
  const walk = (
    node: unknown,
    inView: boolean,
    items: ReadonlySet<string>,
    groups: ReadonlySet<string> = new Set()
  ): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => walk(child, inView, items, groups));
    const part = node as {
      type?: string;
      start?: number;
      expression?: {
        type?: string;
        name?: string;
        callee?: { name?: string };
        arguments?: unknown[];
        object?: { type?: string; name?: string };
        property?: { name?: string };
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
    // A query's rows are records, each drawn by its label's view, as are a group's rows.
    const each = part.type === 'EachBlock' ? part.expression : undefined;
    const listed =
      part.context?.type === 'Identifier' &&
      ((each?.type === 'Identifier' &&
        queries.lists.has(each.name ?? '') &&
        !queries.grouped.has(each.name ?? '')) ||
        (each?.type === 'MemberExpression' &&
          each.object?.type === 'Identifier' &&
          groups.has(each.object.name ?? '') &&
          each.property?.name === 'rows'))
        ? part.context.name
        : undefined;
    const group =
      part.context?.type === 'Identifier' &&
      each?.type === 'Identifier' &&
      queries.grouped.has(each.name ?? '')
        ? part.context.name
        : undefined;
    const inner =
      item || listed
        ? new Set([...items, ...[item, listed].filter((x) => x !== undefined)])
        : items;
    const innerGroups = group ? new Set([...groups, group]) : groups;
    const within = inView || (part.type === 'SnippetBlock' && !isPart(part));
    for (const [key, child] of Object.entries(part))
      if (key !== 'parent') walk(child, within, inner, innerGroups);
  };
  walk(markup, false, new Set(queries.rows), new Set(queries.groups));
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

/** A label's runs, and how many of them change what the view draws. */
export type LabelRuns = { runs: number; drawn: number };

/**
 * For each label, its runs in the steps given (paced at every label), and how many change what the
 * view draws: a variable it reads, a label's value it renders, an application of an operator it
 * renders at a label, or a label it draws for in a <When>.
 */
function labelRuns(
  steps: readonly MasterStep[],
  drawn: {
    state: ReadonlySet<string>;
    labels: ReadonlySet<string>;
    operators: ReadonlySet<string>;
    during: ReadonlySet<string>;
  }
): Record<string, LabelRuns> {
  const runs: Record<string, LabelRuns> = {};
  for (const step of steps) {
    const label = /^@(.+)#\d+$/u.exec(step.name ?? '')?.[1];
    if (!label) continue;
    const count = (runs[label] ??= { runs: 0, drawn: 0 });
    count.runs++;
    const before = step.before?.state ?? {};
    const changes =
      [...drawn.state].some(
        (name) => JSON.stringify(before[name]) !== JSON.stringify(step.state[name])
      ) ||
      Object.keys(step.labelled ?? {}).some((name) => drawn.labels.has(name)) ||
      Object.keys(step.applied ?? {}).some((name) => drawn.operators.has(name)) ||
      (step.inside ?? []).some((name) => drawn.during.has(name));
    if (changes) count.drawn++;
  }
  return runs;
}

/** What a <When> names, as its `of` is written. */
const whenText = (target: string) =>
  target.startsWith('#') ? `:${target.slice(1)}` : `@${target}`;

/**
 * The pool each reference refers into, by the path of the value with its indices as [], as
 * `queue[]` into `vertices`, gathered over the steps given (see slotInsertions).
 */
function referencesOf(steps: readonly MasterStep[], domain: DomainRegistry): Map<string, string> {
  const references = new Map<string, string>();
  for (const step of steps)
    for (const [path, target] of Object.entries(step.targets ?? {}))
      if (isPool(domain, step.types?.[target]))
        references.set(path.replace(/\[\d+\]/gu, '[]'), target);
  return references;
}

/** Each variable's type, as the steps record it, the first wherever one is a union's member. */
function variableTypes(steps: readonly MasterStep[]): Map<string, string> {
  const types = new Map<string, string>();
  for (const step of steps)
    for (const [path, type] of Object.entries(step.types ?? {}))
      if (/^[A-Za-z_$][\w$]*$/u.test(path) && !types.has(path)) types.set(path, type);
  return types;
}

/** The collections positions of each position type point into, as the steps record them. */
function pointedInto(
  steps: readonly MasterStep[],
  domain: DomainRegistry
): Map<string, Set<string>> {
  const pointed = new Map<string, Set<string>>();
  for (const step of steps)
    for (const [path, target] of Object.entries(step.targets ?? {})) {
      const type = step.types?.[path];
      if (type && !isPool(domain, step.types?.[target]))
        pointed.set(type, (pointed.get(type) ?? new Set()).add(target));
    }
  return pointed;
}
