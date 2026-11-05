<!--
  Dev-mode control for more variants of the source as it is, drawn at random: New pair in a
  comparison, Another variant alone.
-->
<script lang="ts">
  import ShuffleIcon from '@lucide/svelte/icons/shuffle';

  import { Button } from '$lib/client/components/ui/button';
  import { Spinner } from '$lib/client/components/ui/spinner';
  import type { PresentationLayout } from '$lib/shared/presentations';

  import type { ProjectSession } from './project-session.svelte';

  type Props = {
    session: ProjectSession;
    layout: PresentationLayout;
    /** The candidate whose source is resampled, when there is one. */
    from?: string;
    disabled?: boolean;
    onMade?: () => void;
  };

  let { session, layout, from, disabled = false, onMade = () => {} }: Props = $props();

  async function generate() {
    const made = await session.runCommand({
      type: 'resample',
      presentationCount: layout === 'comparison' ? 2 : 1,
      ...(from ? { from } : {})
    });
    if (made) onMade();
  }
</script>

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
