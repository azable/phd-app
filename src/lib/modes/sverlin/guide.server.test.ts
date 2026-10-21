import { describe, expect, it } from 'vitest';

import aiAssistant, { languageGuide } from './bot.server';
import { compileSvelteComponent, libraryProps } from './compile.server';
import guide from './README.md?raw';

/** Each documented prop with the quoted names its bullet lists, from bullets such as "- `a` and `b`: …". */
function documentedProps(text: string): Map<string, Set<string>> {
  const props = new Map<string, Set<string>>();
  for (const line of text.split('\n')) {
    if (!line.startsWith('- `')) continue;
    const colon = line.indexOf(': ');
    const names = [...line.slice(0, colon).matchAll(/`(\w+)`/gu)].map(([, name]) => name);
    const values = new Set([...line.slice(colon).matchAll(/`'([^'`]+)'`/gu)].map(([, v]) => v));
    for (const name of names) props.set(name, values);
  }
  return props;
}

// Named values a component accepts that the guide leaves out on purpose.
const undocumented: Record<string, string[]> = {};
// Props the compiler still takes that the guide leaves out on purpose: the older ways of drawing a
// collection and a typed value, which views of types replace.
const undocumentedProps = new Set(['Node.items', 'Node.item', 'Node.nested', 'Node.type']);

describe('Sverlin language guide and assistant instructions', () => {
  it('builds every complete component example', async () => {
    const examples = [...guide.matchAll(/```svelte\n([\s\S]*?)```/gu)]
      .map(([, source]) => source)
      .filter((source) => source.includes('<script lang="sverlin">'));
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const result = await compileSvelteComponent(example);
      expect(result.labels.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['Node', '## Node', '## Link'],
    ['Link', '## Link', undefined]
  ] as const)('documents exactly the props and named values <%s> takes', (component, from, to) => {
    const start = guide.indexOf(`\n${from}\n`);
    const text = guide.slice(start, to ? guide.indexOf(`\n${to}\n`) : undefined);
    const documented = documentedProps(text);
    const props = libraryProps[component];
    const mentioned = new Set(
      [...text.replace(/```[\s\S]*?```/gu, '').matchAll(/`([^`]+)`/gu)].flatMap(
        ([, code]) => code.match(/\w+/gu) ?? []
      )
    );
    for (const name of documented.keys()) expect(Object.keys(props), name).toContain(name);
    for (const [name, allowed] of Object.entries(props)) {
      if (name === 'children' || undocumentedProps.has(`${component}.${name}`)) continue;
      expect(mentioned.has(name), `${component}.${name} is not mentioned`).toBe(true);
      if (!allowed) continue;
      const listed = documented.get(name);
      expect(listed, `${component}.${name} has no bullet`).toBeDefined();
      const expected = allowed.names.filter(
        (value) => !undocumented[`${component}.${name}`]?.includes(value)
      );
      expect([...(listed ?? [])].sort(), `${component}.${name}`).toEqual(
        [...new Set(expected)].sort()
      );
    }
  });

  it('gives the assistant its instructions and the guide without maintainer comments', () => {
    expect(guide).toContain('<!--');
    expect(aiAssistant.initialPrompt).toMatch(/^You are Sverlin’s visualization designer\./u);
    expect(aiAssistant.initialPrompt).toContain(languageGuide);
    expect(aiAssistant.initialPrompt).not.toContain('<!--');
    expect(aiAssistant.initialPrompt).not.toContain('-->');
    // The prompt refers the assistant to this section by name.
    expect(guide).toContain('\n### Declare what varies\n');
  });
});
