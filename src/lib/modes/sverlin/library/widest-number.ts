/**
 * The integer in [min, max] that prints widest, given each character's width. The most digits do
 * not always win: digits differ in width in most fonts, so with a narrow 1, 99 can be wider than
 * 100, and with 8 the widest digit, 248 is wider than 250. Kerning is ignored.
 */
export function widestInteger(
  min: number,
  max: number,
  width: (character: string) => number
): number {
  const printed = (value: number) =>
    [...String(value)].reduce((total, character) => total + width(character), 0);
  const candidates =
    max - min <= everyIntegerUpTo
      ? Array.from({ length: max - min + 1 }, (_, index) => min + index)
      : [
          min,
          max,
          ...(max > 0 ? widestBelow(max, width) : []),
          ...(min < 0 ? widestBelow(-min, width).map((magnitude) => -magnitude) : [])
        ].filter((value) => value >= min && value <= max);
  return candidates.reduce((widest, value) => (printed(value) > printed(widest) ? value : widest));
}

// Ranges this size are searched whole, which takes a few milliseconds on the page; larger ones by
// the candidates of widestBelow, which can miss a widest value near min.
const everyIntegerUpTo = 100_000;

/**
 * The numbers up to `bound` that can print widest: `bound`'s first digits, then the widest digit
 * below its next, then the widest digit throughout; or the widest digit throughout, one digit
 * shorter.
 */
function widestBelow(bound: number, width: (character: string) => number): number[] {
  const digits = String(bound);
  const widestOf = (allowed: string[]) =>
    allowed.reduce((widest, digit) => (width(digit) > width(widest) ? digit : widest));
  const all = [...'0123456789'];
  const fill = widestOf(all);
  const candidates = digits.length > 1 ? [Number(fill.repeat(digits.length - 1))] : [];
  for (let place = 0; place < digits.length; place++) {
    const below = all.filter(
      (digit) => digit < digits[place] && (place > 0 || digit > '0' || digits.length === 1)
    );
    if (below.length)
      candidates.push(
        Number(digits.slice(0, place) + widestOf(below) + fill.repeat(digits.length - place - 1))
      );
  }
  return candidates;
}
