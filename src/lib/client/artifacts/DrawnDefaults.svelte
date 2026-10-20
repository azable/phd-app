<script lang="ts">
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

  import { drawnDefaults } from './drawn-defaults';

  /** Public properties for the strip of drawn Node defaults above the source. */
  type Props = {
    /** The visible presentations' recorded defaults, labelled when there are two. */
    presentations: readonly { label?: string; defaults?: unknown }[];
  };

  let { presentations }: Props = $props();

  let open = $state(false);
  const rows = $derived(drawnDefaults(presentations));
  const differing = $derived(rows.filter(({ differs }) => differs).length);
</script>

{#if rows.length}
  <div class="border-b bg-muted/40 px-4 py-2 text-sm">
    <button
      type="button"
      class="flex items-center gap-1 text-muted-foreground hover:text-foreground"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      <ChevronRightIcon class={['size-4 transition-transform', open && 'rotate-90']} />
      Drawn defaults
      <span class="text-xs">
        · props every node takes unless it sets them{presentations.length > 1
          ? ` · ${differing} differ`
          : ''}
      </span>
    </button>
    {#if open}
      <dl class="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        {#each rows as row (row.key)}
          <dt class={row.differs ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}>
            {row.key}
          </dt>
          <dd class="flex flex-wrap gap-2">
            {#each row.values as value, index (index)}
              <span
                class={[
                  'inline-flex items-center gap-1 rounded px-1.5',
                  row.differs ? 'bg-amber-500/15' : 'bg-green-600/10'
                ]}
              >
                {#if value.label}<span class="font-semibold text-muted-foreground"
                    >{value.label}</span
                  >{/if}
                {#if value.color}<span
                    class="inline-block size-3 rounded-sm border"
                    style:background-color={value.color}
                  ></span>{/if}
                {value.text}
              </span>
            {/each}
          </dd>
        {/each}
      </dl>
    {/if}
  </div>
{/if}
