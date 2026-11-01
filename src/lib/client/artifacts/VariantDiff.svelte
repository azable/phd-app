<script lang="ts">
  import { MergeView, unifiedMergeView } from '@codemirror/merge';
  import { EditorState, type Extension } from '@codemirror/state';
  import { EditorView } from 'codemirror';

  import { artifactEditorExtensions } from './artifact-editor';

  /** Two documents shown together, read-only, the rows that differ marked. */
  type Props = {
    a: string;
    b: string;
    aLabel: string;
    bLabel: string;
    ariaLabel?: string;
  };

  let { a, b, aLabel, bLabel, ariaLabel = 'Differences' }: Props = $props();

  // Below this width the two documents are stacked in one column rather than side by side.
  const sideBySideMinWidth = 560;
  // As a diff viewer shows them: two rows around each change, longer unchanged runs folded.
  const collapseUnchanged = { margin: 2, minSize: 4 };

  let host = $state<HTMLElement | null>(null);
  let width = $state(0);
  const sideBySide = $derived(width >= sideBySideMinWidth);

  const readOnly: Extension[] = [
    ...artifactEditorExtensions({ language: 'json' }),
    EditorView.lineWrapping,
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    // The merge view's own tints are faint; differing rows should stand out.
    EditorView.theme({
      '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
        backgroundColor: 'rgba(238, 68, 51, .14)'
      },
      '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
        backgroundColor: 'rgba(34, 187, 34, .14)'
      }
    })
  ];

  $effect(() => {
    if (!host) return;
    const parent = host;
    if (sideBySide) {
      const view = new MergeView({
        a: { doc: a, extensions: readOnly },
        b: { doc: b, extensions: readOnly },
        parent,
        gutter: true,
        collapseUnchanged
      });
      view.dom.style.height = '100%';
      return () => view.destroy();
    }
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: b,
        extensions: [
          ...readOnly,
          unifiedMergeView({ original: a, mergeControls: false, gutter: true, collapseUnchanged })
        ]
      })
    });
    return () => view.destroy();
  });
</script>

<div class="flex h-full min-h-0 flex-col" aria-label={ariaLabel} bind:clientWidth={width}>
  <div
    class={[
      'grid border-b font-mono text-xs text-muted-foreground',
      sideBySide ? 'grid-cols-2' : 'grid-cols-1'
    ]}
  >
    {#if sideBySide}
      <span class="flex items-center gap-1.5 px-3 py-1">
        <span class="size-2 rounded-sm bg-[rgba(238,68,51,.5)]"></span>{aLabel}
      </span>
      <span class="flex items-center gap-1.5 border-l px-3 py-1">
        <span class="size-2 rounded-sm bg-[rgba(34,187,34,.5)]"></span>{bLabel}
      </span>
    {:else}
      <span class="flex items-center gap-3 px-3 py-1">
        <span class="flex items-center gap-1.5">
          <span class="size-2 rounded-sm bg-[rgba(238,68,51,.5)]"></span>{aLabel}, above
        </span>
        <span class="flex items-center gap-1.5">
          <span class="size-2 rounded-sm bg-[rgba(34,187,34,.5)]"></span>{bLabel}, below
        </span>
      </span>
    {/if}
  </div>
  <div bind:this={host} class="min-h-0 flex-1 overflow-hidden"></div>
</div>
