<script lang="ts">
  /**
   * A presentation named in an assistant's message: choosing it views it, Shift-choosing compares
   * it; on hover or focus, its code button shows its source and + adds it to the feedback.
   */
  import CodeIcon from '@lucide/svelte/icons/code';

  import CandidateIdPill from '$lib/client/visualization/CandidateIdPill.svelte';
  import type { CandidateId } from '$lib/client/visualization/presentation-history';

  type Props = {
    candidate: CandidateId;
    /** Its name, for assistive technology. */
    name: string;
    /** What it shows, as its tooltip. */
    summary?: string;
    /** Which side of a pair, where it is one, before the pill at the text's size. */
    label?: string;
    /** Whether it is shown on the stage. */
    selected: boolean;
    onView: (event: MouseEvent) => void;
    /** Show its source on its own; absent where it has none to show. */
    onSource?: () => void;
    /** Whether its source is the one shown on its own. */
    sourceShown?: boolean;
    /** Add it to the feedback; absent where the feedback cannot change. */
    onAdd?: () => void;
  };

  let {
    candidate,
    name,
    summary,
    label,
    selected,
    onView,
    onSource,
    sourceShown = false,
    onAdd
  }: Props = $props();
  const tooltip = $derived(
    `${summary ? `${summary.replaceAll('`', '')}\n` : ''}View; Shift-click to compare`
  );
  const action =
    'rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none';
</script>

{#if label}<span class="mr-1.5 font-medium text-muted-foreground">{label}</span>{/if}
<span class={['group/pill relative inline-flex align-middle', !label && 'mx-1']}>
  <button
    type="button"
    class={[
      'group inline-flex rounded-md leading-none focus-visible:outline-none',
      selected && 'ring-2 ring-primary'
    ]}
    aria-label={`View ${name}`}
    aria-pressed={selected}
    title={tooltip}
    onclick={onView}
  >
    <CandidateIdPill {...candidate} title={tooltip} />
  </button>
  {#if onSource || onAdd}
    <!-- Above the pill, out of the text's way; its padding bridges the gap so hover reaches it. -->
    <span
      class="pointer-events-none absolute bottom-full left-1/2 z-20 -translate-x-1/2 pb-1 opacity-0 transition-opacity group-focus-within/pill:pointer-events-auto group-focus-within/pill:opacity-100 group-hover/pill:pointer-events-auto group-hover/pill:opacity-100"
    >
      <span class="flex items-center gap-0.5 rounded-md border bg-popover p-0.5 shadow-md">
        {#if onSource}
          <button
            type="button"
            class={[action, sourceShown && 'bg-accent text-foreground']}
            aria-label={`Show the source of ${name}`}
            aria-pressed={sourceShown}
            title="Show the source"
            onclick={onSource}><CodeIcon class="size-3.5" /></button
          >
        {/if}
        {#if onAdd}
          <button
            type="button"
            class={[action, 'px-1.5 py-0 font-mono text-xs leading-5']}
            aria-label={`Add ${name} to feedback`}
            title="Add to feedback"
            onclick={onAdd}>+</button
          >
        {/if}
      </span>
    </span>
  {/if}
</span>
