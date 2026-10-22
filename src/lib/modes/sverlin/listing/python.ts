import type { Definition } from './definition';

const atom = 100;

export const python: Definition = {
  name: 'python',
  indent: '    ',
  emptyBody: 'pass',
  literals: { true: 'True', false: 'False', nowhere: '-1', quote: '"' },
  procedures: 'snake',
  imports: [{ uses: 'math.', line: 'import math' }],
  anonymousRecord: 'dict({fields})',
  reserved: [
    'and',
    'as',
    'assert',
    'class',
    'def',
    'del',
    'elif',
    'except',
    'from',
    'global',
    'import',
    'in',
    'is',
    'lambda',
    'nonlocal',
    'not',
    'or',
    'pass',
    'raise',
    'try',
    'with',
    'len',
    'range',
    'list',
    'max',
    'min',
    'abs',
    'round'
  ],
  statements: {
    function: 'def {name}({params}):',
    counted: {
      up: 'for {var} in range({from}, {past}):',
      upBy: 'for {var} in range({from}, {past}, {k}):',
      down: 'for {var} in range({from}, {past}, -1):',
      downBy: 'for {var} in range({from}, {past}, -{k}):',
      fromZero: 'for {var} in range({past}):'
    },
    forOf: 'for {var} in {items}:',
    while: 'while {test}:',
    if: 'if {test}:',
    elseIf: 'elif {test}:',
    else: 'else:',
    break: 'break',
    continue: 'continue',
    return: 'return',
    returnValue: 'return {value}',
    assign: '{target} = {value}',
    compound: '{target} {operator}= {value}',
    increment: '{target} += 1',
    decrement: '{target} -= 1'
  },
  expressions: {
    binary: {
      '**': { template: '{left} ** {right}', precedence: 9, associates: 'right' },
      '*': { template: '{left} * {right}', precedence: 7 },
      '/': { template: '{left} / {right}', precedence: 7 },
      '%': { template: '{left} % {right}', precedence: 7 },
      '+': { template: '{left} + {right}', precedence: 6 },
      '-': { template: '{left} - {right}', precedence: 6 },
      '<': { template: '{left} < {right}', precedence: 4, associates: 'none' },
      '<=': { template: '{left} <= {right}', precedence: 4, associates: 'none' },
      '>': { template: '{left} > {right}', precedence: 4, associates: 'none' },
      '>=': { template: '{left} >= {right}', precedence: 4, associates: 'none' },
      '===': { template: '{left} == {right}', precedence: 4, associates: 'none' },
      '!==': { template: '{left} != {right}', precedence: 4, associates: 'none' }
    },
    logical: {
      '&&': { template: '{left} and {right}', precedence: 2 },
      '||': { template: '{left} or {right}', precedence: 1 },
      '??': { template: '{left} or {right}', precedence: 1 }
    },
    unary: {
      '!': { template: 'not {argument}', precedence: 3 },
      '-': { template: '-{argument}', precedence: 8 },
      '+': { template: '+{argument}', precedence: 8 }
    },
    conditional: { template: '{then} if {test} else {otherwise}', precedence: 0 },
    element: '{object}[{index}]',
    field: '{object}.{name}',
    length: 'len({object})',
    call: '{name}({arguments})',
    list: '[{items}]',
    record: '{name}({fields})',
    recordField: '{name}={value}',
    spread: '*{argument}',
    formatted: { prefix: 'f', value: '{{value}}' },
    methods: {
      push: { template: '{object}.append({0})', precedence: atom },
      pop: { template: '{object}.pop()', precedence: atom },
      shift: { template: '{object}.pop(0)', precedence: atom },
      unshift: { template: '{object}.insert(0, {0})', precedence: atom },
      slice: { template: '{object}[{0}:{1}]', precedence: atom },
      indexOf: { template: '{object}.index({0})', precedence: atom },
      includes: { template: '{0} in {object}', precedence: 4 },
      reverse: { template: '{object}.reverse()', precedence: atom },
      join: { template: '{0}.join(map(str, {object}))', precedence: atom }
    },
    math: {
      abs: { template: 'abs({0})', precedence: atom },
      ceil: { template: 'math.ceil({0})', precedence: atom },
      floor: { template: 'math.floor({0})', precedence: atom },
      max: { template: 'max({arguments})', precedence: atom },
      min: { template: 'min({arguments})', precedence: atom },
      pow: { template: '{0} ** {1}', precedence: 9 },
      round: { template: 'round({0})', precedence: atom },
      sign: { template: 'math.copysign(1, {0})', precedence: atom },
      sqrt: { template: 'math.sqrt({0})', precedence: atom },
      trunc: { template: 'math.trunc({0})', precedence: atom },
      PI: { template: 'math.pi', precedence: atom },
      E: { template: 'math.e', precedence: atom }
    },
    floorDivision: { template: '{left} // {right}', precedence: 7 }
  }
};
