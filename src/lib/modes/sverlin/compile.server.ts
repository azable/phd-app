/** Compile one untrusted Svelte component without executing its code on the server. */

import { posix } from 'node:path';

import { build, type BuildFailure, type Plugin } from 'esbuild';
import { compile, parse } from 'svelte/compiler';

import entrySource from './assembly/entry.ts?raw';
import preludeSource from './assembly/prelude.ts?raw';
import {
  AlgorithmError,
  componentChoices,
  declaredNames,
  designChoices,
  interpretAlgorithm,
  interpretDesignDraws,
  type DesignVariant,
  interpretDomain,
  interpretInput,
  type BlockKind,
  type DesignChoices,
  type DesignDraw,
  type MasterStep,
  type TraceState
} from './algorithm/interpret.server';
import type { AtomRegistry } from './algorithm/atoms.server';
import {
  definesType,
  noDomain,
  typeNames,
  type DomainRegistry
} from './algorithm/structures.server';
import {
  componentProbes,
  findComponents,
  probeMarkup,
  pointerCalls,
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
import { libraryDefaults } from './library/node/defaults';
import { forms } from './library/node/forms';
import {
  alignments,
  frameRatios,
  justifications,
  minSizes,
  namedSizes,
  radii,
  spacings,
  strokeWidths
} from './library/node/scales';
import type { FrameSettings, NodeShape } from './library/node/props';
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
  /** Design values drawn for this presentation. */
  parameters: TraceState;
  /** Each draw of the design block, with its span in the source rather than the block. */
  draws: DesignDraw[];
};

type Block = { body: string; offset: number };

/** Seed-independent result of checking, interpreting, and compiling one component. */
export type PreparedComponent = {
  source: string;
  component: string;
  master: MasterStep[];
  atoms: AtomRegistry;
  /** The view's typed components, each after those it renders, as the page enumerates them. */
  components: ComponentProbe[];
  /** Values the root reads for placement, measured with every value of their types. */
  placements: Placement[];
  design?: Block;
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
  return interpretBlock(source, blocks.algorithm, (body) =>
    interpretAlgorithm(body, input, domain)
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
    const { svelteSource, blocks } = extractBlocks(source);
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
        'Views cannot have their own <script>: input, algorithm, and design values, step, seed, and the library components are already in scope. Compute in markup, using {@const} inside a block or component for reuse.',
        { code: 'view_script', start: sourcePosition(source, authoredScript.start) }
      );
    // The view is checked before any block runs, so its problems are reported with theirs.
    const choices = blocks.design
      ? interpretBlock(source, blocks.design, (body) => designChoices(body))
      : {};
    const { insertions, problems } = withNodeRefs(
      svelteSource,
      ast,
      source,
      choices,
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
        'Add a <script lang="sverlin"> algorithm block whose yield statements mark the steps, such as yield;',
        { code: 'missing_algorithm' }
      );
    const domain = blocks.domain
      ? interpretBlock(source, blocks.domain, (body) => interpretDomain(body))
      : noDomain;
    const { atoms } = domain;
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
    const declared = (block: Block | undefined, kind: 'input' | 'algorithm' | 'design') =>
      block ? interpretBlock(source, block, (body) => declaredNames(body, kind, domain)) : [];
    const stateNames = [
      ...new Set([...declared(blocks.input, 'input'), ...declared(blocks.algorithm, 'algorithm')])
    ];
    const designNames = declared(blocks.design, 'design');
    const clash = designNames.find((name) => stateNames.includes(name));
    if (clash)
      throw new InvalidSvelteSourceError(
        `"${clash}" is defined in the design block and in the input or algorithm block.`,
        at(clash, blocks.design)
      );
    const props = [...stateNames, ...designNames];
    // A design value named after a type may choose among that type's views, as in
    // const Int = IntDots;, so only other uses of a type's name are clashes.
    const componentChoice = blocks.design
      ? interpretBlock(source, blocks.design, (body) =>
          componentChoices(body, new Set(found.components.map(({ name }) => name)))
        )
      : {};
    const typeName = props.find(
      (name) => definesType(domain, name) && !Object.hasOwn(componentChoice, name)
    );
    if (typeName)
      throw new InvalidSvelteSourceError(
        `"${typeName}" names a type; choose another variable name.`,
        at(typeName, blocks.input, blocks.algorithm, blocks.design)
      );
    const library = props.find((name) => libraryNames.includes(name));
    if (library)
      throw new InvalidSvelteSourceError(
        `"${library}" names a library component; choose another variable name.`,
        at(library, blocks.input, blocks.algorithm, blocks.design)
      );
    const components = checkComponents(
      found.components,
      found.pointers,
      domain,
      stateNames,
      props,
      source
    );
    const views = viewsOf(components);
    for (const [name, { options, start }] of Object.entries(componentChoice)) {
      const named = definesType(domain, name);
      const type = named ? name : components[options[0]];
      const differs = options.find((option) => components[option] !== type);
      if (differs)
        throw new InvalidSvelteSourceError(
          named
            ? `${name} chooses ${differs}, which views ${components[differs]}; a design value named after a type chooses among that type's views${views[name] ? `, ${views[name].join(', ')}` : ''}.`
            : `${name} chooses between components that view different types: ${options[0]} views ${type} and ${differs} views ${components[differs]}. A choice is between views of one type.`,
          {
            code: 'component_choice',
            start: sourcePosition(source, (blocks.design as Block).offset + start)
          }
        );
    }
    // A type is rendered by name, as in {@render Int(value)}, through a snippet named after it or a
    // design value named after it that chooses among its views.
    const typeViews = Object.keys(componentChoice).filter((name) => definesType(domain, name));
    const undefinedType = renderedNames(ast.html).find(
      ({ name }) =>
        definesType(domain, name) && !typeViews.includes(name) && !Object.hasOwn(components, name)
    );
    if (undefinedType)
      throw new InvalidSvelteSourceError(
        `${undefinedType.name} is a type, and nothing draws it: choose its view in the design block, as in const ${undefinedType.name} = pick([${views[undefinedType.name]?.join(', ') || `${undefinedType.name}Text, ${undefinedType.name}Dots`}]);, or render one of its views by name.`,
        { code: 'view_component', start: sourcePosition(source, undefinedType.start) }
      );
    const input = blocks.input
      ? interpretBlock(source, blocks.input, (body) => interpretInput(body, domain))
      : { state: {}, types: {} };
    const master = interpretBlock(source, blocks.algorithm, (body) =>
      interpretAlgorithm(body, input, domain)
    );
    // Variables out of scope at some step: what the view draws from one is hidden there.
    const scoped = new Set(
      stateNames.filter((name) => master.some(({ state }) => !(name in state)))
    );
    if (viewProblems.length) throw InvalidSvelteSourceError.combine(viewProblems);
    const chosen = Object.fromEntries(
      Object.entries(componentChoice).map(([name, { options }]) => [name, options])
    );
    const viewNames = new Set([...Object.keys(components), ...Object.keys(chosen)]);
    // A pointer is a view with a <Pointed>, or a design value choosing among such views.
    const pointerViews = new Set(found.pointers);
    for (const [name, options] of Object.entries(chosen)) {
      const pointing = options.filter((option) => found.pointers.has(option));
      if (pointing.length && pointing.length < options.length)
        throw new InvalidSvelteSourceError(
          `${name} chooses between pointers and other views: ${pointing[0]} has a <Pointed> and ${options.find((option) => !found.pointers.has(option))} has none. A choice is between pointers, or between views drawn where they are rendered.`,
          {
            code: 'component_choice',
            start: sourcePosition(
              source,
              (blocks.design as Block).offset + componentChoice[name].start
            )
          }
        );
      if (pointing.length) pointerViews.add(name);
    }
    // A pointer's <Pointed> props, for a position, as code: a link it points at takes them.
    const paints = [...found.pointed].map(([name, { tag, parameter }]) => {
      const props = (tag as { attributes?: Attribute[] }).attributes?.flatMap((attribute) => {
        if (attribute.type !== 'Attribute' || !attribute.name) return [];
        const [part] = Array.isArray(attribute.value) ? attribute.value : [];
        const value =
          attribute.value === true
            ? 'true'
            : part?.type === 'Text'
              ? JSON.stringify((part as { data?: string }).data ?? '')
              : (part?.type === 'MustacheTag' || part?.type === 'ExpressionTag') &&
                  part.expression?.start !== undefined
                ? svelteSource.slice(part.expression.start, part.expression.end)
                : undefined;
        return value === undefined ? [] : [`${attribute.name}: ${value}`];
      });
      return `const __paint_${name} = (${parameter}: any) => ({ ${(props ?? []).join(', ')} });`;
    });
    const pointers = pointerCalls(
      ast.html,
      svelteSource,
      new Set(stateNames),
      new Map(
        [...pointerViews].map((name) => {
          const type = components[name] ?? components[chosen[name]?.[0] ?? ''];
          const paint = found.pointers.has(name)
            ? `__paint_${name}`
            : `(position: number) => (({ ${chosen[name].map((option) => `${option}: __paint_${option}`).join(', ')} }) as Record<string, (position: number) => object>)[__choice_${name}]?.(position) ?? {}`;
          // The scoped variables its view reads, or any view a design value chooses for it reads.
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
    const scopedReads = scopedReadsOf(ast.html, scoped);
    if (scopedReads.length)
      throw InvalidSvelteSourceError.combine(
        scopedReads.map(
          ({ name, start }) =>
            new InvalidSvelteSourceError(
              `The view reads ${name} itself, but ${name} is out of scope at some steps, where there is no value to show. Draw it through a view or a pointer, as in {@render Int(${name})}, which draw nothing where it is out of scope.`,
              { code: 'view_component', start: sourcePosition(source, start) }
            )
        )
      );
    const tagged = withInsertions(svelteSource, [
      ...insertions,
      ...pointers.removals,
      ...slotInsertions(
        ast.html,
        svelteSource,
        new Set(stateNames),
        new Set([...viewNames].filter((name) => !pointerViews.has(name))),
        new Set(Object.keys(components)),
        scoped
      )
    ]);
    const component = compile(
      withGeneratedScripts(
        `${tagged}${probeMarkup(components)}`,
        props,
        chosen,
        pointers.calls,
        paints
      ),
      { filename: 'Main.svelte', generate: 'client', css: 'injected', dev: false }
    ).js.code;
    const { probes, problems: probeProblems } = componentProbes(
      found.components,
      components,
      chosen,
      domain,
      master
    );
    const placements = rootPlacements(
      (ast.html?.children ?? []).filter(
        (node: { type?: string; expression?: { name?: string } }) =>
          !(node.type === 'SnippetBlock' && Object.hasOwn(components, node.expression?.name ?? ''))
      ),
      stateNames,
      viewNames,
      domain,
      master
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
    return {
      source,
      component,
      master,
      atoms,
      components: probes,
      placements,
      ...(blocks.design ? { design: blocks.design } : {})
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
 * Give the design's declarations their values, from the variant and the rest drawn from the seed,
 * and bundle the presentation with every step's state.
 */
export async function bundlePresentation(
  prepared: PreparedComponent,
  seed: number,
  variant: DesignVariant = {}
): Promise<SvelteBundle> {
  const { master } = prepared;
  const design = prepared.design;
  const { values: parameters, draws } = design
    ? interpretBlock(prepared.source, design, (body) =>
        interpretDesignDraws(
          body,
          seed,
          prepared.components.map(({ name }) => name),
          variant
        )
      )
    : { values: {}, draws: [] };
  const frame = located(() => frameSettings(parameters.frame), designAt(prepared, 'frame'));
  // Every presentation shows every master step until steps can be mapped to frames.
  const masterSteps = master.map((_, index) => index);
  // Each step's state carries its atomic types, the page frame, and the library defaults for the view,
  // under keys no variable can use; a variable out of scope at a step stands in hidden (__absent).
  const states = masterSteps.map((index) => {
    const standIn = standInsFor(master, index);
    return {
      ...standIn.state,
      ...master[index].state,
      ...parameters,
      __types: { ...standIn.types, ...master[index].types },
      __targets: { ...standIn.targets, ...master[index].targets },
      __absent: Object.keys(standIn.state),
      __identities: master[index].identities?.ids ?? {},
      __copies: master[index].identities?.copies ?? {},
      __refs: master[index].identities?.refs ?? {},
      __frame: frame,
      __defaults: libraryDefaults
    };
  });
  const result = await bundle(
    prepared.component,
    JSON.stringify(states),
    JSON.stringify(prepared.atoms),
    JSON.stringify({ components: prepared.components, placements: prepared.placements })
  );
  const output = result.outputFiles[0];
  if (output.contents.byteLength > maximumBundleBytes) {
    throw new InvalidSvelteSourceError('The compiled Svelte presentation is too large.');
  }
  return {
    javascript: output.text,
    labels: masterSteps.map((index) => `Step ${index + 1}`),
    // Identities say how values move between steps, not what a step shows.
    masterSignature: stepSignature(
      master.map(({ identities: _identities, ...step }) => JSON.stringify(step))
    ),
    masterSteps,
    parameters,
    draws: draws.map((draw) => ({
      ...draw,
      start: (design?.offset ?? 0) + draw.start,
      end: (design?.offset ?? 0) + draw.end
    }))
  };
}

const sverlinBlock =
  /<script\s+lang\s*=\s*(["'])sverlin\1(?:\s+(domain|input|design))?\s*>([\s\S]*?)<\/script\s*>/giu;

/** Remove the Sverlin blocks for Svelte, keeping every offset and line in place. */
function extractBlocks(source: string): {
  svelteSource: string;
  blocks: Partial<Record<BlockKind, Block>>;
} {
  const blocks: Partial<Record<BlockKind, Block>> = {};
  let svelteSource = source;
  for (const match of source.matchAll(sverlinBlock)) {
    const kind = (match[2] ?? 'algorithm') as BlockKind;
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
  return { svelteSource, blocks };
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
 * Give the script-free view its scripts: the library prelude and every recorded or design value,
 * plus step and seed, as props. Both share the first line so authored line numbers are unchanged.
 */
function withGeneratedScripts(
  source: string,
  props: readonly string[],
  choices: Record<string, string[]>,
  pointers: readonly string[],
  paints: readonly string[]
): string {
  // A design value that chooses a component arrives as the component's name, and the view uses
  // the component itself under the value's name.
  const names = [
    ...props.map((name) => (choices[name] ? `${name}: __choice_${name}` : name)),
    'step',
    'seed',
    '__probe'
  ].join(', ');
  const chosen = Object.entries(choices)
    .map(
      ([name, options]) =>
        `const ${name} = $derived(({ ${options.join(', ')} } as Record<string, any>)[__choice_${name}]);`
    )
    .join(' ');
  // The root's pointers are drawn around what they point at, from the start (see pointerCalls).
  const pointing = pointers.length
    ? `import { providePointers as __sverlinPointers } from 'sverlin'; ${paints.join(' ')} __sverlinPointers([${pointers.join(', ')}]);`
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

/**
 * The values an expression in markup can have, where they can be known without running it: a
 * literal, either branch of a condition, or a design constant (every option of a pick). Each value
 * notes the design constant it came from, if any.
 */
function possibleValues(
  expression: Expression | undefined,
  choices: Record<string, DesignChoices>
): { value: string | number; from?: string }[] {
  if (!expression) return [];
  switch (expression.type) {
    case 'Literal':
      return typeof expression.value === 'string' || typeof expression.value === 'number'
        ? [{ value: expression.value }]
        : [];
    case 'TemplateLiteral': {
      const cooked = expression.quasis?.[0]?.value?.cooked;
      return expression.expressions?.length === 0 && cooked !== undefined
        ? [{ value: cooked }]
        : [];
    }
    case 'ConditionalExpression':
      return [
        ...possibleValues(expression.consequent, choices),
        ...possibleValues(expression.alternate, choices)
      ];
    case 'LogicalExpression':
      return [
        ...possibleValues(expression.left, choices),
        ...possibleValues(expression.right, choices)
      ];
    case 'Identifier':
    case 'MemberExpression': {
      // A design constant, or a field of one, such as look.radius.
      const path: string[] = [];
      let at: Expression | undefined = expression;
      while (at?.type === 'MemberExpression') {
        const key =
          !at.computed && at.property?.type === 'Identifier'
            ? at.property.name
            : at.property?.type === 'Literal'
              ? String(at.property.value)
              : undefined;
        if (key === undefined) return [];
        path.unshift(key);
        at = at.object;
      }
      if (at?.type !== 'Identifier' || !at.name) return [];
      let found: DesignChoices | undefined = choices[at.name];
      for (const key of path) found = found && 'fields' in found ? found.fields[key] : undefined;
      const from = [at.name, ...path].join('.');
      return found && 'values' in found ? found.values.map((value) => ({ value, from })) : [];
    }
    default:
      return [];
  }
}

const layouts = ['row', 'column', 'free'];
const named = (scale: object, numeric = true) => ({ names: Object.keys(scale), numeric });
type PropNames = Record<string, { names: string[]; numeric: boolean } | null>;

const nodeProps: PropNames = {
  value: null,
  layout: named(Object.fromEntries(layouts.map((name) => [name, name])), false),
  shape: named({ box: 0, card: 0, plain: 0 } satisfies Record<NodeShape, 0>, false),
  fill: null,
  stroke: null,
  opacity: null,
  color: null,
  font: named({ sans: 0, serif: 0, mono: 0 }, false),
  size: named(namedSizes),
  weight: named({ normal: 0, bold: 0 }, false),
  padding: named(spacings),
  gap: named(spacings),
  align: named(alignments, false),
  justify: named(justifications, false),
  radius: named(radii, false),
  strokeWidth: named(strokeWidths),
  minSize: named(minSizes),
  children: null,
  key: null,
  constraints: null,
  flow: named({ x: 0, y: 0 }, false),
  form: named(Object.fromEntries(forms.map((name) => [name, name])), false),
  curve: named({ straight: 0, curved: 0 }, false),
  layoutSeed: null
};

/** The props each library component takes, with the names a prop's text value can be, if limited. */
export const libraryProps: Record<'Node' | 'Link' | 'Pointed', PropNames> = {
  Node: nodeProps,
  Pointed: Object.fromEntries(
    (
      [
        'shape',
        'fill',
        'stroke',
        'opacity',
        'color',
        'font',
        'size',
        'weight',
        'padding',
        'radius',
        'strokeWidth'
      ] as const
    ).map((name) => [name, nodeProps[name]])
  ),
  Link: {
    from: null,
    to: null,
    directed: null,
    dashed: null,
    label: null,
    stroke: null,
    strokeWidth: named(strokeWidths),
    curve: named({ straight: 0, curved: 0 }, false),
    bend: null
  }
};

/**
 * Reject a prop a library component does not take, or a written value it cannot use, such as
 * shape="circle", which would otherwise be ignored without a word.
 */
function checkProps(
  component: 'Node' | 'Link' | 'Pointed',
  attributes: readonly Attribute[],
  start: number,
  source: string,
  problems: InvalidSvelteSourceError[],
  choices: Record<string, DesignChoices>
): void {
  const props = libraryProps[component];
  for (const attribute of attributes) {
    if (attribute.type !== 'Attribute' || !attribute.name) continue;
    const at = { start: sourcePosition(source, attribute.start ?? start) };
    if (!(attribute.name in props)) {
      problems.push(
        new InvalidSvelteSourceError(
          `<${component}> has no prop ${attribute.name}. Its props are ${Object.keys(props)
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
        : written && part.data !== undefined
          ? [{ value: part.data, from: undefined }]
          : part.type === 'MustacheTag'
            ? possibleValues(part.expression, choices)
            : [];
    const bad = candidates.find(({ value }) =>
      typeof value === 'number' ? !allowed.numeric : !allowed.names.includes(value)
    );
    if (!bad) continue;
    const shown = typeof bad.value === 'string' ? `"${bad.value}"` : String(bad.value);
    const expression = part.expression;
    const what = written
      ? `${attribute.name}=${shown} is`
      : `${attribute.name}={${source.slice(expression?.start ?? 0, expression?.end ?? 0)}} can be ${shown}${bad.from ? `, from the design value ${bad.from},` : ''} which is`;
    const hint =
      attribute.name === 'shape' && bad.value === 'circle'
        ? ' For a circle, give a framed node (one with a value, or shape="box") radius="full".'
        : '';
    problems.push(
      new InvalidSvelteSourceError(
        `<${component}> ${what} not a value it takes: use ${allowed.names
          .map((name) => `'${name}'`)
          .join(', ')}${allowed.numeric ? ', or a number in braces' : ''}.${hint}`,
        { code: 'invalid_prop', ...at }
      )
    );
  }
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
 * Tag every <Node> and <Link> in the view with the line and column (both from 1) of its tag in the
 * authored source, as the hidden prop __ref, so a rendered node or link can be traced back to the
 * markup that drew it when a participant selects it for feedback. A <Node> with links among its
 * children is also marked __links, so it lays them out; links at the top of the view mark the root. The prop goes on the tag's own line, so line numbers are unchanged.
 */
function withNodeRefs(
  svelteSource: string,
  ast: { html?: unknown; css?: { start: number } | null },
  source: string,
  choices: Record<string, DesignChoices>,
  /** The root <Node> tags of components, by where they start, with the component each roots. */
  roots: ReadonlyMap<number, string>,
  /** The <Node> tags showing their component's own value, by where they start, with its type. */
  valueTypes: ReadonlyMap<number, string>
): { insertions: Insertion[]; problems: InvalidSvelteSourceError[] } {
  const problems: InvalidSvelteSourceError[] = [];
  type Tag = {
    type?: string;
    name?: string;
    start?: number;
    attributes?: Attribute[];
  };
  const tags: { start: number; name: string; links: boolean }[] = [];
  const reject = (message: string, code: string, start: number | undefined) =>
    problems.push(
      new InvalidSvelteSourceError(message, { code, start: sourcePosition(source, start ?? 0) })
    );
  // Each <Link> belongs to the nearest <Node> around it, which then lays out with links. Text
  // belongs inside a node or a snippet, where a node draws it, so participants can select it.
  const walk = (value: unknown, around: { links: boolean } | undefined, inNode: boolean): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const part of value) walk(part, around, inNode);
      return;
    }
    const tag = value as Tag & Record<string, unknown> & { data?: string };
    const library =
      tag.type === 'InlineComponent' &&
      (tag.name === 'Node' || tag.name === 'Link' || tag.name === 'Pointed');
    const element = tag.type === 'Element' || (tag.type === 'InlineComponent' && !library);
    const special = typeof tag.type === 'string' && Object.hasOwn(unsupportedMarkup, tag.type);
    if (element || special) {
      reject(
        element
          ? `<${tag.name}> is not allowed: draw everything with <Node> and <Link>, setting their props for style, such as <Node size="small" color="neutral">…</Node> instead of <small>.`
          : `${unsupportedMarkup[tag.type as string]} is not allowed: draw everything with <Node> and <Link>.`,
        'view_markup',
        tag.start
      );
      return;
    }
    if (!inNode && ((tag.type === 'Text' && tag.data?.trim()) || tag.type === 'MustacheTag')) {
      reject(
        'Text outside a <Node> cannot be selected or styled; put it in a node, such as <Node>Linear search</Node>.',
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
          problems,
          choices
        );
      const entry = { start: tag.start, name: tag.name as string, links: false };
      if (tag.name !== 'Pointed') tags.push(entry);
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
      walk(tag.children, tag.name === 'Node' ? entry : around, true);
      return;
    }
    const nested = inNode || tag.type === 'SnippetBlock';
    for (const [key, child] of Object.entries(tag))
      if (key !== 'attributes' && key !== 'parent' && key !== 'metadata')
        walk(child, around, nested);
  };
  if (ast.css)
    reject(
      'Views cannot have a <style>: style nodes with their props, such as fill, stroke, radius, padding, font, and size, and leave the rest unset so presentations vary.',
      'view_style',
      ast.css.start
    );
  walk(ast.html, undefined, false);
  const insertions = tags.map(({ start, name, links }): Insertion => {
    const { line, column } = sourcePosition(source, start);
    const root = roots.get(start);
    const type = valueTypes.get(start);
    return {
      at: start + name.length + 1,
      text: ` __ref="${line}:${column + 1}"${links ? ' __links' : ''}${root ? ` __component="${root}"` : ''}${type ? ` __type="${type}"` : ''}`
    };
  });
  return { insertions, problems };
}

/**
 * Check the view's components: their types are domain types, their names are free (or their own
 * type's, making them its only view), and they read only their value, design values, and other
 * components, never the input or algorithm's variables. Gives each component's type.
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
        `${name} reads ${state}, an input or algorithm variable; a component reads only its value and design values. Draw what needs ${state} where it is in scope, or make it part of ${type}.`,
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
 * The page frame from the design value `frame`: absent, a ratio such as '4:3', or an object with any
 * of ratio, justify, align, and padding. Unset justify and align come from the drawn defaults.
 */
/** Where the design block declares a design value, such as frame. */
function designAt(prepared: PreparedComponent, name: string) {
  const block = prepared.design;
  const found = block && new RegExp(`\\bconst\\s+${name}\\b`, 'u').exec(block.body);
  return found && block ? sourcePosition(prepared.source, block.offset + found.index) : undefined;
}

/** Run a check of a design value, placing any error it raises at the value's declaration. */
function located<T>(check: () => T, start: ReturnType<typeof designAt>): T {
  try {
    return check();
  } catch (cause) {
    if (!(cause instanceof InvalidSvelteSourceError) || cause.line !== undefined) throw cause;
    throw new InvalidSvelteSourceError(cause.message, { code: 'design_value', start });
  }
}

function frameSettings(value: unknown): FrameSettings {
  const given: Record<string, unknown> =
    value === undefined
      ? {}
      : typeof value === 'string'
        ? { ratio: value }
        : value !== null && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : { ratio: value };
  const choice = (key: string, allowed: object, fallback?: string) => {
    const setting = given[key] ?? fallback;
    if (setting === undefined || (typeof setting === 'string' && Object.hasOwn(allowed, setting)))
      return setting;
    throw new InvalidSvelteSourceError(
      `The design value frame.${key} must be one of ${Object.keys(allowed)
        .map((name) => `"${name}"`)
        .join(', ')}.`
    );
  };
  // The frame arranges its top-level nodes in a column or row; a free arrangement, with its
  // relations and seed, belongs in a node.
  if (given.layout === 'free' || given.constraints !== undefined || given.layoutSeed !== undefined)
    throw new InvalidSvelteSourceError(
      'The frame arranges the top-level nodes in a column or row. To place nodes freely, relate them, or join them with links, put them in a <Node layout="free"> and give that node its constraints and layoutSeed.'
    );
  const settings = ['ratio', 'justify', 'align', 'padding', 'layout'];
  const unknown = Object.keys(given).find((key) => !settings.includes(key));
  if (unknown)
    throw new InvalidSvelteSourceError(
      `The design value frame has no setting ${unknown}; use ${settings.join(', ')}.`
    );
  const padding = given.padding ?? 'large';
  if (!(typeof padding === 'number' && Number.isFinite(padding)))
    choice('padding', spacings, 'large');
  return {
    ratio: choice('ratio', frameRatios, '16:9') as FrameSettings['ratio'],
    justify: choice('justify', justifications) as FrameSettings['justify'],
    align: choice('align', alignments) as FrameSettings['align'],
    padding: padding as FrameSettings['padding'],
    layout: choice('layout', { column: 1, row: 1 }) as FrameSettings['layout']
  };
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
