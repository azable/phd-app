/** Compact source-validation feedback for the bounded assistant repair ladder. */

import type { BuildDiagnostic } from '$lib/shared/projects/events/values';

export function formatDiagnosticSummary(diagnostics: readonly BuildDiagnostic[]): string {
  if (diagnostics.length === 0) return 'The build did not provide a diagnostic.';
  return diagnostics
    .map((diagnostic) => {
      // A range reads from its start to its (exclusive) end, as in Main.svelte:13:3-13:18.
      const end =
        diagnostic.endLine && diagnostic.endColumn
          ? `-${diagnostic.endLine}:${diagnostic.endColumn}`
          : '';
      const location =
        diagnostic.sourcePath && diagnostic.line && diagnostic.column
          ? `${diagnostic.sourcePath}:${diagnostic.line}:${diagnostic.column}${end}`
          : diagnostic.sourcePath;
      const code = diagnostic.code ? ` [${diagnostic.code}]` : '';
      return `${location ? `${location}: ` : ''}${diagnostic.severity}${code}\n${diagnostic.message}`;
    })
    .join('\n\n');
}
