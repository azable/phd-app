<script lang="ts">
  import type { Snippet } from 'svelte';

  import type { MessageContent } from '$lib/shared/projects/events/message-content';

  import { renderSafeInlineMarkdown, renderSafeMarkdown } from './markdown';
  import { joinTrailingPunctuation } from './message-punctuation';
  import {
    elidedName,
    ghostKey,
    referenceRanges,
    type ReferenceDesign
  } from '$lib/client/artifacts/source-references';
  import { sourceLinksContext } from '$lib/client/projects/source-links.svelte';
  import CandidateIdPill from '$lib/client/visualization/CandidateIdPill.svelte';
  import { knownCandidate } from '$lib/client/visualization/presentation-history';
  import { clearHighlight, highlightPart } from '$lib/client/tour/spotlight.svelte';
  import { interfacePart } from '$lib/shared/interface-parts';

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
    /** The reference the pointer or focus is on, as it comes onto one and, undefined, leaves it. */
    onReferenceHover?: (reference: ReferenceSegment | undefined) => void;
    /** The source code it names is found in, where not the one the panel shows, as a version's own. */
    source?: string;
    /** Before revealing in a source of its own: show that source, as a pill's code button does. */
    onRevealSource?: () => void;
    /** What a build of that source records, which view choices it names are matched by. */
    design?: ReferenceDesign;
    /** Draws a presentation's reference itself, as a version pill with its actions, where given. */
    pill?: Snippet<[presentationId: string]>;
    /** The presentations pill draws, by id. */
    pilled?: (presentationId: string) => boolean;
    /** Phrasing only, for a button, heading or label: one line, no buttons or links of its own. */
    inline?: boolean;
  };

  let {
    content,
    interactive = true,
    inverted = false,
    onReferenceActivate = () => {},
    onReferenceHover = () => {},
    source,
    onRevealSource = () => {},
    design,
    pill,
    pilled = () => false,
    inline = false
  }: Props = $props();

  // A linked pill naming a long label shows it elided at the start (@…compare.left); the parts it
  // leaves out stay in the text, out of sight, so copying it and linking it keep the full name.
  function showElided(code: HTMLElement, linked: boolean) {
    const full = code.textContent ?? '';
    const parts = linked ? elidedName(full) : undefined;
    if (!parts) {
      if (code.dataset.elided !== undefined) {
        code.textContent = full;
        delete code.dataset.elided;
      }
      return;
    }
    if (code.dataset.elided !== undefined) return;
    code.dataset.elided = '';
    const ellipsis = document.createElement('span');
    ellipsis.className = 'ref-ellipsis';
    ellipsis.setAttribute('aria-hidden', 'true');
    const hidden = document.createElement('span');
    hidden.className = 'ref-elided';
    hidden.textContent = parts.hidden;
    code.replaceChildren(parts.head, ellipsis, hidden, parts.tail);
  }

  // Inline code naming something in the source shown links to it: choosing it reveals it there.
  const links = sourceLinksContext();
  function linkReferences(node: HTMLElement) {
    const shown = source ?? links?.shown ?? '';
    const built = design ?? (source === undefined ? links?.shownDesign : undefined);
    const named = (code: Element) =>
      shown ? referenceRanges(shown, code.textContent ?? '', built) : [];
    // A design variable with a row of its own reveals that row, its value beside the code.
    const rows = (code: Element) => {
      const key = shown ? ghostKey(code.textContent ?? '', built) : undefined;
      return key ? [key] : [];
    };
    for (const code of node.querySelectorAll('code')) {
      const linked = !code.closest('pre') && (named(code).length > 0 || rows(code).length > 0);
      code.classList.toggle('source-ref', linked);
      showElided(code, linked);
      if (linked) {
        code.setAttribute('role', 'button');
        code.setAttribute('tabindex', '0');
        code.setAttribute('title', `Show ${code.textContent ?? ''} in the source`);
        // Pressed while its regions are the ones revealed in the source panel.
        code.setAttribute(
          'aria-pressed',
          String(links?.isRevealed(shown, named(code), rows(code)) ?? false)
        );
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
      links.reveal(shown, named(code), rows(code));
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
    {#if detail}<span class="pr-1 font-mono text-xs">{detail}</span>{/if}
  {:else}
    <span class="rounded-md bg-muted px-1.5 font-mono text-xs leading-5 text-foreground"
      >{referenceChipLabel(reference)}</span
    >
  {/if}
{/snippet}

<!-- Lines tall enough for a pill (20px) in the text's middle without pushing lines apart; inline,
  the surrounding text's. -->
<svelte:element
  this={inline ? 'span' : 'div'}
  class={['message-content', !inline && 'text-base leading-7']}
>
  {#each joinTrailingPunctuation(content) as { segment, punctuation, after }, index (`${segment.type}-${index}`)}
    {#if segment.type === 'markdown'}
      {@const html = inline
        ? renderSafeInlineMarkdown(segment.text)
        : renderSafeMarkdown(segment.text)}
      <!-- The renderers apply the allowlist and URL policy before this HTML boundary. -->
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <span class="message-markdown" {@attach !inline && linkReferences}>{@html html}</span
      >{after === 'space' ? ' ' : ''}
    {:else if segment.type === 'interface-ref'}
      {@const name = interfacePart(segment.part).name}
      <!-- A part of the workspace the reply points at: hovering, focusing or choosing it highlights
        the part. -->
      <span class={punctuation && 'ref-joined whitespace-nowrap'}
        >{#if interactive && !inline}<button
            type="button"
            class="interface-ref mx-1 inline-flex items-center rounded-full border px-2 align-middle text-xs leading-5 font-medium"
            title="Show the {name}"
            onmouseenter={() => highlightPart(segment.part)}
            onmouseleave={clearHighlight}
            onfocus={() => highlightPart(segment.part)}
            onblur={clearHighlight}
            onclick={() => highlightPart(segment.part)}>{name}</button
          >{:else}<span
            class="interface-ref mx-1 inline-flex items-center rounded-full border px-2 align-middle text-xs leading-5 font-medium"
            >{name}</span
          >{/if}{#if punctuation}<span class="ref-punctuation ml-0.5">{punctuation}</span
          >{/if}</span
      >{after === 'space' ? ' ' : ''}{#if after === 'paragraph' && !inline}<span class="mt-2 block"
        ></span>{/if}
    {:else}
      <!-- A pill keeps the punctuation after it on its line, without a gap before it. -->
      <span class={punctuation && 'ref-joined whitespace-nowrap'}>
        {#each singletonReferenceSegments(segment) as reference, position (position)}
          {#if !inline && pill && reference.type === 'presentation-ref' && reference.step === undefined && pilled(reference.presentationId)}
            {@render pill(reference.presentationId)}
          {:else if interactive && !inline}
            <button
              type="button"
              class="group mx-1 inline-flex items-center gap-1.5 rounded-md align-middle leading-none focus-visible:outline-none"
              class:bg-background={inverted}
              class:text-foreground={inverted}
              title={referenceChipTitle(reference)}
              onclick={(event) => onReferenceActivate(reference, event.shiftKey)}
              onpointerenter={() => onReferenceHover(reference)}
              onpointerleave={() => onReferenceHover(undefined)}
              onfocus={() => onReferenceHover(reference)}
              onblur={() => onReferenceHover(undefined)}
            >
              {@render chip(reference)}
            </button>
          {:else}
            <span
              class="mx-1 inline-flex items-center gap-1.5 rounded-md align-middle leading-none"
              class:bg-background={inverted}
              class:text-foreground={inverted}
              title={referenceChipTitle(reference)}
            >
              {@render chip(reference)}
            </span>
          {/if}
        {/each}{#if punctuation}<span class="ref-punctuation ml-0.5">{punctuation}</span>{/if}</span
      >{after === 'space' ? ' ' : ''}{#if after === 'paragraph' && !inline}<span class="mt-2 block"
        ></span>{/if}
    {/if}
  {/each}
</svelte:element>

<style>
  .message-content :global(.ref-joined > :nth-last-child(2)) {
    margin-right: 0;
  }

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

  /* Inline code is a pill, tinted from the text colour so it reads on either bubble. Its own line
     height is 1: the mono face would otherwise sit lower on the message's line height and push the
     line it is on taller than the others; raised so its box centres on the words beside it. */
  .message-content :global(:not(pre) > code) {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.85em;
    line-height: 1;
    vertical-align: 0.18em;
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

  /* A long label's elided parts: in the text, so copied, but drawn as an ellipsis. */
  .message-content :global(code.source-ref .ref-elided) {
    display: inline-block;
    width: 0;
    overflow: hidden;
    white-space: nowrap;
    vertical-align: bottom;
  }

  .message-content :global(code.source-ref .ref-ellipsis)::before {
    content: '…';
    user-select: none;
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
