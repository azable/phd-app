<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';

  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

  import { Button } from '$lib/client/components/ui/button';
  import * as Card from '$lib/client/components/ui/card';
  import { Spinner } from '$lib/client/components/ui/spinner';
  import { ProjectInteractionDelivery } from '$lib/client/study/interaction-delivery';

  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const phase = $derived(data.state.phase);
  const title = $derived(phase.kind === 'task' ? phase.instructions.title : phase.title);
  let continuing = $state(false);

  onMount(() => {
    const delivery = new ProjectInteractionDelivery({
      participantId: data.interactionParticipantId
    });
    delivery.start();
    return () => delivery.stop();
  });
</script>

<svelte:head><title>{title}</title></svelte:head>

<main class="dark grid min-h-screen place-items-center bg-background p-6 text-foreground">
  <Card.Root class="w-full max-w-xl">
    <Card.Header>
      <Card.Title>{title}</Card.Title>
      {#if phase.kind === 'task' && data.state.expired}
        <Card.Description>Your time for this task has ended.</Card.Description>
      {/if}
    </Card.Header>
    <Card.Content class="flex flex-col gap-3 text-sm text-muted-foreground">
      {#if form?.error}
        <p
          class="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive"
          role="alert"
        >
          {form.error}
        </p>
      {/if}
      {#if phase.kind === 'task'}
        <p>Your project has been locked. Continue when you are ready for the next phase.</p>
      {:else}
        {#each phase.paragraphs as paragraph (paragraph)}
          <p>{paragraph}</p>
        {/each}
        {#if phase.kind === 'completion'}
          {#if data.giftCardUrl}
            <div>
              <Button
                href={data.giftCardUrl}
                target="_blank"
                rel="noopener noreferrer"
                referrerpolicy="no-referrer"
              >
                Open your gift card<ExternalLinkIcon data-icon="inline-end" />
              </Button>
            </div>
          {:else}
            <p>No gift card has been assigned. Please contact the researcher.</p>
          {/if}
        {/if}
      {/if}
    </Card.Content>
    <Card.Footer class="flex justify-between gap-3">
      {#if phase.kind !== 'completion'}
        <form
          method="POST"
          action={`${resolve('/study')}?/continue`}
          onsubmit={() => (continuing = true)}
        >
          <input type="hidden" name="phaseId" value={phase.id} />
          <Button
            type="submit"
            disabled={continuing}
            aria-busy={continuing}
            aria-label={continuing ? 'Continuing study' : undefined}
          >
            {#if continuing}
              <Spinner data-icon="inline-start" />Continuing…
            {:else}
              {phase.kind === 'instruction' ? phase.continueLabel : 'Continue'}
            {/if}
          </Button>
        </form>
      {/if}
      <form method="POST" action={resolve('/logout')} class="ml-auto">
        <Button type="submit" variant={phase.kind === 'completion' ? 'default' : 'outline'}>
          Sign out
        </Button>
      </form>
    </Card.Footer>
  </Card.Root>
</main>
