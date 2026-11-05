/**
 * Sources from real projects of 2026-11-05 (fixtures/replay), each rebuilt with the values its
 * version showed: every one must still build, and read at least as large as it did then, less a
 * margin, so a change to the library that breaks or shrinks what participants already had fails
 * here rather than in their next session.
 */

import { describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import replay from './fixtures/replay/replay.json';
import type { DesignValues } from './library/node/design';

const sources = import.meta.glob<string>('./fixtures/replay/*.sverlin', {
  query: '?raw',
  import: 'default',
  eager: true
});

type Replayed = { summary: string; variant: DesignValues; minText: number };

describe('real projects replayed', () => {
  it.each(Object.entries(replay as Record<string, Replayed>))(
    '%s still builds and reads',
    async (name, { variant, minText }) => {
      const source = sources[`./fixtures/replay/${name}.sverlin`];
      expect(source).toBeDefined();
      const built = await bundlePresentation(prepareSvelteComponent(source), 1, {
        chosen: variant
      });
      expect(built.labels.length).toBeGreaterThan(0);
      expect(built.layout.readability?.text ?? 0).toBeGreaterThanOrEqual(minText);
    }
  );
});
