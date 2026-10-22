import { describe, expect, it } from 'vitest';

import { spanKey, traceAlgorithm } from '../algorithm/interpret.server';
import { interpretDomain, interpretInput } from '../algorithm/interpret.server';
import { pseudocode } from './pseudocode';
import { python } from './python';
import { renderListing, type Listing } from './render.server';

const domain = interpretDomain(`
  const Int = type('integer', { min: -99, max: 99 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');
  const Word = type(['found', 'none']);
  const Less = operation({ a: Index, b: Index }, ({ a, b }) => a.value < b.value);
  const Swap = operation({ a: Index, b: Index }, ({ a, b }) => {
    const moved = a.value;
    a.value = b.value;
    b.value = moved;
  });
  const Order = operation({ a: Index, b: Index }, ({ a, b }) => {
    if (Less({ a: b, b: a })) Swap({ a, b });
  });
`);
const input = interpretInput('const values = Values([3, 1, 2]);', domain);
const listed = (body: string) => {
  const { root, hints } = traceAlgorithm(body, input, domain);
  return {
    python: renderListing(root, domain, hints, python),
    pseudocode: renderListing(root, domain, hints, pseudocode)
  };
};
/** The text each mark with the given key covers. */
const marked = ({ text, marks }: Listing, key: string) =>
  marks.filter((mark) => mark.key === key).map(({ start, end }) => text.slice(start, end));

describe('listings', () => {
  it('write operations with expression bodies inline, and define the others above the algorithm', () => {
    const body = `for (let end = Index(2); end > 0; end--) {
        for (let i = Index(0); i < end; i++) Order({ a: i, b: i + 1 });
      }
      yield;`;
    const { python: inPython, pseudocode: inPseudocode } = listed(body);
    expect(inPython.text).toBe(`def swap(values, a, b):
    moved = values[a]
    values[a] = values[b]
    values[b] = moved

def order(values, a, b):
    if values[b] < values[a]:
        swap(values, a, b)

for end in range(2, 0, -1):
    for i in range(end):
        order(values, i, i + 1)`);
    expect(inPseudocode.text).toBe(`SWAP(values, a, b)
    moved = values[a]
    values[a] = values[b]
    values[b] = moved

ORDER(values, a, b)
    if values[b] < values[a]
        SWAP(values, a, b)

for end = 2 downto 1
    for i = 0 to end - 1
        ORDER(values, i, i + 1)`);
  });

  it('write a position’s value as the element of the collection it points into', () => {
    const body = `function first(a) { let i = Index(0); i.value = Int(7); return Less({ a: i, b: i + 1 }); }
      const less = Flag(first(values));
      yield;`;
    expect(listed(body).python.text).toBe(`def first(a):
    i = 0
    a[i] = 7
    return a[i] < a[i + 1]

less = first(values)`);
  });

  it('mark the text each node became, a loop’s header lighting its head', () => {
    const body = `for (let i = Index(0); i < values.length; i++) {
        if (Less({ a: i, b: Index(0) })) yield;
      }
      yield;`;
    const { python: listing } = listed(body);
    const key = (text: string, block: 'algorithm' | 'domain' = 'algorithm', from = body) => {
      const start = from.indexOf(text);
      return spanKey(block, { start, end: start + text.length });
    };
    const head = 'for i in range(len(values)):';
    expect(marked(listing, key('i++'))).toEqual([head]);
    expect(marked(listing, key('i < values.length'))).toEqual([head]);
    expect(marked(listing, key('values.length'))).toEqual(['len(values)']);
    const call = key('Less({ a: i, b: Index(0) })');
    expect(marked(listing, call)).toEqual(['values[i] < values[0]']);
    // The operation's body is marked within the call it is written at.
    const lessBody = 'a.value < b.value';
    const domainSource = `
  const Int = type('integer', { min: -99, max: 99 });
  const Values = collection(Int);
  const Index = index(Values);
  const Flag = type('boolean');
  const Word = type(['found', 'none']);
  const Less = operation({ a: Index, b: Index }, ({ a, b }) => a.value < b.value);`;
    const read = `${call}>${key('a.value', 'domain', domainSource)}`;
    expect(domainSource.indexOf(lessBody)).toBeGreaterThan(0);
    expect(marked(listing, read)).toEqual(['values[i]']);
  });

  it('bracket operands only where they bind less tightly than they need', () => {
    const body = `const a = Int(1); const b = Int(2);
      const c = Int((a + b) * 2 - (b - a));
      const d = Flag(!(a < b && b < 3) || a === b);
      const e = Int(a > b ? a : -b);
      const f = Int(Math.max(a, b) + Math.floor(a / 2));
      yield;`;
    const { python: inPython, pseudocode: inPseudocode } = listed(body);
    expect(inPython.text.split('\n').slice(-4)).toEqual([
      'c = (a + b) * 2 - (b - a)',
      'd = not (a < b and b < 3) or a == b',
      'e = a if a > b else -b',
      'f = max(a, b) + a // 2'
    ]);
    expect(inPseudocode.text.split('\n').slice(-4)).toEqual([
      'c = (a + b) · 2 - (b - a)',
      'd = not (a < b and b < 3) or a == b',
      'e = if a > b then a else -b',
      'f = max(a, b) + ⌊a / 2⌋'
    ]);
  });

  it('write branches, loops over a collection, collection methods, and text', () => {
    const body = `let found = Word('none');
      const rest = values.slice(1);
      for (const v of rest) {
        if (v > 2) { found = Word('found'); continue; }
        else if (v === 1) values.push(v);
        else break;
      }
      const count = Int(values.length);
      const seen = Flag(values.includes(1));
      yield;`;
    const { python: inPython, pseudocode: inPseudocode } = listed(body);
    expect(inPython.text).toBe(`found = "none"
rest = values[1:]
for v in rest:
    if v > 2:
        found = "found"
        continue
    elif v == 1:
        values.append(v)
    else:
        break
count = len(values)
seen = 1 in values`);
    expect(inPseudocode.text).toBe(`found = "none"
rest = values[1..]
for each v in rest
    if v > 2
        found = "found"
        continue
    elseif v == 1
        append v to values
    else
        break
count = values.length
seen = 1 ∈ values`);
  });

  it('import what a Python listing uses, and rename what Python reserves', () => {
    const body = `const from = Int(4); const root = Int(Math.sqrt(from)); yield;`;
    expect(listed(body).python.text).toBe(`import math

from_ = 4
root = math.sqrt(from_)`);
  });
});
