<!--
  Dev mode's account of what the project's model calls cost: its total in the admin bar, updating
  as calls are recorded, and each operation's (a turn with its repairs, or a helper run) in a menu.
-->
<script lang="ts">
  import { Button } from '$lib/client/components/ui/button';
  import * as DropdownMenu from '$lib/client/components/ui/dropdown-menu';
  import { aiCalls, costText, costTotal, operationCosts } from '$lib/shared/projects/ai-costs';
  import type { ProjectEvent } from '$lib/shared/projects/events';

  let { events }: { events: readonly ProjectEvent[] } = $props();

  const calls = $derived(aiCalls(events));
  const total = $derived(costTotal(calls));
  // Newest first, each named by what started it, as assistant-turn.
  const operations = $derived(
    operationCosts(calls)
      .map(({ operationId, total }, index) => {
        const accepted = events.find(
          (event) => event.type === 'operation.accepted' && event.operationId === operationId
        );
        const kind = accepted?.type === 'operation.accepted' ? accepted.payload.kind : 'operation';
        const purposes = [
          ...new Set(
            calls.filter((call) => call.operationId === operationId).map((call) => call.purpose)
          )
        ].join(', ');
        return { operationId, label: `${index + 1}. ${kind} (${purposes})`, total };
      })
      .toReversed()
  );
</script>

{#if calls.length}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          size="sm"
          variant="ghost"
          class="h-7 px-2 text-xs text-muted-foreground tabular-nums"
          title="What this project's model calls cost, by turn">{costText(total)}</Button
        >
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="max-h-96 overflow-y-auto">
      <DropdownMenu.Label>Model calls by turn</DropdownMenu.Label>
      {#each operations as { operationId, label, total } (operationId)}
        <div class="px-2 py-1 text-xs">
          <div class="font-medium">{label}</div>
          <div class="text-muted-foreground tabular-nums">{costText(total)}</div>
        </div>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
