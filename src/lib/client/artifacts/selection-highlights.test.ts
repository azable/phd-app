import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';

import sverlin from '$lib/modes/sverlin/fixtures/links/linear-search.sverlin?raw';

import { elementHighlights, highlightRanges } from './selection-highlights';

const source = [
  '<Node layout="row">',
  '  <Node fill={index > i ? "a>b" : undefined} />',
  '  <Node',
  '    size="large">Title</Node>',
  '</Node>'
].join('\n');
const state = EditorState.create({ doc: source });
const text = (range: { from: number; to: number }) => source.slice(range.from, range.to);

describe('source highlights', () => {
  it('spans each whole <Node> tag, past > inside expressions and strings and across lines', () => {
    const ranges = highlightRanges(state, [
      { line: 2, column: 3 },
      { line: 1, column: 1 },
      { line: 3, column: 3 }
    ]);
    expect(ranges.map(text)).toEqual([
      '<Node layout="row">',
      '<Node fill={index > i ? "a>b" : undefined} />',
      '<Node\n    size="large">'
    ]);
  });

  it('skips positions that hold no <Node> tag and repeats of the same tag', () => {
    expect(
      highlightRanges(state, [
        { line: 2, column: 1 },
        { line: 9, column: 1 },
        { line: 1, column: 1 },
        { line: 1, column: 1 }
      ]).map(text)
    ).toEqual(['<Node layout="row">']);
  });
});

describe('link highlights', () => {
  it('spans a <Link> tag the same way as a <Node>', () => {
    const doc = '<Node layout="free">\n  <Link from="a" to="b" label={"a > b"} />\n</Node>';
    const ranges = highlightRanges(EditorState.create({ doc }), [{ line: 2, column: 3 }]);
    expect(ranges.map(({ from, to }) => doc.slice(from, to))).toEqual([
      '<Link from="a" to="b" label={"a > b"} />'
    ]);
  });
});

describe('a selected listing line', () => {
  const lines = sverlin.split('\n');
  const listingTag = lines.findIndex((line) => line.includes('<Listing />'));
  const id = `${listingTag + 1}:${lines[listingTag].indexOf('<Listing') + 1}@L4`;
  const shown = (highlights: ReturnType<typeof elementHighlights>) =>
    highlights.map((each) =>
      'from' in each ? sverlin.slice(each.from, each.to) : lines[each.line - 1].trim()
    );

  it('lights its tag, its line in the listing block, and its label’s code', () => {
    expect(shown(elementHighlights(sverlin, { id }))).toEqual([
      '<Listing />',
      '3      @scan.check[if A[:i[i]] = target]',
      '@check[values[i] === target]'
    ]);
  });

  it('lights a clicked token’s place, where its variable is declared and drawn, not the label', () => {
    const highlights = shown(elementHighlights(sverlin, { id, place: ':i' }));
    expect(highlights.slice(0, 2)).toEqual([
      '<Listing />',
      '3      @scan.check[if A[:i[i]] = target]'
    ]);
    expect(highlights).toContain('i');
    expect(highlights).not.toContain('@check[values[i] === target]');
  });

  it('lights only the tag of an element that is no listing line', () => {
    const node = lines.findIndex((line) => line.includes('<Node value={this} />'));
    const at = `${node + 1}:${lines[node].indexOf('<Node') + 1}`;
    expect(shown(elementHighlights(sverlin, { id: at }))).toEqual(['<Node value={this} />']);
  });
});
