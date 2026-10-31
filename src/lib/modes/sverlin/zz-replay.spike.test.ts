// Spike (not for main): the layout model run in Node on every step the page kept, with text
// measured by each library, against Chrome's own layout of the same markup.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';

import { parseSheet, type Rule } from './library/model/css';
import { layOut, type Box, type TextMeasure } from './library/model/layout';
import { isElement, type ModelElement } from './library/model/tree';
import type { LayoutDump } from './library/model/check';
import type { SceneFrame, SceneStep } from './library';
import { unsound } from './library/soundness';
import {
  dejavuFonts,
  embeddedFonts,
  fontkitMeasure,
  harfbuzz,
  napiCanvas,
  opentypeMeasure,
  skiaCanvas,
  systemFonts
} from './zz-measures';

const S =
  '/tmp/claude-1000/-home-azable-workspace-areas-phd/afe5e95a-1ad0-403e-a5c4-095fb4eb5e51/scratchpad';
const enabled = process.env.SPIKE === '1';
const page = process.env.SPIKE_PAGE ?? 'embedded';
const which = (process.env.SPIKE_MEASURES ?? 'chrome,harfbuzzjs,@napi-rs/canvas,skia-canvas,fontkit,opentype.js').split(',');
const fontSet =
  process.env.SPIKE_FONTSET === 'system'
    ? systemFonts
    : process.env.SPIKE_FONTSET === 'dejavu'
      ? dejavuFonts
      : embeddedFonts;
const label = process.env.SPIKE_LABEL ?? `${page}-${process.env.SPIKE_FONTSET ?? 'embedded'}`;

type Saved = {
  scene: { frame: SceneFrame; steps: SceneStep[]; dumps: LayoutDump[]; sheets: string[] };
  measured: { widths: [string, number][]; metrics: [string, ReturnType<TextMeasure['metrics']>][] };
};

const postOrder = (root: ModelElement): ModelElement[] => {
  const list: ModelElement[] = [];
  const walk = (element: ModelElement) => {
    for (const child of element.children) if (isElement(child)) walk(child);
    list.push(element);
  };
  walk(root);
  return list;
};

/** The markup without the least sizes laying out reserved, so each node is at its natural size. */
const natural = (element: ModelElement): ModelElement => {
  const style: Record<string, string> = {};
  for (const [property, value] of Object.entries(element.style)) {
    if (property === 'min-width' || property === 'min-height') {
      const max = /^max\(([^,]+),/u.exec(value);
      if (max) style[property] = max[1].trim();
      else if (!value.endsWith('px')) style[property] = value;
    } else style[property] = value;
  }
  return { ...element, style, children: element.children.map((c) => (isElement(c) ? natural(c) : c)) };
};

const quantile = (sorted: number[], q: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    max: sorted.at(-1) ?? 0,
    p95: quantile(sorted, 0.95),
    median: quantile(sorted, 0.5),
    exact: sorted.filter((v) => v === 0).length / (sorted.length || 1),
    visible: sorted.filter((v) => v >= 0.5).length / (sorted.length || 1)
  };
}

function chromeMeasure(saved: Saved): TextMeasure {
  const widths = new Map(saved.measured.widths);
  const metrics = new Map(saved.measured.metrics);
  return {
    width: (text, font) => {
      const width = widths.get(`${font}\n${text}`);
      if (width === undefined) throw new Error(`no page width for ${font} ${text}`);
      return width;
    },
    metrics: (font) => {
      const known = metrics.get(font);
      if (!known) throw new Error(`no page metrics for ${font}`);
      return known;
    }
  };
}

const edgeDifferences = (a: Box, b: Box) => ({
  position: Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)),
  size: Math.max(Math.abs(a.width - b.width), Math.abs(a.height - b.height)),
  under: Math.max(b.width - a.width, b.height - a.height, 0)
});

it.skipIf(!enabled)('replays page layouts in Node', { timeout: 3_600_000 }, async () => {
  const dir = `${S}/s4/page-${page}`;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const makers: Record<string, () => Promise<{ name: string; measure: TextMeasure; covers(t: string, f: string): boolean } | undefined>> = {
    harfbuzzjs: () => harfbuzz(fontSet),
    '@napi-rs/canvas': () => napiCanvas(fontSet),
    'skia-canvas': () => skiaCanvas(fontSet),
    fontkit: () => fontkitMeasure(fontSet),
    'opentype.js': () => opentypeMeasure(fontSet)
  };
  const libraries = [];
  for (const name of which.filter((n) => n !== 'chrome')) {
    try {
      libraries.push(await makers[name]());
    } catch (cause) {
      console.log(`${name}: unavailable: ${(cause as Error).message}`);
    }
  }
  const results: Record<string, unknown> = {};
  const texts: Record<string, number[]> = {};
  const uncovered: Record<string, number> = {};
  const metricDiffs: Record<string, number[]> = {};
  const layouts: Record<string, { reservedPos: number[]; reservedSize: number[]; naturalPos: number[]; naturalSize: number[]; under: number[]; ms: number[]; states: number }> = {};
  const sound: Record<string, { problems: number; overlaps: number; textOut: number; outside: number; links: number; steps: number }> = {};
  const seen = new Set<string>();
  const names = ['chrome', ...libraries.map((l) => l!.name)];
  for (const name of names) {
    texts[name] = [];
    uncovered[name] = 0;
    metricDiffs[name] = [];
    layouts[name] = { reservedPos: [], reservedSize: [], naturalPos: [], naturalSize: [], under: [], ms: [], states: 0 };
    sound[name] = { problems: 0, overlaps: 0, textOut: 0, outside: 0, links: 0, steps: 0 };
  }
  const tally = (into: (typeof sound)[string], problems: string[]) => {
    into.steps++;
    into.problems += problems.length;
    for (const p of problems)
      if (p.includes('overlap')) into.overlaps++;
      else if (p.includes('runs out')) into.textOut++;
      else if (p.includes('lies outside')) into.outside++;
      else into.links++;
  };
  const chromeSound = { problems: 0, overlaps: 0, textOut: 0, outside: 0, links: 0, steps: 0 };
  for (const file of files) {
    const saved = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as Saved;
    const chrome = chromeMeasure(saved);
    const measures: [string, TextMeasure][] = [['chrome', chrome], ...libraries.map((l) => [l!.name, l!.measure] as [string, TextMeasure])];
    // Text widths, each text and font once over every presentation.
    for (const [key, width] of saved.measured.widths) {
      if (seen.has(key)) continue;
      seen.add(key);
      const [font, text] = [key.slice(0, key.indexOf('\n')), key.slice(key.indexOf('\n') + 1)];
      for (const library of libraries) {
        if (!library!.covers(text, font)) {
          uncovered[library!.name]++;
          continue;
        }
        texts[library!.name].push(Math.abs(library!.measure.width(text, font) - width));
      }
      texts.chrome.push(0);
    }
    for (const [font, metrics] of saved.measured.metrics)
      for (const library of libraries) {
        const mine = library!.measure.metrics(font);
        metricDiffs[library!.name].push(
          Math.max(Math.abs(mine.ascent - metrics.ascent), Math.abs(mine.descent - metrics.descent), Math.abs(mine.xHeight - metrics.xHeight))
        );
      }
    let rules: Rule[] = [];
    for (const sheet of saved.scene.sheets) rules = [...rules, ...parseSheet(sheet, rules.length)];
    saved.scene.dumps.forEach((dump, stepIndex) => {
      const elements = postOrder(dump.tree);
      const stripped = natural(dump.tree);
      const strippedElements = postOrder(stripped);
      const devicePixelRatio = process.env.SPIKE_FORCE_DPR ? Number(process.env.SPIKE_FORCE_DPR) : dump.devicePixelRatio;
      const options = (measure: TextMeasure) => ({ rules, measure, ancestors: dump.ancestors, devicePixelRatio });
      const reference = layOut(stripped, options(chrome));
      const sceneStep = saved.scene.steps[stepIndex];
      if (sceneStep) tally(chromeSound, unsound(saved.scene.frame, sceneStep));
      for (const [name, measure] of measures) {
        const into = layouts[name];
        let laid;
        try {
          const started = performance.now();
          laid = layOut(dump.tree, options(measure));
          into.ms.push(performance.now() - started);
        } catch {
          continue;
        }
        into.states++;
        elements.forEach((element, index) => {
          const box = laid.boxes.get(element);
          if (!box) return;
          const d = edgeDifferences(box, dump.boxes[index]);
          into.reservedPos.push(d.position);
          into.reservedSize.push(d.size);
        });
        const free = layOut(stripped, options(measure));
        strippedElements.forEach((element) => {
          const mine = free.boxes.get(element);
          const theirs = reference.boxes.get(element);
          if (!mine || !theirs) return;
          const d = edgeDifferences(mine, theirs);
          into.naturalPos.push(d.position);
          into.naturalSize.push(d.size);
          if (element.attributes['data-sv-node'] !== undefined) into.under.push(d.under);
        });
        // Soundness, replayed: the page's scene with each node at the size this measure predicts
        // for it at its natural size, the page's own text kept where the page drew it.
        if (sceneStep) {
          const predicted = new Map<string, Box>();
          const page = new Map<string, Box>();
          strippedElements.forEach((element) => {
            const id = element.attributes['data-sv-node'];
            if (id === undefined || predicted.has(id)) return;
            const mine = free.boxes.get(element);
            const theirs = reference.boxes.get(element);
            if (mine && theirs) {
              predicted.set(id, mine);
              page.set(id, theirs);
            }
          });
          const nodes = sceneStep.nodes.map((node) => {
            const mine = predicted.get(node.id);
            const theirs = page.get(node.id);
            if (!mine || !theirs || !theirs.width || !theirs.height) return node;
            const sx = node.box.width / theirs.width;
            const sy = node.box.height / theirs.height;
            return {
              ...node,
              box: {
                x: node.box.x,
                y: node.box.y,
                width: node.box.width + (mine.width - theirs.width) * sx,
                height: node.box.height + (mine.height - theirs.height) * sy
              }
            };
          });
          tally(sound[name], unsound(saved.scene.frame, { ...sceneStep, nodes }));
        }
      }
    });
    console.log(`${file}: ${saved.scene.dumps.length} steps`);
  }
  for (const name of names)
    results[name] = {
      texts: summary(texts[name]),
      uncovered: uncovered[name],
      metrics: summary(metricDiffs[name]),
      reserved: { position: summary(layouts[name].reservedPos), size: summary(layouts[name].reservedSize) },
      natural: { position: summary(layouts[name].naturalPos), size: summary(layouts[name].naturalSize), under: summary(layouts[name].under) },
      msPerState: summary(layouts[name].ms).median,
      states: layouts[name].states,
      soundness: sound[name]
    };
  results.chromeScenes = chromeSound;
  writeFileSync(`${S}/s4/replay-${label}.json`, JSON.stringify(results, null, 1));
  expect(Object.keys(results).length).toBeGreaterThan(0);
});
