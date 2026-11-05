import { describe, expect, it } from 'vitest';

import { interpretDomain, traceAlgorithm } from './interpret.server';
import { readMarkers } from './labels.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: 0, max: 9 });
  const Values = array(Int, { max: 8 });
  const Flag = type('boolean');
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
          n++;
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
        for (let i = Int(0); (i < 3); i++) @pass{
          @stop[if ((0 < i)) @leave[break;]]
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
          n++;
        }]
      `).map(([full]) => full)
    ).toEqual(['start', 'loop', 'loop.test', 'loop.test.low', 'loop.test.small']);
  });

  it('cover every statement beside a labelled one, leaving a loop’s header, leading declarations, and an expression’s surroundings', () => {
    expect(problemOf(`let a = Int(1);\na++;\n@b[let c = Int(2);]`)).toThrow(
      'a++; is in the algorithm but in none of the labels beside it (@b)'
    );
    // Declarations leading a block are the lead-up to its first step; one after labelled code is
    // not.
    expect(problemOf('let a = Int(1);\nconst d = Int(2);\n@b[let c = Int(3);]')).not.toThrow();
    expect(
      problemOf(`
        for (let i = Int(0); (i < 3); i++) @pass{
          let a = Int(1);
          @b[let c = Int(2);]
          let e = Int(3);
          @f[e++;]
        }
      `)
    ).toThrow('let e = Int(3); is in @pass but in none of the labels beside it (@pass.b, @pass.f)');
    // A loop's header is its control code; the code around a labelled test needs no label.
    expect(
      problemOf(`
        @start[let n = Int(0);]
        for (let i = Int(0); @test[i < 3]; i++) @pass{
          n++;
        }
      `)
    ).not.toThrow();
  });

  it('group a span beside an operator as parentheses do, its code one operand as written', () => {
    // Project 763e0a02's test: without grouping, a && b || c parses as (a && b) || c, and the
    // second label wrapped no single expression.
    const loop = (cheaper: string) => `
      @init[let best = Int(9);]
      for (@first[let i = Int(0)]; @more[i < 3]; @next[i++]) @scan{
        if (@seen[i > 0] && @cheaper[${cheaper}]) @improve{
          best = i;
        }
      }
    `;
    for (const cheaper of [
      'best === Int(9) || i < best',
      '(\n          best === Int(9) ||\n          i < best\n        )'
    ])
      expect(labelsOf(loop(cheaper))).toContainEqual(['scan.cheaper', 'LogicalExpression']);
    const { code } = readMarkers('@r[let r = @a[x] && @b[y || z];]');
    expect(code).toBe('   let r =   (x) &&   (y || z); ');
  });

  it('report a marker on no code, or written wrong, each with the fix', () => {
    expect(problemOf('@a{\n  let n = Int(1);\n}')).toThrow(
      '@a{ here is on a block of its own, whose declarations later code could not see; wrap the statements as @a[…] instead. (As the body of an if, an else, a loop or a function, @a{ is right.)'
    );
    expect(problemOf('@a[let n = Int(1);]\n@b[n = n @c[+ 1];]')).toThrow(
      '@c[…] wraps + 1, which is not a statement, statements in a row, or an expression.'
    );
    expect(problemOf('@a[let n = Int(1);')).toThrow('@a[ is never closed with ].');
    expect(problemOf('@a let n = Int(1);')).toThrow('@a needs code to label');
    expect(problemOf('@a.b[let n = Int(1);]')).toThrow("A label's name has no dots");
  });

  it("refuse a span written as an if's, an else's or a loop's body, saying a body takes @name{", () => {
    // Project f47eb2ed's merge: its branches as spans, which parsed as nothing but "Unexpected token".
    const branches = `
      @start[let n = Int(1);]
      while (@more[n < 3]) @merge{
        if (@choose[n < 2]) @takeLeft[
          n++;
          n++;
        ] else @takeRight[
          n = n + 2;
          n++;
        ]
      }
    `;
    expect(problemOf(branches)).toThrow(
      '@takeLeft[ is the body of an if: a body takes a block label, as if (…) @takeLeft{ … } else @…{ … }; @takeLeft[…] wraps statements inside a block.'
    );
    expect(problemOf('@start[let n = Int(1);]\nwhile (@more[n < 3]) @step[n++; n++;]')).toThrow(
      '@step[ is the body of a while loop: a body takes a block label, as while (…) @step{ … }'
    );
    // Its branches as blocks build.
    expect(
      problemOf(
        branches
          .replace('@takeLeft[', '@takeLeft{')
          .replace('] else @takeRight[', '} else @takeRight{')
          .replace(/\n\s*\]\n\s*\}/u, '\n}\n}')
      )
    ).not.toThrow();
  });
});
