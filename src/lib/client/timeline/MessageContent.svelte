<script lang="ts">
  import type { MessageContent } from '$lib/shared/projects/events/message-content';

  import { renderSafeMarkdown } from './markdown';
  import { referenceRanges } from '$lib/client/artifacts/source-references';
  import { sourceLinksContext } from '$lib/client/projects/source-links.svelte';
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
    /** The source code it names is found in, where not the one the panel shows, as a card's own. */
    source?: string;
    /** Before revealing in a source of its own: show that source, as by choosing its card. */
    onRevealSource?: () => void;
  };

  let {
    content,
    interactive = true,
    inverted = false,
    onReferenceActivate = () => {},
    source,
    onRevealSource = () => {}
  }: Props = $props();

  // Inline code naming something in the source shown links to it: choosing it reveals it there.
  const links = sourceLinksContext();
  function linkReferences(node: HTMLElement) {
    const shown = source ?? links?.shown ?? '';
    const named = (code: Element) => (shown ? referenceRanges(shown, code.textContent ?? '') : []);
    for (const code of node.querySelectorAll('code')) {
      const linked = !code.closest('pre') && named(code).length > 0;
      code.classList.toggle('source-ref', linked);
      if (linked) {
        code.setAttribute('role', 'button');
        code.setAttribute('tabindex', '0');
        code.setAttribute('title', 'Show in the source');
        // Pressed while its regions are the ones revealed in the source panel.
        code.setAttribute('aria-pressed', String(links?.isRevealed(shown, named(code)) ?? false));
      } else
        for (const attribute of ['role', 'tabindex', 'title', 'aria-pressed'])
          code.removeAttribute(attribute);
    }
    const activate = (event: MouseEvent | KeyboardEvent) => {
      const code = (event.target as Element | null)?.closest('code.source-ref');
      if (
        !code ||
        !links ||
        (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (source !== undefined && source !== links.shown) onRevealSource();
      links.reveal(shown, named(code));
    };
    node.addEventListener('click', activate);
    node.addEventListener('keydown', activate);
    return () => {
      node.removeEventListener('click', activate);
      node.removeEventListener('keydown', activate);
    };
  }
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
      {@const html = renderSafeMarkdown(segment.text)}
      <!-- renderSafeMarkdown applies the allowlist and URL policy before this HTML boundary. -->
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <span class="message-markdown" {@attach linkReferences}>{@html html}</span>
    {:else}
      {#each singletonReferenceSegments(segment) as reference, position (position)}
        {#if interactive}
          <button
            type="button"
            class="group mx-0.5 inline-flex items-center gap-1 rounded-md align-middle leading-none focus-visible:outline-none"
            class:bg-background={inverted}
            class:text-foreground={inverted}
            title={referenceChipTitle(reference)}
            onclick={(event) => onReferenceActivate(reference, event.shiftKey)}
          >
            {@render chip(reference)}
          </button>
        {:else}
          <span
            class="mx-0.5 inline-flex items-center gap-1 rounded-md align-middle"
            class:bg-background={inverted}
            class:text-foreground={inverted}
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

  /* Inline code is a pill, tinted from the text colour so it reads on either bubble. */
  .message-content :global(:not(pre) > code) {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.85em;
    padding: 0.05em 0.4em;
    border-radius: var(--radius-md, 0.375rem);
    border: 1px solid color-mix(in oklab, currentColor 14%, transparent);
    background-color: color-mix(in oklab, currentColor 8%, transparent);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  .message-content :global(pre code) {
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  /* A pill naming something in the source is a link: a stronger border, an arrow, a stronger tint
     on hover; all from the text colour, so it stays neutral on either bubble and in either theme. */
  .message-content :global(code.source-ref) {
    cursor: pointer;
    border-color: color-mix(in oklab, currentColor 38%, transparent);
    background-color: color-mix(in oklab, currentColor 10%, transparent);
    transition: background-color 120ms;
  }

  .message-content :global(code.source-ref)::after {
    content: '↗';
    margin-left: 0.2em;
    font-size: 0.85em;
    opacity: 0.6;
  }

  .message-content :global(code.source-ref:hover) {
    background-color: color-mix(in oklab, currentColor 18%, transparent);
  }

  .message-content :global(code.source-ref:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }

  .message-content :global(code.source-ref[aria-pressed='true']) {
    border-color: color-mix(in oklab, currentColor 70%, transparent);
    background-color: color-mix(in oklab, currentColor 22%, transparent);
  }
</style>
