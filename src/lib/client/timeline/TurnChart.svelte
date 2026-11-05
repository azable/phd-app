<script lang="ts">
  import type { ChartBar, ChartOutcome, TurnChart } from './turn-chart';

  let { chart }: { chart: TurnChart } = $props();

  let chosen = $state<string>();
  const detail = $derived(chart.bars.find(({ id }) => id === chosen));

  const colour: Record<ChartOutcome, string> = {
    ok: 'bg-emerald-500',
    failed: 'bg-destructive',
    rejected: 'bg-amber-500',
    incomplete: 'bg-orange-500',
    pending: 'bg-muted-foreground/40'
  };
  const percent = (ms: number) => `${(ms / chart.span) * 100}%`;
  const fill = (bar: ChartBar) => (bar.kind === 'helper' ? 'bg-sky-500' : colour[bar.outcome]);
  const calls = $derived(chart.bars.filter(({ kind }) => kind === 'call'));
  const failures = $derived(calls.filter(({ outcome }) => outcome !== 'ok').length);
  const seconds = $derived(Math.round(chart.span / 1000));
</script>

<!-- An operation's model calls and builds on one time axis, for the developer view. -->
<details
  class="ml-6 w-[calc(100%-1.5rem)] min-w-0 rounded-lg border border-dashed px-2 py-1 text-xs text-muted-foreground open:border-solid open:text-foreground"
>
  <summary class="cursor-pointer">
    {chart.followUp ? 'Follow-up turn' : 'Turn'} · {calls.length}
    {calls.length === 1 ? 'call' : 'calls'}{failures ? ` · ${failures} not ok` : ''} · {seconds} s
  </summary>
  <div class="mt-1.5 flex flex-col gap-0.5" role="group" aria-label="Calls and builds over time">
    {#each chart.bars as bar (bar.id)}
      <button
        type="button"
        class={[
          'grid w-full grid-cols-[minmax(0,11rem)_1fr] items-center gap-2 rounded px-1 text-left hover:bg-muted',
          chosen === bar.id && 'bg-muted'
        ]}
        title={bar.detail || bar.label}
        aria-pressed={chosen === bar.id}
        onclick={() => (chosen = chosen === bar.id ? undefined : bar.id)}
      >
        <span class={['truncate', bar.kind === 'build' && 'pl-3 text-muted-foreground']}
          >{bar.label}</span
        >
        <span class="relative h-3">
          <span
            class={['absolute inset-y-0 min-w-0.5 rounded-sm', fill(bar)]}
            style:left={percent(bar.start)}
            style:width={percent(Math.max(bar.end - bar.start, chart.span / 200))}
          ></span>
        </span>
      </button>
    {/each}
    {#if chart.marks.length}
      <div class="grid grid-cols-[minmax(0,11rem)_1fr] gap-2 px-1">
        <span class="text-muted-foreground">events</span>
        <span class="relative h-3">
          {#each chart.marks as mark (mark.id)}
            <span
              class="absolute inset-y-0 w-0.5 bg-foreground"
              style:left={percent(mark.at)}
              title={`${mark.label} at ${(mark.at / 1000).toFixed(1)} s`}
            ></span>
          {/each}
        </span>
      </div>
    {/if}
  </div>
  {#if detail}
    <p class="mt-1.5 rounded bg-muted px-2 py-1 font-mono break-words whitespace-pre-wrap">
      {detail.label}{detail.detail ? `\n${detail.detail}` : ''}
    </p>
  {/if}
</details>
