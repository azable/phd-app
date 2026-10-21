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
        decision: { action: 'respond', sourceArtifactContent: null }
      })
    ).toThrow();
    expect(() =>
      aiAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'Update' }],
        decision: { action: 'revise', sourceArtifactContent: '   ' }
      })
    ).toThrow();
  });

  it('parses participant-facing fallback explanations', () => {
    expect(
      aiAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'Here is a simpler version.' }],
        decision: { action: 'revise', sourceArtifactContent: '<h1>Hello</h1>' },
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

  it('enforces the respond, resample, revise, and edit source contract', () => {
    expect(aiAssistant.responseFormat.schema).toMatchObject({
      type: 'object',
      properties: {
        decision: {
          anyOf: [
            {
              properties: {
                action: { enum: ['revise'] },
                sourceArtifactContent: { type: 'string' },
                summary: { type: 'string' }
              }
            },
            {
              properties: {
                action: { enum: ['edit'] },
                edits: { type: 'array' },
                summary: { type: 'string' }
              }
            },
            {
              properties: {
                action: { enum: ['respond', 'resample'] },
                sourceArtifactContent: { type: 'null' }
              }
            }
          ]
        }
      }
    });
    expect(() =>
      aiAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'I will change it.' }],
        decision: { action: 'respond', sourceArtifactContent: '<h1>Hello</h1>' },
        recovery: null
      })
    ).toThrow(/invalid structured response/i);
    expect(() =>
      aiAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'I am updating it.' }],
        decision: { action: 'revise', sourceArtifactContent: null },
        recovery: null
      })
    ).toThrow(/invalid structured response/i);
    expect(
      aiAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'I am preparing another pair.' }],
        decision: { action: 'resample', sourceArtifactContent: null },
        recovery: null
      })
    ).toMatchObject({ action: 'resample' });
    expect(
      aiAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'I am labelling them.' }],
        decision: {
          action: 'edit',
          edits: [{ find: '{v}', replace: '{v} ({k})' }],
          summary: 'Labels each value with its index'
        },
        recovery: null
      })
    ).toMatchObject({
      action: 'edit',
      edits: [{ find: '{v}', replace: '{v} ({k})' }],
      summary: 'Labels each value with its index'
    });
    expect(() =>
      aiAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'I am editing it.' }],
        decision: { action: 'edit', edits: [], summary: 'Nothing' },
        recovery: null
      })
    ).toThrow(/invalid structured response/i);
  });

  it('rejects unsupported message content in assistant discussion', () => {
    expect(() =>
      aiAssistant.parseOutput({
        reply: [
          { type: 'unsupported-content' },
          { type: 'markdown', text: 'Do you prefer this presentation?' }
        ],
        decision: { action: 'respond', sourceArtifactContent: null },
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
      project: { currentWorkspace: workspace(source) } as never,
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
    `<script lang="sverlin" domain>const Count = type("integer", { min: 0, max: 9 });</script><script lang="sverlin">for (let n = Count(0); n < ${to}; n++) yield;</script><Node>x</Node>`;

  it('gives the steps the current source records, with the variables in scope', () => {
    expect(context(counting(2)).recordedSteps).toEqual({
      steps: [
        { step: 1, state: { n: 0 } },
        { step: 2, state: { n: 1 } }
      ]
    });
  });

  it('gives a repair the steps of the candidate that failed, and why there are none', () => {
    expect(context(counting(2), counting(1)).recordedSteps).toEqual({
      steps: [{ step: 1, state: { n: 0 } }]
    });
    expect(
      (
        context(counting(2), '<script lang="sverlin">let n = Nope(1); yield;</script>')
          .recordedSteps as { problem: string }
      ).problem
    ).toMatch(/Nope/u);
  });
});
