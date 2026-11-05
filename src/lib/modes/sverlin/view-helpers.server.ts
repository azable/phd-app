/**
 * View helpers: short, parallel model calls that propose alternative views of a source's main
 * type, each built and checked before the assistant sees it. The assistant decides whether any
 * becomes part of the source and which to compare; a helper never changes a version itself.
 */

import { readabilityText, unreadableProblem, wideCloseness } from '$lib/shared/readability';

import guide from './README.md?raw';
import layoutHelper from './layout-helper.md?raw';
import helper from './view-helper.md?raw';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { viewKey } from './design.server';

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

/** The helpers' prompt: their instructions, then the guide's sections on views. */
export const viewHelperPrompt = [
  promptText(helper),
  promptText(guideSections(guide, viewSections))
].join('\n\n');

/** The whole guide, for measuring the extract against it. */
export const fullGuidePrompt = [promptText(helper), promptText(guide)].join('\n\n');

/** One view a helper proposed. */
export type ProposedView = { name: string; description: string; markup: string };

export const proposedViewsFormat = {
  name: 'alternative_views',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      views: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            markup: { type: 'string' }
          },
          required: ['name', 'description', 'markup']
        }
      }
    },
    required: ['views']
  }
} as const;

/**
 * The task a helper is given: the type, how many views, a direction to try, the source, and where
 * the assistant gave them, what the views should show and what is known of the participant.
 */
export const viewHelperTask = ({
  type,
  count,
  source,
  direction,
  task,
  background
}: {
  type: string;
  count: number;
  source: string;
  direction?: string;
  task?: string;
  background?: string;
}): string =>
  [
    `Write ${count} alternative view${count === 1 ? '' : 's'} of the type ${type}${direction ? `, trying ${direction}` : ''}. Return JSON {"views":[{"name","description","markup"}]}.`,
    ...(task ? [`The task, from the assistant: ${task}`] : []),
    ...(background ? [`What the participant has said and settled:\n${background}`] : []),
    `The source:\n\n${source}`
  ].join('\n\n');

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

/** The layout helpers' prompt: their instructions, then the guide's sections on layouts. */
export const layoutHelperPrompt = [
  promptText(layoutHelper),
  promptText(guideSections(guide, layoutSections))
].join('\n\n');

/** The task a layout helper is given, as viewHelperTask for a view. */
export const layoutHelperTask = ({
  layout,
  source,
  direction,
  task,
  background
}: {
  layout: string;
  source: string;
  direction?: string;
  task?: string;
  background?: string;
}): string =>
  [
    `Write another arrangement of the layout ${layout}${direction ? `, trying ${direction}` : ''}: the whole <Layout name="${layout}">…</Layout>. Return JSON {"views":[{"name","description","markup"}]}, its name "${layout}".`,
    ...(task ? [`The task, from the assistant: ${task}`] : []),
    ...(background ? [`What the participant has said and settled:\n${background}`] : []),
    `The source:\n\n${source}`
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
    }
  | { kept: false; name: string; reason: string };

type Built = Awaited<ReturnType<typeof bundlePresentation>>;

/**
 * A candidate as built: kept with its facts, or left out where unreadable. Its score puts readable
 * text first, then a shape near 16:9 and how much of the frame it fills, each part beyond the first
 * costing a little, as the arrangements are ranked (shared/readability.ts).
 */
function measured(
  built: Built,
  candidate: { type: string; name: string; description: string; markup: string }
): ViewCandidate {
  const readability = built.layout.readability;
  const unreadable = readability ? unreadableProblem(readability) : undefined;
  if (unreadable) return { kept: false, name: candidate.name, reason: unreadable };
  const score = readability
    ? 2 +
      3 * wideCloseness(readability) +
      (readability.fill ?? 0) -
      0.05 * Math.max(0, readability.parts.length - 1)
    : 0;
  return {
    kept: true,
    ...candidate,
    markup: candidate.markup.trim(),
    ...(readability ? { readability: readabilityText(readability) } : {}),
    measured: { score, drawn: JSON.stringify(built.layout.drawn ?? []) }
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
  const old = layoutBlock(source, layout);
  const block = layoutBlock(proposal.markup, layout);
  if (!old || !block || block.trim() !== proposal.markup.trim())
    return { kept: false, name: proposal.name, reason: `not one layout named ${layout}` };
  if (declaredInputs(block) !== declaredInputs(old))
    return {
      kept: false,
      name: proposal.name,
      reason: `changes the inputs of ${layout}: keep of="${/\bof="([^"]*)"/u.exec(old)?.[1] ?? ''}"`
    };
  try {
    const built = await bundlePresentation(
      prepareSvelteComponent(source.replace(old, block)),
      1,
      {}
    );
    return measured(built, { type: layout, ...proposal, name: layout });
  } catch (cause) {
    return {
      kept: false,
      name: proposal.name,
      reason: cause instanceof Error ? cause.message : String(cause)
    };
  }
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
  try {
    const prepared = prepareSvelteComponent(withView(source, view.markup));
    const built = await bundlePresentation(prepared, 1, { chosen: { [viewKey(type)]: view.name } });
    return measured(built, { type, ...view });
  } catch (cause) {
    return {
      kept: false,
      name: view.name,
      reason: cause instanceof Error ? cause.message : String(cause)
    };
  }
}
