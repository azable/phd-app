// Spike: font metrics and uncovered texts, against the page.
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { embeddedFonts, harfbuzz, systemFonts } from './zz-measures';

const S = '/tmp/claude-1000/-home-azable-workspace-areas-phd/afe5e95a-1ad0-403e-a5c4-095fb4eb5e51/scratchpad';
it.skipIf(process.env.SPIKE !== '1')('metrics', { timeout: 600_000 }, async () => {
  const page = process.env.SPIKE_PAGE ?? 'system';
  const fonts = process.env.SPIKE_FONTSET === 'embedded' ? embeddedFonts : systemFonts;
  const dir = `${S}/s4/page-${page}`;
  const metrics = new Map<string, { ascent: number; descent: number; xHeight: number }>();
  const widths = new Map<string, number>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
    for (const [k, m] of d.measured.metrics) metrics.set(k, m);
    for (const [k, w] of d.measured.widths) widths.set(k, w);
  }
  const hb = await harfbuzz(fonts);
  for (const [font, m] of metrics) {
    const mine = hb.measure.metrics(font);
    if (mine.ascent !== m.ascent || mine.descent !== m.descent || mine.xHeight !== m.xHeight)
      console.log(font, 'page', JSON.stringify(m), 'hb', JSON.stringify(mine));
  }
  const chars = new Set<string>();
  for (const k of widths.keys()) for (const c of k.slice(k.indexOf('\n') + 1)) chars.add(c);
  console.log('characters', [...chars].sort().join(''));
  for (const k of widths.keys()) {
    const font = k.slice(0, k.indexOf('\n')); const text = k.slice(k.indexOf('\n') + 1);
    if (!hb.covers(text, font)) console.log('uncovered', JSON.stringify(font), JSON.stringify(text));
  }
  expect(1).toBe(1);
});
