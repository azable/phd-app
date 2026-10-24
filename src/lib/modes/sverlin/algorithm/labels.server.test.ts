import { describe, expect, it } from 'vitest';

import { interpretDomain, traceAlgorithm } from './interpret.server';
import { readMarkers } from './labels.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = collection(Int);
  const Flag = type('boolean');
  const Less = binop((a: Int, b: Int) => Flag(a < b));
  const Up = unop((n: Int) => Int(n + 1));
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
        while (@test[Less(n, 3)]) @up{
          n = Up(n);
        }
        @last[m = n];
      `)
    ).toEqual([
      ['start', 'VariableDeclaration VariableDeclaration'],
      ['test', 'CallExpression'],
      ['up', 'BlockStatement'],
      // An expression that is its statement's whole expression labels the statement.
      ['last', 'ExpressionStatement']
    ]);
  });

  it('label a statement outside a block, as an if’s, by its text with its semicolon', () => {
    expect(
      labelsOf(`
        for (let i = Int(0); Less(i, 3); i = Up(i)) @pass{
          @stop[if (Less(0, i)) @leave[break;]]
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
        @loop[while (@test[@low[Less(n, 3)] && @small[Less(n, 9)]]) {
          n = Up(n);
        }]
      `).map(([full]) => full)
    ).toEqual(['start', 'loop', 'loop.test', 'loop.test.low', 'loop.test.small']);
  });

  it('cover every statement beside a labelled one, leaving a loop’s header, leading declarations, and an expression’s surroundings', () => {
    expect(problemOf(`let a = Int(1);\na = Up(a);\n@b[let c = Int(2);]`)).toThrow(
      'a = Up(a); is in the algorithm but in none of the labels beside it (@b)'
    );
    // Declarations leading a block are the lead-up to its first step; one after labelled code is
    // not.
    expect(problemOf('let a = Int(1);\nconst d = Int(2);\n@b[let c = Int(3);]')).not.toThrow();
    expect(
      problemOf(`
        for (let i = Int(0); Less(i, 3); i = Up(i)) @pass{
          let a = Int(1);
          @b[let c = Int(2);]
          let e = Int(3);
          @f[e = Up(e);]
        }
      `)
    ).toThrow('let e = Int(3); is in @pass but in none of the labels beside it (@b, @f)');
    // A loop's header is its control code; the code around a labelled test needs no label.
    expect(
      problemOf(`
        @start[let n = Int(0);]
        for (let i = Int(0); @test[Less(i, 3)]; i = Up(i)) @pass{
          n = Up(n);
        }
      `)
    ).not.toThrow();
  });

  it('report a marker on no code, or written wrong, each with the fix', () => {
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
