/**
 * The view helpers as the assistant sees them: a note on what they do, and the candidates they
 * last proposed for the base source. Present in its context only where the turn runs them.
 */

import type { AiViewHelpers } from '$lib/server/chat-bots/project-context';
import type { ProjectDocument } from '$lib/shared/projects/model';

/** How many helper calls run at once, each proposing one view (see attempt-profiles.ts). */
export const viewHelperCalls = 3;

/**
 * How long the helpers' calls may take after the reply has shown, about three times their median
 * time in the experiment (6.7 s for Luna at low effort), so a slow call is dropped, not waited on.
 */
export const viewHelperTimeoutMs = 30_000;

const note =
  'The view helpers are on: short calls that propose alternative views of one type, each built with the source and readable, for you to offer as alternatives. After a first version they run on its main type; otherwise set viewHelpers to a type of the source (as Int) when an alternative view would help, as for a request whose look is open, and they run after your reply. Their views arrive in candidates with the next turn. Choose which, if any, to offer: add one with edit, as written, and compare it with vary; leave out any that would not suit.';

/** The helpers' note, and the candidates they last proposed for the source now being revised. */
export function viewHelpersContext(document: ProjectDocument, sourceSha256: string): AiViewHelpers {
  const proposed = document.events.findLast(
    (event) =>
      event.type === 'visualization.view-candidates' && event.payload.sourceSha256 === sourceSha256
  );
  if (proposed?.type !== 'visualization.view-candidates') return { note, candidates: [] };
  return { note, type: proposed.payload.type, candidates: proposed.payload.candidates };
}
