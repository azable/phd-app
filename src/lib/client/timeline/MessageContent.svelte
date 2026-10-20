<script lang="ts">
  import type { MessageContent } from '$lib/shared/projects/events/message-content';

  import { renderSafeMarkdown } from './markdown';
  import CandidateIdPill from '$lib/client/visualization/CandidateIdPill.svelte';
  import { knownCandidate } from '$lib/client/visualization/presentation-history';

  import {
    referenceChipDetail,
    referenceChipLabel,
    referenceChipTitle,
    singletonReferenceSegments,
    type ReferenceSegment
  } from './reference-labels';

  type Props = {
    content: MessageContent;
    interactive?: boolean;
    inverted?: boolean;
    onReferenceActivate?: (reference: ReferenceSegment, extend: boolean) => void;
  };

  let {
    content,
    interactive = true,
    inverted = false,
    onReferenceActivate = () => {}
  }: Props = $props();
</script>

{#snippet chip(reference: ReferenceSegment)}
  {@const known = knownCandidate(reference.presentationId)}
  {@const detail = referenceChipDetail(reference)}
  {#if known}
    <CandidateIdPill {...known} />
    {#if detail}<span class="font-mono text-xs">{detail}</span>{/if}
  {:else}
    <span class="rounded-md bg-muted px-1.5 font-mono text-xs leading-5 text-foreground"
      >{referenceChipLabel(reference)}</span
    >
  {/if}
{/snippet}

<div class="message-content text-base">
  {#each content as segment, index (`${segment.type}-${index}`)}
    {#if segment.type === 'markdown'}
      <!-- renderSafeMarkdown applies the allowlist and URL policy before this HTML boundary. -->
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <span class="message-markdown">{@html renderSafeMarkdown(segment.text)}</span>
    {:else}
      {#each singletonReferenceSegments(segment) as reference, position (position)}
        {#if interactive}
          <button
            type="button"
            class="mx-0.5 inline-flex items-center gap-1 rounded-md align-middle hover:ring-2 hover:ring-ring/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            class:bg-background={inverted}
            title={referenceChipTitle(reference)}
            onclick={(event) => onReferenceActivate(reference, event.shiftKey)}
          >
            {@render chip(reference)}
          </button>
        {:else}
          <span
            class="mx-0.5 inline-flex items-center gap-1 rounded-md align-middle"
            class:bg-background={inverted}
            title={referenceChipTitle(reference)}
          >
            {@render chip(reference)}
          </span>
        {/if}
      {/each}
    {/if}
  {/each}
</div>

<style>
  .message-content :global(.message-markdown > p:first-child) {
    display: inline;
  }

  .message-content :global(.message-markdown > p + p),
  .message-content :global(.message-markdown > ul),
  .message-content :global(.message-markdown > ol),
  .message-content :global(.message-markdown > pre),
  .message-content :global(.message-markdown > blockquote) {
    margin-top: 0.5rem;
  }

  .message-content :global(ul),
  .message-content :global(ol) {
    padding-left: 1.25rem;
  }

  .message-content :global(ul) {
    list-style: disc;
  }

  .message-content :global(ol) {
    list-style: decimal;
  }

  .message-content :global(a) {
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }

  .message-content :global(code) {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
</style>
