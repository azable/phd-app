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
      ['initial', 'gpt-5.6-luna', 'medium'],
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
    expect(aiAssistant.initialPrompt).toContain('exactly one complete Sverlin component');
    expect(aiAssistant.initialPrompt).toContain('`step`, `seed`, and the library components');
    expect(aiAssistant.initialPrompt).toContain('never write `import`');
    expect(aiAssistant.initialPrompt).toContain('already in scope');
    expect(aiAssistant.initialPrompt).toContain('script-free');
    expect(aiAssistant.initialPrompt).toContain('no network access');
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
      { action: 'rewrite' }
    ])
      expect(() => parse(invalid)).toThrow(/invalid structured response/i);
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
    `<script lang="sverlin" domain>const Count = type("integer", { min: 0, max: 9 });</script><script lang="sverlin">@step[for (let n = Count(0); n < ${to}; n++) {}]</script><Node>x</Node>`;

  it('gives the steps the current source records, with the variables in scope', () => {
    // A step per pass, then the end, where n is out of scope.
    expect(context(counting(2)).recordedSteps).toEqual({
      steps: [
        { step: 1, state: { n: 0 } },
        { step: 2, state: { n: 1 } },
        { step: 3, state: {} }
      ]
    });
  });

  it('gives a repair the steps of the candidate that failed, and why there are none', () => {
    expect(context(counting(2), counting(1)).recordedSteps).toEqual({
      steps: [
        { step: 1, state: { n: 0 } },
        { step: 2, state: {} }
      ]
    });
    expect(
      (
        context(counting(2), '<script lang="sverlin">let n = Nope(1);</script>').recordedSteps as {
          problem: string;
        }
      ).problem
    ).toMatch(/Nope/u);
  });
});
