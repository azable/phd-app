/**
 * A listing language as data: how each construct, statement, and expression of the algorithm is
 * written, as templates whose {slots} the renderer fills with the parts rendered beneath it.
 */

/** How tightly an expression binds: higher binds tighter; a name, literal, or call binds most. */
export type Precedence = number;

/** An operator: its template, how tightly it binds, and which side may hold its own kind. */
export type Operator = {
  template: string;
  precedence: Precedence;
  associates?: 'left' | 'right' | 'none';
};

export type Definition = {
  name: string;
  indent: string;
  /** A body with nothing to list, as Python's pass, or none to leave the head alone. */
  emptyBody?: string;
  literals: {
    true: string;
    false: string;
    /** A position that points nowhere, written as Index(-1). */
    nowhere: string;
    quote: string;
  };
  /**
   * How a function's or operation's name is written: as written, in snake_case (Swap as swap,
   * MaybeSwap as maybe_swap), or in capitals joined by hyphens (binarySearch as BINARY-SEARCH).
   */
  procedures: 'written' | 'snake' | 'capitals';
  /** Names a variable cannot have, written with a _ after them, as Python's from. */
  reserved: readonly string[];
  /** Lines put first when the listing uses something, as import math for math.sqrt. */
  imports?: readonly { uses: string; line: string }[];
  /** A record made from a literal no type names. */
  anonymousRecord: string;
  statements: {
    function: string;
    /**
     * Counted loops, up or down, by one or by {k}: {var} counts from {from}; {last} is the last
     * value it may take, and {past} the first it may not, whichever the loop's test says.
     */
    counted: {
      up: string;
      upBy: string;
      down: string;
      downBy: string;
      /** Counting up by one from 0, where a language has a shorter form. */
      fromZero?: string;
    };
    forOf: string;
    while: string;
    if: string;
    elseIf: string;
    else: string;
    break: string;
    continue: string;
    return: string;
    returnValue: string;
    assign: string;
    /** x op= e, as x += e or x = x + e: {operator} is the binary operator's template. */
    compound: string;
    increment: string;
    decrement: string;
  };
  expressions: {
    binary: Readonly<Record<string, Operator>>;
    logical: Readonly<Record<string, Operator>>;
    unary: Readonly<Record<string, Operator>>;
    conditional: Operator;
    /** An element, a[i]. */
    element: string;
    /** A record's field, e.weight. */
    field: string;
    length: string;
    call: string;
    /** A list, [a, b], and a record, by its type's name and its fields. */
    list: string;
    record: string;
    recordField: string;
    spread: string;
    /** Text with values in it, from a template string: a prefix, and how a value is put in. */
    formatted: { prefix: string; value: string };
    /** Collection methods by name, {object} and {0}, {1} for the arguments. */
    methods: Readonly<Record<string, Operator>>;
    /** Math functions and constants by name, {0}, {1} for the arguments. */
    math: Readonly<Record<string, Operator>>;
    /** Math.floor of a division, a // b, where a language has it. */
    floorDivision?: Operator;
  };
};
