import { describe, expect, it } from 'vitest';

import { referencedElements } from './commands';

const presentationId = '12345678-1234-4123-8123-123456789ac1';

describe('the elements a message refers to', () => {
  it('include those its comments are pinned to, at each comment’s step', () => {
    expect(
      referencedElements([
        { type: 'markdown', text: 'Two notes:' },
        {
          type: 'annotation',
          presentationId,
          step: 3,
          stepName: '@visit#2',
          element: { id: '20:7#1', label: 'B' },
          point: { x: 10, y: 20 },
          text: 'Colour the vertex being visited'
        },
        { type: 'annotation', presentationId, step: 0, point: { x: 5, y: 5 }, text: 'Too tight' }
      ])
    ).toEqual([
      {
        type: 'element-ref',
        presentationId,
        step: 3,
        stepName: '@visit#2',
        element: { id: '20:7#1', label: 'B' }
      }
    ]);
  });
});
