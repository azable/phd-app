import { describe, expect, it } from 'vitest';

import { drawingBudget, drawingOf, drawingText } from './drawing';
import type { ModelElement, ModelNode } from './model/tree';

const node = (
  kind: string | undefined,
  style: Record<string, string> = {},
  children: ModelNode[] = [],
  attributes: Record<string, string> = {}
): ModelElement => ({
  tag: 'div',
  attributes: { class: 'sv-node', ...(kind ? { 'data-sv-kind': kind } : {}), ...attributes },
  style,
  children
});
const text = (value: string): ModelElement => ({
  tag: 'span',
  attributes: { class: 'value' },
  style: {},
  children: [value]
});
const link = (from: string, to: string): ModelElement => ({
  tag: 'span',
  attributes: { class: 'sv-link', 'data-sv-link': '', 'data-from': from, 'data-to': to },
  style: {},
  children: []
});
const stroke = { 'border-width': '1px', 'border-style': 'solid', 'border-color': 'grey' };

describe('what a step draws, for the assistant', () => {
  it('names each kind by the shape its paint gives it, a value counted once', () => {
    const markup = node(undefined, {}, [
      node('Cell', { ...stroke, 'border-radius': '8px' }, [text('7')]),
      node('Cell', { ...stroke, 'border-radius': '8px' }, [text('3')]),
      node('Dot', { ...stroke, 'border-radius': '999px' }, [text('a')]),
      node('Caption', {}, [text('reads the text')])
    ]);
    const { kinds } = drawingOf(markup, []);
    expect(kinds.map(({ kind, shape, count }) => `${kind} ${count} ${shape}`)).toEqual([
      'Cell 2 box',
      'Caption 1 unboxed text',
      'Dot 1 circle'
    ]);
  });

  it('calls a white fill with no outline unseen, as on the white page', () => {
    const markup = node('State', { 'background-color': '#ffffff', 'border-radius': '999px' }, [
      node('State', { 'background-color': '#ffffff', 'border-radius': '999px' }, [text('q0')])
    ]);
    expect(drawingOf(markup, []).kinds).toEqual([
      {
        kind: 'State',
        shape: 'white circle with no outline, unseen on the white page',
        count: 1
      }
    ]);
  });

  it("counts a free layout's nodes, hidden only until the page arranges them", () => {
    const arranged: ModelElement = {
      tag: 'div',
      attributes: { class: 'sv-arranged' },
      style: { visibility: 'hidden' },
      children: [node('Vertex', stroke, [text('A')]), node('Vertex', stroke, [text('B')])]
    };
    const hidden = node('Note', { visibility: 'hidden' }, [text('later')]);
    const { kinds } = drawingOf(node(undefined, {}, [arranged, hidden]), []);
    expect(kinds.map(({ kind, count }) => `${kind} ${count}`)).toEqual(['Vertex 2']);
  });

  it('gives sizes where the layout has them', () => {
    const cell = node('Cell', stroke, [text('7')]);
    const { kinds } = drawingOf(node(undefined, {}, [cell]), [
      { element: cell, width: 40.4, height: 30 }
    ]);
    expect(kinds[0]).toMatchObject({ width: 40, height: 30 });
    expect(
      drawingText(
        drawingOf(node(undefined, {}, [cell]), [{ element: cell, width: 40, height: 30 }])
      )
    ).toBe('Cell: 1 box, about 40×30 px.');
  });

  it('counts links, saying how many are loops on their own node', () => {
    const markup = node(undefined, {}, [
      node('State', stroke, [text('q0')]),
      link('0', '1'),
      link('0', '0'),
      link('1', '1')
    ]);
    const drawing = drawingOf(markup, []);
    expect(drawing.links).toEqual({ drawn: 3, loops: 2 });
    expect(drawingText(drawing)).toContain('links: 3 drawn, 2 of them a loop on its own node.');
  });

  it('keeps within its budget, saying how many kinds it leaves out', () => {
    const markup = node(
      undefined,
      {},
      Array.from({ length: 40 }, (_, index) =>
        node(`AQuiteLongKindName${index}`, stroke, [text('x')])
      )
    );
    const said = drawingText(drawingOf(markup, []));
    expect(said.length).toBeLessThanOrEqual(drawingBudget);
    expect(said).toMatch(/and \d+ more kinds/u);
  });
});
