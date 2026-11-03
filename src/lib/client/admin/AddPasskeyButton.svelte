<script lang="ts">
  import * as Alert from '$lib/client/components/ui/alert';
  import { Button } from '$lib/client/components/ui/button';
  import { Spinner } from '$lib/client/components/ui/spinner';
  import { authClient } from '$lib/client/auth';

  let pending = $state(false);
  let outcome = $state<{ added: true } | { error: string }>();

  async function add() {
    if (pending) return;
    pending = true;
    outcome = undefined;
    try {
      const result = await authClient.passkey.addPasskey({ name: 'Administrator passkey' });
      outcome = result.error
        ? { error: result.error.message ?? 'The passkey could not be added.' }
        : { added: true };
    } catch (cause) {
      outcome = {
        error: cause instanceof Error ? cause.message : 'The passkey could not be added.'
      };
    } finally {
      pending = false;
    }
  }
</script>

<Button type="button" variant="outline" disabled={pending} onclick={add}>
  {#if pending}<Spinner />{/if}
  Add passkey
</Button>

{#if outcome && 'added' in outcome}
  <Alert.Root class="basis-full">
    <Alert.Title>Passkey added</Alert.Title>
    <Alert.Description
      >You can now sign in with it as well as your other passkeys.</Alert.Description
    >
  </Alert.Root>
{:else if outcome}
  <Alert.Root variant="destructive" class="basis-full">
    <Alert.Title>Passkey not added</Alert.Title>
    <Alert.Description>{outcome.error}</Alert.Description>
  </Alert.Root>
{/if}
