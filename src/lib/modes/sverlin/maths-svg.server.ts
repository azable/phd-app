/**
 * Inline maths drawn by MathJax as SVG, when the presentation is built, so the page ships only the
 * SVG and the server's layout model sizes it exactly: MathJax gives its width, height and baseline,
 * which are written in em, so they scale with the text around them as the page draws them.
 */

import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';

import { mathsText } from './maths.server';

/**
 * MathJax's SVG lengths are in ex of its own font, New Computer Modern, whose x-height is 0.442 em
 * (its viewBox is in thousandths of an em, as width 2742.3 for 6.204ex shows). Written in em, the
 * maths keeps its proportions to the text whatever face the design gives the text.
 */
const exInEm = 0.442;

/** The SVG elements MathJax draws maths with, the only ones the page is given. */
const drawingTags = new Set(['svg', 'g', 'path', 'rect', 'use', 'defs', 'title', 'text']);

type Rendered = { svg: string; text: string } | { problem: string };

let document: ReturnType<typeof mathjax.document> | undefined;
let adaptor: ReturnType<typeof liteAdaptor> | undefined;

function converter() {
  if (!document || !adaptor) {
    adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    document = mathjax.document('', {
      InputJax: new TeX({
        packages: ['base', 'ams'],
        // An error in the TeX is the author's to fix, so it is thrown, not drawn in red.
        formatError: (_jax: unknown, error: Error) => {
          throw error;
        }
      }),
      // Each SVG holds its own glyphs, as each is drawn alone; it sits in one line of text, which
      // the layout never breaks, so it marks no places to break (as <mjx-break> elements).
      OutputJax: new SVG({ fontCache: 'none', linebreaks: { inline: false } })
    });
  }
  return { document, adaptor };
}

const em = (ex: number) => `${Math.round(ex * exInEm * 1000) / 1000}em`;

/**
 * The SVG a LaTeX maths span draws as, sized in em with its baseline, and the text the PDF draws
 * in its place; or MathJax's reason it cannot be drawn.
 */
export function mathsSvg(written: string): Rendered {
  const { document, adaptor } = converter();
  let markup: string;
  try {
    markup = adaptor.innerHTML(document.convert(written, { display: false }));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { problem: `$$${written}$$: ${message}` };
  }
  const align = /^<svg style="vertical-align: (-?[\d.]+)ex;"/u.exec(markup)?.[1] ?? '0';
  const [, width = '0', height = '0'] =
    / width="([\d.]+)ex" height="([\d.]+)ex"/u.exec(markup) ?? [];
  // Its size and baseline as a style, which the page and the layout model both read.
  const style = `display: inline-block; vertical-align: ${em(Number(align))}; width: ${em(Number(width))}; height: ${em(Number(height))};`;
  // MathJax copies each group's TeX into data-latex, unescaped, so `k < i` there would read as a
  // tag <i; the page needs none of it.
  const svg = markup
    .replace(/^<svg style="[^"]*"/u, `<svg style="${style}"`)
    .replace(/ width="[\d.]+ex" height="[\d.]+ex"/u, '')
    .replace(/\sdata-latex="[^"]*"/gu, '');
  // The page draws the SVG as markup, so it holds only shapes: no link, script, or handler, which
  // TeX such as \href or \class could otherwise bring.
  const tags = [...svg.matchAll(/<\/?([a-zA-Z][\w-]*)/gu)].map(([, tag]) => tag);
  if (tags.some((tag) => !drawingTags.has(tag)) || /\s(?:on\w+|href|xlink:href)=/u.test(svg))
    return { problem: `$$${written}$$: maths draws shapes only, never a link or anything else.` };
  const unicode = mathsText(written);
  return { svg, text: 'text' in unicode ? unicode.text : written };
}
