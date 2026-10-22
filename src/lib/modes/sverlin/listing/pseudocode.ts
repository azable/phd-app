import type { Definition } from './definition';

const atom = 100;

/** Pseudocode after CLRS, counting from 0 so its positions match the view's. */
export const pseudocode: Definition = {
  name: 'pseudocode',
  indent: '    ',
  literals: { true: 'TRUE', false: 'FALSE', nowhere: 'NIL', quote: '"' },
  procedures: 'capitals',
  anonymousRecord: '({fields})',
  reserved: [],
  statements: {
    function: '{name}({params})',
    counted: {
      up: 'for {var} = {from} to {last}',
      upBy: 'for {var} = {from} to {last} by {k}',
      down: 'for {var} = {from} downto {last}',
      downBy: 'for {var} = {from} downto {last} by {k}'
    },
    forOf: 'for each {var} in {items}',
    while: 'while {test}',
    if: 'if {test}',
    elseIf: 'elseif {test}',
    else: 'else',
    break: 'break',
    continue: 'continue',
    return: 'return',
    returnValue: 'return {value}',
    assign: '{target} = {value}',
    compound: '{target} = {target} {operator} {value}',
    increment: '{target} = {target} + 1',
    decrement: '{target} = {target} - 1'
  },
  expressions: {
    binary: {
      '**': { template: '{left}^{right}', precedence: 9, associates: 'right' },
      '*': { template: '{left} · {right}', precedence: 7 },
      '/': { template: '{left} / {right}', precedence: 7 },
      '%': { template: '{left} mod {right}', precedence: 7 },
      '+': { template: '{left} + {right}', precedence: 6 },
      '-': { template: '{left} - {right}', precedence: 6 },
      '<': { template: '{left} < {right}', precedence: 4, associates: 'none' },
      '<=': { template: '{left} ≤ {right}', precedence: 4, associates: 'none' },
      '>': { template: '{left} > {right}', precedence: 4, associates: 'none' },
      '>=': { template: '{left} ≥ {right}', precedence: 4, associates: 'none' },
      '===': { template: '{left} == {right}', precedence: 4, associates: 'none' },
      '!==': { template: '{left} ≠ {right}', precedence: 4, associates: 'none' }
    },
    logical: {
      '&&': { template: '{left} and {right}', precedence: 2 },
      '||': { template: '{left} or {right}', precedence: 1 },
      '??': { template: '{left} or {right}', precedence: 1 }
    },
    unary: {
      '!': { template: 'not {argument}', precedence: 3 },
      '-': { template: '-{argument}', precedence: 8 },
      '+': { template: '{argument}', precedence: 8 }
    },
    conditional: { template: 'if {test} then {then} else {otherwise}', precedence: 0 },
    element: '{object}[{index}]',
    field: '{object}.{name}',
    length: '{object}.length',
    call: '{name}({arguments})',
    list: '[{items}]',
    record: '({fields})',
    recordField: '{name}: {value}',
    spread: '{argument}',
    formatted: { prefix: '', value: '{{value}}' },
    methods: {
      push: { template: 'append {0} to {object}', precedence: 0 },
      pop: { template: 'remove the last of {object}', precedence: 0 },
      shift: { template: 'remove the first of {object}', precedence: 0 },
      unshift: { template: 'insert {0} at the front of {object}', precedence: 0 },
      slice: { template: '{object}[{0}..{1}]', precedence: atom },
      indexOf: { template: 'the index of {0} in {object}', precedence: 0 },
      includes: { template: '{0} ∈ {object}', precedence: 4 },
      reverse: { template: 'reverse {object}', precedence: 0 },
      join: { template: '{object} joined by {0}', precedence: 0 }
    },
    math: {
      abs: { template: '|{0}|', precedence: atom },
      ceil: { template: '⌈{0}⌉', precedence: atom },
      floor: { template: '⌊{0}⌋', precedence: atom },
      max: { template: 'max({arguments})', precedence: atom },
      min: { template: 'min({arguments})', precedence: atom },
      pow: { template: '{0}^{1}', precedence: 9 },
      round: { template: 'round({0})', precedence: atom },
      sign: { template: 'sign({0})', precedence: atom },
      sqrt: { template: '√{0}', precedence: 8 },
      trunc: { template: 'trunc({0})', precedence: atom },
      PI: { template: 'π', precedence: atom },
      E: { template: 'e', precedence: atom }
    }
  }
};
