<!--
  The algorithm as a listing in the language the variant chose (listing.language), lighting what the
  shown step ran: the code it finished and the code it keeps as run alike, as listing.lit.* says,
  each region painting itself as its place says (listing.lit@insert.compare.left.fill), a region
  inside another drawn inside it where its paint differs. A line lights from its first character to
  its last, never its indentation. The text is the same at every step, so the box keeps one size;
  only the lighting moves, its padding and stroke taking no room. Each line is a node of its own,
  which participants can select. A token naming a place (listing.places) is a region of its own,
  lit in its place's colour at a step touching the place (see places.ts). A region whose label a
  token names (:@insert.front) is a reference to that label's place too, so hovering the token
  outlines it; it lights as a region does.
-->
<script lang="ts">
  import { untrack } from 'svelte';

  import { fontClass } from '../fonts';
  import { lightOf, tokenLightCss } from './places';
  import { colourCss, strokeStyleCss } from '../node/design';
  import { designContext, keyedRef, listingContext, nodeIdsContext } from '../type-context';

  let { __ref }: { __ref?: string } = $props();

  const design = designContext();
  const listing = listingContext();
  const nodeIds = nodeIdsContext();
  const ref = untrack(() => __ref);
  const id = ref ? nodeIds?.claim(ref) : undefined;

  type Paint = { fill: unknown; stroke: unknown; color: unknown };
  type Kind = 'keyword' | 'string' | 'comment' | 'number';
  /**
   * Text, as a token naming a place where it is one (see listing/places.ts), or in the region of a
   * label a token names, and its syntax.
   */
  type Leaf = { text: string; place?: string; region?: string; kind?: Kind; lit?: boolean };
  type Piece = Leaf | { paint: Paint; outer: boolean; pieces: Piece[] };
  type Character = {
    text: string;
    lit: boolean;
    chain: readonly string[];
    place?: string;
    region?: string;
    kind?: Kind;
  };

  const regions = listing?.regions ?? [];
  const tokens = listing?.places?.tokens ?? [];
  const tokenAt = (at: number) => tokens.find(({ start, end }) => start <= at && at < end)?.place;
  // The innermost region holding an offset whose label a token names, as its place.
  const regionPlaceAt = (at: number) =>
    regions
      .filter(({ start, end }) => start <= at && at < end)
      .map(({ label }) => `:@${label}`)
      .findLast((place) => listing?.places?.paints[place] !== undefined);
  const syntax = listing?.syntax;
  const kindAt = (at: number) =>
    syntax?.spans.find(({ start, end }) => start <= at && at < end)?.kind;
  // Text split where tokens and syntax spans start and end, each a leaf of its own.
  const leavesOf = (characters: readonly Character[]): Leaf[] => {
    const leaves: Leaf[] = [];
    for (const { text, place, region, kind, lit } of characters) {
      const last = leaves.at(-1);
      if (last && last.place === place && last.region === region && last.kind === kind)
        last.text += text;
      else
        leaves.push({
          text,
          ...(place ? { place } : {}),
          ...(region ? { region } : {}),
          ...(kind ? { kind, lit } : {})
        });
    }
    return leaves;
  };
  // A keyword in bold; with colour each kind in its colour, except in lit code, which keeps its own.
  const syntaxColours: Record<Kind, string> = {
    keyword: 'violet-700',
    string: 'emerald-700',
    comment: 'neutral-500',
    number: 'amber-700'
  };
  const syntaxStyle = (leaf: Leaf) =>
    leaf.kind
      ? [
          leaf.kind === 'keyword' ? 'font-weight:700' : '',
          syntax?.colour && !leaf.lit ? `color:${colourCss(syntaxColours[leaf.kind])}` : ''
        ]
          .filter(Boolean)
          .join(';')
      : undefined;
  // A token lights in its place's colour at a step touching the place.
  const tokenStyle = (place: string) => {
    const colour = lightOf(listing, [place]);
    return colour ? tokenLightCss(listing?.places?.look, colour) : undefined;
  };
  const litAt = (at: number) =>
    listing?.lit.some(([start, end]) => start <= at && at < end) ?? false;
  // The labels of the regions holding an offset, outer first.
  const chainOf = (at: number) =>
    regions.filter(({ start, end }) => start <= at && at < end).map(({ label }) => label);

  const paintOf = (label: string | undefined): Paint => {
    const prop = (name: string) =>
      (label ? design[`listing.lit@${label}.${name}`] : undefined) ?? design[`listing.lit.${name}`];
    return { fill: prop('fill'), stroke: prop('stroke'), color: prop('color') };
  };
  const samePaint = (a: Paint, b: Paint) =>
    a.fill === b.fill && a.stroke === b.stroke && a.color === b.color;

  // A line's characters grouped by whether they are lit and the region at each depth, a region
  // drawn inside the one around it only where its paint differs, and in its place where it is all
  // of it.
  const piecesOf = (characters: readonly Character[], depth = 0, around?: Paint): Piece[] => {
    const runs: Character[][] = [];
    const keyOf = ({ lit, chain }: Character) => (lit ? `|${chain[depth] ?? ''}` : '');
    for (const character of characters) {
      const last = runs.at(-1);
      if (last && keyOf(last[0]) === keyOf(character)) last.push(character);
      else runs.push([character]);
    }
    return runs.flatMap((run): Piece[] => {
      const { lit, chain } = run[0];
      const label = chain[depth];
      // Past its innermost region, text is drawn in the piece around it.
      if (!lit || (around && !label)) return leavesOf(run);
      const paint = paintOf(label);
      const pieces = label ? piecesOf(run, depth + 1, paint) : leavesOf(run);
      if (around && samePaint(paint, around)) return pieces;
      const [only] = pieces;
      if (pieces.length === 1 && 'pieces' in only) return [{ ...only, outer: !around }];
      return [{ paint, outer: !around, pieces }];
    });
  };

  // Each step mounts afresh, so the lines are drawn once, each claiming its id in order.
  const lines = ((): { id?: string; pieces: Piece[] }[] => {
    if (!listing) return [];
    let offset = 0;
    return listing.text.split('\n').map((text, index) => {
      // A line's indentation and the spaces after its last character never light.
      const first = text.length - text.trimStart().length;
      const last = text.trimEnd().length;
      const characters = [...text].map((character, at) => ({
        text: character,
        lit: at >= first && at < last && litAt(offset + at),
        chain: chainOf(offset + at),
        place: tokenAt(offset + at),
        region: regionPlaceAt(offset + at),
        kind: kindAt(offset + at)
      }));
      offset += text.length + 1;
      return {
        id: ref ? nodeIds?.claim(keyedRef(ref, `L${index + 1}`)) : undefined,
        pieces: piecesOf(characters)
      };
    });
  })();

  // The lit look: its paint, its corners, and a stroke drawn inside it; the outermost piece's
  // padding is taken back by its margin, so lit text never moves.
  const styleOf = (paint: Paint, outer: boolean): string => {
    const value = (name: string) => design[`listing.lit.${name}`];
    const width = Number(value('strokeWidth') ?? 0);
    const stroke = colourCss(paint.stroke);
    const padding = outer ? Number(value('padding') ?? 0) : 0;
    return [
      `background-color:${colourCss(paint.fill) ?? 'transparent'}`,
      `border-radius:${Number(value('radius') ?? 0)}px`,
      colourCss(paint.color) ? `color:${colourCss(paint.color)}` : '',
      value('weight') === 'bold' ? 'font-weight:700' : '',
      stroke && width > 0
        ? `outline:${width}px ${strokeStyleCss(value('strokeStyle')) ?? 'solid'} ${stroke};outline-offset:-${width}px`
        : '',
      padding ? `padding:0 ${padding}em;margin:0 -${padding}em` : ''
    ]
      .filter(Boolean)
      .join(';');
  };
</script>

{#snippet drawn(pieces: Piece[])}{#each pieces as piece, at (at)}{#if 'pieces' in piece}<span
        data-sv-lit
        style={styleOf(piece.paint, piece.outer)}>{@render drawn(piece.pieces)}</span
      >{:else if piece.place}<span
        data-sv-place={piece.place}
        data-sv-kind="listing-token"
        style={[tokenStyle(piece.place), syntaxStyle(piece)].filter(Boolean).join(';')}
        >{piece.text}</span
      >{:else if piece.region}<span
        data-sv-place={piece.region}
        data-sv-syntax={piece.kind}
        style={syntaxStyle(piece)}>{piece.text}</span
      >{:else if piece.kind}<span data-sv-syntax={piece.kind} style={syntaxStyle(piece)}
        >{piece.text}</span
      >{:else}{piece.text}{/if}{/each}{/snippet}

{#if listing}
  <div class="sv-listing {fontClass('mono')}" data-sv-node={id} data-sv-kind="listing">
    {#each lines as line, index (index)}
      <div class="sv-listing-line" data-sv-node={line.id} data-sv-kind="listing-line">
        {@render drawn(line.pieces)}{#if !line.pieces.length}&nbsp;{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .sv-listing {
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--sv-ink);
    padding: 0.5rem 0.75rem;
  }
  .sv-listing-line {
    white-space: pre;
  }
</style>
