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
 * The hidden prop giving a node its kind at each step, from the kind around it (`base`) and the
 * expression as written: a name gives base.Name, anything else the base.
 */
export const kindChoice = (base: string, written: string): string =>
  ` __view={((name) => (typeof name === 'string' && name ? ${JSON.stringify(`${base}.`)} + name : ${JSON.stringify(base)}))(${written})}`;
