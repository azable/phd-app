import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

import { pointerCalls, slotInsertions, withInsertions } from './components.server';

/** The view with every call to a view wrapped in the slot of the element it draws. */
function slotted(view: string, state = ['values', 'target', 'edges', 'vertices']): string {
  const ast = parse(`${view}<script lang="ts"></script>`, { filename: 'Main.svelte' });
  const components = new Set(['IntText', 'ValuesRow', 'EdgeRow']);
  return withInsertions(
    view,
    slotInsertions(ast.html, view, new Set(state), new Set([...components, 'Int']), components)
  );
}

/** The root's pointer calls, and the view without them. */
function hoisted(view: string) {
  const ast = parse(`${view}<script lang="ts"></script>`, { filename: 'Main.svelte' });
  const found = pointerCalls(
    ast.html,
    view,
    new Set(['i', 'edges', 'e']),
    new Map([['Arrow', { into: 'Values', paint: '__paint_Arrow' }]])
  );
  return { ...found, view: withInsertions(view, found.removals) };
}

describe('pointers', () => {
  it('are drawn around what they point at, so their calls move to the script', () => {
    expect(hoisted('<Node>A</Node>{@render Arrow(i)}{@render Arrow(edges[e].to)}')).toMatchObject({
      view: '<Node>A</Node>',
      calls: [
        '{ view: () => Arrow, value: () => i, path: "i", into: "Values", paint: __paint_Arrow }',
        '{ view: () => Arrow, value: () => edges[e].to, of: () => edges[e], at: () => "to", into: "Values", paint: __paint_Arrow }'
      ],
      problems: []
    });
  });

  it('are rendered at the top of the view, with a position from the state', () => {
    const messages = (view: string) => hoisted(view).problems.map(({ message }) => message);
    expect(messages('{#if i > 0}{@render Arrow(i)}{/if}')[0]).toMatch(/at the top of the view/);
    expect(messages('{#snippet V(x: Values)}{@render Arrow(x)}{/snippet}')[0]).toMatch(
      /at the top of the view/
    );
    expect(messages('{@render Arrow(i + 1)}')[0]).toMatch(/a position from the state/);
  });
});

describe('element slots', () => {
  it('names a variable by its name, and an element by its array and index', () => {
    expect(slotted('{@render Int(target)}')).toBe(
      '<SverlinSlot path="target">{@render Int(target)}</SverlinSlot>'
    );
    expect(slotted('{#each values as value, k}{@render Int(value)}{/each}')).toBe(
      '{#each values as value, k}<SverlinSlot of={values} at={k}>{@render Int(value)}</SverlinSlot>{/each}'
    );
    expect(slotted('{@render Int(values[i])}')).toBe(
      '<SverlinSlot of={values} at={i}>{@render Int(values[i])}</SverlinSlot>'
    );
  });

  it('tells a link where a position at its end comes from', () => {
    expect(slotted('{#each edges as edge}<Link from={edge.from} to="head" />{/each}')).toBe(
      '{#each edges as edge}<Link __fromOf={edge} __fromAt="from" from={edge.from} to="head" />{/each}'
    );
  });

  it('keeps calls side by side in slots of their own', () => {
    expect(slotted('{@render Int(target)}{@render Int(values[0])}')).toBe(
      '<SverlinSlot path="target">{@render Int(target)}</SverlinSlot><SverlinSlot of={values} at={0}>{@render Int(values[0])}</SverlinSlot>'
    );
  });

  it('adds an index to a loop that has none, and names fields by their record', () => {
    expect(slotted('{#each values as value (value)}{@render Int(value)}{/each}')).toBe(
      '{#each values as value, __k1 (value)}<SverlinSlot of={values} at={__k1}>{@render Int(value)}</SverlinSlot>{/each}'
    );
    expect(slotted('{#each edges as edge}{@render Int(edge.weight)}{/each}')).toBe(
      '{#each edges as edge}<SverlinSlot of={edge} at="weight">{@render Int(edge.weight)}</SverlinSlot>{/each}'
    );
  });

  it("passes a component's slot on to the view of its own value", () => {
    expect(
      slotted(
        '{#snippet ValuesRow(list: Values)}{#each list as v}{@render Int(v)}{/each}{/snippet}{#snippet IntText(value: Int)}{@render Other(value)}{/snippet}'
      )
    ).toBe(
      '{#snippet ValuesRow(list: Values)}{#each list as v, __k1}<SverlinSlot of={list} at={__k1}>{@render Int(v)}</SverlinSlot>{/each}{/snippet}{#snippet IntText(value: Int)}{@render Other(value)}{/snippet}'
    );
    expect(slotted('{#snippet EdgeRow(edge: Edge)}{@render Int(edge)}{/snippet}')).toBe(
      '{#snippet EdgeRow(edge: Edge)}<SverlinSlot inherit>{@render Int(edge)}</SverlinSlot>{/snippet}'
    );
  });

  it('gives no element to a computed value, and leaves other snippets alone', () => {
    expect(slotted('{@render Int(target + 1)}{@render label()}')).toBe(
      '<SverlinSlot>{@render Int(target + 1)}</SverlinSlot>{@render label()}'
    );
    expect(slotted('{#each values as value, k}{@const n = value}{@render Int(n)}{/each}')).toBe(
      '{#each values as value, k}{@const n = value}<SverlinSlot of={n}>{@render Int(n)}</SverlinSlot>{/each}'
    );
  });
});
