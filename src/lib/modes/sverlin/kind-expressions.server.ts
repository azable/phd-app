/**
 * A kind written as an expression, as kind={k === j ? 'AtJ' : k < i ? 'Sorted' : undefined}: every
 * result is a name written in the source, or undefined (and any other falsy value) for the layout's
 * or view's own kind, so every kind is known before the view runs and the design has its variables.
 */

type Expression = { type?: string; [key: string]: unknown };

/**
 * The names an expression can give, with undefined for no kind of its own; undefined itself where
 * a result is not written in the source, as `'At' + name`.
 */
export function kindResults(expression: Expression): (string | undefined)[] | undefined {
  switch (expression.type) {
    case 'Literal':
      return typeof expression.value === 'string' ? [expression.value] : undefined;
    case 'Identifier':
      return expression.name === 'undefined' ? [undefined] : undefined;
    case 'ConditionalExpression': {
      const sides = [expression.consequent, expression.alternate].map((side) =>
        kindResults(side as Expression)
      );
      return sides.every(Boolean) ? sides.flat() : undefined;
    }
    case 'LogicalExpression': {
      const right = kindResults(expression.right as Expression);
      if (!right) return undefined;
      // A test && 'Name' gives the name, or the test's falsy value: no kind of its own.
      if (expression.operator === '&&') return [undefined, ...right];
      const left = kindResults(expression.left as Expression);
      return left ? [...left, ...right] : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * The hidden props giving a node its kind at each step, from the kind around it (`base`) and the
 * expression as written: a name gives base.Name, anything else the base. `__kindOf` evaluates the
 * expression again with each variable it `reads` that is absent at a step as undefined, not as the
 * value standing in for it, so its own tests choose, as k === j being false where j is absent. A
 * {@const} name it reads is absent where a variable its value reads (`held`) is.
 */
export function kindChoice(
  base: string,
  written: string,
  reads: string[],
  held: ReadonlyMap<string, string[]> = new Map()
): string {
  const named = (name: unknown) =>
    `(typeof (${name}) === 'string' && (${name}) ? ${JSON.stringify(`${base}.`)} + (${name}) : ${JSON.stringify(base)})`;
  const variables = reads.filter((name) => /^[A-Za-z_$][\w$]*$/u.test(name));
  const standsFor = variables.map((name) => held.get(name) ?? [name]);
  const choose = `(${variables.join(', ')}) => ${named(`(${written})`)}`;
  return ` __view={${named(`(${written})`)}} __kindOf={{ reads: ${JSON.stringify(standsFor)}, values: [${variables.join(', ')}], choose: ${choose} }}`;
}
