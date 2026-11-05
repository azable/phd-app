<script lang="ts">
  import { resolve } from '$app/paths';

  import * as AlertDialog from '$lib/client/components/ui/alert-dialog';
  import { Button } from '$lib/client/components/ui/button';
  import { Spinner } from '$lib/client/components/ui/spinner';

  type Props = {
    open: boolean;
    context?: 'participant' | 'admin-preview';
    /** The phase that ended, so continuing advances from it at most once. */
    phaseId?: string;
    /** Whether the last request is still finishing, which continuing waits for. */
    finishing?: boolean;
  };
  let { open, context = 'participant', phaseId, finishing = false }: Props = $props();
  let advancing = $state(false);
</script>

<AlertDialog.Root {open}>
  <AlertDialog.Content onEscapeKeydown={(event) => event.preventDefault()}>
    <AlertDialog.Header>
      <AlertDialog.Title>Time is up</AlertDialog.Title>
      <AlertDialog.Description>
        {context === 'admin-preview'
          ? 'This preview has reached its configured time limit. Advance it or return to administration.'
          : finishing
            ? 'This phase has ended. Your last request is still finishing; you can continue when it is done.'
            : 'This phase has ended. Your work has been saved and this project is now read-only.'}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      {#if context === 'admin-preview'}
        <Button href={resolve('/admin')} variant="outline">Return to administration</Button>
        <form method="POST" action="?/forcePreview" onsubmit={() => (advancing = true)}>
          <Button
            type="submit"
            disabled={advancing}
            aria-busy={advancing}
            aria-label={advancing ? 'Advancing preview' : undefined}
          >
            {#if advancing}<Spinner data-icon="inline-start" />Advancing…{:else}Next phase{/if}
          </Button>
        </form>
      {:else}
        <form
          method="POST"
          action={`${resolve('/study')}?/continue`}
          onsubmit={() => (advancing = true)}
        >
          {#if phaseId}<input type="hidden" name="phaseId" value={phaseId} />{/if}
          <Button
            type="submit"
            disabled={advancing || finishing}
            aria-busy={advancing || finishing}
            aria-label={advancing ? 'Continuing study' : undefined}
          >
            {#if advancing}<Spinner
                data-icon="inline-start"
              />Continuing…{:else if finishing}<Spinner data-icon="inline-start" />Finishing your
              last request…{:else}Continue study{/if}
          </Button>
        </form>
      {/if}
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
