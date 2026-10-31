<!--
  Dev-mode controls for more variants of the source as it is: which chooser picks them, and the
  button asking for them (New pair in a comparison, Another variant alone).
-->
<script lang="ts">
  import ShuffleIcon from '@lucide/svelte/icons/shuffle';

  import { Button } from '$lib/client/components/ui/button';
  import { Spinner } from '$lib/client/components/ui/spinner';
  import { chooserIds, type ChooserId } from '$lib/shared/choosers';
  import type { PresentationLayout } from '$lib/shared/presentations';

  import type { ProjectSession } from './project-session.svelte';

  type Props = {
    session: ProjectSession;
    layout: PresentationLayout;
    /** The candidate whose source is resampled, when there is one. */
    from?: string;
    configuredChooser?: ChooserId;
    disabled?: boolean;
    onMade?: () => void;
  };

  let {
    session,
    layout,
    from,
    configuredChooser = 'model',
    disabled = false,
    onMade = () => {}
  }: Props = $props();

  const remembered = 'sverlin.dev.chooser';
  const labels: Record<ChooserId, string> = {
    model: 'Model',
    decisions: 'Decisions API',
    random: 'Random'
  };

  function rememberedChooser(): ChooserId | undefined {
    try {
      const value = localStorage.getItem(remembered);
      return chooserIds.find((id) => id === value);
    } catch {
      return undefined;
    }
  }

  // svelte-ignore state_referenced_locally
  let chooser = $state<ChooserId>(configuredChooser);
  $effect(() => {
    const value = rememberedChooser();
    if (value) chooser = value;
  });

  function choose(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    chooser = chooserIds.find((id) => id === value) ?? configuredChooser;
    try {
      localStorage.setItem(remembered, chooser);
    } catch {
      // A browser without storage keeps the pick for this page only.
    }
  }

  async function generate() {
    const made = await session.runCommand({
      type: 'resample',
      presentationCount: layout === 'comparison' ? 2 : 1,
      chooser,
      ...(from ? { from } : {})
    });
    if (made) onMade();
  }
</script>

<div class="flex items-center gap-1">
  <select
    class="h-7 rounded-md border bg-background px-1.5 text-sm"
    value={chooser}
    onchange={choose}
    aria-label="Chooser"
    title="Which chooser picks the next variants"
  >
    {#each chooserIds as id (id)}
      <option value={id}>{labels[id]}{id === configuredChooser ? ' (configured)' : ''}</option>
    {/each}
  </select>
  <Button
    size="sm"
    variant="outline"
    aria-label={layout === 'comparison'
      ? 'Generate another visualization pair'
      : 'Generate another visualization variant'}
    onclick={generate}
    disabled={disabled || !session.atHead}
  >
    {#if session.pending?.type === 'resample'}
      <Spinner data-icon="inline-start" /> Generating…
    {:else}
      <ShuffleIcon data-icon="inline-start" />
      {layout === 'comparison' ? 'New pair' : 'Another variant'}
    {/if}
  </Button>
</div>
