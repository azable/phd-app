import { describe, expect, it } from 'vitest';

import aiAssistant from './bot.server';

describe('single-component Svelte assistant', () => {
  it('uses the five-call Luna/Sol ladder with a bounded fallback', () => {
    expect(
      aiAssistant.attemptProfiles.map(({ purpose, parameters }) => [
        purpose,
        parameters.model,
        parameters.reasoningEffort
      ])
    ).toEqual([
      ['initial', 'gpt-5.6-sol', 'medium'],
      ['repair', 'gpt-5.6-sol', 'medium'],
      ['repair', 'gpt-5.6-sol', 'high'],
      ['repair', 'gpt-5.6-sol', 'xhigh'],
      ['fallback', 'gpt-5.6-sol', 'xhigh']
    ]);
    expect(
      aiAssistant.attemptProfiles.every(({ parameters }) => parameters.maxOutputTokens === 12_000)
    ).toBe(true);
  });

  it('specifies the complete source and isolated step contract', () => {
    // Markdown is wrapped, so phrases are matched whatever whitespace runs between their words.
    const prompt = aiAssistant.initialPrompt.replace(/\s+/g, ' ');
    expect(prompt).toContain('exactly one complete component');
    expect(prompt).toContain('step and the library components are already in scope');
    expect(prompt).toContain('never write `import`');
    expect(prompt).toContain('already in scope');
    expect(prompt).toContain('script-free');
    expect(prompt).toContain('no network access');
  });

  it('rejects empty source and reply text consistently with its provider schema', () => {
    expect(() =>
      aiAssistant.parseOutput({
        reply: [{ type: 'markdown', text: '' }],
        decision: { action: 'respond' }
      })
    ).toThrow();
    expect(() =>
      aiAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'Update' }],
        decision: { action: 'revise', source: '   ', summary: 'Update' }
      })
    ).toThrow();
  });

  it('parses participant-facing fallback explanations', () => {
    expect(
      aiAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'Here is a simpler version.' }],
        decision: { action: 'revise', source: '<h1>Hello</h1>', summary: 'A simpler view' },
        recovery: {
          struggledWith: 'the dense animated layout',
          simplified: 'the layout while preserving the subject'
        }
      })
    ).toMatchObject({
      recovery: {
        struggledWith: 'the dense animated layout',
        simplified: 'the layout while preserving the subject'
      }
    });
  });

  it('asks for and parses one decision of each kind, as source-decisions.ts defines them', () => {
    const decision = (aiAssistant.responseFormat.schema as { properties: { decision: unknown } })
      .properties.decision as { oneOf: { properties: { action: { const: string } } }[] };
    expect(decision.oneOf.map(({ properties }) => properties.action.const)).toEqual([
      'respond',
      'resample',
      'vary',
      'edit',
      'revise'
    ]);
    const parse = (value: unknown) =>
      aiAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'Done.' }],
        decision: value,
        recovery: null
      });
    expect(parse({ action: 'resample' })).toMatchObject({ decision: { action: 'resample' } });
    expect(parse({ action: 'resample', count: 4 })).toMatchObject({ decision: { count: 4 } });
    expect(parse({ action: 'resample', count: null })).toMatchObject({ decision: { count: null } });
    expect(
      parse({
        action: 'vary',
        values: [{ variable: 'look.radius', value: 'full' }],
        randomise: ['Int'],
        summary: 'Rounds every cell'
      })
    ).toMatchObject({ decision: { action: 'vary', randomise: ['Int'] } });
    expect(
      parse({
        action: 'edit',
        edits: [{ find: '{v}', replace: '{v} ({k})' }],
        summary: ' Labels each value with its index '
      })
    ).toMatchObject({
      decision: {
        action: 'edit',
        edits: [{ find: '{v}', replace: '{v} ({k})' }],
        summary: 'Labels each value with its index'
      }
    });
    for (const invalid of [
      { action: 'respond', source: '<h1>Hello</h1>' },
      { action: 'revise', source: ' ', summary: 'Nothing' },
      { action: 'edit', edits: [], summary: 'Nothing' },
      { action: 'resample', count: 9 },
      { action: 'resample', count: 2.5 },
      { action: 'rewrite' }
    ])
      expect(() => parse(invalid)).toThrow(/invalid structured response/i);
  });

  it('requires every decision field in the strict response, a count as null when not wanted', () => {
    const decision = (aiAssistant.responseFormat.schema as { properties: { decision: unknown } })
      .properties.decision as {
      oneOf: { properties: Record<string, unknown>; required: string[] }[];
    };
    for (const option of decision.oneOf)
      expect(option.required.toSorted()).toEqual(Object.keys(option.properties).toSorted());
    expect(decision.oneOf.find(({ properties }) => 'count' in properties)).toBeDefined();
  });

  it('parses a vary’s comparisons, each side labelled, or a count, never both', () => {
    const parse = (extra: object) =>
      aiAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'Done.' }],
        decision: { action: 'vary', values: [], randomise: [], summary: 'Asks', ...extra },
        recovery: null
      });
    const comparison = {
      question: ' Cells or tallies? ',
      left: { label: ' cells ', values: [{ variable: 'views.Int', value: 'IntCell' }] },
      right: { label: 'tallies', values: [{ variable: 'views.Int', value: 'IntTally' }] }
    };
    expect(parse({ count: null, comparisons: [comparison] })).toMatchObject({
      decision: {
        comparisons: [
          { question: 'Cells or tallies?', left: { label: 'cells' }, right: { label: 'tallies' } }
        ]
      }
    });
    const right = (side: object) => ({ comparisons: [{ ...comparison, right: side }] });
    for (const invalid of [
      { count: 4, comparisons: [comparison] },
      { comparisons: [] },
      { comparisons: Array(9).fill(comparison) },
      right({ ...comparison.right, values: [] }),
      right({ values: comparison.right.values }),
      right({ ...comparison.right, label: '  ' }),
      right({ ...comparison.right, label: 'tallies '.repeat(6) }),
      right({ ...comparison.right, label: 'Cells' })
    ])
      expect(() => parse(invalid)).toThrow(/invalid structured response/i);
  });

  it('asks for the brief beside the decision and records only the tags each attribute names', () => {
    const schema = aiAssistant.responseFormat.schema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.required).toContain('brief');
    const parse = (brief: unknown) =>
      aiAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'Done.' }],
        decision: { action: 'respond', question: null },
        brief,
        recovery: null
      });
    expect(
      parse([
        {
          key: 'constraints',
          value: ' printed in grey ',
          status: 'inferred',
          source: 'for the handouts',
          tags: ['greyscale', 'bold']
        },
        { key: 'tone', value: '', status: 'unknown', source: null, tags: [] }
      ]).brief
    ).toEqual([
      {
        key: 'constraints',
        value: 'printed in grey',
        status: 'inferred',
        source: 'for the handouts',
        tags: ['greyscale']
      },
      { key: 'tone', value: '', status: 'unknown' }
    ]);
    expect(parse(null)).not.toHaveProperty('brief');
    // A brief that does not parse is left out; the decision stands.
    expect(
      parse([{ key: 'mood', value: 'x', status: 'inferred', source: null, tags: [] }])
    ).toMatchObject({ decision: { action: 'respond' } });
    expect(
      parse([{ key: 'mood', value: 'x', status: 'inferred', source: null, tags: [] }])
    ).not.toHaveProperty('brief');
  });

  it('rejects unsupported message content in assistant discussion', () => {
    expect(() =>
      aiAssistant.parseOutput({
        reply: [
          { type: 'unsupported-content' },
          { type: 'markdown', text: 'Do you prefer this presentation?' }
        ],
        decision: { action: 'respond' },
        recovery: null
      })
    ).toThrow();
  });
});

describe('recorded steps in the assistant context', () => {
  const workspace = (source: string) => ({
    entryArtifactId: 'main',
    artifacts: [{ artifactId: 'main', path: 'Main.svelte', language: 'svelte', source, sha256: '' }]
  });
  const context = (source: string, failedSource?: string) =>
    aiAssistant.buildContext({
      messages: [],
      project: { base: workspace(source) } as never,
      attempt: { number: 1, purpose: 'initial' },
      ...(failedSource
        ? {
            buildFeedback: {
              attempt: 1,
              buildEventId: 1,
              failedSource,
              assistantReply: '',
              diagnostics: [],
              priorFailureSummaries: []
            }
          }
        : {})
    });
  const counting = (to: number) =>
    `<script lang="sverlin" domain>const Count = type("integer", { min: 0, max: 9 }); const Flag = type('boolean');</script><script lang="sverlin">@run[let last = Count(9);] for (@setup[let n = Count(0)]; @guard[n < Count(${to})]; @onward[n++]) @step{ last = n; } @done[const done = Flag(true);]</script>{#snippet CountCell(value: Count)}<Node {value} />{/snippet}<Layout name="Main"><Node>{last}</Node></Layout>`;

  it('gives the steps the current source records, with the variables in scope', () => {
    // Named by their labels' runs: the input as given (here none), last set, n set and tested, a
    // step per pass with n moved and tested again, then the step after the loop, where n is out of
    // scope.
    expect(context(counting(2)).recordedSteps).toEqual({
      steps: [
        { name: 'start', state: {} },
        { name: '@run#1', state: { last: 9 } },
        { name: '@setup#1', state: { last: 9, n: 0 } },
        { name: '@guard#1', state: { last: 9, n: 0 } },
        { name: '@step#1', state: { last: 0, n: 0 } },
        { name: '@onward#1', state: { last: 0, n: 1 } },
        { name: '@guard#2', state: { last: 0, n: 1 } },
        { name: '@step#2', state: { last: 1, n: 1 } },
        { name: '@onward#2', state: { last: 1, n: 2 } },
        { name: '@guard#3', state: { last: 1, n: 2 } },
        { name: '@done#1', state: { last: 1, done: true } }
      ]
    });
  });

  it('gives a repair the steps of the candidate that failed, and why there are none', () => {
    expect(context(counting(2), counting(1)).recordedSteps).toEqual({
      steps: [
        { name: 'start', state: {} },
        { name: '@run#1', state: { last: 9 } },
        { name: '@setup#1', state: { last: 9, n: 0 } },
        { name: '@guard#1', state: { last: 9, n: 0 } },
        { name: '@step#1', state: { last: 0, n: 0 } },
        { name: '@onward#1', state: { last: 0, n: 1 } },
        { name: '@guard#2', state: { last: 0, n: 1 } },
        { name: '@done#1', state: { last: 0, done: true } }
      ]
    });
    expect(
      (
        context(counting(2), '<script lang="sverlin">@run[let n = Nope(1);]</script>')
          .recordedSteps as {
          problem: string;
        }
      ).problem
    ).toMatch(/Nope/u);
  });
});
