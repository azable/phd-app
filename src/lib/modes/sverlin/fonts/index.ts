/**
 * The fonts every presentation's page draws in (see README.md), declared for its sandbox document:
 * each face as a data URL, as the sandbox loads fonts from nowhere else, and the version the server
 * measured them as, which the page checks the server's layout against (see ../assembly/entry.ts).
 */

import { pageFont } from '../library/fonts';
import manifest from './faces.json';

const files = import.meta.glob<string>('./*.woff2', {
  query: '?inline',
  import: 'default',
  eager: true
});

/** What the sandbox document's head declares: the faces, the version, and the page's font. */
export const embeddedFontsHead =
  `<meta name="sverlin-fonts" content="${manifest.version}">` +
  `<style>${manifest.faces
    .map(
      ({ file, family, weight }) =>
        `@font-face{font-family:'${family}';src:url(${files[`./${file}.woff2`]}) format('woff2');font-weight:${weight};font-style:normal;font-display:block}`
    )
    .join('')}html,body{font-family:${pageFont}}</style>`;
