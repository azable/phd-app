<script lang="ts">
  import { onMount } from 'svelte';
  import { lintGutter, setDiagnostics } from '@codemirror/lint';
  import { Compartment, EditorState } from '@codemirror/state';
  import { EditorView } from 'codemirror';

  import type { BuildDiagnostic } from '$lib/shared/projects/events/values';

  import { artifactEditorExtensions, type ArtifactLanguage } from './artifact-editor';
  import type { TagDefaults } from './drawn-defaults';
  import { drawnValues, setDrawnValues, type DrawnPresentation } from './drawn-values';
  import { editorDiagnostics } from './source-diagnostics';
  import {
    showSourceHighlights,
    sourceHighlights,
    type SourceHighlight
  } from './selection-highlights';

  /** Public properties accepted by the CodeMirror artifact editor. */
  type Props = {
    value: string;
    editable?: boolean;
    language?: ArtifactLanguage;
    ariaLabel?: string;
    /** Tags to highlight, such as those behind elements selected in a presentation. */
    highlights?: readonly SourceHighlight[];
    /** Values the shown presentations drew in the design block, marked where they were drawn. */
    drawn?: readonly DrawnPresentation[];
    /** The drawn defaults each <Node> tag takes in the shown presentations. */
    drawnTags?: readonly TagDefaults[];
    /** The source the drawn values were made in. */
    drawnSource?: string;
    /** Build problems to underline, with the source they were found in. */
    diagnostics?: { source: string; items: readonly BuildDiagnostic[] };
    onChange?: (value: string) => void;
  };

  let {
    value = $bindable(''),
    editable = false,
    language = 'svelte',
    ariaLabel = 'Source code editor',
    highlights = [],
    drawn = [],
    drawnTags = [],
    drawnSource = '',
    diagnostics = { source: '', items: [] },
    onChange
  }: Props = $props();

  let host = $state<HTMLElement | null>(null);
  let view = $state.raw<EditorView | null>(null);
  let suppressChange = false;
  const editableCompartment = new Compartment();

  /** Focus the underlying CodeMirror editor. */
  export function focus(): void {
    view?.focus();
  }

  onMount(() => {
    if (!host) return;

    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...artifactEditorExtensions({ language }),
          sourceHighlights,
          drawnValues,
          lintGutter(),
          editableCompartment.of(editableExtensions(editable)),
          EditorView.updateListener.of((update) => {
            if (suppressChange || !update.docChanged) return;
            const nextValue = update.state.doc.toString();
            value = nextValue;
            onChange?.(nextValue);
          })
        ]
      })
    });

    return () => {
      view?.destroy();
      view = null;
    };
  });

  $effect(() => {
    if (!view) return;

    const nextValue = value;
    if (view.state.doc.toString() !== nextValue) {
      suppressChange = true;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: nextValue
        }
      });
      suppressChange = false;
    }
  });

  // After the document, so highlights are placed in the text they refer to.
  $effect(() => {
    void value;
    const shown = [...highlights];
    if (view) view.dispatch(showSourceHighlights(view.state, shown));
  });

  // Drawn values are placed in the text they were made in; once that text is edited, CodeMirror
  // moves them with the edits, so ghost props can still be written in, until it is that text again.
  $effect(() => {
    void value;
    const shown = { presentations: [...drawn], tags: [...drawnTags] };
    if (view && view.state.doc.toString() === drawnSource)
      view.dispatch({ effects: setDrawnValues.of(shown) });
  });

  // Diagnostics are placed in the text they were found in; once that text is edited, CodeMirror
  // moves them with the edits until the next build replaces them.
  $effect(() => {
    void value;
    const { source, items } = diagnostics;
    if (view && view.state.doc.toString() === source)
      view.dispatch(setDiagnostics(view.state, editorDiagnostics(view.state, items)));
  });

  $effect(() => {
    if (!view) return;
    view.dispatch({ effects: editableCompartment.reconfigure(editableExtensions(editable)) });
  });

  function editableExtensions(isEditable: boolean) {
    return isEditable ? [] : [EditorView.editable.of(false), EditorState.readOnly.of(true)];
  }
</script>

<div bind:this={host} class="h-full min-h-0 overflow-hidden" aria-label={ariaLabel}></div>
