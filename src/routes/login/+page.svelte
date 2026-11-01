<script lang="ts">
  import { goto } from '$app/navigation';

  import * as Alert from '$lib/client/components/ui/alert';
  import { Button } from '$lib/client/components/ui/button';
  import * as Card from '$lib/client/components/ui/card';
  import { Input } from '$lib/client/components/ui/input';
  import { Label } from '$lib/client/components/ui/label';
  import { authClient } from '$lib/client/auth';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let participantId = $state('');
  let password = $state('');
  let pending = $state<'participant' | 'passkey' | null>(null);
  let message = $state<string | null>(null);

  async function completeSignIn(result: { error?: { message?: string } | null }) {
    if (result.error) {
      message = result.error.message ?? 'The credentials could not be verified.';
      return;
    }
    // The server has already constrained this path to the current origin.
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    await goto(data.next, { invalidateAll: true });
  }

  async function signInParticipant(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    pending = 'participant';
    message = null;
    try {
      await completeSignIn(await authClient.signIn.username({ username: participantId, password }));
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'The credentials could not be verified.';
    } finally {
      pending = null;
    }
  }

  async function signInResearcher() {
    if (pending) return;
    pending = 'passkey';
    message = null;
    try {
      await completeSignIn(await authClient.signIn.passkey());
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'The passkey could not be verified.';
    } finally {
      pending = null;
    }
  }
</script>

<svelte:head><title>Sign in</title></svelte:head>

<main class="flex min-h-screen items-center justify-center bg-background p-6">
  <Card.Root class="w-full max-w-sm">
    <Card.Header>
      <Card.Title>Sign in</Card.Title>
      <Card.Description>
        Participants use the ID and password supplied by the researcher.
      </Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
      {#if message}
        <Alert.Root variant="destructive">
          <Alert.Title>Sign-in failed</Alert.Title>
          <Alert.Description>{message}</Alert.Description>
        </Alert.Root>
      {/if}

      <form class="space-y-4" onsubmit={signInParticipant}>
        <div class="space-y-2">
          <Label for="participant-id">Participant ID</Label>
          <Input
            id="participant-id"
            name="username"
            autocomplete="username"
            required
            bind:value={participantId}
          />
        </div>
        <div class="space-y-2">
          <Label for="participant-password">Password</Label>
          <Input
            id="participant-password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            bind:value={password}
          />
        </div>
        <Button type="submit" class="w-full" disabled={pending !== null}>
          {pending === 'participant' ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div class="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <span class="h-px flex-1 bg-border"></span>
        <span>Researcher</span>
        <span class="h-px flex-1 bg-border"></span>
      </div>

      <Button
        type="button"
        class="w-full"
        variant="outline"
        disabled={pending !== null}
        onclick={signInResearcher}
      >
        {pending === 'passkey' ? 'Checking passkey…' : 'Sign in with a passkey'}
      </Button>
    </Card.Content>
  </Card.Root>
</main>
