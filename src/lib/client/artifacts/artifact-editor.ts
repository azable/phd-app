/**
 * CodeMirror configuration for editable project artifacts.
 *
 * @packageDocumentation
 */

import { basicSetup, EditorView } from 'codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';

import { sverlinLabelMarks } from './label-marks';

/** Source languages supported by the project artifact editor. */
export type ArtifactLanguage = 'svelte' | 'json';

const sverlinHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword
    ],
    color: 'var(--syntax-keyword)',
    fontWeight: '600'
  },
  {
    tag: [tags.variableName, tags.definition(tags.variableName), tags.function(tags.variableName)],
    color: 'var(--syntax-identifier)'
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: 'var(--syntax-type)'
  },
  {
    tag: [tags.string, tags.docString, tags.character],
    color: 'var(--syntax-string)'
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    color: 'var(--syntax-literal)'
  },
  {
    tag: [tags.operator, tags.operatorKeyword, tags.punctuation],
    color: 'var(--syntax-operator)'
  },
  {
    tag: [tags.comment, tags.docComment],
    color: 'var(--syntax-comment)',
    fontStyle: 'italic'
  },
  {
    tag: tags.invalid,
    color: 'var(--destructive)',
    textDecoration: 'underline'
  }
]);

/** Return CodeMirror language support for a project artifact language. */
export function artifactLanguageSupport(language: ArtifactLanguage): Extension {
  switch (language) {
    case 'svelte':
      return html();
    case 'json':
      return javascript();
  }
}

/** Build the application-aware CodeMirror color and layout theme. */
export function artifactTheme(): Extension {
  return EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: 'var(--card)',
      color: 'var(--card-foreground)',
      fontSize: '0.875rem'
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    },
    '.cm-gutters': {
      backgroundColor: 'var(--muted)',
      color: 'var(--muted-foreground)',
      border: 'none'
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: 'color-mix(in oklab, var(--muted) 70%, transparent)'
    },
    '.cm-content': {
      padding: '0.75rem 0',
      caretColor: 'var(--card-foreground)'
    },
    '.cm-line': {
      padding: '0 0.75rem'
    },
    // CodeMirror's own cursor and tooltip colours assume a light editor, while its text and
    // background come from the app's tokens above; take them from the tokens too, so they keep
    // their contrast whatever colours the tokens resolve to.
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--card-foreground)'
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--popover)',
      color: 'var(--popover-foreground)',
      border: '1px solid var(--border)',
      borderRadius: 'calc(var(--radius) - 4px)',
      overflow: 'hidden'
    }
  });
}

/** Build the complete CodeMirror extension set for an artifact editor. */
export function artifactEditorExtensions({
  language
}: {
  language: ArtifactLanguage;
}): Extension[] {
  return [
    basicSetup,
    artifactLanguageSupport(language),
    syntaxHighlighting(sverlinHighlightStyle),
    ...(language === 'svelte' ? [sverlinLabelMarks()] : []),
    artifactTheme()
  ];
}
