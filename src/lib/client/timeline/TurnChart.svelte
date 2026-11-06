<script lang="ts">
  import type { ChartBar, ChartOutcome, TurnChart } from './turn-chart';

  let {
    chart,
    chosenRequest,
    onChooseRequest = () => {}
  }: {
    chart: TurnChart;
    /** The request open for audit, if any, by its event id. */
    chosenRequest?: number;
    onChooseRequest?: (eventId: number | undefined) => void;
  } = $props();

  let chosen = $state<string>();
  const detail = $derived(chart.bars.find(({ id }) => id === chosen));

  const colour: Record<ChartOutcome, string> = {
    ok: 'bg-emerald-500',
    failed: 'bg-destructive',
    rejected: 'bg-amber-500',
    incomplete: 'bg-orange-500',
    pending: 'bg-muted-foreground/40'
  };
  // A helper round's agents by their part; any that did not end well in its outcome's colour.
  const agentColour: Partial<Record<ChartBar['kind'], string>> = {
    helper: 'bg-sky-500',
    scoring: 'bg-violet-500',
    choosing: 'bg-indigo-500'
  };
  const percent = (ms: number) => `${(ms / chart.span) * 100}%`;
  const fill = (bar: ChartBar) =>
    (bar.outcome === 'ok' && agentColour[bar.kind]) || colour[bar.outcome];
  const calls = $derived(chart.bars.filter(({ kind }) => kind !== 'build'));
  const failures = $derived(calls.filter(({ outcome }) => outcome !== 'ok').length);
  const seconds = $derived(Math.round(chart.span / 1000));
  const title = $derived(
    chart.followUp
      ? 'Follow-up turn'
      : chart.operation === 'assistant-turn' || chart.operation === undefined
        ? 'Turn'
        : chart.operation.replaceAll('-', ' ')
  );

  function choose(bar: ChartBar) {
    const again = chosen === bar.id;
    chosen = again ? undefined : bar.id;
    if (bar.requestId !== undefined) onChooseRequest(again ? undefined : bar.requestId);
  }
</script>

<!-- An operation's model calls and builds on one time axis, for the developer view: its one item
  for them; choosing a call shows its details and opens its request. -->
<details
  class={[
    'ml-6 w-[calc(100%-1.5rem)] min-w-0 rounded-lg border border-dashed px-2 py-1 text-xs text-muted-foreground open:border-solid open:text-foreground',
    chart.background && 'bg-muted/40'
  ]}
  open={!chart.background}
>
  <summary class="cursor-pointer">
    <span class="first-letter:uppercase">{title}</span>{chart.background ? ' (background)' : ''} ·
    {chart.cost ?? `${calls.length} ${calls.length === 1 ? 'call' : 'calls'}`}{failures
      ? ` · ${failures} not ok`
      : ''} · {seconds} s
  </summary>
  <div class="mt-1.5 flex flex-col gap-0.5" role="group" aria-label="Calls and builds over time">
    {#each chart.bars as bar (bar.id)}
      <button
        type="button"
        class={[
          'grid w-full grid-cols-[minmax(0,11rem)_1fr] items-center gap-2 rounded px-1 text-left hover:bg-muted',
          (chosen === bar.id || (bar.requestId !== undefined && chosenRequest === bar.requestId)) &&
            'bg-muted'
        ]}
        title={bar.detail || bar.label}
        aria-pressed={chosen === bar.id}
        onclick={() => choose(bar)}
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
