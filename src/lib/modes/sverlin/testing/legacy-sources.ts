/**
 * Test support: a source written with snippets as parts, {@render Part()}, and page layouts that
 * declare nothing, as Sverlin was written before layouts took inputs, rewritten in the current form:
 * parts as layouts declaring the state they read, renders as their tags, snippets nested in a view or
 * part as kinds, every page layout declaring what it reads, and a storyboard showing the first. For tests that build sources from
 * pieces, where inputs cannot be written beforehand.
 */

const ident = /[A-Za-z_$][\w$]*/gu;

type Reads = { vars: string[]; labels: string[]; declared?: boolean };

function stateNamesOf(text: string, extra: string[] = []): Set<string> {
  const names = new Set(extra);
  for (const m of text.matchAll(/<script\s+(?:input|algorithm)[^>]*>([\s\S]*?)<\/script>/gu))
    for (const d of m[1].matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gu)) names.add(d[1]);
  return names;
}

// Every {…} expression in markup and every attribute expression, with its offset.
function expressions(body: string): string[] {
  const out: string[] = [];
  for (let at = 0; at < body.length; at++) {
    if (body[at] !== '{') continue;
    let depth = 0;
    let quote = '';
    let end = at;
    for (; end < body.length; end++) {
      const c = body[end];
      if (quote) {
        if (c === quote && body[end - 1] !== '\\') quote = '';
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) break;
    }
    out.push(body.slice(at + 1, end));
    at = end;
  }
  return out;
}

function readsOf(body: string, state: Set<string>): Reads {
  const vars = new Set<string>();
  const labels = new Set<string>();
  const shadow = new Set<string>();
  for (const m of body.matchAll(/\{#each\s+[^}]*?\bas\s+([^}]*)\}/gu))
    for (const id of m[1].replace(/\([^)]*\)/gu, '').matchAll(ident)) shadow.add(id[0]);
  for (const m of body.matchAll(/\{@const\s+([A-Za-z_$][\w$]*)/gu)) shadow.add(m[1]);
  for (const m of body.matchAll(/<When\s+of="@([\w.]+)"/gu)) labels.add(m[1]);
  for (const expr of expressions(body)) {
    const stripped = expr.replace(/"[^"]*"|'[^']*'|`[^`]*`/gu, '""');
    for (const m of stripped.matchAll(/@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/gu))
      if (!['render', 'const', 'html', 'debug', 'attach'].includes(m[1])) labels.add(m[1]);
    const noLabels = stripped.replace(/@[\w.]+/gu, '');
    for (const m of noLabels.matchAll(ident)) {
      const at = m.index ?? 0;
      const before = noLabels[at - 1];
      const after = noLabels.slice(at + m[0].length).trimStart()[0];
      if (before === '.' || (after === ':' && !/\?/u.test(noLabels.slice(0, at)))) continue;
      if (state.has(m[0]) && !shadow.has(m[0])) vars.add(m[0]);
    }
  }
  // A label covered by a shorter one declared is left out.
  const sorted = [...labels].sort((a, b) => a.length - b.length);
  const kept = sorted.filter((l, i) => !sorted.slice(0, i).some((s) => l.startsWith(`${s}.`)));
  return { vars: [...vars], labels: kept };
}

function ofText({ vars, labels }: Reads): string {
  const all = [...vars, ...labels.map((l) => `@${l}`)];
  return all.length ? ` of="${all.join(', ')}"` : '';
}

function viewRanges(text: string): [number, number][] {
  return [...text.matchAll(/<View\b[\s\S]*?<\/View\s*>/gu)].map((m) => [
    m.index ?? 0,
    (m.index ?? 0) + m[0].length
  ]);
}

function snippetEnd(text: string, from: number): number {
  // The {/snippet} closing the snippet opened at from, counting nested ones.
  let depth = 0;
  const re = /\{#snippet\b|\{\/snippet\}/gu;
  re.lastIndex = from;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].startsWith('{#')) depth++;
    else if (--depth === 0) return m.index;
  }
  return -1;
}

function convert(text: string, extraState: string[] = []): string {
  if (!/\{#snippet|\{@render|<Layout\b/u.test(text)) return text;
  if (/<Storyboard\b/u.test(text)) return text;
  const state = stateNamesOf(text, extraState);
  // 1. Nested snippets inside views: inline at each render, as kind.
  for (let guard = 0; guard < 50; guard++) {
    const views = viewRanges(text);
    const snippets = [...text.matchAll(/\{#snippet\b/gu)].map((x) => [
      x.index ?? 0,
      snippetEnd(text, x.index ?? 0)
    ]);
    let done = true;
    for (const m of text.matchAll(/\{#snippet\s+([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/gu)) {
      const index = m.index ?? 0;
      const inView = views.some(([s, e]) => index > s && index < e);
      const inSnippet = snippets.some(([s, e]) => index > s && index < e);
      if (!inView && !inSnippet) continue;
      const name = m[1];
      const close = snippetEnd(text, index);
      if (close < 0) continue;
      const body = text.slice(index + m[0].length, close).trim();
      const single = /^<Node\b([^>]*?)(\/?)>/u.exec(body);
      const oneNode =
        single &&
        (single[2] === '/'
          ? body.length === single[0].length
          : body.endsWith('</Node>') &&
            (body.match(/<Node\b/gu) || []).length - (body.match(/<\/Node>/gu) || []).length === 0);
      const kinded = oneNode
        ? body.replace(/^<Node\b/u, `<Node kind="${name}"`)
        : `<Node kind="${name}">${body}</Node>`;
      let from = index;
      let to = close + '{/snippet}'.length;
      const lineStart = text.lastIndexOf('\n', from - 1) + 1;
      const lineEnd = text.indexOf('\n', to);
      if (
        !text.slice(lineStart, from).trim() &&
        !text.slice(to, lineEnd < 0 ? undefined : lineEnd).trim()
      ) {
        from = lineStart;
        to = lineEnd < 0 ? text.length : lineEnd + 1;
      }
      text = text.slice(0, from) + text.slice(to);
      text = text.replaceAll(`{@render ${name}()}`, kinded);
      done = false;
      break;
    }
    if (done) break;
  }
  // 2. Top-level parts become layouts.
  const parts = new Map<string, string>();
  for (let guard = 0; guard < 100; guard++) {
    const m = /\{#snippet\s+([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\}/u.exec(text);
    if (!m) break;
    const close = snippetEnd(text, m.index);
    if (close < 0) break;
    const body = text.slice(m.index + m[0].length, close);
    parts.set(m[1], body);
    text = `${text.slice(0, m.index)}<Layout name="${m[1]}"§OF§${m[1]}§>${body}</Layout>${text.slice(close + '{/snippet}'.length)}`;
  }
  // Inputs: own reads, plus those of the parts each renders, until nothing changes.
  const layoutBodies = () => {
    const out = new Map<string, { body: string; of: string | undefined }>();
    for (const m of text.matchAll(
      /<Layout\s+name="([A-Za-z_$][\w$]*)"(?:§OF§[^§]*§|\s+of="([^"]*)")?\s*>([\s\S]*?)<\/Layout>/gu
    ))
      out.set(m[1], { body: m[3], of: m[2] });
    return out;
  };
  const bodies = layoutBodies();
  const inputs = new Map<string, Reads>(
    [...bodies].map(([n, { body, of }]): [string, Reads] => [
      n,
      of === undefined
        ? readsOf(body, state)
        : {
            vars: of
              .split(',')
              .map((x) => x.trim())
              .filter((x) => x && !x.startsWith('@')),
            labels: of
              .split(',')
              .map((x) => x.trim())
              .filter((x) => x.startsWith('@'))
              .map((x) => x.slice(1)),
            declared: true
          }
    ])
  );
  for (let changed = true, guard = 0; changed && guard < 20; guard++) {
    changed = false;
    for (const [n, { body: b }] of bodies)
      for (const r of b.matchAll(/\{@render\s+([A-Za-z_$][\w$]*)\(\)\}/gu)) {
        const child = inputs.get(r[1]);
        if (!child) continue;
        const own = inputs.get(n)!;
        if (own.declared) continue;
        for (const v of child.vars)
          if (!own.vars.includes(v)) {
            own.vars.push(v);
            changed = true;
          }
        for (const l of child.labels)
          if (!own.labels.some((x) => l === x || l.startsWith(`${x}.`))) {
            own.labels.push(l);
            changed = true;
          }
      }
  }
  // 3. Renders of parts become tags.
  text = text.replace(/\{@render\s+([A-Za-z_$][\w$]*)\(\)\}/gu, (whole, name: string) => {
    const i = inputs.get(name);
    if (!i) return whole;
    const attrs = i.vars.map((v) => ` ${v}={${v}}`).join('');
    return `<${name}${attrs} />`;
  });
  // 4. Declare every layout's inputs.
  text = text.replace(
    /<Layout\s+name="([A-Za-z_$][\w$]*)"(?:§OF§[^§]*§)?(\s*)>/gu,
    (_, name: string, space: string) => {
      const declared = inputs.get(name);
      return `<Layout name="${name}"${declared && !declared.declared ? ofText(declared) : ''}${space}>`;
    }
  );
  return withStoryboard(text);
}

/** The source with a storyboard showing its first page layout, where it has none. */
function withStoryboard(text: string): string {
  if (/<Storyboard\b/u.test(text)) return text;
  const page = [
    ...text.matchAll(/<Layout\s+name="([A-Za-z_$][\w$]*)"(?:\s+of="([^"]*)")?\s*>/gu)
  ].find(([, name]) => !new RegExp(`<${name.replace('$', '\\$')}\\b`, 'u').test(text));
  if (!page) return text;
  const passed = (page[2] ?? '')
    .split(',')
    .map((input) => input.trim())
    .filter((input) => input && !input.startsWith('@'))
    .map((input) => ` ${input}={${input}}`)
    .join('');
  return `${text}\n<Storyboard><Scene name="main"><${page[1]}${passed} /></Scene></Storyboard>`;
}

export { convert as currentForm, stateNamesOf };
