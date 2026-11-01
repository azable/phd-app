/** Safe, deliberately small Markdown rendering policy for retained chat messages. */

import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const allowedTags = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a'
];

/** Phrasing that a button or heading may hold: no blocks, links or line breaks. */
const inlineTags = ['strong', 'em', 'del', 'code'];

/** Render GitHub-flavoured Markdown while stripping raw HTML and unsafe URLs. */
export function renderSafeMarkdown(source: string): string {
  const rendered = marked.parse(source, { async: false, breaks: true, gfm: true });
  return sanitizeHtml(rendered, {
    allowedTags,
    allowedAttributes: { a: ['href', 'title', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: 'a',
        attribs: { ...attributes, rel: 'nofollow noreferrer' }
      })
    }
  });
}

/** Render one line of Markdown as emphasis and code only, a link keeping just its text. */
export function renderSafeInlineMarkdown(source: string): string {
  const rendered = marked.parseInline(source, { async: false, gfm: true });
  return sanitizeHtml(rendered, {
    allowedTags: inlineTags,
    allowedAttributes: {},
    disallowedTagsMode: 'discard'
  });
}
