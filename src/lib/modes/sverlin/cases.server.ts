/**
 * Cases, `<Case name="present" values={[2, 5, 7, 9, 12]} target={9} />`: each one execution of the
 * algorithm, giving every input the input block declares a value of its type, written plainly, the
 * input's type giving it its type. The input block declares the inputs by type alone,
 * `const values = Values;`, so the room each layout keeps comes from the types, and the values shown
 * come from the cases. A scene names the case it shows (see storyboard.server.ts). Cases are read
 * from the text before Svelte sees the view, and then blanked.
 */

import { parse, parseExpressionAt, type AnyNode } from 'acorn';

/** One case as written: its name and each input's value as written, with where each is. */
export type WrittenCase = {
  name: string;
  values: { input: string; text: string; start: number }[];
  start: number;
  end: number;
};

/** One input as the input block declares it: its name and type, and where the type is written. */
export type InputDeclaration = { name: string; type: string; start: number; end: number };

type Problem = { message: string; start: number };

const caseName = /^[A-Za-z][\w-]*$/u;

/** How a case is written, for messages. */
export const caseAdvice =
  'each execution the source shows is a <Case>, beside the storyboard, giving every input a value, as <Case name="present" values={[2, 5, 7, 9, 12]} target={9} />, and a scene names the case it shows, as <Scene name="search" case="present">';

/**
 * The cases written in the source and the problems in how they are written. `scanned` is the source
 * with comments and scripts blanked.
 */
export function writtenCases(scanned: string): {
  cases: WrittenCase[];
  problems: Problem[];
  /** Where every <Case> tag is written, read or not, to blank before Svelte reads the view. */
  tags: { start: number; end: number }[];
} {
  const cases: WrittenCase[] = [];
  const problems: Problem[] = [];
  const tags: { start: number; end: number }[] = [];
  for (const match of scanned.matchAll(/<(Case|Run)\b/gu)) {
    const start = match.index ?? 0;
    const closing = scanned.indexOf('/>', start);
    if (match[1] === 'Run') {
      tags.push({ start, end: closing < 0 ? start + 4 : closing + 2 });
      problems.push({
        message: `An execution the source shows is a <Case>, not a <Run>: write <Case name="present" …/>, and name it in a scene with case="present". A span is one execution of a label's code, as @insert#2.`,
        start
      });
      continue;
    }
    const read = caseOf(scanned, start);
    tags.push({
      start,
      end: 'written' in read ? read.written.end : closing < 0 ? start + 5 : closing + 2
    });
    if ('problem' in read) problems.push({ message: read.problem, start });
    else if (cases.some((each) => each.name === read.written.name))
      problems.push({
        message: `Two cases are named ${read.written.name}: a scene names the case it shows, so give each its own name.`,
        start
      });
    else cases.push(read.written);
  }
  return { cases, problems, tags };
}

/** The cases written in a whole source, its comments and scripts not counting. */
export function casesOf(source: string): ReturnType<typeof writtenCases> {
  return writtenCases(
    source.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>/gu, (text) =>
      text.replace(/[^\n]/gu, ' ')
    )
  );
}

/** One case from its tag, read from `start`, its values' braces matched. */
function caseOf(scanned: string, start: number): { written: WrittenCase } | { problem: string } {
  let at = start + '<Case'.length;
  const given = new Map<string, { text: string; start: number }>();
  let name: string | undefined;
  const space = () => {
    while (/\s/u.test(scanned[at] ?? '')) at++;
  };
  for (;;) {
    space();
    if (scanned.startsWith('/>', at)) break;
    if (at >= scanned.length || scanned[at] === '>')
      return {
        problem: `A <Case> holds nothing, so it closes at once: ${caseAdvice}.`
      };
    const prop = /^([A-Za-z_$][\w$]*)\s*=\s*/u.exec(scanned.slice(at));
    if (!prop) return { problem: `A <Case> gives its name and each input's value: ${caseAdvice}.` };
    at += prop[0].length;
    const key = prop[1];
    if (scanned[at] === '"' || scanned[at] === "'") {
      const end = scanned.indexOf(scanned[at], at + 1);
      if (end < 0) return { problem: `A <Case>'s ${key} is never closed.` };
      if (key !== 'name')
        return {
          problem: `${key}="…" gives the input ${key} as text: give it as a value of its type, as ${key}={9} or ${key}={[2, 5, 7]}.`
        };
      name = scanned.slice(at + 1, end);
      at = end + 1;
      continue;
    }
    if (scanned[at] !== '{')
      return { problem: `A <Case> gives each input as name={value}: ${caseAdvice}.` };
    const end = closingBrace(scanned, at);
    if (end < 0) return { problem: `The value of ${key} in a <Case> is never closed with }.` };
    if (key === 'name')
      return {
        problem: 'A case is named as it is, as name="present", not computed: a scene names it so.'
      };
    if (given.has(key)) return { problem: `A <Case> gives ${key} twice.` };
    const text = scanned.slice(at + 1, end);
    const typed = typeNameIn(text);
    if (typed)
      return {
        problem: `The value of ${key} names the type ${typed}: a case writes each value plainly, as ${key}={9} or ${key}={[2, 5, 7]}, and the input's type gives it its type.`
      };
    given.set(key, { text, start: at + 1 });
    at = end + 1;
  }
  if (name === undefined || !caseName.test(name))
    return {
      problem:
        'A case is named, in one word that may hold digits and dashes, as <Case name="present" …/>: a scene names the case it shows by it.'
    };
  return {
    written: {
      name,
      values: [...given].map(([input, value]) => ({ input, ...value })),
      start,
      end: at + 2
    }
  };
}

/**
 * The first type a value written in a case names, as Int in Int(9): a value is written plainly and
 * its input's type types it. Only what a pool's .add(…) is given names its record's type, as
 * nodes.add(ListNode({ … })), since a node exists only once a pool holds it.
 */
function typeNameIn(text: string): string | undefined {
  let expression: AnyNode;
  try {
    expression = parseExpressionAt(text, 0, { ecmaVersion: 'latest' }) as AnyNode;
  } catch {
    // The input's own interpretation names the problem.
    return undefined;
  }
  const visit = (node: unknown): string | undefined => {
    if (Array.isArray(node)) {
      for (const each of node) {
        const found = visit(each);
        if (found) return found;
      }
      return undefined;
    }
    if (node === null || typeof node !== 'object' || typeof (node as AnyNode).type !== 'string')
      return undefined;
    const part = node as AnyNode;
    if (part.type === 'CallExpression') {
      if (part.callee.type === 'Identifier') return part.callee.name;
      if (
        part.callee.type === 'MemberExpression' &&
        part.callee.property.type === 'Identifier' &&
        part.callee.property.name === 'add'
      )
        return undefined;
    }
    for (const [key, child] of Object.entries(part))
      if (key !== 'loc') {
        const found = visit(child);
        if (found) return found;
      }
    return undefined;
  };
  return visit(expression);
}

/** Where the brace opened at `open` closes, skipping strings; -1 where it never does. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    const character = text[at];
    if (character === '"' || character === "'" || character === '`') {
      let end = at + 1;
      while (end < text.length && text[end] !== character) end += text[end] === '\\' ? 2 : 1;
      at = end;
    } else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return at;
  }
  return -1;
}

/**
 * The inputs the input block declares, each by type alone, as const values = Values;, and the
 * problems with how they are declared: a value given there belongs in a case.
 */
export function inputDeclarations(body: string): {
  inputs: InputDeclaration[];
  problems: { message: string; at: number }[];
} {
  const inputs: InputDeclaration[] = [];
  const problems: { message: string; at: number }[] = [];
  let program: { body: AnyNode[] };
  try {
    program = parse(body, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as {
      body: AnyNode[];
    };
  } catch {
    // The input block's own parse names the problem.
    return { inputs, problems };
  }
  for (const statement of program.body) {
    const declarators =
      statement.type === 'VariableDeclaration' && statement.kind === 'const'
        ? statement.declarations
        : undefined;
    if (!declarators) {
      problems.push({
        message:
          'The input block only declares each input with its type, as const values = Values;, and each <Case> gives the inputs their values.',
        at: statement.start
      });
      continue;
    }
    for (const declarator of declarators) {
      const id = declarator.id;
      const init = declarator.init;
      if (id.type !== 'Identifier') continue;
      if (init?.type === 'Identifier') {
        inputs.push({ name: id.name, type: init.name, start: init.start, end: init.end });
        continue;
      }
      const type =
        init?.type === 'CallExpression' && init.callee.type === 'Identifier'
          ? init.callee.name
          : undefined;
      problems.push({
        message: type
          ? `${id.name} is given a value in the input block, which declares only its type: write const ${id.name} = ${type};, and give its value in each <Case>, as <Case name="present" ${id.name}={…} />.`
          : `The input block declares ${id.name} by its type alone, as const ${id.name} = Values;, and each <Case> gives its value.`,
        at: declarator.start
      });
    }
  }
  return { inputs, problems };
}

/**
 * The input block as one case gives it: each declared type applied to the case's value, as
 * const values = Values([2, 5, 7]);, a pool made empty, and where each value lands, to name a
 * problem in it at the case.
 */
export function caseInputBody(
  body: string,
  inputs: readonly InputDeclaration[],
  shown: WrittenCase,
  isPool: (type: string) => boolean
): {
  body: string;
  /** Each value as it lands, from its type's name (from) to its end, and where it is written. */
  spans: { input: string; from: number; start: number; end: number; source: number }[];
} {
  let written = '';
  let last = 0;
  const spans: { input: string; from: number; start: number; end: number; source: number }[] = [];
  for (const input of inputs) {
    written += body.slice(last, input.end);
    last = input.end;
    const value = shown.values.find((each) => each.input === input.name);
    if (isPool(input.type) || !value) {
      written += '()';
      continue;
    }
    written += '(';
    spans.push({
      input: input.name,
      from: written.length - 1 - (input.end - input.start),
      start: written.length,
      end: written.length + value.text.length,
      source: value.start
    });
    written += `${value.text})`;
  }
  return { body: written + body.slice(last), spans };
}
