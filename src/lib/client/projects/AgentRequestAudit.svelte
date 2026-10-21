<script lang="ts">
  import BotIcon from '@lucide/svelte/icons/bot';
  import XIcon from '@lucide/svelte/icons/x';

  import CodeMirrorEditor from '$lib/client/artifacts/CodeMirrorEditor.svelte';
  import { Button } from '$lib/client/components/ui/button';
  import { ScrollArea } from '$lib/client/components/ui/scroll-area';
  import * as Tabs from '$lib/client/components/ui/tabs';
  import {
    agentDecision,
    agentOutcome,
    agentPrompt,
    agentTokens,
    type AgentRequest
  } from '$lib/client/timeline/agent-requests';
  import { presentProjectEvent } from '$lib/client/timeline/event-presentation';

  /**
   * One request to a model, for audit: the prompt exactly as sent (its instructions, conversation,
   * context, and parameters), the response, and what the project did with it.
   */
  type Props = {
    value: AgentRequest;
    onClose?: () => void;
  };

  let { value, onClose = () => {} }: Props = $props();

  const request = $derived(value.request);
  const prompt = $derived(agentPrompt(value));
  const decision = $derived(agentDecision(value));
  const tokens = $derived(agentTokens(value));
  const outcome = $derived(value.outcome);
  const tabs = [
    ['instructions', 'Instructions'],
    ['conversation', 'Conversation'],
    ['context', 'Context'],
    ['response', 'Response'],
    ['actions', 'Actions']
  ] as const;
  const json = (data: unknown) => JSON.stringify(data, null, 2) ?? '';
  const responseText = $derived(
    outcome?.type === 'ai.generation-succeeded' ? outcome.payload.response.text : ''
  );
  // The reply's segments as text, references by their ids.
  const replyText = $derived(
    Array.isArray(decision?.reply)
      ? (decision.reply as { type: string; text?: string; presentationId?: string }[])
          .map((segment) => segment.text ?? `[${segment.type} ${segment.presentationId ?? ''}]`)
          .join('')
      : ''
  );
</script>

<section
  class="flex min-h-0 flex-1 flex-col overflow-hidden border-l bg-card"
  aria-label="Agent request"
>
  <header class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm">
    <BotIcon class="size-4 text-muted-foreground" />
    <span class="font-medium">Agent request · attempt {request.payload.attempt}</span>
    <span class="text-muted-foreground">{request.payload.purpose}</span>
    <span class="font-mono text-xs text-muted-foreground">
      {outcome?.type === 'ai.generation-succeeded'
        ? (outcome.payload.model ?? request.payload.requestedModel)
        : request.payload.requestedModel}{outcome
        ? ` · ${(outcome.payload.durationMs / 1000).toFixed(1)} s`
        : ''}{tokens.read !== undefined
        ? ` · ${tokens.read.toLocaleString()} tokens read, ${tokens.written?.toLocaleString() ?? '?'} written`
        : ''}
    </span>
    <span class="mr-auto">{agentOutcome(value)}</span>
    <Button size="icon-sm" variant="ghost" aria-label="Close the request" onclick={onClose}
      ><XIcon /></Button
    >
  </header>

  <Tabs.Root value="response" class="flex min-h-0 flex-1 flex-col gap-0">
    <Tabs.List variant="line" class="w-full justify-start border-b px-3 pt-1 pb-1">
      {#each tabs as [tab, label] (tab)}
        <Tabs.Trigger
          value={tab}
          class="flex-none px-2.5 text-muted-foreground data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:after:bg-primary"
          >{label}</Tabs.Trigger
        >
      {/each}
    </Tabs.List>

    <Tabs.Content value="instructions" class="min-h-0 flex-1">
      <ScrollArea class="h-full">
        <pre class="p-4 font-mono text-xs whitespace-pre-wrap">{prompt?.initialPrompt ??
            request.payload.prompt.text}</pre>
      </ScrollArea>
    </Tabs.Content>

    <Tabs.Content value="conversation" class="min-h-0 flex-1">
      <ScrollArea class="h-full">
        <ol class="flex flex-col gap-3 p-4">
          {#each prompt?.messages ?? [] as message, index (index)}
            <li class="rounded-lg border px-3 py-2">
              <p class="mb-1 text-xs font-medium text-muted-foreground uppercase">
                {message.role}
              </p>
              <pre class="font-mono text-xs whitespace-pre-wrap">{message.content}</pre>
            </li>
          {:else}
            <li class="text-sm text-muted-foreground">No conversation was sent.</li>
          {/each}
        </ol>
      </ScrollArea>
    </Tabs.Content>

    <Tabs.Content value="context" class="flex min-h-0 flex-1 flex-col">
      <p class="px-4 pt-2 text-xs text-muted-foreground">
        The context, then the parameters and response schema, as sent.
      </p>
      <div class="min-h-0 flex-1 overflow-hidden">
        <CodeMirrorEditor
          value={json({
            context: prompt?.context,
            attempt: prompt?.attempt,
            parameters: prompt?.parameters,
            responseFormat: prompt?.responseFormat
          })}
          language="json"
          ariaLabel="Request context"
        />
      </div>
    </Tabs.Content>

    <Tabs.Content value="response" class="min-h-0 flex-1">
      <ScrollArea class="h-full">
        <div class="flex flex-col gap-4 p-4 text-sm">
          {#if outcome?.type === 'ai.generation-failed'}
            <p class="text-destructive">
              Failed ({outcome.payload.failureKind}): {outcome.payload.message}
            </p>
          {:else if decision}
            {#if replyText}
              <div>
                <h3 class="mb-1 text-xs font-medium text-muted-foreground uppercase">Reply</h3>
                <p class="whitespace-pre-wrap">{replyText}</p>
              </div>
            {/if}
            <div>
              <h3 class="mb-1 text-xs font-medium text-muted-foreground uppercase">Decision</h3>
              <p>
                <span class="font-mono">{decision.decision?.action ?? 'none'}</span>{decision
                  .decision?.summary
                  ? ` · ${decision.decision.summary}`
                  : ''}
              </p>
            </div>
            {#each decision.decision?.edits ?? [] as edit, index (index)}
              <div class="overflow-hidden rounded-lg border font-mono text-xs">
                <p class="border-b bg-muted px-3 py-1 font-sans text-muted-foreground">
                  Edit {index + 1}
                </p>
                <pre class="bg-red-500/10 px-3 py-2 whitespace-pre-wrap">{edit.find}</pre>
                <pre class="bg-green-500/10 px-3 py-2 whitespace-pre-wrap">{edit.replace}</pre>
              </div>
            {/each}
            {#if decision.decision?.sourceArtifactContent}
              <div>
                <h3 class="mb-1 text-xs font-medium text-muted-foreground uppercase">
                  Rewritten source
                </h3>
                <pre class="rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">{decision
                    .decision.sourceArtifactContent}</pre>
              </div>
            {/if}
            {#if decision.recovery}
              <div>
                <h3 class="mb-1 text-xs font-medium text-muted-foreground uppercase">Recovery</h3>
                <pre class="font-mono text-xs whitespace-pre-wrap">{json(decision.recovery)}</pre>
              </div>
            {/if}
          {:else if !outcome}
            <p class="text-muted-foreground">The model has not answered yet.</p>
          {/if}
          {#if responseText}
            <details>
              <summary class="cursor-pointer text-xs text-muted-foreground">
                The response as received
              </summary>
              <pre class="mt-2 font-mono text-xs whitespace-pre-wrap">{responseText}</pre>
            </details>
          {/if}
        </div>
      </ScrollArea>
    </Tabs.Content>

    <Tabs.Content value="actions" class="min-h-0 flex-1">
      <ScrollArea class="h-full">
        <ol class="flex flex-col gap-2 p-4 text-sm">
          {#each value.actions as event (event.id)}
            {@const shown = presentProjectEvent(event)}
            <li class="rounded-lg border px-3 py-2">
              <p>
                <span class="font-mono text-xs text-muted-foreground">#{event.id}</span>
                <span class="font-medium">{shown.title}</span>
                <span class="text-muted-foreground">{shown.detail}</span>
              </p>
              {#if event.type === 'build.failed'}
                <pre
                  class="mt-1 font-mono text-xs whitespace-pre-wrap text-destructive">{event.payload.diagnostics
                    .map(({ message }) => message)
                    .join('\n')}</pre>
              {:else if event.type === 'artifact.version-created' && event.payload.summary}
                <p class="mt-1">{event.payload.summary}</p>
              {/if}
            </li>
          {:else}
            <li class="text-muted-foreground">
              {value.followed
                ? 'Nothing followed before the next request.'
                : 'Nothing followed in this operation.'}
            </li>
          {/each}
        </ol>
      </ScrollArea>
    </Tabs.Content>
  </Tabs.Root>
</section>
