import { describe, expect, it } from 'vitest';

import { deferredStep, hintTours, introTour, placePopover, popoverSides, SeenTours } from './tours';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value)
  };
}

describe('interface tours', () => {
  it('gives every system the same introduction, in its own words', () => {
    for (const mode of ['sverlin', 'html', 'html-js'] as const) {
      expect(introTour(mode).steps.map(({ part }) => part)).toEqual([
        'timeline',
        'stage',
        'step-controls',
        'message-box',
        'help'
      ]);
    }
    expect(introTour('sverlin').steps[1].body).not.toBe(introTour('html').steps[1].body);
  });

  it('offers hints only for the parts a system has', () => {
    expect(hintTours('sverlin').map(({ id }) => id)).toEqual([
      'sverlin:hint:versions',
      'sverlin:hint:comparison',
      'sverlin:hint:choices',
      'sverlin:hint:history'
    ]);
    expect(hintTours('sverlin')[1].steps.map(({ part }) => part)).toEqual([
      'answer-buttons',
      'comparison-card'
    ]);
    for (const mode of ['html', 'html-js'] as const) {
      expect(hintTours(mode).map(({ id }) => id)).toEqual([
        `${mode}:hint:versions`,
        `${mode}:hint:history`
      ]);
    }
  });
});

describe('seen tours', () => {
  it('remembers per viewer and resets', () => {
    const storage = memoryStorage();
    const first = new SeenTours('p1', () => storage);
    first.add('html:intro');
    expect(new SeenTours('p1', () => storage).has('html:intro')).toBe(true);
    expect(new SeenTours('p2', () => storage).has('html:intro')).toBe(false);
    first.reset();
    expect(new SeenTours('p1', () => storage).has('html:intro')).toBe(false);
  });

  it('works in memory when storage throws or holds something else', () => {
    const broken = () => {
      throw new Error('blocked');
    };
    const seen = new SeenTours('p1', broken);
    seen.add('html:intro');
    expect(seen.has('html:intro')).toBe(true);
    const storage = memoryStorage();
    storage.setItem('interface-tour:v1:p1', '{not json');
    expect(new SeenTours('p1', () => storage).has('html:intro')).toBe(false);
  });
});

describe('popover placement', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 300, height: 150 };

  it('goes below a part with room, centred and kept inside the viewport', () => {
    expect(placePopover({ top: 100, left: 0, width: 100, height: 40 }, size, viewport)).toEqual({
      top: 152,
      left: 16,
      side: 'bottom'
    });
  });

  it('goes above a part at the bottom, and beside a tall one', () => {
    expect(placePopover({ top: 700, left: 400, width: 200, height: 60 }, size, viewport).side).toBe(
      'top'
    );
    expect(placePopover({ top: 0, left: 0, width: 320, height: 800 }, size, viewport)).toEqual({
      top: 325,
      left: 332,
      side: 'right'
    });
  });

  it('overlaps a part that leaves no room, and centres without one', () => {
    expect(placePopover({ top: 0, left: 0, width: 1000, height: 800 }, size, viewport)).toEqual({
      top: 634,
      left: 350,
      side: 'over'
    });
    expect(placePopover(undefined, size, viewport)).toEqual({ top: 325, left: 350, side: 'over' });
  });
});

describe('steps left out of the introduction', () => {
  it('owes each as a hint of its own, marked by the introduction', () => {
    const intro = introTour('sverlin');
    const controls = intro.steps.find(({ part }) => part === 'step-controls')!;
    expect(deferredStep(intro, controls)).toEqual({
      hint: { id: 'sverlin:hint:step-controls', steps: [controls] },
      owed: 'sverlin:intro:deferred:step-controls'
    });
  });
});

describe('popover placement beside the timeline’s messages', () => {
  it('goes beside a version tag, leaving the messages below it readable', () => {
    const viewport = { width: 1000, height: 800 };
    const tag = { top: 200, left: 40, width: 120, height: 20 };
    const size = { width: 300, height: 150 };
    expect(placePopover(tag, size, viewport, 12, 16, popoverSides('version-pill')).side).toBe(
      'right'
    );
    expect(placePopover(tag, size, viewport, 12, 16, popoverSides('stage')).side).toBe('bottom');
  });
});
