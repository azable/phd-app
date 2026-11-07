import { describe, expect, it } from 'vitest';

import insertion from './fixtures/insertion-decisions.sverlin?raw';
import { drawnSteps, ofKind, textOf } from './testing/scenes';
import { placeWarningCodes } from './place-checks.server';

describe('a scene pausing at decisions as well as actions', () => {
  it("draws each comparison's answer at its step, with no warnings", async () => {
    const { steps, built } = await drawnSteps(insertion);
    expect((built.warnings ?? []).filter(({ code }) => !placeWarningCodes.has(code))).toEqual([]);
    const labels = (built as unknown as { steps: string[] }).steps;
    const compared = labels.flatMap((label, step) =>
      label.startsWith('@insert.scan.cmp') ? [step] : []
    );
    expect(compared.length).toBe(9);
    for (const step of compared) {
      const [ask] = ofKind(steps[step], 'Ask');
      // Its operands are columns lifted from the cells, so they read after the line's words.
      expect(textOf(steps[step], ask)).toMatch(
        /^is > \? (yes, so swap|no, so the round stops) \d \d$/u
      );
    }
    // A round ends where j reaches the front, and says so.
    const front = labels.findIndex((label) => label === '@insert.front#2.end');
    expect(textOf(steps[front], ofKind(steps[front], 'Front')[0])).toBe(
      'j is at the front, so the round stops'
    );
  });
});
