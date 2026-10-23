import { describe, expect, it } from 'vitest';

import { interpretDomain, traceAlgorithm } from './interpret.server';
import { readMarkers } from './labels.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
`);
const labelsOf = (body: string) =>
  traceAlgorithm(body, undefined, domain).labels.map(({ full, nodes }) => [
    full,
    nodes.map((node) => node.type).join(' ')
  ]);
const problemOf = (body: string) => () => traceAlgorithm(body, undefined, domain);

describe('labels', () => {
  it('blank their markers, keeping every offset, and skip strings and comments', () => {
    const body = '@a[let s = Int(1);] // @b[\n@c[s = s + values[0];]';
    const { code, markers } = readMarkers(body);
    expect(code).toHaveLength(body.length);
    expect(code).toBe('   let s = Int(1);  // @b[\n   s = s + values[0]; ');
    expect(markers.map(({ name, kind }) => [name, kind])).toEqual([
      ['a', 'span'],
      ['c', 'span']
    ]);
  });

  it('label statements, statements in a row, an expression, and a block the code has', () => {
    expect(
      labelsOf(`
        @start[let n = Int(0);
        let m = Int(1);]
        while (@test[n < 3]) @up{
          n = n + 1;
        }
        @last[m = n];
      `)
    ).toEqual([
      ['start', 'VariableDeclaration VariableDeclaration'],
      ['test', 'BinaryExpression'],
      ['up', 'BlockStatement'],
      // An expression that is its statement's whole expression labels the statement.
      ['last', 'ExpressionStatement']
    ]);
  });

  it('label a statement outside a block, as an if’s, by its text with its semicolon', () => {
    expect(
      labelsOf(`
        for (let i = Int(0); i < 3; i++) @pass{
          @stop[if (i > 0) @leave[break;]]
        }
      `)
    ).toEqual([
      ['pass', 'BlockStatement'],
      ['pass.stop', 'IfStatement'],
      ['pass.stop.leave', 'BreakStatement']
    ]);
  });

  it('take the names of the labels around them as a prefix', () => {
    expect(
      labelsOf(`
        @start[let n = Int(0);]
        @loop[while (@test[@low[n < 3] && @small[n < 9]]) {
          n = n + 1;
        }]
      `).map(([full]) => full)
    ).toEqual(['start', 'loop', 'loop.test', 'loop.test.low', 'loop.test.small']);
  });

  it('cover every statement beside a labelled one, leaving a loop’s header and an expression’s surroundings', () => {
    expect(problemOf('let a = Int(1);\n@b[let c = Int(2);]')).toThrow(
      'let a = Int(1); is in the algorithm but in none of the labels beside it (@b)'
    );
    expect(
      problemOf(`
        for (let i = Int(0); i < 3; i++) @pass{
          let a = Int(1);
          @b[let c = Int(2);]
        }
      `)
    ).toThrow('let a = Int(1); is in @pass but in none of the labels beside it (@b)');
    // A loop's header is its control code; the code around a labelled test needs no label.
    expect(
      problemOf(`
        @start[let n = Int(0);]
        for (let i = Int(0); @test[i < 3]; i++) @pass{
          n = n + 1;
        }
      `)
    ).not.toThrow();
  });

  it('report a marker on no code, of the old form, or written wrong, each with the fix', () => {
    expect(problemOf('let n = Int(1); // @step')).toThrow(
      'Labels are written around code, not in comments: @step[…]'
    );
    expect(problemOf('@a{\n  let n = Int(1);\n}')).toThrow(
      '@a{ is on a block of its own, whose declarations later code could not see; wrap the statements as @a[…] instead.'
    );
    expect(problemOf('@a[let n = Int(1);]\n@b[n = n @c[+ 1];]')).toThrow(
      '@c[…] wraps + 1, which is not a statement, statements in a row, or an expression.'
    );
    expect(problemOf('@a[let n = Int(1);')).toThrow('@a[ is never closed with ].');
    expect(problemOf('@a let n = Int(1);')).toThrow('@a needs code to label');
    expect(problemOf('@a.b[let n = Int(1);]')).toThrow("A label's name has no dots");
  });
});
