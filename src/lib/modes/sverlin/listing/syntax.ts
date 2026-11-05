/**
 * The syntax of a listing's text, as spans of keywords, strings, comments and numbers, for the page
 * to draw keywords in bold and, where the variant colours it (listing.syntax), each kind in its
 * colour. A small tokenizer, not a highlighting library: a listing is a few lines of teaching code,
 * only ranges are needed, to nest with its regions and tokens, and pseudocode has no grammar.
 */

export type SyntaxKind = 'keyword' | 'string' | 'comment' | 'number';
export type SyntaxSpan = { kind: SyntaxKind; start: number; end: number };

const words = (text: string) => new Set(text.split(/\s+/u).filter(Boolean));

/** Keywords by language, the listing's name choosing them; any other name reads as pseudocode. */
const keywords: Record<string, Set<string>> = {
  python: words(`and as assert break class continue def del elif else except False finally for
    from global if import in is lambda None nonlocal not or pass raise return True try while with
    yield`),
  javascript: words(`break case catch class const continue default delete do else export extends
    false finally for function if import in instanceof let new null of return switch this throw
    true try typeof undefined var void while yield`),
  java: words(`boolean break case catch char class continue default do double else extends false
    final finally float for if implements import instanceof int interface long new null private
    protected public return static switch this throw true try void while`),
  c: words(`auto bool break case char const continue default do double else enum extern false
    float for goto if inline int long register restrict return short signed sizeof static struct
    switch true typedef union unsigned void volatile while NULL`),
  pseudocode: words(`and break by do downto each else elseif end error false for from function if
    in let nil not of or procedure repeat return step then to true until while`)
};
const aliases: Record<string, string> = {
  js: 'javascript',
  ts: 'javascript',
  typescript: 'javascript',
  cpp: 'c',
  'c++': 'c',
  c89: 'c',
  c99: 'c',
  c11: 'c',
  c17: 'c',
  c23: 'c',
  py: 'python'
};

/**
 * The language a listing's name gives: the whole name, or its first word, as `c` for "C code" or
 * "C-style", any case; any other name reads as pseudocode.
 */
function languageOf(name: string): string {
  const whole = name.trim().toLowerCase();
  const first = /^[a-z][\w+]*/u.exec(whole)?.[0] ?? whole;
  for (const candidate of [whole, first]) {
    const language = aliases[candidate] ?? candidate;
    if (Object.hasOwn(keywords, language)) return language;
  }
  return 'pseudocode';
}

/** The keywords of a listing by its name, as `<script listing="python">`. */
export function keywordsOf(name: string): Set<string> {
  return keywords[languageOf(name)];
}

/** Comment openers by language; pseudocode takes `//` and `▷`, as textbooks write them. */
const lineComments = (name: string): readonly string[] =>
  languageOf(name) === 'python' ? ['#'] : ['//', '▷'];

/** Languages with `/* … *\/` comments, which may run over lines. */
const blockComments = new Set(['javascript', 'java', 'c']);

/**
 * The text's syntax spans in order, keywords only or every kind. A keyword is a whole word, any
 * case for pseudocode; a string runs to its closing quote on its line; a comment to the line's end.
 */
export function syntaxSpans(text: string, name: string, kinds: 'keywords' | 'all'): SyntaxSpan[] {
  const language = languageOf(name);
  const known = keywords[language];
  const pseudocode = language === 'pseudocode';
  const comments = lineComments(name);
  const spans: SyntaxSpan[] = [];
  let at = 0;
  while (at < text.length) {
    const rest = text.slice(at);
    if (blockComments.has(language) && rest.startsWith('/*')) {
      const close = text.indexOf('*/', at + 2);
      const stop = close < 0 ? text.length : close + 2;
      if (kinds === 'all') spans.push({ kind: 'comment', start: at, end: stop });
      at = stop;
      continue;
    }
    // A preprocessor directive, as #include, opening its line, reads as a keyword.
    const directive =
      language === 'c' && rest.startsWith('#') && /(^|\n)[ \t]*$/u.test(text.slice(0, at))
        ? /^#[ \t]*[a-z]+/u.exec(rest)?.[0]
        : undefined;
    if (directive) {
      spans.push({ kind: 'keyword', start: at, end: at + directive.length });
      at += directive.length;
      continue;
    }
    const comment = comments.find((opener) => rest.startsWith(opener));
    if (comment) {
      const end = text.indexOf('\n', at);
      const stop = end < 0 ? text.length : end;
      if (kinds === 'all') spans.push({ kind: 'comment', start: at, end: stop });
      at = stop;
      continue;
    }
    const quote = /^["'`]/u.exec(rest)?.[0];
    if (quote && !pseudocode) {
      let end = at + 1;
      while (end < text.length && text[end] !== quote && text[end] !== '\n')
        end += text[end] === '\\' ? 2 : 1;
      end = Math.min(text.length, end + 1);
      if (kinds === 'all') spans.push({ kind: 'string', start: at, end });
      at = end;
      continue;
    }
    const word = /^[A-Za-z_]\w*/u.exec(rest)?.[0];
    if (word) {
      if (known.has(pseudocode ? word.toLowerCase() : word))
        spans.push({ kind: 'keyword', start: at, end: at + word.length });
      at += word.length;
      continue;
    }
    const number = /^(?:0[xX][\da-fA-F]+|\d+(?:\.\d+)?)[uUlLfF]*/u.exec(rest)?.[0];
    if (number) {
      const before = text[at - 1];
      if (kinds === 'all' && !(before && /\w/u.test(before)))
        spans.push({ kind: 'number', start: at, end: at + number.length });
      at += number.length;
      continue;
    }
    at += 1;
  }
  return spans;
}
