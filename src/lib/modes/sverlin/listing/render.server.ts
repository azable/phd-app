/**
 * Render the algorithm block as a listing in a language a definition describes, marking the text
 * each node of the source became, so a step can light what it ran. The listing holds the
 * operations with block bodies the algorithm calls, its functions, then its top-level statements;
 * an operation with an expression body is written where it is called, its operands put in.
 */

import type {
  AnyNode,
  ArrowFunctionExpression,
  BlockStatement,
  CallExpression,
  Expression,
  ForStatement,
  FunctionDeclaration,
  Pattern,
  Property,
  SpreadElement,
  Statement
} from 'acorn';

import { spanKey, type ListingHints } from '../algorithm/interpret.server';
import { spanOf } from '../algorithm/parse.server';
import type { DomainRegistry, RecordType } from '../algorithm/structures.server';
import type { Definition, Operator } from './definition';
import { filled, joined, Marked, type Mark } from './text';

/**
 * A listing's text and its marks; a listing of the source's own also has its regions, so a lit
 * region can leave out the regions inside it that did not run (see light.server.ts).
 */
export type Listing = {
  text: string;
  marks: readonly Mark[];
  regions?: readonly { start: number; end: number }[];
};

type Rendered = { text: Marked; precedence: number };
type Line = { depth: number; text: Marked };
type Block = 'algorithm' | 'domain';
type OperationType = RecordType & { operation: { body: ArrowFunctionExpression } };

/**
 * Where a node is rendered: its block, the inlined calls it is written within (a key prefix, so a
 * body written at two calls is marked at each), and in an operation's body, what each operand is
 * written as, if not by its name, and the collection a position operand points into.
 */
type Context = {
  block: Block;
  within: string;
  operands?: Readonly<Record<string, { text?: Rendered; collection?: string }>>;
};

const atom = 100;
const algorithm: Context = { block: 'algorithm', within: '' };

export function renderListing(
  root: BlockStatement,
  domain: DomainRegistry,
  hints: ListingHints,
  language: Definition
): Listing {
  return new Renderer(domain, hints, language).listing(root);
}

class Renderer {
  constructor(
    readonly domain: DomainRegistry,
    readonly hints: ListingHints,
    readonly language: Definition
  ) {}

  listing(root: BlockStatement): Listing {
    const functions = root.body.filter(
      (statement): statement is FunctionDeclaration => statement.type === 'FunctionDeclaration'
    );
    // The parser's wrapper begins with 'use strict', which is no statement of the algorithm.
    const rest = root.body.filter(
      (statement) => statement.type !== 'FunctionDeclaration' && !('directive' in statement)
    );
    const groups: Line[][] = [
      ...this.#calledOperations(root).map((operation) => this.#definition(operation)),
      ...functions.map((declared) => this.#statement(declared, 0, algorithm)),
      this.#statements(rest, 0, algorithm)
    ].filter((lines) => lines.length);
    const lines = groups.flatMap((group, index) =>
      index ? [{ depth: 0, text: new Marked('') }, ...group] : group
    );
    let listing = joined(
      lines.map(({ depth, text }) => joined([this.language.indent.repeat(depth), text])),
      '\n'
    );
    const imports = (this.language.imports ?? [])
      .filter(({ uses }) => listing.text.includes(uses))
      .map(({ line }) => line);
    if (imports.length) listing = joined([...imports, '', listing], '\n');
    return { text: listing.text, marks: listing.marks };
  }

  // ---------------------------------------------------------------------------------------------
  // Statements

  #statements(statements: readonly Statement[], depth: number, context: Context): Line[] {
    return statements.flatMap((statement) => this.#statement(statement, depth, context));
  }

  /** A loop's or branch's body, one deeper, or the language's empty body. */
  #body(body: Statement, depth: number, context: Context): Line[] {
    const lines = this.#statement(body, depth + 1, context);
    if (lines.length || !this.language.emptyBody) return lines;
    return [{ depth: depth + 1, text: new Marked(this.language.emptyBody) }];
  }

  #statement(node: Statement, depth: number, context: Context): Line[] {
    const { statements } = this.language;
    const line = (text: Marked): Line[] => [{ depth, text: text.from(this.#key(node, context)) }];
    switch (node.type) {
      case 'BlockStatement':
        return this.#statements(node.body, depth, context);
      case 'EmptyStatement':
        return [];
      case 'ExpressionStatement':
        if (node.expression.type === 'YieldExpression') return [];
        // Marked as its expression too, as an assignment's write is at the assignment.
        return line(this.#expression(node.expression, context).text);
      case 'VariableDeclaration':
        return node.declarations.map((declarator) => ({
          depth,
          text: filled(statements.assign, {
            target: this.#variable((declarator.id as { name: string }).name),
            value: this.#expression(declarator.init as Expression, context).text
          }).from(this.#key(declarator, context))
        }));
      case 'IfStatement': {
        const lines: Line[] = [];
        let branch: Statement | null | undefined = node;
        let head = statements.if;
        while (branch?.type === 'IfStatement') {
          lines.push(
            { depth, text: this.#head(head, { test: branch.test }, branch, context) },
            ...this.#body(branch.consequent, depth, context)
          );
          head = statements.elseIf;
          branch = branch.alternate;
        }
        if (branch)
          lines.push(
            { depth, text: new Marked(statements.else) },
            ...this.#body(branch, depth, context)
          );
        return lines;
      }
      case 'WhileStatement':
        return [
          { depth, text: this.#head(statements.while, { test: node.test }, node, context) },
          ...this.#body(node.body, depth, context)
        ];
      case 'ForStatement':
        return [
          { depth, text: this.#counted(node, context) },
          ...this.#body(node.body, depth, context)
        ];
      case 'ForOfStatement': {
        const declarator = (node.left as { declarations: { id: Pattern }[] }).declarations[0];
        const name = this.#variable((declarator.id as { name: string }).name).from(
          this.#key(node.left, context)
        );
        return [
          {
            depth,
            text: filled(statements.forOf, {
              var: name,
              items: this.#expression(node.right, context).text
            }).from(this.#key(node, context))
          },
          ...this.#body(node.body, depth, context)
        ];
      }
      case 'ReturnStatement':
        return line(
          node.argument
            ? filled(statements.returnValue, {
                value: this.#expression(node.argument, context).text
              })
            : new Marked(statements.return)
        );
      case 'BreakStatement':
        return line(new Marked(statements.break));
      case 'ContinueStatement':
        return line(new Marked(statements.continue));
      case 'FunctionDeclaration': {
        const params = node.params.map((param) =>
          this.#variable((param as { name: string }).name).from(this.#key(param, context))
        );
        return [
          {
            depth,
            text: filled(statements.function, {
              name: this.#procedure(node.id?.name ?? ''),
              params: joined(params, ', ')
            }).from(this.#key(node, context))
          },
          ...this.#body(node.body, depth, context)
        ];
      }
      default:
        throw new Error(`The ${this.language.name} listing cannot write ${node.type}.`);
    }
  }

  /** A loop's or branch's head, marked as the node and with its test's own marks. */
  #head(
    template: string,
    parts: Record<string, Expression>,
    node: AnyNode,
    context: Context
  ): Marked {
    const slots = Object.fromEntries(
      Object.entries(parts).map(([name, part]) => [name, this.#expression(part, context).text])
    );
    return filled(template, slots).from(this.#key(node, context));
  }

  /**
   * A counted loop's head, which every part of its header lights: the declaration, the test, the
   * counter read there, and the update.
   */
  #counted(node: ForStatement, context: Context): Marked {
    const { counted } = this.language.statements;
    const declarator = (node.init as { declarations: { id: Pattern; init: Expression }[] })
      .declarations[0];
    const test = node.test as Expression & {
      left: Expression;
      right: Expression;
      operator: string;
    };
    const update = node.update as Expression;
    const up = test.operator === '<' || test.operator === '<=';
    const strict = test.operator === '<' || test.operator === '>';
    const k =
      update.type === 'AssignmentExpression'
        ? String((update.right as { value: number }).value)
        : '1';
    const from = this.#expression(declarator.init, context);
    const step = up ? 1 : -1;
    const slots = {
      var: this.#variable((declarator.id as { name: string }).name),
      from: from.text,
      k,
      past: this.#shifted(test.right, strict ? 0 : step, context).text,
      last: this.#shifted(test.right, strict ? -step : 0, context).text
    };
    const fromZero = up && k === '1' && from.text.text === '0' && counted.fromZero;
    const template =
      fromZero ||
      (up ? (k === '1' ? counted.up : counted.upBy) : k === '1' ? counted.down : counted.downBy);
    let head = filled(template, slots);
    for (const part of [node, declarator, test, test.left, update])
      head = head.from(this.#key(part as AnyNode, context));
    return head;
  }

  /** A bound moved by one, folding into a constant it ends with, so n - 1 + 1 is n. */
  #shifted(node: Expression, by: number, context: Context): Rendered {
    if (by === 0) return this.#expression(node, context);
    const literal = this.#number(node);
    if (literal !== undefined) return { text: new Marked(String(literal + by)), precedence: atom };
    if (node.type === 'BinaryExpression' && (node.operator === '+' || node.operator === '-')) {
      const constant = this.#number(node.right as Expression);
      if (constant !== undefined) {
        const total = (node.operator === '+' ? constant : -constant) + by;
        const left = this.#expression(node.left as Expression, context);
        if (total === 0) return left;
        return this.#operator(this.language.expressions.binary[total > 0 ? '+' : '-'], {
          left,
          right: { text: new Marked(String(Math.abs(total))), precedence: atom }
        });
      }
    }
    return this.#operator(this.language.expressions.binary[by > 0 ? '+' : '-'], {
      left: this.#expression(node, context),
      right: { text: new Marked(String(Math.abs(by))), precedence: atom }
    });
  }

  /** A number written plainly or through a type, as 3 or Index(3). */
  #number(node: Expression): number | undefined {
    const inner = this.#unwrapped(node);
    if (inner.type === 'Literal' && typeof inner.value === 'number') return inner.value;
    if (
      inner.type === 'UnaryExpression' &&
      inner.operator === '-' &&
      inner.argument.type === 'Literal' &&
      typeof inner.argument.value === 'number'
    )
      return -inner.argument.value;
    return undefined;
  }

  /** An expression without the single-value type it is made with, as 0 for Index(0). */
  #unwrapped(node: Expression): Expression {
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') return node;
    const type = this.domain.atoms[node.callee.name];
    if (!type) return node;
    return node.arguments[type.index && node.arguments.length === 2 ? 1 : 0] as Expression;
  }

  /** An expression in a statement of its own: an assignment, an update, or a call. */
  #effect(node: Expression, context: Context): Marked {
    const { statements } = this.language;
    if (node.type === 'AssignmentExpression') {
      const target = this.#expression(node.left as Expression, context).text;
      const value = this.#expression(node.right, context).text;
      if (node.operator === '=') return filled(statements.assign, { target, value });
      const operator = this.language.expressions.binary[node.operator.slice(0, -1)];
      return filled(statements.compound, {
        target,
        value,
        operator: operator.template.replace(/^\{left\} | \{right\}$/gu, '')
      });
    }
    if (node.type === 'UpdateExpression')
      return filled(node.operator === '++' ? statements.increment : statements.decrement, {
        target: this.#expression(node.argument, context).text
      });
    return this.#expression(node, context).text;
  }

  // ---------------------------------------------------------------------------------------------
  // Expressions

  #expression(node: Expression | SpreadElement, context: Context): Rendered {
    const rendered = this.#unmarked(node, context);
    return { ...rendered, text: rendered.text.from(this.#key(node, context)) };
  }

  #unmarked(node: Expression | SpreadElement, context: Context): Rendered {
    const { expressions, literals } = this.language;
    switch (node.type) {
      case 'Identifier': {
        const operand = context.operands?.[node.name];
        if (operand?.text) return operand.text;
        return { text: this.#variable(node.name), precedence: atom };
      }
      case 'Literal':
        if (typeof node.value === 'boolean')
          return {
            text: new Marked(node.value ? literals.true : literals.false),
            precedence: atom
          };
        if (typeof node.value === 'string')
          return { text: new Marked(this.#quoted(node.value)), precedence: atom };
        return { text: new Marked(String(node.value)), precedence: atom };
      case 'TemplateLiteral': {
        const { prefix, value } = expressions.formatted;
        const parts: (Marked | string)[] = [`${prefix}${literals.quote}`];
        node.quasis.forEach((quasi, index) => {
          parts.push(quasi.value.cooked ?? '');
          const expression = node.expressions[index];
          if (expression)
            parts.push(filled(value, { value: this.#expression(expression, context).text }));
        });
        parts.push(literals.quote);
        return { text: joined(parts), precedence: atom };
      }
      case 'ArrayExpression':
        return {
          text: filled(expressions.list, {
            items: joined(
              node.elements.map((element) => this.#expression(element as Expression, context).text),
              ', '
            )
          }),
          precedence: atom
        };
      case 'ObjectExpression':
        return {
          text: this.#record(node.properties as Property[], undefined, context),
          precedence: atom
        };
      case 'SpreadElement':
        return {
          text: filled(expressions.spread, {
            argument: this.#expression(node.argument, context).text
          }),
          precedence: atom
        };
      case 'MemberExpression':
        return this.#member(node, context);
      case 'CallExpression':
        return this.#call(node, context);
      case 'BinaryExpression':
        return this.#operator(expressions.binary[node.operator], {
          left: this.#expression(node.left as Expression, context),
          right: this.#expression(node.right, context)
        });
      case 'LogicalExpression':
        return this.#operator(expressions.logical[node.operator], {
          left: this.#expression(node.left, context),
          right: this.#expression(node.right, context)
        });
      case 'UnaryExpression':
        return this.#operator(expressions.unary[node.operator], {
          argument: this.#expression(node.argument, context)
        });
      case 'ConditionalExpression':
        return this.#operator(expressions.conditional, {
          test: this.#expression(node.test, context),
          then: this.#expression(node.consequent, context),
          otherwise: this.#expression(node.alternate, context)
        });
      case 'AssignmentExpression':
      case 'UpdateExpression':
        return { text: this.#effect(node, context), precedence: 0 };
      case 'SequenceExpression':
        return {
          text: joined(
            node.expressions.map((part) => this.#expression(part, context).text),
            ', '
          ),
          precedence: 0
        };
      default:
        throw new Error(`The ${this.language.name} listing cannot write ${node.type}.`);
    }
  }

  #member(node: Expression & { type: 'MemberExpression' }, context: Context): Rendered {
    const { expressions } = this.language;
    const object = node.object as Expression;
    if (object.type === 'Identifier' && object.name === 'Math' && !node.computed) {
      const constant = expressions.math[(node.property as { name: string }).name];
      return { text: new Marked(constant.template), precedence: constant.precedence };
    }
    if (node.computed)
      return {
        text: filled(expressions.element, {
          object: this.#tight(this.#expression(object, context)),
          index: this.#expression(node.property as Expression, context).text
        }),
        precedence: atom
      };
    const name = (node.property as { name: string }).name;
    if (name === 'length')
      return {
        text: filled(expressions.length, {
          object: this.#tight(this.#expression(object, context))
        }),
        precedence: atom
      };
    if (name === 'value') {
      const collection = this.#pointedInto(object, context, spanKey(context.block, spanOf(node)));
      if (collection !== undefined)
        return {
          text: filled(expressions.element, {
            object: this.#variable(collection),
            index: this.#expression(object, context).text
          }),
          precedence: atom
        };
    }
    return {
      text: filled(expressions.field, {
        object: this.#tight(this.#expression(object, context)),
        name: this.#variable(name)
      }),
      precedence: atom
    };
  }

  /**
   * The collection a position points into, for its .value: an operand's, else the one the run
   * read there.
   */
  #pointedInto(position: Expression, context: Context, use: string): string | undefined {
    if (position.type === 'Identifier' && context.operands?.[position.name])
      return context.operands[position.name].collection;
    return context.block === 'algorithm' ? this.hints.values[use] : undefined;
  }

  #call(node: CallExpression, context: Context): Rendered {
    const { expressions } = this.language;
    const callee = node.callee;
    const args = node.arguments as (Expression | SpreadElement)[];
    if (callee.type === 'MemberExpression') {
      const object = callee.object as Expression;
      const name = (callee.property as { name: string }).name;
      if (object.type === 'Identifier' && object.name === 'Math') {
        const [first] = args;
        if (
          name === 'floor' &&
          expressions.floorDivision &&
          first?.type === 'BinaryExpression' &&
          first.operator === '/'
        )
          return this.#operator(expressions.floorDivision, {
            left: this.#expression(first.left as Expression, context),
            right: this.#expression(first.right, context)
          });
        return this.#applied(expressions.math[name], undefined, args, context);
      }
      return this.#applied(expressions.methods[name], object, args, context);
    }
    const name = (callee as { name: string }).name;
    const structure = this.domain.structures[name];
    if (structure?.kind === 'record' && structure.operation)
      return this.#operation(node, structure as OperationType, context);
    const atomType = this.domain.atoms[name];
    if (atomType) {
      const value = this.#unwrapped(node);
      if (atomType.index && this.#number(value) === -1)
        return { text: new Marked(this.language.literals.nowhere), precedence: atom };
      return this.#expression(value, context);
    }
    if (structure?.kind === 'record' && args[0]?.type === 'ObjectExpression')
      return {
        text: this.#record(args[0].properties as Property[], name, context),
        precedence: atom
      };
    if (structure) return this.#expression(args[0], context);
    return {
      text: filled(expressions.call, {
        name: this.#procedure(name),
        arguments: joined(
          args.map((argument) => this.#expression(argument, context).text),
          ', '
        )
      }),
      precedence: atom
    };
  }

  /** A method or Math function: {object} and {0}, {1}, or all of them as {arguments}. */
  #applied(
    operator: Operator,
    object: Expression | undefined,
    args: readonly (Expression | SpreadElement)[],
    context: Context
  ): Rendered {
    const rendered = args.map((argument) => this.#expression(argument, context).text);
    const slots: Record<string, Marked | string> = {
      arguments: joined(rendered, ', '),
      ...Object.fromEntries(rendered.map((text, index) => [String(index), text]))
    };
    if (object) slots.object = this.#tight(this.#expression(object, context));
    // A missing argument, as slice's end, leaves its slot empty.
    for (const [, index] of operator.template.matchAll(/\{(\d)\}/gu)) slots[index] ??= '';
    return { text: filled(operator.template, slots), precedence: operator.precedence };
  }

  /**
   * An operation call: written inline, its operands put in, if its body is one expression, or else
   * as a call of its definition, given the collections its positions point into first.
   */
  #operation(node: CallExpression, operation: OperationType, context: Context): Rendered {
    const given = new Map(
      ((node.arguments[0] as { properties?: Property[] } | undefined)?.properties ?? []).map(
        (property) => [(property.key as { name: string }).name, property.value as Expression]
      )
    );
    const call = spanKey(context.block, spanOf(node));
    const operands = Object.fromEntries(
      Object.keys(operation.fields).map((name) => {
        const argument = given.get(name) as Expression;
        const collection = this.#index(operation.fields[name])
          ? ((argument.type === 'Identifier'
              ? context.operands?.[argument.name]?.collection
              : undefined) ??
            this.hints.operands[call]?.[name] ??
            this.#collectionParameter(operation.fields[name]))
          : undefined;
        return [name, { text: this.#expression(argument, context), collection }];
      })
    );
    const body = operation.operation.body.body;
    if (body.type !== 'BlockStatement')
      return this.#expression(body, {
        block: 'domain',
        within: `${context.within}${call}>`,
        operands
      });
    const collections = this.#collectionParameters(operation).map(([, field]) =>
      this.#variable(operands[field].collection as string)
    );
    return {
      text: filled(this.language.expressions.call, {
        name: this.#procedure(operation.name),
        arguments: joined(
          [...collections, ...Object.values(operands).map(({ text }) => text.text)],
          ', '
        )
      }),
      precedence: atom
    };
  }

  /** An operation with a block body, defined as a function of its collections and operands. */
  #definition(operation: OperationType): Line[] {
    const parameters = this.#collectionParameters(operation);
    const context: Context = {
      block: 'domain',
      within: '',
      operands: Object.fromEntries(
        Object.entries(operation.fields).map(([name, type]) => [
          name,
          { collection: this.#index(type) ? this.#collectionParameter(type) : undefined }
        ])
      )
    };
    const body = operation.operation.body;
    return [
      {
        depth: 0,
        text: filled(this.language.statements.function, {
          name: this.#procedure(operation.name),
          params: joined(
            [
              ...parameters.map(([collection]) => this.#variable(collection)),
              ...Object.keys(operation.fields).map((name) => this.#variable(name))
            ],
            ', '
          )
        }).from(spanKey('domain', spanOf(body)))
      },
      ...this.#body(body.body as BlockStatement, 0, context)
    ];
  }

  /** The operations with block bodies the algorithm calls, also from other operations' bodies. */
  #calledOperations(root: BlockStatement): OperationType[] {
    const found = new Set<OperationType>();
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (node === null || typeof node !== 'object') return;
      const part = node as AnyNode;
      if (part.type === 'CallExpression' && part.callee.type === 'Identifier') {
        const structure = this.domain.structures[part.callee.name];
        if (
          structure?.kind === 'record' &&
          structure.operation &&
          !found.has(structure as OperationType)
        ) {
          const operation = structure as OperationType;
          const body = operation.operation.body.body;
          if (body.type === 'BlockStatement') found.add(operation);
          visit(body);
        }
      }
      for (const [key, child] of Object.entries(part)) if (key !== 'loc') visit(child);
    };
    visit(root);
    // In the domain's order, which puts each after the operations it calls.
    return Object.values(this.domain.structures).filter((structure): structure is OperationType =>
      found.has(structure as OperationType)
    );
  }

  /** An operation's collection parameters, one per collection type its positions point into, with the first operand of each. */
  #collectionParameters(operation: OperationType): [string, string][] {
    const seen = new Map<string, string>();
    for (const [name, type] of Object.entries(operation.fields)) {
      const collection = this.#index(type) && this.#collectionParameter(type);
      if (collection && !seen.has(collection)) seen.set(collection, name);
    }
    return [...seen];
  }

  /** The collection type a position type points into, if it is one. */
  #index(type: string): string | undefined {
    return this.domain.atoms[type]?.index;
  }

  /** A collection parameter named after its type, as values for Values. */
  #collectionParameter(type: string): string {
    const collection = this.#index(type) ?? type;
    return collection[0].toLowerCase() + collection.slice(1);
  }

  #record(properties: readonly Property[], name: string | undefined, context: Context): Marked {
    const { expressions } = this.language;
    const fields = joined(
      properties.map((property) =>
        filled(expressions.recordField, {
          name: this.#variable((property.key as { name: string }).name),
          value: this.#expression(property.value as Expression, context).text
        })
      ),
      ', '
    );
    return name
      ? filled(expressions.record, { name, fields })
      : filled(this.language.anonymousRecord, { fields });
  }

  // ---------------------------------------------------------------------------------------------

  /** An operator's text, each operand in brackets where it binds less tightly than it needs. */
  #operator(operator: Operator, operands: Record<string, Rendered>): Rendered {
    const { precedence, associates = 'left' } = operator;
    const slots = Object.fromEntries(
      Object.entries(operands).map(([name, operand]) => {
        const loose =
          (name === 'left' && associates === 'left') || (name === 'right' && associates === 'right')
            ? operand.precedence < precedence
            : operand.precedence <= precedence;
        return [name, loose ? joined(['(', operand.text, ')']) : operand.text];
      })
    );
    return { text: filled(operator.template, slots), precedence };
  }

  /** An operand of an element, field, or method, in brackets unless it binds most tightly. */
  #tight(rendered: Rendered): Marked {
    return rendered.precedence < atom ? joined(['(', rendered.text, ')']) : rendered.text;
  }

  #key(node: AnyNode, context: Context): string {
    return `${context.within}${spanKey(context.block, spanOf(node))}`;
  }

  #variable(name: string): Marked {
    return new Marked(this.language.reserved.includes(name) ? `${name}_` : name);
  }

  #procedure(name: string): Marked {
    const words = name.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').split(' ');
    const { procedures } = this.language;
    if (procedures === 'snake') return new Marked(words.join('_').toLowerCase());
    if (procedures === 'capitals') return new Marked(words.join('-').toUpperCase());
    return new Marked(name);
  }

  #quoted(text: string): string {
    const { quote } = this.language.literals;
    return `${quote}${text.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`)}${quote}`;
  }
}
