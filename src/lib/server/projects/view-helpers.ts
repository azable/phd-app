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
import { projectBrief } from '$lib/shared/projects/brief';
import type { ProjectDocument } from '$lib/shared/projects/model';

/** How many helper calls run at once, each proposing one view (see attempt-profiles.ts). */
export const viewHelperCalls = 3;

/**
 * How long the helpers' calls may take after the reply has shown, about three times their median
 * time in the experiment (6.7 s for Luna at low effort), so a slow call is dropped, not waited on.
 */
export const viewHelperTimeoutMs = 30_000;

const note =
  'The view helpers are on: short calls that propose alternative views of one type, each built with the source and readable, for you to offer as alternatives. After a first version they run on its main type; otherwise set viewHelpers to a type of the source and a task when an alternative view would help, as for a request whose look is open or a participant asking for particular graphics, and they run after your reply. The task says in one short sentence what the views should show, from what the participant asked, settled and turned down, as "draw each card as a playing card: its suit as a symbol and its rank"; leave it empty when the look is open. Their views arrive in candidates with the next turn, with the task they answered. Choose which, if any, to offer: add one with edit, as written, and compare it with vary; leave out any that would not suit.';

/** The helpers' note, and the candidates they last proposed for the source now being revised. */
export function viewHelpersContext(document: ProjectDocument, sourceSha256: string): AiViewHelpers {
  const proposed = document.events.findLast(
    (event) =>
      event.type === 'visualization.view-candidates' && event.payload.sourceSha256 === sourceSha256
  );
  if (proposed?.type !== 'visualization.view-candidates') return { note, candidates: [] };
  const { type, task, candidates } = proposed.payload;
  return { note, type, ...(task ? { task } : {}), candidates };
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
