/**
 * Every fixture's scenes, built with no variant, as a hash each, so a change to the engine that
 * moves anything in a picture shows here; a change meant to move pictures updates the snapshot.
 *
 * Deliberate changes, by the step that made them:
 * - grid-marks: a grid placed by positions keeps a track before the first cell, as a position's
 *   type allows −1 as it allows the length (coordinates outside the range).
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';
import { drawnSteps } from './testing/scenes';

const root = join(import.meta.dirname, 'fixtures');
const fixtures = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? fixtures(join(directory, entry.name))
      : entry.name.endsWith('.sverlin')
        ? [join(directory, entry.name)]
        : []
  );

test('every fixture draws the scenes it drew', { timeout: 600_000 }, async () => {
  const hashes: Record<string, string> = {};
  for (const file of fixtures(root).sort()) {
    const name = relative(root, file);
    try {
      const { frame, steps } = await drawnSteps(readFileSync(file, 'utf8'));
      hashes[name] = createHash('sha256')
        .update(JSON.stringify({ frame, steps }))
        .digest('hex')
        .slice(0, 16);
    } catch (cause) {
      hashes[name] = `refused: ${(cause as Error).message.slice(0, 120)}`;
    }
  }
  expect(hashes).toMatchSnapshot();
});
