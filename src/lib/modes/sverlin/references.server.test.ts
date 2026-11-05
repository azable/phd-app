/** Fields read through references, in the scenes the server draws. */

import { expect, it } from 'vitest';

import bfs from './fixtures/bfs-references.sverlin?raw';
import { pausingEveryLabel } from './testing/every-pause';
import { drawnSteps, ofKind, textOf } from './testing/scenes';

it(
  'draws the names of the queued vertices, read through their references',
  { timeout: 60_000 },
  async () => {
    const { steps } = await drawnSteps(pausingEveryLabel(bfs));
    const line = (step: number) => textOf(steps[step], ofKind(steps[step], 'Line')[0]);
    // A is taken, then its neighbours B and C are queued in turn; step 0 is the scene's start,
    // :before, and step 1 the queue holding A.
    expect(line(1)).toBe('queue: A');
    expect(line(2)).toBe('queue:');
    expect(line(4)).toBe('queue: B');
  }
);
