import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import type { ProjectEvent } from '$lib/shared/projects/events';

import { buildDiagnosticsFor, editorDiagnostics } from './source-diagnostics';

const problem = {
  severity: 'error' as const,
  message: 'v would have no value',
  raw: 'v would have no value',
  line: 2,
  column: 3,
  endLine: 2,
  endColumn: 18
};
const requested = (source: string, buildId: string) =>
  ({ type: 'build.requested', payload: { source: { text: source }, buildId } }) as ProjectEvent;
const failed = (buildId: string) =>
  ({
    type: 'build.failed',
    payload: { buildId, failureKind: 'source', diagnostics: [problem] }
  }) as unknown as ProjectEvent;
const succeeded = (buildId: string) =>
  ({ type: 'build.succeeded', payload: { buildId } }) as ProjectEvent;

describe('build diagnostics in the source editor', () => {
  it('takes the latest build of exactly the shown source', () => {
    const events = [
      requested('broken', '00000000-0000-4000-8000-000000000001'),
      failed('00000000-0000-4000-8000-000000000001'),
      requested('other', '00000000-0000-4000-8000-000000000002'),
      succeeded('00000000-0000-4000-8000-000000000002')
    ];
    expect(buildDiagnosticsFor(events, 'broken')).toEqual([problem]);
    expect(buildDiagnosticsFor(events, 'other')).toEqual([]);
    expect(buildDiagnosticsFor(events, 'never built')).toEqual([]);
    // A later successful build of the same source clears its problems.
    expect(
      buildDiagnosticsFor(
        [
          ...events,
          requested('broken', '00000000-0000-4000-8000-000000000003'),
          succeeded('00000000-0000-4000-8000-000000000003')
        ],
        'broken'
      )
    ).toEqual([]);
  });

  it('underlines from a diagnostic’s start to its end, or to the end of its line', () => {
    const state = EditorState.create({ doc: 'let a = 1;\n  v = queue.shift();\n' });
    expect(editorDiagnostics(state, [problem])).toEqual([
      { from: 13, to: 28, severity: 'error', message: problem.message }
    ]);
    const [noEnd] = editorDiagnostics(state, [
      { ...problem, endLine: undefined, endColumn: undefined }
    ]);
    expect(state.doc.sliceString(noEnd.from, noEnd.to)).toBe('v = queue.shift();');
  });
});
