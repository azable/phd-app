<script lang="ts">
  import type { Component } from 'svelte';
  import { Skeleton } from '$lib/client/components/ui/skeleton';
  import { modeCatalog } from '$lib/modes/catalog';
  import type { SelectedElement } from './visual-selection.svelte';
  import type { AnnotationPin, CommentAnchor } from './visual-annotations.svelte';
  import type { FramePoint } from '$lib/shared/projects/events/message-content';
  import type { CanvasView } from '$lib/modes/sandbox';
  import type { RenderedFile, RenderTarget } from '$lib/modes/render-targets';
  import type { PresentationLoadTiming } from '$lib/shared/presentation-load-timing';
  import {
    presentationMode,
    type RenderablePresentation,
    type VisualizationMode
  } from '$lib/shared/presentations';

  type ViewportProps = {
    presentation: RenderablePresentation;
    /** The project the presentation is in, for modes that fetch more of it from the server. */
    projectId?: string;
    step: number;
    label: string;
    /** Ids of the elements to show selected, in modes that support selection. */
    selection?: readonly string[];
    onSelectionChange?: (elements: SelectedElement[]) => void;
    /** The comments pinned at the step shown, in modes that support selection. */
    pins?: readonly AnnotationPin[];
    /** What the comment being written is on, its card open beside it, in modes with comments. */
    composing?: CommentAnchor;
    /** The words of the comment written in its card. */
    onComment?: (text: string) => void;
    /** The comment being written was given up in its card. */
    onComposeCancel?: () => void;
    /** Where a click fell in the frame, in modes that support selection. */
    onPoint?: (point: FramePoint) => void;
    onViewChange?: (view: CanvasView) => void;
    /** The presentation's own code failed as it drew, in modes that run authored code. */
    onRuntimeError?: (failure: { step?: number; message: string }) => void;
    /** How long the presentation took to appear, in modes that report it. */
    onLoadTiming?: (timing: PresentationLoadTiming) => void;
    /**
     * Build the presentation again from its source, in modes that cannot show one an older app
     * built; why that failed, if it did. Given only where the viewer may change the project.
     */
    onRebuild?: () => Promise<string | undefined>;
  };

  let {
    presentation,
    projectId,
    step,
    label,
    selection,
    onSelectionChange,
    pins,
    composing,
    onComment,
    onComposeCancel,
    onPoint,
    onViewChange,
    onRuntimeError,
    onLoadTiming,
    onRebuild
  }: Omit<ViewportProps, 'presentation'> & { presentation?: RenderablePresentation } = $props();
  /** What a mode's playback component may offer: the files its presentations export as. */
  type ViewportExports = {
    renderTargets?: () => RenderTarget[];
    render?: (target: string) => Promise<RenderedFile>;
  };
  const viewports = import.meta.glob<{
    default: Component<ViewportProps, ViewportExports>;
  }>('../../modes/*/Viewport.svelte', { eager: true });
  const registered = Object.fromEntries(
    Object.entries(viewports).map(([file, module]) => [file.split('/').at(-2), module.default])
  ) as Partial<Record<VisualizationMode, Component<ViewportProps, ViewportExports>>>;
  for (const mode of Object.keys(modeCatalog) as VisualizationMode[]) {
    if (!registered[mode])
      throw new Error(`Visualization mode ${mode} needs a playback component.`);
  }
  const Viewport = $derived(presentation ? registered[presentationMode(presentation)] : undefined);
  let viewport = $state<ViewportExports>();

  /** The files this presentation can be exported as; none in modes that offer no exports. */
  export function renderTargets(): RenderTarget[] {
    return viewport?.renderTargets?.() ?? [];
  }

  export function render(target: string): Promise<RenderedFile> {
    return (
      viewport?.render?.(target) ??
      Promise.reject(new Error('This visualization cannot be exported.'))
    );
  }
</script>

<section class="relative min-h-0 flex-1 overflow-hidden bg-white" aria-label={label}>
  {#if presentation && Viewport}
    <Viewport
      bind:this={viewport}
      {presentation}
      {projectId}
      {step}
      {label}
      {selection}
      {onSelectionChange}
      {pins}
      {composing}
      {onComment}
      {onComposeCancel}
      {onPoint}
      {onViewChange}
      {onRuntimeError}
      {onLoadTiming}
      {onRebuild}
    />
  {:else}
    <div class="flex min-h-full items-center justify-center p-6">
      <div class="flex w-full max-w-md flex-col gap-3">
        <Skeleton class="h-8 w-48" />
        <Skeleton class="h-4 w-2/3" />
        <Skeleton class="h-4 w-5/6" />
      </div>
    </div>
  {/if}
</section>
