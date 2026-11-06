/**
 * Helpers: short, parallel model calls that fill the holes of a skeleton (skeleton.server.ts), as
 * another view of a type or another arrangement of a layout, each fill built and measured before
 * the assistant sees it. The assistant decides whether any becomes part of the source and which to
 * compare; a helper never changes a version itself.
 */

import { readabilityText } from '$lib/shared/readability';
import type { HoleKind } from '$lib/server/ai/bots/helper-pipeline';
import { candidateFacts, type CandidateFacts } from './candidate-facts.server';
import { fillSkeleton, holesOf, skeletonFor } from './skeleton.server';

import guide from '../README.md?raw';
import holeHelper from './hole-helper.md?raw';
import layoutHelper from './layout-helper.md?raw';
import viewHelper from './view-helper.md?raw';
import { bundlePresentation, prepareSvelteComponent } from '../compile.server';
import { viewKey, withStarterBase } from '../design.server';

/** Prompt text from a Markdown file: its HTML comments are notes for maintainers. */
const promptText = (markdown: string) => markdown.replace(/<!--[\s\S]*?-->\s*/gu, '').trim();

/**
 * The guide's sections a view needs: the views themselves, the atomic types whose ranges size
 * them, the design's looks and bound props, and the node, drawing and stack they are made of. Taken from
 * the guide by heading, so the extract always says what the guide says.
 */
const viewSections = [
  '## View',
  '## Views of types',
  '## Atomic types',
  '## Design',
  "### Props bound to a view's value",
  '## Node',
  '### Props',
  '### Drawings',
  '## Stack',
  '## The subset'
];

/** The guide's sections with the headings listed, each up to the next heading. */
export function guideSections(markdown: string, headings: readonly string[]): string {
  const lines = markdown.split('\n');
  const starts = lines.flatMap((line, at) => (/^#{2,3} /u.test(line) ? [at] : []));
  return starts
    .filter((at) => headings.includes(lines[at].trim()))
    .map((at) => {
      const next = starts.find((start) => start > at) ?? lines.length;
      return lines.slice(at, next).join('\n').trim();
    })
    .join('\n\n');
}

/** One view or layout a helper proposed, as checkCandidate and checkLayoutCandidate take it. */
export type ProposedView = { name: string; description: string; markup: string };

/**
 * What each of the parallel helpers tries toward the task, so that their proposals differ: one
 * direction each, as many as a round runs at most (defaultHelperCounts in study/definition.ts).
 */
export const viewHelperDirections = [
  'a shape that shows the size, such as a bar or a column',
  'an icon, a word, or a compact mark without a box',
  'a drawing, an <Svg> of a few simple shapes chosen by the value',
  'a card or badge that groups the value with what it means',
  'the plainest form that still reads: the value as text, with at most one mark'
];

/** What each layout helper tries, so that their arrangements differ. */
export const layoutHelperDirections = [
  'the main structure beside the other parts, in a row',
  'the main structure above the other parts, in a column, the rest in one row under it',
  'fewer panels: merge small parts into one, or into the main structure',
  'more panels: split the page into a grid of two by two',
  'a side table or list folded into the main structure, its values in the nodes or links',
  'the captions and explanations under the part they explain, close to it',
  'the listing beside the structure, the explanations under both',
  'the main structure as large as the frame allows, the rest small at one side',
  'the parts in a stack where they show at different steps, so they share one place',
  'the plainest page: the main structure alone, with one caption'
];

/** The guide's sections a layout needs: layouts and scenes, stacks, grids, free layouts and links. */
const layoutSections = [
  '## View',
  '## Storyboard',
  '## Pointers',
  '## Queries',
  '## Node',
  '### Props',
  '## Stack',
  '## Grid',
  '## Free layout and links',
  '## Link',
  '## The subset'
];

/** The guide's sections an input needs: cases and the types their values keep to. */
const caseSections = [
  '## Cases',
  '## Atomic types',
  '## Arrays, records, and unions',
  '## Pools and references'
];

/**
 * What a helper reads for each kind of hole: its own advice, where the kind has some, and the
 * guide's sections it needs; the algorithm and anything at all need the whole guide.
 */
const kindPrompts: Record<HoleKind, { advice?: string; sections: readonly string[] | 'all' }> = {
  view: { advice: viewHelper, sections: viewSections },
  layout: { advice: layoutHelper, sections: layoutSections },
  case: { sections: caseSections },
  algorithm: { sections: 'all' },
  any: { sections: 'all' }
};

/**
 * A hole helper's prompt for the kinds of hole it fills: the general instructions, each kind's
 * advice, then the guide, its sections for those kinds or all of it, in the guide's order.
 */
export function holeHelperPrompt(kinds: readonly HoleKind[]): string {
  const prompts = [...new Set(kinds)].map((kind) => kindPrompts[kind]);
  const sections = prompts.some(({ sections }) => sections === 'all')
    ? guide
    : guideSections(
        guide,
        prompts.flatMap(({ sections }) => (sections === 'all' ? [] : sections))
      );
  return [
    promptText(holeHelper),
    ...prompts.flatMap(({ advice }) => (advice ? [promptText(advice)] : [])),
    promptText(sections)
  ].join('\n\n');
}

/** A view hole's prompt with the whole guide, for measuring the extract against it. */
export const fullGuidePrompt = [
  promptText(holeHelper),
  promptText(viewHelper),
  promptText(guide)
].join('\n\n');

/** A layout's whole block in a source, or undefined. Layouts are top-level, so none nests. */
export function layoutBlock(source: string, layout: string): string | undefined {
  return new RegExp(`<Layout\\b[^>]*\\bname="${layout}"[^>]*>[\\s\\S]*?</Layout>`, 'u').exec(
    source
  )?.[0];
}

/**
 * The page layout that draws a free layout, a graph's or a tree's, where its arrangement among the
 * other parts is decided; the free layout itself where no other layout draws it. None without one.
 */
export function freeLayoutName(source: string): string | undefined {
  const blocks = [...source.matchAll(/<Layout\b[^>]*>[\s\S]*?<\/Layout>/gu)].map(([block]) => ({
    block,
    name: /\bname="(\w+)"/u.exec(block)?.[1]
  }));
  const free = blocks.find(({ block }) => block.includes('layout="free"'))?.name;
  if (!free) return undefined;
  return blocks.find(({ block }) => new RegExp(`<${free}\\b`, 'u').test(block))?.name ?? free;
}

/**
 * The layout whose arrangement a request about the page is about: the page drawing a graph or tree,
 * else the layout the first scene shows. None where the source has no scene.
 */
export function pageLayoutName(source: string): string | undefined {
  return freeLayoutName(source) ?? /<Scene\b[^>]*>\s*<(\w+)\b/u.exec(source)?.[1];
}

/** A layout's declared inputs, sorted, where it lists them. */
const declaredInputs = (block: string) =>
  (/\bof="([^"]*)"/u.exec(block)?.[1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .sort()
    .join(',');

/**
 * The type the source draws most as values: the type of its first value view, that is a view
 * drawing no pointer. None where the source has no such view.
 */
export function mainViewType(source: string): string | undefined {
  const views = [...source.matchAll(/<View of="([A-Za-z_]\w*)" name="(\w+)">([\s\S]*?)<\/View>/gu)];
  const pointers = new Set(
    views.filter(([, , , body]) => body.includes('<Pointed')).map(([, type]) => type)
  );
  return views.map(([, type]) => type).find((type) => !pointers.has(type));
}

/** The source with a view added after its last view, or before its first layout. */
export function withView(source: string, markup: string): string {
  const last = [...source.matchAll(/<\/View>/gu)].at(-1);
  const at =
    last?.index !== undefined
      ? last.index + '</View>'.length
      : Math.max(0, source.indexOf('<Layout'));
  return `${source.slice(0, at)}\n${markup.trim()}\n${source.slice(at)}`;
}

/** A proposed view as checked: kept with what the assistant needs to choose, or why it was not. */
export type ViewCandidate =
  | {
      kept: true;
      type: string;
      name: string;
      description: string;
      markup: string;
      /** How large the picture draws with it, told as the readability note is. */
      readability?: string;
      /** What ranks it among the others, and what it draws at each step, to drop one alike. */
      measured?: { score: number; drawn: string };
      /** What the app measured of it (candidate-facts.server.ts). */
      facts?: CandidateFacts;
      /** Its fill of each hole of its group, by the hole's name. */
      fills?: Record<string, string>;
      /** The source it was built as, for drawing its pictures. */
      source?: string;
      built?: Built;
    }
  | { kept: false; name: string; reason: string };

export type Built = Awaited<ReturnType<typeof bundlePresentation>>;

/**
 * A candidate as built: kept with its facts, or left out where unreadable or breaking a constraint
 * (candidate-facts.server.ts), its score as the arrangements are ranked.
 */
export function measured(
  built: Built,
  candidate: { type: string; name: string; description: string; markup: string },
  source: string,
  constraints: readonly string[] = []
): ViewCandidate {
  const result = candidateFacts(built, source, constraints);
  if ('dropped' in result) return { kept: false, name: candidate.name, reason: result.dropped };
  const readability = built.layout.readability;
  return {
    kept: true,
    ...candidate,
    markup: candidate.markup.trim(),
    ...(readability ? { readability: readabilityText(readability) } : {}),
    measured: { score: result.facts.score, drawn: JSON.stringify(built.layout.drawn ?? []) },
    facts: result.facts,
    source,
    built
  };
}

/**
 * The candidates the assistant is given: those kept, one of each that draws alike at every step,
 * best first, at most `most`.
 */
export function bestCandidates(checked: readonly ViewCandidate[], most: number): ViewCandidate[] {
  const seen = new Set<string>();
  return checked
    .filter((candidate) => candidate.kept)
    .toSorted(
      (a, b) => (b.kept ? (b.measured?.score ?? 0) : 0) - (a.kept ? (a.measured?.score ?? 0) : 0)
    )
    .filter((candidate) => {
      const drawn = candidate.kept ? candidate.measured?.drawn : undefined;
      if (drawn === undefined) return true;
      if (seen.has(drawn)) return false;
      seen.add(drawn);
      return true;
    })
    .slice(0, most);
}

/**
 * Check a proposed arrangement of a layout: it must be that layout, reading what the old one read,
 * build in its place, and read on a typical stage.
 */
export async function checkLayoutCandidate(
  source: string,
  layout: string,
  proposal: ProposedView
): Promise<ViewCandidate> {
  const made = skeletonFor(source, { layout });
  if (!made) return { kept: false, name: proposal.name, reason: `no layout named ${layout}` };
  const checked = await checkFills(made.skeleton, { layout: proposal.markup }, made.originals, {
    name: proposal.name,
    description: proposal.description
  });
  return checked.kept ? { ...checked, name: layout } : checked;
}

/**
 * Check a proposed view: it must build with the source, drawn as its type's view, and its
 * picture must be readable on a typical stage. A view failing either is left out, never shown.
 */
export async function checkCandidate(
  source: string,
  type: string,
  view: ProposedView
): Promise<ViewCandidate> {
  if (!new RegExp(`^\\s*<View of="${type}" name="${view.name}">`, 'u').test(view.markup))
    return { kept: false, name: view.name, reason: `not one view of ${type} named ${view.name}` };
  const { skeleton, originals } = skeletonFor(source, { type })!;
  return checkFills(skeleton, { view: view.markup }, originals, view);
}

/**
 * Check one proposal's fills of a skeleton: each of its hole's kind, a layout reading what the one
 * it replaces read, and the source they make building, its picture readable on a typical stage and
 * keeping to the constraints the app can check. Holes the proposal leaves empty take `others`, what
 * they held before or another group's fill. A new view is shown, as its type's chosen view.
 */
export async function checkFills(
  skeleton: string,
  fills: Readonly<Record<string, string>>,
  others: Readonly<Record<string, string>>,
  proposal: { name: string; description: string },
  constraints: readonly string[] = []
): Promise<ViewCandidate> {
  const left = (reason: string): ViewCandidate => ({ kept: false, name: proposal.name, reason });
  const parsed = holesOf(skeleton);
  if ('problems' in parsed) return left(parsed.problems.join(' '));
  const own = parsed.holes.filter((hole) => fills[hole.name] !== undefined);
  const filled = fillSkeleton(skeleton, {
    ...Object.fromEntries(
      parsed.holes.flatMap((hole) =>
        others[hole.name] !== undefined ? [[hole.name, others[hole.name]]] : []
      )
    ),
    ...fills
  });
  if ('problems' in filled) return left(filled.problems.join(' '));
  for (const hole of own)
    if (hole.kind === 'layout' && others[hole.name] !== undefined) {
      const old = others[hole.name];
      if (declaredInputs(fills[hole.name]) !== declaredInputs(old))
        return left(
          `changes the inputs of ${hole.of ?? hole.name}: keep of="${/\bof="([^"]*)"/u.exec(old)?.[1] ?? ''}"`
        );
    }
  const chosen = Object.fromEntries(
    own.flatMap((hole) => {
      const name = /^\s*<View\b[^>]*\bname="(\w+)"/u.exec(fills[hole.name])?.[1];
      return hole.kind === 'view' && hole.of && name ? [[viewKey(hole.of), name]] : [];
    })
  );
  try {
    const prepared = prepareSvelteComponent(filled.source);
    const built = await bundlePresentation(prepared, 1, withStarterBase({ chosen }));
    const part = own.map((hole) => hole.of ?? hole.name).join(', ');
    const checked = measured(
      built,
      {
        type: part,
        ...proposal,
        markup: own.map((hole) => fills[hole.name].trim()).join('\n\n')
      },
      filled.source,
      constraints
    );
    return checked.kept
      ? {
          ...checked,
          fills: Object.fromEntries(own.map((hole) => [hole.name, fills[hole.name].trim()]))
        }
      : checked;
  } catch (cause) {
    return left(cause instanceof Error ? cause.message : String(cause));
  }
}
