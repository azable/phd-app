/**
 * View helpers: short, parallel model calls that propose alternative views of a source's main
 * type, each built and checked before the assistant sees it. The assistant decides whether any
 * becomes part of the source and which to compare; a helper never changes a version itself.
 */

import { readabilityText, unreadableProblem } from '$lib/shared/readability';

import guide from './README.md?raw';
import helper from './view-helper.md?raw';
import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { viewKey } from './design.server';

/** Prompt text from a Markdown file: its HTML comments are notes for maintainers. */
const promptText = (markdown: string) => markdown.replace(/<!--[\s\S]*?-->\s*/gu, '').trim();

/**
 * The guide's sections a view needs: the views themselves, the atomic types whose ranges size
 * them, the design's looks and bound props, and the node and stack they are made of. Taken from
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

/** The task a helper is given: the type, how many views, a direction to try, and the source. */
export const viewHelperTask = (
  type: string,
  count: number,
  source: string,
  direction?: string
): string =>
  `Write ${count} alternative view${count === 1 ? '' : 's'} of the type ${type}${direction ? `, trying ${direction}` : ''}. Return JSON {"views":[{"name","description","markup"}]}.\n\nThe source:\n\n${source}`;

/** What each of the parallel helpers tries, so that their proposals differ. */
export const viewHelperDirections = [
  'a shape that shows the size, such as a bar or a column',
  'an icon or a word',
  'a compact mark without a box, or a card'
];

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
    }
  | { kept: false; name: string; reason: string };

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
    const readability = built.layout.readability;
    const unreadable = readability ? unreadableProblem(readability) : undefined;
    if (unreadable) return { kept: false, name: view.name, reason: unreadable };
    return {
      kept: true,
      type,
      name: view.name,
      description: view.description,
      markup: view.markup.trim(),
      ...(readability ? { readability: readabilityText(readability) } : {})
    };
  } catch (cause) {
    return {
      kept: false,
      name: view.name,
      reason: cause instanceof Error ? cause.message : String(cause)
    };
  }
}
