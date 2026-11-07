import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { drawnSteps, textOf } from './testing/scenes';
import type { BuildWarning } from './warnings';

const fixture = readFileSync('src/lib/modes/sverlin/fixtures/insertion-decisions.sverlin', 'utf8');
const neverDrawn = (warnings: readonly BuildWarning[] = []) =>
  warnings.map(({ message }) => message).filter((warning) => warning.includes('drawn at no step'));

describe('a node reading labels', () => {
  it('is drawn at its label’s steps, whether its layout lists its variables or not', async () => {
    const listed = fixture.replace('<Layout name="Board">', '<Layout name="Board">');
    for (const source of [fixture, listed]) {
      const { steps, built } = await drawnSteps(source);
      const labels = (built as { steps: string[] }).steps;
      const at = labels.indexOf('@insert.scan.cmp#1');
      const ask = steps[at].nodes.find((node) => node.kind === 'Ask');
      expect(textOf(steps[at], ask)).toContain('yes, so swap');
      expect(neverDrawn(built.warnings)).toEqual([]);
    }
  });

  it('is warned of when it reads labels that give values at no step together', async () => {
    const both = fixture.replace(
      '<Node when="@insert.scan.cmp">{@insert.scan.cmp}</Node>',
      '<Node>{@insert.front} {@insert.scan.cmp}</Node>'
    );
    expect(both).not.toBe(fixture);
    const { built } = await drawnSteps(both);
    const [warning] = neverDrawn(built.warnings);
    expect(warning).toContain('reads @insert.front and @insert.scan.cmp');
    expect(warning).toContain('Put each label in a node of its own');
  });
});
