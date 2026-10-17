/**
 * Build problems shown in the source editor: the diagnostics of the latest failed build of exactly
 * the source shown, underlined where the code they are about starts and ends.
 *
 * @packageDocumentation
 */

import type { Diagnostic } from '@codemirror/lint';
import type { EditorState } from '@codemirror/state';

import type { ProjectEvent } from '$lib/shared/projects/events';
import type { BuildDiagnostic } from '$lib/shared/projects/events/values';

/** The diagnostics of the latest failed build of this source; none if its latest build did not fail. */
export function buildDiagnosticsFor(
  events: readonly ProjectEvent[],
  source: string
): BuildDiagnostic[] {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.type !== 'build.failed' && event.type !== 'build.succeeded') continue;
    // The request this outcome answers: the one with its build id, or else the latest before it.
    let request: ProjectEvent | undefined;
    for (let before = index - 1; before >= 0 && !request; before--) {
      const candidate = events[before];
      if (
        candidate.type === 'build.requested' &&
        (event.payload.buildId === undefined || candidate.payload.buildId === event.payload.buildId)
      )
        request = candidate;
    }
    if (request?.type !== 'build.requested' || request.payload.source.text !== source) continue;
    return event.type === 'build.failed' && event.payload.failureKind === 'source'
      ? event.payload.diagnostics
      : [];
  }
  return [];
}

/**
 * Editor ranges for diagnostics: from the start a diagnostic gives to its end, or to the end of its
 * line when it gives none; a diagnostic without a position marks the first line.
 */
export function editorDiagnostics(
  state: EditorState,
  diagnostics: readonly BuildDiagnostic[]
): Diagnostic[] {
  const position = (line: number, column: number) => {
    const at = state.doc.line(Math.min(Math.max(line, 1), state.doc.lines));
    return Math.min(at.from + Math.max(column - 1, 0), at.to);
  };
  return diagnostics.map((diagnostic) => {
    const from = position(diagnostic.line ?? 1, diagnostic.column ?? 1);
    const to =
      diagnostic.endLine && diagnostic.endColumn
        ? position(diagnostic.endLine, diagnostic.endColumn)
        : state.doc.lineAt(from).to;
    return {
      from,
      to: Math.max(to, from),
      severity: diagnostic.severity === 'warning' ? 'warning' : 'error',
      message: diagnostic.message
    };
  });
}
