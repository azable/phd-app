import { describe, expect, it } from 'vitest';

import htmlAssistant from './bot.server';

const manifest = {
  format: 'sverlin-html-frames',
  version: 1,
  frames: [{ label: 'Overview', html: '<main>Safe</main>' }]
};

describe('HTML assistant contract', () => {
  it('uses the shared intake brief and makes one candidate at a time', () => {
    expect(htmlAssistant.participantIntake.map(({ id }) => id)).toEqual(['algorithm']);
    expect(htmlAssistant.initialPrompt).toContain('Return zero or one complete');
    expect(htmlAssistant.initialPrompt).toContain('Do not infer a visual style from an audience');
  });

  it('opens with questions or a first version, as the participant chose, and knows the interface', () => {
    expect(htmlAssistant.initialPrompt).toContain('If they ask for questions first');
    expect(htmlAssistant.initialPrompt).toContain('what students should be able to do');
    expect(htmlAssistant.initialPrompt).toContain('interface-ref');
    expect(
      htmlAssistant.parseOutput({
        reply: [
          { type: 'markdown', text: 'Use the' },
          { type: 'interface-ref', part: 'step-controls' }
        ],
        candidates: [],
        recovery: null
      }).reply
    ).toEqual([
      { type: 'markdown', text: 'Use the' },
      { type: 'interface-ref', part: 'step-controls' }
    ]);
  });

  it('accepts zero or one labelled candidate per conversational turn', () => {
    expect(
      htmlAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'No change' }],
        candidates: []
      })
    ).toEqual({
      reply: [{ type: 'markdown', text: 'No change' }],
      candidates: []
    });
    expect(
      htmlAssistant.parseOutput({
        reply: [{ type: 'candidate-ref', slot: 0 }],
        candidates: [{ label: 'First', manifest }]
      })
    ).toEqual({
      reply: [{ type: 'candidate-ref', slot: 0 }],
      candidates: [{ label: 'First', manifest }]
    });
    expect(() =>
      htmlAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'Two' }],
        candidates: [
          { label: 'First', manifest },
          { label: 'Second', manifest }
        ]
      })
    ).toThrow();
  });

  it('rejects the former string reply and unlabelled candidate shape', () => {
    expect(() =>
      htmlAssistant.parseOutput({ reply: 'Batch', candidates: [manifest, manifest] })
    ).toThrow();
    expect(() =>
      htmlAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'Batch' }],
        candidates: [{ label: ' ', manifest }]
      })
    ).toThrow();
    expect(() =>
      htmlAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'Batch' }],
        candidates: [
          { label: 'Candidate', manifest: { ...manifest, frames: [{ label: '', html: '' }] } }
        ]
      })
    ).toThrow();
  });

  it('parses participant-facing fallback explanations', () => {
    expect(
      htmlAssistant.parseOutput({
        reply: [{ type: 'markdown', text: 'Here is a simpler version.' }],
        candidates: [{ label: 'Candidate', manifest }],
        recovery: {
          struggledWith: 'the interactive behavior',
          simplified: 'the interaction into static frames'
        }
      })
    ).toMatchObject({
      recovery: {
        struggledWith: 'the interactive behavior',
        simplified: 'the interaction into static frames'
      }
    });
  });
});
