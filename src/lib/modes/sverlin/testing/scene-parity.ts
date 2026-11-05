/**
 * How far a scene drawn on the server (see library/model/scene-of.ts) is from the one the page
 * describes (see library/scene.ts), step by step: each difference by kind, the node or link it is
 * in, and how large it is, so a test can hold each kind to its tolerance and report the rest.
 */

import type { SceneBox, SceneLink, SceneNode, ScenePoint, SceneStep } from '../library';
import { cssColour } from '../targets/colour';

export type SceneDifference = {
  kind: string;
  step: number;
  /** The node's id, or the link's. */
  at: string;
  /** How large, in frame pixels where it is a length. */
  size?: number;
  detail: string;
};

/** Pixels within which boxes, and link ends, count as alike. */
export const boxTolerance = 2;
const lengthTolerance = 0.5;

const colourKey = (css: string | undefined) => {
  if (css === undefined) return 'none';
  const [r, g, b, a] = cssColour(css);
  return a === 0 ? 'none' : `${r},${g},${b},${Math.round(a * 100) / 100}`;
};
/** Colours alike within a step of each channel, as oklch rounds to sRGB. */
const sameColour = (a: string | undefined, b: string | undefined) => {
  const [ka, kb] = [colourKey(a), colourKey(b)];
  if (ka === kb) return true;
  if (ka === 'none' || kb === 'none') return false;
  const [x, y] = [ka.split(',').map(Number), kb.split(',').map(Number)];
  return x.every((value, index) => Math.abs(value - y[index]) <= (index === 3 ? 0.02 : 2));
};
const fontKey = (font: string) =>
  font
    .split(',')
    .map((name) => name.trim().replace(/^['"]|['"]$/gu, ''))
    .join(',');
const boxDistance = (a: SceneBox, b: SceneBox) =>
  Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height)
  );
const union = (boxes: readonly SceneBox[]): SceneBox | undefined => {
  if (!boxes.length) return undefined;
  const left = Math.min(...boxes.map(({ x }) => x));
  const top = Math.min(...boxes.map(({ y }) => y));
  const right = Math.max(...boxes.map(({ x, width }) => x + width));
  const bottom = Math.max(...boxes.map(({ y, height }) => y + height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};
const pointsOf = (shape: { parts: ScenePoint[][] }) =>
  shape.parts.flat().map(({ x, y }) => ({ x, y, width: 0, height: 0 }));
const wordsOf = (text: string) => text.replace(/\s+/gu, ' ').trim();

/** Every difference between the page's steps and the server's. */
export function sceneDifferences(
  page: readonly SceneStep[],
  server: readonly SceneStep[]
): SceneDifference[] {
  const differences: SceneDifference[] = [];
  if (page.length !== server.length)
    differences.push({
      kind: 'step count',
      step: -1,
      at: '',
      detail: `page ${page.length}, server ${server.length}`
    });
  page.forEach((step, index) => {
    const other = server[index];
    if (other) differences.push(...stepDifferences(step, other, index));
  });
  return differences;
}

function stepDifferences(page: SceneStep, server: SceneStep, step: number): SceneDifference[] {
  const differences: SceneDifference[] = [];
  const add = (kind: string, at: string, detail: string, size?: number) =>
    differences.push({ kind, step, at, detail, ...(size === undefined ? {} : { size }) });
  if (Boolean(page.error) !== Boolean(server.error))
    add('error', '', `page ${page.error ?? 'none'}, server ${server.error ?? 'none'}`);
  const serverNodes = new Map(server.nodes.map((node) => [node.id, node]));
  const pageIds = new Set(page.nodes.map(({ id }) => id));
  for (const node of page.nodes) {
    const other = serverNodes.get(node.id);
    if (!other) add('node missing on server', node.id, node.kind ?? node.text ?? '');
    else nodeDifferences(node, other, (kind, detail, size) => add(kind, node.id, detail, size));
  }
  for (const node of server.nodes)
    if (!pageIds.has(node.id)) add('node only on server', node.id, node.kind ?? node.text ?? '');
  const keyOf = (link: SceneLink) => link.id ?? `${link.from}→${link.to}`;
  const serverLinks = new Map<string, SceneLink[]>();
  for (const link of server.links)
    serverLinks.set(keyOf(link), [...(serverLinks.get(keyOf(link)) ?? []), link]);
  for (const link of page.links) {
    const other = serverLinks.get(keyOf(link))?.shift();
    if (!other) add('link missing on server', keyOf(link), `${link.from} → ${link.to}`);
    else linkDifferences(link, other, (kind, detail, size) => add(kind, keyOf(link), detail, size));
  }
  for (const [key, left] of serverLinks)
    for (const link of left) add('link only on server', key, `${link.from} → ${link.to}`);
  return differences;
}

type Add = (kind: string, detail: string, size?: number) => void;

function nodeDifferences(page: SceneNode, server: SceneNode, add: Add) {
  const distance = boxDistance(page.box, server.box);
  if (distance > boxTolerance)
    add('node box', `${JSON.stringify(page.box)} vs ${JSON.stringify(server.box)}`, distance);
  for (const key of ['parent', 'type', 'kind', 'layout', 'collection', 'value', 'unit'] as const)
    if (page[key] !== server[key]) add(`node ${key}`, `${page[key]} vs ${server[key]}`);
  if (wordsOf(page.text ?? '') !== wordsOf(server.text ?? ''))
    add('node text', `${page.text} vs ${server.text}`);
  const look = [page.look, server.look] as const;
  for (const key of ['fill', 'stroke', 'color'] as const)
    if (!sameColour(look[0][key], look[1][key]))
      add(`look ${key}`, `${look[0][key]} vs ${look[1][key]}`);
  if (!sameColour(look[0].glow, look[1].glow))
    add('look glow', `${look[0].glow} vs ${look[1].glow}`);
  for (const key of ['strokeWidth', 'radius', 'fontSize'] as const) {
    const gap = Math.abs((look[0][key] ?? 0) - (look[1][key] ?? 0));
    if (gap > lengthTolerance) add(`look ${key}`, `${look[0][key]} vs ${look[1][key]}`, gap);
  }
  const paddingGap = Math.max(
    ...[0, 1, 2, 3].map((side) =>
      Math.abs((look[0].padding?.[side] ?? 0) - (look[1].padding?.[side] ?? 0))
    )
  );
  if (paddingGap > lengthTolerance)
    add('look padding', `${look[0].padding} vs ${look[1].padding}`, paddingGap);
  for (const key of ['strokeStyle', 'fontWeight', 'opacity', 'shadow', 'fillStyle'] as const)
    if (look[0][key] !== look[1][key]) add(`look ${key}`, `${look[0][key]} vs ${look[1][key]}`);
  if (fontKey(look[0].font) !== fontKey(look[1].font))
    add('look font', `${look[0].font} vs ${look[1].font}`);
  if (JSON.stringify(page.colours ?? {}) !== JSON.stringify(server.colours ?? {}))
    add('node colours', `${JSON.stringify(page.colours)} vs ${JSON.stringify(server.colours)}`);
  // Maths the page gives as its text in its box, the server draws as its shapes.
  const drawnShapes = (server.shapes ?? []).map((shape) => union(pointsOf(shape)) as SceneBox);
  const maths = !page.shapes?.length && drawnShapes.length;
  const inShapes = ({ box }: { box: SceneBox }) =>
    drawnShapes.some(
      (shape) =>
        box.x + box.width / 2 >= shape.x - boxTolerance &&
        box.x + box.width / 2 <= shape.x + shape.width + boxTolerance &&
        box.y + box.height / 2 >= shape.y - boxTolerance - box.height &&
        box.y + box.height / 2 <= shape.y + shape.height + boxTolerance + box.height
    );
  const pageText = (page.runs ?? []).filter((run) => !maths || !inShapes(run));
  if (maths) {
    add('maths as shapes', `${(page.runs ?? []).length - pageText.length} runs`);
    // Its shapes are inked inside the box the page gave its text: across, its span's width; up and
    // down, the span's line, which a tall formula's SVG overflows by up to a quarter of it.
    const room = union((page.runs ?? []).filter(inShapes).map(({ box }) => box));
    const inked = union(drawnShapes);
    const overflow = room ? room.height / 4 : 0;
    const outside =
      room && inked
        ? Math.max(
            room.x - inked.x,
            inked.x + inked.width - room.x - room.width,
            room.y - overflow - inked.y,
            inked.y + inked.height - room.y - room.height - overflow
          )
        : Infinity;
    if (outside > boxTolerance)
      add('maths shapes outside', `${JSON.stringify(inked)} in ${JSON.stringify(room)}`, outside);
  }
  // Text in lines: the same words, in about the same place, in the same looks.
  const runs = [pageText, server.runs ?? []] as const;
  const words = runs.map((each) => wordsOf(each.map(({ text }) => text).join(' ')));
  if (words[0] !== words[1]) add('run text', `${words[0]} vs ${words[1]}`);
  else if (runs[0].length !== runs[1].length)
    add('run count', `${runs[0].length} vs ${runs[1].length}`);
  const [pageRuns, serverRuns] = runs.map((each) => union(each.map(({ box }) => box)));
  if (pageRuns && serverRuns) {
    const gap = boxDistance(pageRuns, serverRuns);
    if (gap > boxTolerance)
      add('run box', `${JSON.stringify(pageRuns)} vs ${JSON.stringify(serverRuns)}`, gap);
  }
  if (runs[0].length === runs[1].length)
    runs[0].forEach((run, index) => {
      const other = runs[1][index];
      if (!sameColour(run.color, other.color)) add('run color', `${run.color} vs ${other.color}`);
      const gap = boxDistance(run.box, other.box);
      if (wordsOf(run.text) === wordsOf(other.text) && gap > boxTolerance)
        add(
          'run box',
          `${run.text}: ${JSON.stringify(run.box)} vs ${JSON.stringify(other.box)}`,
          gap
        );
      if (Math.abs(run.fontSize - other.fontSize) > lengthTolerance)
        add('run fontSize', `${run.fontSize} vs ${other.fontSize}`);
      for (const key of ['fontWeight', 'decoration', 'case', 'overLinks'] as const)
        if (run[key] !== other[key]) add(`run ${key}`, `${run[key]} vs ${other[key]}`);
    });
  const marks = [page.marks ?? [], server.marks ?? []] as const;
  if (marks[0].length !== marks[1].length)
    add('mark count', `${marks[0].length} vs ${marks[1].length}`);
  else
    marks[0].forEach((mark, index) => {
      const other = marks[1][index];
      const gap = boxDistance(mark.box, other.box);
      if (gap > boxTolerance)
        add('mark box', `${JSON.stringify(mark.box)} vs ${JSON.stringify(other.box)}`, gap);
      if (!sameColour(mark.fill, other.fill) || !sameColour(mark.stroke, other.stroke))
        add('mark paint', `${mark.fill}/${mark.stroke} vs ${other.fill}/${other.stroke}`);
    });
  const shapes = [page.shapes ?? [], server.shapes ?? []] as const;
  if (maths) return;
  if (shapes[0].length !== shapes[1].length)
    add('shape count', `${shapes[0].length} vs ${shapes[1].length}`);
  const [pageShapes, serverShapes] = shapes.map((each) => union(each.flatMap(pointsOf)));
  if (pageShapes && serverShapes) {
    const gap = boxDistance(pageShapes, serverShapes);
    if (gap > boxTolerance)
      add('shape box', `${JSON.stringify(pageShapes)} vs ${JSON.stringify(serverShapes)}`, gap);
  }
}

function linkDifferences(page: SceneLink, server: SceneLink, add: Add) {
  const points = (link: SceneLink) => link.curve ?? link.wire ?? [];
  const [a, b] = [points(page), points(server)];
  if (Boolean(page.curve) !== Boolean(server.curve) || a.length !== b.length)
    add(
      'link shape',
      `${page.curve ? 'curve' : 'wire'} ${a.length} vs ${server.curve ? 'curve' : 'wire'} ${b.length}`
    );
  const gap = (p: ScenePoint | undefined, q: ScenePoint | undefined) =>
    p && q ? Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) : Infinity;
  const ends = Math.max(gap(a[0], b[0]), gap(a.at(-1), b.at(-1)));
  if (ends > boxTolerance)
    add(
      'link ends',
      `${JSON.stringify([a[0], a.at(-1)])} vs ${JSON.stringify([b[0], b.at(-1)])}`,
      ends
    );
  if (!sameColour(page.stroke, server.stroke))
    add('link stroke', `${page.stroke} vs ${server.stroke}`);
  if (Math.abs(page.strokeWidth - server.strokeWidth) > lengthTolerance)
    add('link strokeWidth', `${page.strokeWidth} vs ${server.strokeWidth}`);
  if (page.strokeStyle !== server.strokeStyle || page.directed !== server.directed)
    add(
      'link style',
      `${page.strokeStyle}/${page.directed} vs ${server.strokeStyle}/${server.directed}`
    );
  for (const end of ['start', 'end'] as const) {
    const [p, q] = [page.heads?.[end], server.heads?.[end]];
    if (Boolean(p) !== Boolean(q) || (p && q && p.shape !== q.shape))
      add('link head', `${end}: ${p?.shape} vs ${q?.shape}`);
    else if (p && q && gap(p.tip, q.tip) > boxTolerance)
      add('link head', `${end} tip`, gap(p.tip, q.tip));
  }
}

/** Differences counted by kind, with the largest size of each, most common first. */
export function differenceTable(
  differences: readonly SceneDifference[]
): { kind: string; count: number; largest?: number; example: string }[] {
  const byKind = new Map<string, SceneDifference[]>();
  for (const difference of differences)
    byKind.set(difference.kind, [...(byKind.get(difference.kind) ?? []), difference]);
  return [...byKind]
    .map(([kind, all]) => {
      const sizes = all.flatMap(({ size }) => (size === undefined ? [] : [size]));
      return {
        kind,
        count: all.length,
        ...(sizes.length ? { largest: Math.round(Math.max(...sizes) * 100) / 100 } : {}),
        example: `step ${all[0].step} ${all[0].at}: ${all[0].detail}`.slice(0, 200)
      };
    })
    .sort((a, b) => b.count - a.count);
}
