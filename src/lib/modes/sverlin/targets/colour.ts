/**
 * CSS colours as RGBA without a browser, for scenes drawn on the server: the forms the library
 * writes (see colourCss in ../library/node/design.ts) and the browser computes, hex, rgb(), oklch()
 * and color(srgb …), with transparent, white and black. Others read as black, as a canvas would not.
 * OKLCH converts through OKLab to linear sRGB (Ottosson, https://bottosson.github.io/posts/oklab/),
 * then to sRGB, clipped.
 */

export type Rgba = [number, number, number, number];

const named: Record<string, Rgba> = {
  transparent: [0, 0, 0, 0],
  white: [255, 255, 255, 1],
  black: [0, 0, 0, 1]
};

const clip = (value: number) => Math.min(255, Math.max(0, Math.round(value)));
const encoded = (linear: number) =>
  255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055);

function alphaOf(text: string | undefined): number {
  if (text === undefined) return 1;
  return text.endsWith('%') ? parseFloat(text) / 100 : parseFloat(text);
}

/** A CSS colour's red, green and blue, 0–255, and its alpha, 0–1. */
export function cssColour(css: string): Rgba {
  const text = css.trim().toLowerCase();
  if (named[text]) return named[text];
  const hex = /^#([\da-f]{3,8})$/u.exec(text)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
    const [r, g, b, a = 255] = (full.match(/../gu) ?? []).map((pair) => parseInt(pair, 16));
    return [r, g, b, Math.round((a / 255) * 1000) / 1000];
  }
  const call = /^([a-z]+)\((.*)\)$/u.exec(text);
  if (!call) return [0, 0, 0, 1];
  const [name, inner] = [call[1], call[2]];
  const [main, alpha] = inner.includes('/') ? inner.split('/') : [inner, undefined];
  const parts = main.split(/[\s,]+/u).filter(Boolean);
  if (name === 'rgb' || name === 'rgba') {
    const channel = (part: string) =>
      part.endsWith('%') ? (parseFloat(part) / 100) * 255 : parseFloat(part);
    return [
      clip(channel(parts[0])),
      clip(channel(parts[1])),
      clip(channel(parts[2])),
      alphaOf(alpha?.trim() ?? parts[3])
    ];
  }
  if (name === 'color' && parts[0] === 'srgb')
    return [
      clip(parseFloat(parts[1]) * 255),
      clip(parseFloat(parts[2]) * 255),
      clip(parseFloat(parts[3]) * 255),
      alphaOf(alpha?.trim())
    ];
  if (name === 'oklch') {
    const lightness = parts[0].endsWith('%') ? parseFloat(parts[0]) / 100 : parseFloat(parts[0]);
    const chroma = parseFloat(parts[1]) || 0;
    const hue = ((parseFloat(parts[2]) || 0) * Math.PI) / 180;
    const [a, b] = [chroma * Math.cos(hue), chroma * Math.sin(hue)];
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      clip(encoded(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
      clip(encoded(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
      clip(encoded(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
      alphaOf(alpha?.trim())
    ];
  }
  return [0, 0, 0, 1];
}
