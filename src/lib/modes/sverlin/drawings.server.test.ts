import { describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import { layoutTags } from './layout-tags.server';

const blocks = `<script domain>
  const Rank = type('integer', { min: 1, max: 13 });
  const Suit = type(['hearts', 'spades']);
  const Card = record({ rank: Rank, suit: Suit });
  const Hand = array(Card, { max: 4 });
</script>
<script input>
  const hand = Hand;
</script>
<script algorithm>
  @first[const card = hand[0];]
</script>
<View of="Rank" name="RankText"><Node value={this} /></View>
<View of="Card" name="CardFace"><Node layout="column">{this.rank}{this.suit}</Node></View>
<View of="Hand" name="Row"><Node layout="row">{#each this as card}{card}{/each}</Node></View>
<Layout name="Main" of="hand"><Node layout="column">{hand}</Node></Layout>
<Case name="main" hand={[{ rank: 3, suit: 'hearts' }, { rank: 10, suit: 'spades' }]} />
<Storyboard><Scene name="main" case="main"><Main hand={hand} /></Scene></Storyboard>
`;

/** A view of the suit drawing the shapes given, in a drawing of the props given. */
const suit = (shapes: string, props = 'viewBox="0 0 24 24" height="2" label={this}') =>
  `<View of="Suit" name="SuitMark"><Node><Svg ${props}>${shapes}</Svg></Node></View>\n`;

const chosen = `{#if this === 'hearts'}
  <path d="M12 21 C 4 14 2 10 6 6 C 9 4 12 6 12 8 C 12 6 15 4 18 6 C 22 10 20 14 12 21 Z" />
{:else}
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
{/if}`;

const problemOf = (view: string) => {
  try {
    prepareSvelteComponent(`${blocks}${view}`);
  } catch (cause) {
    const error = cause as Error & { others?: Error[] };
    return [error, ...(error.others ?? [])].map(({ message }) => message).join('\n');
  }
  return '';
};

describe('drawings written <Svg>', () => {
  it('sizes the drawing by its height and viewBox, in em, whatever it draws', () => {
    const { source, problems } = layoutTags(
      suit(chosen, 'viewBox="0 0 30 20" height="2" label={this}')
    );
    expect(problems).toEqual([]);
    expect(source).toContain(
      'style="display: inline-block; vertical-align: middle; width: 3em; height: 2em;" fill="currentColor" role="img" aria-label={this} data-sv-math-text={this}>'
    );
    expect(source).toContain('</svg>');
  });

  it('draws the shapes its value chooses, each value in the same room', async () => {
    const built = await bundlePresentation(
      prepareSvelteComponent(`${blocks}${suit(chosen)}`),
      1,
      {}
    );
    expect(built.layout.errors).toEqual([]);
    // A heart's path and a spade's circle, both 2em at the 16px the server lays text out at.
    expect(built.layout.drawing).toContain('SuitMark: 2 drawing, about 32×32 px');
    expect(built.javascript).toContain('data-sv-drawing');
  });

  it.each([
    [
      'a computed size',
      suit(chosen, 'viewBox="0 0 24 24" height={this === "hearts" ? 2 : 3} label={this}'),
      "A <Svg>'s height is written as it is, not computed"
    ],
    ['no viewBox', suit(chosen, 'height="2" label={this}'), 'A <Svg> needs its viewBox'],
    ['no label', suit(chosen, 'viewBox="0 0 24 24"'), 'A <Svg> needs its label'],
    [
      'another prop',
      suit(chosen, 'viewBox="0 0 24 24" label={this} fill="red"'),
      'fill is no prop of a drawing'
    ],
    [
      'an <svg> written as it is',
      '<View of="Suit" name="SuitMark"><Node><svg viewBox="0 0 2 2"></svg></Node></View>',
      '<svg> is written <Svg'
    ],
    [
      'an outside image',
      suit('<image href="https://example.com/a.png" />'),
      '<image> is not drawn in a drawing'
    ],
    ['a reused shape', suit('<use href="#heart" />'), '<use> is not drawn in a drawing'],
    [
      'a foreign object',
      suit('<foreignObject><div /></foreignObject>'),
      '<foreignObject> is not drawn'
    ],
    ['a link', suit('<a href="https://example.com"><circle r="2" /></a>'), '<a> is not drawn'],
    ['a handler', suit('<circle r="2" onclick={() => 1} />'), 'takes no onclick'],
    ['a style', suit('<circle r="2" style="fill: url(#x)" />'), 'takes no style'],
    ['a paint of its own', suit('<circle r="2" fill="red" />'), "A drawing's fill is currentColor"],
    [
      'a computed paint',
      suit('<circle r="2" stroke={this} />'),
      "A drawing's stroke is currentColor"
    ],
    ['a node inside', suit('<Node>x</Node>'), '<Node> is not drawn in a drawing'],
    ['a value as text', suit('<text x="2" y="9">{this}</text>'), 'never as text in them'],
    [
      'a drawing in a drawing',
      suit(`<Svg viewBox="0 0 2 2" label="x"><circle r="1" /></Svg>`),
      'never another <Svg>'
    ],
    [
      'words outside a <text>',
      suit('<circle r="2" /> hearts'),
      "A drawing's words are written in a <text"
    ]
  ])('refuses %s', (_, view, message) => expect(problemOf(view)).toContain(message));

  it('refuses a script in a drawing', () =>
    expect(problemOf(suit('<script>alert(1)</script>'))).not.toBe(''));

  it('takes words in a <text>, shapes by {#each}, and geometry computed from the value', () =>
    expect(
      problemOf(
        suit(
          '{#if this === "hearts"}<text x="12" y="16" text-anchor="middle" font-size="10">H</text>{/if}{#each [4, 8] as r}<circle cx="12" cy="12" r={this === "hearts" ? r : r / 2} fill="none" stroke="currentColor" />{/each}'
        )
      )
    ).toBe(''));
});
