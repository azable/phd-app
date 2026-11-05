/**
 * Calls as types: `const SortCall = call('sort', { max: 4, fields: ['mid'] });` in the domain makes
 * each call of the algorithm's function `sort` a record a view can be of and a query can list. A
 * call is a span of the label on the function's body (see design "Records"), so the source is
 * rewritten to name that label: `<View of="SortCall">` becomes a view of `@sort`, and
 * `<Select from="SortCall">` a query of its spans, taking the call's `max` as its bound where it
 * gives none. A view of a call reads only what the declaration names: the function's parameters,
 * the locals in `fields`, and `result`, the value the call returned, there once it has.
 */

type Problem = { message: string; start: number };

export type CallType = {
  name: string;
  function: string;
  label: string;
  parameters: string[];
  fields: string[];
  max?: number;
};

const declaration =
  /const\s+([A-Za-z_$][\w$]*)\s*=\s*call\(\s*(['"])([A-Za-z_$][\w$]*)\2\s*(?:,\s*\{([^}]*)\})?\s*\)\s*;?/gu;
const blank = (text: string) => text.replace(/[^\n]/gu, ' ');
const advice =
  "declare a call in the domain, as const SortCall = call('sort', { max: 4 });, for a function whose body is labelled, as function sort(a, lo, hi) @sort{ … }";

/** The source with each call type declared and used, rewritten to name its function's label. */
export function callTypes(source: string): {
  source: string;
  calls: CallType[];
  problems: Problem[];
} {
  const domain = /<script\s+domain\s*>([\s\S]*?)<\/script\s*>/u.exec(source);
  if (!domain || !domain[1].includes('call(')) return { source, calls: [], problems: [] };
  const domainStart = (domain.index ?? 0) + domain[0].indexOf(domain[1]);
  const algorithm = /<script\s+algorithm\s*>([\s\S]*?)<\/script\s*>/u.exec(source)?.[1] ?? '';
  const calls: CallType[] = [];
  const problems: Problem[] = [];
  let rewritten = source;
  for (const match of domain[1].matchAll(declaration)) {
    const start = domainStart + (match.index ?? 0);
    const [whole, name, , called, options = ''] = match;
    rewritten = rewritten.slice(0, start) + blank(whole) + rewritten.slice(start + whole.length);
    const header = new RegExp(
      `function\\s+${called}\\s*\\(([^)]*)\\)\\s*(@([A-Za-z_$][\\w$]*)\\s*\\{)?`,
      'u'
    ).exec(algorithm);
    if (!header) {
      problems.push({
        message: `${name} is a call of ${called}, which is no function of the algorithm: ${advice}.`,
        start
      });
      continue;
    }
    if (!header[3]) {
      problems.push({
        message: `${name} is a call of ${called}, whose body has no label of its own: label it, as function ${called}(${header[1].trim()}) @${called}{ … }, so each call is a span.`,
        start
      });
      continue;
    }
    const max = /\bmax\s*:\s*(\d+)/u.exec(options)?.[1];
    const listed = /\bfields\s*:\s*\[([^\]]*)\]/u.exec(options)?.[1] ?? '';
    const unknown = options
      .replace(/\bmax\s*:\s*\d+/u, '')
      .replace(/\bfields\s*:\s*\[[^\]]*\]/u, '')
      .replace(/[\s,]/gu, '');
    if (unknown) {
      problems.push({
        message: `call('${called}', { … }) takes max, the most calls open at once, and fields, the locals a view of it reads, as { max: 4, fields: ['mid'] }.`,
        start
      });
      continue;
    }
    calls.push({
      name,
      function: called,
      label: header[3],
      parameters: header[1]
        .split(',')
        .map((each) => each.trim())
        .filter(Boolean),
      fields: [...listed.matchAll(/['"]([A-Za-z_$][\w$]*)['"]/gu)].map((each) => each[1]),
      ...(max ? { max: Number(max) } : {})
    });
  }
  for (const call of calls) {
    const readable = [...call.parameters, ...call.fields, 'result'];
    for (const view of source.matchAll(
      new RegExp(`<View\\s+of="${call.name}"[^>]*>([\\s\\S]*?)<\\/View\\s*>`, 'gu')
    ))
      for (const read of view[1].matchAll(/\bthis\.([A-Za-z_$][\w$]*)/gu))
        if (!readable.includes(read[1]))
          problems.push({
            message: `${call.name} is a call of ${call.function}: a view of it reads its parameters (${call.parameters.join(', ')}), result and the locals its declaration names, and ${read[1]} is none of them: name it, as call('${call.function}', { fields: ['${read[1]}'] }).`,
            start: (view.index ?? 0) + view[0].indexOf(read[0])
          });
    rewritten = rewritten.replace(
      new RegExp(`(<View\\s+of=)"${call.name}"`, 'gu'),
      (_, opening: string) => fitted(`${opening}"@${call.label}"`, `${opening}"${call.name}"`)
    );
    rewritten = rewritten.replace(
      new RegExp(`(<Select\\b[^>]*?\\bfrom=)"${call.name}"([^>]*?)(\\/?>)`, 'gu'),
      (_, opening: string, rest: string, closing: string) =>
        `${fitted(`${opening}"@${call.label}"`, `${opening}"${call.name}"`)}${rest}${
          call.max !== undefined && !/\bmax=/u.test(opening + rest) ? ` max="${call.max}"` : ''
        }${closing}`
    );
  }
  return { source: rewritten, calls, problems };
}

/** `text` padded with spaces to `written`'s length where shorter, so later offsets stay put. */
const fitted = (text: string, written: string) =>
  text.length < written.length ? text + ' '.repeat(written.length - text.length) : text;
