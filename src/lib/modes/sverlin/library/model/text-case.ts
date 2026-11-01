/**
 * Text as a node's `case` draws it, for measuring and drawing it outside the page. Uppercase is
 * the string uppercased, as the browser transforms text before shaping it. Small caps: the
 * embedded fonts have no `smcp` feature, so Chrome synthesizes them (Blink's SmallCapsIterator and
 * SimpleFontData::SmallCapsFontData): each run of characters that change when uppercased is drawn
 * uppercased in the same face at 0.7 of the size, rounded to whole pixels, shaped apart from the
 * runs around it, and every other character at the full size.
 */

export type TextCase = 'uppercase' | 'small-caps';

/** The share of the size synthesized small caps are drawn at, before rounding. */
export const smallCapsScale = 0.7;

/** The size, in pixels, synthesized small caps are drawn at for text of a size. */
export const smallCapsSize = (size: number): number => Math.round(size * smallCapsScale);

/** A text's runs as drawn in a case: each run's characters, and whether they are small capitals. */
export function casedRuns(
  text: string,
  textCase: TextCase | undefined
): { text: string; small: boolean }[] {
  if (textCase === 'uppercase') return [{ text: text.toUpperCase(), small: false }];
  if (textCase !== 'small-caps') return [{ text, small: false }];
  const runs: { text: string; small: boolean }[] = [];
  for (const character of text) {
    const last = runs.at(-1);
    // A combining mark goes with the letter before it, whatever its own case.
    const small =
      last && /^\p{Mn}$/u.test(character) ? last.small : character.toUpperCase() !== character;
    if (last?.small === small) last.text += character;
    else runs.push({ text: character, small });
  }
  return runs.map(({ text: run, small }) => ({ text: small ? run.toUpperCase() : run, small }));
}

/**
 * The case a computed style draws text in: uppercased text has no lower case left for small caps
 * to synthesize.
 */
export function caseOf(textTransform: string, fontVariantCaps: string): TextCase | undefined {
  if (textTransform === 'uppercase') return 'uppercase';
  return fontVariantCaps === 'small-caps' ? 'small-caps' : undefined;
}
