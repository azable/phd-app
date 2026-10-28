<script lang="ts">
  import type { Component } from 'svelte';
  import { Skeleton } from '$lib/client/components/ui/skeleton';
  import { modeCatalog } from '$lib/modes/catalog';
  import type { SelectedElement } from './visual-selection.svelte';
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
    step: number;
    label: string;
    /** Ids of the elements to show selected, in modes that support selection. */
    selection?: readonly string[];
    onSelectionChange?: (elements: SelectedElement[]) => void;
    onViewChange?: (view: CanvasView) => void;
    /** The presentation's own code failed as it drew, in modes that run authored code. */
    onRuntimeError?: (failure: { step?: number; message: string }) => void;
    /** How long the presentation took to appear, in modes that report it. */
    onLoadTiming?: (timing: PresentationLoadTiming) => void;
  };

  let {
    presentation,
    step,
    label,
    selection,
    onSelectionChange,
    onViewChange,
    onRuntimeError,
    onLoadTiming
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
      {step}
      {label}
      {selection}
      {onSelectionChange}
      {onViewChange}
      {onRuntimeError}
      {onLoadTiming}
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
