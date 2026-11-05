/**
 * The view helpers as the assistant sees them: a note on what they do, and the candidates they
 * last proposed for the base source. Present in its context only where the turn runs them.
 */

import {
  designVariables,
  viewedPresentation,
  type AiViewHelpers
} from '$lib/server/chat-bots/project-context';
import { preferenceSummary } from '$lib/server/chat-bots/preference-summary';
import { layoutBlock } from '$lib/modes/sverlin/view-helpers.server';
import { projectBrief } from '$lib/shared/projects/brief';
import type { ProjectDocument } from '$lib/shared/projects/model';

/** How many proposals that did not build or read get one retry a round (see attempt-profiles.ts). */
export const viewHelperCalls = 3;

/**
 * How long a round's builds of its proposals may take in all. Warm builds on a laptop took 0.2 s
 * (bfs-undirected), 0.26 s (bst) and 0.54 s (Dijkstra) on 2026-11-05, a cold first one 1.2–3.4 s:
 * five seconds builds ten graph proposals warm, and one slow source still gets a few.
 */
export const helperBuildBudgetMs = 5_000;

/**
 * The most candidates the assistant is given from a round, the best by readability: enough for a
 * few comparisons, few enough to read in its context.
 */
export const candidatesGiven = 5;

/**
 * How long the helpers' calls may take after the reply has shown, about three times their median
 * time in the experiment (6.7 s for Luna at low effort), so a slow call is dropped, not waited on.
 */
export const viewHelperTimeoutMs = 30_000;

const note =
  'The view helpers are on: short calls that propose alternative views of one type, or arrangements of one layout, each built with the source and readable, for you to offer as alternatives. After a first version they run on its main type, or on the layout drawing its graph or tree; otherwise set viewHelpers to a type of the source and a task when an alternative view would help, as for a request whose look is open or a participant asking for particular graphics, or to a layout and a task when the arrangement of the page is open or the participant asks where things go, and they run after your reply. The task says in one short sentence what they should show, from what the participant asked, settled and turned down, as "draw each card as a playing card: its suit as a symbol and its rank" or "put the queue beside the graph"; leave it empty when the look is open. The best few arrive in candidates with the next turn, with the task they answered and how each draws. Choose which, if any, to offer: add a view with edit, as written, and compare it with vary; put an arrangement in place of its layout with edit and compare it with the current one; leave out any that would not suit.';

/** A source's views of one type, as written: a candidate stays offerable while they are unchanged. */
function viewsOf(source: string, type: string): string {
  return [...source.matchAll(new RegExp(`<View of="${type}"[^>]*>[\\s\\S]*?</View>`, 'gu'))]
    .map(([view]) => view)
    .join('\n');
}

/** The text of a version of the entry source, by its content hash. */
function sourceText(document: ProjectDocument, sha256: string): string | undefined {
  for (const event of document.events)
    if (event.type === 'artifact.version-created')
      for (const change of event.payload.changes)
        if (change.operation === 'upsert' && change.artifact.content.sha256 === sha256)
          return change.artifact.content.text;
  return undefined;
}

/**
 * The helpers' note, and the candidates they last proposed, until offered or stale: one the source
 * now has is offered, and all go stale once the source changes the views of their type. How many
 * replies have passed since they were proposed shows how long they have waited.
 */
export function viewHelpersContext(
  document: ProjectDocument,
  source: { sha256: string; text: string }
): AiViewHelpers {
  const proposed = document.events.findLast(
    (event) => event.type === 'visualization.view-candidates'
  );
  if (proposed?.type !== 'visualization.view-candidates') return { note, candidates: [] };
  const { type, layout, task, candidates, sourceSha256 } = proposed.payload;
  // What the candidates replace: the views of their type, or their layout.
  const part = (text: string) =>
    layout !== undefined ? (layoutBlock(text, layout) ?? '') : viewsOf(text, type ?? '');
  const written = sourceSha256 === source.sha256 ? source.text : sourceText(document, sourceSha256);
  if (written === undefined || part(written) !== part(source.text)) return { note, candidates: [] };
  const offered = (markup: string, name: string) =>
    layout !== undefined
      ? part(source.text).trim() === markup.trim()
      : source.text.includes(`name="${name}"`);
  const waiting = candidates.filter(({ name, markup }) => !offered(markup, name));
  if (!waiting.length) return { note, candidates: [] };
  const repliesSince = document.events.filter(
    (event) =>
      event.id > proposed.id && event.type === 'assistant.responded' && !event.payload.releases
  ).length;
  return {
    note,
    ...(layout !== undefined ? { layout } : { type }),
    ...(task ? { task } : {}),
    candidates: waiting,
    repliesSince
  };
}

/**
 * The most of the brief and of the settled choices the helpers are told: a few lines each, about
 * 1,000 characters in all beside a guide extract of some 12,000 tokens.
 */
const backgroundLines = { brief: 6, settled: 6 };
const backgroundCharacters = 1000;

/**
 * What the helpers know of the participant besides the task: the brief's known attributes, as
 * audience and tone, and the design choices the participant's answers settled. Empty where none.
 */
export function viewHelperBackground(document: ProjectDocument): string {
  const brief = projectBrief(document.events)
    .flatMap((item) => (item.status === 'unknown' ? [] : [`${item.key}: ${item.value}`]))
    .slice(0, backgroundLines.brief);
  const settled = (
    preferenceSummary(document.events, designVariables(viewedPresentation(document, [])))
      ?.choices ?? []
  )
    .flatMap(({ variable, state, value }) =>
      state === 'settled' && value !== undefined ? [`${variable} = ${JSON.stringify(value)}`] : []
    )
    .slice(0, backgroundLines.settled);
  const text = [
    ...(brief.length ? ['The brief:', ...brief.map((line) => `- ${line}`)] : []),
    ...(settled.length ? ['Settled choices:', ...settled.map((line) => `- ${line}`)] : [])
  ].join('\n');
  return text.length > backgroundCharacters ? `${text.slice(0, backgroundCharacters - 1)}…` : text;
}
