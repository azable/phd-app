/**
 * Runs, `<Run name="present" values={[2, 5, 7, 9, 12]} target={9} />`: each one execution of the
 * algorithm, giving every input the input block declares a value of its type. The input block
 * declares the inputs by type alone, `const values = Values;`, so the room each layout keeps comes
 * from the types, and the values shown come from the runs. A scene names the run it shows (see
 * storyboard.server.ts). Runs are read from the text before Svelte sees the view, and then blanked.
 */

import { parse, type AnyNode } from 'acorn';

/** One run as written: its name and each input's value as written, with where each is. */
export type WrittenRun = {
  name: string;
  values: { input: string; text: string; start: number }[];
  start: number;
  end: number;
};

/** One input as the input block declares it: its name and type, and where the type is written. */
export type InputDeclaration = { name: string; type: string; start: number; end: number };

type Problem = { message: string; start: number };

const runName = /^[A-Za-z][\w-]*$/u;

/** How a run is written, for messages. */
export const runAdvice =
  'each execution the source shows is a <Run>, beside the storyboard, giving every input a value, as <Run name="present" values={[2, 5, 7, 9, 12]} target={9} />, and a scene names the run it shows, as <Scene name="search" run="present">';

/**
 * The runs written in the source and the problems in how they are written. `scanned` is the source
 * with comments and scripts blanked.
 */
export function writtenRuns(scanned: string): {
  runs: WrittenRun[];
  problems: Problem[];
  /** Where every <Run> tag is written, read or not, to blank before Svelte reads the view. */
  tags: { start: number; end: number }[];
} {
  const runs: WrittenRun[] = [];
  const problems: Problem[] = [];
  const tags: { start: number; end: number }[] = [];
  for (const match of scanned.matchAll(/<Run\b/gu)) {
    const start = match.index ?? 0;
    const read = runOf(scanned, start);
    const closing = scanned.indexOf('/>', start);
    tags.push({ start, end: 'run' in read ? read.run.end : closing < 0 ? start + 4 : closing + 2 });
    if ('problem' in read) problems.push({ message: read.problem, start });
    else if (runs.some((run) => run.name === read.run.name))
      problems.push({
        message: `Two runs are named ${read.run.name}: a scene names the run it shows, so give each its own name.`,
        start
      });
    else runs.push(read.run);
  }
  return { runs, problems, tags };
}

/** The runs written in a whole source, its comments and scripts not counting. */
export function runsOf(source: string): ReturnType<typeof writtenRuns> {
  return writtenRuns(
    source.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>/gu, (text) =>
      text.replace(/[^\n]/gu, ' ')
    )
  );
}

/** One run from its tag, read from `start`, its values' braces matched. */
function runOf(scanned: string, start: number): { run: WrittenRun } | { problem: string } {
  let at = start + '<Run'.length;
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
        problem: `A <Run> holds nothing, so it closes at once: ${runAdvice}.`
      };
    const prop = /^([A-Za-z_$][\w$]*)\s*=\s*/u.exec(scanned.slice(at));
    if (!prop) return { problem: `A <Run> gives its name and each input's value: ${runAdvice}.` };
    at += prop[0].length;
    const key = prop[1];
    if (scanned[at] === '"' || scanned[at] === "'") {
      const end = scanned.indexOf(scanned[at], at + 1);
      if (end < 0) return { problem: `A <Run>'s ${key} is never closed.` };
      if (key !== 'name')
        return {
          problem: `${key}="…" gives the input ${key} as text: give it as a value of its type, as ${key}={9} or ${key}={[2, 5, 7]}.`
        };
      name = scanned.slice(at + 1, end);
      at = end + 1;
      continue;
    }
    if (scanned[at] !== '{')
      return { problem: `A <Run> gives each input as name={value}: ${runAdvice}.` };
    const end = closingBrace(scanned, at);
    if (end < 0) return { problem: `The value of ${key} in a <Run> is never closed with }.` };
    if (key === 'name')
      return {
        problem: 'A run is named as it is, as name="present", not computed: a scene names it so.'
      };
    if (given.has(key)) return { problem: `A <Run> gives ${key} twice.` };
    given.set(key, { text: scanned.slice(at + 1, end), start: at + 1 });
    at = end + 1;
  }
  if (name === undefined || !runName.test(name))
    return {
      problem:
        'A run is named, in one word that may hold digits and dashes, as <Run name="present" …/>: a scene names the run it shows by it.'
    };
  return {
    run: {
      name,
      values: [...given].map(([input, value]) => ({ input, ...value })),
      start,
      end: at + 2
    }
  };
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
 * problems with how they are declared: a value given there belongs in a run.
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
          'The input block only declares each input with its type, as const values = Values;, and each <Run> gives the inputs their values.',
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
          ? `${id.name} is given a value in the input block, which declares only its type: write const ${id.name} = ${type};, and give its value in each <Run>, as <Run name="present" ${id.name}={…} />.`
          : `The input block declares ${id.name} by its type alone, as const ${id.name} = Values;, and each <Run> gives its value.`,
        at: declarator.start
      });
    }
  }
  return { inputs, problems };
}

/**
 * The input block as one run gives it: each declared type applied to the run's value, as
 * const values = Values([2, 5, 7]);, a pool made empty, and where each value lands, to name a
 * problem in it at the run.
 */
export function runInputBody(
  body: string,
  inputs: readonly InputDeclaration[],
  run: WrittenRun,
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
    const value = run.values.find((each) => each.input === input.name);
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
