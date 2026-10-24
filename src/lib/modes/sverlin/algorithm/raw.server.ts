/**
 * What the input and algorithm may not do themselves: compute, as an operator on their values,
 * `++` and `+=`, `.length`, Math, a template string, or a collection method. Computing is an
 * operator the domain declares (binop, unop), its result written with `=`; the problem names the
 * declaration to add and what to write.
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

/** Collection methods that change the collection, and those that compute from it. */
export const changingMethods: ReadonlySet<string> = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'reverse'
]);
const computingMethods: ReadonlySet<string> = new Set(['indexOf', 'includes', 'slice', 'join']);

/**
 * The raw operation a node is, if any: its operator (a write with `=` is none), `.length`, `Math`,
 * a template string, or a collection method, as `.push`. A negative number is a literal, not an
 * operation.
 */
export function rawOperation(node: AnyNode): string | undefined {
  switch (node.type) {
    case 'BinaryExpression':
    case 'UpdateExpression':
      return node.operator;
    case 'AssignmentExpression':
      return node.operator === '=' ? undefined : node.operator;
    case 'UnaryExpression':
      return node.operator === '-' &&
        node.argument.type === 'Literal' &&
        typeof node.argument.value === 'number'
        ? undefined
        : node.operator;
    case 'MemberExpression':
      return !node.computed &&
        node.property.type === 'Identifier' &&
        node.property.name === 'length'
        ? '.length'
        : undefined;
    case 'CallExpression': {
      const { callee } = node;
      const name =
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property.type === 'Identifier'
          ? callee.property.name
          : undefined;
      return name && (changingMethods.has(name) || computingMethods.has(name))
        ? `.${name}`
        : undefined;
    }
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

/**
 * What the problem needs to know of the domain: its boolean type, a collection's index type, and a
 * collection's element type.
 */
export type RawContext = {
  text: (node: AnyNode) => string;
  flag?: string;
  indexOf: (collection: string) => string | undefined;
  elementOf: (collection: string) => string | undefined;
};

/**
 * The problem with a raw operation, naming the declarations to add and the call to write; the
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
    return `${text(node)}: a template string is computed inside an operator’s function; declare one, as const Label = unop((n: Int) => Name(\`v\${n}\`));, and apply it, as Label(n).`;
  if (operation === 'Math')
    return 'Math is used only inside an operator’s function; declare one, as const Floor = unop((x: Int) => Int(Math.floor(x)));, and apply it, as Floor(x).';
  if (operation === '.length' && node.type === 'MemberExpression') {
    const collection = types?.[0] ?? 'Values';
    const index = context.indexOf(collection);
    const declare = `${index ? '' : `const Index = index(${collection}); `}const Length = unop((v: ${collection}) => ${index ?? 'Index'}(v.length));`;
    return `${text(node)}: .length on ${types ? a(collection) : 'a collection'}; declare it, as ${declare}, and write Length(${text(node.object as AnyNode)}).`;
  }
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
    const method = operation.slice(1);
    const owner = text(node.callee.object as AnyNode);
    const collection = types?.[0] ?? 'Values';
    const element = context.elementOf(collection) ?? 'Int';
    const argument = node.arguments[0] ? text(node.arguments[0] as AnyNode) : '';
    if (changingMethods.has(method)) {
      const [operator, made, read] = {
        push: [
          'Append',
          `binop((c: ${collection}, x: ${element}) => ${collection}([...c, x]))`,
          ''
        ],
        unshift: [
          'Prepend',
          `binop((c: ${collection}, x: ${element}) => ${collection}([x, ...c]))`,
          ''
        ],
        shift: ['Rest', `unop((c: ${collection}) => ${collection}(c.slice(1)))`, `${owner}[0]`],
        pop: [
          'Front',
          `unop((c: ${collection}) => ${collection}(c.slice(0, -1)))`,
          'the last element'
        ],
        reverse: ['Reversed', `unop((c: ${collection}) => ${collection}(c.slice().reverse()))`, '']
      }[method as 'push']!;
      const write = `${owner} = ${operator}(${owner}${argument ? `, ${argument}` : ''})`;
      return `${text(node)}: computes a new ${collection} from ${owner}; declare an operator, as const ${operator} = ${made};,${read ? ` read what it takes first (${read}),` : ''} and write ${write}.`;
    }
    const index = context.indexOf(collection) ?? 'Index';
    const [operator, made] = {
      indexOf: ['Find', `binop((c: ${collection}, x: ${element}) => ${index}(c.indexOf(x)))`],
      includes: ['Has', `binop((c: ${collection}, x: ${element}) => ${flag}(c.includes(x)))`],
      slice: ['Part', `unop((c: ${collection}) => ${collection}(c.slice(1)))`],
      join: ['Joined', `unop((c: ${collection}) => Text(c.join(',')))`]
    }[method as 'indexOf']!;
    const operands = method === 'slice' || method === 'join' ? owner : `${owner}, ${argument}`;
    return `${text(node)}: computed from ${owner}; declare an operator, as const ${operator} = ${made};, and write ${operator}(${operands}).`;
  }
  if (node.type === 'UpdateExpression') {
    const [name, sign] = operation === '++' ? ['Next', '+'] : ['Prev', '-'];
    const target = text(node.argument);
    return `${text(node)}: ${operation}${types ? ` on ${a(first)}` : ''}; declare it, as const ${name} = unop((p: ${first}) => ${first}(p ${sign} 1));, and write ${target} = ${name}(${target}).`;
  }
  if (node.type === 'UnaryExpression') {
    const [name, made] =
      operation === '!' ? ['Not', `${first}(!x)`] : ['Negate', `${first}(${operation}x)`];
    return `${text(node)}: ${operation}${types ? ` on ${a(first)}` : ''}; declare it, as const ${name} = unop((x: ${first}) => ${made});, and write ${name}(${text(node.argument)}).`;
  }
  const symbol = node.type === 'AssignmentExpression' ? operation.slice(0, -1) : operation;
  const name = operatorNames[symbol] ?? 'Op';
  const result = comparisons.has(symbol) ? flag : first;
  const declare = `${comparisons.has(symbol) ? flagFirst : ''}const ${name} = binop((a: ${first}, b: ${second}) => ${result}(a ${symbol} b));`;
  if (node.type === 'AssignmentExpression') {
    const target = text(node.left as AnyNode);
    return `${text(node)}: ${operation}${on}; declare it, as ${declare}, and write ${target} = ${name}(${target}, ${text(node.right)}).`;
  }
  const { left, right } = node as unknown as { left: AnyNode; right: AnyNode };
  return `${text(node)}: ${operation}${on}; declare it, as ${declare}, and write ${name}(${text(left)}, ${text(right)}).`;
}

/**
 * The first application of a domain operator whose result is unused, with its problem: operators
 * change nothing, so discarding one is a mistake. Unused is a statement's expression, the sides of
 * `&&`, `||`, `??`, and `? :` whose value is itself unused, a sequence's parts, and a `for`
 * update. The fix assigns to the first operand where it is a place of the result's type.
 */
export function firstDiscarded(
  root: BlockStatement,
  operators: Readonly<Record<string, { operands: readonly string[]; result: string }>>,
  text: (node: AnyNode) => string
): { node: AnyNode; message: string } | undefined {
  let found: { node: AnyNode; message: string } | undefined;
  const unused = (node: AnyNode | null | undefined): void => {
    if (found || !node) return;
    switch (node.type) {
      case 'CallExpression': {
        const operator =
          node.callee.type === 'Identifier' ? operators[node.callee.name] : undefined;
        if (!operator) return;
        const [first] = node.arguments as AnyNode[];
        const place =
          first &&
          (first.type === 'Identifier' || first.type === 'MemberExpression') &&
          operator.operands[0] === operator.result;
        const a = /^[AEIOU]/u.test(operator.result) ? 'an' : 'a';
        found = {
          node,
          message: `${text(node)} computes ${a} ${operator.result} and discards it; operators change nothing. Write ${place ? `${text(first)} = ${text(node)}` : `const result = ${text(node)}`}.`
        };
        return;
      }
      case 'LogicalExpression':
        return unused(node.right);
      case 'ConditionalExpression':
        unused(node.consequent);
        return unused(node.alternate);
      case 'SequenceExpression':
        return node.expressions.forEach((part) => unused(part));
      default:
        return;
    }
  };
  const visit = (node: unknown): void => {
    if (found || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const part = node as AnyNode;
    if (typeof part.type !== 'string') return;
    if (part.type === 'ExpressionStatement') unused(part.expression);
    if (part.type === 'ForStatement') unused(part.update);
    for (const [key, child] of Object.entries(part)) if (key !== 'loc') visit(child);
  };
  visit(root.body);
  return found;
}
