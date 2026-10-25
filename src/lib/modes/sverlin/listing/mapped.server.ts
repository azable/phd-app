/**
 * A listing of the source's own: a fixed text, such as a textbook's pseudocode, in a
 * <script lang="sverlin" listing="name"> block, whose regions, marked @name[…], light when the
 * algorithm runs the code with that label (see algorithm/labels.server.ts). A region inside
 * another takes its name as a prefix, as a label does, so names line up with the algorithm's.
 * Every region needs a label, and every label a region, as each label is a place the page can
 * pause. A node without a label of its
 * own takes that of the nearest labelled node around it.
 */

import type { AnyNode, BlockStatement } from 'acorn';

import { spanKey } from '../algorithm/interpret.server';
import type { Label } from '../algorithm/labels.server';
import { spanOf } from '../algorithm/parse.server';
import type { Listing, Mark } from './listing';

/** A region of a listing's text, by its label, at its span in the text as shown and in the block. */
export type Region = { label: string; start: number; end: number; at: number };

/** A problem with a listing: in its block's body, or in the algorithm's, at an offset there. */
export type MappingProblem = { message: string; block: 'listing' | 'algorithm'; at: number };

/** What each region is mapped to: the source each node with its label has, by line. */
export type RegionMap = { label: string; text: string; sources: { text: string; line: number }[] };

const regionOpen = /^@([A-Za-z_$][\w$]*)\[/u;
const dottedOpen = /^@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\[/u;
/**
 * The text a listing shows, without its region marks and the indentation its lines share, and its
 * regions, each named with the names of those around it. A [ not opening a region, as in A[i], is
 * text, closed by the ] that matches it.
 */
export function readRegions(body: string): {
  text: string;
  regions: Region[];
  problems: MappingProblem[];
} {
  const lines = body.split('\n');
  const first = lines.findIndex((line) => line.trim());
  const last = lines.findLastIndex((line) => line.trim());
  if (first < 0) return { text: '', regions: [], problems: [] };
  const kept = lines.slice(first, last + 1);
  const indent = Math.min(
    ...kept.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length)
  );
  // Each character kept, with its offset in the body.
  const characters: { character: string; at: number }[] = [];
  let at = lines.slice(0, first).reduce((total, line) => total + line.length + 1, 0);
  kept.forEach((line, index) => {
    const cut = Math.min(indent, line.length);
    for (let column = cut; column < line.length; column++)
      characters.push({ character: line[column], at: at + column });
    if (index < kept.length - 1) characters.push({ character: '\n', at: at + line.length });
    at += line.length + 1;
  });
  const source = characters.map(({ character }) => character).join('');
  let text = '';
  const regions: Region[] = [];
  const problems: MappingProblem[] = [];
  const open: ({ label: string; start: number; at: number } | 'plain')[] = [];
  const prefix = () => open.flatMap((region) => (region === 'plain' ? [] : [region.label])).at(-1);
  for (let index = 0; index < source.length; index++) {
    const opening = source[index] === '@' ? regionOpen.exec(source.slice(index)) : null;
    const dotted = source[index] === '@' ? dottedOpen.exec(source.slice(index)) : null;
    if (dotted) {
      const names = dotted[1].split('.');
      problems.push({
        message: `The region @${dotted[1]}[ has a dotted name: a region takes one name and nests inside the one around it, as @${names.slice(0, -1).join('[… @')}[… @${names.at(-1)}[…]${']'.repeat(names.length - 1)}.`,
        block: 'listing',
        at: characters[index].at
      });
    }
    if (opening) {
      const outer = prefix();
      open.push({
        label: outer ? `${outer}.${opening[1]}` : opening[1],
        start: text.length,
        at: characters[index].at
      });
      index += opening[0].length - 1;
      continue;
    }
    if (source[index] === '[') open.push('plain');
    if (source[index] === ']' && open.length) {
      const closing = open.pop();
      if (closing !== 'plain' && closing) {
        regions.push({
          label: closing.label,
          start: closing.start,
          end: text.length,
          at: closing.at
        });
        continue;
      }
    }
    text += source[index];
  }
  for (const unclosed of open)
    if (unclosed !== 'plain')
      problems.push({
        message: `The region @${unclosed.label.split('.').at(-1)}[ is never closed with ].`,
        block: 'listing',
        at: unclosed.at
      });
  // Outer regions before those inside them.
  return {
    text,
    regions: regions.sort((a, b) => a.start - b.start || b.end - a.end || a.at - b.at),
    problems
  };
}

/**
 * A mapped listing: its text, marked for each node with a label by the regions with that label, and
 * the problems with its labels; also what each region is mapped to.
 */
export function mappedListing(
  block: { body: string },
  algorithm: { root: BlockStatement; labels: readonly Label[]; code: string }
): { listing: Listing; problems: MappingProblem[]; maps: RegionMap[] } {
  const { text, regions, problems } = readRegions(block.body);
  const { root, labels, code } = algorithm;
  const own = new Map<AnyNode, string[]>();
  for (const { full, nodes } of labels)
    for (const node of nodes) own.set(node, [...(own.get(node) ?? []), full]);
  const used = new Set(labels.map(({ full }) => full));
  const marks: Mark[] = [];
  const mapped = new Map<string, { text: string; line: number }[]>();
  const lineOf = (offset: number) => code.slice(0, Math.max(offset, 0)).split('\n').length;
  const visit = (node: unknown, inherited: readonly string[]): void => {
    if (Array.isArray(node)) return node.forEach((child) => visit(child, inherited));
    if (node === null || typeof node !== 'object' || typeof (node as AnyNode).type !== 'string')
      return;
    const part = node as AnyNode;
    const mine = own.get(part) ?? [];
    const names = mine.length ? mine : inherited;
    const span = spanOf(part);
    if (span.start >= 0) {
      for (const label of names)
        for (const region of regions)
          if (region.label === label)
            marks.push({ key: spanKey(span), start: region.start, end: region.end });
      for (const label of mine) {
        const source = code.slice(span.start, span.end).split('\n')[0].trim();
        mapped.set(label, [
          ...(mapped.get(label) ?? []),
          { text: source, line: lineOf(span.start) }
        ]);
      }
    }
    for (const [key, child] of Object.entries(part)) if (key !== 'loc') visit(child, names);
  };
  root.body.forEach((statement) => visit(statement, []));
  for (const region of regions)
    if (!used.has(region.label))
      problems.push({
        message: `The listing's region @${region.label} is labelled on no code; label the code it shows the same way, with @${region.label.split('.').at(-1)}[…] around it${region.label.includes('.') ? ` inside @${region.label.split('.').slice(0, -1).join('.')}` : ''}.`,
        block: 'listing',
        at: region.at
      });
  // Every label is a place the page can pause, so each has a region, lit where it pauses.
  const shown = new Set(regions.map(({ label }) => label));
  for (const { full, name, at } of labels)
    if (!shown.has(full))
      problems.push({
        message: `The label @${full} has no region in the listing, where the page lights it when it pauses there; mark the text its code shows as @${name}[…]${full.includes('.') ? ` inside @${full.split('.').slice(0, -1).join('.')}` : ''}, as A[@left[j - 1]] marks the j - 1 of A[j - 1].`,
        block: 'algorithm',
        at
      });
  const maps = regions.map(({ label, start, end }) => ({
    label,
    text: text.slice(start, end),
    sources: mapped.get(label) ?? []
  }));
  return {
    listing: { text, marks, regions: regions.map(({ start, end }) => ({ start, end })) },
    problems,
    maps
  };
}
