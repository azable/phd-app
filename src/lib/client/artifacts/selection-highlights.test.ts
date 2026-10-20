import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';

import { highlightRanges } from './selection-highlights';

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
