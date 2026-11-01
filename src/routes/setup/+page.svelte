<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  import * as Alert from '$lib/client/components/ui/alert';
  import { Button } from '$lib/client/components/ui/button';
  import * as Card from '$lib/client/components/ui/card';
  import { authClient } from '$lib/client/auth';

  let pending = $state(false);
  let message = $state<string | null>(null);

  async function register() {
    if (pending) return;
    pending = true;
    message = null;
    try {
      const result = await authClient.passkey.addPasskey({
        name: 'Primary administrator passkey',
        createSession: true
      });
      if (result.error) {
        message = result.error.message ?? 'The passkey could not be registered.';
        return;
      }
      await goto(resolve('/'), { invalidateAll: true });
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'The passkey could not be registered.';
    } finally {
      pending = false;
    }
  }
</script>

<svelte:head><title>Set up administrator</title></svelte:head>

<main class="flex min-h-screen items-center justify-center bg-background p-6">
  <Card.Root class="w-full max-w-md">
    <Card.Header>
      <Card.Title>Register the administrator</Card.Title>
      <Card.Description>
        This one-time setup creates the local researcher account without a password. Use a synced
        passkey or hardware security key you can recover.
      </Card.Description>
    </Card.Header>
    <Card.Content>
      {#if message}
        <Alert.Root variant="destructive">
          <Alert.Title>Setup failed</Alert.Title>
          <Alert.Description>{message}</Alert.Description>
        </Alert.Root>
      {/if}
    </Card.Content>
    <Card.Footer>
      <Button type="button" class="w-full" disabled={pending} onclick={register}>
        {pending ? 'Registering passkey…' : 'Register administrator passkey'}
      </Button>
    </Card.Footer>
  </Card.Root>
</main>
