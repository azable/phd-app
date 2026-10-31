// Spike (not for main): every free layout the page solved over its steps, solved again in Node from
// the same inputs, compared, and timed.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';

import { solveSpan, type SpanInput, type SpanLayout } from './library/node/span';

const S =
  '/tmp/claude-1000/-home-azable-workspace-areas-phd/afe5e95a-1ad0-403e-a5c4-095fb4eb5e51/scratchpad';

it.skipIf(process.env.SPIKE !== '1')('solves spans in Node', { timeout: 1_800_000 }, () => {
  const dir = `${S}/s4/page-${process.env.SPIKE_PAGE ?? 'dejavu'}`;
  let spans = 0;
  let identical = 0;
  let largest = 0;
  let ms = 0;
  const differing: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const saved = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as {
      measured: { spans?: { inputs: SpanInput[]; layout: SpanLayout }[] };
    };
    const seen = new Set<string>();
    for (const { inputs, layout } of saved.measured.spans ?? []) {
      const key = JSON.stringify(inputs);
      if (seen.has(key)) continue;
      seen.add(key);
      spans++;
      const started = performance.now();
      const mine = solveSpan(inputs);
      ms += performance.now() - started;
      let by = Math.max(Math.abs(mine.width - layout.width), Math.abs(mine.height - layout.height));
      for (const [k, p] of Object.entries(layout.positions)) {
        const q = mine.positions[k];
        by = Math.max(by, q ? Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y)) : Infinity);
      }
      const paths = JSON.stringify(mine.edges.map((e) => e.path)) === JSON.stringify(layout.edges.map((e) => e.path));
      if (by === 0 && paths) identical++;
      else differing.push(`${file}: by ${by}, paths ${paths ? 'same' : 'differ'}`);
      largest = Math.max(largest, by);
    }
  }
  const result = { spans, identical, largest, msPerSpan: ms / (spans || 1), differing: differing.slice(0, 20) };
  writeFileSync(`${S}/s4/spans.json`, JSON.stringify(result, null, 1));
  console.log(result);
  expect(spans).toBeGreaterThan(0);
});
