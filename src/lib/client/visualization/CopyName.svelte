<script lang="ts">
  /** A button copying a presentation's name, as `3fa2c1/Misty-Falcon-09`, to paste elsewhere. */
  import CheckIcon from '@lucide/svelte/icons/check';
  import CopyIcon from '@lucide/svelte/icons/copy';

  import { copyText } from './copy-text';

  type Props = { name: string; class?: string };

  let { name, class: className }: Props = $props();
  let copied = $state(false);

  async function copy(event: MouseEvent) {
    event.stopPropagation();
    copied = await copyText(name);
    if (copied) setTimeout(() => (copied = false), 1500);
  }
</script>

<button
  type="button"
  class={[
    'rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none',
    className
  ]}
  aria-label={copied ? `Copied ${name}` : `Copy the name ${name}`}
  title={copied ? 'Copied' : `Copy ${name} (Alt+Shift+C copies the shown one)`}
  onclick={copy}
>
  {#if copied}<CheckIcon class="size-3.5" />{:else}<CopyIcon class="size-3.5" />{/if}
</button>
