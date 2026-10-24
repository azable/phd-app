/**
 * What the input and algorithm may not compute themselves: an operator on their values, `.length`,
 * or Math. Each is an operator the domain declares (binop, unop), whose function computes it; the
 * problem names the declaration to add and the call to write.
 */

import type { AnyNode, BlockStatement } from 'acorn';

const operatorNames: Record<string, string> = {
  '<': 'Less',
  '<=': 'AtMost',
  '>': 'Greater',
  '>=': 'AtLeast',
  '===': 'Equal',
  '!==': 'Differ',
  '+': 'Add',
  '-': 'Subtract',
  '*': 'Multiply',
  '/': 'Divide',
  '%': 'Remainder',
  '**': 'Power'
};
const comparisons = new Set(['<', '<=', '>', '>=', '===', '!==']);

/**
 * The raw operation a node is, if any: its operator, `.length`, or `Math`. A negative number is a
 * literal, not an operation.
 */
export function rawOperation(node: AnyNode): string | undefined {
  switch (node.type) {
    case 'BinaryExpression':
    case 'UpdateExpression':
      return node.operator;
    case 'UnaryExpression':
      return node.operator === '-' &&
        node.argument.type === 'Literal' &&
        typeof node.argument.value === 'number'
        ? undefined
        : node.operator;
    case 'AssignmentExpression':
      return node.operator === '=' ? undefined : node.operator;
    case 'MemberExpression':
      return !node.computed &&
        node.property.type === 'Identifier' &&
        node.property.name === 'length'
        ? '.length'
        : undefined;
    case 'Identifier':
      return node.name === 'Math' ? 'Math' : undefined;
    case 'TemplateLiteral':
      return node.expressions.length ? 'template' : undefined;
    default:
      return undefined;
  }
}

/** The first raw operation in a block, as a node and what it is. */
export function firstRawOperation(
  root: BlockStatement
): { node: AnyNode; operation: string } | undefined {
  let found: { node: AnyNode; operation: string } | undefined;
  const visit = (node: unknown, parent?: AnyNode): void => {
    if (found || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((child) => visit(child, parent));
    const part = node as AnyNode;
    if (typeof part.type !== 'string') return;
    // A property named Math, as in a.Math, is not Math.
    const property = parent?.type === 'MemberExpression' && parent.property === part;
    const operation = property ? undefined : rawOperation(part);
    if (operation) found = { node: part, operation };
    for (const [key, child] of Object.entries(part)) if (key !== 'loc') visit(child, part);
  };
  visit(root.body);
  return found;
}

/** What the problem needs to know of the domain: its boolean type, and a collection's index type. */
export type RawContext = {
  text: (node: AnyNode) => string;
  flag?: string;
  indexOf: (collection: string) => string | undefined;
};

/**
 * The problem with a raw operation, naming the declaration to add and the call to write; the
 * operands' types when the operation ran, else none.
 */
export function rawProblem(
  node: AnyNode,
  operation: string,
  types: readonly string[] | undefined,
  context: RawContext
): string {
  const { text } = context;
  const flag = context.flag ?? 'Flag';
  const flagFirst = context.flag ? '' : "const Flag = type('boolean'); ";
  // An untyped literal, as true in !true, takes the type its kind of value would have.
  const typed = types?.map((type) =>
    type === 'boolean' ? flag : type === 'number' ? 'Int' : type === 'string' ? 'Text' : type
  );
  const [first = 'Int', second = first] = typed ?? [];
  const a = (type: string) => `${/^[AEIOU]/u.test(type) ? 'an' : 'a'} ${type}`;
  const on = types ? (first === second ? ` on ${first} values` : ` on ${first} and ${second}`) : '';
  if (operation === 'template')
    return `${text(node)}: a template string is computed inside an operator’s function; declare one, as const Label = unop(Int, (n) => Name(\`v\${n}\`));, and apply it, as Label(n).`;
  if (operation === 'Math')
    return 'Math is used only inside an operator’s function; declare one, as const Floor = unop(Int, (x) => Int(Math.floor(x)));, and apply it, as Floor(x).';
  if (operation === '.length' && node.type === 'MemberExpression') {
    const collection = types?.[0] ?? 'Values';
    const index = context.indexOf(collection);
    const declare = `${index ? '' : `const Index = index(${collection}); `}const Length = unop(${collection}, (v) => ${index ?? 'Index'}(v.length));`;
    return `${text(node)}: .length on ${types ? a(collection) : 'a collection'}; declare it, as ${declare}, and write Length(${text(node.object as AnyNode)}).`;
  }
  if (node.type === 'UpdateExpression') {
    const [name, sign] = operation === '++' ? ['Next', '+'] : ['Prev', '-'];
    const target = text(node.argument);
    return `${text(node)}: ${operation}${types ? ` on ${a(first)}` : ''}; declare it, as const ${name} = unop(${first}, (p) => ${first}(p ${sign} 1));, and write ${target} = ${name}(${target}).`;
  }
  if (node.type === 'UnaryExpression') {
    const [name, made] =
      operation === '!' ? ['Not', `${first}(!x)`] : ['Negate', `${first}(${operation}x)`];
    return `${text(node)}: ${operation}${types ? ` on ${a(first)}` : ''}; declare it, as const ${name} = unop(${first}, (x) => ${made});, and write ${name}(${text(node.argument)}).`;
  }
  const symbol = node.type === 'AssignmentExpression' ? operation.slice(0, -1) : operation;
  const name = operatorNames[symbol] ?? 'Op';
  const result = comparisons.has(symbol) ? flag : first;
  const declare = `${comparisons.has(symbol) ? flagFirst : ''}const ${name} = binop(${first}, ${second}, (a, b) => ${result}(a ${symbol} b));`;
  if (node.type === 'AssignmentExpression') {
    const target = text(node.left as AnyNode);
    return `${text(node)}: ${operation}${on}; declare it, as ${declare}, and write ${target} = ${name}(${target}, ${text(node.right)}).`;
  }
  const { left, right } = node as unknown as { left: AnyNode; right: AnyNode };
  return `${text(node)}: ${operation}${on}; declare it, as ${declare}, and write ${name}(${text(left)}, ${text(right)}).`;
}
