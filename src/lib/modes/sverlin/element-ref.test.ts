import { describe, expect, it } from 'vitest';

import { locateElement } from './element-ref';

const source = [
  '<script lang="sverlin">yield;</script>',
  '<Node items={values}>',
  '  {#snippet item(value)}<Node {value} />{/snippet}',
  '</Node>',
  '<Node',
  '  size="large">Title</Node>'
].join('\n');

describe('element locations', () => {
  it('traces an id to its <Node> tag, render, and collection items', () => {
    expect(locateElement(source, '3:25#4/2/0')).toEqual({
      line: 3,
      column: 25,
      occurrence: 4,
      items: [2, 0],
      markup: '{#snippet item(value)}<Node {value} />{/snippet}'
    });
    expect(locateElement(source, '2:1')).toMatchObject({ occurrence: 1, items: [] });
    // A tag whose attributes start on the next line.
    expect(locateElement(source, '5:1')).toMatchObject({ markup: '<Node' });
  });

  it('reads a keyed node’s key, decoded, before its render count', () => {
    expect(locateElement(source, '3:25@c')).toMatchObject({ key: 'c', occurrence: 1, items: [] });
    expect(locateElement(source, '3:25@node%20b#2')).toMatchObject({
      key: 'node b',
      occurrence: 2
    });
    expect(locateElement(source, '3:25@%E0%A4')).toBeUndefined();
  });

  it('locates link components too', () => {
    expect(locateElement('<Node>\n  <Link from="a" to="b" />\n</Node>', '2:3')).toMatchObject({
      line: 2,
      markup: '<Link from="a" to="b" />'
    });
  });

  it('rejects ids that name no <Node> tag', () => {
    expect(locateElement(source, '2:2')).toBeUndefined();
    expect(locateElement(source, '1:1')).toBeUndefined();
    expect(locateElement(source, '99:1')).toBeUndefined();
    expect(locateElement(source, 'node-3')).toBeUndefined();
  });
});
