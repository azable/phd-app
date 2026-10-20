<script lang="ts">
  /**
   * A candidate's identifier, its source then its values: the source tinted by its own hue, so
   * candidates of one source match at a glance, and the values beside it.
   */
  type Props = {
    source: string;
    hue: number;
    /** The values its random variables took; absent for a source alone. */
    values?: string;
    /** Which side of a pair, when two are shown. */
    label?: string;
  };

  let { source, hue, values, label }: Props = $props();
</script>

<span class="inline-flex items-center gap-1.5 align-middle text-xs">
  {#if label}<span class="font-medium text-muted-foreground">{label}</span>{/if}
  <span
    class="inline-flex overflow-hidden rounded-md font-mono leading-5 ring-1 ring-border transition-shadow group-hover:ring-foreground/60 group-focus-visible:ring-2 group-focus-visible:ring-ring"
    style:--pill-hue={hue}
    title={values
      ? `Source ${source}, values ${values}. Candidates of one source can be compared.`
      : `Source ${source}`}
  >
    <span
      class="bg-[hsl(var(--pill-hue)_70%_55%/0.32)] px-1.5 font-semibold transition-colors group-hover:bg-[hsl(var(--pill-hue)_70%_55%/0.55)]"
      >{source}</span
    >
    {#if values}<span
        class="bg-muted/60 px-1.5 transition-colors group-hover:bg-accent group-hover:text-accent-foreground"
        >{values}</span
      >{/if}
  </span>
</span>
