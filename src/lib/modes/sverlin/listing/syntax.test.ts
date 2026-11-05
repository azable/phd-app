import { describe, expect, it } from 'vitest';

import { keywordsOf, syntaxSpans } from './syntax';

const words = (text: string, name: string, kinds: 'keywords' | 'all') =>
  syntaxSpans(text, name, kinds).map(({ kind, start, end }) => `${kind}:${text.slice(start, end)}`);

describe('a listing’s syntax', () => {
  it('finds pseudocode keywords as whole words in any case', () => {
    expect(words('for i = 2 to n\n  while A[i] > key do\nReturn i', 'textbook', 'all')).toEqual([
      'keyword:for',
      'number:2',
      'keyword:to',
      'keyword:while',
      'keyword:do',
      'keyword:Return'
    ]);
    expect(words('format(toast)', 'textbook', 'keywords')).toEqual([]);
  });

  it('takes Python’s keywords, strings and comments by the listing’s name', () => {
    expect(words('def f(x):  # find\n    return "if" + 10', 'python', 'all')).toEqual([
      'keyword:def',
      'comment:# find',
      'keyword:return',
      'string:"if"',
      'number:10'
    ]);
    expect(words('def f(x):  # find', 'python', 'keywords')).toEqual(['keyword:def']);
  });

  it('leaves a number inside a name alone, and names a language by its alias', () => {
    expect(words('let a1 = 2; // two', 'js', 'all')).toEqual([
      'keyword:let',
      'number:2',
      'comment:// two'
    ]);
    expect(keywordsOf('JavaScript')).toBe(keywordsOf('js'));
  });
});
